import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Calendar } from 'primereact/calendar';
import DOMPurify from 'dompurify';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import moment from 'moment';
import fetchMethodRequest from '../../../config/service';
import config from '../../../config/config';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import { BriefDashboard, scoreColor } from '../OperationsReport/BriefDashboard';
import QuickReplies from '../CommonComponents/QuickReplies';
import '../OperationsReport/OperationsReport.scss';

/* Sanitised email body in an isolated iframe (keeps email CSS, blocks scripts) */
const MailFrame = ({ body, snippet }) => {
  const ref = useRef(null);
  const srcDoc = useMemo(() => {
    const raw = (body || snippet || '').trim();
    const HEAD = '<meta charset="utf-8"><base target="_blank"><style>html{padding:12px;box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;color:#202124;font-size:14px;line-height:1.6;word-break:break-word}img{max-width:100%;height:auto}a{color:#1a73e8}table{max-width:100%}</style>';
    if (!raw) return `<!doctype html><html><head>${HEAD}</head><body><p style="color:#80868b">No content.</p></body></html>`;
    if (!/<[a-z][\s\S]*>/i.test(raw)) {
      const escd = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<!doctype html><html><head>${HEAD}</head><body><pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escd}</pre></body></html>`;
    }
    const clean = DOMPurify.sanitize(raw, { WHOLE_DOCUMENT: true, ADD_ATTR: ['target'] });
    if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head([^>]*)>/i, `<head$1>${HEAD}`);
    if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html([^>]*)>/i, `<html$1><head>${HEAD}</head>`);
    return `<!doctype html><html><head>${HEAD}</head><body>${clean}</body></html>`;
  }, [body, snippet]);

  const onLoad = useCallback(() => {
    const f = ref.current;
    if (!f) return;
    try {
      const doc = f.contentDocument || f.contentWindow.document;
      f.style.height = `${Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) + 8}px`;
    } catch { f.style.height = '420px'; }
  }, []);

  return (
    <iframe
      ref={ref}
      title="source-email"
      className="orm-mail-frame"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      srcDoc={srcDoc}
      onLoad={onLoad}
    />
  );
};

const DailyBrief = () => {
  const [date, setDate] = useState(new Date());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  // Email-detail drawer (screen 04)
  const [emailDrawer, setEmailDrawer] = useState({ visible: false, loading: false, mail: null, sourceId: null });
  // Risk-detail drawer (screen 05)
  const [riskDrawer, setRiskDrawer] = useState({ visible: false, risk: null });

  const dayKey = moment(date).format('YYYY-MM-DD');

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
    setEmailDrawer({ visible: true, loading: true, mail: null, sourceId });
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/by-source/${encodeURIComponent(sourceId)}`);
      setEmailDrawer({ visible: true, loading: false, mail: res?.mail || null, sourceId });
    } catch {
      setEmailDrawer({ visible: true, loading: false, mail: null, sourceId });
    }
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return <BriefDashboard report={report} onOpenSource={openEmail} onOpenRisk={openRisk} />;
  };

  /* ---------------- render: email drawer (04) ---------------- */
  const renderEmailDrawer = () => {
    const { loading: dl, mail, sourceId } = emailDrawer;
    const { risk, triage } = findAiFlag(sourceId);
    return (
      <div className="operations-report orm-drawer">
        <div className="orm-drawer-head">
          <span className="eyebrow">Email detail</span>
        </div>
        {dl ? (
          <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading email…</span></div>
        ) : !mail ? (
          <div className="orm-state"><i className="pi pi-inbox" /><span>Source email not found in synced mail.</span></div>
        ) : (
          <>
            <div className="orm-email-from">{mail.from}</div>
            <h3 className="orm-email-subject">{mail.subject || '(no subject)'}</h3>
            <div className="orm-email-meta">{mail.receivedAt ? moment(mail.receivedAt).format('ddd, MMM D, YYYY h:mm A') : ''}</div>

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

            <MailFrame body={mail.body} snippet={mail.snippet} />

            {/* One-click quick replies for this email */}
            <QuickReplies sourceId={mail.providerMessageId || sourceId} />

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
          {report && (
            <Button variant="ghost" size="icon" title="Open .md" onClick={downloadMd}><FileText size={15} /></Button>
          )}
          <button type="button" className="orm-runbrief-btn" onClick={runBrief} disabled={generating}>
            <i className={generating ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'} />
            <span>Run brief</span>
          </button>
        </div>
      </div>

      <div className="orm-single-body">{renderBody()}</div>

      <Sheet open={emailDrawer.visible} onOpenChange={(o) => !o && setEmailDrawer((p) => ({ ...p, visible: false }))}>
        <SheetContent side="right" className="min-w-[30vw] max-w-[98vw] overflow-y-auto bg-white">
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
