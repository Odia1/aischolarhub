const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  resolveKnowledgeScope,
  resolveAuthorizedKnowledgeScopes,
} = require('~/server/services/AcademicIntelligence/knowledgeScope');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/points', async (req, res) => {
  try {
    const userId = String(req.user?.id ?? req.user?._id ?? '').trim();
    const tenantId = String(req.user?.tenantId ?? '').trim();
    if (!userId || !tenantId) {
      return res.status(403).json({ error: 'Institution context is required' });
    }
    const result = await resolveAuthorizedKnowledgeScopes({
      tenantId,
      userId,
      role: req.user?.role,
      activeGroupId: null,
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie, Authorization');
    return res.json({
      ragEnabledDefault: true,
      selectedPointKeysDefault: ['PERSONAL'],
      points: result.scope.availableRagPoints || [],
    });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || 'Failed to resolve RAG Points',
    });
  }
});

/*
 * Self-service diagnostic/runtime endpoint.
 *
 * Enforcement callers inside the main API should call resolveKnowledgeScope()
 * directly rather than making an HTTP round trip.
 */
router.get('/scope', async (req, res) => {
  try {
    const userId = String(
      req.user?.id ??
      req.user?._id ??
      '',
    ).trim();

    const tenantId = String(
      req.user?.tenantId ??
      '',
    ).trim();

    const agentId = String(
      req.query.agentId ??
      '',
    ).trim();

    const activeGroupId = String(
      req.query.activeGroupId ??
      '',
    ).trim() || null;

    if (!tenantId) {
      return res.status(403).json({
        error: 'Institution context is required',
      });
    }

    if (!userId) {
      return res.status(401).json({
        error: 'Authenticated user context is required',
      });
    }

    const result = await resolveKnowledgeScope({
      tenantId,
      userId,
      role: req.user?.role,
      agentId,
      activeGroupId,
    });

    /*
     * Authorization diagnostics should reflect the user's current hierarchy.
     * Do not let browsers or intermediaries retain a stale authorization view.
     * Actual retrieval is independently protected by server-signed scope keys.
     */
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie, Authorization');

    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      error:
        error?.message ||
        'Failed to resolve knowledge scope',
    });
  }
});

module.exports = router;
