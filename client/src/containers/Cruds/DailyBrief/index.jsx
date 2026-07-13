import { useEffect, useState, useCallback } from 'react';
import { Calendar } from 'primereact/calendar';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import moment from 'moment';
import fetchMethodRequest from '../../../config/service';
import config from '../../../config/config';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import { BriefDashboard, scoreColor } from '../OperationsReport/BriefDashboard';
import ReplyStudio from '../CommonComponents/ReplyStudio/ReplyStudio';
import MailThread from '../CommonComponents/MailThread';
import '../OperationsReport/OperationsReport.scss';

const DailyBrief = () => {
  const [date, setDate] = useState(new Date());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  // Email-detail drawer (screen 04)
  const [emailDrawer, setEmailDrawer] = useState({ visible: false, loading: false, mail: null, sourceId: null });
  const [readState, setReadState] = useState({ busy: false, isRead: false });
  // Signal that pushes a live read/unread toggle down to the dashboard so the
  // mails popover highlight updates immediately (no page refresh needed).
  const [readOverride, setReadOverride] = useState(null);
  // Risk-detail drawer (screen 05)
  const [riskDrawer, setRiskDrawer] = useState({ visible: false, risk: null });

  const dayKey = moment(date).format('YYYY-MM-DD');

  // Live report-config (sections/order/columns), shared with the Reports screen's
  // Report Requirements panel — always wins over a report's own stale snapshot.
  const [reportConfig, setReportConfig] = useState(null);
  useEffect(() => {
    fetchMethodRequest('GET', 'email-analysis/report-configs')
      .then((res) => {
        const configs = Array.isArray(res?.configs) ? res.configs : [];
        setReportConfig(configs.find((c) => c.isDefault) || configs[0] || null);
      })
      .catch(() => { });
  }, []);

  /* ---------------- fetch report for the selected day ---------------- */
  const fetchReport = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const key = moment(d).format('YYYY-MM-DD');
      const res = await fetchMethodRequest('GET', `email-analysis/reports/by-date?date=${key}`);
      setReport(res?.report || null);
    } catch {
      setReport(null);
      setError('Could not load the brief.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReport(date); }, [date, fetchReport]);

  /* ---------------- generate for the selected day ---------------- */
  const runBrief = async () => {
    setGenerating(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/reports/generate', { date: dayKey });
      if (res?.respCode && res.report) {
        showToasterMessage(`Brief generated (${res.report.source})`, 'success');
        setReport(res.report);
      } else {
        showToasterMessage(res?.errorMessage || 'Could not generate the brief', 'warning');
      }
    } catch {
      showToasterMessage('Brief generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const downloadMd = () => {
    if (!report?._id) return;
    window.open(`${config.apiUrl}email-analysis/reports/${report._id}/md`, '_blank');
  };

  /* ---------------- drill-downs ---------------- */
  const findAiFlag = (sourceId) => {
    const brief = report?.brief || {};
    const risk = (brief.risks || []).find((r) => r.sourceId === sourceId);
    const triage = (brief.triage || []).find((t) => t.sourceId === sourceId);
    return { risk, triage };
  };

  const openEmail = useCallback(async (sourceId) => {
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
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const openRisk = useCallback((risk) => setRiskDrawer({ visible: true, risk }), []);

  /* ---------------- render: body ---------------- */
  const renderBody = () => {
    if (loading) {
      return <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading brief…</span></div>;
    }
    if (error) {
      return (
        <div className="orm-state">
          <i className="pi pi-exclamation-triangle" /><span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => fetchReport(date)}>Retry</Button>
        </div>
      );
    }
    if (!report) {
      return (
        <div className="orm-empty">
          <i className="pi pi-calendar-times" />
          <h3>No brief for {moment(date).format('ddd, D MMM YYYY')}</h3>
          <p>No report has been generated for this day yet.</p>
          <button type="button" className="orm-runbrief-btn" onClick={runBrief} disabled={generating}>
            <i className={generating ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
            <span>Generate brief</span>
          </button>
        </div>
      );
    }
    return <BriefDashboard report={report} reportConfig={reportConfig} onOpenSource={openEmail} onOpenRisk={openRisk} readOverride={readOverride} />;
  };

  /* ---------------- render: email drawer (04) ---------------- */
  const renderEmailDrawer = () => {
    const { loading: dl, mail, sourceId } = emailDrawer;
    const { risk, triage } = findAiFlag(sourceId);
    return (
      <div className="operations-report orm-drawer orm-drawer--email">
        <div className="orm-drawer-head">
          <span className="eyebrow">Email detail</span>
        </div>
        <div className="orm-drawer-scroll">
        {dl ? (
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
                  className={`orm-email-action${readState.isRead ? ' done' : ''}`}
                  onClick={onToggleRead}
                  disabled={readState.busy}
                >
                  <i className={`pi ${readState.busy ? 'pi-spin pi-spinner' : readState.isRead ? 'pi-check-circle' : 'pi-envelope'}`} style={{color:'white'}} />
                  {readState.isRead ? 'Mark as unread' : 'Mark as read'}
                </button>
              </div>
            </div>

            {/* AI flag callout (buried-risk style) */}
            {risk && (
              <div className="orm-flag">
                <div className="ft">⚑ AI flagged — high operational risk</div>
                <div className="fs">{risk.summary}</div>
                <div className="fd">
                  Likelihood {risk.likelihood} × Impact {risk.impact} = score {risk.riskScore}.
                  {risk.mitigation ? ` ${risk.mitigation}` : ''}
                </div>
              </div>
            )}
            {!risk && triage && (
              <div className="orm-flag soft">
                <div className="ft">{triage.tier} · AI triage</div>
                <div className="fd">{triage.reason}</div>
              </div>
            )}

            {/* Complete conversation thread (older messages collapse) */}
            <MailThread mail={mail} />

            {/* Quick Replies + the Detailed Reply workspace (custom AI
                generation folded in). Needs-reply mails arrive with an
                auto-created draft — it's resumed in the Detailed Reply
                editor, which autosaves to that single draft. */}
            <div className="orm-reply-section">
              <ReplyStudio
                key={mail._id}
                mail={mail}
                sourceId={mail.providerMessageId || sourceId}
                onSent={() => fetchReport(date)}
              />
            </div>

            {mail.attachments?.length > 0 && (
              <div className="orm-att-list">
                <div className="orm-ph">Attachments<span className="n">{mail.attachments.length}</span></div>
                {mail.attachments.map((a, i) => (
                  <div className="orm-att" key={i}>
                    <i className="pi pi-paperclip" />
                    <span className="nm">{a.filename}</span>
                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="dl"><i className="pi pi-download" /></a> : <span className="muted">n/a</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </div>
      </div>
    );
  };

  /* ---------------- render: risk drawer (05) ---------------- */
  const renderRiskDrawer = () => {
    const r = riskDrawer.risk;
    if (!r) return null;
    return (
      <div className="operations-report orm-drawer bg-white">
        <div className="orm-drawer-head">
          {r.trend && <span className={`orm-chip ${r.trend === 'Escalating' ? 'esc' : r.trend === 'New' ? 'new' : ''}`}>{r.trend}</span>}
          <span className="eyebrow">Risk detail</span>
        </div>
        <div className="orm-risk-head">
          <div className="orm-score" style={{ background: scoreColor(r.riskScore), width: 56, fontSize: 15 }}>
            {r.riskScore}<small>{r.likelihood}×{r.impact}</small>
          </div>
          <div>
            <div className="orm-detail-title" style={{ fontSize: 13 }}>{r.summary}</div>
            <div className="reason">{r.category}{r.affectedArea ? ` · ${r.affectedArea}` : ''}</div>
          </div>
        </div>
        <div className="orm-statgrid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div className="orm-stat"><div className="l">Likelihood</div><div className="v">{r.likelihood} / 5</div></div>
          <div className="orm-stat"><div className="l">Impact</div><div className="v">{r.impact} / 5</div></div>
          <div className="orm-stat"><div className="l">Clock</div><div className="v" style={{ fontSize: 12 }}>{r.clock || '—'}</div></div>
          <div className="orm-stat"><div className="l">Trend</div><div className="v" style={{ fontSize: 12 }}>{r.trend || '—'}</div></div>
        </div>
        {r.mitigation && (
          <div className="orm-panel" style={{ marginTop: 14 }}>
            <div className="orm-ph">Recommended mitigation</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>{r.mitigation}</div>
          </div>
        )}
        {r.sourceId && (
          <div className="orm-panel" style={{ marginTop: 14 }}>
            <div className="orm-ph">Linked email</div>
            <div className="orm-trow" role="button" tabIndex={0}
              onClick={() => { setRiskDrawer({ visible: false, risk: null }); openEmail(r.sourceId); }}>
              <span className="orm-dotm" style={{ background: scoreColor(r.riskScore) }} />
              <span>Open source email <span className="reason">{r.sourceId}</span></span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="operations-report daily-brief bg-white" >
      <div className="orm-header">
        <div className="orm-title">
          <div className="eyebrow">Operations command center</div>
          <h1>Morning brief</h1>
        </div>
        <div className="orm-header-actions">
          <span className="orm-datefield">
            <label>Date</label>
            <Calendar
              value={date}
              onChange={(e) => e.value && setDate(e.value)}
              dateFormat="dd M yy"
              maxDate={new Date()}
              showIcon
              readOnlyInput
              appendTo={document.body}
              panelClassName="orm-cal-panel"
              inputClassName="orm-cal-input"
            />
          </span>
          {report && (
            <span className={`orm-badge ${report.source === 'live' ? 'live' : 'sample'}`}>
              {report.source === 'live' ? 'LIVE AI' : 'SAMPLE'}
            </span>
          )}
          {/* {report && (
            <Button variant="ghost" size="icon" title="Open .md" onClick={downloadMd}><FileText size={15} /></Button>
          )} */}
          <button type="button" className="orm-runbrief-btn" onClick={runBrief} disabled={generating}>
            <i className={generating ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
            <span>Run brief</span>
          </button>
        </div>
      </div>

      <div className="orm-single-body">{renderBody()}</div>

      <Sheet open={emailDrawer.visible} onOpenChange={(o) => !o && setEmailDrawer((p) => ({ ...p, visible: false }))}>
        <SheetContent side="right" className="orm-email-sheet min-w-[50vw] max-w-[98vw] overflow-hidden flex flex-col bg-white">
          {renderEmailDrawer()}
        </SheetContent>
      </Sheet>

      <Sheet open={riskDrawer.visible} onOpenChange={(o) => !o && setRiskDrawer({ visible: false, risk: null })}>
        <SheetContent side="right" className="min-w-[30vw] max-w-[98vw] overflow-y-auto bg-white">
          {renderRiskDrawer()}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default DailyBrief;
