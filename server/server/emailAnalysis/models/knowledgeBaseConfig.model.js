import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

const KnowledgeBaseConfigSchema = new mongoose.Schema({
  email: { type: String, index: true, required: true },

  keywords: {
    critical: { type: [String], default: ['FDA', 'Form 483', 'OOS', 'recall', 'deviation', 'data integrity', 'urgent', 'escalation'] },
    important: { type: [String], default: ['CAPA', 'audit', 'inspection', 'deadline', 'approval', 'review'] },
    low: { type: [String], default: ['FYI', 'newsletter', 'update', 'automated'] },
    categories: { type: mongoose.Schema.Types.Mixed, default: {} }, // { "Quality": ["OOS","deviation"], ... }
  },

  thresholds: {
    criticalScore: { type: Number, default: 80 },
    elevatedScore: { type: Number, default: 50 },
    escalationScore: { type: Number, default: 70 },
  },

  // { "OOS": "Out of Specification", "CAPA": "Corrective and Preventive Action" }
  glossary: { type: mongoose.Schema.Types.Mixed, default: {} },

  promptInstruction: { type: String, default: '' },

  isActive: { type: Boolean, default: true },
}, { usePushEach: true, timestamps: true });

// One active config per email.
KnowledgeBaseConfigSchema.index({ email: 1, isActive: 1 });

KnowledgeBaseConfigSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving knowledge base config', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef KnowledgeBaseConfig
 */
export default mongoose.model('knowledgeBaseConfig', KnowledgeBaseConfigSchema, 'knowledge_base_configs');
