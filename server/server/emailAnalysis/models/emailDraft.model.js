import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import APIError from '../../helpers/APIError';

const DraftAttachmentSchema = new mongoose.Schema({
  filename: { type: String },
  mimeType: { type: String },
  size: { type: Number },
  savedPath: { type: String },
  saved: { type: Boolean, default: false },
  error: { type: String },
}, { _id: false });

const EmailDraftSchema = new mongoose.Schema({
  // Owning connected account
  email: { type: String, index: true },
  loginUserEmailId: { type: String, index: true },
  provider: { type: String, enum: ['gmail', 'outlook'], default: 'gmail' },

  // Provider-side draft IDs for bidirectional sync
  gmailDraftId: { type: String, default: null },
  outlookDraftId: { type: String, default: null },

  // Email content
  subject: { type: String, default: '' },
  body: { type: String, default: '' },

  // Recipients
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  bcc: { type: [String], default: [] },
  replyTo: { type: String, default: '' },

  // Reply / forward context
  inReplyTo: { type: String, default: null },
  references: { type: String, default: null },
  threadId: { type: String, default: null },
  conversationId: { type: String, default: null },

  attachments: { type: [DraftAttachmentSchema], default: [] },

  // Lifecycle
  status: { type: String, enum: ['draft', 'sending', 'sent', 'failed'], default: 'draft' },
  syncStatus: { type: String, enum: ['synced', 'pending', 'failed'], default: 'pending' },
  syncError: { type: String, default: null },
  lastSyncedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },

  active: { type: Boolean, default: true },
}, { timestamps: true });

EmailDraftSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving draft', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

export default mongoose.model('emailDraft', EmailDraftSchema, 'email_drafts');
