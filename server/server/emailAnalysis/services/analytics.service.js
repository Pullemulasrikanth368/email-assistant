/**@Analytics service — derives the Operations Command Center dashboard data
 * from the synced email_analysis_mails for a connected account.
 *
 * Bands (dashboard's three + junk):
 *   crit  = priority "Critical"
 *   imp   = priority "High"
 *   low   = priority "Medium"/"Low"/unscored
 *   junk  = Gmail SPAM-labelled mail (independent of priority)
 *
 * "Time saved" is an estimate: each analyzed (prioritized) email is assumed to
 * save MIN_PER_EMAIL minutes of manual triage. Category is a keyword heuristic.
 */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import EmailAnalysisReport from "../models/emailAnalysisReport.model";

const MIN_PER_EMAIL = 3;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MN_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const CATEGORIES = ["Quality", "Regulatory", "Production", "Supply", "Logistics", "Other"];
const CATEGORY_RULES = [
  { key: "Quality", rx: /\b(oos|deviation|capa|complaint|quality|qc|qa|batch|spec|particulate|stability|recall)\b/i },
  { key: "Regulatory", rx: /\b(fda|483|inspection|regulat|submission|variation|gmp|audit|annex|guidance)\b/i },
  { key: "Production", rx: /\b(line|production|downtime|shift|capper|fill|yield|maintenance|output|operator)\b/i },
  { key: "Supply", rx: /\b(supplier|\bapi\b|procurement|second source|\bpo\b|purchase|inventory|stock|materials)\b/i },
  { key: "Logistics", rx: /\b(logistics|cold.?chain|distribution|shipment|warehouse|dock|delivery|transit|freight)\b/i },
];

/* ----------------------------- date helpers ----------------------------- */
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = (d) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }; // Monday
const monthStart = (d) => { const x = startOfDay(d); x.setDate(1); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const monIdx = (date) => (date.getDay() + 6) % 7; // 0 = Monday

/* ----------------------------- tagging ----------------------------- */
function bandOf(mail) {
  if ((mail.labels || []).includes("SPAM")) return "junk";
  if (mail.priority === "Critical") return "crit";
  if (mail.priority === "High") return "imp";
  return "low";
}
function categoryOf(mail) {
  const text = `${mail.subject || ""} ${mail.snippet || ""}`;
  for (const r of CATEGORY_RULES) if (r.rx.test(text)) return r.key;
  return "Other";
}
function fmtMins(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
}

/* ----------------------------- bucket builders ----------------------------- */
function dayBuckets(now) {
  const today = startOfDay(now);
  const arr = [];
  for (let i = 6; i >= 0; i -= 1) {
    const s = addDays(today, -i);
    const dl = `${WD[s.getDay()]} ${s.getDate()} ${MN[s.getMonth()]}`;
    arr.push({ start: s, end: addDays(s, 1), label: WD[s.getDay()], periodLabel: i === 0 ? `Today · ${dl}` : dl });
  }
  return arr;
}
function weekBuckets(now) {
  const ws = weekStart(now);
  const arr = [];
  for (let i = 5; i >= 0; i -= 1) {
    const s = addDays(ws, -7 * i);
    arr.push({
      start: s,
      end: addDays(s, 7),
      label: i === 0 ? "This wk" : `W${6 - i}`,
      periodLabel: i === 0 ? "This week" : i === 1 ? "Last week" : `${i} weeks ago`,
    });
  }
  return arr;
}
function monthBuckets(now) {
  const ms = monthStart(now);
  const arr = [];
  for (let i = 5; i >= 0; i -= 1) {
    const s = addMonths(ms, -i);
    arr.push({ start: s, end: addMonths(s, 1), label: MN[s.getMonth()], periodLabel: `${MN_FULL[s.getMonth()]} ${s.getFullYear()}` });
  }
  return arr;
}

function buildSeries(tagged, buckets, removedTagged = []) {
  const counts = buckets.map(() => ({ crit: 0, imp: 0, low: 0, junk: 0, total: 0, analyzed: 0, removed: 0 }));
  for (const t of tagged) {
    const i = buckets.findIndex((b) => t.at >= b.start && t.at < b.end);
    if (i < 0) continue;
    counts[i][t.band] += 1;
    counts[i].total += 1;
    if (t.prioritized) counts[i].analyzed += 1;
  }
  // Removed (cleaned-up) mail, bucketed by when it was removed.
  for (const r of removedTagged) {
    const i = buckets.findIndex((b) => r.at >= b.start && r.at < b.end);
    if (i >= 0) counts[i].removed += 1;
  }
  // Per-bucket KPI metrics (chronological, aligned with labels) so the UI can
  // show numbers for ANY selected period — not just the most recent one.
  const metrics = counts.map((c, i) => {
    const prevC = counts[i - 1] || {};
    const d = (c.crit || 0) - (prevC.crit || 0);
    return {
      received: c.total || 0,
      crit: c.crit || 0,
      imp: c.imp || 0,
      low: c.low || 0,
      junk: c.junk || 0,
      analyzed: c.analyzed || 0,
      removed: c.removed || 0,
      saved: fmtMins((c.analyzed || 0) * MIN_PER_EMAIL),
      analyzedPct: c.total ? Math.round((c.analyzed / c.total) * 100) : 0,
      delta: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)} vs prev`,
    };
  });

  // Default KPI = most recent bucket that actually has mail (so the dashboard
  // opens on a meaningful period instead of an empty "current" one).
  let activeIdx = counts.length - 1;
  while (activeIdx > 0 && (counts[activeIdx]?.total || 0) === 0) activeIdx -= 1;
  const last = metrics[activeIdx] || {};
  return {
    labels: buckets.map((b) => b.label),
    crit: counts.map((c) => c.crit),
    imp: counts.map((c) => c.imp),
    low: counts.map((c) => c.low),
    junk: counts.map((c) => c.junk),
    removed: counts.map((c) => c.removed),
    activeIdx,
    metrics,
    kpi: {
      received: String(last.received || 0),
      saved: last.saved || "0m",
      crit: String(last.crit || 0),
      removed: String(last.removed || 0),
      delta: last.delta || "▲ 0 vs prev",
      analyzedPct: last.analyzedPct || 0,
    },
    periods: buckets.map((b) => b.periodLabel).reverse(),
  };
}

function buildWeekCompare(tagged, now) {
  const ws = weekStart(now);
  const lws = addDays(ws, -7);
  const thisWeek = [0, 0, 0, 0, 0, 0, 0];
  const lastWeek = [0, 0, 0, 0, 0, 0, 0];
  for (const t of tagged) {
    if (t.at >= ws && t.at < addDays(ws, 7)) thisWeek[monIdx(t.at)] += 1;
    else if (t.at >= lws && t.at < ws) lastWeek[monIdx(t.at)] += 1;
  }
  return { labels: WD_MON, thisWeek, lastWeek };
}

function buildCritCat(tagged, now) {
  const ws = weekStart(now);
  const end = addDays(ws, 7);
  const map = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const t of tagged) {
    if (t.at >= ws && t.at < end && t.band === "crit") map[t.cat] += 1;
  }
  return { labels: CATEGORIES, data: CATEGORIES.map((c) => map[c]) };
}

function buildSavedSeries(tagged, now) {
  const ws = weekStart(now);
  const daily = [0, 0, 0, 0, 0, 0, 0];
  for (const t of tagged) {
    if (t.at >= ws && t.at < addDays(ws, 7) && t.prioritized) daily[monIdx(t.at)] += MIN_PER_EMAIL;
  }
  const cumulative = [];
  daily.reduce((acc, v, i) => { cumulative[i] = acc + v; return cumulative[i]; }, 0);
  return { labels: WD_MON, daily, cumulative };
}

/* ----------------------------- risk matrix ----------------------------- */
const clamp15 = (v) => Math.min(5, Math.max(1, Math.round(Number(v) || 1)));

/** Merge risks from a set of reports, dedupe by source/summary keeping the
 *  highest score, sort by score desc, take the top 12 and number them. */
function mapRisks(reports, subjectMap) {
  const map = new Map();
  for (const rep of reports || []) {
    for (const r of rep?.brief?.risks || []) {
      const key = String(r.sourceId || r.summary || "").toLowerCase().trim();
      if (!key) continue;
      const score = r.riskScore || clamp15(r.likelihood) * clamp15(r.impact);
      const prev = map.get(key);
      if (!prev || score > prev.score) {
        // Label the risk by the SOURCE EMAIL'S subject; fall back to the
        // AI summary/category only when the email can't be resolved.
        const subject = subjectMap && r.sourceId ? subjectMap.get(r.sourceId) : "";
        map.set(key, {
          name: subject || r.summary || r.category || "Risk",
          summary: r.summary || "",
          impact: clamp15(r.impact),
          like: clamp15(r.likelihood),
          score,
          category: r.category || "",
          trend: r.trend || "",
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((r, i) => ({ n: i + 1, ...r }));
}

/** Build the risk matrix for each granularity, scoped to the selected window. */
async function buildRiskMatrices(acct, now, subjectMap) {
  const monthFrom = monthStart(now);
  const [dayReportsThisMonth, latestDay, latestWeek] = await Promise.all([
    EmailAnalysisReport.find(
      { email: acct, reportType: "day", active: true, periodStart: { $gte: monthFrom } },
      { periodStart: 1, "brief.risks": 1 }
    ).sort({ periodStart: -1 }).lean(),
    EmailAnalysisReport.findOne(
      { email: acct, reportType: "day", active: true }, { "brief.risks": 1 }
    ).sort({ periodStart: -1 }).lean(),
    EmailAnalysisReport.findOne(
      { email: acct, reportType: "week", active: true }, { "brief.risks": 1 }
    ).sort({ periodStart: -1 }).lean(),
  ]);

  const ws = weekStart(now);
  const weekDayReports = dayReportsThisMonth.filter((r) => new Date(r.periodStart) >= ws);
  const dayFallback = latestDay ? [latestDay] : [];

  return {
    day: mapRisks(dayFallback, subjectMap),
    week: mapRisks(latestWeek ? [latestWeek] : (weekDayReports.length ? weekDayReports : dayFallback), subjectMap),
    month: mapRisks(dayReportsThisMonth.length ? dayReportsThisMonth : dayFallback, subjectMap),
  };
}

function emptyPayload(now) {
  const empties = (buckets) => ({
    labels: buckets.map((b) => b.label),
    crit: buckets.map(() => 0), imp: buckets.map(() => 0), low: buckets.map(() => 0), junk: buckets.map(() => 0),
    removed: buckets.map(() => 0),
    activeIdx: buckets.length - 1,
    metrics: buckets.map(() => ({ received: 0, crit: 0, imp: 0, low: 0, junk: 0, analyzed: 0, removed: 0, saved: "0m", analyzedPct: 0, delta: "▲ 0 vs prev" })),
    kpi: { received: "0", saved: "0m", crit: "0", removed: "0", delta: "▲ 0 vs prev", analyzedPct: 0 },
    periods: buckets.map((b) => b.periodLabel).reverse(),
    risks: [],
  });
  return {
    account: null,
    day: empties(dayBuckets(now)),
    week: empties(weekBuckets(now)),
    month: empties(monthBuckets(now)),
    weekCompare: { labels: WD_MON, thisWeek: [0, 0, 0, 0, 0, 0, 0], lastWeek: [0, 0, 0, 0, 0, 0, 0] },
    critCat: { labels: CATEGORIES, data: CATEGORIES.map(() => 0) },
    savedSeries: { labels: WD_MON, daily: [0, 0, 0, 0, 0, 0, 0], cumulative: [0, 0, 0, 0, 0, 0, 0] },
  };
}

/** Build the full dashboard payload for a connected account. */
export async function getAnalytics(email) {
  const now = new Date();
  const acct = email
    || (await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean())?.email;
  if (!acct) return emptyPayload(now);

  const windowStart = addMonths(monthStart(now), -5); // ~6 months back
  const mails = await EmailAnalysisMail.find(
    { email: acct, active: true, receivedAt: { $gte: windowStart } },
    { receivedAt: 1, priority: 1, labels: 1, subject: 1, snippet: 1, providerMessageId: 1 }
  ).lean();

  const tagged = mails
    .filter((m) => m.receivedAt)
    .map((m) => ({ at: new Date(m.receivedAt), band: bandOf(m), cat: categoryOf(m), prioritized: m.priority != null }));

  // sourceId (providerMessageId) -> email subject, so the risk matrix can label
  // each risk by the actual email title instead of the AI summary.
  const subjectMap = new Map();
  for (const m of mails) {
    if (m.providerMessageId && m.subject) subjectMap.set(m.providerMessageId, m.subject);
  }

  // Removed (cleaned-up) mail in the window, bucketed by when it was removed.
  const removedMails = await EmailAnalysisMail.find(
    { email: acct, active: false, removedAt: { $gte: windowStart } },
    { removedAt: 1 }
  ).lean();
  const removedTagged = removedMails
    .filter((m) => m.removedAt)
    .map((m) => ({ at: new Date(m.removedAt) }));

  const day = buildSeries(tagged, dayBuckets(now), removedTagged);
  const week = buildSeries(tagged, weekBuckets(now), removedTagged);
  const month = buildSeries(tagged, monthBuckets(now), removedTagged);

  // Risk matrix per timeline, sourced from stored reports for the same window.
  const risks = await buildRiskMatrices(acct, now, subjectMap);
  day.risks = risks.day;
  week.risks = risks.week;
  month.risks = risks.month;

  return {
    account: acct,
    generatedAt: now,
    day,
    week,
    month,
    weekCompare: buildWeekCompare(tagged, now),
    critCat: buildCritCat(tagged, now),
    savedSeries: buildSavedSeries(tagged, now),
  };
}

export default { getAnalytics };
