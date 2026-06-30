import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Email Analysis Report
 *
 * A generated "morning brief" for a connected account, over a day (or week)
 * window. The `brief` field holds the full engine output (see CONTRACT.md);
 * it is stored as Mixed so the brief shape can evolve without a migration.
 */
const EmailAnalysisReportSchema = new mongoose.Schema({
  email: { type: String, index: true },

  reportType: { type: String, enum: ['day', 'week'], default: 'day', index: true },
  periodStart: { type: Date },
  periodEnd: { type: Date },
  periodLabel: { type: String },

  // Full brief JSON (narrative, triage, decisionQueue, risks, todoList,
  // actions, collisions, patterns, deadlines).
  brief: { type: mongoose.Schema.Types.Mixed, default: {} },

  source: { type: String, enum: ['live', 'sample'], default: 'sample' },
  generatedAt: { type: Date },

  // Absolute path to the rendered, self-contained .md dashboard for this report.
  mdPath: { type: String },

  // Convenience counters for the report list cards.
  counts: {
    critical: { type: Number, default: 0 },
    decisions: { type: Number, default: 0 },
    risks: { type: Number, default: 0 },
    actions: { type: Number, default: 0 },
  },

  active: { type: Boolean, default: true },

  // Snapshots of the configs that were active when this report was generated.
  // Stored so old reports can show exactly what rules/settings produced them.
  knowledgeBaseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  reportConfigSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

  // Summary of keywords that were matched across all emails in this report.
  matchedKeywordsSummary: { type: mongoose.Schema.Types.Mixed, default: null },
  // Which sections and fields were active at generation time.
  reportSectionsUsed: { type: [String], default: [] },
  selectedFieldsUsed: { type: [String], default: [] },
}, { usePushEach: true, timestamps: true });

EmailAnalysisReportSchema.index({ email: 1, reportType: 1, periodStart: 1 }, { unique: true });

EmailAnalysisReportSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving email analysis report', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef EmailAnalysisReport
 */
export default mongoose.model('emailAnalysisReport', EmailAnalysisReportSchema, 'email_analysis_reports');
