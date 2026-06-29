import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from 'primereact/chart';
import { Dropdown } from 'primereact/dropdown';
import fetchMethodRequest from '../../../config/service';
import './OperationsCommandCenter.scss';

/* Palette (light theme) */
const C = {
  crit: '#e24b4a',
  imp: '#ef9f27',
  low: '#639922',
  junk: '#a371f7',
  blue: '#378add',
  muted: '#5f6368',          // axis ticks + "last week" line
  grid: 'rgba(16,24,40,0.08)', // subtle grid on white
};

const GRAN_OPTIONS = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
];

const baseScales = (stacked = false) => ({
  x: { stacked, grid: { display: false }, ticks: { color: C.muted } },
  y: { stacked, beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.muted } },
});

const noLegend = { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false };

/* Risk tier colouring by score (likelihood × impact, 1–25) */
const riskTier = (score) => {
  if (score >= 15) return { bg: 'rgba(226,75,74,0.18)', dot: '#e24b4a' };
  if (score >= 7) return { bg: 'rgba(239,159,39,0.16)', dot: '#ef9f27' };
  return { bg: 'rgba(99,153,34,0.14)', dot: '#639922' };
};

const OperationsCommandCenter = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [gran, setGran] = useState('week');
  const [period, setPeriod] = useState(null);
  const retriesRef = useRef(0);
  const retryTimer = useRef(null);

  const load = useCallback((isRetry = false) => {
    if (!isRetry) setLoading(true);
    let login = '';
    try { login = JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; } catch { /* ignore */ }
    fetchMethodRequest('GET', `email-analysis/analytics?loginUserEmailId=${encodeURIComponent(login)}`)
      .then((res) => {
        if (res?.respCode) {
          setData(res);
          setGenerating(!!res.generating);
          // The server is building a brief in the background — poll a few times
          // so the dashboard fills in once data lands (no manual refresh needed).
          if (res.generating && retriesRef.current < 6) {
            retriesRef.current += 1;
            retryTimer.current = setTimeout(() => load(true), 25000);
          } else {
            retriesRef.current = 0;
          }
        }
      })
      .catch(() => { /* leave empty state */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [load]);

  const series = data?.[gran];

  // When granularity / data changes, default the period to the most recent
  // bucket that has mail (activeIdx) so the KPIs open on a meaningful period.
  useEffect(() => {
    if (series?.periods?.length) {
      const ai = Number.isInteger(series.activeIdx) ? series.activeIdx : series.labels.length - 1;
      const defIdx = series.labels.length - 1 - ai; // periods[] is reversed (newest first)
      setPeriod(series.periods[defIdx] || series.periods[0]);
    }
  }, [gran, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map the selected period back to a chronological bucket index.
  const selectedIdx = useMemo(() => {
    if (!series) return -1;
    const pIdx = (series.periods || []).indexOf(period);
    if (pIdx < 0) return Number.isInteger(series.activeIdx) ? series.activeIdx : series.labels.length - 1;
    return series.labels.length - 1 - pIdx;
  }, [series, period]);

  // KPI metrics for the selected period (falls back to the series default).
  const metric = useMemo(() => {
    if (series?.metrics && selectedIdx >= 0 && series.metrics[selectedIdx]) return series.metrics[selectedIdx];
    return null;
  }, [series, selectedIdx]);

  /* ---- composition (stacked bar incl. junk) ---- */
  const compData = useMemo(() => {
    if (!series) return null;
    return {
      labels: series.labels,
      datasets: [
        { label: 'Critical', data: series.crit, backgroundColor: C.crit, borderRadius: 3, stack: 's' },
        { label: 'Important', data: series.imp, backgroundColor: C.imp, borderRadius: 3, stack: 's' },
        { label: 'Low', data: series.low, backgroundColor: C.low, borderRadius: 3, stack: 's' },
        { label: 'Junk / Spam', data: series.junk, backgroundColor: C.junk, borderRadius: 3, stack: 's' },
      ],
    };
  }, [series]);

  const weekCompareData = useMemo(() => {
    const w = data?.weekCompare;
    if (!w) return null;
    return {
      labels: w.labels,
      datasets: [
        { label: 'This week', data: w.thisWeek, borderColor: C.blue, backgroundColor: C.blue, tension: 0.3, pointRadius: 3, borderWidth: 2 },
        { label: 'Last week', data: w.lastWeek, borderColor: C.muted, borderDash: [6, 5], tension: 0.3, pointRadius: 0, borderWidth: 2 },
      ],
    };
  }, [data]);

  const critCatData = useMemo(() => {
    const cc = data?.critCat;
    if (!cc) return null;
    return { labels: cc.labels, datasets: [{ data: cc.data, backgroundColor: C.crit, borderRadius: 4, maxBarThickness: 22 }] };
  }, [data]);

  const savedData = useMemo(() => {
    const s = data?.savedSeries;
    if (!s) return null;
    return {
      labels: s.labels,
      datasets: [{ data: s.cumulative, borderColor: C.blue, backgroundColor: 'rgba(55,138,221,0.18)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 }],
    };
  }, [data]);

  const risks = useMemo(() => series?.risks || [], [series]);

  // 5×5 cells (likelihood row 5→1, impact col 1→5), each holding any risks that land on it.
  const matrixCells = useMemo(() => {
    const cells = [];
    for (let row = 5; row >= 1; row -= 1) {
      for (let col = 1; col <= 5; col += 1) {
        cells.push({
          key: `${row}-${col}`,
          tier: riskTier(row * col),
          risks: risks.filter((r) => r.impact === col && r.like === row),
        });
      }
    }
    return cells;
  }, [risks]);

  // KPI values for the selected period (metric) with the series default as fallback.
  const kpiDefault = series?.kpi || {};
  const kpi = {
    received: metric ? String(metric.received) : (kpiDefault.received ?? '0'),
    saved: metric ? metric.saved : (kpiDefault.saved ?? '0m'),
    crit: metric ? String(metric.crit) : (kpiDefault.crit ?? '0'),
    removed: metric ? String(metric.removed ?? 0) : (kpiDefault.removed ?? '0'),
    delta: metric ? metric.delta : (kpiDefault.delta ?? ''),
    analyzedPct: metric ? metric.analyzedPct : (kpiDefault.analyzedPct ?? 0),
  };
  const pills = useMemo(() => {
    if (!series) return [];
    const i = selectedIdx >= 0 ? selectedIdx : (Number.isInteger(series.activeIdx) ? series.activeIdx : series.labels.length - 1);
    const tc = series.crit[i] || 0;
    const ti = series.imp[i] || 0;
    const tl = series.low[i] || 0;
    const tj = series.junk[i] || 0;
    return [
      { label: 'Critical', n: tc, color: '#b3261e', bg: 'rgba(226,75,74,0.16)' },
      { label: 'Important', n: ti, color: '#9a5b08', bg: 'rgba(239,159,39,0.16)' },
      { label: 'Low', n: tl, color: '#3f6212', bg: 'rgba(99,153,34,0.18)' },
      { label: 'Junk / Spam', n: tj, color: '#5b21b6', bg: 'rgba(163,113,247,0.18)' },
    ];
  }, [series, selectedIdx]);

  return (
    <div className="ops-cc">
      <div className="occ-topbar">
        <div>
          <div className="occ-title"><span className="dot" /> Operations command center</div>
          <div className="occ-sub">
            Analytics · {data?.account || 'no account connected'}
            {loading && ' · loading…'}
            {!loading && generating && ' · syncing & generating brief…'}
          </div>
        </div>
        <div className="occ-controls">
          <span>View by</span>
          <Dropdown value={gran} options={GRAN_OPTIONS} onChange={(e) => setGran(e.value)} className="occ-select" panelClassName="occ-dropdown-panel" />
          <Dropdown
            value={period}
            options={(series?.periods || []).map((p) => ({ label: p, value: p }))}
            onChange={(e) => setPeriod(e.value)}
            className="occ-select"
            panelClassName="occ-dropdown-panel"
            placeholder="Period"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="occ-kpis">
        <div className="occ-kpi"><div className="label">Emails received</div><div className="val">{kpi.received ?? '0'}</div></div>
        <div className="occ-kpi"><div className="label">Analyzed</div><div className="val green">{kpi.analyzedPct ?? 0}%</div></div>
        <div className="occ-kpi"><div className="label">Time saved</div><div className="val blue">{kpi.saved ?? '0m'}</div></div>
        <div className="occ-kpi">
          <div className="label">Critical</div>
          <div className="val red">
            {kpi.crit ?? '0'}
            <span className="delta" style={{ color: (kpi.delta || '').indexOf('▼') > -1 ? '#7fd99f' : '#e24b4a' }}>
              {kpi.delta || ''}
            </span>
          </div>
        </div>
        <div className="occ-kpi"><div className="label">Removed</div><div className="val purple">{kpi.removed ?? '0'}</div></div>
      </div>

      {/* Status pills */}
      <div className="occ-pills">
        {pills.map((p) => (
          <span key={p.label} className="occ-pill" style={{ background: p.bg, color: p.color }}>
            <span className="pd" style={{ background: p.color }} />{p.label} {p.n}
          </span>
        ))}
      </div>

      {/* Composition over time */}
      <div className="occ-panel">
        <h3>Status composition over time</h3>
        <div className="occ-legend">
          <span><span className="sw" style={{ background: C.crit }} />Critical</span>
          <span><span className="sw" style={{ background: C.imp }} />Important</span>
          <span><span className="sw" style={{ background: C.low }} />Low</span>
          <span><span className="sw" style={{ background: C.junk }} />Junk / Spam</span>
        </div>
        <div className="occ-chart" style={{ height: 260 }}>
          {compData && <Chart type="bar" data={compData} options={{ ...noLegend, scales: baseScales(true) }} />}
        </div>
      </div>

      {/* Risk matrix (scoped to the selected timeline) */}
      <div className="occ-panel">
        <div className="occ-panel-head">
          <h3>Risk matrix</h3>
          <span className="occ-tag">{risks.length} tracked risk{risks.length === 1 ? '' : 's'}</span>
        </div>
        {risks.length === 0 ? (
          <div className="occ-risk-empty">No risks identified for this {gran}. Generate a brief to populate the matrix.</div>
        ) : (
          <div className="occ-matrix-wrap">
            <div className="occ-matrix-col">
              <div className="occ-axis-v"><span>likelihood →</span></div>
              <div>
                <div className="occ-matrix-grid">
                  {matrixCells.map((c) => (
                    <div key={c.key} className="occ-mcell" style={{ background: c.tier.bg }}>
                      {c.risks.map((r) => (
                        <div
                          key={r.n}
                          className="occ-mdot"
                          style={{ background: riskTier(r.score).dot }}
                          title={`${r.name} · L${r.like}×I${r.impact} = ${r.score}`}
                        >
                          {r.n}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="occ-axis-h">impact →</div>
              </div>
            </div>
            <div className="occ-rlegend">
              {risks.map((r) => (
                <div key={r.n} className="occ-rrow">
                  <span className="occ-rnum" style={{ background: riskTier(r.score).dot }}>{r.n}</span>
                  <span className="occ-rname">{r.name}</span>
                  <span className="occ-rscore">{r.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="occ-grid2">
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>This week vs last week</h3></div>
          <div className="occ-legend">
            <span><span className="ln" style={{ borderColor: C.blue }} />This week</span>
            <span><span className="ln" style={{ borderColor: C.muted, borderTopStyle: 'dashed' }} />Last week</span>
          </div>
          <div className="occ-chart" style={{ height: 210 }}>
            {weekCompareData && <Chart type="line" data={weekCompareData} options={{ ...noLegend, scales: baseScales(false) }} />}
          </div>
        </div>
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>Critical emails by category</h3><span className="occ-tag">this week</span></div>
          <div className="occ-chart" style={{ height: 210 }}>
            {critCatData && (
              <Chart
                type="bar"
                data={critCatData}
                options={{ ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.muted } }, y: { grid: { display: false }, ticks: { color: C.muted } } } }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="occ-panel">
        <div className="occ-panel-head"><h3>Cumulative time saved</h3><span className="occ-tag">this week · minutes</span></div>
        <div className="occ-chart" style={{ height: 190 }}>
          {savedData && (
            <Chart
              type="line"
              data={savedData}
              options={{ ...noLegend, scales: { x: { grid: { display: false }, ticks: { color: C.muted } }, y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.muted, callback: (v) => `${v}m` } } } }}
            />
          )}
        </div>
      </div>

      <div className="occ-footer">AI Operations Command Center · live data from your synced inbox</div>
    </div>
  );
};

export default OperationsCommandCenter;
