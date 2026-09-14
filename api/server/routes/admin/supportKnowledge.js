const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

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
