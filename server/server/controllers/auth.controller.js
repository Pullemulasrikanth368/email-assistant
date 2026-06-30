import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import Employee from '../models/employee.model';
import Settings from '../models/settings.model';
import APIError from '../helpers/APIError';

const JWTSECRET = process.env.JWTSECRET || process.env.JWT_SECRET || "0a6b944d-d2fb-46fc-a85e-0295c986cd9f";
const JWT_EXPIRES_IN = '24h';

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { respCode, accessToken, email, name, role }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(httpStatus.BAD_REQUEST).json({
        errorCode: 400,
        errorMessage: 'Email and password are required',
      });
    }

    let employee;
    try {
      employee = await Employee.getByEmail(email);
    } catch (err) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        errorCode: 401,
        errorMessage: 'Invalid email or password',
      });
    }

    const isMatch = await employee.comparePassword(password);
    if (!isMatch) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        errorCode: 401,
        errorMessage: 'Invalid email or password',
      });
    }

    const payload = {
      _id: employee._id,
      email: employee.email,
      name: employee.name,
      role: employee.role,
    };

    const accessToken = jwt.sign(payload, JWTSECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      respCode: 200,
      accessToken,
      email: employee.email,
      name: employee.name,
      role: employee.role,
      _id: employee._id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 * Creates a new employee account and returns a JWT so the user is signed in immediately.
 */
async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(httpStatus.BAD_REQUEST).json({
        errorCode: 400,
        errorMessage: 'Name, email and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(httpStatus.BAD_REQUEST).json({
        errorCode: 400,
        errorMessage: 'Password must be at least 8 characters',
      });
    }

    const existing = await Employee.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(httpStatus.CONFLICT).json({
        errorCode: 409,
        errorMessage: 'An account with this email already exists',
      });
    }

    const employee = await Employee.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    });

    const payload = {
      _id: employee._id,
      email: employee.email,
      name: employee.name,
      role: employee.role,
    };

    const accessToken = jwt.sign(payload, JWTSECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(httpStatus.CREATED).json({
      respCode: 201,
      accessToken,
      email: employee.email,
      name: employee.name,
      role: employee.role,
      _id: employee._id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Client is responsible for clearing the token from localStorage.
 */
async function logout(req, res) {
  return res.json({ respCode: 200, message: 'Logged out successfully' });
}

/**
 * GET /api/auth/me
 * Returns the current user's info from the JWT token.
 * The authenticate middleware decodes the token into req.tokenInfo.
 */
async function me(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      errorCode: 401,
      errorMessage: 'No token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, JWTSECRET);
    return res.json({ respCode: 200, details: decoded });
  } catch (err) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      errorCode: 401,
      errorMessage: 'Invalid or expired token',
    });
  }
}

export default { login, register, logout, me };
