import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import httpStatus from 'http-status';
import APIError from '../helpers/APIError';

const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  salt: { type: String },
  entityType: { type: String },
  role: { type: String, default: 'Admin' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

// Hash password before saving
EmployeeSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

EmployeeSchema.methods.comparePassword = function (candidatePassword) {
  if (this.salt) {
    const hashedPassword = crypto
      .pbkdf2Sync(candidatePassword, Buffer.from(this.salt, 'base64'), 10000, 64, 'sha1')
      .toString('base64');

    const storedPassword = Buffer.from(this.password, 'base64');
    const candidateHash = Buffer.from(hashedPassword, 'base64');

    return storedPassword.length === candidateHash.length
      && crypto.timingSafeEqual(storedPassword, candidateHash);
  }

  return bcrypt.compare(candidatePassword, this.password);
};

EmployeeSchema.statics = {
  async getByEmail(email) {
    const employee = await this.findOne({ email: email.toLowerCase(), active: true });
    if (!employee) {
      throw new APIError('Employee not found', httpStatus.NOT_FOUND);
    }
    return employee;
  },

  async get(id) {
    const employee = await this.findById(id);
    if (!employee) {
      throw new APIError('Employee not found', httpStatus.NOT_FOUND);
    }
    return employee;
  },
};

export default mongoose.model('Employee', EmployeeSchema, 'employees');
