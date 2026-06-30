/**@Mail prioritization - assigns an intent-based priority to each mail */
import aiClient from "./aiClient";
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 25; // emails per AI call
const VALID = ["Critical", "High", "Medium", "Low"];

function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function normPriority(p) {
  const hit = VALID.find((v) => v.toLowerCase() === String(p || "").trim().toLowerCase());
  return hit || "Low";
}

function clampScore(n, priority) {
  const num = Number(n);
  if (Number.isFinite(num) && num >= 1 && num <= 100) return Math.round(num);
  // derive a sensible score from the level if the model omitted it
  return { Critical: 90, High: 70, Medium: 45, Low: 15 }[priority] || 15;
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

Return ONLY JSON, no markdown:
{ "items": [ { "id": "<email id>", "priority": "Critical|High|Medium|Low", "priorityScore": <1-100>, "intent": "<tag>", "reason": "<one line>" } ] }

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

  const query = { email, active: true, receivedAt: { $gte: start, $lt: end } };
  if (!opts.force) query.priority = null; // only unscored mails

  const mails = await EmailAnalysisMail.find(query, {
    providerMessageId: 1, from: 1, subject: 1, body: 1, snippet: 1,
  }).lean();
  if (!mails.length) return 0;

  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);

  let updated = 0;
  for (let i = 0; i < mails.length; i += CHUNK) {
    const slice = mails.slice(i, i + CHUNK);
    const items = slice.map((m) => ({
      id: m.providerMessageId,
      from: m.from || "",
      subject: m.subject || "",
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
    const ops = slice.map((m) => {
      const r = byId.get(String(m.providerMessageId)) || {};
      const priority = normPriority(r.priority);
      return {
        updateOne: {
          filter: { email, providerMessageId: m.providerMessageId },
          update: {
            $set: {
              priority,
              priorityScore: clampScore(r.priorityScore, priority),
              intent: r.intent || null,
              priorityReason: r.reason || null,
              prioritizedAt: new Date(),
            },
          },
        },
      };
    });

    if (ops.length) {
      const res = await EmailAnalysisMail.bulkWrite(ops);
      updated += res?.modifiedCount || ops.length;
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

  const filter = { email, active: true };
  if (!opts.force) filter.priority = null;

  const rows = await EmailAnalysisMail.find(filter, { receivedAt: 1 }).lean();
  if (!rows.length) return 0;

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
  return total;
}

export default { prioritizeDay, prioritizePendingForAccount };
