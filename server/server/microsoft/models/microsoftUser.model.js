import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Microsoft User Schema
 *
 * Stores the Microsoft (Entra ID) account connected for Teams message delivery.
 * Kept fully separate from the login/accessTokens flow and from the Google
 * email-analysis account, mirroring emailAnalysisUser.
 */
const MicrosoftUserSchema = new mongoose.Schema({
  email: {
    type: String,
  },
  name: {
    type: String,
  },
  // Microsoft Graph object id of the signed-in user.
  microsoftId: {
    type: String,
  },
  provider: {
    type: String,
    default: 'microsoft',
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
  // Absolute expiry of the current access token.
  expiryDate: {
    type: Date,
  },
  // Default Teams destination the user picked for briefs (optional).
  defaultTeamId: {
    type: String,
  },
  defaultChannelId: {
    type: String,
  },
  active: {
    type: Boolean,
    default: true,
  },
}, { usePushEach: true, timestamps: true });

MicrosoftUserSchema.statics = {
  /**
   * Save / update a microsoft user document.
   * @param doc
   * @returns {Promise<MicrosoftUser, APIError>}
   */
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) {
          return saved;
        }
        const err = new APIError('Error saving microsoft user', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef MicrosoftUser
 */
export default mongoose.model('microsoftUser', MicrosoftUserSchema, 'microsoft_user');
