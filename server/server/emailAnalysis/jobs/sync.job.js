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

async function forEachAccount(label, fn) {
  let users = [];
  try {
    // Only SOURCE accounts are synced — send-only (bulk-send) accounts are skipped.
    users = await EmailAnalysisUser.find({ active: true, purpose: { $ne: "send" } }).select("email").lean();
  } catch (err) {
    console.error(`[EmailAnalysis] ${label}: could not list accounts:`, err.message);
    return;
  }
  for (const u of users) {
    if (!u.email) continue;
    try {
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
    outlookUsers = await OutlookUser.find({ active: true, purpose: { $ne: "send" } }).select("email").lean();
  } catch (err) {
    console.error("[EmailAnalysis] Incremental sync: could not list Outlook accounts:", err.message);
  }
  for (const u of outlookUsers) {
    if (!u.email) continue;
    try {
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
    outlookUsers = await OutlookUser.find({ active: true, purpose: { $ne: "send" } }).select("email").lean();
  } catch (err) {
    console.error("[EmailAnalysis] Backfill: could not list Outlook accounts:", err.message);
  }
  for (const u of outlookUsers) {
    if (!u.email) continue;
    try {
      await new OutlookMessagesService(u.email).backfillRecent(days);
      await prioritizeService.prioritizePendingForAccount(u.email);
    } catch (err) {
      console.error(`[EmailAnalysis] Outlook backfill failed for ${u.email}:`, err.message);
    }
  }
}

/** Start the background sync workers on boot. */
export function startSyncJobs() {
  if (incrementalTask || backfillTask) return; // already started

  incrementalTask = cron.schedule(INCREMENTAL_CRON, () => {
    syncAllAccounts().catch((err) => console.error("[EmailAnalysis] syncAllAccounts error:", err.message));
  });
  backfillTask = cron.schedule(BACKFILL_CRON, () => {
    backfillAllAccounts().catch((err) => console.error("[EmailAnalysis] backfillAllAccounts error:", err.message));
  });

  console.log(`[EmailAnalysis] Sync workers started (incremental "${INCREMENTAL_CRON}", backfill "${BACKFILL_CRON}").`);

  // One-time backfill shortly after boot so the past month is present immediately.
  setTimeout(() => {
    backfillAllAccounts().catch((err) => console.error("[EmailAnalysis] startup backfill error:", err.message));
  }, STARTUP_DELAY_MS);
}

export default { startSyncJobs };
