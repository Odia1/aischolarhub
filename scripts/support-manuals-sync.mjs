import fs from 'fs';
import crypto from 'crypto';
import { MongoClient, ObjectId } from 'mongodb';

const mode = process.argv[2] || 'check';
const canonicalPath =
  process.argv[3] || '/app/docs/support/support-manuals.json';

if (!['export', 'check', 'apply'].includes(mode)) {
  console.error(
    'Usage: node scripts/support-manuals-sync.mjs export|check|apply [canonical-json]',
  );
  process.exit(2);
}

const uri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL;

if (!uri) {
  throw new Error('MongoDB connection URI is unavailable');
}

function normalized(doc) {
  return {
    knowledgeKey: String(doc.knowledgeKey || ''),
    title: String(doc.title || '').trim(),
    description:
      typeof doc.description === 'string' ? doc.description.trim() : '',
    category: String(doc.category || 'OTHER').trim(),
    audience: Array.isArray(doc.audience)
      ? [...doc.audience].map(String).sort()
      : ['ALL'],
    content: String(doc.content || '').trim(),
  };
}

function contentHash(doc) {
  const n = normalized(doc);

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        title: n.title,
        description: n.description,
        category: n.category,
        audience: n.audience,
        content: n.content,
      }),
    )
    .digest('hex');
}

const client = new MongoClient(uri);

try {
  await client.connect();

  const collection =
    client.db('LibreChat').collection('supportknowledges');

  const published = await collection
    .find({ status: 'PUBLISHED' })
    .sort({ title: 1 })
    .toArray();

  if (mode === 'export') {
    const manuals = published.map((doc) => ({
      ...normalized(doc),
      revision: Number(doc.revision || 1),
      sourceHash: contentHash(doc),
    }));

    fs.mkdirSync(
      canonicalPath.substring(0, canonicalPath.lastIndexOf('/')),
      { recursive: true },
    );

    fs.writeFileSync(
      canonicalPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          manuals,
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      `EXPORTED ${manuals.length} manuals to ${canonicalPath}`,
    );
    process.exit(0);
  }

  if (!fs.existsSync(canonicalPath)) {
    throw new Error(
      `Canonical manual file not found: ${canonicalPath}. Run export first.`,
    );
  }

  const canonicalFile = JSON.parse(
    fs.readFileSync(canonicalPath, 'utf8'),
  );

  const manuals = Array.isArray(canonicalFile.manuals)
    ? canonicalFile.manuals
    : [];

  const publishedByKey = new Map(
    published.map((doc) => [String(doc.knowledgeKey), doc]),
  );

  const changes = [];

  for (const manual of manuals) {
    const key = String(manual.knowledgeKey || '').trim();

    if (!key) {
      throw new Error(
        `Manual "${manual.title || 'untitled'}" has no knowledgeKey`,
      );
    }

    const current = publishedByKey.get(key);

    if (!current) {
      changes.push({
        type: 'NEW',
        manual,
        current: null,
      });
      continue;
    }

    if (contentHash(current) !== contentHash(manual)) {
      changes.push({
        type: 'CHANGED',
        manual,
        current,
      });
    }
  }

  console.log(`Canonical manuals: ${manuals.length}`);
  console.log(`Published manuals: ${published.length}`);
  console.log(`Changes required: ${changes.length}`);

  for (const change of changes) {
    console.log(
      `${change.type}: ${change.manual.title}`,
    );
  }

  if (mode === 'check') {
    process.exit(changes.length ? 3 : 0);
  }

  const actor = 'support-manual-sync';
  const now = new Date();

  for (const change of changes) {
    const manual = normalized(change.manual);

    if (change.type === 'NEW') {
      const revision = Number(change.manual.revision || 1);

      await collection.insertOne({
        knowledgeKey: manual.knowledgeKey,
        revision,
        status: 'PUBLISHED',
        title: manual.title,
        description: manual.description || undefined,
        category: manual.category,
        audience: manual.audience,
        content: manual.content,
        createdBy: actor,
        updatedBy: actor,
        publishedBy: actor,
        effectiveAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      console.log(
        `PUBLISHED NEW: ${manual.title} revision ${revision}`,
      );

      continue;
    }

    const current = change.current;
    const nextRevision = Number(current.revision || 1) + 1;

    /*
     * Retire the currently published revision first because the schema
     * permits only one PUBLISHED revision per knowledgeKey.
     */
    await collection.updateOne(
      {
        _id: new ObjectId(current._id),
        status: 'PUBLISHED',
      },
      {
        $set: {
          status: 'RETIRED',
          retiredAt: now,
          retiredBy: actor,
          updatedAt: now,
          updatedBy: actor,
        },
      },
    );

    await collection.insertOne({
      knowledgeKey: manual.knowledgeKey,
      revision: nextRevision,
      status: 'PUBLISHED',
      title: manual.title,
      description: manual.description || undefined,
      category: manual.category,
      audience: manual.audience,
      content: manual.content,
      sourceRevisionId: current._id,
      createdBy: actor,
      updatedBy: actor,
      publishedBy: actor,
      effectiveAt: now,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    console.log(
      `PUBLISHED UPDATE: ${manual.title} revision ${nextRevision}`,
    );
  }

  console.log('SUPPORT_MANUAL_SYNC_COMPLETE');
} finally {
  await client.close();
}
