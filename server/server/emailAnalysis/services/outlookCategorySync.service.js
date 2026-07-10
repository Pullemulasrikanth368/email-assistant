/**
 * outlookCategorySync.service.js
 *
 * Shared utility: maps our DB category / priority / intent fields onto
 * Outlook category-label names and pushes them back to the real Outlook
 * mailbox via Microsoft Graph PATCH /me/messages/{id}.
 *
 * Called by prioritize.service.js after the AI priority bulk-write so that
 * the labels are immediately visible in Outlook Web / Desktop clients.
 *
 * Category names used here must exist in the user's Outlook master list.
 * The Graph API silently ignores unknown category names, so we register
 * missing ones on first push via POST /me/outlook/masterCategories.
 *
 * Graph permission required: Mail.ReadWrite
 */

import OutlookCategoryConfig from "../models/outlookCategoryConfig.model";

/* ─── Category name maps ─── */

/**
 * Maps our DB `priority` values to Outlook category names.
 * We use colour-coded prefixes so they sort nicely in Outlook.
 */
export const PRIORITY_CATEGORY = {
  Critical: "🔴 Critical",
  High:     "🟠 High Priority",
  Medium:   "🟡 Medium Priority",
  Low:      "⚪ Low Priority",
};

/**
 * Maps our DB `category` values to Outlook category names.
 */
export const CATEGORY_MAP = {
  "Action Required":         "✅ Action Required",
  "Meetings & Scheduling":   "📅 Meetings",
  "Finance & Invoices":      "💰 Finance",
  "Sales & Leads":           "📈 Sales",
  "Support & Complaints":    "🛠️ Support",
  "Notifications & Updates": "🔔 Updates",
  "Newsletters":             "📰 Newsletter",
  "Promotions & Marketing":  "🏷️ Marketing",
  "Personal":                "👤 Personal",
  "Junk":                    "🗑️ Junk",
};

/**
 * Maps our DB `intent` values to Outlook category names.
 * Only intents that add clear value are mapped; generic ones are skipped.
 */
export const INTENT_CATEGORY = {
  "approval-request": "⏳ Awaiting Approval",
  "deadline":         "⏰ Deadline",
  "invoice":          "📄 Invoice",
  "escalation":       "🚨 Escalation",
  "complaint":        "😠 Complaint",
};

/**
 * All category labels we may ever push — used for master-category registration.
 */
export const ALL_CATEGORY_LABELS = [
  ...Object.values(PRIORITY_CATEGORY),
  ...Object.values(CATEGORY_MAP),
  ...Object.values(INTENT_CATEGORY),
  "💬 Reply Needed",
];

/* ─── Colour map for master-category registration ─── */

// Graph-supported preset colours (use "none" when unspecified)
const CATEGORY_COLOUR = {
  "🔴 Critical":          "preset0",  // Red
  "🟠 High Priority":     "preset1",  // Orange
  "🟡 Medium Priority":   "preset3",  // Yellow
  "⚪ Low Priority":       "preset9",  // Gray
  "✅ Action Required":   "preset2",  // Green
  "📅 Meetings":          "preset6",  // Teal
  "💰 Finance":           "preset4",  // Blue
  "📈 Sales":             "preset5",  // Purple
  "🛠️ Support":           "preset1",  // Orange
  "🔔 Updates":           "preset7",  // Light Blue
  "📰 Newsletter":        "preset9",  // Gray
  "🏷️ Marketing":         "preset8",  // Pink
  "👤 Personal":          "preset10", // Light Green
  "🗑️ Junk":              "preset9",  // Gray
  "⏳ Awaiting Approval": "preset3",  // Yellow
  "⏰ Deadline":          "preset0",  // Red
  "📄 Invoice":           "preset4",  // Blue
  "🚨 Escalation":        "preset0",  // Red
  "😠 Complaint":         "preset1",  // Orange
  "💬 Reply Needed":      "preset6",  // Teal
};

/* ─── helpers ─── */

/**
 * Build the list of Outlook category labels to apply for a given mail result.
 *
 * @param {{ priority, category, intent, needsReply, _rawLabels? }} fields
 * @param {{ priorityMap?, categoryMap?, intentMap?, replyNeededEnabled?, replyNeededLabel? }} [lookup]
 *   Optional resolved lookup maps from the DB config. When omitted the
 *   hardcoded default maps are used.
 * @returns {string[]}
 */
export function buildOutlookCategories(fields, lookup = null) {
  // Allow the config re-push path to pass pre-computed labels directly.
  if (Array.isArray(fields._rawLabels)) return [...new Set(fields._rawLabels)];

  const { priority, category, intent, needsReply } = fields;
  const labels = [];

  const pMap = lookup?.priorityMap || null;
  const cMap = lookup?.categoryMap || null;
  const iMap = lookup?.intentMap   || null;
  const rnEnabled = lookup ? lookup.replyNeededEnabled !== false : true;
  const rnLabel   = lookup?.replyNeededLabel || '💬 Reply Needed';

  // Priority
  if (priority) {
    const label = pMap ? pMap.get(priority) : PRIORITY_CATEGORY[priority];
    if (label) labels.push(label);
  }

  // Category
  if (category) {
    const label = cMap ? cMap.get(category) : CATEGORY_MAP[category];
    if (label) labels.push(label);
  }

  // Intent
  if (intent) {
    const label = iMap ? iMap.get(intent) : INTENT_CATEGORY[intent];
    if (label) labels.push(label);
  }

  // Reply needed
  if (needsReply && rnEnabled) {
    labels.push(rnLabel);
  }

  return [...new Set(labels)]; // deduplicate
}

/* ─── Master category registration ─── */

/**
 * Ensure our custom category labels exist in the user's Outlook master list.
 * Fetches existing ones and only POSTs the missing ones.
 * Best-effort: errors are logged but never thrown.
 *
 * @param {Function} graphFn  - bound `#graph` method: (method, url, opts) => data
 * @param {string} [email]    - User email to look up custom label configurations
 */
export async function ensureMasterCategories(graphFn, email = null) {
  try {
    let labelsToSync = [...ALL_CATEGORY_LABELS];
    const customColors = { ...CATEGORY_COLOUR };

    if (email) {
      const config = await OutlookCategoryConfig.findOne({ email, active: true }).lean();
      if (config) {
        const customLabels = [];
        const processMap = (mapArray) => {
          for (const item of (mapArray || [])) {
            if (item.enabled && item.outlookLabel) {
              customLabels.push(item.outlookLabel);
              if (item.colour) {
                customColors[item.outlookLabel] = item.colour;
              }
            }
          }
        };
        processMap(config.priorityMap);
        processMap(config.categoryMap);
        processMap(config.intentMap);
        if (config.replyNeededEnabled && config.replyNeededLabel) {
          customLabels.push(config.replyNeededLabel);
          if (config.replyNeededColour) {
            customColors[config.replyNeededLabel] = config.replyNeededColour;
          }
        }

        if (customLabels.length > 0) {
          labelsToSync = [...new Set(customLabels)];
        }
      }
    }

    const data = await graphFn("GET", "/me/outlook/masterCategories", {});
    const existing = new Set((data.value || []).map((c) => c.displayName));

    const missing = labelsToSync.filter((label) => !existing.has(label));
    for (const label of missing) {
      try {
        await graphFn("POST", "/me/outlook/masterCategories", {
          data: {
            displayName: label,
            color: customColors[label] || "none",
          },
        });
        console.log(`[OutlookCategorySync] Registered master category: "${label}"`);
      } catch (err) {
        // Duplicate or permission error — safe to ignore
        console.warn(`[OutlookCategorySync] Could not register category "${label}":`, err.message);
      }
    }
  } catch (err) {
    console.warn("[OutlookCategorySync] Could not fetch master categories:", err.message);
  }
}

/* ─── Main push function ─── */

/**
 * Push AI-assigned category labels back to one Outlook message.
 *
 * @param {Function} graphFn         - bound `#graph` method
 * @param {string}   providerMessageId
 * @param {{ priority, category, intent, needsReply, _rawLabels? }} fields
 * @param {Object}   [lookup]  - optional resolved lookup from DB config
 * @returns {Promise<{ pushed: boolean, labels: string[] }>}
 */
export async function pushCategoriesToMessage(graphFn, providerMessageId, fields, lookup = null) {
  const labels = buildOutlookCategories(fields, lookup);
  if (!labels.length) return { pushed: false, labels: [] };

  try {
    await graphFn('PATCH', `/me/messages/${encodeURIComponent(providerMessageId)}`, {
      data: { categories: labels },
    });
    return { pushed: true, labels };
  } catch (err) {
    console.error(
      `[OutlookCategorySync] Failed to push categories for message ${providerMessageId}:`,
      err.message
    );
    return { pushed: false, labels, error: err.message };
  }
}

/**
 * Bulk-push category labels for multiple messages.
 * Runs sequentially to avoid Graph throttling (429).
 *
 * @param {Function} graphFn
 * @param {Array<{ providerMessageId, priority, category, intent, needsReply }>} items
 * @returns {Promise<{ pushed: number, failed: number }>}
 */
export async function bulkPushCategories(graphFn, items = []) {
  const pushedIds = [];
  const failedIds = [];

  for (const item of items) {
    const { providerMessageId, ...fields } = item;
    if (!providerMessageId) continue;
    const result = await pushCategoriesToMessage(graphFn, providerMessageId, fields);
    if (result.pushed) {
      pushedIds.push(providerMessageId);
    } else {
      failedIds.push(providerMessageId);
    }
  }

  console.log(`[OutlookCategorySync] Bulk push complete: pushed=${pushedIds.length}, failed=${failedIds.length}`);
  return { pushed: pushedIds.length, failed: failedIds.length, pushedIds, failedIds };
}
