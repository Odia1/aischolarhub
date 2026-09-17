const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const BASELINE_SUPPORT_KNOWLEDGE = [
  {
    title: 'Getting Started with AI Scholar Hub',
    description: 'How to begin using AI Scholar Hub and choose the right learning or research experience.',
    category: 'GETTING_STARTED',
    audience: ['ALL'],
    content: `AI Scholar Hub provides role-aware AI assistance for learning, teaching, research, and institutional knowledge.

Getting started:
1. Sign in with your approved AIH account.
2. Choose the experience appropriate to your task.
3. Use normal chat for general assistance.
4. Invoke Academic Agents from the composer when you need specialized help for a particular educational, research, or scholarly task.
5. Use authorized Knowledge Sources when your institution has provided documents for your class, group, or institution.
6. Review AI-generated answers critically and follow your institution's academic-integrity requirements.

Available functions depend on your role, institution, group membership, and permissions.`
  },
  {
    title: 'Account and Login Help',
    description: 'Sign-in, account access, password, and institution-login guidance.',
    category: 'GETTING_STARTED',
    audience: ['ALL'],
    content: `Your AI Scholar Hub account is associated with an institution and role.

If you cannot sign in:
1. Confirm that you are using the approved sign-in method for your institution.
2. Check that you are using the correct account or institutional email.
3. If local passwords are enabled, use the approved password-reset process.
4. If your institution requires SSO, use the configured Google or Microsoft sign-in method.
5. Contact your Institution Admin if your account is disabled, missing, or assigned to the wrong institution.

Never provide passwords, authentication tokens, API keys, or recovery codes to AIH Support.`
  },
  {
    title: 'Knowledge Sources and Documents',
    description: 'How institutional, course, group, and personal Knowledge Sources are used safely in AIH.',
    category: 'RAG',
    audience: ['ALL'],
    content: `Knowledge Sources allow AI Scholar Hub to answer using documents and information you are authorized to access.

AIH may provide:
- institution-wide Knowledge Sources;
- department, course, class, or group Knowledge Sources;
- instructor-authorized materials;
- your own permitted personal files.

Access is hierarchical and permission-controlled. A document being stored in AIH does not automatically make it available to every user.

When using Knowledge Sources:
1. Select or upload only material you are authorized to use.
2. Ask questions that relate to the available material.
3. Check important answers against the original sources.
4. Do not upload secrets, credentials, or material you are not authorized to share.

If expected course or institutional material is unavailable, contact the instructor or Institution Admin responsible for that Knowledge Source.`
  },
  {
    title: 'Academic Agents',
    description: 'How to use AIH Academic Agents for specialized educational and research workflows.',
    category: 'ACADEMIC_AGENTS',
    audience: ['ALL'],
    content: `Academic Agents are specialized academic assistants invoked from within a conversation for particular learning, teaching, research, or scholarly tasks. Your Primary Experience remains the persistent way AI Scholar Hub works with you.

To use an Academic Agent:
1. Keep or choose the appropriate Primary Experience in the header.
2. Open Agents from the composer.
3. Choose the specialized Agent that best matches the task, such as Literature Review, Research Gap Finder, Evidence of Learning / Oral Defense, Debate & Sparring Partner, or Research Integrity & Contribution Reviewer.
4. Describe the task clearly.
5. Supply permitted documents or select authorized Knowledge Sources when useful.
6. Review the result critically and follow academic-integrity requirements.

Academic Agents do not override your role, institution, Knowledge Source permissions, or security controls. An Agent can use only the capabilities and Knowledge Sources authorized for your account.`
  },
  {
    title: 'Instructor Workflows',
    description: 'Using AIH for teaching, course knowledge, class support, and instructional workflows.',
    category: 'INSTRUCTOR_WORKFLOWS',
    audience: ['INSTRUCTOR', 'INSTITUTION_ADMIN', 'PLATFORM_ADMIN'],
    content: `Instructors can use AI Scholar Hub to support teaching and learning while preserving academic and institutional boundaries.

Typical instructor workflows include:
- using instructional Academic Agents;
- preparing explanations, lesson materials, and learning activities;
- providing authorized course or class Knowledge Sources;
- organizing learners through institution-approved groups and courses;
- guiding students with Socratic or evidence-based assistance;
- supporting research and scholarly work where permitted.

Course and class documents should be assigned only to the intended institution, course, class, group, or user scope.

AIH should support teaching judgment rather than replace instructor responsibility for curriculum, assessment, grading, or academic-integrity decisions.`
  },
  {
    title: 'Institution Administration',
    description: 'Institution, user, group, Knowledge Source, Academic Agent, and policy administration.',
    category: 'INSTITUTION_ADMINISTRATION',
    audience: ['INSTITUTION_ADMIN', 'PLATFORM_ADMIN'],
    content: `AI Scholar Hub uses a multi-institution administrative model.

Institution Admins manage authorized users, instructors, groups, academic structure, and permitted institutional resources within their own institution.

Platform Admins manage institutions and broader platform configuration subject to Superadmin controls.

Administrative responsibilities include:
- maintaining accurate user roles and institution membership;
- organizing courses, classes, departments, and groups;
- controlling Knowledge Source access and document scope;
- administering approved Academic Agent availability;
- maintaining institution-specific limits and policies where authorized.

Institution Admins must not access or modify another institution's users, documents, groups, or settings. Permanent institution deletion and designated Superadmin authority remain outside ordinary Institution Admin privileges.`
  },
  {
    title: 'Troubleshooting AI Scholar Hub',
    description: 'Common steps when AIH chat, documents, agents, or account functions do not behave as expected.',
    category: 'TROUBLESHOOTING',
    audience: ['ALL'],
    content: `For common AI Scholar Hub problems:

Chat or agent not responding:
- retry the request once;
- confirm that the selected experience or agent is available to your role;
- avoid submitting extremely large prompts unnecessarily.

Knowledge Source answer missing:
- confirm the document was uploaded successfully;
- confirm you have permission to the relevant course, group, or institution knowledge;
- ask a question that clearly relates to the document.

Upload rejected:
- confirm the file type is supported;
- remove macros, executables, or suspicious active content;
- re-export the document from a trusted application.

Permission problem:
- contact your instructor or Institution Admin rather than attempting to bypass the restriction.

If the problem persists, provide AIH Support with a short description of the problem, the visible error message, and the action you were attempting. Do not send passwords, tokens, API keys, or other secrets.`
  },
  {
    title: 'Common Errors',
    description: 'Meaning and recommended action for common user-facing AIH errors.',
    category: 'TROUBLESHOOTING',
    audience: ['ALL'],
    content: `Common AI Scholar Hub errors usually fall into these categories:

Authentication required:
Your session may have expired. Sign in again.

Permission denied or unauthorized:
Your role, institution, group membership, or capability does not permit the requested operation. Contact the appropriate administrator if you believe your access is incorrect.

Document unavailable:
The document may not be in your authorized Knowledge Source scope or may still be processing.

Upload rejected:
The file may be unsupported, unsafe, malformed, or contain active content that AIH does not accept.

Agent unavailable:
The Academic Agent may not be enabled for your role or institution.

Temporary service error:
Retry after a short interval. If the error persists, report the visible error and the operation you were performing.

Do not work around access-control or document-security errors by attempting alternate unauthorized paths.`
  },
  {
    title: 'Escalating an AIH Support Issue',
    description: 'What information to provide when an issue requires administrator or platform support.',
    category: 'TROUBLESHOOTING',
    audience: ['ALL'],
    content: `Escalate an AI Scholar Hub issue when normal guidance does not resolve the problem.

Include:
- your institution;
- your role;
- the AIH function you were using;
- the visible error message;
- a concise description of what you expected and what occurred;
- the approximate time of the problem.

Do not include:
- passwords;
- authentication or refresh tokens;
- API keys;
- private credentials;
- hidden prompts;
- confidential infrastructure details.

Students and ordinary users should normally escalate first to their instructor or Institution Admin. Institution Admins may escalate unresolved platform issues to AIH platform support.`
  },
  {
    title: 'Using AI Scholar Hub — User Guide',
    description: 'Practical guide for students and regular users: chat, learning experiences, Knowledge Sources, documents, Academic Agents, permissions, and help.',
    category: 'GETTING_STARTED',
    audience: ['ALL'],
    content: `AI Scholar Hub helps you learn, ask questions, work with authorized knowledge, and use educational AI experiences provided by your institution.

What you can use
The features visible to you depend on your role, institution, group membership, and permissions. A regular user may have access to:
- normal AI chat;
- an assigned learning experience such as the Undergraduate Socratic Tutor;
- Academic Agents approved for your institution;
- personal documents you are permitted to upload;
- course, group, or institution Knowledge Sources made available to you.

Starting a conversation
1. Sign in with your approved AI Scholar Hub account.
2. Choose the Primary Experience appropriate to your continuing work, then invoke an Academic Agent from the composer when a particular task needs specialized help.
3. Enter your question in normal language.
4. Continue the conversation with follow-up questions when you need clarification or deeper explanation.

Using the Socratic Tutor
The Socratic Tutor is designed to help you reason through a topic rather than simply supply answers. Explain what you understand, ask where you are stuck, and work through the problem interactively.

Knowledge Sources
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
Academic Agents provide specialized assistance for particular educational, research, or scholarly tasks. Only Agents enabled for your account are available. Invoke an Agent from the composer when the current task needs specialized help; the Agent does not replace your underlying Primary Experience.

If something is missing
If you cannot see an expected agent, Knowledge Source, course document, or other capability, do not attempt to bypass the restriction. Access may depend on your role, institution, group, or course membership.

Students and regular users should normally contact their instructor or Institution Admin when expected access is missing.

Getting help
Skills
AI Scholar Hub includes compact reusable academic workflows. Release I provides:
- Study a Topic — focused explanation, examples, checks for understanding, and recap.
- Analyze a Research Paper — research question, methods, findings, limitations, and key claims.

Research Integrity & Contribution Reviewer
This Academic Agent provides professor-style review of accuracy, evidence, methods, novelty and contribution, citation integrity, reasoning, overclaiming, and revision priorities. It can verify only sources it can actually inspect and must not declare research misconduct without adequate evidence.

Academic integrity
AI Scholar Hub is designed to strengthen learning, authorship, evidence, attribution, and scholarly judgment. It should distinguish evidence from inference and uncertainty, preserve provenance, and never fabricate citations, evidence, measurements, or source access.

Use AIH Support for questions about using AI Scholar Hub, Primary Experiences, Academic Agents, Tools, Skills, Knowledge Sources, documents, account access, and common errors.

For unresolved problems, provide the visible error message and describe what you were trying to do. Never provide passwords, tokens, API keys, or other secrets to Support.`
  },
  {
    title: 'Security and Privacy Boundaries',
    description: 'What AIH Support can and cannot access or do.',
    category: 'SECURITY_PRIVACY',
    audience: ['ALL'],
    content: `AIH Support is an authenticated, read-only support capability.

It may use approved Support Knowledge and limited user-facing context such as your role and institution when needed to provide relevant guidance.

AIH Support does not provide access to:
- passwords, API keys, tokens, or credentials;
- source code;
- hidden prompts or internal diagnostics;
- deployment topology;
- raw infrastructure logs;
- unauthorized files or Knowledge Sources;
- another institution's protected information.

AIH Support cannot change your permissions, elevate your role, modify institution security policy, or bypass authentication and authorization.

If a request requires administrative action, Support should explain the appropriate escalation path rather than attempting the privileged operation.`
  },
];


const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireManageSupportKnowledge = requireCapability(
  SystemCapabilities.MANAGE_SUPPORT_KNOWLEDGE,
);

router.use(requireJwtAuth, requireAdminAccess, requireManageSupportKnowledge);

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * Support Knowledge mutations remain explicitly gated until the platform
 * audit write and knowledge mutation can participate in one MongoDB
 * transaction. DEV may enable this for validation; PROD should leave it off.
 */
function requireSupportKnowledgeMutationsEnabled(_req, res, next) {
  if (process.env.SUPPORT_KNOWLEDGE_MUTATIONS_ENABLED !== 'true') {
    return res.status(503).json({
      error: 'Support Knowledge administration is not enabled in this environment',
    });
  }

  next();
}

function actorFromRequest(req) {
  const user = req.user;
  const userId = user?._id?.toString?.() ?? user?.id;

  if (!userId) {
    return null;
  }

  return {
    userId,
    actorName: user.name || user.username || user.email || userId,
  };
}

function auditContext(req) {
  const requestId =
    req.get?.('x-request-id') ||
    req.get?.('x-correlation-id') ||
    undefined;

  const userAgent = req.get?.('user-agent') || undefined;

  return {
    ...(requestId ? { requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

async function emitAudit(req, action, doc, metadata = {}) {
  const actor = actorFromRequest(req);
  if (!actor || !db.recordAuditEntry) {
    return;
  }

  await db.recordAuditEntry(
    {
      action,
      outcome: 'success',
      severity: action === 'support_knowledge.published' ? 'warning' : 'info',
      actor: {
        type: 'user',
        id: actor.userId,
        name: actor.actorName,
      },
      target: {
        type: 'support_knowledge',
        id: doc._id,
        name: doc.title,
      },
      metadata: {
        knowledgeKey: String(doc.knowledgeKey),
        revision: Number(doc.revision),
        status: String(doc.status),
        category: String(doc.category),
        ...metadata,
      },
      context: auditContext(req),

      /**
       * Deliberately omit tenantId:
       * Support Knowledge is platform-scoped and belongs to the platform
       * audit chain, not an institution-specific chain.
       */
    },
    { failClosed: true },
  );
}

function parseDate(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${fieldName} must be a valid date`);
    err.status = 400;
    throw err;
  }

  return date;
}

function validateCreateBody(body = {}) {
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return 'title is required';
  }

  if (typeof body.content !== 'string' || !body.content.trim()) {
    return 'content is required';
  }

  return null;
}

function handleError(res, err) {
  if (err?.name === 'SupportKnowledgeNotFoundError') {
    return res.status(404).json({ error: err.message });
  }

  if (err?.name === 'SupportKnowledgeConflictError') {
    return res.status(409).json({ error: err.message });
  }

  if (err?.status === 400) {
    return res.status(400).json({ error: err.message });
  }

  console.error('[adminSupportKnowledge]', err);
  return res.status(500).json({
    error: 'Support Knowledge operation failed',
  });
}


router.post(
  '/bootstrap-baseline',
  requireSupportKnowledgeMutationsEnabled,
  async (req, res) => {
    try {
      const actor = actorFromRequest(req);

      if (!actor) {
        return res.status(401).json({ error: 'Authenticated user required' });
      }

      const existing = await db.listSupportKnowledge();
      const results = [];

      for (const article of BASELINE_SUPPORT_KNOWLEDGE) {
        const matches = existing.filter(
          (doc) =>
            String(doc.title || '').trim().toLowerCase() ===
            article.title.toLowerCase(),
        );

        const published = matches.find(
          (doc) => String(doc.status).toUpperCase() === 'PUBLISHED',
        );

        if (published) {
          results.push({ title: article.title, action: 'already-published' });
          continue;
        }

        let draft = matches.find(
          (doc) => String(doc.status).toUpperCase() === 'DRAFT',
        );

        if (!draft) {
          draft = await db.createSupportKnowledgeDraft({
            title: article.title,
            description: article.description,
            category: article.category,
            audience: article.audience,
            content: article.content,
            actorId: actor.userId,
          });

          await emitAudit(req, 'support_knowledge.created', draft, {
            bootstrap: 'release-f-baseline',
          });
        }

        const publishedDocument = await db.publishSupportKnowledge(
          draft._id,
          actor.userId,
        );

        await emitAudit(req, 'support_knowledge.published', publishedDocument, {
          bootstrap: 'release-f-baseline',
        });

        results.push({
          title: article.title,
          action: 'published',
          revision: Number(publishedDocument.revision),
        });
      }

      return res.status(200).json({
        ok: true,
        baseline: 'release-f',
        count: results.length,
        results,
      });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

router.get('/', async (_req, res) => {
  try {
    const documents = await db.listSupportKnowledge();
    return res.status(200).json({ documents });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const document = await db.getSupportKnowledgeById(req.params.id);

    if (!document) {
      return res.status(404).json({
        error: 'Support Knowledge document not found',
      });
    }

    return res.status(200).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/', requireSupportKnowledgeMutationsEnabled, async (req, res) => {
  try {
    const validationError = validateCreateBody(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const actor = actorFromRequest(req);

    if (!actor) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const document = await db.createSupportKnowledgeDraft({
      title: req.body.title.trim(),
      ...(typeof req.body.description === 'string'
        ? { description: req.body.description.trim() }
        : {}),
      ...(req.body.category !== undefined
        ? { category: req.body.category }
        : {}),
      ...(Array.isArray(req.body.audience)
        ? { audience: req.body.audience }
        : {}),
      content: req.body.content,
      ...(req.body.effectiveAt !== undefined
        ? { effectiveAt: parseDate(req.body.effectiveAt, 'effectiveAt') }
        : {}),
      actorId: actor.userId,
    });

    await emitAudit(req, 'support_knowledge.created', document);

    return res.status(201).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

router.patch('/:id', requireSupportKnowledgeMutationsEnabled, async (req, res) => {
  try {
    const actor = actorFromRequest(req);

    if (!actor) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const update = {
      actorId: actor.userId,
    };

    if (req.body.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
        return res.status(400).json({ error: 'title must not be empty' });
      }
      update.title = req.body.title.trim();
    }

    if (req.body.description !== undefined) {
      if (typeof req.body.description !== 'string') {
        return res.status(400).json({ error: 'description must be a string' });
      }
      update.description = req.body.description.trim();
    }

    if (req.body.category !== undefined) {
      update.category = req.body.category;
    }

    if (req.body.audience !== undefined) {
      if (!Array.isArray(req.body.audience)) {
        return res.status(400).json({ error: 'audience must be an array' });
      }
      update.audience = req.body.audience;
    }

    if (req.body.content !== undefined) {
      if (typeof req.body.content !== 'string' || !req.body.content.trim()) {
        return res.status(400).json({ error: 'content must not be empty' });
      }
      update.content = req.body.content;
    }

    if (req.body.effectiveAt !== undefined) {
      update.effectiveAt = parseDate(req.body.effectiveAt, 'effectiveAt');
    }

    const document = await db.updateSupportKnowledgeDraft(
      req.params.id,
      update,
    );

    await emitAudit(req, 'support_knowledge.updated', document);

    return res.status(200).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/:id/revise', requireSupportKnowledgeMutationsEnabled, async (req, res) => {
  try {
    const actor = actorFromRequest(req);

    if (!actor) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const source = await db.getSupportKnowledgeById(req.params.id);

    if (!source) {
      return res.status(404).json({
        error: 'Support Knowledge document not found',
      });
    }

    const document = await db.createSupportKnowledgeRevision(
      req.params.id,
      actor.userId,
    );

    await emitAudit(req, 'support_knowledge.revised', document, {
      sourceRevision: Number(source.revision),
    });

    return res.status(201).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/:id/publish', requireSupportKnowledgeMutationsEnabled, async (req, res) => {
  try {
    const actor = actorFromRequest(req);

    if (!actor) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const document = await db.publishSupportKnowledge(
      req.params.id,
      actor.userId,
    );

    await emitAudit(req, 'support_knowledge.published', document);

    return res.status(200).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/:id/retire', requireSupportKnowledgeMutationsEnabled, async (req, res) => {
  try {
    const actor = actorFromRequest(req);

    if (!actor) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const document = await db.retireSupportKnowledge(
      req.params.id,
      actor.userId,
    );

    await emitAudit(req, 'support_knowledge.retired', document);

    return res.status(200).json({ document });
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
