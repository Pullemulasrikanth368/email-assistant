/**@Pre-Meeting Brief service
 *
 * Builds an AI preparation brief for an upcoming meeting by REUSING the
 * existing pipeline end-to-end:
 *   - meeting invites are detected from the already-synced `email_analysis_mails`
 *   - candidate emails are selected from the SAME analyzed collection (their
 *     stored priority/category/intent are reused — no re-analysis)
 *   - topics + the final brief are produced through the shared aiClient
 *     (OpenAI/Ollama selection) via briefEngine.generateBriefFromPrompt
 *   - the result is stored with the same brief contract the dashboard renders
 */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import PreMeetingBrief from "../models/preMeetingBrief.model";
import aiClient from "./aiClient";
import {
  generateBriefFromPrompt,
  normalizeBrief,
  fallbackBriefFromEmails,
} from "./briefEngine";
import { buildMeetingTopicsPrompt, buildPreMeetingPrompt } from "./prompt";
import { toEmailShape } from "./report.service";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";

const DAY_MS = 24 * 60 * 60 * 1000;

// How far back to scan for meeting invitations, and how much prior mail to
// consider "related" context for a meeting.
const INVITE_LOOKBACK_DAYS = 21;
const CONTEXT_LOOKBACK_DAYS = 60;
const MAX_CANDIDATES = 40;

/* ============================ helpers ============================ */

/** Plain text of an HTML body (for regex parsing / prompt context). */
function textOf(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Line-aware plain text: block/`<br>` boundaries become real newlines FIRST so
 * label-bounded fields ("When:", "Where:", "Required:") don't bleed into each
 * other when the invite HTML uses <br> instead of block elements.
 */
function textLines(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(div|p|tr|li|h[1-6]|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*\n+/g, "\n")
    .trim();
}

// Invite field labels — used to stop a captured value before the next label
// when everything sits on one collapsed line.
const NEXT_LABEL_RE = /\s+(?:when|where|location|required|optional|attendees|participants|agenda|organi[sz]er|subject|cost)\s*:/i;
const trimAtNextLabel = (s = "") => {
  const m = s.match(NEXT_LABEL_RE);
  return (m ? s.slice(0, m.index) : s).trim().replace(/[.;,\s]+$/, "").trim();
};

/** Extract every email address from an arbitrary string. */
function addressesIn(str = "") {
  const out = String(str).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return out.map((a) => a.toLowerCase());
}

/** Domain part of an email address. */
function domainOf(addr = "") {
  const m = String(addr).toLowerCase().match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return m ? m[1] : "";
}

// Free/consumer mail domains never count as a meaningful "company" match.
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "aol.com", "protonmail.com", "me.com", "msn.com",
]);

/** Is this mail a meeting invitation? (calendar attachment or invite wording). */
function looksLikeInvite(mail) {
  const hasIcs = (mail.attachments || []).some(
    (a) => /calendar/i.test(a.mimeType || "") || /\.ics$/i.test(a.filename || "")
  );
  if (hasIcs) return true;
  if (mail.category === "Meetings & Scheduling") {
    // category alone is weak; require an invite-ish signal too
  }
  const hay = `${mail.subject || ""} ${textOf(mail.body || mail.snippet || "").slice(0, 1200)}`;
  const inviteRe = /(invitation:|has invited you|when:\s|microsoft teams meeting|zoom\.us\/j\/|meet\.google\.com|webex\.com|join the meeting|calendar invite|accepted:|updated invitation)/i;
  return inviteRe.test(hay);
}

/** Best-effort parse of the meeting start time from an invite body / ICS text. */
function parseMeetingWhen(mail) {
  const raw = mail.body || mail.snippet || "";
  const lines = textLines(raw);

  // 1) ICS DTSTART embedded in the body (e.g. DTSTART:20260710T140000Z)
  const dt = String(raw).match(/DTSTART[^:]*:(\d{8}T\d{6}Z?)/i);
  if (dt) {
    const s = dt[1];
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}${/Z$/i.test(s) ? "Z" : ""}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return { when: d, whenText: `${d.toUTCString()}` };
  }

  // 2) "When: <text>" line common in Gmail/Outlook invites (bounded at newline
  // and at the next label so it never swallows "Where:"/"Required:").
  const whenLine = lines.match(/When:\s*([^\n]{3,120})/i);
  if (whenLine) {
    const whenText = trimAtNextLabel(whenLine[1]);
    // Drop a trailing "-3:00 PM" end time so Date can parse the start.
    const startText = whenText.replace(/\s*[-–]\s*\d{1,2}:\d{2}\s*(am|pm)?.*$/i, "").trim();
    const d = new Date(startText);
    return { when: Number.isNaN(d.getTime()) ? null : d, whenText };
  }

  return { when: null, whenText: "" };
}

/**
 * Extract structured meeting facts from an invitation mail using deterministic
 * parsing (no AI needed for the facts themselves).
 */
export function extractMeetingDetails(mail) {
  const lines = textLines(mail.body || mail.snippet || "");
  const title = String(mail.subject || "")
    .replace(/^\s*(invitation:|updated invitation:|accepted:|fw:|re:)\s*/i, "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim() || "(untitled meeting)";

  const { when, whenText } = parseMeetingWhen(mail);

  // Participants: from + to + cc + any addresses in the body's Required/Optional lines.
  const set = new Set();
  addressesIn(mail.from).forEach((a) => set.add(a));
  (Array.isArray(mail.to) ? mail.to : [mail.to]).forEach((t) => addressesIn(t || "").forEach((a) => set.add(a)));
  (mail.cc || []).forEach((t) => addressesIn(t || "").forEach((a) => set.add(a)));
  const partLine = lines.match(/(?:required|optional|attendees|participants):\s*([^\n]{0,300})/i);
  if (partLine) addressesIn(partLine[1]).forEach((a) => set.add(a));

  const locLine = lines.match(/(?:where|location):\s*([^\n]{3,160})/i);
  const location = locLine ? trimAtNextLabel(locLine[1]) : "";

  return {
    meetingSourceId: mail.providerMessageId || String(mail._id),
    title,
    when,
    whenText,
    location,
    organizer: mail.from || "",
    participants: [...set],
    description: textOf(mail.body || mail.snippet || "").slice(0, 3000),
  };
}

/**
 * Detect upcoming meeting invitations from the account's synced mail.
 * Returns lightweight descriptors the UI can list and pick from.
 */
export async function detectUpcomingMeetings(email, opts = {}) {
  if (!email) return [];
  const lookback = new Date(Date.now() - (opts.lookbackDays || INVITE_LOOKBACK_DAYS) * DAY_MS);

  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: lookback },
    sourceFolder: { $nin: ["sent", "draft"] },
  })
    .sort({ receivedAt: -1 })
    .limit(400)
    .lean();

  const invites = mails.filter(looksLikeInvite).map((m) => {
    const d = extractMeetingDetails(m);
    return {
      meetingSourceId: d.meetingSourceId,
      title: d.title,
      when: d.when,
      whenText: d.whenText,
      organizer: d.organizer,
      participantCount: d.participants.length,
      participants: d.participants,
      receivedAt: m.receivedAt,
      location: d.location,
    };
  });

  // Prefer meetings whose time is in the future; keep undated ones too.
  const now = Date.now();
  invites.sort((a, b) => {
    const at = a.when ? new Date(a.when).getTime() : Infinity;
    const bt = b.when ? new Date(b.when).getTime() : Infinity;
    const aFuture = at >= now ? 0 : 1;
    const bFuture = bt >= now ? 0 : 1;
    if (aFuture !== bFuture) return aFuture - bFuture;
    return at - bt;
  });

  // De-dupe repeated invites for the same title+time.
  const seen = new Set();
  return invites.filter((i) => {
    const key = `${i.title.toLowerCase()}::${i.when ? new Date(i.when).getTime() : i.whenText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 25);
}

/**
 * Ask the AI (shared provider) for discussion topics/keywords for a meeting.
 * Falls back to title-derived keywords when AI is unavailable.
 */
export async function generateMeetingTopics(meeting) {
  try {
    const prompt = buildMeetingTopicsPrompt(meeting);
    const res = await aiClient.createChat(prompt);
    const topics = Array.isArray(res?.topics) ? res.topics : [];
    const keywords = Array.isArray(res?.keywords) ? res.keywords : [];
    const merged = [...new Set([...topics, ...keywords].map((s) => String(s).trim()).filter(Boolean))];
    if (merged.length) return { topics, keywords, all: merged };
  } catch (err) {
    console.warn("[PreMeeting] Topic extraction fell back:", err.message);
  }
  // Fallback: distinctive words from the title.
  const fromTitle = String(meeting.title || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);
  return { topics: fromTitle, keywords: fromTitle, all: fromTitle };
}

/**
 * Retrieve candidate emails relevant to the meeting from the ALREADY-analyzed
 * mail collection, scored by participant / domain / topic overlap and recency.
 * Reuses stored metadata — never re-fetches or re-analyzes mail.
 */
export async function retrieveCandidateEmails(email, meeting, terms = []) {
  const participants = (meeting.participants || []).map((a) => a.toLowerCase()).filter(Boolean);
  const domains = [...new Set(participants.map(domainOf).filter((d) => d && !GENERIC_DOMAINS.has(d)))];
  const keywords = [...new Set((terms || []).map((t) => String(t).trim().toLowerCase()).filter((t) => t.length > 2))];

  const anchor = meeting.when ? new Date(meeting.when).getTime() : Date.now();
  const since = new Date(anchor - CONTEXT_LOOKBACK_DAYS * DAY_MS);

  // Pull a bounded recent window for this account, then score in memory. This
  // reuses the synced collection and keeps the query index-friendly.
  const pool = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: since },
    sourceFolder: { $nin: ["draft"] },
  })
    .sort({ receivedAt: -1 })
    .limit(600)
    .lean();

  const scored = pool.map((m) => {
    const hay = `${m.from || ""} ${m.to || ""} ${(m.cc || []).join(" ")} ${m.subject || ""} ${(m.snippet || "")}`.toLowerCase();
    const bodyHay = `${m.subject || ""} ${textOf(m.body || m.snippet || "").slice(0, 1500)}`.toLowerCase();
    let score = 0;

    // Participant address match is the strongest signal.
    if (participants.some((p) => hay.includes(p))) score += 6;
    // Same company/domain.
    if (domains.some((d) => hay.includes(`@${d}`) || hay.includes(d))) score += 3;
    // Topic / keyword overlap.
    const kwHits = keywords.filter((k) => bodyHay.includes(k)).length;
    score += Math.min(kwHits, 5) * 2;
    // Priority nudges (reuse stored analysis).
    if (m.priority === "Critical") score += 2;
    else if (m.priority === "High") score += 1;
    // Recency: closer to the meeting anchor scores a little higher.
    const ageDays = Math.abs(anchor - new Date(m.receivedAt).getTime()) / DAY_MS;
    if (ageDays <= 7) score += 2; else if (ageDays <= 21) score += 1;

    return { mail: m, score };
  })
    .filter((s) => s.score >= 3) // must have at least a real participant/domain/topic hit
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return scored.map((s) => s.mail);
}

/** Counters for the list cards, from a normalized brief. */
function briefCounts(brief) {
  return {
    decisions: (brief.decisionQueue || []).length,
    risks: (brief.risks || []).length,
    actions: (brief.actions || []).length,
    todos: (brief.todoList || []).length,
  };
}

/**
 * Generate (and store) a pre-meeting brief.
 *
 * @param {string} email
 * @param {Object} opts - one of:
 *   { meetingSourceId }                       -> use a detected invite from the inbox
 *   { meeting: { title, whenText, participants[], description, location, organizer } } -> manual
 *   plus { force? } to regenerate an existing brief for the same invite.
 * @returns {Promise<PreMeetingBrief>}
 */
export async function generatePreMeetingBrief(email, opts = {}) {
  if (!email) throw new Error("email is required to generate a pre-meeting brief");

  // 1) Resolve the meeting — from an invite email, or from manual details.
  let details;
  if (opts.meetingSourceId) {
    const inviteMail = await EmailAnalysisMail.findOne({
      email, providerMessageId: opts.meetingSourceId, active: true,
    }).lean();
    if (!inviteMail) throw new Error("Meeting invitation not found for this account.");
    details = extractMeetingDetails(inviteMail);

    // Idempotent per (email, invite) unless forced.
    if (!opts.force) {
      const existing = await PreMeetingBrief.findOne({
        email, meetingSourceId: details.meetingSourceId, active: true,
      }).lean();
      if (existing) return existing;
    }
  } else if (opts.meeting && (opts.meeting.title || opts.meeting.participants)) {
    const m = opts.meeting;
    const parsed = m.whenText ? new Date(m.whenText) : null;
    details = {
      meetingSourceId: null,
      title: m.title || "(untitled meeting)",
      when: m.when ? new Date(m.when) : (parsed && !Number.isNaN(parsed.getTime()) ? parsed : null),
      whenText: m.whenText || (m.when ? new Date(m.when).toUTCString() : ""),
      location: m.location || "",
      organizer: m.organizer || email,
      participants: [...new Set((m.participants || []).flatMap((p) => addressesIn(p)))],
      description: m.description || "",
    };
  } else {
    throw new Error("Provide a meetingSourceId or meeting details.");
  }

  // 2) Topics/keywords via the shared AI provider.
  const topicResult = await generateMeetingTopics(details);
  details.topics = topicResult.topics;

  // 3) Retrieve relevant analyzed emails (reusing stored metadata).
  const candidateMails = await retrieveCandidateEmails(email, details, topicResult.all);
  const emails = candidateMails.map(toEmailShape);

  // 4) Build the meeting prompt and run it through the SHARED engine path.
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
  let brief;
  let source;
  try {
    const prompt = buildPreMeetingPrompt(details, emails, { knowledgeBaseConfig });
    const out = await generateBriefFromPrompt(prompt, {
      periodLabel: details.title,
      emailCount: emails.length,
    });
    brief = out.brief;
    source = out.source;
  } catch (err) {
    console.error("[PreMeeting] Brief AI unavailable, using metadata fallback:", err.message);
    brief = emails.length
      ? normalizeBrief(fallbackBriefFromEmails(emails, knowledgeBaseConfig))
      : normalizeBrief({ narrative: "Limited prior context found for this meeting." });
    source = "sample";
  }

  // Attach each mail's stored category to its triage row (matched by sourceId),
  // mirroring the daily-report behaviour so the UI can group by category.
  const catById = new Map(candidateMails.map((m) => [String(m.providerMessageId || m._id), m.category || ""]));
  (brief.triage || []).forEach((t) => { if (!t.category) t.category = catById.get(String(t.sourceId)) || ""; });

  // 5) Persist (upsert per invite; always insert for manual entries).
  let doc = details.meetingSourceId
    ? await PreMeetingBrief.findOne({ email, meetingSourceId: details.meetingSourceId })
    : null;
  if (!doc) doc = new PreMeetingBrief({ email, meetingSourceId: details.meetingSourceId });

  doc.meetingTitle = details.title;
  doc.meetingWhen = details.when;
  doc.meetingWhenText = details.whenText;
  doc.meetingLocation = details.location;
  doc.organizer = details.organizer;
  doc.participants = details.participants;
  doc.description = details.description;
  doc.topics = topicResult.all;
  doc.candidateCount = emails.length;
  doc.brief = brief;
  doc.source = source;
  doc.generatedAt = new Date();
  doc.counts = briefCounts(brief);
  doc.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  doc.active = true;

  return PreMeetingBrief.saveData(doc);
}

export async function listPreMeetingBriefs(email, limit = 30) {
  if (!email) return [];
  return PreMeetingBrief.find({ email, active: true }, { brief: 0 })
    .sort({ generatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 90))
    .lean();
}

export async function getPreMeetingBriefById(id) {
  return PreMeetingBrief.findOne({ _id: id, active: true }).lean();
}

export async function deletePreMeetingBrief(id) {
  return PreMeetingBrief.updateOne({ _id: id }, { $set: { active: false } });
}

export default {
  detectUpcomingMeetings,
  extractMeetingDetails,
  generateMeetingTopics,
  retrieveCandidateEmails,
  generatePreMeetingBrief,
  listPreMeetingBriefs,
  getPreMeetingBriefById,
  deletePreMeetingBrief,
};
