import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const ALL_SECTIONS = [
  { key: 'narrativeSummary', label: 'Narrative summary' },
  { key: 'decisionQueue', label: 'Decisions needed today' },
  { key: 'riskRadar', label: 'Risk radar and matrix' },
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
  'narrativeSummary', 'decisionQueue', 'riskRadar', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

const DEFAULT_FIELDS = [
  'category', 'matchedKeywords', 'riskScore', 'clock', 'trend',
  'reason', 'owner', 'deadline',
];

const sectionKeys = new Set(ALL_SECTIONS.map((item) => item.key));
const fieldKeys = new Set(ALL_FIELDS.map((item) => item.key));

const keepKnown = (values = [], knownKeys, fallback) => {
  const filtered = values.filter((value) => knownKeys.has(value));
  return filtered.length ? filtered : [...fallback];
};

const emptyConfig = () => ({
  _id: null,
  reportName: 'Default Report Requirements',
  enabledSections: [...DEFAULT_SECTIONS],
  selectedFields: [...DEFAULT_FIELDS],
  promptInstruction: '',
  outputStyle: 'detailed',
  isDefault: true,
  filters: {
    senderEmail: '',
    senderDomain: '',
    priority: '',
    hasAttachments: false,
    unreadOnly: false,
    requiresReply: false,
    containsKbKeywords: false,
    escalationRequired: false,
  },
});

function normalizeConfig(cfg = {}) {
  return {
    _id: cfg._id || null,
    reportName: cfg.reportName || 'Default Report Requirements',
    enabledSections: keepKnown(cfg.enabledSections || [], sectionKeys, DEFAULT_SECTIONS),
    selectedFields: keepKnown(cfg.selectedFields || [], fieldKeys, DEFAULT_FIELDS),
    promptInstruction: cfg.promptInstruction || '',
    outputStyle: cfg.outputStyle || 'detailed',
    isDefault: true,
    filters: {
      senderEmail: (cfg.filters?.senderEmail || []).join(', '),
      senderDomain: (cfg.filters?.senderDomain || []).join(', '),
      priority: (cfg.filters?.priority || []).join(', '),
      hasAttachments: !!cfg.filters?.hasAttachments,
      unreadOnly: !!cfg.filters?.unreadOnly,
      requiresReply: !!cfg.filters?.requiresReply,
      containsKbKeywords: !!cfg.filters?.containsKbKeywords,
      escalationRequired: !!cfg.filters?.escalationRequired,
    },
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
  const setFilter = (key, value) => setForm((current) => ({ ...current, filters: { ...current.filters, [key]: value } }));

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        reportName: form.reportName.trim() || 'Default Report Requirements',
        isDefault: true,
        filters: {
          ...form.filters,
          senderEmail: form.filters.senderEmail.split(',').map((s) => s.trim()).filter(Boolean),
          senderDomain: form.filters.senderDomain.split(',').map((s) => s.trim()).filter(Boolean),
          priority: form.filters.priority.split(',').map((s) => s.trim()).filter(Boolean),
        },
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
        <label>Report sections to show</label>
        <CheckGrid items={ALL_SECTIONS} selected={form.enabledSections} onChange={(value) => setField('enabledSections', value)} />
      </div>

      <div className="rc-field">
        <label>Details to show inside report sections</label>
        <CheckGrid items={ALL_FIELDS} selected={form.selectedFields} onChange={(value) => setField('selectedFields', value)} />
      </div>

      <div className="rc-field">
        <label>Report scope filters</label>
        <div className="rc-filters">
          <div className="rc-filter-row">
            <label>Sender emails (comma)</label>
            <Input value={form.filters.senderEmail} onChange={(event) => setFilter('senderEmail', event.target.value)} placeholder="user@example.com, ..." />
          </div>
          <div className="rc-filter-row">
            <label>Sender domains (comma)</label>
            <Input value={form.filters.senderDomain} onChange={(event) => setFilter('senderDomain', event.target.value)} placeholder="fda.gov, ..." />
          </div>
          <div className="rc-filter-row">
            <label>Priority (comma)</label>
            <Input value={form.filters.priority} onChange={(event) => setFilter('priority', event.target.value)} placeholder="Critical, High, Medium" />
          </div>
          {[
            ['hasAttachments', 'Has attachments'],
            ['unreadOnly', 'Unread only'],
            ['requiresReply', 'Requires reply'],
            ['containsKbKeywords', 'Contains KB keywords'],
            ['escalationRequired', 'Escalation required'],
          ].map(([key, label]) => (
            <label key={key} className="rc-switch-label" style={{ marginTop: 6 }}>
              <Switch checked={!!form.filters[key]} onCheckedChange={(value) => setFilter(key, value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
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
