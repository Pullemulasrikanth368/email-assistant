import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

const ALL_SECTIONS = [
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'riskMatrix', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

const DEFAULT_SECTIONS = [
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'riskMatrix', 'todoList',
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

  // Display order of sections in the report (subset/superset resolved against ALL_SECTIONS at render time).
  sectionOrder: { type: [String], default: DEFAULT_SECTIONS, enum: ALL_SECTIONS },

  // How many columns to lay the sections out in.
  columnCount: { type: Number, default: 2, min: 1, max: 4 },

  // Explicit column placement per section, e.g. { decisionQueue: 0, riskRadar: 1 }.
  // Sections with no entry here fall back to a round-robin placement at render time.
  // (Legacy/top-level — mirrors columnLayouts[columnCount] for older readers.)
  columnAssignments: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Per-column-count layout, remembered independently: { "1": {...}, "2": {...}, "3": {...} },
  // each { sectionOrder, columnAssignments }. Lets the live report use the arrangement the
  // user actually designed for 1/2/3 columns instead of re-deriving one when the viewport
  // forces a narrower column count than what's configured.
  columnLayouts: { type: mongoose.Schema.Types.Mixed, default: {} },

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
