/**@Engine - single AI call that turns an inbox into a structured brief */
import aiClient from "./aiClient";
import { buildBriefPrompt } from "./prompt";
import sampleBrief from "./sampleBrief";

// Keys every brief must expose so the UI never breaks on a partial response.
const BRIEF_ARRAY_KEYS = [
  "triage",
  "decisionQueue",
  "risks",
  "todoList",
  "actions",
  "events",
  "collisions",
  "patterns",
  "deadlines",
];

/**
 * Normalise an engine result so the contract is always satisfied:
 * narrative is a string and every list key is an array. Also recompute
 * riskScore defensively (likelihood * impact).
 */
function normalizeBrief(brief) {
  const out = { ...brief };
  out.narrative = typeof out.narrative === "string" ? out.narrative : "";
  for (const key of BRIEF_ARRAY_KEYS) {
    if (!Array.isArray(out[key])) out[key] = [];
  }
  out.risks = out.risks.map((r) => {
    const likelihood = Number(r.likelihood) || 0;
    const impact = Number(r.impact) || 0;
    const riskScore = Number(r.riskScore) || likelihood * impact;
    return { ...r, likelihood, impact, riskScore };
  });
  return out;
}

function isUsableBrief(brief) {
  return brief && typeof brief === "object" && typeof brief.narrative === "string";
}

/**
 * Build regex patterns from KB keywords for the offline fallback.
 * Falls back to hardcoded defaults if no KB config is provided.
 */
function buildFallbackRegexes(kb) {
  const kw = kb && kb.keywords ? kb.keywords : {};
  const critical = [
    ...(kw.critical || []),
    'urgent', 'critical', 'asap', 'immediately', 'outage', 'downtime', 'breach',
    'recall', 'escalat', 'incident', 'security', 'legal', 'deadline', 'overdue',
    'fail', 'penalty', 'fine',
  ].filter(Boolean);
  const important = [
    ...(kw.important || []),
    'action', 'review', 'approve', 'approval', 'sign-off', 'please', 'request',
    'reminder', 'follow-up', 'due', 'response needed', 'reply', 'confirm',
    'pending', 'invoice', 'payment',
  ].filter(Boolean);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const critRe = new RegExp(`\\b(${critical.map(escapeRe).join('|')})\\b`, 'i');
  const impRe = new RegExp(`\\b(${important.map(escapeRe).join('|')})\\b`, 'i');
  return { critRe, impRe };
}

/**
 * Summarise which KB keywords were matched across the email set.
 * Returns { critical: [...], important: [...], low: [...] } deduped lists.
 */
function buildMatchedKeywordsSummary(emails = [], kb) {
  const kw = (kb && kb.keywords) ? kb.keywords : {};
  const allCrit = kw.critical || [];
  const allImp = kw.important || [];
  const allLow = kw.low || [];

  const matchedCrit = new Set();
  const matchedImp = new Set();
  const matchedLow = new Set();

  emails.forEach((e) => {
    const hay = `${e.subject || ''} ${String(e.body || '').slice(0, 1000)}`.toLowerCase();
    allCrit.forEach((k) => { if (hay.includes(k.toLowerCase())) matchedCrit.add(k); });
    allImp.forEach((k) => { if (hay.includes(k.toLowerCase())) matchedImp.add(k); });
    allLow.forEach((k) => { if (hay.includes(k.toLowerCase())) matchedLow.add(k); });
  });

  return {
    critical: [...matchedCrit],
    important: [...matchedImp],
    low: [...matchedLow],
  };
}

function listContains(values = [], value = "") {
  const normalized = String(value || "").toLowerCase();
  return values.some((item) => normalized.includes(String(item || "").toLowerCase()));
}

function emailMatchesKbKeyword(email = {}, kb) {
  const kw = kb?.keywords || {};
  const all = [
    ...(kw.critical || []),
    ...(kw.important || []),
    ...(kw.low || []),
  ].filter(Boolean);
  if (!all.length) return true;
  const hay = `${email.subject || ""} ${String(email.body || "").slice(0, 1200)}`.toLowerCase();
  return all.some((keyword) => hay.includes(String(keyword).toLowerCase()));
}

function emailRequiresReply(email = {}) {
  const intent = String(email.intent || "").toLowerCase();
  const text = `${email.subject || ""} ${String(email.body || "").slice(0, 500)}`.toLowerCase();
  return /reply|respond|response|approval|approve|confirm|review|action needed|please|request/.test(`${intent} ${text}`);
}

function emailNeedsEscalation(email = {}, kb) {
  const priorityScore = Number(email.priorityScore) || 0;
  const escalationScore = Number(kb?.thresholds?.escalationScore) || 70;
  const priority = String(email.priority || "").toLowerCase();
  const criticalKeywords = kb?.keywords?.critical || [];
  return priority === "critical" || priorityScore >= escalationScore || listContains(criticalKeywords, `${email.subject || ""} ${email.body || ""}`);
}

/**
 * Apply Knowledge Base processing scope before building the brief.
 * These rules decide which mails enter analysis; Report Config only decides
 * what report sections/details are displayed after analysis.
 */
function applyKnowledgeBaseFilters(emails = [], kb) {
  const f = kb && kb.filters ? kb.filters : {};
  let out = emails;

  if (f.senderEmail && f.senderEmail.length) {
    out = out.filter((e) => listContains(f.senderEmail, e.from));
  }
  if (f.senderDomain && f.senderDomain.length) {
    out = out.filter((e) => listContains(f.senderDomain, e.from));
  }
  if (f.priority && f.priority.length) {
    const allowed = f.priority.map((p) => String(p).toLowerCase());
    out = out.filter((e) => allowed.includes(String(e.priority || "").toLowerCase()));
  }
  if (f.hasAttachments) {
    out = out.filter((e) => e.hasAttachments);
  }
  if (f.unreadOnly) {
    out = out.filter((e) => (e.labels || []).map((x) => String(x).toUpperCase()).includes("UNREAD"));
  }
  if (f.requiresReply) {
    out = out.filter((e) => emailRequiresReply(e) && !e.isRepliedMail);
  }
  if (f.containsKbKeywords) {
    out = out.filter((e) => emailMatchesKbKeyword(e, kb));
  }
  if (f.escalationRequired) {
    out = out.filter((e) => emailNeedsEscalation(e, kb));
  }

  return out;
}

/**
 * Build a brief from the ACTUAL emails when AI is unavailable, so the
 * report always reflects the saved mail (never unrelated canned data).
 * Uses KB keywords when available, hardcoded patterns as fallback.
 */
function fallbackBriefFromEmails(emails = [], kb) {
  const { critRe, impRe } = buildFallbackRegexes(kb);

  const triage = emails.map((e) => {
    const hay = `${e.subject || ""} ${String(e.body || "").slice(0, 600)}`;

    const critMatched = (kb && kb.keywords && kb.keywords.critical || []).filter((k) => hay.toLowerCase().includes(k.toLowerCase()));
    const impMatched = (kb && kb.keywords && kb.keywords.important || []).filter((k) => hay.toLowerCase().includes(k.toLowerCase()));

    const tier = critRe.test(hay) ? "Critical" : impRe.test(hay) ? "Important" : "Low";
    return {
      sourceId: e.id,
      tier,
      reason: e.subject || "(no subject)",
      matchedKeywords: tier === "Critical" ? critMatched : tier === "Important" ? impMatched : [],
    };
  });

  const critical = triage.filter((t) => t.tier === "Critical");
  const important = triage.filter((t) => t.tier === "Important");

  return {
    narrative:
      `Offline summary (AI analysis unavailable): ${emails.length} email(s) in this period — ` +
      `${critical.length} look critical, ${important.length} important. ` +
      `Showing a keyword-based triage of your actual inbox; reconnect AI for full scoring.`,
    triage,
    decisionQueue: critical.slice(0, 6).map((t) => ({
      title: t.reason, why: "Flagged critical by keyword scan", deadline: "", sourceId: t.sourceId,
    })),
    risks: [],
    todoList: important.slice(0, 10).map((t) => ({
      task: t.reason, deadline: "", status: "Open", sourceId: t.sourceId,
    })),
    actions: [],
    collisions: [],
    patterns: [],
    deadlines: [],
  };
}

/**
 * Generate a brief from emails. Live mode uses OpenAI/Ollama (JSON mode via
 * the shared aiClient). On ANY failure it falls back to keyword-based triage
 * so the report always reflects the real inbox.
 *
 * @param {Array} emails          - mapped email shape (see CONTRACT.md)
 * @param {Array} yesterdayRisks  - previous report's risks (for trend)
 * @param {Object} meta           - { periodLabel, knowledgeBaseConfig?, reportConfig? }
 * @returns {Promise<{brief, source, matchedKeywordsSummary}>}
 */
export async function generateBrief(emails = [], yesterdayRisks = [], meta = {}) {
  const kb = meta.knowledgeBaseConfig || null;
  // Apply Knowledge Base processing scope before analysis.
  const filteredEmails = applyKnowledgeBaseFilters(emails, kb);

  // No emails -> a designed "quiet day", not an error.
  if (!filteredEmails.length) {
    return {
      brief: normalizeBrief({
        narrative: "Calm period — no emails to analyse in this window.",
      }),
      source: "sample",
      matchedKeywordsSummary: { critical: [], important: [], low: [] },
    };
  }

  const matchedKeywordsSummary = buildMatchedKeywordsSummary(filteredEmails, kb);

  try {
    const prompt = buildBriefPrompt(filteredEmails, yesterdayRisks, meta);
    const provider = await aiClient.currentProvider();
    const result = await aiClient.createChat(prompt);

    console.log(
      `[EmailAnalysis] ${provider} response for "${meta.periodLabel || ""}" (${filteredEmails.length} emails):`,
      JSON.stringify(result, null, 2)
    );

    if (!isUsableBrief(result)) {
      throw new Error(`${provider} returned an unusable brief`);
    }
    return { brief: normalizeBrief(result), source: "live", matchedKeywordsSummary };
  } catch (err) {
    console.error("[EmailAnalysis] Brief engine fell back (AI unavailable):", err.message);
    if (filteredEmails.length) {
      return {
        brief: normalizeBrief(fallbackBriefFromEmails(filteredEmails, kb)),
        source: "sample",
        matchedKeywordsSummary,
      };
    }
    return { brief: normalizeBrief(sampleBrief), source: "sample", matchedKeywordsSummary };
  }
}

export default { generateBrief };
