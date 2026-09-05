const { logger } = require('@librechat/data-schemas');
const { getAppConfigOptionsFromUser } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

const configMiddleware = async (req, res, next) => {
  try {
    req.config = await getAppConfig(getAppConfigOptionsFromUser(req.user));

    next();
  } catch (error) {
    logger.error('Config middleware error:', {
      error: error.message,
      userRole: req.user?.role,
      path: req.path,
    });

    logger.error(
      'Principal-scoped config resolution failed; refusing unscoped fallback'
    );
    next(error);
  }
};

module.exports = configMiddleware;
