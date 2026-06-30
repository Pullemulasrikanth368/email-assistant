/**@Report service - builds + stores a brief from synced mail */
import fs from "fs";
import path from "path";

import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import EmailAnalysisReport from "../models/emailAnalysisReport.model";
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import MicrosoftUser from "../../microsoft/models/microsoftUser.model";
import MicrosoftTeamsService from "../../microsoft/services/microsoftTeams.service";
import EmailAnalysisMessagesService from "./emailAnalysis.messages.service";
import prioritizeService from "./prioritize.service";
import { generateBrief } from "./briefEngine";
import { renderBriefMarkdown } from "./renderMd";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";
import { getReportConfig } from "./reportConfig.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTPUT_DIR = path.resolve(__dirname, "../output");

/** Write the rendered .md dashboard for a report; returns the file path. */
function writeBriefMarkdown(report) {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const safeEmail = String(report.email || "account").replace(/[^a-z0-9._-]/gi, "_");
    const day = new Date(report.periodStart).toISOString().slice(0, 10);
    const file = path.join(OUTPUT_DIR, `brief-${safeEmail}-${day}.md`);
    fs.writeFileSync(file, renderBriefMarkdown(report));
    // Also keep a "latest.md" convenience copy.
    fs.writeFileSync(path.join(OUTPUT_DIR, "latest.md"), renderBriefMarkdown(report));
    return file;
  } catch (err) {
    console.error("[EmailAnalysis] Failed to write brief .md:", err.message);
    return "";
  }
}

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
function toEmailShape(mail) {
  return {
    id: mail.providerMessageId || String(mail._id),
    from: mail.from || "",
    subject: mail.subject || "",
    body: mail.body || mail.snippet || "",
    receivedAt: mail.receivedAt,
    labels: mail.labels || [],
    hasAttachments: !!mail.hasAttachments || (mail.attachments || []).length > 0,
    isRepliedMail: !!mail.isRepliedMail,
    priority: mail.priority || "",
    priorityScore: mail.priorityScore || null,
    intent: mail.intent || "",
    priorityReason: mail.priorityReason || "",
  };
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

  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
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
    outputStyle: reportConfig.outputStyle,
    promptInstruction: reportConfig.promptInstruction,
  };
  report.matchedKeywordsSummary = matchedKeywordsSummary;
  report.reportSectionsUsed = reportConfig.enabledSections || [];
  report.selectedFieldsUsed = reportConfig.selectedFields || [];

  // Render the self-contained .md dashboard from the analysis.
  report.mdPath = writeBriefMarkdown(report);

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

  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
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

  let report = existing || new EmailAnalysisReport({ email, reportType: "week", periodStart: start });
  report.periodEnd = end;
  report.periodLabel = weekLabel(start);
  report.brief = brief;
  report.source = source;
  report.generatedAt = new Date();
  report.counts = briefCounts(brief);
  report.active = true;
  report.mdPath = writeBriefMarkdown(report);

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
    const user = await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean();
    target = user?.email;
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
    result = await new EmailAnalysisMessagesService(email).syncForUser();
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
