/**@Mail prioritization - assigns an intent-based priority to each mail */
import aiClient from "./aiClient";
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";
import { rescueImportantJunk } from "./junkRescue.service";
import { createAutoDraftsForMails } from "./autoDraft.service";
import { isPromotionalSender } from "./promotionalSender.util";
import { createMailService } from "./mailProvider.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 8;
const VALID = ["Critical", "High", "Medium", "Low"];
const VALID_CATEGORIES = [
  "Action Required",
  "Meetings & Scheduling",
  "Finance & Invoices",
  "Sales & Leads",
  "Support & Complaints",
  "Notifications & Updates",
  "Newsletters",
  "Promotions & Marketing",
  "Personal",
  "Junk",
];

function dayBounds(date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function normPriority(p) {
  const hit = VALID.find((v) => v.toLowerCase() === String(p || "").trim().toLowerCase());
  return hit || "Low";
}

function normCategory(c) {
  const hit = VALID_CATEGORIES.find((v) => v.toLowerCase() === String(c || "").trim().toLowerCase());
  return hit || "Notifications & Updates";
}

/** Normalize the per-mail quick-reply block coming back from the AI. */
function normQuickReplies(qr) {
  const options = (Array.isArray(qr?.options) ? qr.options : [])
    .filter((o) => o && o.label && o.reply)
    .slice(0, 5)
    .map((o) => ({ label: String(o.label).trim().slice(0, 24), reply: String(o.reply).trim().slice(0, 500) }));
  return { eligible: !!qr?.eligible && options.length > 0, options, generatedAt: new Date() };
}

function clampScore(n, priority) {
  const num = Number(n);
  if (Number.isFinite(num) && num >= 1 && num <= 100) return Math.round(num);
  // derive a sensible score from the level if the model omitted it
  return { Critical: 90, High: 70, Medium: 45, Low: 15 }[priority] || 15;
}

// Bulk-mail categories are never worth more than Low, whatever keywords the
// copy uses ("URGENT sale", "IMPORTANT order update", …).
const LOW_ONLY_CATEGORIES = ["Newsletters", "Promotions & Marketing", "Junk"];
const LOW_SCORE_CAP = 25;
// Categories that never get an auto-drafted reply, whatever the AI said —
// meetings are accepted (not replied to), invoices/notifications are records,
// bulk mail has nothing to answer. Drafts are only for mails needing a reply.
const NO_DRAFT_CATEGORIES = [
  "Meetings & Scheduling",
  "Finance & Invoices",
  "Notifications & Updates",
  ...LOW_ONLY_CATEGORIES,
];
// Rescue-worthy categories the AI may be baited into for promo blasts — for a
// promotional sender these are re-filed so junk rescue never restores them.
const RESCUE_BAIT_CATEGORIES = [
  "Action Required",
  "Meetings & Scheduling",
  "Finance & Invoices",
  "Support & Complaints",
  "Sales & Leads",
  "Personal",
];

/**
 * Force promotional/newsletter/spam mail down to Low priority after the AI
 * pass, so keyword-stuffed marketing ("IMPORTANT", "urgent") can't outrank
 * real work mail. Returns the (possibly adjusted) fields to persist.
 */
function applyPromotionalClamp(mail, { priority, priorityScore, category, reason }) {
  const promoSender = isPromotionalSender(mail.from);
  const lowCategory = LOW_ONLY_CATEGORIES.includes(category);
  if (!promoSender && !lowCategory) return { priority, priorityScore, category, reason };

  let clampedCategory = category;
  if (promoSender && RESCUE_BAIT_CATEGORIES.includes(category)) {
    clampedCategory = "Promotions & Marketing";
  }
  if (priority === "Low" && priorityScore <= LOW_SCORE_CAP && clampedCategory === category) {
    return { priority, priorityScore, category, reason };
  }
  return {
    priority: "Low",
    priorityScore: Math.min(priorityScore, LOW_SCORE_CAP),
    category: clampedCategory,
    reason: `${reason ? `${reason} — ` : ""}kept Low: ${promoSender ? "promotional/bulk sender" : "bulk-mail category"}`,
  };
}

/** Build the prioritization prompt for a batch of emails. */
function buildPriorityPrompt(items, knowledgeBaseConfig = {}) {
  const kb = knowledgeBaseConfig || {};
  const keywords = kb.keywords || {};
  const thresholds = kb.thresholds || {};
  const glossary = kb.glossary || {};
  const categories = keywords.categories || {};

  const criticalKeywords = (keywords.critical || []).join(", ") || "urgent, escalation, deadline, outage, legal, safety";
  const importantKeywords = (keywords.important || []).join(", ") || "approval, review, follow-up, request, due";
  const lowKeywords = (keywords.low || []).join(", ") || "FYI, newsletter, update, automated, marketing";
  const activeCategories = Object.entries(categories)
    .filter(([, enabled]) => enabled !== false)
    .map(([name]) => name);
  const glossaryLines = Object.entries(glossary)
    .map(([term, definition]) => `- ${term}: ${definition}`)
    .join("\n");

  return `You are an experienced executive assistant. Read each email and judge it like a human would:
what is the sender's INTENTION, and what does it demand of the recipient?

Use this Knowledge Base as the primary classification guide. It was configured by the user and should override generic assumptions when it applies.

KNOWLEDGE BASE KEYWORDS:
- Critical signals: ${criticalKeywords}
- Important signals: ${importantKeywords}
- Low-priority signals: ${lowKeywords}

KNOWLEDGE BASE THRESHOLDS:
- Critical score starts at ${thresholds.criticalScore || 80}/100
- Elevated score starts at ${thresholds.elevatedScore || 50}/100
- Escalation score starts at ${thresholds.escalationScore || 70}/100

${activeCategories.length ? `SURFACED CATEGORIES:\n${activeCategories.map((c) => `- ${c}`).join("\n")}\n` : ""}
${glossaryLines ? `DOMAIN GLOSSARY:\n${glossaryLines}\n` : ""}
${kb.promptInstruction ? `USER INSTRUCTION:\n${kb.promptInstruction}\n` : ""}

Weigh: urgency / time-sensitivity, explicit deadlines, whether a decision or action is required,
sender importance, business / financial / legal / safety consequence, and whether it is merely
FYI / automated / marketing.

Assign a PRIORITY for each email:
- "Critical": urgent AND high consequence — act now.
- "High": needs the recipient's action soon.
- "Medium": worth attention, no rush.
- "Low": FYI, newsletter, automated, no action.

Classification rules:
- If an email contains Critical KB signals and the context is relevant, classify it as Critical unless the body clearly says the issue is already resolved.
- If an email contains Important KB signals, classify it at least High or Medium depending on urgency.
- If an email contains only Low-priority KB signals and no real action/deadline, classify it Low.
- Mention the KB signal in the reason when it influenced the result.

Also infer a short "intent" tag (e.g. approval-request, deadline, escalation, complaint,
scheduling, info-request, invoice, fyi, marketing) and a one-line reason.

Additionally assign exactly one CATEGORY from this list:
${VALID_CATEGORIES.map((c) => `- ${c}`).join("\n")}

Some emails were found in the junk/spam folder (marked "isJunk": true). Judge them on their
actual content: a legitimate, useful mail (e.g. an invoice, meeting request, or customer reply)
that was wrongly junked should get its real category and priority — reserve the "Junk" category
for genuinely unwanted spam/phishing.

IMPORTANT — promotional and bulk mail: emails from shopping/marketplace brands (Flipkart,
Amazon, Myntra, Swiggy, Zomato, travel/food/payment apps, …), newsletters, digests, and
marketing campaigns are ALWAYS "Low" priority with category "Promotions & Marketing",
"Newsletters", or "Junk" — even when they contain urgent-sounding keywords like "important",
"urgent", "last chance", "act now", or "deadline". Marketing copy does not create real urgency.

Also decide "needsReply" for each email — does it expect a WRITTEN REPLY from the recipient?
- true ONLY when a human sender asks a question, requests information/action/approval, raises a
complaint, or otherwise waits on a written response from the recipient.
- false for meeting/calendar invites (they are accepted, not replied to), invoices, receipts,
payment confirmations, order/shipping updates, automated notifications, newsletters, promotions,
no-reply senders, and pure FYI mail — even when they are important.

Also produce one-click QUICK-REPLY buttons for each email:
- "quickReplies.eligible" = true ONLY if the email expects a short answer: a yes/no question, a
scheduling/availability ask, a "please confirm"/"is this correct?" check, a request needing
acknowledgement, or a thanks that warrants a brief reply.
- Give 3-5 options that MATCH what THAT email is actually asking (e.g. scheduling -> "Yes" / "No" /
"Maybe"; a confirm -> "Correct" / "Not correct"; an FYI needing acknowledgement -> "Got it" / "Thanks").
- "label": 1-2 words for the button. "reply": a natural one-line message to actually send
(e.g. label "Yes" -> reply "Yes, that works for me.").
- eligible = false with an empty options array for newsletters, promotions, spam, no-reply/automated
notifications, or anything with nothing to answer.

Return ONLY JSON, no markdown:
{ "items": [ { "id": "<email id>", "priority": "Critical|High|Medium|Low", "priorityScore": <1-100>, "intent": "<tag>", "category": "<one of the categories above>", "reason": "<one line>", "needsReply": <boolean>, "quickReplies": { "eligible": <boolean>, "options": [ { "label": "<1-2 words>", "reply": "<one line>" } ] } } ] }

EMAILS:
${JSON.stringify(items)}
`;
}

/**
 * Prioritize a single day's mails for an account, writing results back onto
 * each mail document. By default only mails without a priority are scored.
 *
 * @param {string} email
 * @param {Date|string} day  - any moment within the target day
 * @param {Object} opts       - { force?: boolean }
 * @returns {Promise<number>} number of mails prioritized
 */
export async function prioritizeDay(email, day, opts = {}) {
  if (!email) return 0;
  const { start, end } = dayBounds(day);

  const query = {
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
    // Own outgoing mail and drafts don't need an AI priority.
    sourceFolder: { $nin: ["sent", "draft"] },
  };
  if (!opts.force) query.priority = null; // only unscored mails

  const mails = await EmailAnalysisMail.find(query, {
    providerMessageId: 1, from: 1, subject: 1, body: 1, snippet: 1, isJunk: 1, provider: 1,
  }).lean();
  if (!mails.length) return 0;
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);

  let updated = 0;
  const needsReplyIds = []; // providerMessageIds to auto-draft a reply for
  for (let i = 0; i < mails.length; i += CHUNK) {
    const slice = mails.slice(i, i + CHUNK);
    const items = slice.map((m) => ({
      id: m.providerMessageId,
      from: m.from || "",
      subject: m.subject || "",
      isJunk: !!m.isJunk,
      body: String(m.body || m.snippet || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500),
    }));

    let results = [];
    try {
      const resp = await aiClient.createChat(buildPriorityPrompt(items, knowledgeBaseConfig));
      results = Array.isArray(resp?.items) ? resp.items : [];
      console.log(`[EmailAnalysis] Priority response for ${email} (${items.length} mails):`, JSON.stringify(results, null, 2));
    } catch (err) {
      // Full detail so AI/transport errors (e.g. 403 from the model endpoint)
      // are diagnosable, not just the generic message.
      console.error("[EmailAnalysis] Priority scan failed for a chunk:", {
        message: err.message,
        status: err?.response?.status,
        statusText: err?.response?.statusText,
        url: err?.config?.url,
        method: err?.config?.method,
        data: err?.response?.data,
        code: err?.code,
      });
      continue; // leave this chunk unscored; a later run can retry
    }

    const byId = new Map(results.map((r) => [String(r.id), r]));
    // Collect items that are Outlook emails, to push categories back after write
    const outlookCategoryItems = [];
    const ops = slice.map((m) => {
      const r = byId.get(String(m.providerMessageId)) || {};
      const aiPriority = normPriority(r.priority);
      const clamped = applyPromotionalClamp(m, {
        priority: aiPriority,
        priorityScore: clampScore(r.priorityScore, aiPriority),
        category: normCategory(r.category),
        reason: r.reason || null,
      });
      const quickReplies = normQuickReplies(r.quickReplies);
      // Bulk mail never warrants a one-click reply, whatever the AI said.
      if (LOW_ONLY_CATEGORIES.includes(clamped.category)) {
        quickReplies.eligible = false;
        quickReplies.options = [];
      }
      const needsReply = !!r.needsReply && !NO_DRAFT_CATEGORIES.includes(clamped.category);
      if (needsReply) needsReplyIds.push(m.providerMessageId);

      // Queue this message for Outlook category push if it's an Outlook email
      if (m.provider === "outlook") {
        outlookCategoryItems.push({
          providerMessageId: m.providerMessageId,
          priority: clamped.priority,
          category: clamped.category,
          intent: r.intent || null,
          needsReply,
        });
      }

      return {
        updateOne: {
          filter: { email, providerMessageId: m.providerMessageId },
          update: {
            $set: {
              priority: clamped.priority,
              priorityScore: clamped.priorityScore,
              intent: r.intent || null,
              category: clamped.category,
              priorityReason: clamped.reason,
              prioritizedAt: new Date(),
              needsReply,
              quickReplies,
            },
          },
        },
      };
    });

    if (ops.length) {
      const res = await EmailAnalysisMail.bulkWrite(ops);
      updated += res?.modifiedCount || ops.length;
    }

    // Push AI category labels back to Outlook (best-effort, non-blocking)
    if (outlookCategoryItems.length) {
      try {
        const mailService = await createMailService(email);
        if (typeof mailService.bulkPushCategories === "function") {
          const pushRes = await mailService.bulkPushCategories(outlookCategoryItems);
          if (pushRes?.pushedIds?.length) {
            await EmailAnalysisMail.updateMany(
              { email, provider: "outlook", providerMessageId: { $in: pushRes.pushedIds } },
              { $set: { categoriesSynced: true } }
            );
          }
        }
      } catch (err) {
        console.error(`[EmailAnalysis] Outlook category push failed for ${email}:`, err.message);
      }
    }
  }

  // Auto-draft replies for the mails that need one (never meetings, invoices,
  // notifications or bulk mail). Best-effort: a draft failure never breaks
  // the prioritize pipeline.
  if (needsReplyIds.length) {
    try {
      await createAutoDraftsForMails(email, needsReplyIds);
    } catch (err) {
      console.error(`[EmailAnalysis] Auto-draft pass failed for ${email}:`, err.message);
    }
  }

  console.log(`[EmailAnalysis] Prioritized ${updated} mail(s) for ${email} on ${start.toISOString().slice(0, 10)}`);
  return updated;
}

/**
 * Find every day that still has unscored mail for an account and prioritize
 * each day separately.
 *
 * @param {string} email
 * @param {Object} opts - { force?: boolean }
 * @returns {Promise<number>} total mails prioritized
 */
export async function prioritizePendingForAccount(email, opts = {}) {
  if (!email) return 0;

  const filter = { email, active: true, sourceFolder: { $nin: ["sent", "draft"] } };
  if (!opts.force) filter.priority = null;

  const rows = await EmailAnalysisMail.find(filter, { receivedAt: 1 }).lean();
  if (!rows.length) {
    // Even if there are no new mails to prioritize, check for any pending category syncs
    try {
      await syncPendingOutlookCategories(email);
    } catch (err) {
      console.error(`[EmailAnalysis] Post-prioritize category sync failed for ${email}:`, err.message);
    }
    return 0;
  }

  // Group into distinct calendar days.
  const days = new Set();
  for (const r of rows) {
    if (!r.receivedAt) continue;
    days.add(dayBounds(r.receivedAt).start.getTime());
  }

  let total = 0;
  for (const ts of days) {
    total += await prioritizeDay(email, new Date(ts), opts);
  }

  // Newly-scored junk mails that turned out to be important are moved back to
  // the real inbox. Best-effort: a failure never breaks the sync pipeline.
  try {
    await rescueImportantJunk(email);
  } catch (err) {
    console.error(`[EmailAnalysis] Junk rescue failed for ${email}:`, err.message);
  }

  // Push any pending/unsynced categories to Outlook
  try {
    await syncPendingOutlookCategories(email);
  } catch (err) {
    console.error(`[EmailAnalysis] Post-prioritize category sync failed for ${email}:`, err.message);
  }

  return total;
}

/**
 * Find all active, prioritized Outlook emails for this account that have NOT
 * had their categories successfully pushed/synchronized to Outlook yet, and
 * push them now.
 *
 * @param {string} email
 * @returns {Promise<{ pushed: number, failed: number }>}
 */
export async function syncPendingOutlookCategories(email) {
  if (!email) return { pushed: 0, failed: 0 };

  try {
    const mails = await EmailAnalysisMail.find({
      email,
      provider: "outlook",
      active: true,
      priority: { $ne: null },
      categoriesSynced: { $ne: true },
    }, {
      providerMessageId: 1, priority: 1, category: 1, intent: 1, needsReply: 1
    }).lean();

    if (!mails.length) return { pushed: 0, failed: 0 };

    console.log(`[EmailAnalysis] Found ${mails.length} pending Outlook category push(es) for ${email}`);

    const outlookCategoryItems = mails.map((m) => ({
      providerMessageId: m.providerMessageId,
      priority: m.priority,
      category: m.category,
      intent: m.intent || null,
      needsReply: !!m.needsReply,
    }));

    const mailService = await createMailService(email);
    if (typeof mailService.bulkPushCategories === "function") {
      const pushRes = await mailService.bulkPushCategories(outlookCategoryItems);
      if (pushRes?.pushedIds?.length) {
        await EmailAnalysisMail.updateMany(
          { email, provider: "outlook", providerMessageId: { $in: pushRes.pushedIds } },
          { $set: { categoriesSynced: true } }
        );
      }
      return { pushed: pushRes?.pushedIds?.length || 0, failed: pushRes?.failedIds?.length || 0 };
    }
  } catch (err) {
    console.error(`[EmailAnalysis] syncPendingOutlookCategories failed for ${email}:`, err.message);
  }
  return { pushed: 0, failed: 0 };
}

export default { prioritizeDay, prioritizePendingForAccount, syncPendingOutlookCategories };
