import path from 'path';
import fs from 'fs';
import config from '../../config/config';
import draftSyncService from '../services/draft.sync.service';

const UPLOAD_DIR = path.resolve(__dirname, '../../upload/email-analysis');
const UPLOAD_REL = 'server/upload/email-analysis';

function attachmentUrl(savedPath) {
  if (!savedPath) return '';
  const rel = String(savedPath).replace(/^server\/upload\//, '');
  const base = String(config.serverUrl || '').replace(/\/+$/, '');
  return `${base}/images/${rel}`;
}

function mapDraft(draft) {
  const d = draft.toObject ? draft.toObject() : { ...draft };
  d.attachments = (d.attachments || []).map(att => ({
    ...att,
    url: att.saved ? attachmentUrl(att.savedPath) : '',
  }));
  return d;
}

function parseRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

const draftCtrl = {
  async listDrafts(req, res) {
    const { email, loginUserEmailId, provider, page = 1, limit = 20 } = req.query;
    const result = await draftSyncService.listDrafts({
      email: email || null,
      loginUserEmailId: loginUserEmailId || null,
      provider: provider || null,
      page: Number(page),
      limit: Number(limit),
    });
    return res.json({
      respCode: 200,
      drafts: result.drafts.map(mapDraft),
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
    });
  },

  async getDraft(req, res) {
    const { id } = req.params;
    try {
      const draft = await draftSyncService.getDraft(id);
      return res.json({ respCode: 200, data: mapDraft(draft) });
    } catch (err) {
      return res.json({ errorCode: 9300, errorMessage: err.message });
    }
  },

  async createDraft(req, res) {
    const {
      email, loginUserEmailId, provider,
      to, cc, bcc, subject, body,
      inReplyTo, references, threadId, conversationId,
    } = req.body;
    try {
      const draft = await draftSyncService.createDraft({
        email: email || null,
        loginUserEmailId: loginUserEmailId || null,
        provider: provider || null,
        to: parseRecipients(to),
        cc: parseRecipients(cc),
        bcc: parseRecipients(bcc),
        subject: subject || '',
        body: body || '',
        inReplyTo: inReplyTo || null,
        references: references || null,
        threadId: threadId || null,
        conversationId: conversationId || null,
        attachments: [],
      });
      return res.json({ respCode: 200, respMessage: 'Draft created', data: mapDraft(draft) });
    } catch (err) {
      console.error('[DraftCtrl] createDraft error:', err.message);
      return res.json({ errorCode: 9301, errorMessage: err.message });
    }
  },

  async updateDraft(req, res) {
    const { id } = req.params;
    const { to, cc, bcc, subject, body } = req.body;
    try {
      const draft = await draftSyncService.updateDraft(id, {
        to: to !== undefined ? parseRecipients(to) : undefined,
        cc: cc !== undefined ? parseRecipients(cc) : undefined,
        bcc: bcc !== undefined ? parseRecipients(bcc) : undefined,
        subject,
        body,
      });
      return res.json({ respCode: 200, respMessage: 'Draft updated', data: mapDraft(draft) });
    } catch (err) {
      console.error('[DraftCtrl] updateDraft error:', err.message);
      return res.json({ errorCode: 9302, errorMessage: err.message });
    }
  },

  async deleteDraft(req, res) {
    const { id } = req.params;
    try {
      await draftSyncService.deleteDraft(id);
      return res.json({ respCode: 200, respMessage: 'Draft deleted' });
    } catch (err) {
      console.error('[DraftCtrl] deleteDraft error:', err.message);
      return res.json({ errorCode: 9303, errorMessage: err.message });
    }
  },

  async sendDraft(req, res) {
    const { id } = req.params;
    try {
      const draft = await draftSyncService.sendDraft(id);
      return res.json({ respCode: 200, respMessage: 'Email sent successfully', data: mapDraft(draft) });
    } catch (err) {
      console.error('[DraftCtrl] sendDraft error:', err.message);
      return res.json({ errorCode: 9304, errorMessage: err.message });
    }
  },

  async autoSaveDraft(req, res) {
    const { id } = req.params;
    const { to, cc, bcc, subject, body } = req.body;
    try {
      const draft = await draftSyncService.updateDraft(id, {
        to: to !== undefined ? parseRecipients(to) : undefined,
        cc: cc !== undefined ? parseRecipients(cc) : undefined,
        bcc: bcc !== undefined ? parseRecipients(bcc) : undefined,
        subject,
        body,
      });
      return res.json({
        respCode: 200,
        respMessage: 'Auto-saved',
        data: { _id: draft._id, syncStatus: draft.syncStatus, updatedAt: draft.updatedAt },
      });
    } catch (err) {
      // Auto-save failures are non-fatal — return a partial success
      return res.json({ respCode: 200, respMessage: 'Auto-save partial', error: err.message });
    }
  },

  async uploadAttachment(req, res) {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ errorCode: 9310, errorMessage: 'No file uploaded' });
    }

    const { originalname, mimetype, size, buffer } = req.file;
    const safeName = `${Date.now()}_draft_${originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const savedPath = `${UPLOAD_REL}/${safeName}`;
    const filePath = path.join(UPLOAD_DIR, safeName);

    try {
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(filePath, buffer);
    } catch (err) {
      return res.json({ errorCode: 9311, errorMessage: `File save failed: ${err.message}` });
    }

    try {
      const draft = await draftSyncService.addAttachment(id, {
        filename: originalname,
        mimeType: mimetype,
        size,
        savedPath,
        contentBytes: buffer.toString('base64'),
      });
      return res.json({ respCode: 200, respMessage: 'Attachment added', data: mapDraft(draft) });
    } catch (err) {
      // Clean up the saved file if DB update failed
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
      return res.json({ errorCode: 9312, errorMessage: err.message });
    }
  },

  async removeAttachment(req, res) {
    const { id, index } = req.params;
    try {
      const draft = await draftSyncService.removeAttachment(id, Number(index));
      return res.json({ respCode: 200, respMessage: 'Attachment removed', data: mapDraft(draft) });
    } catch (err) {
      return res.json({ errorCode: 9313, errorMessage: err.message });
    }
  },
};

export default draftCtrl;
