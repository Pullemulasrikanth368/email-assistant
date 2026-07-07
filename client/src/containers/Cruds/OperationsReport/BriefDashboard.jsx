/* Shared dashboard renderer (wireframe screen 02) used by the Reports screen
   and the Daily Brief screen. */
import { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Info, Mail } from 'lucide-react';
import fetchMethodRequest from '../../../config/service';
import { url } from '../../../config/config';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import { normalizeRows } from './reportLayout';

const todoKey = (t) => `${t.sourceId || ''}::${t.task || ''}`;

// Risk score -> severity colour tier (score drives colour, not decoration).
export const scoreColor = (score) => {
  if (score >= 16) return 'var(--crit)';
  if (score >= 10) return 'var(--high)';
  if (score >= 5) return 'var(--med)';
  return 'var(--low)';
};

const TREND_LABEL = { New: 'new', Escalating: 'escalating', Cooling: 'cooling', Stable: 'stable' };

// Sender display name + address from a raw `Name <addr>` from-header.
const parseSender = (raw = '') => {
  const match = String(raw).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) {
    const name = (match[1] || '').trim();
    const email = (match[2] || '').trim().toLowerCase();
    return { name: name || email, email };
  }
  const trimmed = String(raw).trim();
  return { name: trimmed || 'Unknown sender', email: trimmed.includes('@') ? trimmed.toLowerCase() : '' };
};

// Older stored reports may carry raw HTML in triage summaries — show text only.
const stripHtml = (s = '') =>
  String(s).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Category summaries arrive with a small set of inline tags the brief prompt
// allows (<b>, <strong>, <em>, <mark>, <span class="danger">). Escape everything,
// then restore ONLY those exact tags — anything else the AI (or an email) sneaks
// in renders as visible text instead of live HTML.
const SAFE_SUMMARY_TAG = /<\s*\/?\s*(b|strong|em|mark)\s*>|<\s*span\s+class="danger"\s*>|<\s*\/\s*span\s*>/gi;
const sanitizeSummaryHtml = (html = '') => {
  const kept = [];
  const masked = String(html).replace(SAFE_SUMMARY_TAG, (tag) => {
    kept.push(tag.replace(/\s+/g, ' ').replace(/\s*([<>/])\s*/g, '$1').toLowerCase());
    return `\u0000${kept.length - 1}\u0000`;
  });
  return masked
    .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
};

const TIER_RANK = { Critical: 3, Important: 2, Low: 1 };
const tierColor = (tier) =>
  tier === 'Critical' ? 'var(--crit)' : tier === 'Important' ? 'var(--high)' : 'var(--muted)';
const tierClass = (tier) => (tier === 'Critical' ? 'crit' : tier === 'Important' ? 'imp' : 'low');

// Turn an event's "when" into calendar-tile parts; null when it isn't a parseable date
// (free-text like "next week" then falls back to being shown as-is).
const parseEventWhen = (when) => {
  if (!when) return null;
  // Times extracted from emails are wall-clock times; a trailing "Z" is usually
  // AI noise, and honouring it would shift the display into the viewer's timezone.
  const d = new Date(String(when).replace(/Z$/i, ''));
  if (Number.isNaN(d.getTime())) return null;
  const hasTime = /\d{1,2}:\d{2}/.test(String(when));
  return {
    month: d.toLocaleString('en', { month: 'short' }),
    day: d.getDate(),
    weekday: d.toLocaleString('en', { weekday: 'short' }),
    time: hasTime ? d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : null,
  };
};

// Copy shown in the "what is this section?" info modal, keyed by section id.
const SECTION_INFO = {
  decisionQueue: {
    title: 'Decisions needed today',
    description: 'Emails where someone is waiting on a decision from you. Each item shows what needs deciding, why it matters, and the deadline when one was mentioned. Click an item to open the source email.',
  },
  riskRadar: {
    title: 'Risk radar',
    description: 'Operational risks the AI detected across your emails. Each risk is scored as likelihood × impact (using the thresholds from your knowledge base), tagged with a category and trend (new / escalating / cooling), and includes a suggested mitigation where possible.',
  },
  riskMatrix: {
    title: 'Risk matrix',
    description: 'A 5×5 likelihood × impact grid plotting every detected risk plus triaged critical mails. Cells further to the top-right are more severe. A numbered dot means one or more items sit in that cell — click it to open the highest one.',
  },
  todoList: {
    title: 'Your to-do',
    description: 'Tasks extracted from emails that appear to be yours to do, with deadlines when mentioned. Ticking the checkbox marks the task complete and sends an AI-written reply on the original email thread telling the sender it’s done.',
  },
  events: {
    title: 'Events mentioned',
    description: 'Meetings, deadlines, and other dated commitments the AI found inside your emails, laid out as calendar entries with date, time, and owner. Click one to open the email it came from.',
  },
  calendarConflicts: {
    title: 'Schedule collisions',
    description: 'Overlapping or conflicting commitments detected across your emails — double-booked meetings, clashing deadlines, and similar — each with a suggested way to resolve it.',
  },
  patterns: {
    title: 'Patterns',
    description: 'Recurring themes the AI noticed across many emails in this period — for example a vendor who keeps slipping dates or a topic that keeps escalating. Useful for spotting slow-building issues no single email would reveal.',
  },
  categorySummaries: {
    title: 'AI Category wise summary',
    description: 'A short AI-written summary for each email category in this period — what the emails were about, who they came from, and the key points. Expand a category to see its emails; click one to open it.',
  },
  inboxTriage: {
    title: 'Inbox triage',
    description: 'Every analyzed email sorted into Critical, Important, or Low priority using the keywords and rules from your knowledge base, grouped by sender. Each entry shows why it was placed in that tier; click it to open the email.',
  },
  actionRegister: {
    title: 'Action register',
    description: 'The full list of action items extracted from your emails — including ones owned by other people — with the owner and deadline for each. Broader than "Your to-do", which only shows tasks assigned to you.',
  },
};

// Tinted chip colors per email category — hues from a CVD-validated categorical
// palette, text darkened for contrast on the tint. Unknown categories hash into
// the same set so a category keeps its color across reports.
// Each slot: dark text color + faint chip tint, plus a light "soft" fill and
// an accent for the category accordion headers — light, professional pastels
// that still read as clearly different hues.
const CATEGORY_CHIP_STYLES = [
  { color: '#1c5cab', background: 'rgba(42, 120, 214, .10)', borderColor: 'rgba(42, 120, 214, .35)', soft: '#e3eefb', accent: '#5b93d8' },  // blue
  { color: '#0c6b4c', background: 'rgba(27, 175, 122, .12)', borderColor: 'rgba(27, 175, 122, .40)', soft: '#def4ea', accent: '#3fb389' },  // teal
  { color: '#7a5200', background: 'rgba(237, 161, 0, .14)', borderColor: 'rgba(237, 161, 0, .45)', soft: '#fdf0d3', accent: '#dfa62e' },    // amber
  { color: '#045c04', background: 'rgba(0, 131, 0, .10)', borderColor: 'rgba(0, 131, 0, .35)', soft: '#e1f1e1', accent: '#4d9c4d' },        // green
  { color: '#43349c', background: 'rgba(74, 58, 167, .10)', borderColor: 'rgba(74, 58, 167, .35)', soft: '#e8e5f7', accent: '#7d70c4' },    // violet
  { color: '#ab2f2e', background: 'rgba(227, 73, 72, .10)', borderColor: 'rgba(227, 73, 72, .38)', soft: '#fbe5e5', accent: '#dd7776' },    // red
  { color: '#9c2458', background: 'rgba(232, 123, 164, .15)', borderColor: 'rgba(216, 81, 129, .40)', soft: '#fae4ee', accent: '#dd7ba6' }, // magenta
  { color: '#973a10', background: 'rgba(235, 104, 52, .12)', borderColor: 'rgba(235, 104, 52, .40)', soft: '#fce9df', accent: '#e2854f' },  // orange
];
const CATEGORY_CHIP_NEUTRAL = { color: '#5f6368', background: 'rgba(95, 99, 104, .10)', borderColor: 'rgba(95, 99, 104, .35)', soft: '#eef0f2', accent: '#9aa1ab' };

const KNOWN_CATEGORY_SLOT = {
  'Action Required': 5,          // red — urgency
  'Meetings & Scheduling': 0,    // blue
  'Finance & Invoices': 4,       // violet
  'Sales & Leads': 1,            // teal
  'Support & Complaints': 7,     // orange
  'Notifications & Updates': 2,  // amber
  'Newsletters': 6,              // magenta
  'Promotions & Marketing': 3,   // green
};

const categoryChipStyle = (category) => {
  const name = String(category || '').trim();
  if (!name || name === 'Personal' || name === 'Junk' || name === 'Other') return CATEGORY_CHIP_NEUTRAL;
  if (KNOWN_CATEGORY_SLOT[name] !== undefined) return CATEGORY_CHIP_STYLES[KNOWN_CATEGORY_SLOT[name]];
  let hash = 7;
  for (let i = 0; i < name.length; i += 1) hash = ((hash * 31) + name.charCodeAt(i)) >>> 0;
  return CATEGORY_CHIP_STYLES[hash % CATEGORY_CHIP_STYLES.length];
};

const TRIAGE_MATRIX_POSITION = {
  Critical: { likelihood: 4, impact: 4 },
  Important: { likelihood: 3, impact: 2 },
  Low: { likelihood: 1, impact: 1 },
};

const triageToMatrixRisk = (item = {}) => {
  const pos = TRIAGE_MATRIX_POSITION[item.tier] || TRIAGE_MATRIX_POSITION.Low;
  return {
    category: item.tier || 'Low',
    summary: item.reason || `${item.tier || 'Low'} priority email`,
    likelihood: pos.likelihood,
    impact: pos.impact,
    riskScore: pos.likelihood * pos.impact,
    clock: item.tier === 'Low' ? 'low' : 'triage',
    trend: 'Stable',
    sourceId: item.sourceId,
    fromTriage: true,
  };
};

const buildRiskMatrixItems = (risks, triage) => {
  const safeRisks = Array.isArray(risks) ? risks : [];
  const safeTriage = Array.isArray(triage) ? triage : [];
  const usedSourceIds = new Set(safeRisks.map((r) => r?.sourceId).filter(Boolean));
  const triagePoints = safeTriage
    .filter((t) => t?.sourceId && !usedSourceIds.has(t.sourceId))
    .map(triageToMatrixRisk);
  return [...safeRisks, ...triagePoints];
};

/* The signature 5x5 likelihood × impact matrix. */
export const RiskMatrix = ({ risks = [], onPick }) => {
  const cells = [];
  for (let impact = 5; impact >= 1; impact -= 1) {
    for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
      const score = impact * likelihood;
      const here = risks.filter((r) => Number(r.likelihood) === likelihood && Number(r.impact) === impact);
      cells.push(
        <div
          key={`${impact}-${likelihood}`}
          className="orm-cell"
          style={{ background: scoreColor(score), opacity: here.length ? 1 : 0.32, cursor: here.length && onPick ? 'pointer' : 'default' }}
          title={here.length ? here.map((h) => h.summary).join(', ') : `L${likelihood} × I${impact}`}
          onClick={() => here.length && onPick && onPick(here[0])}
        >
          {here.length > 0 && <span className="orm-dot">{here.length > 1 ? here.length : '1'}</span>}
        </div>
      );
    }
  }
  return (
    <div className="orm-matrix-wrap">
      <div className="orm-axis-y">Impact</div>
      <div style={{ flex: 1 }}>
        <div className="orm-matrix">{cells}</div>
        <div className="orm-axis-x">Likelihood →</div>
      </div>
    </div>
  );
};

/**
 * Render a single brief.
 * @param report       stored report ({ brief, reportConfigSnapshot, ... })
 * @param onOpenSource (sourceId) => void  — open the source email
 * @param onOpenRisk   (risk) => void      — open risk detail (falls back to onOpenSource)
 */
export const BriefDashboard = ({ report, reportConfig, onOpenSource = () => { }, onOpenRisk }) => {
  const brief = report?.brief || {};

  // Layout/visibility (sections, fields, order, columns) is a display concern, so the
  // live report-config always wins; the report's own snapshot is only a fallback for
  // older reports generated before the live config could be fetched.
  const rcSnap = reportConfig || report?.reportConfigSnapshot || null;
  const enabledSections = rcSnap?.enabledSections || null; // null = show all
  const selectedFields = rcSnap?.selectedFields || null;   // null = show all

  const sectionEnabled = (key) => !enabledSections || enabledSections.includes(key);
  const fieldEnabled = (key) => !selectedFields || selectedFields.includes(key);

  const keyPoints = brief.narrativeKeyPoints || [];
  const risks = [...(brief.risks || [])].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const decisions = brief.decisionQueue || [];
  const collisions = brief.collisions || [];
  const todos = brief.todoList || [];
  const patterns = brief.patterns || [];
  const triage = brief.triage || [];
  const categorySummaries = brief.categorySummaries || [];
  const actions = brief.actions || [];
  const events = brief.events || [];
  const riskMatrixItems = buildRiskMatrixItems(risks, triage);

  const openRisk = (r) => (onOpenRisk ? onOpenRisk(r) : onOpenSource(r.sourceId));

  /* -------- markdown file viewer -------- */
  const [mdDialog, setMdDialog] = useState({ visible: false, loading: false, content: '' });

  const openMd = async () => {
    if (!report?._id) return;
    setMdDialog({ visible: true, loading: true, content: '' });
    try {
      const creds = JSON.parse(localStorage.getItem('loginCredentials') || '{}');
      const res = await fetch(`${url}api/email-analysis/reports/${report._id}/md`, {
        headers: creds.accessToken ? { Authorization: `Bearer ${creds.accessToken}` } : {},
      });
      if (!res.ok) throw new Error('Failed');
      const text = await res.text();
      setMdDialog({ visible: true, loading: false, content: text });
    } catch {
      showToasterMessage('Could not load markdown file', 'error');
      setMdDialog({ visible: false, loading: false, content: '' });
    }
  };

  /* -------- action/todo completion (sends an AI reply on the email thread) -------- */
  const [confirm, setConfirm] = useState({ visible: false, todo: null });
  const [completing, setCompleting] = useState(false);
  const [doneKeys, setDoneKeys] = useState(() => new Set());

  const isTodoDone = (t) => t.status === 'Completed' || doneKeys.has(todoKey(t));

  const askComplete = (todo) => {
    if (!todo?.sourceId) {
      showToasterMessage('This item has no linked email to reply to.', 'warning');
      return;
    }
    setConfirm({ visible: true, todo });
  };

  const doComplete = async () => {
    const todo = confirm.todo;
    if (!todo) return;
    setCompleting(true);
    try {
      const resp = await fetchMethodRequest('POST', 'email-analysis/actions/complete', {
        sourceId: todo.sourceId,
        task: todo.task,
        reportId: report?._id,
      });
      if (resp?.respCode) {
        setDoneKeys((prev) => new Set(prev).add(todoKey(todo)));
        showToasterMessage(resp.respMessage || 'Reply sent', 'success');
        setConfirm({ visible: false, todo: null });
      } else {
        showToasterMessage(resp?.errorMessage || 'Could not complete this item', 'error');
      }
    } catch {
      showToasterMessage('Something went wrong sending the reply', 'error');
    } finally {
      setCompleting(false);
    }
  };

  // Inbox triage grouped by sender: a sender with several mails collapses
  // into one accordion, its mails bucketed per AI category (largest first).
  // Groups sort by highest tier present, then by mail count.
  const senderGroups = (() => {
    const map = new Map();
    triage.forEach((t, idx) => {
      const s = parseSender(t.from);
      const key = s.email || s.name.toLowerCase();
      if (!map.has(key)) map.set(key, { key, name: s.name, email: s.email, items: [], categories: new Map() });
      const g = map.get(key);
      g.items.push({ ...t, idx });
      const cat = t.category || 'Other';
      if (!g.categories.has(cat)) g.categories.set(cat, []);
      g.categories.get(cat).push({ ...t, idx });
    });
    const groups = [...map.values()];
    groups.forEach((g) => {
      g.topTier = g.items.reduce((best, t) => (TIER_RANK[t.tier] > TIER_RANK[best] ? t.tier : best), 'Low');
      g.catList = [...g.categories.entries()].sort((a, b) => b[1].length - a[1].length);
      g.tierCounts = {
        Critical: g.items.filter((t) => t.tier === 'Critical').length,
        Important: g.items.filter((t) => t.tier === 'Important').length,
        Low: g.items.filter((t) => t.tier !== 'Critical' && t.tier !== 'Important').length,
      };
    });
    groups.sort((a, b) => (TIER_RANK[b.topTier] - TIER_RANK[a.topTier]) || (b.items.length - a.items.length));
    return groups;
  })();

  const isQuiet = !decisions.length && !risks.length && !collisions.length;

  /* -------- collapsible panels: every section header toggles its body -------- */
  // Every multi-mail sender accordion starts collapsed; inside
  // a sender, only its FIRST category group starts open.
  const [collapsedKeys, setCollapsedKeys] = useState(() => {
    const init = new Set();
    senderGroups
      .filter((g) => g.items.length > 1)
      .forEach((g) => {
        init.add(`triage-sender:${g.key}`);
        g.catList.slice(1).forEach(([cat]) => init.add(`triage-cat:${g.key}:${cat}`));
      });
    return init;
  });
  const toggleSection = (key) => setCollapsedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /* -------- "what is this section?" info modal -------- */
  const [infoKey, setInfoKey] = useState(null);

  const infoButton = (id) => SECTION_INFO[id] && (
    <button
      type="button"
      className="orm-info-btn"
      title={`About ${SECTION_INFO[id].title}`}
      aria-label={`About ${SECTION_INFO[id].title}`}
      onClick={(e) => { e.stopPropagation(); setInfoKey(id); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Info size={14} />
    </button>
  );

  const panel = (id, title, count, body, { amber = false, headerColor } = {}) => {
    const isCollapsed = collapsedKeys.has(id);
    return (
      <div className={`orm-panel${amber ? ' orm-panel-amber' : ''}`} key={id}>
        <div
          className="orm-ph orm-ph-toggle"
          style={headerColor ? { color: headerColor } : undefined}
          onClick={() => toggleSection(id)}
          onKeyDown={(e) => { if (e.key === 'Enter') toggleSection(id); }}
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
        >
          <i className={`pi ${isCollapsed ? 'pi-chevron-right' : 'pi-chevron-down'} orm-ph-chev`} />
          {title}
          {count != null && <span className="n">{count}</span>}
          {infoButton(id)}
        </div>
        {!isCollapsed && body}
      </div>
    );
  };

  // One accordion per triage category summary: opening it reveals the mail tags.
  const [expandedCatSums, setExpandedCatSums] = useState(() => new Set());
  const toggleCatSum = (key) => setExpandedCatSums((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // One accordion per key point: the "Mails (n)" toggle reveals that point's mail badges.
  const [expandedKpMails, setExpandedKpMails] = useState(() => new Set());
  const toggleKpMails = (key) => setExpandedKpMails((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderKeyPoints = (points) => (
    <ul className="orm-kp-list">
      {points?.map((kp, i) => {
        const open = expandedKpMails.has(i);
        return (
          <li className="orm-kp" key={i}>
            <div className="orm-kp-text">
              {kp.title && <span className="orm-kp-title">{kp.title}: </span>}
              <span className="orm-kp-summary">{kp.summary}</span>
            </div>
            {kp.mails?.length > 0 && (
              <>
                <div
                  className="orm-kp-mails-toggle"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggleKpMails(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleKpMails(i); }}
                >
                  <i className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'}`} />
                  Mails <span className="n">({kp.mails.length})</span>
                </div>
                {open && (
                  <div className="orm-kp-mails">
                    {kp.mails?.map((m, j) => (
                      <span
                        className="orm-kp-mail"
                        key={j}
                        title={m.from ? `From: ${m.from}` : m.subject}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenSource(m.sourceId)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onOpenSource(m.sourceId); }}
                      >
                        <Mail className="orm-kp-mail-icon" />
                        {m.subject || '(no subject)'}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );

  /* -------- section renderers, keyed the same as the report-config's rows -------- */
  const sectionNodes = {
    decisionQueue: sectionEnabled('decisionQueue') && decisions.length > 0 && panel(
      'decisionQueue', 'Decisions needed today', decisions.length,
      <>
        {decisions?.map((d, i) => (
          <div className="orm-dec" key={i} onClick={() => onOpenSource(d.sourceId)} role="button" tabIndex={0}>
            <div className="t">{d.title}</div>
            {d.why && <div className="w">{d.why}</div>}
            {d.deadline && fieldEnabled('deadline') && <span className="due">DUE: {d.deadline}</span>}
          </div>
        ))}
      </>
    ),

    riskRadar: sectionEnabled('riskRadar') && risks.length > 0 && panel(
      'riskRadar', 'Risk radar', risks.length,
      <>
        {risks?.map((r, i) => (
          <div className="orm-risk" key={i} onClick={() => openRisk(r)} role="button" tabIndex={0}>
            {fieldEnabled('riskScore') && (
              <div className="orm-score" style={{ background: scoreColor(r.riskScore) }}>
                {r.riskScore}<small>{r.likelihood}×{r.impact}</small>
              </div>
            )}
            <div>
              <div className="s">{r.summary}</div>
              <div className="orm-rrow">
                {fieldEnabled('category') && r.category && <span className="orm-chip">{r.category}</span>}
                {fieldEnabled('clock') && r.clock && <span className="orm-chip clock">{r.clock}</span>}
                {fieldEnabled('trend') && r.trend && <span className={`orm-chip ${r.trend === 'Escalating' ? 'esc' : r.trend === 'New' ? 'new' : ''}`}>{TREND_LABEL[r.trend] || r.trend}</span>}
                {fieldEnabled('matchedKeywords') && r.matchedKeywords?.length > 0 && (
                  <span className="orm-chip kw">{r.matchedKeywords.join(', ')}</span>
                )}
              </div>
              {r.mitigation && <div className="orm-mit"><b>Mitigate:</b> {r.mitigation}</div>}
              {fieldEnabled('reason') && r.reason && <div className="orm-reason"><b>Reason:</b> {r.reason}</div>}
            </div>
          </div>
        ))}
      </>
    ),

    riskMatrix: sectionEnabled('riskMatrix') && riskMatrixItems.length > 0 && panel(
      'riskMatrix', 'Risk matrix', riskMatrixItems.length,
      <RiskMatrix risks={riskMatrixItems} onPick={openRisk} />
    ),

    patterns: sectionEnabled('patterns') && patterns.length > 0 && panel(
      'patterns', 'Patterns', null,
      <>{patterns?.map((p, i) => <div className="orm-pattern" key={i}>{p}</div>)}</>
    ),

    // AI category-wise summaries — their own row, split out of Inbox triage.
    // Older saved configs won't list the new key, so it inherits inboxTriage's
    // enablement until the config is re-saved with it present.
    categorySummaries: (sectionEnabled('categorySummaries') || sectionEnabled('inboxTriage'))
      && categorySummaries.length > 0 && panel(
        'categorySummaries', 'AI Category wise summary', categorySummaries.length,
        <div className="orm-cat-summaries">
          {categorySummaries?.map((c, i) => {
            const open = expandedCatSums.has(i);
            const mails = c.mails || [];
            const chip = categoryChipStyle(c.category);
            return (
              <div
                className="orm-cat-summary"
                key={i}
                style={{
                  '--cat-color': chip.color,
                  '--cat-accent': chip.accent,
                  '--cat-soft': chip.soft,
                  '--cat-tint': chip.background,
                  '--cat-border': chip.borderColor,
                }}
              >
                <div
                  className="orm-cat-head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggleCatSum(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleCatSum(i); }}
                >
                  <span className="orm-chip cat">{c.category || 'Other'}</span>
                  {(c.count != null || mails.length > 0) && (
                    <span className="cnt">{c.count != null ? c.count : mails.length}</span>
                  )}
                  <i className={`pi chev ${open ? 'pi-chevron-up' : 'pi-chevron-down'}`} />
                </div>
                <div className="txt" dangerouslySetInnerHTML={{ __html: sanitizeSummaryHtml(c.summary) }} />
                {(c.keyPoints || []).length > 0 && (
                  <ul className={`orm-cat-kps${(c.keyPoints || []).length > 5 ? ' two-col' : ''}`}>
                    {(c.keyPoints || []).map((k, j) => (
                      <li key={j} dangerouslySetInnerHTML={{ __html: sanitizeSummaryHtml(k) }} />
                    ))}
                  </ul>
                )}
                {open && mails.length > 0 && (
                  <div className="orm-kp-mails">
                    {mails?.map((m, j) => (
                      <span
                        className="orm-kp-mail"
                        key={j}
                        title={m.from ? `From: ${m.from}` : m.subject}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenSource(m.sourceId)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onOpenSource(m.sourceId); }}
                      >
                        <Mail className="orm-kp-mail-icon" />
                        {m.subject || '(no subject)'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),

    inboxTriage: sectionEnabled('inboxTriage') && triage.length > 0 && panel(
      'inboxTriage', 'Inbox triage', triage.length,
      <>
        {senderGroups?.map((g) => {
          const triageRow = (t) => (
            <div className={`orm-trow orm-trow-rich t-${(t.tier || 'low').toLowerCase()}`} key={t.idx} onClick={() => onOpenSource(t.sourceId)} role="button" tabIndex={0}>
              <Mail className="orm-mail-icon" style={{ color: tierColor(t.tier) }} />
              <div className="orm-trow-body">
                <div className="orm-trow-head">
                  {t.subject && <span className="subject">{t.subject}</span>}
                  {t.from && <span className="from">{t.from}</span>}
                  <span className="orm-chip" style={{ color: tierColor(t.tier) }}>{t.tier}</span>
                </div>
                {t.reason && t.reason !== t.subject && <span className="reason">{t.reason}</span>}
                {t.summary && <div className="summary">{stripHtml(t.summary)}</div>}
                {fieldEnabled('matchedKeywords') && t.matchedKeywords?.length > 0 && (
                  <span className="orm-chip kw" style={{ marginTop: 4 }}>{t.matchedKeywords.join(', ')}</span>
                )}
              </div>
            </div>
          );

          // A sender with a single mail stays a plain row.
          if (g.items.length === 1) return triageRow(g.items[0]);

          const sgKey = `triage-sender:${g.key}`;
          const collapsed = collapsedKeys.has(sgKey);
          return (
            <div className={`orm-sender-group tg-${tierClass(g.topTier)}`} key={g.key}>
              <div
                className="orm-sg-head"
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                title={g.email || g.name}
                onClick={() => toggleSection(sgKey)}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleSection(sgKey); }}
              >
                <i className={`pi ${collapsed ? 'pi-chevron-right' : 'pi-chevron-down'}`} />
                <Mail className="orm-mail-icon" />
                <span className="orm-sg-name">{g.name}</span>
                <span className="orm-sg-count">{g.items.length} mails</span>
                <span className="orm-sg-tiers">
                  {g.tierCounts.Critical > 0 && (
                    <span className="orm-tier-badge crit" title={`${g.tierCounts.Critical} critical`}>{g.tierCounts.Critical}</span>
                  )}
                  {g.tierCounts.Important > 0 && (
                    <span className="orm-tier-badge imp" title={`${g.tierCounts.Important} important`}>{g.tierCounts.Important}</span>
                  )}
                  {g.tierCounts.Low > 0 && (
                    <span className="orm-tier-badge low" title={`${g.tierCounts.Low} low priority`}>{g.tierCounts.Low}</span>
                  )}
                </span>
              </div>
              {/* {collapsed && g.items[0]?.summary && (
                <div className="orm-sg-preview">{stripHtml(g.items[0].summary)}</div>
              )} */}
              {!collapsed && (
                <div className="orm-sg-body">
                  {g.catList?.map(([cat, items]) => {
                    const catKey = `triage-cat:${g.key}:${cat}`;
                    const catCollapsed = collapsedKeys.has(catKey);
                    const chip = categoryChipStyle(cat);
                    return (
                      <div key={cat}>
                        <div
                          className="orm-sg-cat-head orm-sg-cat-toggle"
                          style={{
                            color: chip.color,
                            background: chip.soft,
                            borderColor: chip.soft,
                            borderLeftColor: chip.accent,
                          }}
                          role="button"
                          tabIndex={0}
                          aria-expanded={!catCollapsed}
                          onClick={() => toggleSection(catKey)}
                          onKeyDown={(e) => { if (e.key === 'Enter') toggleSection(catKey); }}
                        >
                          <i className={`pi ${catCollapsed ? 'pi-chevron-right' : 'pi-chevron-down'}`} />
                          {cat} <span className="n">{items.length}</span>
                        </div>
                        {!catCollapsed && (
                          <div className="orm-sg-cat-mails">
                            {items?.map(triageRow)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </>
    ),

    actionRegister: sectionEnabled('actionRegister') && actions.length > 0 && panel(
      'actionRegister', 'Action register', actions.length,
      <>
        {actions?.map((a, i) => (
          <div className="orm-action" key={i} onClick={() => onOpenSource(a.sourceId)} role="button" tabIndex={0}>
            <div className="task">{a.task}</div>
            <div className="meta">
              {fieldEnabled('owner') && a.owner && <span className="owner"><i className="pi pi-user" />{a.owner}</span>}
              {fieldEnabled('deadline') && a.deadline && <span className="due"><i className="pi pi-calendar" />{a.deadline}</span>}
            </div>
          </div>
        ))}
      </>
    ),

    calendarConflicts: sectionEnabled('calendarConflicts') && collisions.length > 0 && panel(
      'calendarConflicts', 'Schedule collisions', collisions.length,
      <>
        {collisions?.map((c, i) => (
          <div className="orm-coll" key={i}>
            <div className="ct">{c.type}</div>
            <div className="cs">{c.summary}{c.when ? ` · ${c.when}` : ''}</div>
            {c.suggestion && <div className="cg"><b>Suggested:</b> {c.suggestion}</div>}
          </div>
        ))}
      </>,
      { amber: true, headerColor: 'var(--high)' }
    ),

    todoList: sectionEnabled('todoList') && todos.length > 0 && panel(
      'todoList', 'Your to-do', todos.length,
      <>
        {todos?.map((t, i) => {
          const done = isTodoDone(t);
          return (
            <div className={`orm-todo${done ? ' done' : ''}`} key={i} onClick={() => onOpenSource(t.sourceId)} role="button" tabIndex={0}>
              <span
                className={`orm-box${done ? ' checked' : ''}`}
                role="checkbox"
                aria-checked={done}
                tabIndex={0}
                title={done ? 'Completed' : 'Mark completed & send reply'}
                onClick={(e) => { e.stopPropagation(); if (!done) askComplete(t); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (!done) askComplete(t); } }}
              >
                {done && <i className="pi pi-check" />}
              </span>
              <span className="orm-todo-task">{t.task}</span>
              {fieldEnabled('deadline') && t.deadline && <span className="d">{t.deadline}</span>}
            </div>
          );
        })}
      </>
    ),

    events: sectionEnabled('events') && events.length > 0 && panel(
      'events', 'Events mentioned', events.length,
      <>
        {events?.map((event, i) => {
          const w = parseEventWhen(event.when);
          return (
            <div className="orm-event" key={i} onClick={() => onOpenSource(event.sourceId)} role="button" tabIndex={0}>
              <div className={`orm-event-date${w ? '' : ' none'}`}>
                {w ? (
                  <>
                    <span className="m">{w.month}</span>
                    <span className="d">{w.day}</span>
                  </>
                ) : (
                  <i className="pi pi-calendar" />
                )}
              </div>
              <div className="orm-event-body">
                <div className="et">{event.title}</div>
                <div className="em">
                  {w && (
                    <span className="time">
                      <i className="pi pi-clock" />
                      {w.weekday}{w.time ? `, ${w.time}` : ''}
                    </span>
                  )}
                  {!w && event.when && <span className="time">{event.when}</span>}
                  {event.type && <span className="type">{event.type}</span>}
                  {event.owner && <span className="who"><i className="pi pi-user" />{event.owner}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </>
    ),
  };

  // Row-based layout: rows of col-N columns, each column stacking one or more sections
  // with an optional per-row max height. normalizeRows also converts legacy
  // columnCount/columnLayouts configs and old reportConfigSnapshots.
  const layoutRows = (normalizeRows(rcSnap || {}) || [])
    .map((row) => ({
      ...row,
      columns: (row?.columns || [])
        .map((col) => ({ ...col, sections: (col?.sections || []).filter((key) => sectionNodes[key]) }))
        .filter((col) => col.sections.length),
    }))
    .filter((row) => row.columns.length);

  return (
    <div className="orm-dash">
      {/* Markdown is rendered on demand by the server — any stored report can be viewed. */}
      {/* {report?._id && (
        <div className="orm-md-bar">
          <Button
            label="View Report File"
            icon="pi pi-file"
            className="p-button-sm p-button-outlined orm-md-btn"
            onClick={openMd}
          />
        </div>
      )} */}

      {isQuiet && (
        <div className="orm-empty-quiet">
          <div className="orm-quiet-badge">Calm period · nothing needs a decision</div>
        </div>
      )}

      {/* Matched keywords summary badge (shown when snapshot present and matchedKeywords field enabled) */}
      {report?.matchedKeywordsSummary && fieldEnabled('matchedKeywords') && (
        (() => {
          const mks = report.matchedKeywordsSummary;
          const hasMk = (mks.critical?.length || mks.important?.length || mks.low?.length);
          return hasMk ? (
            <div className="orm-mks-row">
              {mks.critical?.length > 0 && <span className="orm-chip crit-chip">{mks.critical.join(', ')}</span>}
              {mks.important?.length > 0 && <span className="orm-chip imp-chip">{mks.important.join(', ')}</span>}
            </div>
          ) : null;
        })()
      )}

      {layoutRows?.map((row, rowIdx) => (
        <div className="orm-brow" key={rowIdx}>
          {row.columns?.map((col, colIdx) => (
            <div
              key={colIdx}
              className={`orm-bcol orm-bcol-${col.width}`}
              style={row.maxHeight ? { maxHeight: row.maxHeight, overflowY: 'auto' } : undefined}
            >
              {col.sections?.map((key) => sectionNodes[key])}
            </div>
          ))}
        </div>
      ))}

      {/* "What is this section?" explainer */}
      <Dialog
        header={infoKey ? SECTION_INFO[infoKey]?.title : ''}
        visible={!!infoKey}
        modal
        draggable={false}
        dismissableMask
        style={{ width: '440px', maxWidth: '94vw' }}
        onHide={() => setInfoKey(null)}
      >
        {infoKey && (
          <p className="orm-info-body">{SECTION_INFO[infoKey]?.description}</p>
        )}
      </Dialog>

      {/* Markdown file viewer */}
      <Dialog
        header="Report File"
        visible={mdDialog.visible}
        modal
        draggable={false}
        style={{ maxWidth: '100vw' }}
        onHide={() => setMdDialog({ visible: false, loading: false, content: '' })}
      >
        {mdDialog.loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><i className="pi pi-spin pi-spinner" style={{ fontSize: 22 }} /></div>
        ) : (
          <div className="orm-md-content">
            <ReactMarkdown rehypePlugins={[rehypeRaw]}>{mdDialog.content}</ReactMarkdown>
          </div>
        )}
      </Dialog>

      {/* Confirm "is this completed?" before sending an AI reply */}
      <Dialog
        header="Mark this action as completed?"
        visible={confirm.visible}
        modal
        draggable={false}
        style={{ width: '460px', maxWidth: '94vw' }}
        onHide={() => { if (!completing) setConfirm({ visible: false, todo: null }); }}
      >
        <p style={{ margin: '0 0 10px', color: '#3c4043', fontSize: 12, lineHeight: 1.55 }}>
          Mark <strong>“{confirm.todo?.task}”</strong> as completed?
        </p>
        <p style={{ margin: '0 0 18px', color: '#5f6368', fontSize: 12, lineHeight: 1.55 }}>
          We’ll generate a tailored reply from the linked email’s content and send it to the
          original sender on the same thread, then check this item off.
        </p>
        <div className="orm-confirm-actions">
          <Button
            label="Cancel"
            className="p-button-sm orm-confirm-cancel"
            disabled={completing}
            onClick={() => setConfirm({ visible: false, todo: null })}
          />
          <Button
            label={completing ? 'Sending reply…' : 'Complete & send reply'}
            icon={completing ? 'pi pi-spin pi-spinner' : 'pi pi-send'}
            className="p-button-sm orm-confirm-send"
            disabled={completing}
            onClick={doComplete}
          />
        </div>
      </Dialog>
    </div>
  );
};

export default BriefDashboard;
