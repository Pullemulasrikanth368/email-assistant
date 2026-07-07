import axios from 'axios';
import EmailAnalysisUser from '../models/emailAnalysisUser.model';
import OutlookUser from '../../microsoft/models/outlookUser.model';
import OutlookAuthService from './outlook.auth.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function recipientList(list = []) {
  return (list || [])
    .map(addr => (typeof addr === 'string'
      ? { emailAddress: { address: addr } }
      : { emailAddress: { address: addr.email || addr.address || '', name: addr.name } }))
    .filter(r => r.emailAddress.address);
}

export default class OutlookDraftService {
  constructor(email) {
    this.email = email;
    this.user = null;
    this.userModel = null;
    this.auth = new OutlookAuthService();
  }

  async #loadUser() {
    let user = await EmailAnalysisUser.findOne({
      email: this.email,
      active: true,
      provider: { $in: ['outlook', 'microsoft'] },
    });
    this.userModel = EmailAnalysisUser;

    if (!user) {
      user = await OutlookUser.findOne({
        email: this.email,
        active: true,
        purpose: { $ne: 'send' },
      });
      this.userModel = OutlookUser;
    }

    if (!user) throw new Error(`No connected Outlook account for ${this.email}`);
    if (!user.refreshToken) throw new Error(`Missing Microsoft refresh token for ${this.email}. Reconnect Outlook.`);
    this.user = user;
    await this.#ensureAccessToken();
  }

  async #ensureAccessToken(force = false) {
    const expiresAt = this.user.expiryDate ? new Date(this.user.expiryDate).getTime() : 0;
    const shouldRefresh = force || !this.user.accessToken || expiresAt < Date.now() + 2 * 60 * 1000;
    if (!shouldRefresh) return this.user.accessToken;

    const tokens = await this.auth.refreshTokens(this.user.refreshToken);
    this.user.accessToken = tokens.access_token;
    if (tokens.refresh_token) this.user.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) this.user.expiryDate = tokens.expiry_date;
    await this.userModel.saveData(this.user);
    return this.user.accessToken;
  }

  async #graph(method, url, { data, params } = {}) {
    await this.#ensureAccessToken();
    const fullUrl = /^https?:\/\//i.test(url) ? url : `${GRAPH_BASE}${url}`;
    try {
      const res = await axios({
        method,
        url: fullUrl,
        data,
        params,
        headers: {
          Authorization: `Bearer ${this.user.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      return res.data;
    } catch (err) {
      if (err?.response?.status === 401) {
        await this.#ensureAccessToken(true);
        const res = await axios({
          method,
          url: fullUrl,
          data,
          params,
          headers: { Authorization: `Bearer ${this.user.accessToken}`, 'Content-Type': 'application/json' },
        });
        return res.data;
      }
      const graphErr = err?.response?.data?.error;
      throw new Error(graphErr?.message || err.message || 'Microsoft Graph request failed.');
    }
  }

  async createDraft({ to, cc, bcc, subject, body, isHtml = true, conversationId, replyToMessageId }) {
    await this.#loadUser();

    // If we know which message this is replying to, create the draft via
    // Graph's createReply action so it's a real threaded reply (correct
    // conversationId/conversationIndex + In-Reply-To/References), not a
    // brand-new, unlinked message.
    if (replyToMessageId) {
      const reply = await this.#graph(
        'POST',
        `/me/messages/${encodeURIComponent(replyToMessageId)}/createReply`,
        { data: {} }
      );
      await this.#graph('PATCH', `/me/messages/${encodeURIComponent(reply.id)}`, {
        data: {
          subject: subject || reply.subject,
          body: { contentType: isHtml ? 'HTML' : 'Text', content: body || '' },
          toRecipients: to && to.length ? recipientList(to) : reply.toRecipients,
          ccRecipients: recipientList(cc || []),
          bccRecipients: recipientList(bcc || []),
        },
      });
      return { id: reply.id, conversationId: reply.conversationId };
    }

    const message = {
      subject: subject || '(no subject)',
      body: { contentType: isHtml ? 'HTML' : 'Text', content: body || '' },
      toRecipients: recipientList(to || []),
      ccRecipients: recipientList(cc || []),
      bccRecipients: recipientList(bcc || []),
    };
    if (conversationId) message.conversationId = conversationId;
    return this.#graph('POST', '/me/mailFolders/drafts/messages', { data: message });
  }

  async updateDraft({ messageId, to, cc, bcc, subject, body, isHtml = true }) {
    await this.#loadUser();
    return this.#graph('PATCH', `/me/messages/${encodeURIComponent(messageId)}`, {
      data: {
        subject: subject || '(no subject)',
        body: { contentType: isHtml ? 'HTML' : 'Text', content: body || '' },
        toRecipients: recipientList(to || []),
        ccRecipients: recipientList(cc || []),
        bccRecipients: recipientList(bcc || []),
      },
    });
  }

  async deleteDraft(messageId) {
    await this.#loadUser();
    await this.#graph('DELETE', `/me/messages/${encodeURIComponent(messageId)}`);
    return { deleted: true };
  }

  async sendDraft(messageId) {
    await this.#loadUser();
    await this.#graph('POST', `/me/messages/${encodeURIComponent(messageId)}/send`);
    return { sent: true };
  }

  async listDrafts() {
    await this.#loadUser();
    const data = await this.#graph('GET', '/me/mailFolders/drafts/messages', {
      params: {
        $select: 'id,subject,body,toRecipients,ccRecipients,bccRecipients,createdDateTime,lastModifiedDateTime,isDraft',
        $top: 100,
        $orderby: 'lastModifiedDateTime desc',
      },
    });
    return data.value || [];
  }

  async getDraft(messageId) {
    await this.#loadUser();
    return this.#graph('GET', `/me/messages/${encodeURIComponent(messageId)}`);
  }

  async addAttachment(messageId, { filename, mimeType, contentBytes }) {
    await this.#loadUser();
    return this.#graph('POST', `/me/messages/${encodeURIComponent(messageId)}/attachments`, {
      data: {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: filename,
        contentType: mimeType || 'application/octet-stream',
        contentBytes,
      },
    });
  }
}
