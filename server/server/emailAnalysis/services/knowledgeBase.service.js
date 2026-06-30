/**
 * Knowledge Base service — CRUD helpers for KnowledgeBaseConfig.
 * Used by the report pipeline and the API controllers.
 */
import KnowledgeBaseConfig from '../models/knowledgeBaseConfig.model';

const DEFAULT_KB = {
  keywords: {
    critical: ['FDA', 'Form 483', 'OOS', 'recall', 'deviation', 'data integrity', 'urgent', 'escalation'],
    important: ['CAPA', 'audit', 'inspection', 'deadline', 'approval', 'review'],
    low: ['FYI', 'newsletter', 'update', 'automated'],
    categories: {},
  },
  thresholds: {
    criticalScore: 80,
    elevatedScore: 50,
    escalationScore: 70,
  },
  glossary: {},
  promptInstruction: '',
};

/**
 * Return the active KB config for an email account, or the built-in defaults
 * if no config has been saved yet.
 */
export async function getActiveKnowledgeBaseConfig(email) {
  if (!email) return { ...DEFAULT_KB };
  const doc = await KnowledgeBaseConfig.findOne({ email, isActive: true })
    .sort({ updatedAt: -1 })
    .lean();
  if (!doc) return { ...DEFAULT_KB };
  return doc;
}

/** Upsert (create or overwrite) the KB config for an account. */
export async function saveKnowledgeBaseConfig(email, data) {
  let doc = await KnowledgeBaseConfig.findOne({ email });
  if (!doc) doc = new KnowledgeBaseConfig({ email });

  if (data.keywords !== undefined) doc.keywords = data.keywords;
  if (data.thresholds !== undefined) doc.thresholds = data.thresholds;
  if (data.glossary !== undefined) doc.glossary = data.glossary;
  if (data.promptInstruction !== undefined) doc.promptInstruction = data.promptInstruction;
  doc.isActive = true;

  doc.markModified('keywords');
  doc.markModified('glossary');

  return KnowledgeBaseConfig.saveData(doc);
}

/** Patch only the keywords sub-document. */
export async function patchKeywords(email, keywords) {
  const doc = await KnowledgeBaseConfig.findOne({ email });
  if (!doc) return saveKnowledgeBaseConfig(email, { keywords });
  doc.keywords = { ...doc.keywords, ...keywords };
  doc.markModified('keywords');
  return KnowledgeBaseConfig.saveData(doc);
}

/** Patch only the glossary. */
export async function patchGlossary(email, glossary) {
  const doc = await KnowledgeBaseConfig.findOne({ email });
  if (!doc) return saveKnowledgeBaseConfig(email, { glossary });
  doc.glossary = { ...doc.glossary, ...glossary };
  doc.markModified('glossary');
  return KnowledgeBaseConfig.saveData(doc);
}

export default {
  getActiveKnowledgeBaseConfig,
  saveKnowledgeBaseConfig,
  patchKeywords,
  patchGlossary,
  DEFAULT_KB,
};
