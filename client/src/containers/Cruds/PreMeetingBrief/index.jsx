import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import moment from 'moment';
import { CalendarClock, Users, MapPin, Bolt, Plus, Trash2, RefreshCw } from 'lucide-react';
import { Dialog } from 'primereact/dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import { BriefDashboard, scoreColor } from '../OperationsReport/BriefDashboard';
import QuickReplies from '../CommonComponents/QuickReplies';
import AiDraftReply from '../CommonComponents/AiDraftReply';
import '../OperationsReport/OperationsReport.scss';
import './PreMeetingBrief.scss';

/* Sanitised email body in an isolated iframe (keeps email CSS, blocks scripts).
   Mirrors the Daily Brief email drawer so the source-email experience is identical. */
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

const meetingWhenLabel = (m) => {
  if (m?.when) return moment(m.when).format('ddd, MMM D · h:mm A');
  if (m?.meetingWhen) return moment(m.meetingWhen).format('ddd, MMM D · h:mm A');
  return m?.whenText || m?.meetingWhenText || 'Time TBD';
};

const PreMeetingBrief = () => {
  const [meetings, setMeetings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);

  const [selected, setSelected] = useState(null); // full pre-meeting brief doc
  const [loadingBrief, setLoadingBrief] = useState(false);

  const [reportConfig, setReportConfig] = useState(null);

  // Email-detail drawer (reused from Daily Brief)
  const [emailDrawer, setEmailDrawer] = useState({ visible: false, loading: false, mail: null, sourceId: null });
  const [markRead, setMarkRead] = useState({ busy: false, done: false });
  const [riskDrawer, setRiskDrawer] = useState({ visible: false, risk: null });

  // Manual meeting entry
  const [manual, setManual] = useState({ visible: false, title: '', whenText: '', participants: '', description: '' });

  /* ---------------- initial loads ---------------- */
  useEffect(() => {
    fetchMethodRequest('GET', 'email-analysis/report-configs')
      .then((res) => {
        const configs = Array.isArray(res?.configs) ? res.configs : [];
        setReportConfig(configs.find((c) => c.isDefault) || configs[0] || null);
      })
      .catch(() => { });
  }, []);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    try {
      const [detectRes, histRes] = await Promise.all([
        fetchMethodRequest('GET', 'email-analysis/pre-meeting/detect'),
        fetchMethodRequest('GET', 'email-analysis/pre-meeting-briefs'),
      ]);
      setMeetings(Array.isArray(detectRes?.meetings) ? detectRes.meetings : []);
      setHistory(Array.isArray(histRes?.briefs) ? histRes.briefs : []);
    } catch {
      showToasterMessage('Could not load meetings', 'error');
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  /* ---------------- generate / open ---------------- */
  const openBrief = useCallback(async (id) => {
    setLoadingBrief(true);
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/pre-meeting-briefs/${id}`);
      if (res?.brief) setSelected(res.brief);
      else showToasterMessage(res?.errorMessage || 'Brief not found', 'warning');
    } catch {
      showToasterMessage('Could not open brief', 'error');
    } finally {
      setLoadingBrief(false);
    }
  }, []);

  const generateForMeeting = async (meeting, force = false) => {
    setGeneratingId(meeting.meetingSourceId || 'manual');
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/pre-meeting-briefs/generate', {
        meetingSourceId: meeting.meetingSourceId,
        force,
      });
      if (res?.respCode && res.brief) {
        setSelected(res.brief);
        showToasterMessage(`Brief ready (${res.brief.source})`, 'success');
        loadLists();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not generate brief', 'warning');
      }
    } catch {
      showToasterMessage('Brief generation failed', 'error');
    } finally {
      setGeneratingId(null);
    }
  };

  const generateManual = async () => {
    if (!manual.title.trim() && !manual.participants.trim()) {
      showToasterMessage('Enter a meeting title or participants', 'warning');
      return;
    }
    setGeneratingId('manual');
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/pre-meeting-briefs/generate', {
        meeting: {
          title: manual.title.trim(),
          whenText: manual.whenText.trim(),
          description: manual.description.trim(),
          participants: manual.participants.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
        },
      });
      if (res?.respCode && res.brief) {
        setSelected(res.brief);
        setManual({ visible: false, title: '', whenText: '', participants: '', description: '' });
        showToasterMessage(`Brief ready (${res.brief.source})`, 'success');
        loadLists();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not generate brief', 'warning');
      }
    } catch {
      showToasterMessage('Brief generation failed', 'error');
    } finally {
      setGeneratingId(null);
    }
  };

  const deleteBrief = async (id, e) => {
    e?.stopPropagation();
    try {
      await fetchMethodRequest('DELETE', `email-analysis/pre-meeting-briefs/${id}`);
      if (selected?._id === id) setSelected(null);
      loadLists();
    } catch {
      showToasterMessage('Could not delete brief', 'error');
    }
  };

  /* ---------------- drill-downs (reused from Daily Brief) ---------------- */
  const findAiFlag = (sourceId) => {
    const brief = selected?.brief || {};
    const risk = (brief.risks || []).find((r) => r.sourceId === sourceId);
    const triage = (brief.triage || []).find((t) => t.sourceId === sourceId);
    return { risk, triage };
  };

  const openEmail = useCallback(async (sourceId) => {
    if (!sourceId) return;
    setMarkRead({ busy: false, done: false });
    setEmailDrawer({ visible: true, loading: true, mail: null, sourceId });
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/by-source/${encodeURIComponent(sourceId)}`);
      setEmailDrawer({ visible: true, loading: false, mail: res?.mail || null, sourceId });
    } catch {
      setEmailDrawer({ visible: true, loading: false, mail: null, sourceId });
    }
  }, []);

  const onMarkRead = useCallback(async () => {
    const { mail, sourceId } = emailDrawer;
    const id = mail?.providerMessageId || sourceId;
    if (!id) return;
    setMarkRead({ busy: true, done: false });
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/mark-read', {
        sourceId: id, email: mail?.email, isRead: true,
      });
      if (res?.respCode) {
        setMarkRead({ busy: false, done: true });
        showToasterMessage('Marked as read', 'success');
      } else {
        setMarkRead({ busy: false, done: false });
        showToasterMessage(res?.errorMessage || 'Could not mark as read', 'error');
      }
    } catch {
      setMarkRead({ busy: false, done: false });
      showToasterMessage('Could not mark as read', 'error');
    }
  }, [emailDrawer]);

  const openRisk = useCallback((risk) => setRiskDrawer({ visible: true, risk }), []);

  /* ---------------- meeting info header ---------------- */
  const renderMeetingInfo = (doc) => (
    <div className="pmb-meeting-card">
      <div className="pmb-meeting-main">
        <h2 className="pmb-meeting-title">{doc.meetingTitle || '(untitled meeting)'}</h2>
        <div className="pmb-meeting-meta">
          <span><CalendarClock size={14} /> {meetingWhenLabel(doc)}</span>
          {doc.meetingLocation && <span><MapPin size={14} /> {doc.meetingLocation}</span>}
          {doc.participants?.length > 0 && <span><Users size={14} /> {doc.participants.length} participants</span>}
          <span className={`pmb-src ${doc.source === 'live' ? 'live' : 'sample'}`}>{doc.source === 'live' ? 'LIVE AI' : 'OFFLINE'}</span>
        </div>
        {doc.participants?.length > 0 && (
          <div className="pmb-chips">
            {doc.participants.slice(0, 8).map((p) => <span className="pmb-chip" key={p}>{p}</span>)}
            {doc.participants.length > 8 && <span className="pmb-chip more">+{doc.participants.length - 8}</span>}
          </div>
        )}
        {doc.topics?.length > 0 && (
          <div className="pmb-chips topics">
            {doc.topics.slice(0, 10).map((t) => <span className="pmb-chip topic" key={t}>{t}</span>)}
          </div>
        )}
        <div className="pmb-meeting-actions">
          <span className="pmb-candidate-note">{doc.candidateCount || 0} related emails analyzed</span>
          {doc.meetingSourceId && (
            <button
              type="button"
              className="pmb-regen"
              onClick={() => generateForMeeting({ meetingSourceId: doc.meetingSourceId }, true)}
              disabled={generatingId != null}
            >
              <RefreshCw size={13} /> Regenerate
            </button>
          )}
        </div>
      </div>
    </div>
  );

  /* ---------------- main body ---------------- */
  const renderBody = () => {
    if (loadingBrief) {
      return <div className="orm-state"><i className="pi pi-spin pi-spinner" /><span>Loading brief…</span></div>;
    }
    if (!selected) {
      return (
        <div className="orm-empty">
          <i className="pi pi-calendar" />
          <h3>Select a meeting</h3>
          <p>Pick an upcoming meeting on the left to generate a preparation brief, or add one manually.</p>
        </div>
      );
    }
    return (
      <>
        {renderMeetingInfo(selected)}
        <BriefDashboard
          report={{ ...selected, brief: selected.brief }}
          reportConfig={reportConfig}
          onOpenSource={openEmail}
          onOpenRisk={openRisk}
        />
      </>
    );
  };

  /* ---------------- email drawer (reused) ---------------- */
  const renderEmailDrawer = () => {
    const { loading: dl, mail, sourceId } = emailDrawer;
    const { risk, triage } = findAiFlag(sourceId);
    return (
      <div className="operations-report orm-drawer">
        <div className="orm-drawer-head"><span className="eyebrow">Email detail</span></div>
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
                  className={`orm-email-action${markRead.done ? ' done' : ''}`}
                  onClick={onMarkRead}
                  disabled={markRead.busy || markRead.done}
                >
                  <i className={`pi ${markRead.busy ? 'pi-spin pi-spinner' : markRead.done ? 'pi-check-circle' : 'pi-envelope'}`} />
                  {markRead.done ? 'Read' : 'Mark as read'}
                </button>
              </div>
            </div>

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

            <div className="orm-reply-section">
              <QuickReplies sourceId={mail.providerMessageId || sourceId} preloaded={mail.quickReplies} />
              <AiDraftReply key={mail._id} mailId={mail._id} sourceId={mail.providerMessageId || sourceId} mail={mail} />
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
    );
  };

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

  /* ---------------- meeting rail ---------------- */
  const renderRail = () => (
    <aside className="pmb-rail">
      <div className="pmb-rail-head">
        <span className="eyebrow">Upcoming meetings</span>
        <div className="pmb-rail-head-btns">
          <button type="button" className="pmb-icon-btn" title="Refresh" onClick={loadLists} disabled={loadingLists}>
            <RefreshCw size={13} className={loadingLists ? 'spin' : ''} />
          </button>
          <button type="button" className="pmb-icon-btn" title="Add manually" onClick={() => setManual((p) => ({ ...p, visible: true }))}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {loadingLists && !meetings.length ? (
        <div className="pmb-rail-state"><i className="pi pi-spin pi-spinner" /> Detecting…</div>
      ) : meetings.length === 0 ? (
        <div className="pmb-rail-state">No meeting invitations found in recent mail.</div>
      ) : (
        <div className="pmb-list">
          {meetings.map((m) => (
            <div className="pmb-meeting-item" key={m.meetingSourceId}>
              <div className="pmb-mi-body">
                <div className="pmb-mi-title" title={m.title}>{m.title}</div>
                <div className="pmb-mi-meta">
                  <CalendarClock size={12} /> {meetingWhenLabel(m)}
                </div>
                {m.participantCount > 0 && (
                  <div className="pmb-mi-meta"><Users size={12} /> {m.participantCount} participants</div>
                )}
              </div>
              <button
                type="button"
                className="pmb-gen-btn"
                onClick={() => generateForMeeting(m)}
                disabled={generatingId != null}
              >
                {generatingId === m.meetingSourceId
                  ? <i className="pi pi-spin pi-spinner" />
                  : <><Bolt size={12} /> Brief</>}
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="pmb-rail-head" style={{ marginTop: 16 }}>
            <span className="eyebrow">Recent briefs</span>
          </div>
          <div className="pmb-list">
            {history.map((h) => (
              <div
                className={`pmb-hist-item${selected?._id === h._id ? ' active' : ''}`}
                key={h._id}
                role="button"
                tabIndex={0}
                onClick={() => openBrief(h._id)}
                onKeyDown={(e) => { if (e.key === 'Enter') openBrief(h._id); }}
              >
                <div className="pmb-hi-body">
                  <div className="pmb-mi-title" title={h.meetingTitle}>{h.meetingTitle || '(untitled)'}</div>
                  <div className="pmb-mi-meta">{meetingWhenLabel(h)}</div>
                  <div className="pmb-hi-counts">
                    <span>{h.counts?.decisions || 0} dec</span>
                    <span>{h.counts?.risks || 0} risk</span>
                    <span>{h.counts?.todos || 0} to-do</span>
                  </div>
                </div>
                <button type="button" className="pmb-icon-btn danger" title="Delete" onClick={(e) => deleteBrief(h._id, e)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );

  return (
    <div className="operations-report pre-meeting-brief bg-white">
      <div className="orm-header">
        <div className="orm-title">
          <div className="eyebrow">Executive assistant</div>
          <h1>Pre-Meeting Brief</h1>
        </div>
      </div>

      <div className="pmb-layout">
        {renderRail()}
        <div className="pmb-main orm-single-body">{renderBody()}</div>
      </div>

      {/* Manual meeting entry */}
      <Dialog
        header="Prepare for a meeting"
        visible={manual.visible}
        modal
        draggable={false}
        style={{ width: '480px', maxWidth: '94vw' }}
        onHide={() => setManual((p) => ({ ...p, visible: false }))}
      >
        <div className="pmb-form">
          <label>Meeting title
            <input value={manual.title} onChange={(e) => setManual((p) => ({ ...p, title: e.target.value }))} placeholder="Q3 pricing review with Acme" />
          </label>
          <label>When (optional)
            <input value={manual.whenText} onChange={(e) => setManual((p) => ({ ...p, whenText: e.target.value }))} placeholder="Thu, Jul 10 2026 2:00 PM" />
          </label>
          <label>Participants (emails, comma-separated)
            <input value={manual.participants} onChange={(e) => setManual((p) => ({ ...p, participants: e.target.value }))} placeholder="jane@acme.com, bob@acme.com" />
          </label>
          <label>Agenda / description (optional)
            <textarea rows={3} value={manual.description} onChange={(e) => setManual((p) => ({ ...p, description: e.target.value }))} />
          </label>
          <div className="pmb-form-actions">
            <Button variant="outline" size="sm" onClick={() => setManual((p) => ({ ...p, visible: false }))}>Cancel</Button>
            <button type="button" className="pmb-gen-btn solid" onClick={generateManual} disabled={generatingId != null}>
              {generatingId === 'manual' ? <i className="pi pi-spin pi-spinner" /> : <><Bolt size={13} /> Generate brief</>}
            </button>
          </div>
        </div>
      </Dialog>

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

export default PreMeetingBrief;
