/**
 * Junk rescue — after AI prioritization, junk-folder mails that turned out to
 * be needed/important are moved back to the real inbox (Gmail: SPAM label
 * swapped for INBOX; Outlook: moved to the Inbox folder).
 */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import { createMailService } from "./mailProvider.service";
import { isPromotionalSender } from "./promotionalSender.util";

// A junk mail is "worth rescuing" when the AI marked it urgent/important…
const RESCUE_PRIORITIES = ["Critical", "High"];
// …or filed it under a category that represents real, needed mail.
const RESCUE_CATEGORIES = [
  "Action Required",
  "Meetings & Scheduling",
  "Finance & Invoices",
  "Support & Complaints",
  "Sales & Leads",
  "Personal",
];

/**
 * Move every prioritized junk mail that looks important back to the inbox.
 * Idempotent: rescued mails get `junkRescuedAt` set (and isJunk=false), so
 * they are never picked up again; failures stay pending for the next run.
 *
 * @param {string} email connected account
 * @returns {Promise<{ candidates:number, rescued:number, failed:number }>}
 */
export async function rescueImportantJunk(email) {
  if (!email) return { candidates: 0, rescued: 0, failed: 0 };

  const rows = await EmailAnalysisMail.find({
    email,
    active: true,
    isJunk: true,
    junkRescuedAt: null,
    prioritizedAt: { $ne: null },
    $or: [
      { priority: { $in: RESCUE_PRIORITIES } },
      { category: { $in: RESCUE_CATEGORIES } },
    ],
  }).select("providerMessageId subject from priority category").lean();

  // Promotional/newsletter blasts stay in junk no matter how urgent their
  // copy sounded to the AI — only real senders earn a rescue.
  const candidates = rows.filter((c) => !isPromotionalSender(c.from));

  if (!candidates.length) return { candidates: 0, rescued: 0, failed: 0 };

  const service = await createMailService(email);
  if (typeof service.rescueFromJunk !== "function") {
    console.warn(`[EmailAnalysis] Junk rescue not supported for ${email}'s provider.`);
    return { candidates: candidates.length, rescued: 0, failed: 0 };
  }

  console.log(
    `[EmailAnalysis] Rescuing ${candidates.length} important junk mail(s) for ${email}:`,
    candidates.map((c) => `"${c.subject}" (${c.priority}/${c.category})`).join(", ")
  );
  const { rescued, failed } = await service.rescueFromJunk(candidates.map((c) => c.providerMessageId));
  return { candidates: candidates.length, rescued, failed };
}

export default { rescueImportantJunk };
