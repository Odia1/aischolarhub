const fs = require('fs');
const net = require('net');
const path = require('path');
const yauzl = require('yauzl');
const { determineFileType } = require('../../utils/files');

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_SINGLE_ZIP_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
]);

const BINARY_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
]);

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...BINARY_DOCUMENT_EXTENSIONS,
]);

const EXPECTED_BINARY_TYPES = {
  '.pdf': new Set(['pdf']),
  '.docx': new Set(['docx', 'zip']),
  '.xlsx': new Set(['xlsx', 'zip']),
  '.pptx': new Set(['pptx', 'zip']),
};

const REQUIRED_OOXML_ENTRIES = {
  '.docx': ['[Content_Types].xml', 'word/document.xml'],
  '.xlsx': ['[Content_Types].xml', 'xl/workbook.xml'],
  '.pptx': ['[Content_Types].xml', 'ppt/presentation.xml'],
};

const FORBIDDEN_OOXML_PATH_PATTERNS = [
  /(^|\/)vbaproject\.bin$/i,
  /(^|\/)activex\//i,
  /(^|\/)embeddings\//i,
  /(^|\/)oleobject/i,
  /(^|\/)macrosheets\//i,
];

const FORBIDDEN_PDF_TOKENS = [
  '/JavaScript',
  '/JS ',
  '/JS/',
  '/Launch',
  '/EmbeddedFile',
  '/OpenAction',
  '/AA ',
];

class UploadSecurityError extends Error {
  constructor(message, reasonCode, userErrorStatusCode = 415) {
    super(message);
    this.name = 'UploadSecurityError';
    this.code = 'UPLOAD_SECURITY_REJECTED';
    this.reasonCode = reasonCode;
    this.userErrorStatusCode = userErrorStatusCode;
    this.statusCode = userErrorStatusCode;
  }
}

function reject(message, reasonCode) {
  throw new UploadSecurityError(message, reasonCode);
}

function normalizeExtension(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function isUnsafeArchivePath(name) {
  const normalized = String(name || '').replace(/\\/g, '/');

  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  );
}

function inspectOoxmlArchive(filePath, extension) {
  return new Promise((resolve, rejectPromise) => {
    yauzl.open(
      filePath,
      {
        lazyEntries: true,
        autoClose: true,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (openErr, zipfile) => {
        if (openErr || !zipfile) {
          rejectPromise(
            new UploadSecurityError(
              'Invalid or corrupted Office document container',
              'INVALID_OOXML_CONTAINER',
            ),
          );
          return;
        }

        let entryCount = 0;
        let totalUncompressed = 0;
        const names = new Set();
        let settled = false;

        const fail = (message, reasonCode) => {
          if (settled) return;
          settled = true;
          try {
            zipfile.close();
          } catch {
            // Ignore close failure while rejecting hostile input.
          }
          rejectPromise(new UploadSecurityError(message, reasonCode));
        };

        zipfile.on('error', () => {
          fail(
            'Invalid or corrupted Office document container',
            'INVALID_OOXML_CONTAINER',
          );
        });

        zipfile.on('entry', (entry) => {
          entryCount += 1;

          if (entryCount > MAX_ZIP_ENTRIES) {
            fail(
              'Office document contains too many internal entries',
              'ZIP_ENTRY_LIMIT',
            );
            return;
          }

          const name = String(entry.fileName || '').replace(/\\/g, '/');

          if (isUnsafeArchivePath(name)) {
            fail(
              'Office document contains an unsafe internal path',
              'ZIP_PATH_TRAVERSAL',
            );
            return;
          }

          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            fail(
              'Encrypted Office document content is not accepted',
              'ENCRYPTED_ARCHIVE_ENTRY',
            );
            return;
          }

          for (const pattern of FORBIDDEN_OOXML_PATH_PATTERNS) {
            if (pattern.test(name)) {
              fail(
                'Office document contains active or embedded content',
                'ACTIVE_OFFICE_CONTENT',
              );
              return;
            }
          }

          const uncompressed = Number(entry.uncompressedSize || 0);
          const compressed = Number(entry.compressedSize || 0);

          if (uncompressed > MAX_SINGLE_ZIP_ENTRY_BYTES) {
            fail(
              'Office document contains an excessively large internal entry',
              'ZIP_ENTRY_SIZE_LIMIT',
            );
            return;
          }

          totalUncompressed += uncompressed;

          if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
            fail(
              'Office document expands beyond the permitted processing limit',
              'ZIP_EXPANSION_LIMIT',
            );
            return;
          }

          if (
            compressed > 0 &&
            uncompressed > 1024 * 1024 &&
            uncompressed / compressed > MAX_COMPRESSION_RATIO
          ) {
            fail(
              'Office document has a suspicious compression ratio',
              'ZIP_BOMB_RATIO',
            );
            return;
          }

          names.add(name);
          zipfile.readEntry();
        });

        zipfile.on('end', () => {
          if (settled) return;

          const required = REQUIRED_OOXML_ENTRIES[extension] || [];
          const missing = required.filter((name) => !names.has(name));

          if (missing.length > 0) {
            fail(
              'File contents do not match the declared Office document type',
              'OOXML_TYPE_MISMATCH',
            );
            return;
          }

          settled = true;
          resolve({
            entryCount,
            totalUncompressed,
          });
        });

        zipfile.readEntry();
      },
    );
  });
}

async function validatePdf(filePath, detectedType) {
  if (!detectedType || detectedType.ext !== 'pdf') {
    reject(
      'File contents do not match the .pdf extension',
      'FILE_TYPE_MISMATCH',
    );
  }

  const buffer = await fs.promises.readFile(filePath);

  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    reject('Invalid PDF header', 'INVALID_PDF');
  }

  const binaryText = buffer.toString('latin1');

  for (const token of FORBIDDEN_PDF_TOKENS) {
    if (binaryText.includes(token)) {
      reject(
        'PDF contains active, embedded, or automatically invoked content',
        'ACTIVE_PDF_CONTENT',
      );
    }
  }
}

async function validateTextDocument(filePath, detectedType) {
  /**
   * `file-type` normally returns undefined for ordinary text. If it positively
   * identifies a binary format, the upload is masquerading as text.
   */
  if (detectedType) {
    reject(
      'File contents do not match the declared text document type',
      'FILE_TYPE_MISMATCH',
    );
  }

  const buffer = await fs.promises.readFile(filePath);

  if (buffer.includes(0)) {
    reject(
      'Text document contains binary NUL bytes',
      'BINARY_CONTENT_IN_TEXT',
    );
  }
}


async function resolveScannerPath(filePath) {
  const apiRoot = process.env.CLAMAV_API_UPLOAD_ROOT || '/app/uploads';
  const scannerRoot =
    process.env.CLAMAV_SCANNER_UPLOAD_ROOT || '/scan/uploads';

  const [realFile, realRoot] = await Promise.all([
    fs.promises.realpath(filePath),
    fs.promises.realpath(apiRoot),
  ]);

  const relative = path.relative(realRoot, realFile);

  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new UploadSecurityError(
      'Upload is outside the permitted quarantine directory',
      'QUARANTINE_PATH_INVALID',
      415,
    );
  }

  return path.posix.join(scannerRoot, ...relative.split(path.sep));
}

function clamdScanPath(scannerPath) {
  const host = process.env.CLAMAV_HOST || 'clamav';
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeout = Number(process.env.CLAMAV_SCAN_TIMEOUT_MS || 15000);

  return new Promise((resolve, rejectPromise) => {
    const socket = net.createConnection({ host, port });
    let reply = '';
    let settled = false;

    const failUnavailable = () => {
      if (settled) return;
      settled = true;
      socket.destroy();

      rejectPromise(
        new UploadSecurityError(
          'Document security scanner is temporarily unavailable',
          'MALWARE_SCANNER_UNAVAILABLE',
          503,
        ),
      );
    };

    const finish = () => {
      if (settled) return;

      const normalized = reply.replace(/\0/g, '').trim();

      if (/\bFOUND\b/i.test(normalized)) {
        settled = true;
        socket.destroy();

        rejectPromise(
          new UploadSecurityError(
            'Upload rejected by document security scanning',
            'MALWARE_DETECTED',
            422,
          ),
        );
        return;
      }

      if (/\bOK\b/i.test(normalized)) {
        settled = true;
        socket.destroy();
        resolve({ disposition: 'CLEAN' });
        return;
      }

      failUnavailable();
    };

    socket.setTimeout(timeout);

    socket.once('connect', () => {
      socket.write(`zSCAN ${scannerPath}\0`);
    });

    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('\0')) {
        finish();
      }
    });

    socket.once('timeout', failUnavailable);
    socket.once('error', failUnavailable);
    socket.once('end', () => {
      if (!settled) finish();
    });
  });
}

async function scanDocumentForMalware(file) {
  if (
    String(process.env.UPLOAD_MALWARE_SCAN_ENABLED || '').toLowerCase() !==
    'true'
  ) {
    return { disposition: 'SKIPPED' };
  }

  if (!file?.path) {
    throw new UploadSecurityError(
      'Uploaded file is missing its temporary path',
      'MISSING_FILE',
      415,
    );
  }

  const scannerPath = await resolveScannerPath(file.path);
  return clamdScanPath(scannerPath);
}

/**
 * Security gate for untrusted documents that will be parsed, indexed, or used
 * as AIH knowledge.
 *
 * This is intentionally separate from Run Code. Code-sandbox uploads have a
 * different trust model and must never be treated as trusted RAG documents.
 */
async function validateDocumentIngestionUpload(file) {
  if (!file?.path) {
    reject('Uploaded file is missing its temporary path', 'MISSING_FILE');
  }

  const extension = normalizeExtension(file.originalname);

  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
    reject(
      `File type ${extension || '(none)'} is not permitted for document ingestion`,
      'EXTENSION_NOT_ALLOWED',
    );
  }

  const stats = await fs.promises.stat(file.path);

  if (!stats.isFile()) {
    reject('Upload is not a regular file', 'NOT_REGULAR_FILE');
  }

  if (stats.size <= 0) {
    reject('Empty documents are not accepted', 'EMPTY_FILE');
  }

  if (stats.size > MAX_DOCUMENT_BYTES) {
    reject(
      'Document exceeds the 32 MB security processing limit',
      'SECURITY_SIZE_LIMIT',
    );
  }

  const header = Buffer.alloc(Math.min(stats.size, 64 * 1024));
  const handle = await fs.promises.open(file.path, 'r');

  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  const detectedType = await determineFileType(header, true);

  if (TEXT_EXTENSIONS.has(extension)) {
    await validateTextDocument(file.path, detectedType);
  } else if (extension === '.pdf') {
    await validatePdf(file.path, detectedType);
  } else {
    const acceptedDetectedTypes = EXPECTED_BINARY_TYPES[extension];

    if (
      detectedType &&
      acceptedDetectedTypes &&
      !acceptedDetectedTypes.has(detectedType.ext)
    ) {
      reject(
        `File contents do not match the ${extension} extension`,
        'FILE_TYPE_MISMATCH',
      );
    }

    await inspectOoxmlArchive(file.path, extension);
  }

  return {
    disposition: 'ACCEPT',
    extension,
    detectedType: detectedType?.ext ?? null,
    detectedMime: detectedType?.mime ?? null,
    bytes: stats.size,
  };
}

/**
 * Returns true only for document formats handled by the structural
 * hostile-document gate. Malware scanning is broader and may apply to
 * additional upload types.
 *
 * Keep this list aligned with validateDocumentIngestionUpload().
 */
function isDocumentIngestionUpload(file) {
  return /\.(?:txt|md|csv|json|pdf|docx|xlsx|pptx)$/i.test(
    String(file?.originalname || ''),
  );
}

module.exports = {
  UploadSecurityError,
  isDocumentIngestionUpload,
  scanDocumentForMalware,
  validateDocumentIngestionUpload,
};
