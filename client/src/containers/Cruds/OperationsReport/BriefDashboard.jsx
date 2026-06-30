/* Shared dashboard renderer (wireframe screen 02) used by the Reports screen
   and the Daily Brief screen. */
import { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const todoKey = (t) => `${t.sourceId || ''}::${t.task || ''}`;

// Risk score -> severity colour tier (score drives colour, not decoration).
export const scoreColor = (score) => {
  if (score >= 16) return 'var(--crit)';
  if (score >= 10) return 'var(--high)';
  if (score >= 5) return 'var(--med)';
  return 'var(--low)';
};

const TREND_LABEL = { New: 'new', Escalating: 'escalating', Cooling: 'cooling', Stable: 'stable' };

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
          {here.length > 0 && <span className="orm-dot">{here.length > 1 ? here.length : ''}</span>}
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
export const BriefDashboard = ({ report, onOpenSource = () => {}, onOpenRisk }) => {
  const brief = report?.brief || {};

  // Use report config snapshot if present; fall back to showing everything.
  const rcSnap = report?.reportConfigSnapshot || null;
  const enabledSections = rcSnap?.enabledSections || null; // null = show all
  const selectedFields = rcSnap?.selectedFields || null;   // null = show all

  const sectionEnabled = (key) => !enabledSections || enabledSections.includes(key);
  const fieldEnabled = (key) => !selectedFields || selectedFields.includes(key);

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

  return (
    <div className="orm-dash">
      {sectionEnabled('narrativeSummary') && brief.narrative && (
        <div className="orm-narr"><p>{brief.narrative}</p></div>
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

      <div className="orm-grid2">
        <div>
          {sectionEnabled('decisionQueue') && decisions.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Decisions needed today<span className="n">{decisions.length}</span></div>
              {decisions.map((d, i) => (
                <div className="orm-dec" key={i} onClick={() => onOpenSource(d.sourceId)} role="button" tabIndex={0}>
                  <div className="t">{d.title}</div>
                  {d.why && <div className="w">{d.why}</div>}
                  {d.deadline && fieldEnabled('deadline') && <span className="due">DUE: {d.deadline}</span>}
                </div>
              ))}
            </div>
          )}

          {sectionEnabled('riskRadar') && risks.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Risk radar<span className="n">{risks.length}</span></div>
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
            </div>
          )}

          {sectionEnabled('patterns') && patterns.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Patterns</div>
              {patterns.map((p, i) => <div className="orm-pattern" key={i}>{p}</div>)}
            </div>
          )}

          {sectionEnabled('inboxTriage') && triage.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Inbox triage<span className="n">{triage.length}</span></div>
              {['Critical', 'Important', 'Low'].map((tier) => (
                tierGroups[tier].length > 0 && (
                  <div key={tier}>
                    <div className={`orm-tier ${tier.toLowerCase()}`}>{tier} · {tierGroups[tier].length}</div>
                    {tierGroups[tier].map((t, i) => (
                      <div className="orm-trow" key={i} onClick={() => onOpenSource(t.sourceId)} role="button" tabIndex={0}>
                        <span className="orm-dotm" style={{ background: tier === 'Critical' ? 'var(--crit)' : tier === 'Important' ? 'var(--high)' : 'var(--muted)' }} />
                        <span className="reason">{t.reason}</span>
                        {fieldEnabled('matchedKeywords') && t.matchedKeywords?.length > 0 && (
                          <span className="orm-chip kw" style={{ marginLeft: 6 }}>{t.matchedKeywords.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ))}
            </div>
          )}

          {sectionEnabled('actionRegister') && actions.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Action register<span className="n">{actions.length}</span></div>
              <table className="orm-actions">
                <tbody>
                  {actions.map((a, i) => (
                    <tr key={i} onClick={() => onOpenSource(a.sourceId)}>
                      <td className="task">{a.task}</td>
                      {fieldEnabled('owner') && <td className="owner">{a.owner || '-'}</td>}
                      {fieldEnabled('deadline') && <td className="due">{a.deadline || ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          {sectionEnabled('riskRadar') && riskMatrixItems.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Risk matrix<span className="n">{riskMatrixItems.length}</span></div>
              <RiskMatrix risks={riskMatrixItems} onPick={openRisk} />
            </div>
          )}

          {sectionEnabled('calendarConflicts') && collisions.length > 0 && (
            <div className="orm-panel orm-panel-amber">
              <div className="orm-ph" style={{ color: 'var(--high)' }}>Schedule collisions<span className="n">{collisions.length}</span></div>
              {collisions.map((c, i) => (
                <div className="orm-coll" key={i}>
                  <div className="ct">{c.type}</div>
                  <div className="cs">{c.summary}{c.when ? ` · ${c.when}` : ''}</div>
                  {c.suggestion && <div className="cg"><b>Suggested:</b> {c.suggestion}</div>}
                </div>
              ))}
            </div>
          )}

          {sectionEnabled('todoList') && todos.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Your to-do<span className="n">{todos.length}</span></div>
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
            </div>
          )}

          {sectionEnabled('events') && events.length > 0 && (
            <div className="orm-panel">
              <div className="orm-ph">Events mentioned<span className="n">{events.length}</span></div>
              {events.map((event, i) => (
                <div className="orm-event" key={i} onClick={() => onOpenSource(event.sourceId)} role="button" tabIndex={0}>
                  <div className="et">{event.title}</div>
                  <div className="em">
                    {event.when && <span>{event.when}</span>}
                    {event.type && <span>{event.type}</span>}
                    {event.owner && <span>{event.owner}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
