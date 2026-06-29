import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import moment from 'moment';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import { BriefDashboard } from './BriefDashboard';
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

  const [generating, setGenerating] = useState(false);
  const [briefTime, setBriefTime] = useState('06:00');

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

  // Drill-down: open the source email in the mail reader (best-effort).
  const onOpenSource = (sourceId) => {
    if (!sourceId) return;
    navigate(`/emailAnalysisMails?source=${encodeURIComponent(sourceId)}`);
  };

  /* ---------------- weekly reports (server-generated, idempotent) ---------------- */
  const [weekReports, setWeekReports] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [selectedWeekReport, setSelectedWeekReport] = useState(null);
  const [weekDetailLoading, setWeekDetailLoading] = useState(false);
  const [genWeekly, setGenWeekly] = useState(false);

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
      const res = await fetchMethodRequest('POST', 'email-analysis/reports/generate', { type: 'week', date: selectedWeekStart, force: !!force });
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
          <BriefDashboard report={selectedWeekReport} onOpenSource={onOpenSource} />
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
          <span className={`orm-badge ${selectedReport.source === 'live' ? 'live' : 'sample'}`}>
            {selectedReport.source === 'live' ? 'LIVE AI' : 'SAMPLE'}
          </span>
        </div>
        <BriefDashboard report={selectedReport} onOpenSource={onOpenSource} />
      </>
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
    </div>
  );
};

export default OperationsReport;
