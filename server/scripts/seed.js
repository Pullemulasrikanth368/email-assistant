/**
 * Seed script — inserts roles, users, and default settings.
 *
 * Run from the server/ directory:
 *   node scripts/seed.js              ← full seed
 *   node scripts/seed.js --fresh      ← wipe collections first, then seed
 *
 * Safe to re-run without --fresh: skips any record that already exists.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── MongoDB connection ────────────────────────────────────────────────────────
const env = process.env.ENVIRONMENT || 'local';
const MONGO_URI =
  // process.env[`${env.toUpperCase()}_MONGO_HOST`] ||
  // process.env.MONGO_URI ||
  'mongodb://localhost:27017/executive_email_assistant_dev';

const FRESH = process.argv.includes('--fresh');

// ── Inline schemas (no Babel/ESM needed) ─────────────────────────────────────

const RoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, default: 'Admin' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SettingsSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: true },
    companyName: { type: String, default: '' },
    adminEmail: { type: String, default: '' },
    sendGridApiKey: { type: String, default: '' },
    sendGridEmail: { type: String, default: '' },
    aiType: { type: String, default: 'openai' },
    emailAnalysisBriefTime: { type: String, default: '08:00' },
    emailAnalysisIncludeSpam: { type: Boolean, default: false },
    emailAnalysisModel: { type: String, default: 'gpt-4o' },
  },
  { timestamps: true }
);

const Role = mongoose.model('Role', RoleSchema, 'roles');
const Employee = mongoose.model('Employee', EmployeeSchema, 'employees');
const Settings = mongoose.model('Settings', SettingsSchema, 'settings');

// ── Seed data ─────────────────────────────────────────────────────────────────

const ROLES = [
  { name: 'Admin', description: 'Full access — manage users, roles, settings, and all email features' },
  { name: 'Manager', description: 'Can view reports, send bulk email, and manage inbox triage' },
  { name: 'Viewer', description: 'Read-only access to reports and daily briefs' },
];

const USERS = [
  { name: 'Admin', email: 'admin@amneal.com', password: 'Admin@123', role: 'Admin' },
  { name: 'Sarah Johnson', email: 'sarah@amneal.com', password: 'Manager@123', role: 'Manager' },
  { name: 'David Chen', email: 'david@amneal.com', password: 'Manager@123', role: 'Manager' },
  { name: 'Priya Patel', email: 'priya@amneal.com', password: 'Viewer@123', role: 'Viewer' },
  { name: 'Tom Williams', email: 'tom@amneal.com', password: 'Viewer@123', role: 'Viewer' },
];

const SETTINGS = {
  active: true,
  companyName: 'Amneal Pharmaceuticals',
  adminEmail: 'admin@amneal.com',
  aiType: 'openai',
  emailAnalysisBriefTime: '08:00',
  emailAnalysisIncludeSpam: false,
  emailAnalysisModel: 'gpt-4o',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const hash = async (plain) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
};

const col = (label, value) =>
  console.log(`  ${label.padEnd(14)}: ${value}`);

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`\n🔌  Connecting to: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('✅  Connected.\n');

  if (FRESH) {
    await Promise.all([Role.deleteMany({}), Employee.deleteMany({}), Settings.deleteMany({})]);
    console.log('🗑️   Collections wiped (--fresh).\n');
  }

  // ── Roles ──────────────────────────────────────────────────────────────────
  console.log('── Seeding roles ────────────────────────────────────────────');
  for (const r of ROLES) {
    const exists = await Role.findOne({ name: r.name });
    if (exists) {
      console.log(`  [SKIP] Role "${r.name}" already exists`);
    } else {
      await Role.create({ ...r, active: true });
      console.log(`  [OK]   Role "${r.name}" created`);
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('\n── Seeding users ────────────────────────────────────────────');
  const created = [];
  for (const u of USERS) {
    const exists = await Employee.findOne({ email: u.email.toLowerCase() });
    if (exists) {
      console.log(`  [SKIP] ${u.email} already exists`);
    } else {
      const hashed = await hash(u.password);
      const emp = await Employee.create({
        name: u.name,
        email: u.email.toLowerCase(),
        password: hashed,
        role: u.role,
        active: true,
      });
      created.push({ ...u, _id: emp._id });
      console.log(`  [OK]   ${u.email}  (${u.role})`);
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  console.log('\n── Seeding settings ─────────────────────────────────────────');
  const existingSettings = await Settings.findOne({ active: true });
  if (existingSettings) {
    console.log('  [SKIP] Settings document already exists');
  } else {
    await Settings.create(SETTINGS);
    console.log('  [OK]   Default settings created');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  if (created.length > 0) {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                   SEEDED CREDENTIALS                    ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    for (const u of created) {
      console.log(`║  ${u.role.padEnd(9)}  ${u.email.padEnd(24)}  ${u.password.padEnd(14)} ║`);
    }
    console.log('╚══════════════════════════════════════════════════════════╝\n');
  } else {
    console.log('\n  Nothing new was created (all records already exist).');
    console.log('  Run with --fresh to wipe and re-seed.\n');
  }

  await mongoose.disconnect();
  console.log('🔌  Disconnected. Done.\n');
}

seed().catch((err) => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});
