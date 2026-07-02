import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const ALL_SECTIONS = [
  { key: 'narrativeSummary', label: 'Narrative summary' },
  { key: 'decisionQueue', label: 'Decisions needed today' },
  { key: 'riskRadar', label: 'Risk radar' },
  { key: 'riskMatrix', label: 'Risk matrix' },
  { key: 'todoList', label: 'Your to-do' },
  { key: 'events', label: 'Events mentioned' },
  { key: 'calendarConflicts', label: 'Schedule collisions' },
  { key: 'patterns', label: 'Patterns' },
  { key: 'inboxTriage', label: 'Inbox triage' },
  { key: 'actionRegister', label: 'Action register' },
];

const ALL_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'matchedKeywords', label: 'Matched Keywords' },
  { key: 'riskScore', label: 'Risk Score' },
  { key: 'clock', label: 'Time / Clock' },
  { key: 'trend', label: 'Trend' },
  { key: 'reason', label: 'Reason for Classification' },
  { key: 'owner', label: 'Owner' },
  { key: 'deadline', label: 'Deadline' },
];

const OUTPUT_STYLES = [
  { value: 'detailed', label: 'Detailed' },
  { value: 'short', label: 'Compact' },
  { value: 'bullet', label: 'Bullets' },
  { value: 'executive', label: 'Executive' },
  { value: 'department', label: 'Department-wise' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const REQUIREMENT_PRESETS = [
  'List all events mentioned in the emails with date/time and source email.',
  'Show only items that need my approval, reply, or decision.',
  'Summarize risks, deadlines, and follow-ups in a compact executive format.',
];

const DEFAULT_SECTIONS = [
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'riskMatrix', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

const DEFAULT_FIELDS = [
  'category', 'matchedKeywords', 'riskScore', 'clock', 'trend',
  'reason', 'owner', 'deadline',
];

const COLUMN_OPTIONS = [1, 2, 3, 4];

const sectionKeys = new Set(ALL_SECTIONS.map((item) => item.key));
const fieldKeys = new Set(ALL_FIELDS.map((item) => item.key));
const sectionLabel = (key) => ALL_SECTIONS.find((item) => item.key === key)?.label || key;

const keepKnown = (values = [], knownKeys, fallback) => {
  const filtered = values.filter((value) => knownKeys.has(value));
  return filtered.length ? filtered : [...fallback];
};

// A sectionOrder covering every known key, seeded with whatever order was saved (if any).
const normalizeOrder = (order = [], enabled = DEFAULT_SECTIONS) => {
  const known = order.filter((key) => sectionKeys.has(key));
  const rest = DEFAULT_SECTIONS.filter((key) => !known.includes(key));
  const full = [...known, ...rest];
  // Sections not yet in a saved order but already enabled should surface near the top, not the tail.
  return full.sort((a, b) => {
    const aIn = enabled.includes(a) ? 0 : 1;
    const bIn = enabled.includes(b) ? 0 : 1;
    if (aIn !== bIn && !known.length) return aIn - bIn;
    return 0;
  });
};

// Anything without an explicit column entry round-robins across columns, in sectionOrder position.
const sanitizeColumnAssignments = (assignments = {}, columnCount) => {
  const out = {};
  Object.keys(assignments || {}).forEach((key) => {
    if (!sectionKeys.has(key)) return;
    const col = Number(assignments[key]);
    if (Number.isInteger(col) && col >= 0 && col < columnCount) out[key] = col;
  });
  return out;
};

// Independent col-1 / col-2 / col-3 / col-4 arrangements: { 1: { sectionOrder, columnAssignments }, 2: {...}, ... }.
const emptyLayouts = () => ({
  1: { sectionOrder: [...DEFAULT_SECTIONS], columnAssignments: {} },
  2: { sectionOrder: [...DEFAULT_SECTIONS], columnAssignments: {} },
  3: { sectionOrder: [...DEFAULT_SECTIONS], columnAssignments: {} },
  4: { sectionOrder: [...DEFAULT_SECTIONS], columnAssignments: {} },
});

const normalizeLayouts = (rawLayouts, enabledSections, legacySeed) => {
  const src = rawLayouts && typeof rawLayouts === 'object' ? rawLayouts : {};
  const out = {};
  COLUMN_OPTIONS.forEach((n) => {
    const raw = src[n] || src[String(n)] || (n === legacySeed?.columnCount ? legacySeed : null) || {};
    out[n] = {
      sectionOrder: normalizeOrder(raw.sectionOrder || [], enabledSections),
      columnAssignments: sanitizeColumnAssignments(raw.columnAssignments, n),
    };
  });
  return out;
};

const emptyConfig = () => ({
  _id: null,
  reportName: 'Default Report Requirements',
  enabledSections: [...DEFAULT_SECTIONS],
  selectedFields: [...DEFAULT_FIELDS],
  columnCount: 2,
  columnLayouts: emptyLayouts(),
  promptInstruction: '',
  outputStyle: 'detailed',
  isDefault: true,
});

function normalizeConfig(cfg = {}) {
  const enabledSections = keepKnown(cfg.enabledSections || [], sectionKeys, DEFAULT_SECTIONS);
  const columnCount = COLUMN_OPTIONS.includes(Number(cfg.columnCount)) ? Number(cfg.columnCount) : 2;
  // Configs saved before per-column layouts existed only had one top-level sectionOrder/
  // columnAssignments pair — seed that into whichever column count was active for them.
  const legacySeed = { columnCount, sectionOrder: cfg.sectionOrder, columnAssignments: cfg.columnAssignments };
  return {
    _id: cfg._id || null,
    reportName: cfg.reportName || 'Default Report Requirements',
    enabledSections,
    selectedFields: keepKnown(cfg.selectedFields || [], fieldKeys, DEFAULT_FIELDS),
    columnCount,
    columnLayouts: normalizeLayouts(cfg.columnLayouts, enabledSections, legacySeed),
    promptInstruction: cfg.promptInstruction || '',
    outputStyle: cfg.outputStyle || 'detailed',
    isDefault: true,
  };
}

function CheckGrid({ items, selected, onChange }) {
  const toggle = (key) => {
    const next = selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key];
    onChange(next);
  };

  return (
    <div className="rc-check-grid">
      {items.map(({ key, label }) => (
        <label key={key} className="rc-check-item">
          <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

// Sections with no explicit column entry round-robin by their position in `order`.
const columnOf = (key, idx, columnCount, columnAssignments) => {
  const explicit = columnAssignments[key];
  return Number.isInteger(explicit) && explicit >= 0 && explicit < columnCount ? explicit : idx % columnCount;
};

/* Multi-column drag board — one list per report column, so the user decides exactly
   what lands in column 1 vs column 2 vs column 3, not just an overall order.
   'narrativeSummary' is excluded: the dashboard always renders it as a full-width
   banner above the columns, never inside one, so it's toggled separately above this
   board and must not count towards the round-robin fallback index below. */
function SectionColumnBoard({ order, enabled, columnCount, columnAssignments, onToggle, onChange }) {
  const [dragKey, setDragKey] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const boardKeys = order.filter((key) => key !== 'narrativeSummary');
  const columns = Array.from({ length: columnCount }, () => []);
  boardKeys.forEach((key, idx) => columns[columnOf(key, idx, columnCount, columnAssignments)].push(key));

  const moveTo = (key, targetCol, beforeKey) => {
    if (!key) return;
    // Lock in every currently visible section's column (not just the dragged one) so the
    // board and the live report always agree — otherwise untouched siblings keep resolving
    // via round-robin fallback and can land somewhere different than what's shown here.
    const nextAssignments = {};
    columns.forEach((keys, idx) => keys.forEach((k) => { nextAssignments[k] = idx; }));
    nextAssignments[key] = targetCol;

    const nextOrder = order.filter((k) => k !== key);
    const insertAt = beforeKey ? nextOrder.indexOf(beforeKey) : -1;
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, key);
    onChange(nextOrder, nextAssignments);
  };

  return (
    <div className="rc-col-board" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(140px, 1fr))` }}>
      {columns.map((keys, colIdx) => (
        <div
          key={colIdx}
          className={`rc-col${overCol === colIdx ? ' rc-col-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOverCol(colIdx); }}
          onDragLeave={() => setOverCol((current) => (current === colIdx ? null : current))}
          onDrop={(e) => { e.preventDefault(); moveTo(dragKey, colIdx, null); setDragKey(null); setOverCol(null); }}
        >
          <div className="rc-col-head">Column {colIdx + 1}</div>
          {keys.map((key) => (
            <div
              key={key}
              className="rc-order-row"
              draggable
              onDragStart={() => setDragKey(key)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverCol(colIdx); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); moveTo(dragKey, colIdx, key); setDragKey(null); setOverCol(null); }}
              onDragEnd={() => { setDragKey(null); setOverCol(null); }}
            >
              <i className="pi pi-bars rc-order-handle" title="Drag to reorder or move to another column" />
              <label className="rc-order-toggle">
                <input type="checkbox" checked={enabled.includes(key)} onChange={() => onToggle(key)} />
                <span>{sectionLabel(key)}</span>
              </label>
            </div>
          ))}
          {keys.length === 0 && <div className="rc-col-empty">Drop a section here</div>}
        </div>
      ))}
    </div>
  );
}

export default function ReportConfigPanel({ onClose }) {
  const [form, setForm] = useState(emptyConfig());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/report-configs');
      const configs = Array.isArray(res?.configs) ? res.configs : [];
      const cfg = configs.find((item) => item.isDefault) || configs[0];
      setForm(cfg ? normalizeConfig(cfg) : emptyConfig());
    } catch {
      showToasterMessage('Could not load report requirements', 'warning');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const saveConfig = async () => {
    setSaving(true);
    try {
      const activeLayout = form.columnLayouts[form.columnCount] || { sectionOrder: DEFAULT_SECTIONS, columnAssignments: {} };
      const payload = {
        ...form,
        reportName: form.reportName.trim() || 'Default Report Requirements',
        isDefault: true,
        // Legacy mirror, for any older reader still looking at top-level fields.
        sectionOrder: activeLayout.sectionOrder,
        columnAssignments: activeLayout.columnAssignments,
      };

      const res = form._id
        ? await fetchMethodRequest('PUT', `email-analysis/report-configs/${form._id}`, payload)
        : await fetchMethodRequest('POST', 'email-analysis/report-configs', payload);

      if (res?.respCode) {
        showToasterMessage('Report requirements saved', 'success');
        setForm(normalizeConfig(res.config || payload));
        if (onClose) onClose();
      } else {
        showToasterMessage(res?.errorMessage || 'Save failed', 'warning');
      }
    } catch {
      showToasterMessage('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="rc-panel"><div className="rc-loading"><i className="pi pi-spin pi-spinner" /> Loading...</div></div>;
  }

  return (
    <div className="rc-panel rc-panel-single">
      <div className="rc-single-note">
        Report Requirements controls what the generated report must show: sections, fields, format, and scope. Put classification, priority, risk scoring, and email-analysis rules in Knowledge Base.
      </div>

      <div className="rc-field">
        <label>Report style</label>
        <Select value={form.outputStyle} onValueChange={(value) => setField('outputStyle', value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {OUTPUT_STYLES.map((style) => <SelectItem key={style.value} value={style.value}>{style.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rc-field rc-instruction-field">
        <label>Report requirement prompt</label>
        <textarea
          className="rc-instruction"
          rows={4}
          value={form.promptInstruction}
          onChange={(event) => setField('promptInstruction', event.target.value)}
          placeholder="Describe what this report should contain, e.g. list all events mentioned in emails, show only approvals, include deadline owners..."
        />
        <div className="rc-preset-row">
          {REQUIREMENT_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => setField('promptInstruction', preset)}>
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="rc-field">
        <label>Number of columns</label>
        <Select value={String(form.columnCount)} onValueChange={(value) => setField('columnCount', Number(value))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {COLUMN_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} column{n > 1 ? 's' : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="rc-field-hint">
          Narrow screens automatically drop to fewer columns. Each column count below
          remembers its own arrangement — switch this to preview/edit col-1 through col-4.
        </p>
      </div>

      <div className="rc-field">
        <label className="rc-order-toggle" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={form.enabledSections.includes('narrativeSummary')}
            onChange={() => setField(
              'enabledSections',
              form.enabledSections.includes('narrativeSummary')
                ? form.enabledSections.filter((k) => k !== 'narrativeSummary')
                : [...form.enabledSections, 'narrativeSummary'],
            )}
          />
          <span>Show narrative summary (always a full-width banner above the columns)</span>
        </label>
      </div>

      <div className="rc-field">
        <label>
          Column {form.columnCount} layout — drag into a column to place it there and set its order, uncheck to hide
        </label>
        <SectionColumnBoard
          order={form.columnLayouts[form.columnCount].sectionOrder}
          enabled={form.enabledSections}
          columnCount={form.columnCount}
          columnAssignments={form.columnLayouts[form.columnCount].columnAssignments}
          onToggle={(key) => setField(
            'enabledSections',
            form.enabledSections.includes(key)
              ? form.enabledSections.filter((k) => k !== key)
              : [...form.enabledSections, key],
          )}
          onChange={(nextOrder, nextAssignments) => setForm((current) => ({
            ...current,
            columnLayouts: {
              ...current.columnLayouts,
              [current.columnCount]: { sectionOrder: nextOrder, columnAssignments: nextAssignments },
            },
          }))}
        />
      </div>

      <div className="rc-field">
        <label>Details to show inside report sections</label>
        <CheckGrid items={ALL_FIELDS} selected={form.selectedFields} onChange={(value) => setField('selectedFields', value)} />
      </div>

      <div className="rc-footer">
        {onClose && <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>}
        <Button size="sm" onClick={saveConfig} disabled={saving}>
          {saving ? <><i className="pi pi-spin pi-spinner" /> Saving...</> : 'Save default requirements'}
        </Button>
      </div>
    </div>
  );
}
