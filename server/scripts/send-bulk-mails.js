/**
 * send-bulk-mails.js
 *
 * Reads mails from a JSON file and sends each one FROM the connected Outlook
 * account named in its "from" field (must exist in the `outlook_users`
 * collection with a valid refresh token).
 *
 * Usage:
 *   node scripts/send-bulk-mails.js <path-to-mails.json> --to recipient@example.com
 *
 * JSON file format — array of mails:
 *   [
 *     {
 *       "from": "sandeepdosystems@outlook.com",   // sender account (required)
 *       "subject": "Batch Deviation Report",
 *       "body": "Hi team, ...",                    // plain text (or use "html")
 *       "to": "override@example.com"               // optional, overrides --to
 *     }
 *   ]
 *
 * Per-mail fields: from (required), subject, body/text (plain) or html,
 * to, cc, bcc (string or array). Recipient per mail: mail.to → --to flag.
 *
 * Dynamic date placeholders — usable anywhere in subject/body/html, resolved
 * against the current date at send time so the JSON never goes stale:
 *   {{today}}      → "Friday, Jul 11"
 *   {{tomorrow}}   → "Saturday, Jul 12"
 *   {{+3d}}        → date 3 days from now (any number works)
 *   {{monday}} ... {{sunday}} → next upcoming occurrence of that weekday
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('@babel/register')({
  presets: ['@babel/preset-env'],
});

const mongoose = require('mongoose');

const MONGO_URI = process.env.LOCAL_MONGO_HOST || 'mongodb://localhost:27017/executive_email_assistant';

// Delay between sends so Outlook doesn't flag the accounts for spam/abuse.
const SEND_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs() {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
  };
  const fallbackTo = flagValue('--to');
  const fromFilter = flagValue('--from'); // only send mails whose "from" matches
  const flagValueIdxs = ['--to', '--from']
    .map((f) => args.indexOf(f))
    .filter((i) => i !== -1)
    .map((i) => i + 1);
  const jsonPath = args.find((a, i) => !a.startsWith('--') && !flagValueIdxs.includes(i));
  return { jsonPath, fallbackTo, fromFilter };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** Replace {{today}}, {{tomorrow}}, {{+Nd}}, {{monday}}..{{sunday}} with real dates. */
function resolvePlaceholders(str = '') {
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, token) => {
    const t = token.toLowerCase();
    if (t === 'today') return formatDate(daysFromNow(0));
    if (t === 'tomorrow') return formatDate(daysFromNow(1));
    const rel = t.match(/^\+(\d+)d$/);
    if (rel) return formatDate(daysFromNow(Number(rel[1])));
    const weekday = WEEKDAYS.indexOf(t);
    if (weekday !== -1) {
      // Next upcoming occurrence of that weekday (never today — always ahead).
      const offset = ((weekday - new Date().getDay()) + 7) % 7 || 7;
      return formatDate(daysFromNow(offset));
    }
    return match; // unknown token — leave as-is
  });
}

function loadMails(jsonPath, fallbackTo) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.emails;
  if (!Array.isArray(list) || !list.length) {
    throw new Error('JSON must be an array of mails, or an object with a non-empty "emails" array.');
  }
  return list.map((m, i) => {
    if (!m.from) throw new Error(`Mail #${i + 1} ("${m.subject || 'no subject'}") is missing a "from" account.`);
    const to = m.to || fallbackTo;
    if (!to) throw new Error(`Mail #${i + 1} ("${m.subject || 'no subject'}") has no "to" — pass one with --to recipient@example.com`);
    return {
      from: String(m.from).toLowerCase().trim(),
      to: Array.isArray(to) ? to : [to],
      cc: m.cc ? (Array.isArray(m.cc) ? m.cc : [m.cc]) : [],
      bcc: m.bcc ? (Array.isArray(m.bcc) ? m.bcc : [m.bcc]) : [],
      subject: resolvePlaceholders(m.subject || '(no subject)'),
      html: resolvePlaceholders(m.html || ''),
      text: resolvePlaceholders(m.text || m.body || ''),
    };
  });
}

async function main() {
  const { jsonPath, fallbackTo, fromFilter } = parseArgs();
  if (!jsonPath) {
    console.error('Usage: node scripts/send-bulk-mails.js <path-to-mails.json> --to recipient@example.com [--from sender@outlook.com]');
    process.exit(1);
  }

  let mails = loadMails(jsonPath, fallbackTo);
  if (fromFilter) {
    const f = fromFilter.toLowerCase().trim();
    const before = mails.length;
    mails = mails.filter((m) => m.from === f);
    console.log(`--from filter: keeping ${mails.length}/${before} mail(s) from ${f}`);
    if (!mails.length) {
      console.error('No mails match the --from filter.');
      process.exit(1);
    }
  }
  const senders = [...new Set(mails.map((m) => m.from))];
  console.log(`Loaded ${mails.length} mail(s) from ${jsonPath} across ${senders.length} sender account(s): ${senders.join(', ')}`);

  // READ-ONLY: don't let mongoose create indexes on model load.
  mongoose.set('autoIndex', false);
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB (read-only usage):', MONGO_URI);

  const OutlookUser = require('../server/microsoft/models/outlookUser.model').default;
  const OutlookMessagesService = require('../server/microsoft/services/outlookMessages.service').default;

  // READ-ONLY: the service persists refreshed OAuth tokens via saveData().
  // No-op it so this script never writes to the DB — refreshed tokens live
  // in memory for this run only.
  OutlookUser.saveData = async (doc) => doc;
  console.log('DB writes disabled: token refreshes will NOT be persisted.');

  const users = await OutlookUser.find({ email: { $in: senders }, active: true }).lean();
  const connected = users.map((u) => u.email);
  const missing = senders.filter((e) => !connected.includes(e));

  console.log(`\nConnected sender account(s): ${connected.join(', ') || 'none'}`);
  if (missing.length) {
    console.warn(`NOT connected in outlook_users (their mails will be skipped): ${missing.join(', ')}`);
  }
  if (!connected.length) {
    console.error('None of the sender accounts are connected — connect them first via Connections & Delivery.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // One service per sender, reused across its mails.
  const services = Object.fromEntries(connected.map((email) => [email, new OutlookMessagesService(email)]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < mails.length; i += 1) {
    const mail = mails[i];
    const service = services[mail.from];
    if (!service) {
      skipped += 1;
      console.warn(`  – skipped "${mail.subject}" (sender ${mail.from} not connected)`);
      continue;
    }
    // Pace the sends so Outlook doesn't flag the accounts as spam sources.
    if (sent + failed > 0) await sleep(SEND_DELAY_MS);
    try {
      await service.sendMail({
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      sent += 1;
      console.log(`  ✓ [${mail.from}] "${mail.subject}" → ${mail.to.join(', ')}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ [${mail.from}] "${mail.subject}" → ${mail.to.join(', ')}: ${err.message}`);
    }
  }

  console.log(`\n--- Summary ---\nsent=${sent}, failed=${failed}, skipped=${skipped}, total=${mails.length}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
