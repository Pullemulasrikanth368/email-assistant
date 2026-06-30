import mongoose from 'mongoose';

const RoleSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  active:      { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('Role', RoleSchema, 'roles');
