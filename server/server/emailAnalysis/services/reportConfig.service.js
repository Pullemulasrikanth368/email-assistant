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

const sanitizeColumnAssignments = (assignments, columnCount) => {
  const src = assignments && typeof assignments === 'object' ? assignments : {};
  const out = {};
  Object.keys(src).forEach((key) => {
    if (!ALL_SECTIONS.includes(key)) return;
    const col = Number(src[key]);
    if (Number.isInteger(col) && col >= 0 && col < columnCount) out[key] = col;
  });
  return out;
};

const sanitizeOrder = (order, enabledSections) => {
  const orderedKnown = keepKnown(order, ALL_SECTIONS, enabledSections);
  // sections missing from a partial order are appended in default order, so nothing silently disappears.
  return [...orderedKnown, ...enabledSections.filter((key) => !orderedKnown.includes(key))];
};

// { "1": { sectionOrder, columnAssignments }, "2": {...}, "3": {...}, "4": {...} } — kept
// independently so the col-1/2/3/4 arrangements the user designed each survive a viewport switch.
const sanitizeColumnLayouts = (layouts, enabledSections) => {
  const src = layouts && typeof layouts === 'object' ? layouts : {};
  const out = {};
  [1, 2, 3, 4].forEach((n) => {
    const raw = src[n] || src[String(n)];
    if (!raw) return;
    out[n] = {
      sectionOrder: sanitizeOrder(raw.sectionOrder, enabledSections),
      columnAssignments: sanitizeColumnAssignments(raw.columnAssignments, n),
    };
  });
  return out;
};

const DEFAULT_ROW_MAX_HEIGHT = 400;

const DEFAULT_ROWS = [
  { maxHeight: 400, columns: [{ width: 12, sections: ['narrativeSummary'] }] },
  { maxHeight: 400, columns: [{ width: 12, sections: ['inboxTriage'] }] },
  { maxHeight: 400, columns: [
    { width: 4, sections: ['decisionQueue'] },
    { width: 4, sections: ['riskRadar'] },
    { width: 4, sections: ['riskMatrix'] },
  ] },
  { maxHeight: 400, columns: [
    { width: 4, sections: ['todoList'] },
    { width: 4, sections: ['events'] },
    { width: 4, sections: ['calendarConflicts'] },
  ] },
  { maxHeight: 400, columns: [
    { width: 6, sections: ['patterns'] },
    { width: 6, sections: ['actionRegister'] },
  ] },
];

const clampMaxHeight = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ROW_MAX_HEIGHT;
  return Math.min(1200, Math.max(200, Math.round(n)));
};

// Rebalance a row's widths so they total 12 (each 1..12, at least 1 per column).
const balanceWidths = (widths) => {
  const out = widths.map((w) => {
    const n = Math.round(Number(w));
    return Number.isFinite(n) ? Math.min(12, Math.max(1, n)) : 0;
  });
  const missing = out.filter((w) => !w).length;
  if (missing) {
    const used = out.reduce((sum, w) => sum + w, 0);
    const share = Math.max(1, Math.floor((12 - used) / missing));
    for (let i = 0; i < out.length; i += 1) if (!out[i]) out[i] = share;
  }
  let diff = 12 - out.reduce((sum, w) => sum + w, 0);
  // Absorb the difference from the right, keeping every column >= 1.
  for (let i = out.length - 1; i >= 0 && diff !== 0; i -= 1) {
    const next = Math.min(12, Math.max(1, out[i] + diff));
    diff -= next - out[i];
    out[i] = next;
  }
  return out;
};

const defaultRowsFor = (enabledSections) => {
  const allowed = new Set(
    enabledSections && enabledSections.length ? enabledSections : ALL_SECTIONS,
  );
  return DEFAULT_ROWS.map((row) => {
    const columns = row.columns
      .map((col) => ({ width: col.width, sections: col.sections.filter((key) => allowed.has(key)) }))
      .filter((col) => col.sections.length);
    if (!columns.length) return null;
    const widths = balanceWidths(columns.map((col) => col.width));
    return {
      maxHeight: row.maxHeight,
      columns: columns.map((col, i) => ({ width: widths[i], sections: col.sections })),
    };
  }).filter(Boolean);
};

// Convert a legacy columnCount/columnLayouts config into the rows shape,
// mirroring the old BriefDashboard placement (explicit assignment else round-robin).
const rowsFromLegacy = (cfg, enabledSections) => {
  const rows = [];
  const sections = enabledSections.filter((key) => key !== 'narrativeSummary');
  if (enabledSections.includes('narrativeSummary')) {
    rows.push({ maxHeight: null, columns: [{ width: 12, sections: ['narrativeSummary'] }] });
  }
  const columnCount = Math.min(4, Math.max(1, Number(cfg.columnCount) || 2));
  const layout = (cfg.columnLayouts && (cfg.columnLayouts[columnCount] || cfg.columnLayouts[String(columnCount)]))
    || { sectionOrder: cfg.sectionOrder, columnAssignments: cfg.columnAssignments };
  const order = sanitizeOrder(layout.sectionOrder, sections).filter((key) => sections.includes(key));
  const assignments = sanitizeColumnAssignments(layout.columnAssignments, columnCount);
  const columns = balanceWidths(Array(columnCount).fill(Math.floor(12 / columnCount)))
    .map((width) => ({ width, sections: [] }));
  order.forEach((key, i) => {
    const col = assignments[key] !== undefined ? assignments[key] : i % columnCount;
    columns[Math.min(col, columnCount - 1)].sections.push(key);
  });
  const filled = columns.filter((col) => col.sections.length);
  if (filled.length) rows.push({ maxHeight: null, columns: filled });
  return rows.length ? rows : defaultRowsFor(enabledSections);
};

/**
 * Normalize any config shape into valid rows: sanitizes a saved rows array,
 * converts legacy columnLayouts configs/snapshots, or falls back to DEFAULT_ROWS.
 */
function normalizeRows(cfg = {}) {
  if (Array.isArray(cfg.rows) && cfg.rows.length) {
    const seen = new Set();
    const rows = cfg.rows.map((row) => {
      const rawCols = (Array.isArray(row && row.columns) ? row.columns : []).slice(0, 4);
      const columns = rawCols.map((col) => ({
        width: col && col.width,
        sections: (Array.isArray(col && col.sections) ? col.sections : []).filter((key) => {
          if (!ALL_SECTIONS.includes(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      })).filter((col) => col.sections.length);
      if (!columns.length) return null;
      const widths = balanceWidths(columns.map((col) => col.width));
      return {
        maxHeight: clampMaxHeight(row && row.maxHeight),
        columns: columns.map((col, i) => ({ width: widths[i], sections: col.sections })),
      };
    }).filter(Boolean);
    if (rows.length) return rows;
  }
  const enabledSections = keepKnown(cfg.enabledSections, ALL_SECTIONS, DEFAULT_SECTIONS);
  const hasLegacyLayout = (cfg.columnLayouts && Object.keys(cfg.columnLayouts).length)
    || (Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length)
    || (cfg.columnAssignments && Object.keys(cfg.columnAssignments).length);
  if (hasLegacyLayout) return rowsFromLegacy(cfg, enabledSections);
  return defaultRowsFor(enabledSections);
}

const sectionsFromRows = (rows) => {
  const out = [];
  rows.forEach((row) => row.columns.forEach((col) => col.sections.forEach((key) => {
    if (!out.includes(key)) out.push(key);
  })));
  return out;
};

function sanitizeReportConfigData(data = {}) {
  const { filters, ...rest } = data;
  const rows = normalizeRows(data);
  // enabledSections is derived from rows when rows drive the layout, so the
  // report pipeline's prompt scoping matches what the user placed on the grid.
  const enabledSections = Array.isArray(data.rows) && data.rows.length
    ? sectionsFromRows(rows)
    : keepKnown(data.enabledSections, ALL_SECTIONS, DEFAULT_SECTIONS);
  const sectionOrder = sanitizeOrder(data.sectionOrder, enabledSections);
  const columnCount = Math.min(4, Math.max(1, Number(data.columnCount) || 2));
  const columnAssignments = sanitizeColumnAssignments(data.columnAssignments, columnCount);
  const columnLayouts = sanitizeColumnLayouts(data.columnLayouts, enabledSections);
  return {
    ...rest,
    rows,
    enabledSections,
    selectedFields: keepKnown(data.selectedFields, ALL_FIELDS, DEFAULT_FIELDS),
    sectionOrder,
    columnCount,
    columnAssignments,
    columnLayouts,
  };
}

const DEFAULT_REPORT_CONFIG = {
  reportName: 'Default View',
  enabledSections: DEFAULT_SECTIONS,
  selectedFields: DEFAULT_FIELDS,
  sectionOrder: DEFAULT_SECTIONS,
  columnCount: 2,
  columnAssignments: {},
  columnLayouts: {},
  rows: DEFAULT_ROWS,
  promptInstruction: '',
  outputStyle: 'detailed',
  isDefault: true,
};

/**
 * Return one report requirements config for an account: by id when given,
 * otherwise the default view (falling back to the most-recent, then to the
 * built-in safe default when nothing has been saved).
 */
export async function getReportConfig(email, id) {
  if (email && id) {
    const doc = await ReportConfig.findOne({ _id: id, email, active: true }).lean();
    return doc ? sanitizeReportConfigData(doc) : null;
  }
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
  if (email) {
    const docs = await ReportConfig.find({ email, active: true })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
    if (docs.length) return docs.map((doc) => sanitizeReportConfigData(doc));
  }
  // Nothing saved yet — return the built-in default so clients always have a view to render.
  return [sanitizeReportConfigData({ ...DEFAULT_REPORT_CONFIG, _id: null })];
}

export async function createReportConfig(email, data) {
  const hasExisting = await ReportConfig.exists({ email, active: true });
  const makeDefault = Boolean(data.isDefault) || !hasExisting;
  if (makeDefault) {
    await ReportConfig.updateMany({ email }, { $set: { isDefault: false } });
  }
  const doc = new ReportConfig({ email });
  Object.assign(doc, sanitizeReportConfigData(data), { email, isDefault: makeDefault, active: true });
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

export async function setDefaultReportConfig(email, id) {
  const doc = await ReportConfig.findOne({ _id: id, email, active: true });
  if (!doc) return null;
  await ReportConfig.updateMany({ email }, { $set: { isDefault: false } });
  doc.isDefault = true;
  return ReportConfig.saveData(doc);
}

export async function deleteReportConfig(email, id) {
  const doc = await ReportConfig.findOne({ _id: id, email, active: true });
  if (!doc) return false;
  doc.active = false;
  await doc.save();
  if (doc.isDefault) {
    // Promote the most recently updated remaining view so brief generation keeps working.
    const next = await ReportConfig.findOne({ email, active: true }).sort({ updatedAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
  return true;
}

export { DEFAULT_REPORT_CONFIG, DEFAULT_ROWS, normalizeRows };

export default {
  getReportConfig,
  listReportConfigs,
  createReportConfig,
  updateReportConfig,
  setDefaultReportConfig,
  deleteReportConfig,
  DEFAULT_REPORT_CONFIG,
  DEFAULT_ROWS,
  normalizeRows,
};
