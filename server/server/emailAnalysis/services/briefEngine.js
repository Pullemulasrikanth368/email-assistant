/**@Engine - single AI call that turns an inbox into a structured brief */
import aiClient from "./aiClient";
import { buildBriefPrompt, buildCategoryGroupPrompt } from "./prompt";
import sampleBrief from "./sampleBrief";

// Keys every brief must expose so the UI never breaks on a partial response.
const BRIEF_ARRAY_KEYS = [
  "triage",
  "narrativeKeyPoints",
  "categorySummaries",
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
export function normalizeBrief(brief) {
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
  out.categorySummaries = out.categorySummaries.map((c) => ({
    ...c,
    groups: normalizeCategoryGroups(c),
  }));
  return out;
}

/**
 * Validate the AI's per-category topic groups so the card never breaks.
 *
 * Contract enforced (independent of what the model returned):
 *   - a group only references mails that actually belong to the category;
 *   - every mail appears in EXACTLY ONE group (dedup across groups);
 *   - when the model DID return groups but missed some mails, each missed mail
 *     becomes its own single-mail group;
 *   - when the model returned NO usable groups (absent / malformed, or the
 *     AI-disconnected fallback brief), return [] so the client renders the flat
 *     keyPoints list — i.e. groups are never synthesised from nothing.
 *
 * Returns a normalized array of { group_title, summary, mails:[{sourceId,subject,from}] }.
 * The mail objects are copied from the category's own `mails` so sourceIds are
 * always real and link-navigable.
 */
export function normalizeCategoryGroups(category = {}) {
  const mails = Array.isArray(category.mails) ? category.mails : [];
  if (!mails.length) return [];

  const rawGroups = Array.isArray(category.groups) ? category.groups : [];
  // No groups from the model → flat-list fallback on the client.
  if (!rawGroups.length) return [];

  // Index the category's real mails by sourceId — the single source of truth.
  const byId = new Map();
  mails.forEach((m) => { if (m && m.sourceId != null) byId.set(String(m.sourceId), m); });

  const used = new Set();
  const groups = [];

  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    const ids = Array.isArray(g.email_ids) ? g.email_ids : [];
    // Keep only ids that map to a real, not-yet-claimed mail in this category.
    const groupMails = [];
    for (const id of ids) {
      const key = String(id);
      if (byId.has(key) && !used.has(key)) {
        used.add(key);
        groupMails.push(byId.get(key));
      }
    }
    if (!groupMails.length) continue;
    groups.push({
      group_title: String(g.group_title || g.title || "").trim(),
      summary: String(g.summary || "").trim(),
      mails: groupMails,
    });
  }

  // The model returned groups but none survived validation → flat-list fallback.
  if (!groups.length) return [];

  // Any mail the model didn't place → its own single-mail group.
  for (const m of mails) {
    const key = String(m.sourceId);
    if (m.sourceId == null || used.has(key)) continue;
    used.add(key);
    groups.push({
      group_title: (m.subject || "").trim(),
      summary: "",
      mails: [m],
    });
  }

  return groups;
}

/**
 * Ensure every multi-mail category has complete, body-read topic groups.
 *
 * The AI's own `categorySummaries.mails` list is frequently INCOMPLETE (it
 * drops emails), which is why some mails / amounts go missing. So we ignore that
 * list and rebuild each category's mail set from the ACTUAL emails (by their
 * real `category` field), guaranteeing every mail — including newly synced ones
 * — is present. We then (re)group the complete set with a focused, body-reading
 * AI call whenever the brief's own groups don't already cover all of them.
 * Mutates brief in place; best-effort per category so it never breaks the brief.
 */
export async function fillCategoryGroups(brief, emails = []) {
  const cats = Array.isArray(brief?.categorySummaries) ? brief.categorySummaries : [];
  if (!cats.length) return brief;

  // Source of truth: the real emails, bucketed by their stored category.
  const byId = new Map();
  const emailsByCat = new Map();
  emails.forEach((e) => {
    if (e && e.id != null) byId.set(String(e.id), e);
    const cat = e.category || "Other";
    if (!emailsByCat.has(cat)) emailsByCat.set(cat, []);
    emailsByCat.get(cat).push(e);
  });

  console.log(`[EmailAnalysis] fillCategoryGroups: checking ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`);

  for (const c of cats) {
    // Resolve this summary's real emails. Prefer the category bucket; if the AI
    // echoed a prettified/mismatched category label, fall back to the emails it
    // actually listed, then widen to their real stored category so nothing is
    // lost to a label mismatch.
    let catEmails = emailsByCat.get(c.category);
    if (!catEmails || !catEmails.length) {
      const listed = (c.mails || []).map((m) => byId.get(String(m.sourceId))).filter(Boolean);
      const realCat = listed.length ? (listed[0].category || "Other") : null;
      catEmails = (realCat && emailsByCat.get(realCat)) || listed;
    }
    if (!catEmails || catEmails.length < 2) continue;

    // Rebuild the category's mails from the real emails so every mail is linked
    // and the count is accurate (the AI often lists only a subset).
    const fullMails = catEmails.map((e) => ({
      sourceId: e.id,
      subject: e.subject || "(no subject)",
      from: e.from || "",
      threadId: e.threadId || "",
    }));

    // Keep the brief's own groups only if they already cover EVERY real mail.
    const existing = Array.isArray(c.groups) ? c.groups : [];
    const covered = new Set(existing.flatMap((g) => (g.mails || []).map((m) => String(m.sourceId))));
    const allCovered = fullMails.length > 0 && fullMails.every((m) => covered.has(String(m.sourceId)));
    if (existing.length && allCovered) {
      c.mails = fullMails;
      c.count = fullMails.length;
      continue;
    }

    try {
      const res = await aiClient.createChat(buildCategoryGroupPrompt(c.category, catEmails));
      const rawGroups = Array.isArray(res?.groups) ? res.groups : [];
      // Validate against the COMPLETE mail set (dedup, fill any missed mail).
      const groups = normalizeCategoryGroups({ mails: fullMails, groups: rawGroups });
      if (groups.length) {
        c.groups = groups;
        c.mails = fullMails;
        c.count = fullMails.length;
        console.log(`[EmailAnalysis] Grouped "${c.category}": ${fullMails.length} mails -> ${groups.length} group(s)`);
      } else {
        console.warn(`[EmailAnalysis] Grouping "${c.category}": AI returned no usable groups (rawGroups=${rawGroups.length})`);
      }
    } catch (err) {
      console.warn(`[EmailAnalysis] Category grouping failed for "${c.category}":`, err.message);
    }
  }
  return brief;
}

export function isUsableBrief(brief) {
  return brief && typeof brief === "object" && typeof brief.narrative === "string";
}

// Sections the model most often skips; an inbox with 2+ emails should almost
// always yield material for several of these.
const CORE_CONTENT_KEYS = ["risks", "actions", "events", "patterns", "collisions", "deadlines"];

function emptyCoreSections(brief) {
  return CORE_CONTENT_KEYS.filter((key) => !(Array.isArray(brief[key]) && brief[key].length));
}

/** Merge two normalized briefs, keeping the richer value per key. */
function mergeBriefs(base, extra) {
  const out = { ...base };
  for (const key of BRIEF_ARRAY_KEYS) {
    if ((extra[key] || []).length > (out[key] || []).length) out[key] = extra[key];
  }
  if (!out.narrative && extra.narrative) out.narrative = extra.narrative;
  return out;
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

/** Plain text of an HTML mail body — for summaries and keyword matching. */
function textOf(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean truncation that doesn't slice words in the middle */
function cleanTruncate(text, maxLen = 160) {
  const plain = String(text || "").trim();
  if (plain.length <= maxLen) return plain;
  const cut = plain.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) {
    return cut.slice(0, lastSpace) + '...';
  }
  return cut + '...';
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
export function fallbackBriefFromEmails(emails = [], kb) {
  const { critRe, impRe } = buildFallbackRegexes(kb);

  const triage = emails.map((e) => {
    const hay = `${e.subject || ""} ${textOf(e.body).slice(0, 600)}`;

    const critMatched = (kb && kb.keywords && kb.keywords.critical || []).filter((k) => hay.toLowerCase().includes(k.toLowerCase()));
    const impMatched = (kb && kb.keywords && kb.keywords.important || []).filter((k) => hay.toLowerCase().includes(k.toLowerCase()));

    const tier = critRe.test(hay) ? "Critical" : impRe.test(hay) ? "Important" : "Low";
    return {
      sourceId: e.id,
      tier,
      reason: e.subject || "(no subject)",
      subject: e.subject || "(no subject)",
      from: e.from || "",
      summary: cleanTruncate(textOf(e.body), 160) || "(no content)",
      matchedKeywords: tier === "Critical" ? critMatched : tier === "Important" ? impMatched : [],
    };
  });

  const critical = triage.filter((t) => t.tier === "Critical");
  const important = triage.filter((t) => t.tier === "Important");

  // Per-category digests from the stored AI categories (no AI available here).
  const byCategory = new Map();
  emails.forEach((e) => {
    const cat = e.category || "Other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(e);
  });
  const categorySummaries = [...byCategory.entries()].map(([category, items]) => {
    const senders = [...new Set(items.map((e) => String(e.from || "").replace(/<[^>]*>/g, "").trim()).filter(Boolean))];
    // Subjects live in keyPoints only (deduped) — the summary just states the theme,
    // so the two never repeat each other.
    const keyPoints = [...new Set(items.map((e) => (e.subject || "(no subject)").trim()))].slice(0, 8);
    return {
      category,
      count: items.length,
      summary:
        `${items.length} email(s)` +
        `${senders.length ? ` from ${senders.slice(0, 4).join(", ")}` : ""}. ` +
        `Reconnect AI for a written digest of this category.`,
      keyPoints,
      mails: items.map((e) => ({ sourceId: e.id, subject: e.subject || "(no subject)", from: e.from || "", threadId: e.threadId || "" })),
    };
  });

  // Key points grouped by tier so the narrative reads as linked bullets even offline.
  const tierPoint = (label, items, summary) => (items.length ? {
    title: `${label} · ${items.length} email(s)`,
    summary,
    mails: items.map((t) => ({ sourceId: t.sourceId, subject: t.subject, from: t.from })),
  } : null);
  const narrativeKeyPoints = [
    tierPoint("Critical", critical, "Flagged critical by keyword scan — review these first."),
    tierPoint("Important", important, "Flagged important by keyword scan — likely need a response or follow-up."),
  ].filter(Boolean);

  return {
    narrative:
      `Offline summary (AI analysis unavailable): ${emails.length} email(s) in this period — ` +
      `${critical.length} look critical, ${important.length} important. ` +
      `Showing a keyword-based triage of your actual inbox; reconnect AI for full scoring.`,
    narrativeKeyPoints,
    triage,
    categorySummaries,
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
 * Run an ALREADY-BUILT brief prompt (buildBriefPrompt) through the shared
 * aiClient and normalise the result to the brief contract. Encapsulates the
 * single AI call, the usable-brief check and the one-shot completeness retry.
 * THROWS on an unusable/unavailable response so the caller can decide how to
 * fall back.
 *
 * @param {string} prompt      - a full prompt from buildBriefPrompt
 * @param {Object} opts        - { periodLabel?, emailCount?, allowRetry? }
 * @returns {Promise<{brief, source: "live"}>}
 */
export async function generateBriefFromPrompt(prompt, opts = {}) {
  const { periodLabel = "", emailCount = 0, allowRetry = true } = opts;
  const provider = await aiClient.currentProvider();
  const result = await aiClient.createChat(prompt);

  console.log(
    `[EmailAnalysis] ${provider} response for "${periodLabel}" (${emailCount} emails):`,
    JSON.stringify(result, null, 2)
  );

  if (!isUsableBrief(result)) {
    throw new Error(`${provider} returned an unusable brief`);
  }

  let brief = normalizeBrief(result);

  // Completeness guard: if the model skipped most core sections on a
  // non-trivial inbox, re-ask once with an explicit callout and keep the
  // richer answer per section.
  const missing = emptyCoreSections(brief);
  if (allowRetry && emailCount >= 2 && missing.length >= 3) {
    console.warn(
      `[EmailAnalysis] Brief left ${missing.length} core sections empty (${missing.join(", ")}) — retrying once for completeness.`
    );
    try {
      const retryPrompt =
        `${prompt}\n\nIMPORTANT: A previous attempt left these sections EMPTY: ${missing.join(", ")}. ` +
        `Re-analyse the emails and populate every one of them that has ANY supporting material. ` +
        `Do not return empty arrays out of brevity — extract implicit actions, dated events, scoreable risks, cross-email patterns, deadline collisions.`;
      const retry = await aiClient.createChat(retryPrompt);
      if (isUsableBrief(retry)) brief = mergeBriefs(brief, normalizeBrief(retry));
    } catch (retryErr) {
      console.warn("[EmailAnalysis] Completeness retry failed, keeping first brief:", retryErr.message);
    }
  }

  return { brief, source: "live" };
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
    const { brief, source } = await generateBriefFromPrompt(prompt, {
      periodLabel: meta.periodLabel || "",
      emailCount: filteredEmails.length,
    });
    // The mega-prompt often drops the nested per-category "groups"; fill any
    // gaps with focused, body-reading grouping calls so every multi-mail
    // category gets Gmail-style topic groups with merged summaries. Never let a
    // grouping hiccup discard an otherwise-good live brief.
    try {
      await fillCategoryGroups(brief, filteredEmails);
    } catch (groupErr) {
      console.warn("[EmailAnalysis] fillCategoryGroups skipped:", groupErr.message);
    }
    return { brief, source, matchedKeywordsSummary };
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

export default { generateBrief, generateBriefFromPrompt, normalizeBrief, normalizeCategoryGroups, fillCategoryGroups, fallbackBriefFromEmails };
