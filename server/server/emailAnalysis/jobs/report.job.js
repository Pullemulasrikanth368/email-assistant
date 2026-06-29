/**@Dynamic report cron — schedule derived from the settings brief time */
import cron from "node-cron";

import Settings from "../../models/settings.model";
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import reportService from "../services/report.service";

let task = null;        // current node-cron task
let currentCron = null; // current cron expression (to avoid needless reschedules)

/**
 * Convert a stored time into a daily cron expression.
 * Accepts "HH:mm" (24h) or "h:mm AM/PM"; falls back to 06:00.
 */
export function timeToCron(timeStr) {
  const raw = String(timeStr || "").trim();
  let h = 6;
  let m = 0;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (ampm) {
    h = parseInt(ampm[1], 10) % 12;
    m = parseInt(ampm[2], 10);
    if (/PM/i.test(ampm[3])) h += 12;
  } else if (h24) {
    h = parseInt(h24[1], 10);
    m = parseInt(h24[2], 10);
  }
  if (!(h >= 0 && h <= 23)) h = 6;
  if (!(m >= 0 && m <= 59)) m = 0;
  return `${m} ${h} * * *`;
}

/** Sync, prioritize, then generate today's report for every connected account. */
async function runForAllAccounts() {
  // Only SOURCE accounts get briefs — send-only (bulk-send) accounts are skipped.
  const users = await EmailAnalysisUser.find({ active: true, purpose: { $ne: "send" } }).select("email").lean();
  for (const u of users) {
    if (!u.email) continue;
    try {
      await reportService.generateDailyReportWithSync(u.email);
      console.log(`[EmailAnalysis] Scheduled report (with sync) generated for ${u.email}`);
    } catch (err) {
      console.error(`[EmailAnalysis] Scheduled report failed for ${u.email}:`, err.message);
    }
  }
}

/**
 * (Re)schedule the report cron from the current settings time. Safe to call
 * repeatedly — it only rebuilds the task when the cron expression changes.
 */
export async function rescheduleReportCron() {
  let timeStr = "06:00";
  try {
    const settings = await Settings.findOne({ active: true }).select("emailAnalysisBriefTime").lean();
    if (settings?.emailAnalysisBriefTime) timeStr = settings.emailAnalysisBriefTime;
  } catch (err) {
    console.error("[EmailAnalysis] Could not read brief time, using default:", err.message);
  }

  const expr = timeToCron(timeStr);
  if (expr === currentCron && task) return expr; // nothing changed

  if (task) {
    task.stop();
    task = null;
  }
  if (!cron.validate(expr)) {
    console.error(`[EmailAnalysis] Invalid cron expression "${expr}"; report cron not scheduled.`);
    return null;
  }

  task = cron.schedule(expr, runForAllAccounts);
  currentCron = expr;
  console.log(`[EmailAnalysis] Report cron scheduled at "${timeStr}" (${expr}).`);
  return expr;
}

/** Start the cron on boot (gated like the other jobs). */
export function startReportCron() {
  // if (process.env.ENABLE_CRON_JOBS !== "true") {
  //   console.log("[EmailAnalysis] Report cron disabled (ENABLE_CRON_JOBS != true).");
  //   return;
  // }
  rescheduleReportCron().catch((err) =>
    console.error("[EmailAnalysis] Failed to start report cron:", err.message)
  );
}

export default { startReportCron, rescheduleReportCron, timeToCron };
