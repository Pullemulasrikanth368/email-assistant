import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import moment from 'moment';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import QuickReplies from '../CommonComponents/QuickReplies';
import AiDraftReply from '../CommonComponents/AiDraftReply';
import MailThread from '../CommonComponents/MailThread';
import { BriefDashboard } from './BriefDashboard';
import KnowledgeBaseSettings from './KnowledgeBaseSettings';
import './OperationsReport.scss';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Day-card severity from its counts (mirrors the wireframe's Critical/Moderate/Calm).
const daySeverity = (counts = {}) => {
  if ((counts.critical || 0) > 0) return { label: 'Critical', color: 'var(--crit)', bg: 'var(--crit-bg)' };
  if ((counts.risks || 0) > 0) return { label: 'Moderate', color: 'var(--high)', bg: 'var(--high-bg)' };
  return { label: 'Calm', color: 'var(--low)', bg: 'var(--low-bg)' };
};

const BRIEF_TIMES = [
  { label: '05:00 AM', value: '05:00' },
  { label: '05:30 AM', value: '05:30' },
  { label: '06:00 AM', value: '06:00' },
  { label: '06:30 AM', value: '06:30' },
  { label: '07:00 AM', value: '07:00' },
  { label: '08:00 AM', value: '08:00' },
  { label: '09:00 AM', value: '09:00' },
];

/* ------------------------------------------------------------------ */
/* Main screen                                                        */
/* ------------------------------------------------------------------ */
const OperationsReport = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState('day'); // 'day' | 'week'
  const [reports, setReports] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ---------------- weekly reports (server-generated, idempotent) ---------------- */
  const [weekReports, setWeekReports] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [selectedWeekReport, setSelectedWeekReport] = useState(null);
  const [weekDetailLoading, setWeekDetailLoading] = useState(false);
  const [genWeekly, setGenWeekly] = useState(false);

  const activeReport = tab === 'week' ? selectedWeekReport : selectedReport;

  const [generating, setGenerating] = useState(false);
  const [briefTime, setBriefTime] = useState('06:00');
  const [emailDrawer, setEmailDrawer] = useState({ visible: false, loading: false, mail: null, sourceId: null });
  const [readState, setReadState] = useState({ busy: false, isRead: false });
  // Signal that pushes a live read/unread toggle down to the dashboard so the
  // mails popover highlight updates immediately (no page refresh needed).
  const [readOverride, setReadOverride] = useState(null);

  // Settings panels
  const [kbSheetOpen, setKbSheetOpen] = useState(false);

  // Live report-config (rows layout, sections, fields) — always wins over a report's own
  // snapshot so layout changes show up immediately without regenerating the brief.
  const [reportConfig, setReportConfig] = useState(null);
  const fetchReportConfig = useCallback(async () => {
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/report-configs');
      const configs = Array.isArray(res?.configs) ? res.configs : [];
      setReportConfig(configs.find((c) => c.isDefault) || configs[0] || null);
    } catch { /* non-fatal — BriefDashboard falls back to each report's own snapshot */ }
  }, []);
  useEffect(() => { fetchReportConfig(); }, [fetchReportConfig]);

  // Configuration now lives on its own screen — refresh the layout when the user
  // comes back to this tab/window after editing it there.
  useEffect(() => {
    const onFocus = () => fetchReportConfig();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchReportConfig]);

  /* ---------------- fetch list ---------------- */
  const fetchReports = useCallback(async (preserveSelection) => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/reports?type=day');
      const list = Array.isArray(res?.reports) ? res.reports : [];
      setReports(list);
      if (!preserveSelection && list.length) {
        setSelectedId((cur) => cur || list[0]._id);
      }
    } catch {
      setListError('Could not load reports.');
    } finally {
      setListLoading(false);
    }
  }, []);

  const fetchBriefTime = useCallback(async () => {
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/brief-time');
      if (res?.briefTime) setBriefTime(res.briefTime);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchReports(false); fetchBriefTime(); }, [fetchReports, fetchBriefTime]);

  /* ---------------- fetch detail ---------------- */
  useEffect(() => {
    if (!selectedId) { setSelectedReport(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    fetchMethodRequest('GET', `email-analysis/reports/${selectedId}`)
      .then((res) => { if (!cancelled) setSelectedReport(res?.report || null); })
      .catch(() => { if (!cancelled) setSelectedReport(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  /* ---------------- generate ---------------- */
  const runBrief = async () => {
    setGenerating(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/reports/generate', {});
      if (res?.respCode && res.report) {
        showToasterMessage(`Brief generated (${res.report.source})`, 'success');
        await fetchReports(true);
        setSelectedId(res.report._id);
      } else {
        showToasterMessage(res?.errorMessage || 'Could not generate the brief', 'warning');
      }
    } catch {
      showToasterMessage('Brief generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const saveBriefTime = async (value) => {
    setBriefTime(value);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/brief-time', { briefTime: value });
      if (res?.respCode) showToasterMessage('Brief schedule updated', 'success');
    } catch {
      showToasterMessage('Could not update schedule', 'error');
    }
  };

  const findAiFlag = useCallback((sourceId) => {
    const brief = activeReport?.brief || {};
    const risk = (brief.risks || []).find((r) => r.sourceId === sourceId);
    const triage = (brief.triage || []).find((t) => t.sourceId === sourceId);
    return { risk, triage };
  }, [activeReport]);

  // Drill-down: open the source email beside the report, without leaving it.
  const onOpenSource = useCallback(async (sourceId) => {
    if (!sourceId) return;
    setReadState({ busy: false, isRead: false });
    setEmailDrawer({ visible: true, loading: true, mail: null, sourceId });
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/by-source/${encodeURIComponent(sourceId)}`);
      const mail = res?.mail || null;
      setEmailDrawer({ visible: true, loading: false, mail, sourceId });
      setReadState({ busy: false, isRead: !(mail?.labels || []).includes('UNREAD') });
    } catch {
      setEmailDrawer({ visible: true, loading: false, mail: null, sourceId });
    }
  }, []);

  // Toggle the drawer's mail read state at the provider (Gmail/Outlook).
  const onToggleRead = useCallback(async () => {
    const { mail, sourceId } = emailDrawer;
    const id = mail?.providerMessageId || sourceId;
    if (!id) return;
    const nextIsRead = !readState.isRead;
    setReadState((s) => ({ ...s, busy: true }));
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/mark-read', {
        sourceId: id, email: mail?.email, isRead: nextIsRead,
      });
      if (res?.respCode) {
        setReadState({ busy: false, isRead: nextIsRead });
        setReadOverride((prev) => ({ sourceId, isRead: nextIsRead, nonce: (prev?.nonce || 0) + 1 }));
        showToasterMessage(nextIsRead ? 'Marked as read' : 'Marked as unread', 'success');
      } else {
        setReadState((s) => ({ ...s, busy: false }));
        showToasterMessage(res?.errorMessage || 'Could not update read state', 'error');
      }
    } catch {
      setReadState((s) => ({ ...s, busy: false }));
      showToasterMessage('Could not update read state', 'error');
    }
  }, [emailDrawer, readState.isRead]);

  const fetchWeekReports = useCallback(async (preserveSelection) => {
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/reports?type=week');
      const list = Array.isArray(res?.reports) ? res.reports : [];
      setWeekReports(list);
      if (!preserveSelection && list.length) setSelectedWeekId((cur) => cur || list[0]._id);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchWeekReports(false); }, [fetchWeekReports]);

  // Selectable weeks of the CURRENT month (ISO weeks, up to the current week).
  const monthWeekOptions = (() => {
    const out = [];
    const thisWeek = moment().startOf('isoWeek');
    const monthEnd = moment().endOf('month');
    let cur = moment().startOf('month').startOf('isoWeek');
    while (cur.isSameOrBefore(monthEnd, 'day') && cur.isSameOrBefore(thisWeek, 'day')) {
      out.push({ label: `Week of ${cur.format('D MMM')}`, value: cur.format('YYYY-MM-DD') });
      cur = cur.clone().add(1, 'week');
    }
    return out;
  })();

  // The week the generate/regenerate controls act on (default: current week).
  const [selectedWeekStart, setSelectedWeekStart] = useState(moment().startOf('isoWeek').format('YYYY-MM-DD'));
  // Does the SELECTED week already have a report? (drives generate vs regenerate)
  const selectedWeekHasReport = weekReports.find((r) => moment(r.periodStart).isSame(moment(selectedWeekStart), 'day'));

  // Picking a week: if it already has a report, open it in the detail pane.
  const onPickWeek = (value) => {
    setSelectedWeekStart(value);
    const existing = weekReports.find((r) => moment(r.periodStart).isSame(moment(value), 'day'));
    if (existing) setSelectedWeekId(existing._id);
  };

  // Load the selected week's full report (list excludes the brief body).
  useEffect(() => {
    if (tab !== 'week' || !selectedWeekId) return undefined;
    let cancelled = false;
    setWeekDetailLoading(true);
    fetchMethodRequest('GET', `email-analysis/reports/${selectedWeekId}`)
      .then((res) => { if (!cancelled) setSelectedWeekReport(res?.report || null); })
      .catch(() => { if (!cancelled) setSelectedWeekReport(null); })
      .finally(() => { if (!cancelled) setWeekDetailLoading(false); });
    return () => { cancelled = true; };
  }, [tab, selectedWeekId]);

  const generateWeekly = async (force) => {
    setGenWeekly(true);
    try {
      const body = { type: 'week', date: selectedWeekStart, force: !!force };
      const res = await fetchMethodRequest('POST', 'email-analysis/reports/generate', body);
      if (res?.respCode && res.report) {
        showToasterMessage(res.created ? 'Weekly report generated' : 'Selected week is already generated', res.created ? 'success' : 'info');
        await fetchWeekReports(true);
        setSelectedWeekId(res.report._id);
      } else {
        showToasterMessage(res?.errorMessage || 'Could not generate the weekly report', 'warning');
      }
    } catch {
      showToasterMessage('Weekly generation failed', 'error');
    } finally {
      setGenWeekly(false);
    }
  };

  /* ---------------- render: day card ---------------- */
  const renderDayCard = (r) => {
    const sev = daySeverity(r.counts);
    const active = r._id === selectedId;
    return (
      <div
        key={r._id}
        className={cn('orm-daycard', { active })}
        style={{ borderLeftColor: sev.color }}
        onClick={() => setSelectedId(r._id)}
        role="button"
        tabIndex={0}
      >
        <div className="orm-daycard-top">
          <span className="wd">{moment(r.periodStart).format('ddd · D MMM')}</span>
          <span className="sev" style={{ color: sev.color }}>{sev.label}</span>
        </div>
        <div className="orm-daycard-stats">
          {(r.counts?.critical || 0)} critical · {(r.counts?.decisions || 0)} decisions · {(r.counts?.risks || 0)} risks
        </div>
      </div>
    );
  };

  /* ---------------- render: empty / loading / error ---------------- */
  const renderListPanel = () => {
    if (listLoading) {
      return <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading reports…</span></div>;
    }
    if (listError) {
      return (
        <div className="orm-state">
          <i className="pi pi-exclamation-triangle" /><span>{listError}</span>
          <Button size="sm" variant="outline" onClick={() => fetchReports(false)}>Retry</Button>
        </div>
      );
    }
    if (tab === 'day' && !reports.length) {
      return (
        <div className="orm-empty">
          <i className="pi pi-chart-bar" />
          <h3>No reports yet</h3>
          <p>Connect a Google account and sync your inbox, then generate the first brief.</p>
          <div className="orm-empty-actions">
            <button type="button" className="orm-connect-btn" onClick={() => navigate('/connectionsDelivery')}>
              <i className="pi pi-link" />
              <span>Connections</span>
            </button>
            <button type="button" className="orm-runbrief-btn" onClick={runBrief} disabled={generating}>
              <i className={generating ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
              <span>Run brief</span>
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'day') {
      return <div className="orm-daylist">{reports.map(renderDayCard)}</div>;
    }

    // weekly list — server-generated reports + idempotent generate control
    return (
      <div className="orm-week-pane">
        <div className="orm-week-gen">
          <span className="orm-week-pick">
            <label>Week (this month)</label>
            <Select value={selectedWeekStart || ''} onValueChange={onPickWeek}>
              <SelectTrigger className="orm-week-dd">
                <SelectValue placeholder="Select a week" />
              </SelectTrigger>
              <SelectContent>
                {(monthWeekOptions || []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>

          <div className="orm-week-actions">
            {selectedWeekHasReport ? (
              <>
                <span className="orm-week-done" title="This week is generated"><i className="pi pi-check-circle" /></span>
                <button
                  type="button"
                  className="orm-week-regen"
                  onClick={() => generateWeekly(true)}
                  disabled={genWeekly}
                  title="Force a fresh weekly report"
                >
                  <i className={genWeekly ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'} />
                  <span>Regenerate</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="orm-runbrief-btn orm-week-run"
                onClick={() => generateWeekly(false)}
                disabled={genWeekly}
              >
                <i className={genWeekly ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
                <span>Generate week</span>
              </button>
            )}
          </div>
        </div>

        {weekReports.length === 0 ? (
          <div className="orm-empty" style={{ padding: '24px 12px' }}>
            <i className="pi pi-calendar" />
            <p>No weekly reports yet. Generate this week to start.</p>
          </div>
        ) : (
          <div className="orm-daylist">
            {weekReports.map((w) => {
              const sev = daySeverity(w.counts);
              return (
                <div
                  key={w._id}
                  className={cn('orm-daycard', { active: selectedWeekId === w._id })}
                  style={{ borderLeftColor: sev.color }}
                  onClick={() => setSelectedWeekId(w._id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="orm-daycard-top">
                    <span className="wd">{w.periodLabel}</span>
                    <span className="sev" style={{ color: sev.color }}>{sev.label}</span>
                  </div>
                  <div className="orm-daycard-stats">
                    {(w.counts?.critical || 0)} critical · {(w.counts?.decisions || 0)} decisions · {(w.counts?.risks || 0)} risks
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderDetailPanel = () => {
    if (tab === 'week') {
      if (weekDetailLoading) {
        return <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading weekly report…</span></div>;
      }
      if (!selectedWeekReport) {
        return <div className="orm-empty"><i className="pi pi-calendar" /><h3>No weekly report selected</h3><p>Generate this week or pick one from the list.</p></div>;
      }
      return (
        <>
          <div className="orm-detail-head">
            <h2 className="orm-detail-title">{selectedWeekReport.periodLabel}</h2>
            <span className={`orm-badge ${selectedWeekReport.source === 'live' ? 'live' : 'sample'}`}>
              {selectedWeekReport.source === 'live' ? 'LIVE AI' : 'SAMPLE'}
            </span>
          </div>
          <BriefDashboard report={selectedWeekReport} reportConfig={reportConfig} onOpenSource={onOpenSource} readOverride={readOverride} />
        </>
      );
    }

    if (detailLoading) {
      return <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading brief…</span></div>;
    }
    if (!selectedReport) {
      return <div className="orm-empty"><i className="pi pi-envelope" /><h3>Select a day</h3><p>Pick a date to view its brief.</p></div>;
    }
    return (
      <>
        <div className="orm-detail-head">
          <h2 className="orm-detail-title">{selectedReport.periodLabel || moment(selectedReport.periodStart).format('ddd, D MMM YYYY')}</h2>
          {/* <span className={`orm-badge ${selectedReport.source === 'live' ? 'live' : 'sample'}`}>
            {selectedReport.source === 'live' ? 'LIVE AI' : 'SAMPLE'}
          </span> */}
        </div>
        <BriefDashboard report={selectedReport} reportConfig={reportConfig} onOpenSource={onOpenSource} readOverride={readOverride} />
      </>
    );
  };

  // Re-pull the open day report so a completed to-do shows as done immediately.
  const refreshActiveReport = useCallback(async () => {
    if (tab === 'week' || !selectedId) return;
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/reports/${selectedId}`);
      if (res?.report) setSelectedReport(res.report);
    } catch { /* non-fatal */ }
  }, [tab, selectedId]);

  const renderEmailDrawer = () => {
    const { loading: drawerLoading, mail, sourceId } = emailDrawer;
    const { risk, triage } = findAiFlag(sourceId);
    // Open to-do linked to this email — switches the draft panel's actions to
    // "Mark as complete & send" / "Send only".
    const todoForSource = (activeReport?.brief?.todoList || [])
      .find((t) => t.sourceId === sourceId && t.status !== 'Completed') || null;

    return (
      <div className="operations-report orm-drawer">
        <div className="orm-drawer-head">
          <span className="eyebrow">Email detail</span>
        </div>
        {drawerLoading ? (
          <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading email…</span></div>
        ) : !mail ? (
          <div className="orm-state"><i className="pi pi-inbox" /><span>Source email not found in synced mail.</span></div>
        ) : (
          <>
            <div className="orm-email-head">
              <div className="orm-email-head-main">
                <div className="orm-email-from">{mail.from}</div>
                <h3 className="orm-email-subject">{mail.subject || '(no subject)'}</h3>
                <div className="orm-email-meta">{mail.receivedAt ? moment(mail.receivedAt).format('ddd, MMM D, YYYY h:mm A') : ''}</div>
              </div>
              <div className="orm-email-actions">
                <button
                  type="button"
                  className={cn('orm-email-action', { done: readState.isRead })}
                  onClick={onToggleRead}
                  disabled={readState.busy}
                >
                  <i className={`pi ${readState.busy ? 'pi-spin pi-spinner' : readState.isRead ? 'pi-check-circle' : 'pi-envelope'}`} />
                  {readState.isRead ? 'Mark as unread' : 'Mark as read'}
                </button>
              </div>
            </div>

            {risk && (
              <div className="orm-flag">
                <div className="ft">AI flagged - high operational risk</div>
                <div className="fs">{risk.summary}</div>
                <div className="fd">
                  Likelihood {risk.likelihood} x Impact {risk.impact} = score {risk.riskScore}.
                  {risk.mitigation ? ` ${risk.mitigation}` : ''}
                </div>
              </div>
            )}
            {!risk && triage && (
              <div className="orm-flag soft">
                <div className="ft">{triage.tier} - AI triage</div>
                <div className="fd">{triage.reason}</div>
              </div>
            )}

            {/* Complete conversation thread (older messages collapse) */}
            <MailThread mail={mail} />

            {mail.attachments?.length > 0 && (
              <div className="orm-att-list">
                <div className="orm-ph">Attachments<span className="n">{mail.attachments.length}</span></div>
                {mail.attachments.map((a, i) => (
                  <div className="orm-att" key={`${a.filename || 'attachment'}-${i}`}>
                    <i className="pi pi-paperclip" />
                    <span className="nm">{a.filename}</span>
                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="dl"><i className="pi pi-download" /></a> : <span className="muted">n/a</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="orm-reply-section">
              <QuickReplies sourceId={mail.providerMessageId || sourceId} preloaded={mail.quickReplies} />
              <AiDraftReply
                key={mail._id}
                mailId={mail._id}
                sourceId={mail.providerMessageId || sourceId}
                mail={mail}
                initialDraft={mail.draft}
                todo={todoForSource}
                reportId={activeReport?._id}
                onCompleted={refreshActiveReport}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="operations-report">
      {/* Header */}
      <div className="orm-header">
        <div className="orm-title">
          <div className="eyebrow">Operations command center</div>
          <h1>Reports</h1>
        </div>
        <div className="orm-header-actions">
          <span className="orm-meta">{moment().format('ddd D MMM, HH:mm')}</span>
          <span className="orm-time-field">
            <label>Brief at</label>
            <Select value={briefTime || ''} onValueChange={saveBriefTime}>
              <SelectTrigger className="orm-brief-time-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(BRIEF_TIMES || []).map((o) => (
                  <SelectItem key={o.value || o} value={o.value || o}>{o.label || o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
          {/* <button type="button" className="orm-settings-btn" onClick={() => setKbSheetOpen(true)} title="Knowledge Base Settings">
            <i className="pi pi-book" />
            <span>KB</span>
          </button> */}
          <button type="button" className="orm-settings-btn" onClick={() => navigate('/reportConfig')} title="Report Configuration">
            <i className="pi pi-sliders-h" />
            <span>Configure</span>
          </button>
          <button type="button" className="orm-runbrief-btn" onClick={runBrief} disabled={generating}>
            <i className={generating ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
            <span>Run brief</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="orm-tabs">
        <button className={cn('orm-tab', { active: tab === 'day' })} onClick={() => setTab('day')}>Day-wise</button>
        <button className={cn('orm-tab', { active: tab === 'week' })} onClick={() => setTab('week')}>Weekly-wise</button>
      </div>

      {/* Master-detail */}
      <div className="orm-body">
        <div className="orm-list-pane">{renderListPanel()}</div>
        <div className="orm-detail-pane">{renderDetailPanel()}</div>
      </div>

      <Sheet open={emailDrawer.visible} onOpenChange={(o) => !o && setEmailDrawer((p) => ({ ...p, visible: false }))}>
        <SheetContent side="right" className="min-w-[30vw] w-[70vw] !max-w-[96vw] sm:!max-w-[720px] overflow-y-auto bg-white">
          {renderEmailDrawer()}
        </SheetContent>
      </Sheet>

      {/* Knowledge Base Settings sheet */}
      <Sheet open={kbSheetOpen} onOpenChange={setKbSheetOpen}>
        <SheetContent side="right" className="w-[520px] !max-w-[96vw] overflow-y-auto bg-white">
          <div className="orm-sheet-head">
            <h3>Knowledge Base</h3>
            <p className="orm-sheet-sub">Configure how AI analyzes emails: categorization, priority rules, risk scoring, routing, and domain terms.</p>
          </div>
          <KnowledgeBaseSettings onClose={() => setKbSheetOpen(false)} />
        </SheetContent>
      </Sheet>

    </div>
  );
};

export default OperationsReport;
