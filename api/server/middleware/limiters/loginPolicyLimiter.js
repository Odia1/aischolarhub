const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

const windowMs = 5 * 60 * 1000;
const max = 30;

const loginPolicyLimiter = rateLimit({
  windowMs,
  max,
  keyGenerator: removePorts,
  store: limiterCache('login_policy_limiter'),
  handler: (req, res) =>
    res.status(429).json({
      message: 'Too many sign-in policy checks. Please try again later.',
    }),
});

module.exports = loginPolicyLimiter;
