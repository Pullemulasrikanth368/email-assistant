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

  // Set when this row mirrors an app-created draft from email_drafts.
  localDraftId: { type: mongoose.Schema.Types.ObjectId, ref: 'emailDraft', default: null, index: true },

  attachments: { type: [EmailAnalysisAttachmentSchema], default: [] },
  hasAttachments: { type: Boolean, default: false },
  isRepliedMail: { type: Boolean, default: false },

  // AI intent-based priority (assigned per day after sync).
  priority: { type: String, default: null },        // Critical | High | Medium | Low
  priorityScore: { type: Number, default: null },   // 1-100
  intent: { type: String, default: null },          // e.g. approval-request, deadline, fyi
  priorityReason: { type: String, default: null },
  prioritizedAt: { type: Date, default: null },
  // AI mail category (assigned alongside priority).
  category: { type: String, default: null },        // e.g. Action Required, Finance, Newsletters
  // AI judgement (assigned alongside priority): does this mail expect a
  // written reply from the recipient? Drives auto-draft creation — meeting
  // invites, invoices, notifications etc. stay false and get no draft.
  needsReply: { type: Boolean, default: null },
  // Draft auto-created for a needs-reply mail during categorization.
  autoDraftId: { type: mongoose.Schema.Types.ObjectId, ref: 'emailDraft', default: null },

  // One-click quick-reply options — generated once when the mail is
  // categorized (prioritize pass) and stored, so the UI never waits on AI.
  quickReplies: {
    eligible: { type: Boolean, default: null },
    options: {
      type: [new mongoose.Schema({ label: { type: String }, reply: { type: String } }, { _id: false })],
      default: [],
    },
    generatedAt: { type: Date, default: null },
  },

  // Cached AI-drafted reply — generated once when the mail is read, reused on
  // every later open; "Regenerate" in the UI overwrites it.
  aiReply: {
    text: { type: String, default: null },
    provider: { type: String, default: null },
    threadCount: { type: Number, default: 0 },
    generatedAt: { type: Date, default: null },
  },

  // AI-generated summary of the entire thread/conversation.
  threadSummary: { type: String, default: null },

  // Which provider folder the mail was synced from, and whether it was junk.
  sourceFolder: { type: String, default: 'inbox' }, // inbox | junk
  isJunk: { type: Boolean, default: false },
  // Set when an important junk mail was auto-moved back to the inbox.
  junkRescuedAt: { type: Date, default: null },

  active: { type: Boolean, default: true },
  categoriesSynced: { type: Boolean, default: false, index: true },
  // Set when removed via one-click cleanup (soft-delete). Drives dashboard
  // "removed" counts and records when/why it was cleaned up.
  removedAt: { type: Date, default: null },
  removedReason: { type: String, default: null },
}, { usePushEach: true, timestamps: true });

EmailAnalysisMailSchema.index({ email: 1, provider: 1, providerMessageId: 1 }, { unique: true });

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
