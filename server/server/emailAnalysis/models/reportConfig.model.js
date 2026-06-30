import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

const ALL_SECTIONS = [
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

const DEFAULT_SECTIONS = [
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

const ALL_FIELDS = [
  'category', 'matchedKeywords', 'riskScore', 'clock', 'trend',
  'reason', 'owner', 'deadline',
];

const DEFAULT_FIELDS = [
  'category', 'matchedKeywords', 'riskScore', 'clock', 'trend',
  'reason', 'owner', 'deadline',
];

const ReportConfigSchema = new mongoose.Schema({
  email: { type: String, index: true, required: true },

  reportName: { type: String, default: 'Default Config' },

  enabledSections: { type: [String], default: DEFAULT_SECTIONS, enum: ALL_SECTIONS },

  selectedFields: { type: [String], default: DEFAULT_FIELDS, enum: ALL_FIELDS },

  /**
   * User-facing generation requirement, e.g.
   * "List all events mentioned in the emails" or "Only show items needing my approval".
   * This shapes what appears in the report; Knowledge Base remains responsible
   * for email categorization, priority, and risk-analysis rules.
   */
  promptInstruction: { type: String, default: '' },

  // 'short' | 'detailed' | 'bullet' | 'executive' | 'department' | 'daily' | 'weekly'
  outputStyle: { type: String, default: 'detailed' },

  isDefault: { type: Boolean, default: false },

  active: { type: Boolean, default: true },
}, { usePushEach: true, timestamps: true });

ReportConfigSchema.index({ email: 1, isDefault: 1 });

ReportConfigSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving report config', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

export { ALL_SECTIONS, DEFAULT_SECTIONS, ALL_FIELDS, DEFAULT_FIELDS };

/**
 * @typedef ReportConfig
 */
export default mongoose.model('reportConfig', ReportConfigSchema, 'report_configs');
