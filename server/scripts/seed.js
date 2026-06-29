/**
 * Seed script — creates the initial admin employee.
 * Run once from the server/ directory:
 *   node scripts/seed.js
 *   node scripts/seed.js --email admin@example.com --password Secret123 --name "Admin User"
 *
 * Safe to re-run: skips creation if the email already exists.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const get = (flag) => {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : null;
};

const ADMIN_NAME     = get('--name')     || 'Admin';
const ADMIN_EMAIL    = get('--email')    || 'admin@example.com';
const ADMIN_PASSWORD = get('--password') || 'Admin@123';

// ── MongoDB connection ────────────────────────────────────────────────────────
const env = process.env.ENVIRONMENT || 'local';
const MONGO_URI =
  process.env[`${env.toUpperCase()}_MONGO_HOST`] ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/executive_email_assistant';

// ── Inline schema (avoids Babel/ESM dependency) ───────────────────────────────
const EmployeeSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role:     { type: String, default: 'Admin' },
    active:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Employee = mongoose.model('Employee', EmployeeSchema, 'employees');

async function seed() {
  console.log(`\nConnecting to: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected.\n');

  const exists = await Employee.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (exists) {
    console.log(`Employee "${ADMIN_EMAIL}" already exists — skipping creation.`);
    console.log(`Role: ${exists.role} | Active: ${exists.active}`);
    await mongoose.disconnect();
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

  const emp = await Employee.create({
    name:     ADMIN_NAME,
    email:    ADMIN_EMAIL.toLowerCase(),
    password: hashedPassword,
    role:     'Admin',
    active:   true,
  });

  console.log('Admin employee created successfully!');
  console.log('─────────────────────────────────────');
  console.log(`  Name    : ${emp.name}`);
  console.log(`  Email   : ${emp.email}`);
  console.log(`  Password: ${ADMIN_PASSWORD}  (plain — save this)`);
  console.log(`  Role    : ${emp.role}`);
  console.log(`  ID      : ${emp._id}`);
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
