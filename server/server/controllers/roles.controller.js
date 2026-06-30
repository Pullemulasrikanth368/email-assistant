import httpStatus from 'http-status';
import Role from '../models/role.model';
import Employee from '../models/employee.model';

/** GET /api/roles — list all active roles with user counts */
async function list(req, res, next) {
  try {
    const roles = await Role.find({ active: true }).sort({ createdAt: -1 }).lean();

    // Attach user count per role
    const counts = await Employee.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    const result = roles.map((r) => ({ ...r, userCount: countMap[r.name] || 0 }));
    return res.json({ respCode: 200, roles: result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/roles — create a new role */
async function create(req, res, next) {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(httpStatus.BAD_REQUEST).json({ errorCode: 400, errorMessage: 'Role name is required' });
    }
    const existing = await Role.findOne({ name: name.trim() });
    if (existing) {
      return res.status(httpStatus.CONFLICT).json({ errorCode: 409, errorMessage: 'Role already exists' });
    }
    const role = await Role.create({ name: name.trim(), description: description || '' });
    return res.status(httpStatus.CREATED).json({ respCode: 201, role });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/roles/:id — update name / description */
async function update(req, res, next) {
  try {
    const { name, description } = req.body;
    const role = await Role.findByIdAndUpdate(
      req.params.id,
      { ...(name && { name: name.trim() }), ...(description !== undefined && { description }) },
      { new: true }
    );
    if (!role) {
      return res.status(httpStatus.NOT_FOUND).json({ errorCode: 404, errorMessage: 'Role not found' });
    }
    return res.json({ respCode: 205, role });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/roles/:id — soft-delete */
async function remove(req, res, next) {
  try {
    const role = await Role.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!role) {
      return res.status(httpStatus.NOT_FOUND).json({ errorCode: 404, errorMessage: 'Role not found' });
    }
    return res.json({ respCode: 206, message: 'Role deleted' });
  } catch (err) {
    next(err);
  }
}

export default { list, create, update, remove };
