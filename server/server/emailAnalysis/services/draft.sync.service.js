import path from 'path';
import fs from 'fs';

import EmailDraft from '../models/emailDraft.model';
import EmailAnalysisUser from '../models/emailAnalysisUser.model';
import GmailDraftService from './gmail.draft.service';
import OutlookDraftService from './outlook.draft.service';

const UPLOAD_DIR = path.resolve(__dirname, '../../upload/email-analysis');
const UPLOAD_REL = 'server/upload/email-analysis';

function getProviderService(provider, email) {
  if (provider === 'outlook') return new OutlookDraftService(email);
  return new GmailDraftService(email);
}

function normalizeProvider(raw = '') {
  if (raw === 'google') return 'gmail';
  if (raw === 'microsoft') return 'outlook';
  return raw; // 'gmail' or 'outlook' pass through
}

async function resolveAccountForDraft(email, loginUserEmailId, provider) {
  if (email) {
    const user = await EmailAnalysisUser.findOne({ email, active: true, purpose: { $ne: 'send' } }).lean();
    if (!user) throw new Error(`No connected account for ${email}`);
    return user;
  }
  const base = { active: true, purpose: { $ne: 'send' } };
  if (provider === 'gmail') base.provider = { $in: ['google', 'gmail'] };
  if (provider === 'outlook') base.provider = { $in: ['outlook', 'microsoft'] };
  if (loginUserEmailId) {
    const own = await EmailAnalysisUser.findOne({ ...base, loginUserEmailId }).sort({ updatedAt: -1 }).lean();
    if (own) return own;
  }
  const user = await EmailAnalysisUser.findOne(base).sort({ updatedAt: -1 }).lean();
  if (!user) throw new Error('No connected email account found.');
  return user;
}

function buildGmailAttachments(attachments = []) {
  return attachments
    .filter(a => a.saved && a.savedPath)
    .map(a => {
      try {
        const filePath = path.resolve(__dirname, '../../', a.savedPath);
        return {
          filename: a.filename,
          mimeType: a.mimeType,
          contentBytes: fs.readFileSync(filePath).toString('base64'),
        };
      } catch (err) {
        console.error('[DraftSync] Could not read attachment file:', a.savedPath, err.message);
        return null;
      }
    })
    .filter(Boolean);
}

class DraftSyncService {
  async listDrafts({ email, loginUserEmailId, provider, page = 1, limit = 20 }) {
    const query = { active: true, status: { $ne: 'sent' } };
    if (email) query.email = email;
    if (loginUserEmailId) query.loginUserEmailId = loginUserEmailId;
    if (provider) query.provider = provider;

    const skip = (Number(page) - 1) * Number(limit);
    const [drafts, total] = await Promise.all([
      EmailDraft.find(query).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      EmailDraft.countDocuments(query),
    ]);
    return { drafts, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) };
  }

  async getDraft(draftId) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true }).lean();
    if (!draft) throw new Error('Draft not found');
    return draft;
  }

  async createDraft({ email, loginUserEmailId, provider, to, cc, bcc, subject, body, inReplyTo, references, threadId, conversationId, attachments }) {
    const account = await resolveAccountForDraft(email, loginUserEmailId, provider);
    const effectiveEmail = account.email;
    const effectiveProvider = normalizeProvider(account.provider) || provider || 'gmail';

    const draft = new EmailDraft({
      email: effectiveEmail,
      loginUserEmailId,
      provider: effectiveProvider,
      to: to || [],
      cc: cc || [],
      bcc: bcc || [],
      subject: subject || '',
      body: body || '',
      inReplyTo: inReplyTo || null,
      references: references || null,
      threadId: threadId || null,
      conversationId: conversationId || null,
      attachments: (attachments || []).map(att => ({
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        savedPath: att.savedPath,
        saved: !!att.savedPath,
      })),
      status: 'draft',
      syncStatus: 'pending',
    });
    await EmailDraft.saveData(draft);

    // Sync to provider in background — don't fail the create if provider is unreachable
    try {
      const svc = getProviderService(effectiveProvider, effectiveEmail);
      if (effectiveProvider === 'gmail') {
        const result = await svc.createDraft({
          from: effectiveEmail,
          to: to || [],
          cc: cc || [],
          bcc: bcc || [],
          subject,
          body,
          isHtml: true,
          inReplyTo,
          references,
          threadId,
          attachments: buildGmailAttachments(draft.attachments),
        });
        draft.gmailDraftId = result.id;
      } else {
        const result = await svc.createDraft({
          to: to || [],
          cc: cc || [],
          bcc: bcc || [],
          subject,
          body,
          isHtml: true,
          conversationId,
        });
        draft.outlookDraftId = result.id;
        // Upload attachments to Outlook separately
        for (const att of (draft.attachments || [])) {
          if (att.saved && att.savedPath) {
            try {
              const filePath = path.resolve(__dirname, '../../', att.savedPath);
              const contentBytes = fs.readFileSync(filePath).toString('base64');
              await svc.addAttachment(result.id, { filename: att.filename, mimeType: att.mimeType, contentBytes });
            } catch (e) {
              console.error('[DraftSync] Outlook attachment upload failed:', e.message);
            }
          }
        }
      }
      draft.syncStatus = 'synced';
      draft.lastSyncedAt = new Date();
    } catch (err) {
      console.error('[DraftSync] Provider create failed:', err.message);
      draft.syncStatus = 'failed';
      draft.syncError = err.message;
    }

    await EmailDraft.saveData(draft);
    return draft;
  }

  async updateDraft(draftId, { to, cc, bcc, subject, body }) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true });
    if (!draft) throw new Error('Draft not found');
    if (draft.status === 'sent') throw new Error('Cannot update a sent draft');

    if (to !== undefined) draft.to = to;
    if (cc !== undefined) draft.cc = cc;
    if (bcc !== undefined) draft.bcc = bcc;
    if (subject !== undefined) draft.subject = subject;
    if (body !== undefined) draft.body = body;
    draft.syncStatus = 'pending';
    await EmailDraft.saveData(draft);

    try {
      const svc = getProviderService(draft.provider, draft.email);
      if (draft.provider === 'gmail' && draft.gmailDraftId) {
        await svc.updateDraft({
          draftId: draft.gmailDraftId,
          from: draft.email,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          isHtml: true,
          inReplyTo: draft.inReplyTo,
          references: draft.references,
          threadId: draft.threadId,
          attachments: buildGmailAttachments(draft.attachments),
        });
      } else if (draft.provider === 'outlook' && draft.outlookDraftId) {
        await svc.updateDraft({
          messageId: draft.outlookDraftId,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          isHtml: true,
        });
      } else if (!draft.gmailDraftId && !draft.outlookDraftId) {
        // Provider draft was never created — create it now
        if (draft.provider === 'gmail') {
          const result = await svc.createDraft({
            from: draft.email,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
            attachments: buildGmailAttachments(draft.attachments),
          });
          draft.gmailDraftId = result.id;
        } else {
          const result = await svc.createDraft({
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
          });
          draft.outlookDraftId = result.id;
        }
      }
      draft.syncStatus = 'synced';
      draft.syncError = null;
      draft.lastSyncedAt = new Date();
    } catch (err) {
      console.error('[DraftSync] Provider update failed:', err.message);
      draft.syncStatus = 'failed';
      draft.syncError = err.message;
    }

    await EmailDraft.saveData(draft);
    return draft;
  }

  async deleteDraft(draftId) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true });
    if (!draft) throw new Error('Draft not found');

    try {
      const svc = getProviderService(draft.provider, draft.email);
      if (draft.provider === 'gmail' && draft.gmailDraftId) {
        await svc.deleteDraft(draft.gmailDraftId);
      } else if (draft.provider === 'outlook' && draft.outlookDraftId) {
        await svc.deleteDraft(draft.outlookDraftId);
      }
    } catch (err) {
      console.error('[DraftSync] Provider delete failed (soft-deleting anyway):', err.message);
    }

    draft.active = false;
    await EmailDraft.saveData(draft);
    return { deleted: true };
  }

  async sendDraft(draftId) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true });
    if (!draft) throw new Error('Draft not found');
    if (draft.status === 'sent') throw new Error('Draft already sent');

    draft.status = 'sending';
    await EmailDraft.saveData(draft);

    try {
      const svc = getProviderService(draft.provider, draft.email);

      if (draft.provider === 'gmail') {
        if (draft.gmailDraftId) {
          // Push latest content to Gmail draft before sending
          await svc.updateDraft({
            draftId: draft.gmailDraftId,
            from: draft.email,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
            inReplyTo: draft.inReplyTo,
            references: draft.references,
            threadId: draft.threadId,
            attachments: buildGmailAttachments(draft.attachments),
          });
          await svc.sendDraft(draft.gmailDraftId);
        } else {
          const created = await svc.createDraft({
            from: draft.email,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
            attachments: buildGmailAttachments(draft.attachments),
          });
          await svc.sendDraft(created.id);
        }
      } else {
        if (draft.outlookDraftId) {
          await svc.updateDraft({
            messageId: draft.outlookDraftId,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
          });
          await svc.sendDraft(draft.outlookDraftId);
        } else {
          const created = await svc.createDraft({
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            isHtml: true,
          });
          await svc.sendDraft(created.id);
        }
      }

      draft.status = 'sent';
      draft.sentAt = new Date();
      draft.syncStatus = 'synced';
      draft.gmailDraftId = null;
      draft.outlookDraftId = null;
    } catch (err) {
      draft.status = 'failed';
      draft.syncError = err.message;
      await EmailDraft.saveData(draft);
      throw err;
    }

    await EmailDraft.saveData(draft);
    return draft;
  }

  async addAttachment(draftId, { filename, mimeType, size, savedPath, contentBytes }) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true });
    if (!draft) throw new Error('Draft not found');

    draft.attachments.push({ filename, mimeType, size, savedPath, saved: !!savedPath });

    if (draft.provider === 'outlook' && draft.outlookDraftId && contentBytes) {
      try {
        const svc = getProviderService('outlook', draft.email);
        await svc.addAttachment(draft.outlookDraftId, { filename, mimeType, contentBytes });
      } catch (err) {
        console.error('[DraftSync] Outlook attachment upload failed:', err.message);
      }
    }

    // For Gmail, rebuild the entire draft MIME body with all attachments
    if (draft.provider === 'gmail' && draft.gmailDraftId) {
      try {
        const svc = getProviderService('gmail', draft.email);
        await svc.updateDraft({
          draftId: draft.gmailDraftId,
          from: draft.email,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          isHtml: true,
          inReplyTo: draft.inReplyTo,
          references: draft.references,
          attachments: buildGmailAttachments(draft.attachments),
        });
        draft.syncStatus = 'synced';
        draft.lastSyncedAt = new Date();
      } catch (err) {
        console.error('[DraftSync] Gmail attachment sync failed:', err.message);
        draft.syncStatus = 'failed';
        draft.syncError = err.message;
      }
    }

    await EmailDraft.saveData(draft);
    return draft;
  }

  async removeAttachment(draftId, attachmentIndex) {
    const draft = await EmailDraft.findOne({ _id: draftId, active: true });
    if (!draft) throw new Error('Draft not found');

    const idx = Number(attachmentIndex);
    if (idx < 0 || idx >= draft.attachments.length) throw new Error('Invalid attachment index');
    draft.attachments.splice(idx, 1);

    if (draft.provider === 'gmail' && draft.gmailDraftId) {
      try {
        const svc = getProviderService('gmail', draft.email);
        await svc.updateDraft({
          draftId: draft.gmailDraftId,
          from: draft.email,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          isHtml: true,
          attachments: buildGmailAttachments(draft.attachments),
        });
      } catch (err) {
        console.error('[DraftSync] Gmail remove-attachment sync failed:', err.message);
      }
    }

    await EmailDraft.saveData(draft);
    return draft;
  }
}

export default new DraftSyncService();
