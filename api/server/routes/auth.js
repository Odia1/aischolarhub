const express = require('express');
const { createSetBalanceConfig, forceRefreshCloudFrontAuthCookies } = require('@librechat/api');
const {
  resetPasswordRequestController,
  resetPasswordController,
  registrationController,
  graphTokenController,
  refreshController,
} = require('~/server/controllers/AuthController');
const {
  regenerateBackupCodes,
  disable2FA,
  confirm2FA,
  enable2FA,
  verify2FA,
} = require('~/server/controllers/TwoFactorController');
const { verify2FAWithTempToken } = require('~/server/controllers/auth/TwoFactorAuthController');
const { logoutController } = require('~/server/controllers/auth/LogoutController');
const { loginController } = require('~/server/controllers/auth/LoginController');
const {
  findBalanceByUser,
  upsertBalanceFields,
  findUser,
  getInstitutionById,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();
const getCloudFrontAuthCookieRefreshResult = (req, res) => {
  const warmedResult = req.cloudFrontAuthCookieRefreshResult;
  if (warmedResult && (warmedResult.attempted || !warmedResult.enabled)) {
    return warmedResult;
  }

  return forceRefreshCloudFrontAuthCookies(req, res, req.user);
};

const ldapAuth = !!process.env.LDAP_URL && !!process.env.LDAP_USER_SEARCH_BASE;
//Local

/*
 * Pre-login UX policy lookup.
 *
 * This endpoint intentionally exposes only authentication capabilities.
 * It never returns tenant, role, user id, institution name, or an
 * account-existence flag.
 */
router.post('/login-policy', middleware.loginPolicyLimiter, async (req, res) => {
  const genericLocal = {
    passwordAllowed: true,
    passwordResetAllowed: true,
    ssoRequired: false,
    provider: null,
  };

  try {
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

    if (!email || email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json(genericLocal);
    }

    const user = await findUser({ email }, 'tenantId');

    /*
     * Unknown users and platform-scoped users receive the same LOCAL-capable
     * response. Domain appearance alone never determines authorization.
     */
    if (!user?.tenantId) {
      return res.json(genericLocal);
    }

    const institution = await getInstitutionById(String(user.tenantId));

    /*
     * Fail closed for tenant accounts whose institution is unavailable.
     * Do not disclose why access is unavailable.
     */
    if (!institution || institution.status === 'disabled') {
      return res.json({
        passwordAllowed: false,
        passwordResetAllowed: false,
        ssoRequired: false,
        provider: null,
      });
    }

    const mode = institution.authPolicy?.mode ?? 'LOCAL';
    const provider = institution.authPolicy?.provider ?? null;

    if (mode === 'SSO_REQUIRED') {
      return res.json({
        passwordAllowed: false,
        passwordResetAllowed: false,
        ssoRequired: true,
        provider,
      });
    }

    return res.json({
      passwordAllowed: true,
      passwordResetAllowed: true,
      ssoRequired: false,
      provider: mode === 'SSO_OPTIONAL' ? provider : null,
    });
  } catch (error) {
    /*
     * UX discovery must never weaken authentication. A lookup failure falls
     * back to the normal login form; authoritative login middleware still
     * rejects local authentication when institution policy requires SSO.
     */
    return res.json(genericLocal);
  }
});

router.post('/logout', middleware.requireJwtAuth, logoutController);
router.post(
  '/login',
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  middleware.validateEmailLogin,
  ldapAuth ? middleware.requireLdapAuth : middleware.requireLocalAuth,
  middleware.enforceInstitutionLocalAuth,
  setBalanceConfig,
  loginController,
);
router.post('/refresh', refreshController);
router.post('/cloudfront/refresh', middleware.requireJwtAuth, (req, res) => {
  const result = getCloudFrontAuthCookieRefreshResult(req, res);
  if (!result.enabled) {
    return res.sendStatus(404);
  }

  const status = result.refreshed ? 200 : 500;
  return res.status(status).json({
    ok: result.refreshed,
    expiresInSec: result.expiresInSec,
    refreshAfterSec: result.refreshAfterSec,
  });
});
router.post(
  '/register',
  middleware.registerLimiter,
  middleware.checkBan,
  middleware.checkInviteUser,
  middleware.validateRegistration,
  registrationController,
);
router.post(
  '/requestPasswordReset',
  middleware.resetPasswordLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordRequestController,
);
router.post(
  '/resetPassword',
  middleware.resetPasswordSubmissionLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordController,
);

router.post('/2fa/enable', middleware.requireJwtAuth, enable2FA);
router.post('/2fa/verify', middleware.requireJwtAuth, verify2FA);
router.post(
  '/2fa/verify-temp',
  middleware.setTwoFactorTempUser,
  middleware.twoFactorTempLimiter,
  middleware.checkBan,
  verify2FAWithTempToken,
);
router.post('/2fa/confirm', middleware.requireJwtAuth, confirm2FA);
router.post('/2fa/disable', middleware.requireJwtAuth, disable2FA);
router.post('/2fa/backup/regenerate', middleware.requireJwtAuth, regenerateBackupCodes);

router.get('/graph-token', middleware.requireJwtAuth, graphTokenController);

module.exports = router;
