/**@Background mail-sync workers
 *
 * Keeps every connected email-analysis account continuously synced:
 *   - a frequent INCREMENTAL sync (every 15 min) for freshness, and
 *   - a daily + on-boot 1-MONTH BACKFILL so the past-month window is always
 *     complete (and recovers anything the History API missed, e.g. spam).
 *
 * "Always mail and data should be synced."
 */
import cron from "node-cron";

import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import OutlookUser from "../../microsoft/models/outlookUser.model";
import Employee from "../../models/employee.model";
import { createMailService } from "../services/mailProvider.service";
import OutlookMessagesService from "../../microsoft/services/outlookMessages.service";
import reportService from "../services/report.service";
import prioritizeService from "../services/prioritize.service";

const INCREMENTAL_CRON = "*/15 * * * *"; // every 15 minutes
const BACKFILL_CRON = "30 3 * * *";      // daily at 03:30
const BACKFILL_DAYS = 30;
const STARTUP_DELAY_MS = 20 * 1000;      // let the DB connection settle first

let incrementalTask = null;
let backfillTask = null;

async function isAutoSyncEnabledFor(loginUserEmailId) {
  if (!loginUserEmailId) return true;
  try {
    const employee = await Employee.findOne({ email: loginUserEmailId, active: true }).lean();
    if (employee && employee.autoSync === false) {
      return false;
    }
  } catch (err) {
    console.warn(`[EmailAnalysis] Could not verify auto-sync for user ${loginUserEmailId}:`, err.message);
  }
  return true;
}

async function forEachAccount(label, fn) {
  let users = [];
  try {
    // Only SOURCE accounts are synced — send-only (bulk-send) accounts are skipped.
    users = await EmailAnalysisUser.find({ active: true, purpose: { $ne: "send" } }).select("email loginUserEmailId").lean();
  } catch (err) {
    console.error(`[EmailAnalysis] ${label}: could not list accounts:`, err.message);
    return;
  }
  for (const u of users) {
    if (!u.email) continue;
    try {
      const enabled = await isAutoSyncEnabledFor(u.loginUserEmailId);
      if (!enabled) {
        console.log(`[EmailAnalysis] Skipping background ${label} for Gmail account ${u.email} (auto-sync disabled by user)`);
        continue;
      }
      await fn(u.email);
    } catch (err) {
      console.error(`[EmailAnalysis] ${label} failed for ${u.email}:`, err.message);
    }
  }
}

/** Incremental sync + prioritize for all accounts (frequent, lightweight). */
async function syncAllAccounts() {
  // Gmail / EmailAnalysisUser accounts
  await forEachAccount("Incremental sync", (email) => reportService.syncAndPrioritize(email));

  // Outlook / OutlookUser accounts
  let outlookUsers = [];
  try {
    outlookUsers = await OutlookUser.find({ active: true, purpose: { $ne: "send" } }).select("email loginUserEmailId").lean();
  } catch (err) {
    console.error("[EmailAnalysis] Incremental sync: could not list Outlook accounts:", err.message);
  }
  for (const u of outlookUsers) {
    if (!u.email) continue;
    try {
      const enabled = await isAutoSyncEnabledFor(u.loginUserEmailId);
      if (!enabled) {
        console.log(`[EmailAnalysis] Skipping background incremental sync for Outlook account ${u.email} (auto-sync disabled by user)`);
        continue;
      }
      await new OutlookMessagesService(u.email).syncForUser();
      await prioritizeService.prioritizePendingForAccount(u.email);
    } catch (err) {
      console.error(`[EmailAnalysis] Outlook incremental sync failed for ${u.email}:`, err.message);
    }
  }
}

/** 1-month backfill + prioritize for all accounts (recovers any gaps). */
async function backfillAllAccounts(days = BACKFILL_DAYS) {
  // Gmail backfill
  await forEachAccount("Backfill", async (email) => {
    const service = await createMailService(email);
    await service.backfillRecent(days);
    await prioritizeService.prioritizePendingForAccount(email);
  });

  // Outlook backfill
  let outlookUsers = [];
  try {
    outlookUsers = await OutlookUser.find({ active: true, purpose: { $ne: "send" } }).select("email loginUserEmailId").lean();
  } catch (err) {
    console.error("[EmailAnalysis] Backfill: could not list Outlook accounts:", err.message);
  }
  for (const u of outlookUsers) {
    if (!u.email) continue;
    try {
      const enabled = await isAutoSyncEnabledFor(u.loginUserEmailId);
      if (!enabled) {
        console.log(`[EmailAnalysis] Skipping background backfill for Outlook account ${u.email} (auto-sync disabled by user)`);
        continue;
      }
      await new OutlookMessagesService(u.email).backfillRecent(days);
      await prioritizeService.prioritizePendingForAccount(u.email);
    } catch (err) {
      console.error(`[EmailAnalysis] Outlook backfill failed for ${u.email}:`, err.message);
    }
  }
}

/** Convert value + unit (minutes/hours/days) to a cron expression. */
function intervalToCron(value, unit) {
  const val = Number(value);
  const u = String(unit || 'minutes').toLowerCase();

  if (u === 'days') {
    const safeDays = (val >= 1 && val <= 31) ? val : 1;
    return safeDays === 1 ? "0 0 * * *" : `0 0 */${safeDays} * *`;
  } else if (u === 'hours') {
    const safeHours = (val >= 1 && val <= 23) ? val : 1;
    return `0 */${safeHours} * * *`;
  } else {
    // default unit is minutes
    const safeMin = (val >= 1 && val <= 59) ? val : 15;
    if (val === 60) return "0 * * * *";
    return `*/${safeMin} * * * *`;
  }
}

/** Stop the background sync workers (called when user toggles auto-sync OFF). */
export function stopSyncJobs() {
  if (incrementalTask) { incrementalTask.stop(); incrementalTask = null; }
  if (backfillTask)    { backfillTask.stop();    backfillTask    = null; }
  console.log("[EmailAnalysis] Sync workers STOPPED (auto-sync disabled by user).");
}

/**
 * Stop the incremental cron and restart it with a new interval.
 * Called immediately when the user changes their sync interval.
 */
export function rescheduleIncrementalCron(value, unit) {
  const expr = intervalToCron(value, unit);

  // Stop the current incremental task only (backfill keeps its own schedule).
  if (incrementalTask) { incrementalTask.stop(); incrementalTask = null; }

  if (!cron.validate(expr)) {
    console.error(`[EmailAnalysis] Invalid incremental cron "${expr}" — keeping stopped.`);
    return;
  }

  incrementalTask = cron.schedule(expr, () => {
    syncAllAccounts().catch((err) => console.error("[EmailAnalysis] syncAllAccounts error:", err.message));
  });
  console.log(`[EmailAnalysis] Incremental sync rescheduled to "${expr}" (every ${value} ${unit}).`);
}

/** Start the background sync workers on boot. */
export async function startSyncJobs() {
  if (incrementalTask || backfillTask) return; // already running

  let intervalValue = 15;
  let intervalUnit = "minutes";

  // On boot: respect per-user preferences — only start if at least one active
  // admin has autoSync !== false (the default is true, so new users always start).
  try {
    const Employee = (await import("../../models/employee.model.js")).default;
    const anyEnabled = await Employee.findOne({ active: true, autoSync: { $ne: false } }).lean();
    if (!anyEnabled) {
      console.log("[EmailAnalysis] All users have auto-sync OFF — cron NOT started on boot.");
      return;
    }
    if (anyEnabled.syncIntervalValue !== undefined) {
      intervalValue = anyEnabled.syncIntervalValue;
      intervalUnit = anyEnabled.syncIntervalUnit || "minutes";
    } else if (anyEnabled.syncIntervalMinutes) {
      intervalValue = anyEnabled.syncIntervalMinutes;
      intervalUnit = "minutes";
    }
  } catch (e) {
    // DB not ready at first boot — start the cron (safe default).
    console.warn("[EmailAnalysis] Could not read auto-sync preference on boot, starting cron anyway:", e.message);
  }

  const incrementalExpr = intervalToCron(intervalValue, intervalUnit);

  incrementalTask = cron.schedule(incrementalExpr, () => {
    syncAllAccounts().catch((err) => console.error("[EmailAnalysis] syncAllAccounts error:", err.message));
  });
  backfillTask = cron.schedule(BACKFILL_CRON, () => {
    backfillAllAccounts().catch((err) => console.error("[EmailAnalysis] backfillAllAccounts error:", err.message));
  });

  console.log(`[EmailAnalysis] Sync workers started (incremental "${incrementalExpr}", backfill "${BACKFILL_CRON}").`);

  // One-time backfill shortly after boot so the past month is present immediately.
  setTimeout(() => {
    backfillAllAccounts().catch((err) => console.error("[EmailAnalysis] startup backfill error:", err.message));
  }, STARTUP_DELAY_MS);
}

export default { startSyncJobs, stopSyncJobs, rescheduleIncrementalCron };

