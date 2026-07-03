/* Shared dashboard renderer (wireframe screen 02) used by the Reports screen
   and the Daily Brief screen. */
import { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Info, Mail } from 'lucide-react';
import fetchMethodRequest from '../../../config/service';
import { url } from '../../../config/config';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const todoKey = (t) => `${t.sourceId || ''}::${t.task || ''}`;

// Viewport caps how many columns can actually fit well, regardless of what's configured:
// mobile gets 1, small/tablet gets at most 2, desktop gets 3, and only extra-large screens get 4.
const maxColumnsForWidth = (w) => {
  if (w < 640) return 1;
  if (w < 1300) return 2;
  if (w < 1800) return 3;
  return 4;
};

const useResponsiveColumnCap = () => {
  const [cap, setCap] = useState(() => (typeof window !== 'undefined' ? maxColumnsForWidth(window.innerWidth) : 3));
  useEffect(() => {
    const onResize = () => setCap(maxColumnsForWidth(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cap;
};

// Risk score -> severity colour tier (score drives colour, not decoration).
export const scoreColor = (score) => {
  if (score >= 16) return 'var(--crit)';
  if (score >= 10) return 'var(--high)';
  if (score >= 5) return 'var(--med)';
  return 'var(--low)';
};

const TREND_LABEL = { New: 'new', Escalating: 'escalating', Cooling: 'cooling', Stable: 'stable' };

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

const DEFAULT_SECTION_ORDER = [
  'narrativeSummary', 'mailBriefs', 'decisionQueue', 'riskRadar', 'riskMatrix', 'todoList',
  'events', 'calendarConflicts', 'patterns', 'inboxTriage', 'actionRegister',
];

// Copy shown in the "what is this section?" info modal, keyed by section id.
const SECTION_INFO = {
  narrativeSummary: {
    title: 'Narrative summary',
    description: 'A plain-English overview of everything that happened in your inbox for this period. The AI condenses all analyzed emails into a few key points so you can catch up at a glance without opening each mail. Expand a point’s "Mails" toggle to see and open the source emails behind it.',
  },
  mailBriefs: {
    title: 'Mail briefs',
    description: 'Short, one-paragraph summaries of individual noteworthy emails — the subject, who sent it, and the gist of what it says. Click a brief to open the original email.',
  },
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
  inboxTriage: {
    title: 'Inbox triage',
    description: 'Every analyzed email sorted into Critical, Important, or Low priority using the keywords and rules from your knowledge base. Each entry shows why it was placed in that tier; click it to open the email. Only the highest tier starts expanded.',
  },
  actionRegister: {
    title: 'Action register',
    description: 'The full list of action items extracted from your emails — including ones owned by other people — with the owner and deadline for each. Broader than "Your to-do", which only shows tasks assigned to you.',
  },
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

const buildRiskMatrixItems = (risks = [], triage = []) => {
  const usedSourceIds = new Set(risks.map((r) => r.sourceId).filter(Boolean));
  const triagePoints = triage
    .filter((t) => t?.sourceId && !usedSourceIds.has(t.sourceId))
    .map(triageToMatrixRisk);
  return [...risks, ...triagePoints];
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
  const responsiveColumnCap = useResponsiveColumnCap();

  // Layout/visibility (sections, fields, order, columns) is a display concern, so the
  // live report-config always wins; the report's own snapshot is only a fallback for
  // older reports generated before the live config could be fetched.
  const rcSnap = reportConfig || report?.reportConfigSnapshot || null;
  const enabledSections = rcSnap?.enabledSections || null; // null = show all
  const selectedFields = rcSnap?.selectedFields || null;   // null = show all

  const sectionEnabled = (key) => !enabledSections || enabledSections.includes(key);
  const fieldEnabled = (key) => !selectedFields || selectedFields.includes(key);

  const mailBriefs = brief.mailBriefs || [];
  const keyPoints = brief.narrativeKeyPoints || [];
  const risks = [...(brief.risks || [])].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const decisions = brief.decisionQueue || [];
  const collisions = brief.collisions || [];
  const todos = brief.todoList || [];
  const patterns = brief.patterns || [];
  const triage = brief.triage || [];
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

  const tierGroups = {
    Critical: triage.filter((t) => t.tier === 'Critical'),
    Important: triage.filter((t) => t.tier === 'Important'),
    Low: triage.filter((t) => t.tier === 'Low'),
  };

  const isQuiet = !decisions.length && !risks.length && !collisions.length;

  /* -------- collapsible panels: every section header toggles its body -------- */
  // Mail Briefs starts collapsed. Inside Inbox Triage only the highest-severity
  // tier that has items starts open; the other tiers start collapsed.
  const [collapsedKeys, setCollapsedKeys] = useState(() => {
    const init = new Set(['mailBriefs']);
    ['Critical', 'Important', 'Low']
      .filter((tier) => tierGroups[tier].length > 0)
      .slice(1)
      .forEach((tier) => init.add(`triage:${tier}`));
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

  // One accordion per key point: the "Mails (n)" toggle reveals that point's mail badges.
  const [expandedKpMails, setExpandedKpMails] = useState(() => new Set());
  const toggleKpMails = (key) => setExpandedKpMails((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderKeyPoints = (points) => (
    <ul className="orm-kp-list">
      {points.map((kp, i) => {
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
                    {kp.mails.map((m, j) => (
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

  /* -------- section renderers, keyed the same as the report-config's sectionOrder -------- */
  const sectionNodes = {
    mailBriefs: sectionEnabled('mailBriefs') && mailBriefs.length > 0 && panel(
      'mailBriefs', 'Mail briefs', mailBriefs.length,
      <>
        {mailBriefs.map((m, i) => (
          <div className="orm-mailbrief" key={i} onClick={() => onOpenSource(m.sourceId)} role="button" tabIndex={0}>
            <div className="mb-subject">{m.subject || '(no subject)'}</div>
            {m.from && <div className="mb-from">From: {m.from}</div>}
            {m.brief && <div className="mb-brief">{m.brief}</div>}
          </div>
        ))}
      </>
    ),

    decisionQueue: sectionEnabled('decisionQueue') && decisions.length > 0 && panel(
      'decisionQueue', 'Decisions needed today', decisions.length,
      <>
        {decisions.map((d, i) => (
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
        {risks.map((r, i) => (
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
      <>{patterns.map((p, i) => <div className="orm-pattern" key={i}>{p}</div>)}</>
    ),

    inboxTriage: sectionEnabled('inboxTriage') && triage.length > 0 && panel(
      'inboxTriage', 'Inbox triage', triage.length,
      <>
        {['Critical', 'Important', 'Low'].map((tier) => (
          tierGroups[tier].length > 0 && (
            <div key={tier}>
              <div
                className={`orm-tier orm-tier-toggle ${tier.toLowerCase()}`}
                role="button"
                tabIndex={0}
                aria-expanded={!collapsedKeys.has(`triage:${tier}`)}
                onClick={() => toggleSection(`triage:${tier}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleSection(`triage:${tier}`); }}
              >
                <i className={`pi ${collapsedKeys.has(`triage:${tier}`) ? 'pi-chevron-right' : 'pi-chevron-down'}`} />
                {tier} · {tierGroups[tier].length}
              </div>
              {!collapsedKeys.has(`triage:${tier}`) && tierGroups[tier].map((t, i) => (
                <div className={`orm-trow orm-trow-rich t-${tier.toLowerCase()}`} key={i} onClick={() => onOpenSource(t.sourceId)} role="button" tabIndex={0}>
                  <Mail className="orm-mail-icon" style={{ color: tier === 'Critical' ? 'var(--crit)' : tier === 'Important' ? 'var(--high)' : 'var(--muted)' }} />
                  <div className="orm-trow-body">
                    <div className="orm-trow-head">
                      {t.subject && <span className="subject">{t.subject}</span>}
                      {t.from && <span className="from">{t.from}</span>}
                    </div>
                    <span className="reason">{t.reason}</span>
                    {t.summary && <div className="summary">{t.summary}</div>}
                    {fieldEnabled('matchedKeywords') && t.matchedKeywords?.length > 0 && (
                      <span className="orm-chip kw" style={{ marginTop: 4 }}>{t.matchedKeywords.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ))}
      </>
    ),

    actionRegister: sectionEnabled('actionRegister') && actions.length > 0 && panel(
      'actionRegister', 'Action register', actions.length,
      <>
        {actions.map((a, i) => (
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
        {collisions.map((c, i) => (
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
        {todos.map((t, i) => {
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
        {events.map((event, i) => {
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

  const configuredColumnCount = Math.min(4, Math.max(1, Number(rcSnap?.columnCount) || 2));
  // Viewport may force fewer columns than configured — use the layout the user specifically
  // designed for THAT column count (col-1/col-2/col-3 are remembered independently), not a
  // re-derived one, so resizing the window shows what was actually set up for that width.
  const columnCount = Math.min(configuredColumnCount, responsiveColumnCap);
  const activeLayout = rcSnap?.columnLayouts?.[columnCount] || rcSnap?.columnLayouts?.[String(columnCount)] || null;

  const legacyOrder = rcSnap?.sectionOrder?.length ? rcSnap.sectionOrder : DEFAULT_SECTION_ORDER;
  const configuredOrder = activeLayout?.sectionOrder?.length ? activeLayout.sectionOrder : legacyOrder;
  const orderedKeys = [
    ...configuredOrder.filter((key) => key !== 'narrativeSummary' && sectionNodes[key]),
    ...DEFAULT_SECTION_ORDER.filter((key) => key !== 'narrativeSummary' && sectionNodes[key] && !configuredOrder.includes(key)),
  ];

  // Explicit column placement wins; anything unassigned round-robins (item 1 -> col 1,
  // item 2 -> col 2, item 3 -> col 3, item 4 -> col 1, ...) so older configs still lay out sensibly.
  const columnAssignments = activeLayout?.columnAssignments || rcSnap?.columnAssignments || {};
  const columns = Array.from({ length: columnCount }, () => []);
  orderedKeys.forEach((key, i) => {
    const assigned = columnAssignments[key];
    const col = Number.isInteger(assigned) && assigned >= 0 && assigned < columnCount ? assigned : i % columnCount;
    columns[col].push(key);
  });

  return (
    <div className="orm-dash">
      {report?.mdPath && (
        <div className="orm-md-bar">
          <Button
            label="View Report File"
            icon="pi pi-file"
            className="p-button-sm p-button-outlined orm-md-btn"
            onClick={openMd}
          />
        </div>
      )}

      {/* Narrative summary: always a full-width row at the top; the key points
          inside it flow in a fixed 2-column grid. */}
      {sectionEnabled('narrativeSummary') && (keyPoints.length > 0 || brief.narrative) && (
        <div className="orm-narr">
          <div
            className="orm-ph orm-ph-toggle orm-narr-head"
            onClick={() => toggleSection('narrativeSummary')}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleSection('narrativeSummary'); }}
            role="button"
            tabIndex={0}
            aria-expanded={!collapsedKeys.has('narrativeSummary')}
          >
            <i className={`pi ${collapsedKeys.has('narrativeSummary') ? 'pi-chevron-right' : 'pi-chevron-down'} orm-ph-chev`} />
            Narrative summary
            {keyPoints.length > 0 && <span className="n">{keyPoints.length}</span>}
            {infoButton('narrativeSummary')}
          </div>
          {!collapsedKeys.has('narrativeSummary') && (
            keyPoints.length > 0 ? renderKeyPoints(keyPoints) : <p>{brief.narrative}</p>
          )}
        </div>
      )}

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

      <div className="orm-grid" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
        {columns.map((colKeys, colIdx) => (
          <div key={colIdx}>
            {colKeys.map((key) => sectionNodes[key])}
          </div>
        ))}
      </div>

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
