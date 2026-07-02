import { google } from 'googleapis';
import config from '../../config/config';
import EmailAnalysisUser from '../models/emailAnalysisUser.model';

const encodeRawEmail = (raw = '') =>
  Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Build a raw RFC 822 MIME message for use with Gmail Drafts API.
 * Supports multipart/mixed when attachments are provided.
 */
function buildRawMime({ from, to, cc, bcc, subject, body, isHtml = true, inReplyTo, references, attachments = [] }) {
  const boundary = `EA_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hasAttachments = attachments && attachments.length > 0;

  const toStr = Array.isArray(to) ? to.join(', ') : (to || '');
  const ccStr = Array.isArray(cc) ? cc.join(', ') : (cc || '');
  const bccStr = Array.isArray(bcc) ? bcc.join(', ') : (bcc || '');

  const baseHeaders = [
    from ? `From: ${from}` : null,
    toStr ? `To: ${toStr}` : null,
    ccStr ? `Cc: ${ccStr}` : null,
    bccStr ? `Bcc: ${bccStr}` : null,
    `Subject: ${subject || '(no subject)'}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const bodyBase64 = Buffer.from(body || '', 'utf8').toString('base64');
  const bodyContentType = isHtml ? 'text/html' : 'text/plain';

  if (!hasAttachments) {
    return [
      ...baseHeaders,
      `Content-Type: ${bodyContentType}; charset="UTF-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      bodyBase64,
    ].join('\r\n');
  }

  const bodyPart = [
    `--${boundary}`,
    `Content-Type: ${bodyContentType}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
  ].join('\r\n');

  const attParts = attachments.map(att => [
    `--${boundary}`,
    `Content-Type: ${att.mimeType || 'application/octet-stream'}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${att.filename || 'attachment'}"`,
    '',
    att.contentBytes || '',
  ].join('\r\n'));

  return [
    ...baseHeaders,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    bodyPart,
    ...attParts,
    `--${boundary}--`,
  ].join('\r\n');
}

export default class GmailDraftService {
  constructor(email) {
    this.email = email;
    this.user = null;
    this.gmail = null;
  }

  async #init() {
    const user = await EmailAnalysisUser.findOne({
      email: this.email,
      active: true,
      provider: { $in: ['google', 'gmail'] },
    });
    if (!user) throw new Error(`No connected Gmail account for ${this.email}`);
    if (!user.refreshToken) throw new Error(`Missing Google refresh token for ${this.email}. Reconnect the account.`);
    this.user = user;

    const oauth = new google.auth.OAuth2(config.googleClient, config.googleSecret, config.emailAnalysisRedirectUri);
    oauth.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
      expiry_date: user.expiryDate ? new Date(user.expiryDate).getTime() : undefined,
    });

    oauth.on('tokens', async (tokens) => {
      try {
        if (tokens.access_token) this.user.accessToken = tokens.access_token;
        if (tokens.refresh_token) this.user.refreshToken = tokens.refresh_token;
        if (tokens.expiry_date) this.user.expiryDate = new Date(tokens.expiry_date);
        await EmailAnalysisUser.saveData(this.user);
      } catch (err) {
        console.error('[GmailDraft] Failed to persist refreshed token:', err.message);
      }
    });

    this.gmail = google.gmail({ version: 'v1', auth: oauth });
  }

  async createDraft({ from, to, cc, bcc, subject, body, isHtml = true, inReplyTo, references, threadId, attachments = [] }) {
    await this.#init();
    const raw = buildRawMime({ from: from || this.user.email, to, cc, bcc, subject, body, isHtml, inReplyTo, references, attachments });
    const requestBody = { message: { raw: encodeRawEmail(raw) } };
    if (threadId) requestBody.message.threadId = threadId;
    const res = await this.gmail.users.drafts.create({ userId: 'me', requestBody });
    return res.data;
  }

  async updateDraft({ draftId, from, to, cc, bcc, subject, body, isHtml = true, inReplyTo, references, threadId, attachments = [] }) {
    await this.#init();
    const raw = buildRawMime({ from: from || this.user.email, to, cc, bcc, subject, body, isHtml, inReplyTo, references, attachments });
    const requestBody = { id: draftId, message: { raw: encodeRawEmail(raw) } };
    if (threadId) requestBody.message.threadId = threadId;
    const res = await this.gmail.users.drafts.update({ userId: 'me', id: draftId, requestBody });
    return res.data;
  }

  async deleteDraft(draftId) {
    await this.#init();
    await this.gmail.users.drafts.delete({ userId: 'me', id: draftId });
    return { deleted: true };
  }

  async sendDraft(draftId) {
    await this.#init();
    const res = await this.gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
    return res.data;
  }

  async listDrafts() {
    await this.#init();
    const res = await this.gmail.users.drafts.list({ userId: 'me', maxResults: 100 });
    return res.data.drafts || [];
  }

  async getDraft(draftId) {
    await this.#init();
    const res = await this.gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
    return res.data;
  }
}
