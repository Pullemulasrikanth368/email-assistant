import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../helpers/APIError';

const Schema = mongoose.Schema;

/**
 * Settings Model — trimmed to only the fields needed for the
 * Executive Email Assistant feature. The emailAnalysis* fields
 * drive report scheduling, Gmail spam inclusion, and AI model selection.
 */
const SettingsSchema = new mongoose.Schema({
  // Core identity / activation
  active: { type: Boolean, default: true },
  companyName: { type: String },
  companyImg: { type: String },
  adminEmail: { type: String },

  // SendGrid (used in emailAnalysis bulk-send if sendGrid path is chosen)
  sendGridApiKey: { type: String },
  sendGridEmail: { type: String },

  // Misc shared fields referenced by some services
  logs: { type: Array },
  updated: { type: Date },
  created: { type: Date, default: Date.now },

  // AI type stored in settings (read by analytics/report services)
  aiType: {
    type: String,
    enum: ["openai", "ollama"],
    default: "openai"
  },

  // -----------------------------------------------------------------
  // Email Analysis specific fields
  // -----------------------------------------------------------------

  // Time-of-day (24h "HH:mm", server timezone) the email-analysis brief/report
  // is generated. Drives a dynamic node-cron job.
  emailAnalysisBriefTime: { type: String, default: "06:00" },

  // When true, the email-analysis Gmail sync also reads Spam mail.
  emailAnalysisIncludeSpam: { type: Boolean, default: false },

  // AI backend for the email-analysis flow: "openai" (default) or "ollama".
  emailAnalysisModel: { type: String, default: "openai" },

}, { usePushEach: true, timestamps: true });

/**
 * Statics
 */
SettingsSchema.statics = {
  /**
   * Save and update settings
   */
  saveData(settings) {
    return settings.save()
      .then((saved) => {
        if (saved) {
          return saved;
        }
        const err = new APIError('Error saving settings', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List settings in descending order of 'createdAt' timestamp.
   */
  list(query) {
    return this.find(query.filter)
      .sort(query.sorting)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec();
  },

  /**
   * Count of settings records
   */
  totalCount(query) {
    return this.find(query.filter)
      .countDocuments();
  },

  /**
   * Get settings by id
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((settings) => {
        if (settings) {
          return settings;
        }
        const err = new APIError('No such settings exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef Settings
 */
export default mongoose.model('Settings', SettingsSchema);
