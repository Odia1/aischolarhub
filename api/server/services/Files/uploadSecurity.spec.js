const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const {
  UploadSecurityError,
  validateDocumentIngestionUpload,
} = require('./uploadSecurity');

let tempDir;

const makeFile = async (name, content) => {
  const filePath = path.join(tempDir, name);
  await fs.promises.writeFile(filePath, content);

  return {
    path: filePath,
    originalname: name,
  };
};

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aih-upload-security-'),
  );
});

afterEach(async () => {
  await fs.promises.rm(tempDir, {
    recursive: true,
    force: true,
  });
});

describe('validateDocumentIngestionUpload', () => {
  test('accepts ordinary text', async () => {
    const file = await makeFile(
      'notes.txt',
      'AI Scholar Hub benign text document\n',
    );

    const result = await validateDocumentIngestionUpload(file);

    expect(result.disposition).toBe('ACCEPT');
    expect(result.extension).toBe('.txt');
  });

  test('rejects an executable masquerading as text', async () => {
    const pe = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.alloc(1024),
    ]);

    const file = await makeFile('notes.txt', pe);

    await expect(
      validateDocumentIngestionUpload(file),
    ).rejects.toMatchObject({
      name: 'UploadSecurityError',
      reasonCode: 'FILE_TYPE_MISMATCH',
    });
  });

  test('rejects fake PDF content', async () => {
    const file = await makeFile(
      'paper.pdf',
      Buffer.from('This is not a PDF'),
    );

    await expect(
      validateDocumentIngestionUpload(file),
    ).rejects.toBeInstanceOf(UploadSecurityError);
  });

  test('rejects PDF active content', async () => {
    const file = await makeFile(
      'paper.pdf',
      Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R /JavaScript 3 0 R >>\nendobj\n',
        'latin1',
      ),
    );

    await expect(
      validateDocumentIngestionUpload(file),
    ).rejects.toMatchObject({
      reasonCode: 'ACTIVE_PDF_CONTENT',
    });
  });

  test('accepts structurally valid minimal DOCX container', async () => {
    const zip = new JSZip();

    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types></Types>',
    );

    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><document></document>',
    );

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
    });

    const file = await makeFile('document.docx', buffer);

    const result =
      await validateDocumentIngestionUpload(file);

    expect(result.disposition).toBe('ACCEPT');
    expect(result.extension).toBe('.docx');
  });

  test('rejects macro payload inside DOCX container', async () => {
    const zip = new JSZip();

    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types></Types>',
    );

    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><document></document>',
    );

    zip.file(
      'word/vbaProject.bin',
      Buffer.from('macro payload'),
    );

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
    });

    const file = await makeFile('document.docx', buffer);

    await expect(
      validateDocumentIngestionUpload(file),
    ).rejects.toMatchObject({
      reasonCode: 'ACTIVE_OFFICE_CONTENT',
    });
  });

  test('rejects raw archives', async () => {
    const zip = new JSZip();
    zip.file('payload.txt', 'payload');

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
    });

    const file = await makeFile('archive.zip', buffer);

    await expect(
      validateDocumentIngestionUpload(file),
    ).rejects.toMatchObject({
      reasonCode: 'EXTENSION_NOT_ALLOWED',
    });
  });
});
