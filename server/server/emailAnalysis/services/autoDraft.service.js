/**
 * Auto-draft replies for mails the categorization pass marked `needsReply`.
 *
 * Runs right after prioritization: for each needs-reply mail an AI reply is
 * generated (and cached on the mail as `aiReply`) and stored as a REAL draft
 * — in the app's drafts collection and the provider's Drafts folder — via the
 * shared draftSyncService. The draft is linked back to the mail through
 * `autoDraftId` so the email detail view can show the drafted reply thread.
 *
 * Meetings, invoices, notifications and bulk mail never reach this service
 * (see NO_DRAFT_CATEGORIES in prioritize.service.js).
 */
import EmailAnalysisMail from '../models/emailAnalysisMail.model';
import EmailDraft from '../models/emailDraft.model';
import aiReplyService from './aiReply.service';
import draftSyncService from './draft.sync.service';

// Split a raw `From` header ("Name <addr>") into the bare address.
function senderAddress(raw = '') {
  const match = String(raw).match(/<([^>]+)>/);
  if (match) return match[1].trim();
  const trimmed = String(raw).trim();
  return trimmed.includes('@') ? trimmed : '';
}

// The drafts pipeline stores/sends HTML — convert the plain-text AI reply to
// simple paragraph HTML (blank line = new paragraph), the same shape the
// client's CKEditor draft editor produces.
function toHtml(text = '') {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function replySubject(subject = '') {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject || '(no subject)'}`;
}

/**
 * Ensure a needs-reply mail has an auto-drafted reply. Idempotent: skips
 * mails that already carry a live draft (auto-created or user-created), were
 * already replied to, or have no sender address to reply to.
 *
 * @returns {Promise<Object|null>} the draft, or null when skipped
 */
export async function ensureAutoDraft(mail) {
  if (!mail || !mail.email || !mail.providerMessageId) return null;
  if (mail.isRepliedMail) return null;
  if (['sent', 'draft'].includes(mail.sourceFolder)) return null;

  // Already drafted (by a previous run or by the user in the detail view)?
  const existing = await EmailDraft.findOne({
    email: mail.email,
    replyToMessageId: mail.providerMessageId,
    active: true,
    status: { $ne: 'sent' },
  }).sort({ updatedAt: -1 }).lean();
  if (existing) {
    if (!mail.autoDraftId || String(mail.autoDraftId) !== String(existing._id)) {
      await EmailAnalysisMail.updateOne({ _id: mail._id }, { $set: { autoDraftId: existing._id } });
    }
    return existing;
  }

  const toAddr = senderAddress(mail.from);
  if (!toAddr) return null;

  // Generate the reply from the email (+ its thread) and cache it on the
  // mail so the detail view's Regenerate flow reuses the same cache.
  const { reply, provider, threadCount } = await aiReplyService.generateReply(mail);
  await EmailAnalysisMail.updateOne(
    { _id: mail._id },
    { $set: { aiReply: { text: reply, provider, threadCount, generatedAt: new Date() } } }
  );

  const draft = await draftSyncService.createDraft({
    email: mail.email,
    provider: mail.provider || 'gmail',
    to: [toAddr],
    subject: replySubject(mail.subject),
    body: toHtml(reply),
    threadId: mail.threadId || null,
    conversationId: mail.threadId || null,
    replyToMessageId: mail.providerMessageId,
  });

  await EmailAnalysisMail.updateOne({ _id: mail._id }, { $set: { autoDraftId: draft._id } });
  return draft;
}

/**
 * Auto-draft replies for a set of needs-reply mails, one at a time (each
 * involves an AI call + a provider draft create). Failures are logged per
 * mail and never abort the batch.
 *
 * @param {string} email                 - connected account
 * @param {string[]} providerMessageIds  - mails flagged needsReply
 * @returns {Promise<number>} number of drafts created/linked
 */
export async function createAutoDraftsForMails(email, providerMessageIds = []) {
  if (!email || !providerMessageIds.length) return 0;

  const mails = await EmailAnalysisMail.find({
    email,
    providerMessageId: { $in: providerMessageIds },
    active: true,
    needsReply: true,
    isRepliedMail: { $ne: true },
  }).lean();

  let drafted = 0;
  for (const mail of mails) {
    try {
      const draft = await ensureAutoDraft(mail);
      if (draft) drafted += 1;
    } catch (err) {
      console.error(`[EmailAnalysis] Auto-draft failed for ${mail.providerMessageId}:`, err.message);
    }
  }
  if (drafted) console.log(`[EmailAnalysis] Auto-drafted ${drafted} repl${drafted === 1 ? 'y' : 'ies'} for ${email}`);
  return drafted;
}

export default { ensureAutoDraft, createAutoDraftsForMails };
