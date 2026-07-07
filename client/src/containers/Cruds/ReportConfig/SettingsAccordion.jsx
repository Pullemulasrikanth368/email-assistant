import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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

export const ALL_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'matchedKeywords', label: 'Matched Keywords' },
  { key: 'riskScore', label: 'Risk Score' },
  { key: 'clock', label: 'Time / Clock' },
  { key: 'trend', label: 'Trend' },
  { key: 'reason', label: 'Reason for Classification' },
  { key: 'owner', label: 'Owner' },
  { key: 'deadline', label: 'Deadline' },
];

export const DEFAULT_FIELDS = ALL_FIELDS.map((f) => f.key);

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

/* Non-layout report requirements: output style, requirement prompt and field visibility. */
export default function SettingsAccordion({ form, setField, open, onToggle }) {
  return (
    <section className="rcfg-row rcfg-settings">
      <div
        className="rcfg-row-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
      >
        <i className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'}`} />
        <span className="rcfg-row-title">Report settings</span>
        <span className="rcfg-row-meta">Style, requirement prompt and visible fields</span>
      </div>

      {open && (
        <div className="rcfg-row-body">
          <div className="rc-field">
            <label>Report style</label>
            <Select value={form.outputStyle} onValueChange={(value) => setField('outputStyle', value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTPUT_STYLES.map((style) => (
                  <SelectItem key={style.value} value={style.value}>{style.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rc-field">
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
            <label>Details to show inside report sections</label>
            <CheckGrid
              items={ALL_FIELDS}
              selected={form.selectedFields}
              onChange={(value) => setField('selectedFields', value)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
