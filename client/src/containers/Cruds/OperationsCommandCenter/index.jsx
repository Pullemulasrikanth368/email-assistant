import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from 'primereact/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import fetchMethodRequest from '../../../config/service';
import './OperationsCommandCenter.scss';

/* Palette — validated (CVD ΔE 24.2, lightness band + chroma floor pass).
   Severity colors carry status meaning; blue is the neutral accent. */
const C = {
  crit: '#d03b3b',
  imp: '#eda100',
  low: '#008300',
  junk: '#8a63d2',
  blue: '#2a78d6',
  blueWash: 'rgba(42,120,214,0.10)',
  muted: '#8a8f98',           // axis ticks + "last week" line
  grid: 'rgba(16,24,40,0.06)', // hairline grid on white
  surface: '#ffffff',
  ink: '#111827',
  goodText: '#006300',
};

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const GRAN_OPTIONS = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
];

const TOOLTIP = {
  backgroundColor: '#111827',
  titleFont: { size: 12, weight: '600' },
  bodyFont: { size: 12 },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
  displayColors: true,
  usePointStyle: true,
};

const baseScales = (stacked = false) => ({
  x: { stacked, grid: { display: false }, border: { color: 'rgba(16,24,40,0.12)' }, ticks: { color: C.muted, font: { size: 11 } } },
  y: { stacked, beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, font: { size: 11 }, precision: 0 } },
});

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: TOOLTIP },
  interaction: { mode: 'index', intersect: false },
};

/* Risk tier colouring by score (likelihood × impact, 1–25) */
const riskTier = (score) => {
  if (score >= 15) return { bg: 'rgba(208,59,59,0.16)', dot: C.crit, label: 'High' };
  if (score >= 7) return { bg: 'rgba(237,161,0,0.14)', dot: '#b97e00', label: 'Medium' };
  return { bg: 'rgba(0,131,0,0.10)', dot: C.low, label: 'Low' };
};

/* Tiny inline sparkline for the stat tiles — de-emphasized line, accent dot on
   the selected period. */
const Spark = ({ points, color, selectedIdx }) => {
  if (!points || points.length < 2) return null;
  const w = 92;
  const h = 30;
  const pad = 4;
  const max = Math.max(...points, 1);
  const step = (w - pad * 2) / (points.length - 1);
  const xy = points.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const sel = xy[selectedIdx];
  return (
    <svg className="occ-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={xy.map((p) => p.join(',')).join(' ')}
        fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"
      />
      {sel && <circle cx={sel[0]} cy={sel[1]} r="3.5" fill={color} stroke={C.surface} strokeWidth="2" />}
    </svg>
  );
};

/* Signed delta chip vs the previous period. `upIsGood` flips the color logic
   (more critical mail is bad; more time saved is good). */
const Delta = ({ value, upIsGood }) => {
  if (value == null) return null;
  const up = value >= 0;
  const good = upIsGood ? up : !up;
  const cls = value === 0 ? 'flat' : good ? 'good' : 'bad';
  return (
    <span className={`occ-delta ${cls}`}>
      {value === 0 ? '—' : up ? '▲' : '▼'} {Math.abs(value)} vs prev
    </span>
  );
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
  const prevMetric = (series?.metrics && selectedIdx > 0 && series.metrics[selectedIdx - 1]) || null;

  const totals = useMemo(
    () => (series ? series.labels.map((_, i) => (series.crit[i] || 0) + (series.imp[i] || 0) + (series.low[i] || 0) + (series.junk[i] || 0)) : []),
    [series],
  );
  const savedPerBucket = useMemo(
    () => (series?.metrics ? series.metrics.map((m) => (m.analyzed || 0)) : []),
    [series],
  );

  /* ---- composition (stacked bar incl. junk, selected period emphasized) ---- */
  const compData = useMemo(() => {
    if (!series) return null;
    const paint = (hex) => (ctx) => (ctx.dataIndex === selectedIdx ? hex : rgba(hex, 0.4));
    const seg = (label, arr, hex) => ({
      label,
      data: arr,
      backgroundColor: paint(hex),
      borderColor: C.surface, // 2px surface gap between stacked segments
      borderWidth: 2,
      borderRadius: 3,
      borderSkipped: false,
      maxBarThickness: 34,
      stack: 's',
    });
    return {
      labels: series.labels,
      datasets: [
        seg('Critical', series.crit, C.crit),
        seg('Important', series.imp, C.imp),
        seg('Low', series.low, C.low),
        seg('Junk / Spam', series.junk, C.junk),
      ],
    };
  }, [series, selectedIdx]);

  // Clicking a bar selects that period — KPIs, pills and matrix follow.
  const compOptions = useMemo(() => ({
    ...baseOpts,
    scales: baseScales(true),
    onHover: (evt, els) => { evt.native.target.style.cursor = els?.length ? 'pointer' : 'default'; },
    onClick: (evt, els) => {
      if (!els?.length || !series) return;
      const p = series.periods[series.labels.length - 1 - els[0].index];
      if (p) setPeriod(p);
    },
  }), [series]);

  const weekCompareData = useMemo(() => {
    const w = data?.weekCompare;
    if (!w) return null;
    return {
      labels: w.labels,
      datasets: [
        {
          label: 'This week',
          data: w.thisWeek,
          borderColor: C.blue,
          backgroundColor: C.blue,
          tension: 0.3,
          pointRadius: 3.5,
          pointBorderColor: C.surface, // surface ring where points cross lines
          pointBorderWidth: 2,
          borderWidth: 2,
        },
        { label: 'Last week', data: w.lastWeek, borderColor: C.muted, borderDash: [6, 5], tension: 0.3, pointRadius: 0, borderWidth: 2 },
      ],
    };
  }, [data]);

  const critCatData = useMemo(() => {
    const cc = data?.critCat;
    if (!cc) return null;
    return { labels: cc.labels, datasets: [{ label: 'Critical', data: cc.data, backgroundColor: C.crit, borderRadius: 4, maxBarThickness: 18 }] };
  }, [data]);

  const savedData = useMemo(() => {
    const s = data?.savedSeries;
    if (!s) return null;
    return {
      labels: s.labels,
      datasets: [
        {
          type: 'line',
          label: 'Cumulative',
          data: s.cumulative,
          borderColor: C.blue,
          backgroundColor: C.blueWash, // ~10% wash, never a saturated block
          fill: true,
          tension: 0.3,
          pointRadius: 2.5,
          pointBorderColor: C.surface,
          pointBorderWidth: 2,
          borderWidth: 2,
        },
        {
          type: 'bar',
          label: 'Per day',
          data: s.daily,
          backgroundColor: rgba(C.blue, 0.35),
          borderRadius: 3,
          maxBarThickness: 16,
        },
      ],
    };
  }, [data]);

  /* ---- inbox cleanup (removed mail per bucket — previously unused data) ---- */
  const cleanupData = useMemo(() => {
    if (!series?.removed) return null;
    return {
      labels: series.labels,
      datasets: [{
        label: 'Removed',
        data: series.removed,
        backgroundColor: (ctx) => (ctx.dataIndex === selectedIdx ? C.junk : rgba(C.junk, 0.4)),
        borderRadius: 4,
        maxBarThickness: 24,
      }],
    };
  }, [series, selectedIdx]);

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
    received: metric ? metric.received : Number(kpiDefault.received || 0),
    saved: metric ? metric.saved : (kpiDefault.saved ?? '0m'),
    crit: metric ? metric.crit : Number(kpiDefault.crit || 0),
    removed: metric ? (metric.removed ?? 0) : Number(kpiDefault.removed || 0),
    analyzedPct: metric ? metric.analyzedPct : (kpiDefault.analyzedPct ?? 0),
  };
  const deltas = prevMetric && metric ? {
    received: metric.received - prevMetric.received,
    crit: metric.crit - prevMetric.crit,
    removed: (metric.removed ?? 0) - (prevMetric.removed ?? 0),
    analyzed: metric.analyzed - prevMetric.analyzed,
  } : {};

  const pills = useMemo(() => {
    if (!series) return [];
    const i = selectedIdx >= 0 ? selectedIdx : (Number.isInteger(series.activeIdx) ? series.activeIdx : series.labels.length - 1);
    return [
      { label: 'Critical', n: series.crit[i] || 0, color: '#a32424', bg: 'rgba(208,59,59,0.12)', dot: C.crit },
      { label: 'Important', n: series.imp[i] || 0, color: '#8a5d00', bg: 'rgba(237,161,0,0.14)', dot: C.imp },
      { label: 'Low', n: series.low[i] || 0, color: '#1c5e1c', bg: 'rgba(0,131,0,0.10)', dot: C.low },
      { label: 'Junk / Spam', n: series.junk[i] || 0, color: '#5b3fa8', bg: 'rgba(138,99,210,0.14)', dot: C.junk },
    ];
  }, [series, selectedIdx]);

  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="ops-cc">
      <div className="occ-topbar">
        <div>
          <div className="occ-title"><span className="dot" /> Operations command center</div>
          <div className="occ-sub">
            {data?.account ? <span className="occ-account">{data.account}</span> : 'no account connected'}
            {updatedAt && ` · updated ${updatedAt}`}
            {loading && ' · loading…'}
            {!loading && generating && (
              <span className="occ-generating"> · syncing &amp; generating brief…</span>
            )}
          </div>
        </div>
        <div className="occ-controls">
          <span>View by</span>
          <Select value={gran} onValueChange={setGran}>
            <SelectTrigger className="occ-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRAN_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period || ''} onValueChange={setPeriod}>
            <SelectTrigger className="occ-select">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {(series?.periods || []).map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI stat tiles — value + delta vs previous period + trend sparkline */}
      <div className="occ-kpis">
        <div className="occ-kpi">
          <div className="occ-kpi-top">
            <div className="label">Emails received</div>
            <Spark points={totals} color={C.blue} selectedIdx={selectedIdx} />
          </div>
          <div className="val">{kpi.received}</div>
          <Delta value={deltas.received} upIsGood={false} />
        </div>

        <div className="occ-kpi">
          <div className="occ-kpi-top"><div className="label">Analyzed</div></div>
          <div className="val">{kpi.analyzedPct}<span className="unit">%</span></div>
          <div className="occ-meter" role="img" aria-label={`${kpi.analyzedPct}% of mail analyzed`}>
            <div className="occ-meter-fill" style={{ width: `${Math.min(100, kpi.analyzedPct)}%` }} />
          </div>
        </div>

        <div className="occ-kpi">
          <div className="occ-kpi-top">
            <div className="label">Time saved</div>
            <Spark points={savedPerBucket} color={C.blue} selectedIdx={selectedIdx} />
          </div>
          <div className="val">{kpi.saved}</div>
          <Delta value={deltas.analyzed} upIsGood />
        </div>

        <div className="occ-kpi">
          <div className="occ-kpi-top">
            <div className="label">Critical</div>
            <Spark points={series?.crit || []} color={C.crit} selectedIdx={selectedIdx} />
          </div>
          <div className="val crit">{kpi.crit}</div>
          <Delta value={deltas.crit} upIsGood={false} />
        </div>

        <div className="occ-kpi">
          <div className="occ-kpi-top">
            <div className="label">Cleaned up</div>
            <Spark points={series?.removed || []} color={C.junk} selectedIdx={selectedIdx} />
          </div>
          <div className="val">{kpi.removed}</div>
          <Delta value={deltas.removed} upIsGood />
        </div>
      </div>

      {/* Composition over time */}
      <div className="occ-panel">
        <div className="occ-panel-head">
          <h3>Status composition over time</h3>
          <span className="occ-hint">click a bar to inspect that period</span>
        </div>
        <div className="occ-pills">
          {pills.map((p) => (
            <span key={p.label} className="occ-pill" style={{ background: p.bg, color: p.color }}>
              <span className="pd" style={{ background: p.dot }} />{p.label}
              <b>{p.n}</b>
            </span>
          ))}
        </div>
        <div className="occ-chart occ-chart--lg">
          {compData && <Chart type="bar" data={compData} options={compOptions} />}
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
              <div className="occ-axis-v"><span>Likelihood →</span></div>
              <div>
                <div className="occ-matrix-grid">
                  {matrixCells.map((c) => (
                    <div key={c.key} className="occ-mcell" style={{ background: c.tier.bg }}>
                      {c.risks.map((r) => (
                        <div
                          key={r.n}
                          className="occ-mdot"
                          style={{ background: riskTier(r.score).dot }}
                          title={`${r.name}${r.summary ? ` — ${r.summary}` : ''} · L${r.like}×I${r.impact} = ${r.score}`}
                        >
                          {r.n}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="occ-axis-h">Impact →</div>
              </div>
            </div>
            <div className="occ-rlegend">
              {risks.map((r) => {
                const tier = riskTier(r.score);
                return (
                  <div key={r.n} className="occ-rrow" title={r.summary || r.name}>
                    <span className="occ-rnum" style={{ background: tier.dot }}>{r.n}</span>
                    <span className="occ-rname">{r.name}</span>
                    {r.category && <span className="occ-rcat">{r.category}</span>}
                    <span className="occ-rscore" style={{ color: tier.dot }}>{tier.label} · {r.score}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="occ-grid2">
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>This week vs last week</h3></div>
          <div className="occ-legend">
            <span><span className="ln" style={{ borderColor: C.blue }} />This week</span>
            <span><span className="ln dashed" style={{ borderColor: C.muted }} />Last week</span>
          </div>
          <div className="occ-chart occ-chart--md">
            {weekCompareData && <Chart type="line" data={weekCompareData} options={{ ...baseOpts, scales: baseScales(false) }} />}
          </div>
        </div>
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>Critical emails by category</h3><span className="occ-tag">this week</span></div>
          <div className="occ-chart occ-chart--md">
            {critCatData && (
              <Chart
                type="bar"
                data={critCatData}
                options={{
                  ...baseOpts,
                  indexAxis: 'y',
                  interaction: { mode: 'nearest', intersect: false },
                  scales: {
                    x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, font: { size: 11 }, precision: 0 } },
                    y: { grid: { display: false }, border: { color: 'rgba(16,24,40,0.12)' }, ticks: { color: C.muted, font: { size: 11 } } },
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="occ-grid2">
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>Time saved</h3><span className="occ-tag">this week · minutes</span></div>
          <div className="occ-legend">
            <span><span className="ln" style={{ borderColor: C.blue }} />Cumulative</span>
            <span><span className="sw" style={{ background: rgba(C.blue, 0.35) }} />Per day</span>
          </div>
          <div className="occ-chart occ-chart--sm">
            {savedData && (
              <Chart
                type="bar"
                data={savedData}
                options={{
                  ...baseOpts,
                  scales: {
                    x: { grid: { display: false }, border: { color: 'rgba(16,24,40,0.12)' }, ticks: { color: C.muted, font: { size: 11 } } },
                    y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, font: { size: 11 }, callback: (v) => `${v}m` } },
                  },
                }}
              />
            )}
          </div>
        </div>
        <div className="occ-panel">
          <div className="occ-panel-head"><h3>Inbox cleanup</h3><span className="occ-tag">removed per {gran}</span></div>
          <div className="occ-chart occ-chart--sm">
            {cleanupData && (
              <Chart
                type="bar"
                data={cleanupData}
                options={{ ...baseOpts, interaction: { mode: 'nearest', intersect: false }, scales: baseScales(false) }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="occ-footer">AI Operations Command Center · live data from your synced inbox</div>
    </div>
  );
};

export default OperationsCommandCenter;
