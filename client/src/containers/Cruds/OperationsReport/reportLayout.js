/**
 * Shared row-based report layout model.
 *
 * A layout is rows: [{ maxHeight, columns: [{ width (1-12), sections: [sectionKey] }] }].
 * Widths within a row total 12 (bootstrap-style col-N); each section key appears at most
 * once across all rows. Used by both BriefDashboard (render) and the Report Configuration
 * screen (edit); mirrors the server's reportConfig.service normalization.
 */

export const ALL_SECTIONS = [
  // { key: 'narrativeSummary', label: 'AI Email Summary' },
  { key: 'decisionQueue', label: 'Decisions needed today' },
  { key: 'riskRadar', label: 'Risk radar' },
  { key: 'riskMatrix', label: 'Risk matrix' },
  { key: 'todoList', label: 'Your to-do' },
  { key: 'events', label: 'Events mentioned' },
  { key: 'calendarConflicts', label: 'Schedule collisions' },
  { key: 'patterns', label: 'Patterns' },
  { key: 'categorySummaries', label: 'AI Category wise summary' },
  { key: 'inboxTriage', label: 'Inbox triage' },
  { key: 'actionRegister', label: 'Action register' },
];

export const SECTION_KEYS = ALL_SECTIONS.map((item) => item.key);
const sectionKeySet = new Set(SECTION_KEYS);

export const sectionLabel = (key) => ALL_SECTIONS.find((item) => item.key === key)?.label || key;

export const DEFAULT_ROW_MAX_HEIGHT = 400;
export const MAX_COLUMNS_PER_ROW = 4;

export const DEFAULT_ROWS = [
  { maxHeight: 400, columns: [{ width: 12, sections: ['narrativeSummary'] }] },
  { maxHeight: 400, columns: [{ width: 12, sections: ['categorySummaries'] }] },
  { maxHeight: 400, columns: [{ width: 12, sections: ['inboxTriage'] }] },
  {
    maxHeight: 400, columns: [
      { width: 4, sections: ['decisionQueue'] },
      { width: 4, sections: ['riskRadar'] },
      { width: 4, sections: ['riskMatrix'] },
    ]
  },
  {
    maxHeight: 400, columns: [
      { width: 4, sections: ['todoList'] },
      { width: 4, sections: ['events'] },
      { width: 4, sections: ['calendarConflicts'] },
    ]
  },
  {
    maxHeight: 400, columns: [
      { width: 6, sections: ['patterns'] },
      { width: 6, sections: ['actionRegister'] },
    ]
  },
];

const deepCopyRows = (rows) => rows.map((row) => ({
  maxHeight: row.maxHeight,
  columns: row.columns.map((col) => ({ width: col.width, sections: [...col.sections] })),
}));

export const clampMaxHeight = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ROW_MAX_HEIGHT;
  return Math.min(1200, Math.max(200, Math.round(n)));
};

// Rebalance a row's widths so they total 12 (each 1..12, at least 1 per column).
export const balanceWidths = (widths) => {
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
  for (let i = out.length - 1; i >= 0 && diff !== 0; i -= 1) {
    const next = Math.min(12, Math.max(1, out[i] + diff));
    diff -= next - out[i];
    out[i] = next;
  }
  return out;
};

// Set one column's width, absorbing the difference in the OTHER columns
// (right-to-left, each kept between 1 and 12) so the row still totals 12.
export const adjustWidths = (widths, changedIdx, newWidth) => {
  const out = widths.map((w) => Math.min(12, Math.max(1, Math.round(Number(w)) || 1)));
  out[changedIdx] = Math.min(12, Math.max(1, Math.round(Number(newWidth)) || 1));
  let diff = 12 - out.reduce((sum, w) => sum + w, 0);
  for (let i = out.length - 1; i >= 0 && diff !== 0; i -= 1) {
    if (i === changedIdx) continue;
    const next = Math.min(12, Math.max(1, out[i] + diff));
    diff -= next - out[i];
    out[i] = next;
  }
  // Single-column row (or nothing left to absorb into): the changed column takes the remainder.
  if (diff !== 0) out[changedIdx] = Math.min(12, Math.max(1, out[changedIdx] + diff));
  return out;
};

export const defaultRowsFor = (enabledSections) => {
  const allowed = new Set(
    Array.isArray(enabledSections) && enabledSections.length ? enabledSections : SECTION_KEYS,
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

// Convert a legacy columnCount/columnLayouts config (or reportConfigSnapshot) into rows,
// mirroring the old BriefDashboard placement: explicit columnAssignments else round-robin.
const rowsFromLegacy = (cfg, enabledSections) => {
  const rows = [];
  const sections = enabledSections.filter((key) => key !== 'narrativeSummary');
  if (enabledSections.includes('narrativeSummary')) {
    rows.push({ maxHeight: null, columns: [{ width: 12, sections: ['narrativeSummary'] }] });
  }
  const columnCount = Math.min(4, Math.max(1, Number(cfg.columnCount) || 2));
  const layout = (cfg.columnLayouts && (cfg.columnLayouts[columnCount] || cfg.columnLayouts[String(columnCount)]))
    || { sectionOrder: cfg.sectionOrder, columnAssignments: cfg.columnAssignments };
  const savedOrder = (Array.isArray(layout.sectionOrder) ? layout.sectionOrder : [])
    .filter((key) => sections.includes(key));
  const order = [...savedOrder, ...sections.filter((key) => !savedOrder.includes(key))];
  const assignments = layout.columnAssignments && typeof layout.columnAssignments === 'object'
    ? layout.columnAssignments : {};
  const columns = balanceWidths(Array(columnCount).fill(Math.floor(12 / columnCount)))
    .map((width) => ({ width, sections: [] }));
  order.forEach((key, i) => {
    const explicit = Number(assignments[key]);
    const col = Number.isInteger(explicit) && explicit >= 0 && explicit < columnCount
      ? explicit : i % columnCount;
    columns[col].sections.push(key);
  });
  const filled = columns.filter((col) => col.sections.length);
  if (filled.length) rows.push({ maxHeight: null, columns: filled });
  return rows.length ? rows : defaultRowsFor(enabledSections);
};

/**
 * Normalize any config shape into valid rows: sanitizes a saved rows array,
 * converts legacy columnLayouts configs/snapshots, or falls back to DEFAULT_ROWS.
 */
export function normalizeRows(cfg = {}) {
  if (Array.isArray(cfg.rows) && cfg.rows.length) {
    const seen = new Set();
    const rows = cfg.rows.map((row) => {
      const rawCols = (Array.isArray(row?.columns) ? row.columns : []).slice(0, MAX_COLUMNS_PER_ROW);
      const columns = rawCols.map((col) => ({
        width: col?.width,
        sections: (Array.isArray(col?.sections) ? col.sections : []).filter((key) => {
          if (!sectionKeySet.has(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      })).filter((col) => col.sections.length);
      if (!columns.length) return null;
      const widths = balanceWidths(columns.map((col) => col.width));
      return {
        maxHeight: clampMaxHeight(row?.maxHeight),
        columns: columns.map((col, i) => ({ width: widths[i], sections: col.sections })),
      };
    }).filter(Boolean);
    if (rows.length) return rows;
  }
  const enabledSections = (Array.isArray(cfg.enabledSections) ? cfg.enabledSections : [])
    .filter((key) => sectionKeySet.has(key));
  const enabled = enabledSections.length ? enabledSections : SECTION_KEYS;
  const hasLegacyLayout = (cfg.columnLayouts && Object.keys(cfg.columnLayouts).length)
    || (Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length)
    || (cfg.columnAssignments && Object.keys(cfg.columnAssignments).length);
  if (hasLegacyLayout) return rowsFromLegacy(cfg, enabled);
  return defaultRowsFor(enabled);
}

/** Flattened, ordered list of every section key placed somewhere on the grid. */
export const sectionsFromRows = (rows) => {
  const out = [];
  (rows || []).forEach((row) => row.columns.forEach((col) => col.sections.forEach((key) => {
    if (!out.includes(key)) out.push(key);
  })));
  return out;
};

/* ---------- Pure row mutators for the configuration screen ---------- */
/* All return a NEW rows array; editing keeps possibly-empty columns/rows around
   (normalizeRows only prunes them on render/save). */

export const addRow = (rows) => [
  ...deepCopyRows(rows),
  { maxHeight: DEFAULT_ROW_MAX_HEIGHT, columns: [{ width: 12, sections: [] }] },
];

export const removeRow = (rows, rowIdx) => deepCopyRows(rows).filter((_, i) => i !== rowIdx);

export const moveRow = (rows, rowIdx, dir) => {
  const next = deepCopyRows(rows);
  const target = rowIdx + dir;
  if (target < 0 || target >= next.length) return next;
  [next[rowIdx], next[target]] = [next[target], next[rowIdx]];
  return next;
};

export const setRowMaxHeight = (rows, rowIdx, value) => {
  const next = deepCopyRows(rows);
  next[rowIdx].maxHeight = value === '' || value === null ? null : Number(value);
  return next;
};

// Change a row's column count: added columns start empty; removed columns'
// sections merge into the last surviving column; widths reset to an even split.
export const setRowColumnCount = (rows, rowIdx, count) => {
  const next = deepCopyRows(rows);
  const n = Math.min(MAX_COLUMNS_PER_ROW, Math.max(1, Number(count) || 1));
  const cols = next[rowIdx].columns;
  if (n < cols.length) {
    const overflow = cols.slice(n).flatMap((col) => col.sections);
    cols.length = n;
    cols[n - 1].sections.push(...overflow);
  } else {
    while (cols.length < n) cols.push({ width: 1, sections: [] });
  }
  const widths = balanceWidths(Array(n).fill(Math.floor(12 / n)));
  cols.forEach((col, i) => { col.width = widths[i]; });
  return next;
};

export const setColumnWidth = (rows, rowIdx, colIdx, width) => {
  const next = deepCopyRows(rows);
  const cols = next[rowIdx].columns;
  const widths = adjustWidths(cols.map((col) => col.width), colIdx, width);
  cols.forEach((col, i) => { col.width = widths[i]; });
  return next;
};

export const addSectionToColumn = (rows, rowIdx, colIdx, key) => {
  if (sectionsFromRows(rows).includes(key)) return rows;
  const next = deepCopyRows(rows);
  next[rowIdx].columns[colIdx].sections.push(key);
  return next;
};

export const removeSection = (rows, key) => deepCopyRows(rows).map((row) => ({
  ...row,
  columns: row.columns.map((col) => ({ ...col, sections: col.sections.filter((k) => k !== key) })),
}));

// Move a section into (rowIdx, colIdx), before `beforeKey` when given (else appended).
export const moveSection = (rows, key, rowIdx, colIdx, beforeKey) => {
  if (!key || key === beforeKey) return rows;
  const next = removeSection(rows, key);
  const sections = next[rowIdx]?.columns[colIdx]?.sections;
  if (!sections) return rows;
  const at = beforeKey ? sections.indexOf(beforeKey) : -1;
  sections.splice(at === -1 ? sections.length : at, 0, key);
  return next;
};
