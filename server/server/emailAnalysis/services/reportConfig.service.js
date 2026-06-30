/**
 * Report Config service — CRUD helpers for ReportConfig.
 * Used by the report pipeline and the API controllers.
 */
import ReportConfig, {
  ALL_FIELDS,
  ALL_SECTIONS,
  DEFAULT_FIELDS,
  DEFAULT_SECTIONS,
} from '../models/reportConfig.model';

const keepKnown = (values = [], allowed = [], fallback = []) => {
  const allowedSet = new Set(allowed);
  const filtered = (Array.isArray(values) ? values : []).filter((value) => allowedSet.has(value));
  return filtered.length ? filtered : [...fallback];
};

function sanitizeReportConfigData(data = {}) {
  return {
    ...data,
    enabledSections: keepKnown(data.enabledSections, ALL_SECTIONS, DEFAULT_SECTIONS),
    selectedFields: keepKnown(data.selectedFields, ALL_FIELDS, DEFAULT_FIELDS),
  };
}

const DEFAULT_REPORT_CONFIG = {
  reportName: 'Default Config',
  enabledSections: DEFAULT_SECTIONS,
  selectedFields: DEFAULT_FIELDS,
  filters: {
    dateRange: { from: '', to: '' },
    senderEmail: [],
    senderDomain: [],
    department: [],
    priority: [],
    hasAttachments: false,
    unreadOnly: false,
    requiresReply: false,
    containsKbKeywords: false,
    escalationRequired: false,
  },
  promptInstruction: '',
  outputStyle: 'detailed',
  isDefault: true,
};

/**
 * Return the single default report requirements config for an account, or the
 * built-in safe default when nothing has been saved.
 */
export async function getReportConfig(email) {
  if (email) {
    const def = await ReportConfig.findOne({ email, isDefault: true, active: true })
      .sort({ updatedAt: -1 })
      .lean();
    if (def) return sanitizeReportConfigData(def);
    // Fall back to the most-recent config for this account.
    const any = await ReportConfig.findOne({ email, active: true })
      .sort({ updatedAt: -1 })
      .lean();
    if (any) return sanitizeReportConfigData(any);
  }
  return sanitizeReportConfigData({ ...DEFAULT_REPORT_CONFIG });
}

export async function listReportConfigs(email) {
  const config = await getReportConfig(email);
  return config ? [config] : [];
}

export async function createReportConfig(email, data) {
  // Keep one report requirements config per account. Creating again updates
  // the existing default/latest config instead of adding another option.
  let doc = await ReportConfig.findOne({ email, active: true, isDefault: true });
  if (!doc) doc = await ReportConfig.findOne({ email, active: true }).sort({ updatedAt: -1 });
  if (!doc) doc = new ReportConfig({ email });

  Object.assign(doc, sanitizeReportConfigData(data), { email, isDefault: true, active: true });
  return ReportConfig.saveData(doc);
}

export async function updateReportConfig(email, id, data) {
  const doc = await ReportConfig.findOne({ _id: id, email, active: true });
  if (!doc) return null;

  if (data.isDefault && !doc.isDefault) {
    await ReportConfig.updateMany({ email }, { $set: { isDefault: false } });
  }

  Object.assign(doc, sanitizeReportConfigData(data));
  return ReportConfig.saveData(doc);
}

export async function deleteReportConfig(email, id) {
  const doc = await ReportConfig.findOne({ _id: id, email, active: true });
  if (!doc) return false;
  doc.active = false;
  await doc.save();
  return true;
}

export { DEFAULT_REPORT_CONFIG };

export default {
  getReportConfig,
  listReportConfigs,
  createReportConfig,
  updateReportConfig,
  deleteReportConfig,
  DEFAULT_REPORT_CONFIG,
};
