/**
 * OutlookCategoryConfig
 *
 * Stores the user-configurable Outlook category label mappings per email account.
 * When missing, the service falls back to the hardcoded defaults in
 * outlookCategorySync.service.js so existing accounts keep working without migration.
 *
 * Shape of each map entry:
 *   { dbValue: string, outlookLabel: string, colour: string, enabled: boolean }
 *
 * Collections:
 *   outlook_category_configs
 */
import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import APIError from '../../helpers/APIError';

const CategoryEntrySchema = new mongoose.Schema({
  // The value as stored in our DB (e.g. "Finance & Invoices", "Critical", "invoice")
  dbValue:      { type: String, required: true },
  // The label pushed to Outlook (e.g. "💰 Finance")
  outlookLabel: { type: String, required: true },
  // Graph preset colour name (e.g. "preset4"); "none" = no colour
  colour:       { type: String, default: 'none' },
  // When false the mapping is skipped — no label pushed for this value
  enabled:      { type: Boolean, default: true },
}, { _id: false });

const OutlookCategoryConfigSchema = new mongoose.Schema({
  // Owning account (email_analysis_mail.email)
  email: { type: String, index: true, required: true, unique: true },

  // Priority level map (Critical / High / Medium / Low)
  priorityMap:  { type: [CategoryEntrySchema], default: [] },

  // AI category map (Action Required, Finance & Invoices, …)
  categoryMap:  { type: [CategoryEntrySchema], default: [] },

  // AI intent map (approval-request, deadline, invoice, …)
  intentMap:    { type: [CategoryEntrySchema], default: [] },

  // Whether to push the "💬 Reply Needed" label for needsReply emails
  replyNeededEnabled: { type: Boolean, default: true },
  replyNeededLabel:   { type: String,  default: '💬 Reply Needed' },
  replyNeededColour:  { type: String,  default: 'preset6' },

  active: { type: Boolean, default: true },
}, { usePushEach: true, timestamps: true });

OutlookCategoryConfigSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving outlook category config', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef OutlookCategoryConfig
 */
export default mongoose.model(
  'outlookCategoryConfig',
  OutlookCategoryConfigSchema,
  'outlook_category_configs',
);
