const { logger } = require('@librechat/data-schemas');
const { getInstitutionById } = require('~/models');

/**
 * AI Scholar Hub institution authentication policy.
 *
 * This middleware runs AFTER local authentication has established req.user.
 *
 * Platform-scoped accounts:
 *   user.tenantId absent/null
 *     -> local authentication is permitted.
 *
 * Institution-scoped accounts:
 *   LOCAL
 *     -> local authentication permitted.
 *
 *   SSO_OPTIONAL
 *     -> local authentication permitted.
 *
 *   SSO_REQUIRED
 *     -> local authentication denied. The configured institutional
 *        identity provider must be used.
 *
 * Email domains are never used here as an authorization boundary.
 * The user must already exist in AIH before reaching this middleware.
 */
const enforceInstitutionLocalAuth = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        message: 'Authentication required',
      });
    }

    /*
     * Tenant-neutral accounts are platform-scoped accounts.
     * Their direct login remains available unless a future platform-wide
     * authentication policy explicitly changes that behavior.
     */
    if (!user.tenantId) {
      return next();
    }

    const tenantId = String(user.tenantId);
    const institution = await getInstitutionById(tenantId);

    /*
     * A tenant-bound account must not authenticate against a missing
     * or disabled institution.
     */
    if (!institution || institution.status === 'disabled') {
      logger.warn(
        `[institution-auth] Local login denied for unavailable institution ${tenantId}`,
      );

      return res.status(403).json({
        message: 'Institution access is not available',
        error_code: 'INSTITUTION_ACCESS_UNAVAILABLE',
      });
    }

    const mode = institution.authPolicy?.mode ?? 'LOCAL';

    if (mode !== 'SSO_REQUIRED') {
      return next();
    }

    const provider = institution.authPolicy?.provider ?? null;

    logger.info(
      `[institution-auth] Local login denied by SSO_REQUIRED policy for tenant ${tenantId}`,
    );

    return res.status(403).json({
      message:
        provider === 'GOOGLE'
          ? 'Your institution requires Google sign-in'
          : provider === 'MICROSOFT_ENTRA'
            ? 'Your institution requires Microsoft sign-in'
            : 'Your institution requires single sign-on',
      error_code: 'INSTITUTION_SSO_REQUIRED',
      provider,
    });
  } catch (err) {
    logger.error('[institution-auth] Failed to evaluate local authentication policy:', err);

    /*
     * Authentication policy evaluation must fail closed for tenant users.
     */
    return res.status(503).json({
      message: 'Unable to verify institution authentication policy',
      error_code: 'INSTITUTION_AUTH_POLICY_UNAVAILABLE',
    });
  }
};

module.exports = enforceInstitutionLocalAuth;
