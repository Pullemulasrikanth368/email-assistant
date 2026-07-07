/**@Pre-Meeting Brief service
 *
 * Builds an AI preparation brief for an upcoming meeting:
 *   - the meeting invite (or manual entry) is turned into structured facts
 *   - candidate emails are pulled from the ALREADY-analyzed collection (recent
 *     window, obvious bulk mail dropped) and ranked by participant/topic
 *     overlap, but NOT filtered down to a "definitely relevant" subset — the
 *     AI is given the ranked window plus today's date and decides relevance
 *     itself, per the criteria in prompt.buildPreMeetingBriefPrompt
 *   - the brief itself is a sanitised HTML fragment (see prompt.buildPreMeetingBriefPrompt)
 *     produced via a free-form chat call — not the JSON brief-engine contract
 *     used by the daily/weekly reports
 */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import PreMeetingBrief from "../models/preMeetingBrief.model";
import aiClient from "./aiClient";
import { buildMeetingTopicsPrompt, buildPreMeetingBriefPrompt } from "./prompt";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";

const DAY_MS = 24 * 60 * 60 * 1000;

// How much prior mail to consider "related" context for a meeting.
const CONTEXT_LOOKBACK_DAYS = 60;
const MAX_CANDIDATES = 60;

// Bulk-mail categories are never meeting-relevant, whatever keywords they contain.
const BULK_CATEGORIES = new Set(["Newsletters", "Promotions & Marketing", "Junk"]);

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

const MONTHS_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const TIME_RE = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)";

/** Apply an "H(:MM) am/pm" match onto a base date. */
function atTime(base, h, min, mer) {
  const d = new Date(base);
  let hour = parseInt(h, 10) % 12;
  if (/^p/i.test(mer)) hour += 12;
  d.setHours(hour, min ? parseInt(min, 10) : 0, 0, 0);
  return d;
}

/** Absolute display text for a resolved date — relative phrases like "today" would mislead a later reader. */
function absWhenText(d) {
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Natural-language meeting time in free text ("today at 12:00 PM",
 * "tomorrow at 3 PM", "on July 7 at 2:30 PM", "7/10 at 11 AM"), resolved
 * against the mail's own received date so "today" means the sender's today.
 */
function parseNaturalWhen(text = "", baseDate) {
  const base = baseDate && !Number.isNaN(new Date(baseDate).getTime()) ? new Date(baseDate) : new Date();

  let m = text.match(new RegExp(`\\b(today|tomorrow)\\b[,\\s]*(?:at\\s*)?${TIME_RE}`, "i"));
  if (m) {
    const day = new Date(base);
    if (/tomorrow/i.test(m[1])) day.setDate(day.getDate() + 1);
    const when = atTime(day, m[2], m[3], m[4]);
    return { when, whenText: absWhenText(when) };
  }

  m = text.match(new RegExp(`\\b(?:on\\s+)?(${MONTHS_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?[,\\s]*(?:at\\s*)?${TIME_RE}`, "i"));
  if (m) {
    const year = m[3] ? parseInt(m[3], 10) : base.getFullYear();
    const day = new Date(`${m[1]} ${m[2]}, ${year}`);
    if (!Number.isNaN(day.getTime())) {
      // No explicit year and the date already passed months ago? Assume next year.
      if (!m[3] && day.getTime() < base.getTime() - 45 * DAY_MS) day.setFullYear(year + 1);
      const when = atTime(day, m[4], m[5], m[6]);
      return { when, whenText: absWhenText(when) };
    }
  }

  m = text.match(new RegExp(`\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?[,\\s]*(?:at\\s*)?${TIME_RE}`, "i"));
  if (m) {
    let year = m[3] ? parseInt(m[3], 10) : base.getFullYear();
    if (year < 100) year += 2000;
    const day = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    if (!Number.isNaN(day.getTime())) {
      const when = atTime(day, m[4], m[5], m[6]);
      return { when, whenText: absWhenText(when) };
    }
  }

  return null;
}

/** First video-conference link in the text, used when no Where:/Location: label exists. */
function meetingLinkIn(raw = "") {
  const m = String(raw).match(/https?:\/\/[^\s"'<>]*(?:teams\.microsoft\.com|teams\.live\.com|zoom\.us|meet\.google\.com|webex\.com|gotomeeting\.com)[^\s"'<>]*/i);
  return m ? m[0].replace(/[.,;)]+$/, "") : "";
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
    if (!Number.isNaN(d.getTime())) return { when: d, whenText };
    const nat = parseNaturalWhen(whenText, mail.receivedAt);
    return { when: nat ? nat.when : null, whenText };
  }

  // 3) Separate "Date:" + "Time:" label lines (common in plain-text invites).
  const dateLine = lines.match(/^\s*Date:\s*([^\n]{3,80})/im);
  const timeLine = lines.match(/^\s*Time:\s*([^\n]{2,60})/im);
  if (dateLine) {
    const whenText = `${trimAtNextLabel(dateLine[1])}${timeLine ? ` at ${trimAtNextLabel(timeLine[1])}` : ""}`;
    const nat = parseNaturalWhen(whenText, mail.receivedAt);
    if (nat) return { when: nat.when, whenText };
    const d = new Date(whenText);
    if (!Number.isNaN(d.getTime())) return { when: d, whenText };
  }

  // 4) Natural language anywhere in the subject or body — "Scheduled Today at
  // 12:00 PM", "on July 7 at 2:30 PM" — resolved against the mail's own date.
  const nat = parseNaturalWhen(`${mail.subject || ""}\n${lines}`, mail.receivedAt);
  if (nat) return nat;

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

  const locLine = lines.match(/(?:where|location|venue):\s*([^\n]{3,160})/i);
  const location = locLine
    ? trimAtNextLabel(locLine[1])
    : meetingLinkIn(mail.body || mail.snippet || "");

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
 * Gather candidate emails for the meeting from the ALREADY-analyzed mail
 * collection. This no longer decides relevance itself — it only ranks the
 * lookback window (participant / domain / topic overlap and recency give a
 * mail a higher spot) and hands the AI everything up to MAX_CANDIDATES so the
 * model — which sees the full email content, not just keyword hits — makes
 * the actual relevance call per the prompt's own criteria. Only obvious bulk
 * mail (newsletters, marketing, junk) is dropped before that ranking.
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

  const scored = pool
    .filter((m) => !BULK_CATEGORIES.has(m.category))
    .map((m) => {
      const hay = `${m.from || ""} ${m.to || ""} ${(m.cc || []).join(" ")}`.toLowerCase();
      const bodyHay = `${m.subject || ""} ${textOf(m.body || m.snippet || "").slice(0, 1500)}`.toLowerCase();

      const participantMatch = participants.some((p) => hay.includes(p));
      const domainMatch = domains.some((d) => hay.includes(`@${d}`));
      const kwHits = keywords.filter((k) => bodyHay.includes(k)).length;

      // Score only ranks the window for the AI — it no longer gates a mail
      // out. A mail with no participant/keyword hit still rides along with
      // score 0 (lowest priority) so the model can weigh it itself.
      let score = 0;
      if (participantMatch) score += 6;
      if (domainMatch) score += 2;
      score += Math.min(kwHits, 5) * 3;
      // Priority nudges (reuse stored analysis).
      if (m.priority === "Critical") score += 2;
      else if (m.priority === "High") score += 1;
      // Recency: closer to the meeting anchor scores a little higher.
      const ageDays = Math.abs(anchor - new Date(m.receivedAt).getTime()) / DAY_MS;
      if (ageDays <= 7) score += 2; else if (ageDays <= 21) score += 1;

      return { mail: m, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return scored.map((s) => s.mail);
}

/** Every email address in From/To for a mail (used to list thread participants). */
function mailParticipants(mail) {
  return [...new Set([...addressesIn(mail.from), ...addressesIn(mail.to)])];
}

/** Strip reply/forward prefixes so "RE: X" and "FWD: X" group under the same thread. */
function normalizeSubject(subject = "") {
  return String(subject).replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "").trim().toLowerCase();
}

function fmtWhen(d) {
  const dt = d ? new Date(d) : null;
  return dt && !Number.isNaN(dt.getTime())
    ? dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "Not available in the related emails";
}

/** Escape text for safe placement inside the fallback HTML brief. */
function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const li = (label, value) => `<li><strong>${esc(label)}:</strong> ${esc(value)}</li>`;
const ul = (items) => `<ul>\n${items.join("\n")}\n</ul>`;
const ulPlain = (items) => ul(items.map((t) => `<li>${esc(t)}</li>`));

// Generic prep content by meeting subject area, matched against the title.
// Used only to suggest what a leader should THINK about — never presented as
// a confirmed fact about this specific meeting.
const TOPIC_PLAYBOOKS = [
  {
    match: /production|manufactur|batch|plant|shop\s*floor/i,
    objective: "a review of production status and open manufacturing issues",
    discussion: [
      "Current production status", "Planned versus actual output", "Production delays or downtime",
      "Material availability", "Quality issues or rejected batches", "Equipment or maintenance problems",
      "Staffing constraints", "Regulatory or safety concerns", "Pending approvals", "Production plan for the next period",
    ],
    prepare: [
      "Latest production report", "Planned versus actual production figures", "Batch status",
      "Downtime report", "Quality deviation report", "Inventory and raw-material availability",
      "Pending CAPA items", "Maintenance status", "Delivery commitments",
    ],
    questions: [
      "Is production currently on schedule?", "Are any batches delayed, blocked or rejected?",
      "Are there material shortages?", "Are there unresolved quality deviations?",
      "Is any equipment affecting output?", "Which actions require management approval?",
      "What are the priorities before the next review?",
    ],
  },
  {
    match: /audit|inspection|regulatory|compliance|fda|capa/i,
    objective: "a compliance or audit readiness review",
    discussion: [
      "Open findings and their remediation status", "Documentation and record readiness",
      "Outstanding CAPA items", "Areas of known risk or non-conformance", "Roles and responsibilities during the audit",
    ],
    prepare: [
      "Latest CAPA tracker", "Relevant SOPs and records", "Previous audit findings and closures", "Training/compliance records",
    ],
    questions: [
      "Are all CAPA items on track?", "Which findings from the last audit are still open?",
      "Is documentation audit-ready?", "Who owns each area under review?",
    ],
  },
  {
    match: /sales|client|customer|deal|proposal|renewal|contract/i,
    objective: "a sales or account/client review",
    discussion: [
      "Deal or account status", "Open commercial terms", "Client concerns or blockers",
      "Competitive context", "Next steps and timeline",
    ],
    prepare: [
      "Latest account/deal summary", "Pricing or proposal documents", "Prior correspondence with the client", "Contract or renewal terms",
    ],
    questions: [
      "What is blocking this deal from progressing?", "What does the client need from us next?",
      "Are there commercial terms requiring approval?",
    ],
  },
];

const DEFAULT_PLAYBOOK = {
  objective: "a working session or status review",
  discussion: [
    "Current status relevant to the meeting topic", "Open issues or blockers", "Decisions the group needs to make",
    "Ownership of pending items", "Timeline and next steps",
  ],
  prepare: ["Latest status update", "Any open items or documents referenced in the invite"],
  questions: ["What is the current status?", "What decisions need to be made in this meeting?", "What is blocking progress?"],
};

function playbookFor(title = "") {
  return TOPIC_PLAYBOOKS.find((p) => p.match.test(title)) || DEFAULT_PLAYBOOK;
}

/**
 * Rich fallback for a meeting with NO related email history at all (no
 * candidate mail matched participants/topics). Never a bare "no context"
 * message — always a usable, clearly-labelled preparation brief built only
 * from the calendar event details plus generic, subject-area prompts.
 */
export function noContextFallbackHtml(meeting) {
  const playbook = playbookFor(meeting.title || "");
  return [
    "<h1>Pre-Meeting Brief</h1>",
    "<h2>Meeting</h2>",
    ul([
      li("Title", meeting.title || "(untitled meeting)"),
      li("Date and time", meeting.whenText || (meeting.when ? fmtWhen(meeting.when) : "Not available in the related emails")),
      li("Organizer", meeting.organizer || "Not available in the related emails"),
      li("Attendees", (meeting.participants || []).join(", ") || "Not available in the related emails"),
      li("Location or link", meeting.location || "Not available in the related emails"),
    ]),
    "<h2>Available Context</h2>",
    "<p>No previous email thread, decision, action item or meeting history was found for this meeting.</p>",
    "<h2>Likely Meeting Objective</h2>",
    `<p>This appears to be ${esc(playbook.objective)}. <em>Inferred from the meeting title.</em></p>`,
    "<h2>Suggested Discussion Points</h2>",
    ulPlain(playbook.discussion),
    "<h2>Information to Prepare</h2>",
    ulPlain(playbook.prepare),
    "<h2>Questions to Raise</h2>",
    ulPlain(playbook.questions),
    "<h2>Expected Outcomes</h2>",
    ulPlain([
      "Confirm the current position", "Identify major risks and blockers",
      "Assign owners for pending actions", "Confirm deadlines", "Agree on next priorities",
    ]),
    "<h2>Context Status</h2>",
    "<p>No matching previous emails were found. This brief was generated from the calendar event details only.</p>",
  ].join("\n");
}

/**
 * Deterministic fallback brief (no AI): groups the already meeting-filtered
 * candidate emails into threads and fills in only what can be read directly
 * off the stored mail — never a generic inbox/keyword triage. Same HTML
 * structure the AI path produces, so the client renders both identically.
 */
export function fallbackPreMeetingHtml(meeting, mails = []) {
  const parts = [
    "<h1>Pre-Meeting Brief</h1>",
    "<p><em>AI analysis is temporarily unavailable. This brief was generated using meeting-linked email matching.</em></p>",
    "<h2>Meeting</h2>",
    ul([
      li("Title", meeting.title || "(untitled meeting)"),
      li("Date and time", meeting.whenText || (meeting.when ? fmtWhen(meeting.when) : "Not available in the related emails")),
      li("Organizer", meeting.organizer || "Not available in the related emails"),
      li("Attendees", (meeting.participants || []).join(", ") || "Not available in the related emails"),
      li("Location or link", meeting.location || "Not available in the related emails"),
    ]),
    "<h2>Meeting Objective</h2>",
    `<p>${esc(meeting.description ? meeting.description.slice(0, 400) : "Not available in the related emails")}</p>`,
    "<h2>Executive Summary</h2>",
    `<p>${esc(mails.length
      ? `${mails.length} email thread(s) linked to this meeting by participant and topic matching.`
      : "No related emails were found for this meeting.")}</p>`,
    "<h2>Relevant Email Threads</h2>",
  ];

  if (!mails.length) {
    parts.push("<p>Not available in the related emails.</p>");
  } else {
    const groups = new Map();
    mails.forEach((m) => {
      const key = m.threadId || normalizeSubject(m.subject);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    [...groups.values()].forEach((items, i) => {
      items.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
      const latest = items[0];
      const people = [...new Set(items.flatMap(mailParticipants))];
      parts.push(
        `<h3>${i + 1}. ${esc(latest.subject || "(no subject)")}</h3>`,
        ul([
          li("Latest update", textOf(latest.body || latest.snippet || "").slice(0, 200) || "Not available in the related emails"),
          li("Participants", people.join(", ") || "Not available in the related emails"),
          li("Current status", latest.isRepliedMail ? "Replied" : "Awaiting response"),
          li("Pending response or action", "Not available in the related emails"),
        ]),
      );
    });
  }

  parts.push(
    "<h2>Key Discussion Points</h2>",
    (meeting.topics || []).length
      ? ul(meeting.topics.slice(0, 8).map((t) => `<li>${esc(t)}</li>`))
      : "<p>Not available in the related emails.</p>",
    "<h2>Previous Decisions</h2>",
    "<ul><li>No previous decisions found</li></ul>",
    "<h2>Pending Actions</h2>",
    "<p>Not available in the related emails.</p>",
    "<h2>Risks and Blockers</h2>",
    "<p>Not available in the related emails.</p>",
    "<h2>Questions to Raise</h2>",
    "<p>Not available in the related emails.</p>",
    "<h2>Suggested Preparation</h2>",
    "<p>Not available in the related emails.</p>",
    "<h2>Required Outcomes</h2>",
    "<p>Not available in the related emails.</p>",
  );

  return parts.join("\n");
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

    // Idempotent per (email, invite) unless forced. A cached brief with no
    // meeting time is regenerated when the parser can now resolve one (heals
    // briefs stored before natural-language date parsing existed).
    if (!opts.force) {
      const existing = await PreMeetingBrief.findOne({
        email, meetingSourceId: details.meetingSourceId, active: true,
      }).lean();
      if (existing && !(details.when && !existing.meetingWhen)) return existing;
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

  // 2) Topics/keywords via the shared AI provider — used only to widen candidate
  // email retrieval, never shown to the reader as inbox stats.
  const topicResult = await generateMeetingTopics(details);
  details.topics = topicResult.topics;

  // 3) Retrieve emails ACTUALLY tied to this meeting (participants/topic hits
  // only — see retrieveCandidateEmails) from the already-analyzed collection.
  const candidateMails = await retrieveCandidateEmails(email, details, topicResult.all);
  const promptEmails = candidateMails.map((m) => ({
    sourceId: m.providerMessageId || String(m._id),
    threadId: m.threadId || "",
    subject: m.subject || "",
    from: m.from || "",
    to: m.to || "",
    receivedAt: m.receivedAt,
    body: m.body || m.snippet || "",
  }));

  // 4) Generate the HTML brief. Skip the AI call entirely when nothing
  // relevant was found — build a useful brief from the calendar event alone
  // instead (never a bare "no context" message).
  let briefHtml;
  let source;
  if (!promptEmails.length) {
    briefHtml = noContextFallbackHtml(details);
    source = "sample";
  } else {
    try {
      const messages = buildPreMeetingBriefPrompt(details, promptEmails);
      const text = await aiClient.chatCompletion(messages);
      // Strip an accidental ```html fence — the prompt forbids it, but local
      // models sometimes add one anyway.
      const cleaned = String(text || "").trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
      if (!cleaned) throw new Error("empty AI response");
      briefHtml = cleaned;
      source = "live";
    } catch (err) {
      console.error("[PreMeeting] Brief AI unavailable, using deterministic fallback:", err.message);
      briefHtml = fallbackPreMeetingHtml(details, candidateMails);
      source = "sample";
    }
  }

  // 5) Persist (upsert per invite; always insert for manual entries).
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
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
  doc.candidateCount = promptEmails.length;
  doc.briefHtml = briefHtml;
  doc.source = source;
  doc.generatedAt = new Date();
  doc.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  doc.active = true;

  return PreMeetingBrief.saveData(doc);
}

export default {
  extractMeetingDetails,
  generateMeetingTopics,
  retrieveCandidateEmails,
  generatePreMeetingBrief,
};
