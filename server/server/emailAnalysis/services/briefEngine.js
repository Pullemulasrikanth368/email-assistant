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

// Keyword scans for the offline fallback.
const CRITICAL_RE = /\b(urgent|critical|asap|immediately|outage|down(time)?|breach|recall|escalat\w*|incident|security|legal|deadline|overdue|fail\w*|penalty|fine)\b/i;
const IMPORTANT_RE = /\b(action|review|approve|approval|sign[- ]?off|please|request|reminder|follow[- ]?up|due|response needed|reply|confirm|pending|invoice|payment)\b/i;

/**
 * Build a brief from the ACTUAL emails when OpenAI is unavailable, so the
 * report always reflects the saved mail (never unrelated canned data).
 */
function fallbackBriefFromEmails(emails = []) {
  const triage = emails.map((e) => {
    const hay = `${e.subject || ""} ${String(e.body || "").slice(0, 600)}`;
    const tier = CRITICAL_RE.test(hay) ? "Critical" : IMPORTANT_RE.test(hay) ? "Important" : "Low";
    return { sourceId: e.id, tier, reason: e.subject || "(no subject)" };
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
 * Generate a brief from emails. Live mode uses OpenAI (JSON mode, gpt-4o via
 * the shared util). On ANY failure (no key, network, bad JSON) it falls back
 * to the baked-in sample so the demo always works.
 *
 * @param {Array} emails          - mapped email shape (see CONTRACT.md)
 * @param {Array} yesterdayRisks  - previous report's risks (for trend)
 * @param {Object} meta           - { periodLabel }
 * @returns {Promise<{brief, source}>}
 */
export async function generateBrief(emails = [], yesterdayRisks = [], meta = {}) {
  // No emails -> a designed "quiet day", not an error.
  if (!emails.length) {
    return {
      brief: normalizeBrief({
        narrative: "Calm period — no emails to analyse in this window.",
      }),
      source: "sample",
    };
  }

  try {
    const prompt = buildBriefPrompt(emails, yesterdayRisks, meta);
    const provider = await aiClient.currentProvider();
    const result = await aiClient.createChat(prompt); // JSON mode, parsed (openai|ollama)

    // Log the raw analysis for inspection.
    console.log(
      `[EmailAnalysis] ${provider} response for "${meta.periodLabel || ""}" (${emails.length} emails):`,
      JSON.stringify(result, null, 2)
    );

    if (!isUsableBrief(result)) {
      throw new Error(`${provider} returned an unusable brief`);
    }
    return { brief: normalizeBrief(result), source: "live" };
  } catch (err) {
    console.error("[EmailAnalysis] Brief engine fell back (OpenAI unavailable):", err.message);
    // Reflect the real inbox even when AI is down, rather than canned data.
    if (emails.length) {
      return { brief: normalizeBrief(fallbackBriefFromEmails(emails)), source: "sample" };
    }
    return { brief: normalizeBrief(sampleBrief), source: "sample" };
  }
}

export default { generateBrief };
