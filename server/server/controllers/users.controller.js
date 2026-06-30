import httpStatus from 'http-status';
import Employee from '../models/employee.model';

/** GET /api/users — list all employees */
async function list(req, res, next) {
  try {
    const users = await Employee.find({}, '-password -salt').sort({ createdAt: -1 }).lean();
    return res.json({ respCode: 200, users });
  } catch (err) {
    next(err);
  }
}

/** POST /api/users — create a new employee */
async function create(req, res, next) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(httpStatus.BAD_REQUEST).json({
        errorCode: 400,
        errorMessage: 'Name, email and password are required',
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
      role: role || 'Admin',
    });

    const { password: _, salt: __, ...safe } = employee.toObject();
    return res.status(httpStatus.CREATED).json({ respCode: 201, user: safe });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/users/:id — update name, email, role, active */
async function update(req, res, next) {
  try {
    const { name, email, role, active, password } = req.body;
    const update = {};
    if (name  !== undefined) update.name   = name.trim();
    if (email !== undefined) update.email  = email.toLowerCase().trim();
    if (role  !== undefined) update.role   = role;
    if (active !== undefined) update.active = active;

    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(httpStatus.NOT_FOUND).json({ errorCode: 404, errorMessage: 'User not found' });
    }

    Object.assign(employee, update);

    // Only hash if a new password was provided
    if (password && password.length >= 8) {
      employee.password = password;
    }

    await employee.save();

    const { password: _, salt: __, ...safe } = employee.toObject();
    return res.json({ respCode: 205, user: safe });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/users/:id — soft-delete (active: false) */
async function remove(req, res, next) {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );
    if (!employee) {
      return res.status(httpStatus.NOT_FOUND).json({ errorCode: 404, errorMessage: 'User not found' });
    }
    return res.json({ respCode: 206, message: 'User deleted' });
  } catch (err) {
    next(err);
  }
}

export default { list, create, update, remove };
