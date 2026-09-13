const { logger } = require('@librechat/data-schemas');
const { ErrorTypes } = require('librechat-data-provider');
const { isEnabled, isEmailDomainAllowed, resolveAppConfigForUser } = require('@librechat/api');
const { createSocialUser, handleExistingUser } = require('./process');
const { getAppConfig } = require('~/server/services/Config');
const { findUser, updateUser, getInstitutionById } = require('~/models');

const socialLogin =
  (provider, getProfileDetails, options = {}) =>
  async (accessToken, refreshToken, idToken, profile, cb) => {
    try {
      const { email, id, avatarUrl, username, name, emailVerified } = getProfileDetails({
        idToken,
        profile,
      });

      const baseConfig = await getAppConfig({ baseOnly: true });
      if (!isEmailDomainAllowed(email, baseConfig?.registration?.allowedDomains)) {
        logger.error(
          `[${provider}Login] Authentication blocked - email domain not allowed [Email: ${email}]`,
        );
        const error = new Error(ErrorTypes.AUTH_FAILED);
        error.code = ErrorTypes.AUTH_FAILED;
        error.message = 'Email domain not allowed';
        return cb(error);
      }

      const providerKey = `${provider}Id`;
      let existingUser = null;

      /** First try to find user by provider ID (e.g., googleId, facebookId) */
      if (id && typeof id === 'string') {
        existingUser = await findUser({ [providerKey]: id });
      }

      /** If not found by provider ID, try finding by email */
      if (!existingUser) {
        existingUser = await findUser({ email: email?.trim() });
        if (existingUser) {
          logger.warn(`[${provider}Login] User found by email: ${email} but not by ${providerKey}`);
        }
      }

      const appConfig = existingUser?.tenantId
        ? await resolveAppConfigForUser(getAppConfig, existingUser)
        : baseConfig;

      /*
       * Institution SSO is determined exclusively by explicit institution
       * configuration. Email-domain appearance never enables SSO.
       *
       * No tenantId:
       *   platform-scoped account; institutional SSO policy does not apply.
       *
       * Tenant user:
       *   provider login is permitted only when this institution explicitly
       *   enables that provider through SSO_OPTIONAL or SSO_REQUIRED.
       */
      let institutionAuthPolicy = null;

      if (existingUser?.tenantId) {
        const institution = await getInstitutionById(String(existingUser.tenantId));

        if (!institution || institution.status === 'disabled') {
          logger.warn(
            `[${provider}Login] Authentication blocked - institution unavailable`,
          );
          const institutionError = new Error(ErrorTypes.AUTH_FAILED);
          institutionError.code = ErrorTypes.AUTH_FAILED;
          institutionError.message = 'Institution access unavailable';
          return cb(institutionError);
        }

        institutionAuthPolicy = institution.authPolicy ?? {
          mode: 'LOCAL',
          provider: null,
          provisioning: 'PREPROVISIONED_ONLY',
        };

        const mode = institutionAuthPolicy.mode ?? 'LOCAL';

        const configuredProvider =
          institutionAuthPolicy.provider === 'GOOGLE'
            ? 'google'
            : institutionAuthPolicy.provider === 'MICROSOFT_ENTRA'
              ? 'openid'
              : null;

        const ssoEnabled =
          mode === 'SSO_OPTIONAL' ||
          mode === 'SSO_REQUIRED';

        if (
          options.enforceInstitutionSsoPolicy === true &&
          (!ssoEnabled || configuredProvider !== provider)
        ) {
          logger.warn(
            `[${provider}Login] Authentication blocked - provider not enabled for tenant`,
          );

          const policyError = new Error(ErrorTypes.AUTH_FAILED);
          policyError.code = ErrorTypes.AUTH_FAILED;
          policyError.message = 'SSO provider is not enabled for this institution';
          return cb(policyError);
        }
      }

      if (!isEmailDomainAllowed(email, appConfig?.registration?.allowedDomains)) {
        logger.error(
          `[${provider}Login] Authentication blocked - email domain not allowed [Email: ${email}]`,
        );
        const error = new Error(ErrorTypes.AUTH_FAILED);
        error.code = ErrorTypes.AUTH_FAILED;
        error.message = 'Email domain not allowed';
        return cb(error);
      }

      const passResult = (user) =>
        refreshToken && provider === 'google' ? cb(null, user, { refreshToken }) : cb(null, user);

      if (existingUser?.provider === provider) {
        if (
          options.existingUsersOnly &&
          id &&
          existingUser[providerKey] &&
          existingUser[providerKey] !== id
        ) {
          logger.warn(
            `[${provider}Login] Rejected admin email fallback for ${email}: stored ${providerKey} does not match`,
          );
          const error = new Error(ErrorTypes.AUTH_FAILED);
          error.code = ErrorTypes.AUTH_FAILED;
          return cb(error);
        }
        if (options.existingUsersOnly && id && !existingUser[providerKey]) {
          if (existingUser.tenantId) {
            logger.warn(
              `[${provider}Login] Admin migrate blocked for tenanted user ${email}: no tenant scope in OAuth callback`,
            );
            const tenantError = new Error(ErrorTypes.AUTH_FAILED);
            tenantError.code = ErrorTypes.AUTH_FAILED;
            return cb(tenantError);
          }
          await updateUser(existingUser._id, { [providerKey]: id });
          const verified = await findUser({ _id: existingUser._id, [providerKey]: id });
          if (!verified) {
            logger.warn(
              `[${provider}Login] Admin migrate superseded by concurrent write, denying: ${email}`,
            );
            const concurrentError = new Error(ErrorTypes.AUTH_FAILED);
            concurrentError.code = ErrorTypes.AUTH_FAILED;
            return cb(concurrentError);
          }
          existingUser[providerKey] = id;
        }
        await handleExistingUser(existingUser, avatarUrl, appConfig, email);
        return passResult(existingUser);
      } else if (existingUser) {
        /*
         * AI Scholar Hub pre-provisioned institutional SSO linking.
         *
         * This path NEVER creates an account. It only permits a verified
         * external identity to be attached to an already-provisioned,
         * tenant-scoped AIH account when the caller explicitly enables
         * allowPreprovisionedLink.
         *
         * Platform/admin OAuth deliberately does not enable this option.
         */
        if (
          options.existingUsersOnly &&
          options.allowPreprovisionedLink === true &&
          options.enforceInstitutionSsoPolicy === true &&
          existingUser.tenantId &&
          institutionAuthPolicy &&
          (
            institutionAuthPolicy.mode === 'SSO_OPTIONAL' ||
            institutionAuthPolicy.mode === 'SSO_REQUIRED'
          ) &&
          institutionAuthPolicy.provider === 'GOOGLE' &&
          emailVerified === true &&
          id &&
          typeof id === 'string'
        ) {
          const providerUpdate = {
            provider,
            [providerKey]: id,
            emailVerified: true,
          };

          await updateUser(existingUser._id, providerUpdate);

          const linkedUser = await findUser({
            _id: existingUser._id,
            [providerKey]: id,
          });

          if (!linkedUser) {
            logger.warn(
              `[${provider}Login] Pre-provisioned identity link failed for ${email}`,
            );
            const linkError = new Error(ErrorTypes.AUTH_FAILED);
            linkError.code = ErrorTypes.AUTH_FAILED;
            return cb(linkError);
          }

          await handleExistingUser(linkedUser, avatarUrl, appConfig, email);

          logger.info(
            `[${provider}Login] Linked verified identity to pre-provisioned tenant account`,
          );

          return passResult(linkedUser);
        }

        logger.info(
          `[${provider}Login] User ${email} already exists with provider ${existingUser.provider}`,
        );
        const error = new Error(ErrorTypes.AUTH_FAILED);
        error.code = ErrorTypes.AUTH_FAILED;
        error.provider = existingUser.provider;
        return cb(error);
      }

      if (options.existingUsersOnly) {
        logger.error(
          `[${provider}Login] Admin auth blocked - user does not exist [Email: ${email}]`,
        );
        return cb(null, false, { message: 'User does not exist' });
      }

      const ALLOW_SOCIAL_REGISTRATION = isEnabled(process.env.ALLOW_SOCIAL_REGISTRATION);
      if (!ALLOW_SOCIAL_REGISTRATION) {
        logger.error(
          `[${provider}Login] Registration blocked - social registration is disabled [Email: ${email}]`,
        );
        const error = new Error(ErrorTypes.AUTH_FAILED);
        error.code = ErrorTypes.AUTH_FAILED;
        error.message = 'Social registration is disabled';
        return cb(error);
      }

      const newUser = await createSocialUser({
        email,
        avatarUrl,
        provider,
        providerKey: `${provider}Id`,
        providerId: id,
        username,
        name,
        emailVerified,
        appConfig,
      });
      return passResult(newUser);
    } catch (err) {
      logger.error(`[${provider}Login]`, err);
      return cb(err);
    }
  };

module.exports = socialLogin;
