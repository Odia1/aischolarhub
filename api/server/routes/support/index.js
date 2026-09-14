const express = require('express');
const { getInstitutionById } = require('~/models');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();

const SUPPORT_NAME = 'AIH Support';

const ROLE_LABELS = new Map([
  ['USER', 'User'],
  ['User', 'User'],
  ['INSTRUCTOR', 'Instructor'],
  ['Instructor', 'Instructor'],
  ['INSTITUTION_ADMIN', 'Institution Admin'],
  ['Institution Admin', 'Institution Admin'],
  ['PLATFORM_ADMIN', 'Platform Admin'],
  ['Platform Admin', 'Platform Admin'],
  ['SUPERADMIN', 'Superadmin'],
  ['Superadmin', 'Superadmin'],
]);

/**
 * AIH Support is an authenticated, non-privileged platform capability.
 *
 * Security boundary:
 * - authenticated AIH users only
 * - read-only
 * - no Academic Agent runtime
 * - no arbitrary RAG or file access
 * - no source, secrets, logs, infrastructure, shell, admin mutation,
 *   credentials, deployment topology, or hidden diagnostics
 * - only explicitly approved user-facing support context may leave this route
 */
router.use(requireJwtAuth);

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const safeRoleLabel = (role) => {
  const value = typeof role === 'string' ? role.trim() : '';
  return ROLE_LABELS.get(value) ?? 'User';
};

const resolveInstitutionName = async (user) => {
  const tenantId = user?.tenantId?.toString?.();

  if (!tenantId) {
    return null;
  }

  try {
    const institution = await getInstitutionById(tenantId);

    if (!institution || institution.status === 'disabled') {
      return null;
    }

    const name = typeof institution.name === 'string' ? institution.name.trim() : '';
    return name || null;
  } catch (_err) {
    /*
     * Fail closed. AIH Support must not expose lookup errors,
     * identifiers, database information, or diagnostic details.
     */
    return null;
  }
};

router.get('/context', async (req, res) => {
  const institution = await resolveInstitutionName(req.user);

  return res.status(200).json({
    authenticated: true,
    supportName: SUPPORT_NAME,
    role: safeRoleLabel(req.user?.role),
    institution,
    capabilities: {
      readOnly: true,
      supportDocumentation: true,
      escalationSummary: true,
    },
  });
});

module.exports = router;
