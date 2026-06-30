import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  FileText,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const DEFAULT_KB = {
  keywords: {
    critical: ['FDA', 'Form 483', 'OOS', 'recall', 'deviation', 'data integrity', 'urgent', 'escalation'],
    important: ['CAPA', 'audit', 'inspection', 'deadline', 'approval', 'review'],
    low: ['FYI', 'newsletter', 'update', 'automated'],
    categories: {},
  },
  thresholds: { criticalScore: 80, elevatedScore: 50, escalationScore: 70 },
  glossary: {},
  promptInstruction: '',
};

const CATEGORY_DEFAULTS = {
  Quality: true,
  Regulatory: true,
  Supply: true,
  Production: true,
  Manufacturing: true,
  Logistics: false,
  'Admin / HR': false,
};

const TIER_META = {
  critical: {
    label: 'Critical',
    helper: 'Escalate immediately',
    color: '#b3261e',
    bg: '#fbe9e7',
    border: '#f2c8c3',
  },
  important: {
    label: 'Important',
    helper: 'Needs review',
    color: '#c4631a',
    bg: '#fbeee2',
    border: '#efcfb3',
  },
  low: {
    label: 'Low / FYI',
    helper: 'Informational',
    color: '#4f7a3f',
    bg: '#ecf3e8',
    border: '#d1e2c9',
  },
};

const THRESHOLD_META = [
  {
    key: 'criticalScore',
    title: 'Critical band',
    note: 'score >= threshold turns red',
    min: 0,
    max: 100,
    color: '#b3261e',
  },
  {
    key: 'elevatedScore',
    title: 'Elevated band',
    note: 'score >= threshold turns amber',
    min: 0,
    max: 100,
    color: '#c4631a',
  },
];

function normalizeKeywords(keywords = {}) {
  return {
    critical: Array.isArray(keywords.critical) ? keywords.critical : DEFAULT_KB.keywords.critical,
    important: Array.isArray(keywords.important) ? keywords.important : DEFAULT_KB.keywords.important,
    low: Array.isArray(keywords.low) ? keywords.low : DEFAULT_KB.keywords.low,
    categories: keywords.categories && typeof keywords.categories === 'object' ? keywords.categories : {},
  };
}

function normalizeThresholds(thresholds = {}) {
  return {
    criticalScore: Number.isFinite(Number(thresholds.criticalScore)) ? Number(thresholds.criticalScore) : DEFAULT_KB.thresholds.criticalScore,
    elevatedScore: Number.isFinite(Number(thresholds.elevatedScore)) ? Number(thresholds.elevatedScore) : DEFAULT_KB.thresholds.elevatedScore,
    escalationScore: Number.isFinite(Number(thresholds.escalationScore)) ? Number(thresholds.escalationScore) : DEFAULT_KB.thresholds.escalationScore,
  };
}

function glossaryToRows(glossary = {}) {
  const entries = Object.entries(glossary || {});
  if (!entries.length) return [{ id: 'empty-0', term: '', definition: '' }];
  return entries.map(([term, definition], index) => ({
    id: `${term}-${index}`,
    term,
    definition: String(definition || ''),
  }));
}

function rowsToGlossary(rows = []) {
  return rows.reduce((acc, row) => {
    const term = row.term.trim();
    if (term) acc[term] = row.definition.trim();
    return acc;
  }, {});
}

function dedupeKeywordList(items = []) {
  const seen = new Set();
  return items
    .map((item) => String(item || '').trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function SectionCard({ icon: Icon, eyebrow, title, subtitle, children, className = '' }) {
  return (
    <section className={`kb-card ${className}`}>
      <div className="kb-card__head">
        {Icon && (
          <span className="kb-card__icon">
            <Icon size={16} />
          </span>
        )}
        <div>
          <div className="kb-card__eyebrow">{eyebrow}</div>
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function KeywordTier({ tier, items, pending, onPending, onAdd, onRemove }) {
  const meta = TIER_META[tier];
  return (
    <div className="kb-tier" style={{ '--tier-color': meta.color, '--tier-bg': meta.bg, '--tier-border': meta.border }}>
      <div className="kb-tier__head">
        <span className="kb-tier__dot" />
        <div>
          <h3>{meta.label}</h3>
          <p>{meta.helper}</p>
        </div>
      </div>

      <div className="kb-chip-list">
        {items.length ? items.map((keyword) => (
          <span className="kb-chip" key={keyword}>
            {keyword}
            <button type="button" onClick={() => onRemove(tier, keyword)} aria-label={`Remove ${keyword}`}>
              x
            </button>
          </span>
        )) : <span className="kb-empty-inline">No keywords yet</span>}
      </div>

      <div className="kb-add-row">
        <Input
          value={pending}
          onChange={(event) => onPending(tier, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd(tier);
            }
          }}
          placeholder="Add keyword..."
          className="kb-add-input"
        />
        <Button type="button" size="sm" variant="outline" className="kb-add-btn" onClick={() => onAdd(tier)}>
          Add
        </Button>
      </div>
    </div>
  );
}

function ThresholdControl({ meta, value, onChange }) {
  return (
    <div className="kb-threshold" style={{ '--threshold-color': meta.color }}>
      <div className="kb-threshold__meta">
        <div>
          <h3>{meta.title}</h3>
          <p>{meta.note}</p>
        </div>
        <span>{value}</span>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        value={value}
        onChange={(event) => onChange(meta.key, event.target.value)}
      />
    </div>
  );
}

export default function KnowledgeBaseSettings({ onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keywords, setKeywords] = useState(() => normalizeKeywords(DEFAULT_KB.keywords));
  const [newKeyword, setNewKeyword] = useState({ critical: '', important: '', low: '' });
  const [thresholds, setThresholds] = useState(() => normalizeThresholds(DEFAULT_KB.thresholds));
  const [glossaryRows, setGlossaryRows] = useState(() => glossaryToRows(DEFAULT_KB.glossary));
  const [promptInstruction, setPromptInstruction] = useState(DEFAULT_KB.promptInstruction);

  const categoryState = useMemo(
    () => ({ ...CATEGORY_DEFAULTS, ...(keywords.categories || {}) }),
    [keywords.categories]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/knowledge-base');
      if (res?.config) {
        const nextKeywords = normalizeKeywords(res.config.keywords);
        setKeywords(nextKeywords);
        setThresholds(normalizeThresholds(res.config.thresholds));
        setGlossaryRows(glossaryToRows(res.config.glossary || {}));
        setPromptInstruction(res.config.promptInstruction || '');
      }
    } catch {
      showToasterMessage('Could not load knowledge base', 'warning');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setThreshold = (key, value) => {
    const next = Number(value);
    setThresholds((current) => ({ ...current, [key]: Number.isNaN(next) ? 0 : next }));
  };

  const removeKeyword = (tier, keyword) => {
    setKeywords((current) => ({
      ...current,
      [tier]: current[tier].filter((item) => item !== keyword),
    }));
  };

  const addKeyword = (tier) => {
    const value = newKeyword[tier].trim();
    if (!value) return;
    setKeywords((current) => ({
      ...current,
      [tier]: dedupeKeywordList([...(current[tier] || []), value]),
    }));
    setNewKeyword((current) => ({ ...current, [tier]: '' }));
  };

  const updateCategory = (category) => {
    setKeywords((current) => ({
      ...current,
      categories: {
        ...(current.categories || {}),
        [category]: !categoryState[category],
      },
    }));
  };

  const updateGlossary = (id, field, value) => {
    setGlossaryRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addGlossaryRow = () => {
    setGlossaryRows((rows) => [...rows, { id: `new-${Date.now()}`, term: '', definition: '' }]);
  };

  const removeGlossaryRow = (id) => {
    setGlossaryRows((rows) => {
      const next = rows.filter((row) => row.id !== id);
      return next.length ? next : [{ id: `empty-${Date.now()}`, term: '', definition: '' }];
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        keywords: {
          critical: dedupeKeywordList(keywords.critical),
          important: dedupeKeywordList(keywords.important),
          low: dedupeKeywordList(keywords.low),
          categories: keywords.categories || {},
        },
        thresholds,
        glossary: rowsToGlossary(glossaryRows),
        promptInstruction,
      };
      const res = await fetchMethodRequest('POST', 'email-analysis/knowledge-base', payload);
      if (res?.respCode) {
        showToasterMessage('Knowledge base saved', 'success');
        if (onClose) onClose();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not save', 'warning');
      }
    } catch {
      showToasterMessage('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const critical = thresholds.criticalScore;
  const elevated = thresholds.elevatedScore;
  const lowMax = Math.max(0, elevated - 1);
  const elevatedMax = Math.max(elevated, critical - 1);

  if (loading) {
    return (
      <div className="kb-settings kb-settings--loading">
        <i className="pi pi-spin pi-spinner" />
        Loading knowledge base...
      </div>
    );
  }

  return (
    <div className="kb-settings">
      <SectionCard
        icon={Tags}
        eyebrow="Email analysis"
        title="How to classify incoming mail"
        subtitle="Keywords used by AI to categorize emails into Critical, Important, and Low priority before reports are generated."
      >
        <div className="kb-tier-grid">
          {Object.keys(TIER_META).map((tier) => (
            <KeywordTier
              key={tier}
              tier={tier}
              items={keywords[tier] || []}
              pending={newKeyword[tier] || ''}
              onPending={(key, value) => setNewKeyword((current) => ({ ...current, [key]: value }))}
              onAdd={addKeyword}
              onRemove={removeKeyword}
            />
          ))}
        </div>
      </SectionCard>

      <div className="kb-split">
        <SectionCard
          icon={SlidersHorizontal}
          eyebrow="Risk analysis"
          title="How to score risk"
          subtitle="Risk bands used during email analysis. The report only displays the result of this scoring."
          className="kb-card--weighting"
        >
          <div className="kb-threshold-stack">
            {THRESHOLD_META.map((meta) => (
              <ThresholdControl
                key={meta.key}
                meta={meta}
                value={thresholds[meta.key]}
                onChange={setThreshold}
              />
            ))}
          </div>
          <div className="kb-band-row">
            <span className="kb-band kb-band--critical">Critical {'>='} {critical}</span>
            <span className="kb-band kb-band--elevated">Elevated {elevated}-{elevatedMax}</span>
            <span className="kb-band kb-band--low">Low {'<='} {lowMax}</span>
          </div>
        </SectionCard>

        <SectionCard
          icon={Bell}
          eyebrow="Escalation analysis"
          title="When to treat mail as urgent"
          subtitle="Emails at or above this score are analyzed as urgent operational items."
          className="kb-card--escalation"
        >
          <div className="kb-escalation">
            <strong>{thresholds.escalationScore}</strong>
            <span>alert at this score and above</span>
            <input
              type="range"
              min="0"
              max="100"
              value={thresholds.escalationScore}
              onChange={(event) => setThreshold('escalationScore', event.target.value)}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        icon={Search}
        eyebrow="Routing rules"
        title="How to route VP tasks"
        subtitle="On categories can become direct VP tasks. Off categories stay available as context without forcing VP follow-up."
      >
        <div className="kb-filter-grid">
          {Object.keys(CATEGORY_DEFAULTS).map((category) => {
            const active = !!categoryState[category];
            return (
              <button
                key={category}
                type="button"
                className={`kb-filter ${active ? 'is-on' : ''}`}
                onClick={() => updateCategory(category)}
              >
                <span>{category}</span>
                <em>{active ? 'shown' : 'hidden'}</em>
                <i aria-hidden="true"><b /></i>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        icon={FileText}
        eyebrow="Domain glossary"
        title="Teach email-analysis terms"
        subtitle="Definitions are inserted into the AI email-analysis prompt when these terms appear in emails."
      >
        <div className="kb-glossary-table">
          <div className="kb-glossary-head">
            <span>Term</span>
            <span>Definition</span>
            <span />
          </div>
          {glossaryRows.map((row) => (
            <div className="kb-glossary-row" key={row.id}>
              <Input
                value={row.term}
                onChange={(event) => updateGlossary(row.id, 'term', event.target.value)}
                placeholder="Term"
                className="kb-gloss-term"
              />
              <Input
                value={row.definition}
                onChange={(event) => updateGlossary(row.id, 'definition', event.target.value)}
                placeholder="Definition"
                className="kb-gloss-def"
              />
              <button type="button" onClick={() => removeGlossaryRow(row.id)} aria-label="Remove glossary term">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="kb-add-term" onClick={addGlossaryRow}>
          <Plus size={14} />
          Add term
        </Button>
      </SectionCard>

      <SectionCard
        icon={CheckCircle2}
        eyebrow="Analysis instruction"
        title="How AI should analyze emails"
        subtitle="Use this for classification, prioritization, risk scoring, action extraction, and categorization rules. Report layout belongs in Report Requirements."
      >
        <textarea
          className="kb-prompt"
          rows={6}
          placeholder="e.g. Treat vendor outage emails as Important, classify payment receipts as Low, flag security alerts as Critical, extract actions only when the email asks me to do something."
          value={promptInstruction}
          onChange={(event) => setPromptInstruction(event.target.value)}
        />
        <div className="kb-save-note">
          <span />
          Applies to future email analysis and categorization after saving.
        </div>
      </SectionCard>

      <div className="kb-footer">
        <Button type="button" variant="outline" size="sm" className="kb-reset-btn" onClick={load} disabled={saving || loading}>
          <RotateCcw size={14} />
          Reload
        </Button>
        {onClose && (
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        )}
        <Button type="button" size="sm" className="kb-save-btn" onClick={save} disabled={saving}>
          {saving ? <><i className="pi pi-spin pi-spinner" /> Saving...</> : <><Save size={14} /> Save knowledge base</>}
        </Button>
      </div>
    </div>
  );
}
