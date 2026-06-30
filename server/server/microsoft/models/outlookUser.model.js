import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Outlook User Schema
 *
 * Stores the Microsoft (Entra ID / M365) account connected specifically for
 * Outlook email-analysis reading. Kept separate from:
 *  - the login/accessTokens flow
 *  - the Teams delivery account (MicrosoftUser / microsoft_user)
 *  - the Gmail source account (EmailAnalysisUser / email_analysis_users)
 *
 * Collection: `outlook_users`
 */
const OutlookUserSchema = new mongoose.Schema({
  // Primary identity — the Outlook / M365 mailbox email address.
  email: {
    type: String,
    index: true,
  },
  name: {
    type: String,
  },

  // Microsoft Entra ID object id.
  microsoftId: {
    type: String,
  },

  // The admin app user (their login email) who connected this account, so the
  // inbox/analytics can be scoped to the account THIS logged-in user linked.
  loginUserEmailId: {
    type: String,
  },

  provider: {
    type: String,
    default: 'outlook',
  },

  // OAuth tokens from Microsoft identity platform.
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

  // Absolute expiry of the current access token.
  expiryDate: {
    type: Date,
  },

  /**
   * Microsoft Graph delta cursor.
   * Stored after the initial sync and used for all subsequent incremental syncs.
   * Replaces Gmail's `historyId` for Outlook accounts.
   * Format: full OData nextLink / deltaLink URL.
   */
  deltaLink: {
    type: String,
  },

  // Whether the one-time initial backfill (last 30 days) has run.
  initialSyncDone: {
    type: Boolean,
    default: false,
  },

  // Timestamp of the last successful sync run.
  lastSyncedAt: {
    type: Date,
  },

  // Is the account actively connected?
  active: {
    type: Boolean,
    default: true,
  },

  // Account purpose: "source" (read + analyze) | "send" (send-only / bulk-send).
  // Only "source" accounts are synced and briefed.
  purpose: {
    type: String,
    default: 'source',
  },
}, { usePushEach: true, timestamps: true });

OutlookUserSchema.statics = {
  /**
   * Save / update an outlook user document.
   * @param {OutlookUser} doc
   * @returns {Promise<OutlookUser>}
   */
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving Outlook user', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef OutlookUser
 */
export default mongoose.model('outlookUser', OutlookUserSchema, 'outlook_users');
