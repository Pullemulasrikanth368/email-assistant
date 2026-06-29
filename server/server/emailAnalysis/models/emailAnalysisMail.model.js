import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Email Analysis Mail Schema
 *
 * Stores mails fetched for the email-analysis feature. Kept separate from the
 * existing `mail` collection so this flow never reads/writes the login-driven
 * mail pipeline.
 *
 * Shape mirrors the object produced by GmailMessagesService#formatMessage,
 * with attachments rewritten to saved-file metadata.
 */
const EmailAnalysisAttachmentSchema = new mongoose.Schema({
  filename: { type: String },
  mimeType: { type: String },
  size: { type: Number },
  savedPath: { type: String },   // relative path under the server upload folder
  saved: { type: Boolean, default: false },
  error: { type: String },
}, { _id: false });

const EmailAnalysisMailSchema = new mongoose.Schema({
  // owning connected account (email_analysis_user.email)
  email: { type: String, index: true },
  provider: { type: String, default: 'gmail' },

  from: { type: String },
  to: { type: String },
  cc: { type: [String], default: [] },
  bcc: { type: [String], default: [] },
  replyTo: { type: String },
  subject: { type: String },
  body: { type: String },
  snippet: { type: String },

  labels: { type: [String], default: [] },
  mimeType: { type: String },

  providerMessageId: { type: String, index: true },
  threadId: { type: String },
  receivedAt: { type: Date },

  attachments: { type: [EmailAnalysisAttachmentSchema], default: [] },
  hasAttachments: { type: Boolean, default: false },
  isRepliedMail: { type: Boolean, default: false },

  // AI intent-based priority (assigned per day after sync).
  priority: { type: String, default: null },        // Critical | High | Medium | Low
  priorityScore: { type: Number, default: null },   // 1-100
  intent: { type: String, default: null },          // e.g. approval-request, deadline, fyi
  priorityReason: { type: String, default: null },
  prioritizedAt: { type: Date, default: null },

  active: { type: Boolean, default: true },
  // Set when removed via one-click cleanup (soft-delete). Drives dashboard
  // "removed" counts and records when/why it was cleaned up.
  removedAt: { type: Date, default: null },
  removedReason: { type: String, default: null },
}, { usePushEach: true, timestamps: true });

EmailAnalysisMailSchema.index({ email: 1, providerMessageId: 1 }, { unique: true });

/**
 * Statics
 */
EmailAnalysisMailSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) {
          return saved;
        }
        const err = new APIError('Error saving email analysis mail', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef EmailAnalysisMail
 */
export default mongoose.model('emailAnalysisMail', EmailAnalysisMailSchema, 'email_analysis_mails');
