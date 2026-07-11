/* Reply Studio API layer — every server call the studio makes lives here so
   the UI components stay free of endpoint/payload details. */
import fetchMethodRequest from '../../../../config/service';

/** Quick yes/no/maybe trio for a mail (cached server-side).
    Pass replyType + force=true to regenerate a single variant. */
export const fetchQuickVariants = (mailId, { replyType, force = false } = {}) =>
  fetchMethodRequest('POST', `email-analysis/mails/${mailId}/reply-variants`, {
    kind: 'quick',
    ...(replyType ? { replyType } : {}),
    force,
  });

/** Full thread-aware detailed reply for one type ('yes' | 'no' | 'maybe'). */
export const fetchDetailedReply = (mailId, replyType, force = false) =>
  fetchMethodRequest('POST', `email-analysis/mails/${mailId}/reply-variants`, {
    kind: 'detailed',
    replyType,
    force,
  });

/** Custom reply from a free-text prompt + tone/length/language controls. */
export const fetchCustomReply = (mailId, { prompt, tone, length, language }) =>
  fetchMethodRequest('POST', `email-analysis/mails/${mailId}/reply-variants`, {
    kind: 'custom',
    prompt,
    tone,
    length,
    language,
  });

/** Send HTML as a reply on the mail's thread (sourceId = providerMessageId). */
export const sendReplyOnThread = (sourceId, html) =>
  fetchMethodRequest('POST', 'email-analysis/mail/reply', { sourceId, html });

/** Save HTML as a real draft (app + provider Drafts folder). */
export const saveReplyDraft = (mail, sourceId, html, subject) => {
  const match = String(mail?.from || '').match(/<([^>]+)>/);
  const toAddr = (match ? match[1] : (String(mail?.from || '').includes('@') ? mail.from : '')).trim();
  let loginEmail = '';
  try { loginEmail = JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; } catch { /* ignore */ }
  return fetchMethodRequest('POST', 'email-analysis/drafts', {
    email: mail?.email || null,
    loginUserEmailId: loginEmail,
    provider: mail?.provider || null,
    to: toAddr ? [toAddr] : [],
    subject,
    body: html,
    threadId: mail?.threadId || null,
    conversationId: mail?.threadId || null,
    replyToMessageId: sourceId || null,
  });
};
