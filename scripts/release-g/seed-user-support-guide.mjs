import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL;

if (!uri) {
  throw new Error('MongoDB connection URI is unavailable');
}

const client = new MongoClient(uri);

const title = 'Using AI Scholar Hub — User Guide';
const now = new Date();

const content = `AI Scholar Hub helps you learn, ask questions, work with authorized knowledge, and use educational AI experiences provided by your institution.

What you can use
The features visible to you depend on your role, institution, group membership, and permissions. A regular user may have access to:
- normal AI chat;
- an assigned learning experience such as the Undergraduate Socratic Tutor;
- Academic Agents approved for your institution;
- personal documents you are permitted to upload;
- course, group, or institution Knowledge Sources made available to you.

Starting a conversation
1. Sign in with your approved AI Scholar Hub account.
2. Select the learning experience or Academic Agent appropriate to your task.
3. Enter your question in normal language.
4. Continue the conversation with follow-up questions when you need clarification or deeper explanation.

Using the Socratic Tutor
The Socratic Tutor is designed to help you reason through a topic rather than simply supply answers. Explain what you understand, ask where you are stuck, and work through the problem interactively.

Knowledge Sources and RAG
Knowledge Sources allow AI Scholar Hub to answer using documents you are authorized to access. These may include institutional, course, class, group, instructor-provided, or personal documents.

A document being stored in AI Scholar Hub does not automatically make it available to every user. Access remains controlled by your institution, groups, and permissions.

Personal documents
Where personal document upload is enabled:
1. Upload only material you are authorized to use.
2. Wait for processing to complete.
3. Ask questions that clearly relate to the document.
4. Check important answers against the original source.

Do not upload passwords, credentials, API keys, secrets, or material you are not authorized to share.

Academic Agents
Academic Agents are specialized assistants for particular educational, research, or scholarly tasks. Only agents enabled for your account will be available. Select an agent appropriate to your task and follow its instructions.

If something is missing
If you cannot see an expected agent, Knowledge Source, course document, or other capability, do not attempt to bypass the restriction. Access may depend on your role, institution, group, or course membership.

Students and regular users should normally contact their instructor or Institution Admin when expected access is missing.

Getting help
Use AIH Support for questions about using AI Scholar Hub, Knowledge Sources, documents, Academic Agents, account access, and common errors.

For unresolved problems, provide the visible error message and describe what you were trying to do. Never provide passwords, tokens, API keys, or other secrets to Support.`;

try {
  await client.connect();
  const db = client.db('LibreChat');
  const collection = db.collection('supportknowledges');

  const existing = await collection.findOne({
    title,
    status: 'PUBLISHED'
  });

  if (existing) {
    console.log('USER_GUIDE_ALREADY_PUBLISHED');
    process.exitCode = 0;
  } else {
    const knowledgeKey = crypto.randomUUID();

    await collection.insertOne({
      knowledgeKey,
      revision: 1,
      status: 'PUBLISHED',
      title,
      description:
        'Practical guide for students and regular users: chat, learning experiences, Knowledge Sources, documents, Academic Agents, permissions, and help.',
      category: 'GETTING_STARTED',
      audience: ['ALL'],
      content,
      createdBy: 'release-g-migration',
      updatedBy: 'release-g-migration',
      publishedBy: 'release-g-migration',
      effectiveAt: now,
      publishedAt: now,
      createdAt: now,
      updatedAt: now
    });

    console.log('USER_GUIDE_PUBLISHED');
  }
} finally {
  await client.close();
}
