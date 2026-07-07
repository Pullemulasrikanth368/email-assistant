/**@Report service - builds + stores a brief from synced mail */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import EmailAnalysisReport from "../models/emailAnalysisReport.model";
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import OutlookUser from "../../microsoft/models/outlookUser.model";
import MicrosoftUser from "../../microsoft/models/microsoftUser.model";
import MicrosoftTeamsService from "../../microsoft/services/microsoftTeams.service";
import { createMailService } from "./mailProvider.service";
import prioritizeService from "./prioritize.service";
import { generateBrief } from "./briefEngine";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";
import { getReportConfig } from "./reportConfig.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort: post the freshly generated brief to the connected Microsoft
 * Teams channel. ALWAYS logs whether the message was sent or not, and never
 * throws — a delivery problem must not break report generation.
 * @returns {Promise<boolean>} true if a Teams message was sent
 */
async function deliverBriefToTeams(report) {
  try {
    const msUser = await MicrosoftUser.findOne({ active: true }).sort({ updatedAt: -1 });
    if (!msUser) {
      console.log("[Teams] Brief NOT sent — no Microsoft account connected.");
      return false;
    }
    if (!msUser.defaultTeamId || !msUser.defaultChannelId) {
      console.log(`[Teams] Brief NOT sent — no default Teams channel configured for ${msUser.email}.`);
      return false;
    }

    const c = report.counts || {};
    const risks = (report.brief?.risks || [])
      .slice(0, 5)
      .map((r) => `<li>${r.title || r.headline || r.summary || "Risk"}</li>`)
      .join("");
    const message =
      `<h3>Operations brief — ${report.periodLabel || ""}</h3>` +
      `<p><b>${c.critical || 0}</b> critical · <b>${c.decisions || 0}</b> decisions · ` +
      `<b>${c.risks || 0}</b> risks · <b>${c.actions || 0}</b> actions</p>` +
      (risks ? `<p><b>Top risks</b></p><ul>${risks}</ul>` : "");

    const service = new MicrosoftTeamsService(msUser.email);
    const sent = await service.sendChannelMessage({
      teamId: msUser.defaultTeamId,
      channelId: msUser.defaultChannelId,
      message,
    });
    console.log(`[Teams] Brief SENT to channel for ${msUser.email} — messageId=${sent.id}`);
    return true;
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err.message;
    console.log(`[Teams] Brief NOT sent — send failed: ${detail}`);
    return false;
  }
}

/** Start/end of the calendar day that `date` falls in. */
function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end };
}

function dayLabel(date) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Start of the ISO week (Monday 00:00) that `date` falls in. */
function weekStartOf(date) {
  const x = new Date(date);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

function weekLabel(start) {
  return `Week of ${new Date(start).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Convenience counters from a brief. */
function briefCounts(brief) {
  return {
    critical: (brief.triage || []).filter((t) => t.tier === "Critical").length,
    decisions: (brief.decisionQueue || []).length,
    risks: (brief.risks || []).length,
    actions: (brief.actions || []).length,
  };
}

/** Map a stored mail doc to the engine's email shape (see CONTRACT.md). */
export function toEmailShape(mail) {
  return {
    id: mail.providerMessageId || String(mail._id),
    from: mail.from || "",
    subject: mail.subject || "",
    body: mail.body || mail.snippet || "",
    receivedAt: mail.receivedAt,
    labels: mail.labels || [],
    hasAttachments: !!mail.hasAttachments || (mail.attachments || []).length > 0,
    isRepliedMail: !!mail.isRepliedMail,
    isJunk: !!mail.isJunk,
    sourceFolder: mail.sourceFolder || "inbox",
    category: mail.category || "",
    priority: mail.priority || "",
    priorityScore: mail.priorityScore || null,
    intent: mail.intent || "",
    priorityReason: mail.priorityReason || "",
  };
}

/**
 * Attach each mail's stored AI category to its triage item (matched by
 * sourceId), so the report UI can group a sender's mails per category without
 * relying on the brief AI to echo it back.
 */
function attachMailCategories(brief, mails) {
  if (!brief) return brief;
  const catById = new Map(
    mails.map((m) => [String(m.providerMessageId || m._id), m.category || ""])
  );
  for (const t of brief.triage || []) {
    if (!t.category) t.category = catById.get(String(t.sourceId)) || "";
  }
  return brief;
}

/**
 * Resolve which day to report on. Defaults to the most recent day that has
 * mail for this account ("the last day"), so the first report after the
 * initial sync covers the newest day of email.
 */
async function resolveTargetDay(email, explicitDate) {
  if (explicitDate) return new Date(explicitDate);
  const latest = await EmailAnalysisMail.findOne({ email, active: true })
    .sort({ receivedAt: -1 })
    .select("receivedAt")
    .lean();
  return latest?.receivedAt ? new Date(latest.receivedAt) : new Date();
}

/**
 * Generate (and store) the day-wise brief for a connected account.
 * Reuses yesterday's report risks for trend. Idempotent per (email, day):
 * regenerating overwrites the stored report for that day.
 *
 * @param {string} email
 * @param {Object} opts - { date?: ISO|Date, force?: boolean }
 * @returns {Promise<EmailAnalysisReport>}
 */
export async function generateDailyReport(email, opts = {}) {
  if (!email) throw new Error("email is required to generate a report");

  const targetDay = await resolveTargetDay(email, opts.date);
  const { start, end } = dayBounds(targetDay);

  // Return the existing report unless a fresh run is requested.
  if (!opts.force) {
    const existing = await EmailAnalysisReport.findOne({ email, reportType: "day", periodStart: start });
    if (existing) return existing;
  }

  // Brief covers INCOMING mail only: the user's own sent replies and drafts
  // are excluded, while junk/spam stays in so nothing important is missed.
  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
    sourceFolder: { $nin: ["sent", "draft"] },
  }).sort({ receivedAt: 1 }).lean();

  const emails = mails.map(toEmailShape);

  // Yesterday's risks (previous day's report) drive the trend field.
  const prevReport = await EmailAnalysisReport.findOne({
    email,
    reportType: "day",
    periodStart: { $lt: start },
  }).sort({ periodStart: -1 }).lean();
  const yesterdayRisks = prevReport?.brief?.risks || [];

  // Load KB config and report config for this account.
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
  const reportConfig = await getReportConfig(email);

  const { brief, source, matchedKeywordsSummary } = await generateBrief(emails, yesterdayRisks, {
    periodLabel: dayLabel(targetDay),
    knowledgeBaseConfig,
    reportConfig,
  });
  attachMailCategories(brief, mails);

  const counts = briefCounts(brief);

  // Upsert the report for this (email, day).
  let report = await EmailAnalysisReport.findOne({ email, reportType: "day", periodStart: start });
  if (!report) report = new EmailAnalysisReport({ email, reportType: "day", periodStart: start });
  report.periodEnd = end;
  report.periodLabel = dayLabel(targetDay);
  report.brief = brief;
  report.source = source;
  report.generatedAt = new Date();
  report.counts = counts;
  report.active = true;

  // Store config snapshots and matched keywords summary for audit trail.
  report.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    filters: knowledgeBaseConfig.filters,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  report.reportConfigSnapshot = {
    reportName: reportConfig.reportName,
    enabledSections: reportConfig.enabledSections,
    selectedFields: reportConfig.selectedFields,
    rows: reportConfig.rows,
    outputStyle: reportConfig.outputStyle,
    promptInstruction: reportConfig.promptInstruction,
  };
  report.matchedKeywordsSummary = matchedKeywordsSummary;
  report.reportSectionsUsed = reportConfig.enabledSections || [];
  report.selectedFieldsUsed = reportConfig.selectedFields || [];

  const saved = await EmailAnalysisReport.saveData(report);

  // After the briefing is done, try to deliver it to Teams and log the result.
  await deliverBriefToTeams(saved);

  return saved;
}

/**
 * Generate (and store) the weekly rollup for an account.
 * Idempotent per (email, ISO week): once a week's report exists it is NOT
 * regenerated unless `force` is passed.
 *
 * @param {string} email
 * @param {Object} opts - { date?: ISO|Date (any day in the week), force?: boolean }
 * @returns {Promise<{ report: EmailAnalysisReport, created: boolean }>}
 */
export async function generateWeeklyReport(email, opts = {}) {
  if (!email) throw new Error("email is required to generate a weekly report");

  const base = opts.date ? new Date(opts.date) : new Date();
  const start = weekStartOf(base);
  const end = new Date(start.getTime() + 7 * DAY_MS);

  // Already generated for this week -> return it untouched (unless forced).
  const existing = await EmailAnalysisReport.findOne({ email, reportType: "week", periodStart: start });
  if (existing && !opts.force) {
    return { report: existing, created: false };
  }

  // Same scope as the daily brief: incoming mail only (junk/spam included),
  // never the user's own sent replies or drafts.
  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
    sourceFolder: { $nin: ["sent", "draft"] },
  }).sort({ receivedAt: 1 }).lean();

  const emails = mails.map(toEmailShape);

  // Previous week's risks drive the trend field.
  const prev = await EmailAnalysisReport.findOne({
    email, reportType: "week", periodStart: { $lt: start },
  }).sort({ periodStart: -1 }).lean();
  const prevRisks = prev?.brief?.risks || [];

  // Load KB config and report config for this account.
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
  const reportConfig = await getReportConfig(email);

  const { brief, source, matchedKeywordsSummary } = await generateBrief(emails, prevRisks, {
    periodLabel: weekLabel(start),
    knowledgeBaseConfig,
    reportConfig,
  });
  attachMailCategories(brief, mails);

  let report = existing || new EmailAnalysisReport({ email, reportType: "week", periodStart: start });
  report.periodEnd = end;
  report.periodLabel = weekLabel(start);
  report.brief = brief;
  report.source = source;
  report.generatedAt = new Date();
  report.counts = briefCounts(brief);
  report.active = true;

  report.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    filters: knowledgeBaseConfig.filters,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  report.reportConfigSnapshot = {
    reportName: reportConfig.reportName,
    enabledSections: reportConfig.enabledSections,
    selectedFields: reportConfig.selectedFields,
    rows: reportConfig.rows,
    outputStyle: reportConfig.outputStyle,
    promptInstruction: reportConfig.promptInstruction,
  };
  report.matchedKeywordsSummary = matchedKeywordsSummary;
  report.reportSectionsUsed = reportConfig.enabledSections || [];
  report.selectedFieldsUsed = reportConfig.selectedFields || [];

  const saved = await EmailAnalysisReport.saveData(report);
  return { report: saved, created: true };
}

/**
 * Fire-and-forget helper for the connected account (most recent, if email
 * omitted). Used right after the initial sync.
 */
export async function generateReportForLatestAccount(email) {
  let target = email;
  if (!target) {
    // Check EmailAnalysisUser first, then fall back to OutlookUser
    const eaUser = await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean();
    target = eaUser?.email;
    if (!target) {
      const msUser = await OutlookUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean();
      target = msUser?.email;
    }
  }
  if (!target) return null;
  return generateDailyReport(target, { force: true });
}

/**
 * Sync the account's mail (incremental/initial) and (re)prioritize it.
 * Best-effort: logs and swallows errors so a sync hiccup never blocks a brief.
 */
export async function syncAndPrioritize(email) {
  if (!email) return null;
  let result = null;
  try {
    const service = await createMailService(email);
    result = await service.syncForUser();
  } catch (err) {
    console.error(`[EmailAnalysis] Pre-brief sync failed for ${email}:`, err.message);
  }
  try {
    await prioritizeService.prioritizePendingForAccount(email);
  } catch (err) {
    console.error(`[EmailAnalysis] Pre-brief prioritize failed for ${email}:`, err.message);
  }
  return result;
}

/**
 * Run the daily brief WITH a fresh sync first, so a brief always reflects the
 * latest mail. "Whenever a brief runs, mail is synced."
 */
export async function generateDailyReportWithSync(email, opts = {}) {
  await syncAndPrioritize(email);
  return generateDailyReport(email, { force: true, ...opts });
}


export default {
  generateDailyReport,
  generateWeeklyReport,
  generateReportForLatestAccount,
  syncAndPrioritize,
  generateDailyReportWithSync,
};
