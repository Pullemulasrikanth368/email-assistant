/**
 * Simplified authentication middleware for the Executive Email Assistant.
 *
 * The email-analysis feature does not require role-based access control or
 * complex OAuth2 token lifecycle management. This middleware simply validates
 * the Bearer JWT token from the Authorization header using jsonwebtoken.
 *
 * Token format expected: Bearer <jwt>
 * JWT payload shape expected: { _id, email, role } (standard admin JWT)
 */

const jwt = require('jsonwebtoken');
const JWTSECRET = process.env.JWTSECRET || process.env.JWT_SECRET || "0a6b944d-d2fb-46fc-a85e-0295c986cd9f";

function getBearerToken(headers) {
  if (headers && headers.authorization) {
    const parts = headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }
  return null;
}

/**
 * Main authentication middleware.
 * Sets req.tokenInfo to the decoded JWT payload.
 */
async function isAllowed(req, res, next) {
  const token = getBearerToken(req.headers) || (req.query && req.query.token);

  if (!token) {
    return res.json({ errorCode: 9001, errorMessage: 'Token not provided' });
  }

  try {
    const decoded = jwt.verify(token, JWTSECRET);
    req.tokenInfo = decoded;
    return next();
  } catch (err) {
    return res.json({ errorCode: 9001, errorMessage: 'Session expired or invalid token' });
  }
}

/**
 * Stub for oauthToken — not used in this standalone project but kept for
 * compatibility if any route file references it.
 */
function oauthToken(req, res, next) {
  return next();
}

/**
 * Stub for authenticate — not used in this standalone project.
 */
function authenticate(options = {}) {
  return function (req, res, next) {
    return next();
  };
}

/**
 * Stub for jwtverification — alias of isAllowed here.
 */
const jwtverification = isAllowed;

/**
 * Stub for cookieAuthMiddleware — not used in this standalone project.
 */
async function cookieAuthMiddleware(req, res, next) {
  return next();
}

export default {
  isAllowed,
  oauthToken,
  authenticate,
  jwtverification,
  cookieAuthMiddleware
};
