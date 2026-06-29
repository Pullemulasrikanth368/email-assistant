import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Email Analysis User Schema
 *
 * Stores the mailbox account connected specifically for the email-analysis
 * feature. This is intentionally separate from the existing auth/accessTokens
 * flow so that connecting/disconnecting here never touches the login flow.
 */
const EmailAnalysisUserSchema = new mongoose.Schema({
  email: {
    type: String,
  },
  name: {
    type: String,
  },
  picture: {
    type: String,
  },
  googleId: {
    type: String,
  },
  microsoftId: {
    type: String,
  },
  providerUserId: {
    type: String,
  },
  // The admin app user (their login email) who connected this account — so the
  // inbox/analytics can be scoped to the account THIS logged-in user linked.
  loginUserEmailId: {
    type: String,
    default: null,
  },
  provider: {
    type: String,
    default: 'google',
  },
  // 'source' = read & analyze this inbox (default). 'send' = connected only to
  // send bulk mail FROM — never read/synced/saved into the mail collection.
  purpose: {
    type: String,
    default: 'source',
  },
  accessToken: {
    type: String,
  },
  refreshToken: {
    type: String,
  },
  scope: {
    type: String,
  },
  idToken: {
    type: String,
  },
  expiryDate: {
    type: Date,
  },
  // Gmail History API cursor: the historyId captured at the end of the last
  // successful sync. Used to fetch only messages added since then.
  historyId: {
    type: String,
  },
  // Microsoft Graph delta cursor for Outlook incremental sync.
  deltaLink: {
    type: String,
  },
  // Whether the one-time initial backfill (last 7 days) has run.
  initialSyncDone: {
    type: Boolean,
    default: false,
  },
  lastSyncedAt: {
    type: Date,
  },
  active: {
    type: Boolean,
    default: true,
  },
}, { usePushEach: true, timestamps: true });

/**
 * Statics
 */
EmailAnalysisUserSchema.statics = {

  /**
   * Save / update an email-analysis user document.
   * @param doc
   * @returns {Promise<EmailAnalysisUser, APIError>}
   */
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) {
          return saved;
        }
        const err = new APIError('Error saving email analysis user', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef EmailAnalysisUser
 */
export default mongoose.model('emailAnalysisUser', EmailAnalysisUserSchema, 'email_analysis_user');
