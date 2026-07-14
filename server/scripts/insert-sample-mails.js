/**
 * insert-sample-mails.js
 *
 * Inserts sample mails DIRECTLY into the `email_analysis_mails` collection for
 * an Outlook mailbox — nothing is ever sent through Outlook/Graph. Each mail is
 * shaped exactly like a real synced Outlook message (the object produced by
 * OutlookMessagesService#formatMessage), so the analysis pipeline treats them
 * as genuine inbox mails: prioritization, categorization, quick replies etc.
 * all run on them as usual (priority/category/needsReply are left null here on
 * purpose — the AI pass assigns them).
 *
 * Usage:
 *   node scripts/insert-sample-mails.js [path-to-mails.json]
 *     [--mailbox dosystemsai121@outlook.com]   target account (default shown)
 *     [--dry-run]                              print docs, insert nothing
 *     [--clean]                                delete previously inserted sample
 *                                              mails for the mailbox, then exit
 *
 * Defaults to scripts/db_insertion_static_mails.json next to this file.
 *
 * JSON authoring format — array of mails:
 *   {
 *     "category":  "bitbucket",                    // free-form tag (kept in labels as SAMPLE:<category>)
 *     "thread":    "pr-512",                       // mails sharing a key share a threadId
 *     "daysAgo":   2,                              // receivedAt = now - N days (random office hour)
 *     "isRead":    true,                           // false → UNREAD label
 *     "importance":"high",                         // optional → HIGH label (default NORMAL)
 *     "isMeeting": true,                           // optional → adds MEETING label
 *     "from": { "name": "...", "email": "..." },   // required
 *     "to":   [{ "name": "...", "email": "..." }], // optional, defaults to the mailbox owner
 *     "cc":   [{ ... }],                           // optional
 *     "ccMe": true,                                // mailbox owner goes in CC instead of TO (read-only mails)
 *     "replyTo": "noreply@bitbucket.org",          // optional
 *     "subject": "...",
 *     "html": "..."                                // body; supports {{today}} {{tomorrow}} {{+Nd}} {{monday}}..{{sunday}}
 *   }
 *
 * All inserted docs get a providerMessageId starting with "AAMkADSAMPLE" so
 * --clean can remove exactly them and nothing real.
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('@babel/register')({
  presets: ['@babel/preset-env'],
});

const mongoose = require('mongoose');

const MONGO_URI = process.env.LOCAL_MONGO_HOST || 'mongodb://localhost:27017/executive_email_assistant';

const DEFAULT_MAILBOX = 'dosystemsai121@outlook.com';
const MAILBOX_NAME = 'Deepu Kumar';
const SAMPLE_ID_PREFIX = 'AAMkADSAMPLE'; // marks docs as script-inserted, used by --clean

function parseArgs() {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
  };
  const mailbox = (flagValue('--mailbox') || DEFAULT_MAILBOX).toLowerCase().trim();
  const mailboxName = flagValue('--name') || MAILBOX_NAME;
  const dryRun = args.includes('--dry-run');
  const clean = args.includes('--clean');
  const allowRemote = args.includes('--allow-remote');
  const flagValueIdxs = ['--mailbox'].map((f) => args.indexOf(f)).filter((i) => i !== -1).map((i) => i + 1);
  const jsonPath = args.find((a, i) => !a.startsWith('--') && !flagValueIdxs.includes(i))
    || path.resolve(__dirname, 'db_insertion_static_mails.json');
  return { jsonPath, mailbox, mailboxName, dryRun, clean, allowRemote };
}

/* ─── date placeholders (same tokens as send-bulk-mails.js) ─── */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function resolvePlaceholders(str = '') {
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, token) => {
    const t = token.toLowerCase();
    if (t === 'today') return formatDate(daysFromNow(0));
    if (t === 'tomorrow') return formatDate(daysFromNow(1));
    const rel = t.match(/^\+(\d+)d$/);
    if (rel) return formatDate(daysFromNow(Number(rel[1])));
    const weekday = WEEKDAYS.indexOf(t);
    if (weekday !== -1) {
      const offset = ((weekday - new Date().getDay()) + 7) % 7 || 7;
      return formatDate(daysFromNow(offset));
    }
    return match;
  });
}

/* ─── fakes shaped like real Graph values ─── */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const randomB64 = (len) => Array.from({ length: len }, () => B64URL[Math.floor(Math.random() * B64URL.length)]).join('');

// Graph message ids are ~150-char base64; ours carry a SAMPLE marker up front.
const fakeMessageId = () => `${SAMPLE_ID_PREFIX}${randomB64(120)}=`;
const fakeThreadId = () => `AAQkADSAMPLE${randomB64(60)}=`;

// Same "Name <email>" convention as addressToString in the Outlook service.
const addr = (p = {}) => (p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.email || '');

// receivedAt: N days ago at a random office hour so the inbox looks organic.
function receivedAt(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  if (d > new Date()) d.setHours(new Date().getHours() - 1); // today's mails stay in the past
  return d;
}

const stripHtml = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&rarr;/g, '→').replace(/&middot;/g, '·').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
  .replace(/\s+/g, ' ').trim();

/* ─── map an authored mail to the true DB shape ─── */

function buildDoc(m, i, mailbox, mailboxName, threadIds) {
  if (!m.from || !m.from.email) throw new Error(`Mail #${i + 1} ("${m.subject || 'no subject'}") is missing "from".`);

  const me = { name: mailboxName, email: mailbox };
  const toList = (m.to && m.to.length ? m.to : (m.ccMe ? [] : [me]));
  const ccList = [...(m.cc || []), ...(m.ccMe ? [me] : [])];

  // one threadId per thread key; standalone mails get their own
  const threadKey = m.thread || `solo-${i}`;
  if (!threadIds[threadKey]) threadIds[threadKey] = fakeThreadId();

  const html = resolvePlaceholders(m.html || m.body || '');
  const text = stripHtml(html);

  return {
    email: mailbox,
    provider: 'outlook',
    from: addr(m.from),
    to: toList.map(addr).join(', '),
    cc: ccList.map(addr),
    bcc: [],
    replyTo: m.replyTo || '',
    subject: resolvePlaceholders(m.subject || '(no subject)'),
    body: html,
    snippet: text.slice(0, 160),
    labels: [
      m.isRead === false ? 'UNREAD' : 'READ',
      (m.importance || 'normal').toUpperCase(),
      m.isMeeting ? 'MEETING' : null,
      m.category ? `SAMPLE:${m.category}` : null,
    ].filter(Boolean),
    mimeType: 'text/html',
    providerMessageId: fakeMessageId(),
    threadId: threadIds[threadKey],
    receivedAt: receivedAt(m.daysAgo || 0),
    attachments: [],
    hasAttachments: false,
    isRepliedMail: false,
    sourceFolder: 'inbox',
    isJunk: false,
    active: true,
    categoriesSynced: false,
  };
}

async function main() {
  const { jsonPath, mailbox, mailboxName, dryRun, clean, allowRemote } = parseArgs();

  // Safety: this script writes sample data — local DB only unless --allow-remote.
  const host = (() => { try { return new URL(MONGO_URI).hostname; } catch (e) { return ''; } })();
  if (!['localhost', '127.0.0.1'].includes(host) && !allowRemote) {
    console.error(`Refusing to run: Mongo host is "${host || MONGO_URI}", not localhost. Pass --allow-remote to write to it anyway.`);
    process.exit(1);
  }
  if (allowRemote) console.log(`--allow-remote: writing to non-local host ${host}`);

  mongoose.set('autoIndex', false);
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', MONGO_URI);

  const EmailAnalysisMail = require('../server/emailAnalysis/models/emailAnalysisMail.model').default;

  if (clean) {
    const res = await EmailAnalysisMail.deleteMany({
      email: mailbox,
      provider: 'outlook',
      providerMessageId: new RegExp(`^${SAMPLE_ID_PREFIX}`),
    });
    console.log(`--clean: removed ${res.deletedCount} sample mail(s) for ${mailbox}.`);
    await mongoose.disconnect();
    return;
  }

  const raw = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.emails;
  if (!Array.isArray(list) || !list.length) {
    throw new Error('JSON must be an array of mails, or an object with a non-empty "emails" array.');
  }

  const threadIds = {};
  const docs = list.map((m, i) => buildDoc(m, i, mailbox, mailboxName, threadIds));

  const byCategory = docs.reduce((acc, d) => {
    const tag = (d.labels.find((l) => l.startsWith('SAMPLE:')) || 'SAMPLE:uncategorized').slice(7);
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});
  console.log(`Loaded ${docs.length} mail(s) from ${jsonPath} for mailbox ${mailbox}:`);
  Object.entries(byCategory).forEach(([cat, n]) => console.log(`  - ${cat}: ${n}`));

  if (dryRun) {
    console.log('\n--dry-run: nothing inserted. First doc preview:\n');
    console.dir(docs[0], { depth: null });
    await mongoose.disconnect();
    return;
  }

  let inserted = 0;
  try {
    const res = await EmailAnalysisMail.insertMany(docs, { ordered: false });
    inserted = res.length;
  } catch (err) {
    // ordered:false → duplicates are skipped, the rest still insert
    inserted = err.insertedDocs ? err.insertedDocs.length : 0;
    if (err.code !== 11000 && !(err.writeErrors || []).every((e) => e.code === 11000)) throw err;
  }

  const total = await EmailAnalysisMail.countDocuments({ email: mailbox, provider: 'outlook', active: true });
  console.log(`\n--- Summary ---\ninserted=${inserted}/${docs.length} · mailbox now holds ${total} active outlook mail(s)`);
  console.log(`Re-run with --clean to remove them (matched by the ${SAMPLE_ID_PREFIX} id prefix).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
