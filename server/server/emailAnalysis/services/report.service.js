/**@Report service - builds + stores a brief from synced mail */
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import EmailAnalysisReport from "../models/emailAnalysisReport.model";
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import OutlookUser from "../../microsoft/models/outlookUser.model";
import MicrosoftUser from "../../microsoft/models/microsoftUser.model";
import MicrosoftTeamsService from "../../microsoft/services/microsoftTeams.service";
import { createMailService } from "./mailProvider.service";
import prioritizeService from "./prioritize.service";
import { generateBrief } from "./briefEngine";
import { getActiveKnowledgeBaseConfig } from "./knowledgeBase.service";
import { getReportConfig } from "./reportConfig.service";
import { generatePreMeetingBrief } from "./preMeetingBrief.service";

const DAY_MS = 24 * 60 * 60 * 1000;

// Same "is this a meeting, not just a deadline/shipment?" check the client
// uses to decide which events get an info button (BriefDashboard.jsx).
const MEETING_TYPE_RE = /meeting|call|sync|standup|stand-up|1:1|one-on-one|interview|demo|review|webinar|discussion|catch-?up/i;

/**
 * Pre-generate (and cache) the pre-meeting brief for every meeting-like event
 * in this report, right when the report itself is built — so opening the
 * "Pre-meeting brief" info button later is an instant read instead of
 * triggering a fresh AI call. Best-effort per event: one failure must not
 * fail the whole report.
 */
async function preGenerateMeetingBriefs(email, brief) {
  const meetingEvents = (brief?.events || [])
    .filter((e) => e?.sourceId && MEETING_TYPE_RE.test(`${e.type || ""} ${e.title || ""}`));
  if (!meetingEvents.length) return;
  await Promise.all(meetingEvents.map((e) =>
    generatePreMeetingBrief(email, { meetingSourceId: e.sourceId }).catch((err) =>
      console.error("[PreMeeting] pre-generate failed for", e.sourceId, err.message))));
}

/**
 * Best-effort: post the freshly generated brief to the connected Microsoft
 * Teams channel. ALWAYS logs whether the message was sent or not, and never
 * throws — a delivery problem must not break report generation.
 * @returns {Promise<boolean>} true if a Teams message was sent
 */
async function deliverBriefToTeams(report) {
  try {
    const msUser = await MicrosoftUser.findOne({ active: true }).sort({ updatedAt: -1 });
    if (!msUser) {
      console.log("[Teams] Brief NOT sent — no Microsoft account connected.");
      return false;
    }
    if (!msUser.defaultTeamId || !msUser.defaultChannelId) {
      console.log(`[Teams] Brief NOT sent — no default Teams channel configured for ${msUser.email}.`);
      return false;
    }

    const c = report.counts || {};
    const risks = (report.brief?.risks || [])
      .slice(0, 5)
      .map((r) => `<li>${r.title || r.headline || r.summary || "Risk"}</li>`)
      .join("");
    const message =
      `<h3>Operations brief — ${report.periodLabel || ""}</h3>` +
      `<p><b>${c.critical || 0}</b> critical · <b>${c.decisions || 0}</b> decisions · ` +
      `<b>${c.risks || 0}</b> risks · <b>${c.actions || 0}</b> actions</p>` +
      (risks ? `<p><b>Top risks</b></p><ul>${risks}</ul>` : "");

    const service = new MicrosoftTeamsService(msUser.email);
    const sent = await service.sendChannelMessage({
      teamId: msUser.defaultTeamId,
      channelId: msUser.defaultChannelId,
      message,
    });
    console.log(`[Teams] Brief SENT to channel for ${msUser.email} — messageId=${sent.id}`);
    return true;
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err.message;
    console.log(`[Teams] Brief NOT sent — send failed: ${detail}`);
    return false;
  }
}

/** Start/end of the calendar day that `date` falls in. */
function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end };
}

function dayLabel(date) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Start of the ISO week (Monday 00:00) that `date` falls in. */
function weekStartOf(date) {
  const x = new Date(date);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

function weekLabel(start) {
  return `Week of ${new Date(start).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Convenience counters from a brief. */
function briefCounts(brief) {
  return {
    critical: (brief.triage || []).filter((t) => t.tier === "Critical").length,
    decisions: (brief.decisionQueue || []).length,
    risks: (brief.risks || []).length,
    actions: (brief.actions || []).length,
  };
}

/** Map a stored mail doc to the engine's email shape (see CONTRACT.md). */
export function toEmailShape(mail) {
  return {
    id: mail.providerMessageId || String(mail._id),
    from: mail.from || "",
    subject: mail.subject || "",
    body: mail.body || mail.snippet || "",
    receivedAt: mail.receivedAt,
    labels: mail.labels || [],
    hasAttachments: !!mail.hasAttachments || (mail.attachments || []).length > 0,
    isRepliedMail: !!mail.isRepliedMail,
    isJunk: !!mail.isJunk,
    sourceFolder: mail.sourceFolder || "inbox",
    category: mail.category || "",
    priority: mail.priority || "",
    priorityScore: mail.priorityScore || null,
    intent: mail.intent || "",
    priorityReason: mail.priorityReason || "",
  };
}

/**
 * Attach each mail's stored AI category to its triage item (matched by
 * sourceId), so the report UI can group a sender's mails per category without
 * relying on the brief AI to echo it back.
 */
function attachMailCategories(brief, mails) {
  if (!brief) return brief;
  const catById = new Map(
    mails.map((m) => [String(m.providerMessageId || m._id), m.category || ""])
  );
  for (const t of brief.triage || []) {
    if (!t.category) t.category = catById.get(String(t.sourceId)) || "";
  }
  return brief;
}

// Categories that already carry the meaning of "to-do" / "event" — no extra
// AI call needed, the sync-time category (prioritize.service.js) is enough.
const ACTION_CATEGORIES = ["Action Required"];
const EVENT_CATEGORIES = ["Meetings & Scheduling"];

const TIME_RE = /\b(\d{1,2}(:\d{2})?\s?(am|pm))\b/i;
const RELATIVE_DAY_RE = /\b(today|tomorrow|yesterday)\b/i;
const MONTH_DAY_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
// A single am/pm clock time, e.g. "9am", "2:30 pm".
const CLOCK_RE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i;
// A single 24-hour time, e.g. "14:00". Minutes required to avoid matching bare numbers.
const CLOCK24_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
// A start–end range with am/pm, e.g. "3-4pm", "3:00 PM - 4:30 PM", "3 to 4 pm".
// The start meridiem is optional and inherited from the end when omitted.
const RANGE_RE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s?(?:-|–|—|to)\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i;
// A 24-hour start–end range, e.g. "14:00-15:30".
const RANGE24_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\s?(?:-|–|—|to)\s?([01]?\d|2[0-3]):([0-5]\d)\b/;

// When an email states a start but no end, assume a standard slot length.
const DEFAULT_MEETING_MS = 60 * 60 * 1000; // 1 hour
// Two meetings this close (one ending, the next starting) leave no transition
// time — flagged as a softer "tight turnaround" rather than a hard clash.
const BACK_TO_BACK_MS = 15 * 60 * 1000; // 15 minutes

/** Format a Date as a short clock label, e.g. "9:00 AM". */
function fmtClock(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Serialize a Date as a timezone-less local datetime ("2026-07-08T19:00:00").
 * Meeting times are wall-clock (a "7pm IST" invite should read 7pm everywhere),
 * so we deliberately omit the "Z"/offset — the client re-parses it as local and
 * the wall-clock value is preserved regardless of server/viewer timezone.
 */
function toLocalIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Turn a matched hour/minute/meridiem into 24-hour parts. */
function toHourMin(hourStr, minStr, meridiem) {
  let hour = parseInt(hourStr, 10);
  const min = minStr ? parseInt(minStr, 10) : 0;
  if (meridiem) {
    hour %= 12;
    if (/pm/i.test(meridiem)) hour += 12;
  }
  return { hour, min };
}

/** Plain-code guess at a "when" string from subject/body — no AI involved. */
function extractWhen(mail) {
  const hay = `${mail.subject || ""} ${String(mail.body || mail.snippet || "").slice(0, 300)}`;
  const day = hay.match(RELATIVE_DAY_RE)?.[1];
  const monthDay = hay.match(MONTH_DAY_RE)?.[0];
  // Prefer a full range so the end time survives for accurate overlap checks;
  // fall back to a single start time (am/pm, then 24-hour).
  const time =
    hay.match(RANGE_RE)?.[0] ||
    hay.match(RANGE24_RE)?.[0] ||
    hay.match(TIME_RE)?.[1] ||
    hay.match(CLOCK24_RE)?.[0];
  const dayPart = day ? day[0].toUpperCase() + day.slice(1) : monthDay || "";
  if (dayPart && time) return `${dayPart} ${time}`;
  if (time) return time;
  if (dayPart) return dayPart;
  return mail.receivedAt ? new Date(mail.receivedAt).toDateString() : "";
}

/**
 * Resolve a "when" string into a concrete meeting interval { start, end } and
 * report whether a real clock time was found. Times are pinned explicitly
 * (native Date can't parse "Wed 9:00"), so collision detection can tell an
 * actual timed meeting apart from a day-only guess and compare true intervals.
 *
 * Returns { start: Date, end: Date, hasTime: boolean, hasEnd: boolean }.
 *  - hasTime true  → start carries a real hour/minute; safe to compare overlaps.
 *  - hasEnd  true  → end came from an explicit range; otherwise it is a default
 *                    1-hour slot after start.
 *  - hasTime false → only the day is known; start is midnight of that day.
 */
function resolveWhenMoment(whenText, receivedAt) {
  const anchor = receivedAt ? new Date(receivedAt) : new Date();
  const text = String(whenText || "").trim();
  const dayOnlyResult = (day, hasTime) => ({
    start: day,
    end: new Date(day.getTime() + DEFAULT_MEETING_MS),
    hasTime,
    hasEnd: false,
  });
  if (!text) return dayOnlyResult(anchor, false);

  // Substitute relative words with concrete dates, then strip every time token
  // so the remainder parses cleanly as a calendar day.
  const dayText = text
    .replace(/\btoday\b/i, anchor.toDateString())
    .replace(/\btomorrow\b/i, new Date(anchor.getTime() + DAY_MS).toDateString())
    .replace(/\byesterday\b/i, new Date(anchor.getTime() - DAY_MS).toDateString());
  const dayOnly = dayText
    .replace(RANGE_RE, "")
    .replace(RANGE24_RE, "")
    .replace(CLOCK_RE, "")
    .replace(CLOCK24_RE, "")
    .trim();
  let day = new Date(dayOnly);
  if (Number.isNaN(day.getTime())) {
    // No parseable day (e.g. "9am" alone) → anchor on the email's own day.
    day = new Date(anchor);
  } else if (!/\b\d{4}\b/.test(dayOnly)) {
    // A bare month/day like "Jul 08" parses to year 2001 in V8 (no year given).
    // Anchor the year on the email's own date so the meeting lands in the right one.
    day.setFullYear(anchor.getFullYear());
  }
  day.setHours(0, 0, 0, 0);
  const at = (hour, min) => {
    const d = new Date(day);
    d.setHours(hour, min, 0, 0);
    return d;
  };

  // 1) explicit am/pm range — most informative. Start meridiem inherits end's.
  let m = text.match(RANGE_RE);
  if (m) {
    const endMer = m[6];
    const s = toHourMin(m[1], m[2], m[3] || endMer);
    const e = toHourMin(m[4], m[5], endMer);
    const start = at(s.hour, s.min);
    let end = at(e.hour, e.min);
    if (end <= start) end = new Date(end.getTime() + DAY_MS); // spans midnight
    return { start, end, hasTime: true, hasEnd: true };
  }
  // 2) explicit 24-hour range
  m = text.match(RANGE24_RE);
  if (m) {
    const start = at(parseInt(m[1], 10), parseInt(m[2], 10));
    let end = at(parseInt(m[3], 10), parseInt(m[4], 10));
    if (end <= start) end = new Date(end.getTime() + DAY_MS);
    return { start, end, hasTime: true, hasEnd: true };
  }
  // 3) single am/pm time — default 1-hour slot
  m = text.match(CLOCK_RE);
  if (m) {
    const { hour, min } = toHourMin(m[1], m[2], m[3]);
    const start = at(hour, min);
    return { start, end: new Date(start.getTime() + DEFAULT_MEETING_MS), hasTime: true, hasEnd: false };
  }
  // 4) single 24-hour time — default 1-hour slot
  m = text.match(CLOCK24_RE);
  if (m) {
    const start = at(parseInt(m[1], 10), parseInt(m[2], 10));
    return { start, end: new Date(start.getTime() + DEFAULT_MEETING_MS), hasTime: true, hasEnd: false };
  }
  // Day only.
  return dayOnlyResult(day, false);
}

/**
 * Build the to-do list straight from mails already categorized "Action
 * Required" at sync time (prioritize.service.js) — plain code, no AI call.
 */
function buildTodoListFromMails(mails) {
  return mails
    .filter((m) => ACTION_CATEGORIES.includes(m.category))
    .map((m) => ({
      task: m.subject || "(no subject)",
      deadline: "",
      status: "Open",
      sourceId: m.providerMessageId || String(m._id),
    }));
}

/**
 * Build the events list straight from mails already categorized "Meetings &
 * Scheduling" at sync time — plain code, no AI call.
 */
function buildEventsFromMails(mails) {
  return mails
    .filter((m) => EVENT_CATEGORIES.includes(m.category))
    .map((m) => {
      const when = extractWhen(m);
      // Resolve the date server-side (year-anchored, ranges, relative words) and
      // attach it so the client can render without re-parsing the raw string.
      const { start, end, hasTime, hasEnd } = resolveWhenMoment(when, m.receivedAt);
      return {
        title: m.subject || "(no subject)",
        when,
        start: when ? toLocalIso(start) : null,
        end: hasEnd ? toLocalIso(end) : null,
        hasTime,
        type: "meeting",
        owner: "",
        sourceId: m.providerMessageId || String(m._id),
      };
    });
}

// Severity ranking so the most urgent clashes surface first.
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/** Two meeting intervals overlap iff each starts before the other ends. */
function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** True when one interval sits entirely inside the other. */
function intervalContains(a, b) {
  return (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
}

/** Normalized title for detecting duplicate invites (same slot, same subject). */
function normTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\b(re|fwd|fw)\b[:\s]*/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Short label for a meeting slot in a reason line. */
function slotLabel(x) {
  if (!x.hasTime) return "time TBD";
  return x.hasEnd ? `${fmtClock(x.start)}–${fmtClock(x.end)}` : `${fmtClock(x.start)} (~1h)`;
}

/**
 * Detect schedule collisions from the events built above.
 *
 * Each meeting is modeled as an interval [start, end]. The end comes from an
 * explicit range in the email ("3-4pm") when present; otherwise it defaults to
 * a 1-hour slot (DEFAULT_MEETING_MS). Within a single day we classify:
 *
 *   high — Conflict:  two intervals overlap (startA < endB && startB < endA).
 *   high — Contained: one meeting sits entirely inside another.
 *   high — Duplicate: overlapping AND near-identical subject (double invite).
 *   medium — Tight:   0–15 min gap between one ending and the next starting.
 *   low  — Busy day:  3+ events on a day; a load roll-up listing each slot.
 *
 * Every collision carries a `severity` and a detailed `reason`. A day-only
 * event (no clock time) can't be compared for overlap, so it only feeds the
 * busy-day roll-up. Results are sorted high -> low.
 */
function detectCollisionsFromEvents(events, mails) {
  const receivedById = new Map(mails.map((m) => [String(m.providerMessageId || m._id), m.receivedAt]));
  const withMoments = events.map((e) => {
    // Prefer the date already resolved on the event (buildEventsFromMails) so
    // collisions and the events list agree; fall back for LLM-derived events.
    const preStart = e.start ? new Date(e.start) : null;
    if (preStart && !Number.isNaN(preStart.getTime())) {
      const end = e.end ? new Date(e.end) : new Date(preStart.getTime() + DEFAULT_MEETING_MS);
      return { e, start: preStart, end, hasTime: !!e.hasTime, hasEnd: !!e.end };
    }
    const { start, end, hasTime, hasEnd } = resolveWhenMoment(e.when, receivedById.get(e.sourceId));
    return { e, start, end, hasTime, hasEnd };
  });

  const byDay = new Map();
  for (const entry of withMoments) {
    const dayKey = entry.start.toDateString();
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(entry);
  }

  const collisions = [];
  for (const [dayKey, entries] of byDay) {
    if (entries.length < 2) continue;

    const timed = entries
      .filter((x) => x.hasTime)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // All-pairs overlap detection (Conflict / Contained / Duplicate).
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i];
        const b = timed[j];
        // Sorted by start, so once b starts at/after a ends, no later b overlaps a.
        if (b.start >= a.end) break;
        if (!intervalsOverlap(a, b)) continue;

        const overlapMs = Math.min(a.end, b.end) - Math.max(a.start, b.start);
        const overlapMin = Math.max(1, Math.round(overlapMs / 60000));
        const window = `${dayKey} · ${fmtClock(a.start)}–${fmtClock(a.end)} vs ${fmtClock(b.start)}–${fmtClock(b.end)}`;

        if (normTitle(a.e.title) && normTitle(a.e.title) === normTitle(b.e.title)) {
          collisions.push({
            type: "Meeting",
            severity: "high",
            summary: `Possible duplicate: "${a.e.title}" is booked twice`,
            reason:
              `Two meetings with the same subject overlap on ${dayKey} ` +
              `(${slotLabel(a)} and ${slotLabel(b)}). This is likely a duplicate or double invite.`,
            when: window,
            items: [a.e.sourceId, b.e.sourceId],
            suggestion: "Confirm these are the same meeting and drop the duplicate.",
          });
        } else if (intervalContains(a, b)) {
          const [outer, inner] = a.end - a.start >= b.end - b.start ? [a, b] : [b, a];
          collisions.push({
            type: "Meeting",
            severity: "high",
            summary: `Time clash: "${inner.e.title}" falls inside "${outer.e.title}"`,
            reason:
              `"${outer.e.title}" runs ${slotLabel(outer)} and "${inner.e.title}" (${slotLabel(inner)}) ` +
              `sits entirely within it — you'd be double-booked the whole time.`,
            when: window,
            items: [a.e.sourceId, b.e.sourceId],
            suggestion: `Move "${inner.e.title}" out of the "${outer.e.title}" window, or decline one.`,
          });
        } else {
          collisions.push({
            type: "Meeting",
            severity: "high",
            summary: `Time clash: "${a.e.title}" overlaps "${b.e.title}"`,
            reason:
              `"${a.e.title}" runs ${slotLabel(a)} and "${b.e.title}" runs ${slotLabel(b)} — ` +
              `they overlap by ${overlapMin} min, so both need you at the same time.`,
            when: window,
            items: [a.e.sourceId, b.e.sourceId],
            suggestion: `Move "${b.e.title}" to after ${fmtClock(a.end)}, or shorten/decline one of them.`,
          });
        }
      }
    }

    // Adjacent tight turnarounds (no buffer), only where the pair doesn't overlap.
    for (let i = 0; i < timed.length - 1; i++) {
      const a = timed[i];
      const b = timed[i + 1];
      if (intervalsOverlap(a, b)) continue;
      const gap = b.start - a.end;
      if (gap >= 0 && gap <= BACK_TO_BACK_MS) {
        const gapMin = Math.round(gap / 60000);
        collisions.push({
          type: "Meeting",
          severity: "medium",
          summary: `Tight turnaround: "${a.e.title}" → "${b.e.title}"`,
          reason:
            `"${a.e.title}" ends around ${fmtClock(a.end)} and "${b.e.title}" starts at ` +
            `${fmtClock(b.start)} — only ${gapMin} min between them, leaving no transition time.`,
          when: `${dayKey} · ${fmtClock(a.start)}–${fmtClock(a.end)} then ${fmtClock(b.start)}`,
          items: [a.e.sourceId, b.e.sourceId],
          suggestion: "Add a buffer between the two, or confirm you can switch over immediately.",
        });
      }
    }

    // Same-day crowding — a load roll-up listing each slot, even when nothing clashes.
    if (entries.length >= 3) {
      const ordered = [...entries].sort(
        (a, b) => (a.hasTime ? a.start : Infinity) - (b.hasTime ? b.start : Infinity)
      );
      // Per-meeting breakdown: what it is, when, and how it's affected.
      const slots = ordered.map((x) => {
        let status = "clear"; // has a time and doesn't overlap anything
        if (!x.hasTime) status = "untimed"; // no stated time — can't compare
        else if (ordered.some((o) => o !== x && o.hasTime && intervalsOverlap(x, o))) {
          status = "overlap"; // clashes with another timed meeting (see HIGH cards)
        }
        return {
          time: x.hasTime ? (x.hasEnd ? `${fmtClock(x.start)}–${fmtClock(x.end)}` : `${fmtClock(x.start)} (~1h)`) : null,
          title: x.e.title,
          status,
          sourceId: x.e.sourceId,
        };
      });
      const untimed = slots.filter((s) => s.status === "untimed").length;
      const clashing = slots.filter((s) => s.status === "overlap").length;
      collisions.push({
        type: "Meeting",
        severity: "low",
        summary: `${entries.length} meetings/events land on the same day`,
        reason: `${entries.length} items are scheduled on ${dayKey}.`,
        slots,
        note:
          (clashing ? `${clashing} directly clash (flagged above). ` : "") +
          (untimed ? `${untimed} ${untimed === 1 ? "has" : "have"} no stated time, so ${untimed === 1 ? "its overlap" : "their overlaps"} can't be confirmed automatically.` : ""),
        when: dayKey,
        items: entries.map((x) => x.e.sourceId),
        suggestion: "Review and reschedule lower-priority items to spread the load.",
      });
    }
  }

  collisions.sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  );
  return collisions;
}

/**
 * Drop todo items sourced from meeting/scheduling emails — meetings belong in
 * events, not the to-do list. Catches LLM-derived items the prompt missed.
 */
function stripMeetingTodos(brief, mails) {
  if (!brief?.todoList?.length) return brief;
  const meetingIds = new Set(
    mails
      .filter((m) => EVENT_CATEGORIES.includes(m.category))
      .map((m) => String(m.providerMessageId || m._id))
  );
  brief.todoList = brief.todoList.filter((t) => !meetingIds.has(String(t.sourceId || "")));
  return brief;
}

/** Dedup key for todo/event items so code-derived and LLM-derived entries don't double up. */
function itemKey(x) {
  return `${x.sourceId}|${(x.task || x.title || "").toLowerCase()}`;
}

/** Merge code-derived to-do items into brief.todoList, deduping by sourceId+task. */
function mergeTodoList(brief, todos) {
  if (!brief || !todos?.length) return brief;
  const existing = new Set((brief.todoList || []).map(itemKey));
  const fresh = todos.filter((t) => !existing.has(itemKey(t)));
  brief.todoList = [...(brief.todoList || []), ...fresh];
  return brief;
}

/** Merge code-derived events into brief.events, deduping by sourceId+title. */
function mergeEvents(brief, events) {
  if (!brief || !events?.length) return brief;
  const existing = new Set((brief.events || []).map(itemKey));
  const fresh = events.filter((e) => !existing.has(itemKey(e)));
  brief.events = [...(brief.events || []), ...fresh];
  return brief;
}

/** Merge code-derived collisions into brief.collisions, deduping by when+items. */
function mergeCollisions(brief, collisions) {
  if (!brief || !collisions?.length) return brief;
  const existing = new Set(
    (brief.collisions || []).map((c) => `${c.when}|${[...(c.items || [])].sort().join(",")}`)
  );
  const fresh = collisions.filter((c) => !existing.has(`${c.when}|${[...(c.items || [])].sort().join(",")}`));
  brief.collisions = [...(brief.collisions || []), ...fresh];
  // Keep the most urgent clashes first regardless of source (code vs LLM).
  // LLM-derived collisions carry no severity, so they sort after the code ones.
  brief.collisions.sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  );
  return brief;
}

/**
 * Resolve which day to report on. Defaults to the most recent day that has
 * mail for this account ("the last day"), so the first report after the
 * initial sync covers the newest day of email.
 */
async function resolveTargetDay(email, explicitDate) {
  if (explicitDate) return new Date(explicitDate);
  const latest = await EmailAnalysisMail.findOne({ email, active: true })
    .sort({ receivedAt: -1 })
    .select("receivedAt")
    .lean();
  return latest?.receivedAt ? new Date(latest.receivedAt) : new Date();
}

/**
 * Generate (and store) the day-wise brief for a connected account.
 * Reuses yesterday's report risks for trend. Idempotent per (email, day):
 * regenerating overwrites the stored report for that day.
 *
 * @param {string} email
 * @param {Object} opts - { date?: ISO|Date, force?: boolean }
 * @returns {Promise<EmailAnalysisReport>}
 */
export async function generateDailyReport(email, opts = {}) {
  if (!email) throw new Error("email is required to generate a report");

  const targetDay = await resolveTargetDay(email, opts.date);
  const { start, end } = dayBounds(targetDay);

  // Return the existing report unless a fresh run is requested.
  if (!opts.force) {
    const existing = await EmailAnalysisReport.findOne({ email, reportType: "day", periodStart: start });
    if (existing) return existing;
  }

  // Brief covers INCOMING mail only: the user's own sent replies and drafts
  // are excluded, while junk/spam stays in so nothing important is missed.
  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
    sourceFolder: { $nin: ["sent", "draft"] },
  }).sort({ receivedAt: 1 }).lean();

  const emails = mails.map(toEmailShape);

  // Yesterday's risks (previous day's report) drive the trend field.
  const prevReport = await EmailAnalysisReport.findOne({
    email,
    reportType: "day",
    periodStart: { $lt: start },
  }).sort({ periodStart: -1 }).lean();
  const yesterdayRisks = prevReport?.brief?.risks || [];

  // Load KB config and report config for this account.
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
  const reportConfig = await getReportConfig(email);

  const { brief, source, matchedKeywordsSummary } = await generateBrief(emails, yesterdayRisks, {
    periodLabel: dayLabel(targetDay),
    knowledgeBaseConfig,
    reportConfig,
  });
  attachMailCategories(brief, mails);
  const codeTodos = buildTodoListFromMails(mails);
  const codeEvents = buildEventsFromMails(mails);
  mergeTodoList(brief, codeTodos);
  mergeEvents(brief, codeEvents);
  stripMeetingTodos(brief, mails);
  mergeCollisions(brief, detectCollisionsFromEvents(codeEvents, mails));
  await preGenerateMeetingBriefs(email, brief);

  const counts = briefCounts(brief);

  // Upsert the report for this (email, day).
  let report = await EmailAnalysisReport.findOne({ email, reportType: "day", periodStart: start });
  if (!report) report = new EmailAnalysisReport({ email, reportType: "day", periodStart: start });
  report.periodEnd = end;
  report.periodLabel = dayLabel(targetDay);
  report.brief = brief;
  report.source = source;
  report.generatedAt = new Date();
  report.counts = counts;
  report.active = true;

  // Store config snapshots and matched keywords summary for audit trail.
  report.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    filters: knowledgeBaseConfig.filters,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  report.reportConfigSnapshot = {
    reportName: reportConfig.reportName,
    enabledSections: reportConfig.enabledSections,
    selectedFields: reportConfig.selectedFields,
    rows: reportConfig.rows,
    outputStyle: reportConfig.outputStyle,
    promptInstruction: reportConfig.promptInstruction,
  };
  report.matchedKeywordsSummary = matchedKeywordsSummary;
  report.reportSectionsUsed = reportConfig.enabledSections || [];
  report.selectedFieldsUsed = reportConfig.selectedFields || [];

  const saved = await EmailAnalysisReport.saveData(report);

  // After the briefing is done, try to deliver it to Teams and log the result.
  await deliverBriefToTeams(saved);

  return saved;
}

/**
 * Generate (and store) the weekly rollup for an account.
 * Idempotent per (email, ISO week): once a week's report exists it is NOT
 * regenerated unless `force` is passed.
 *
 * @param {string} email
 * @param {Object} opts - { date?: ISO|Date (any day in the week), force?: boolean }
 * @returns {Promise<{ report: EmailAnalysisReport, created: boolean }>}
 */
export async function generateWeeklyReport(email, opts = {}) {
  if (!email) throw new Error("email is required to generate a weekly report");

  const base = opts.date ? new Date(opts.date) : new Date();
  const start = weekStartOf(base);
  const end = new Date(start.getTime() + 7 * DAY_MS);

  // Already generated for this week -> return it untouched (unless forced).
  const existing = await EmailAnalysisReport.findOne({ email, reportType: "week", periodStart: start });
  if (existing && !opts.force) {
    return { report: existing, created: false };
  }

  // Same scope as the daily brief: incoming mail only (junk/spam included),
  // never the user's own sent replies or drafts.
  const mails = await EmailAnalysisMail.find({
    email,
    active: true,
    receivedAt: { $gte: start, $lt: end },
    sourceFolder: { $nin: ["sent", "draft"] },
  }).sort({ receivedAt: 1 }).lean();

  const emails = mails.map(toEmailShape);

  // Previous week's risks drive the trend field.
  const prev = await EmailAnalysisReport.findOne({
    email, reportType: "week", periodStart: { $lt: start },
  }).sort({ periodStart: -1 }).lean();
  const prevRisks = prev?.brief?.risks || [];

  // Load KB config and report config for this account.
  const knowledgeBaseConfig = await getActiveKnowledgeBaseConfig(email);
  const reportConfig = await getReportConfig(email);

  const { brief, source, matchedKeywordsSummary } = await generateBrief(emails, prevRisks, {
    periodLabel: weekLabel(start),
    knowledgeBaseConfig,
    reportConfig,
  });
  attachMailCategories(brief, mails);
  const codeTodosWeek = buildTodoListFromMails(mails);
  const codeEventsWeek = buildEventsFromMails(mails);
  mergeTodoList(brief, codeTodosWeek);
  mergeEvents(brief, codeEventsWeek);
  stripMeetingTodos(brief, mails);
  mergeCollisions(brief, detectCollisionsFromEvents(codeEventsWeek, mails));
  await preGenerateMeetingBriefs(email, brief);

  let report = existing || new EmailAnalysisReport({ email, reportType: "week", periodStart: start });
  report.periodEnd = end;
  report.periodLabel = weekLabel(start);
  report.brief = brief;
  report.source = source;
  report.generatedAt = new Date();
  report.counts = briefCounts(brief);
  report.active = true;

  report.knowledgeBaseSnapshot = {
    keywords: knowledgeBaseConfig.keywords,
    filters: knowledgeBaseConfig.filters,
    thresholds: knowledgeBaseConfig.thresholds,
    glossary: knowledgeBaseConfig.glossary,
    promptInstruction: knowledgeBaseConfig.promptInstruction,
  };
  report.reportConfigSnapshot = {
    reportName: reportConfig.reportName,
    enabledSections: reportConfig.enabledSections,
    selectedFields: reportConfig.selectedFields,
    rows: reportConfig.rows,
    outputStyle: reportConfig.outputStyle,
    promptInstruction: reportConfig.promptInstruction,
  };
  report.matchedKeywordsSummary = matchedKeywordsSummary;
  report.reportSectionsUsed = reportConfig.enabledSections || [];
  report.selectedFieldsUsed = reportConfig.selectedFields || [];

  const saved = await EmailAnalysisReport.saveData(report);
  return { report: saved, created: true };
}

/**
 * Fire-and-forget helper for the connected account (most recent, if email
 * omitted). Used right after the initial sync.
 */
export async function generateReportForLatestAccount(email) {
  let target = email;
  if (!target) {
    // Check EmailAnalysisUser first, then fall back to OutlookUser
    const eaUser = await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean();
    target = eaUser?.email;
    if (!target) {
      const msUser = await OutlookUser.findOne({ active: true }).sort({ updatedAt: -1 }).lean();
      target = msUser?.email;
    }
  }
  if (!target) return null;
  return generateDailyReport(target, { force: true });
}

/**
 * Sync the account's mail (incremental/initial) and (re)prioritize it.
 * Best-effort: logs and swallows errors so a sync hiccup never blocks a brief.
 */
export async function syncAndPrioritize(email) {
  if (!email) return null;
  let result = null;
  try {
    const service = await createMailService(email);
    result = await service.syncForUser();
  } catch (err) {
    console.error(`[EmailAnalysis] Pre-brief sync failed for ${email}:`, err.message);
  }
  try {
    await prioritizeService.prioritizePendingForAccount(email);
  } catch (err) {
    console.error(`[EmailAnalysis] Pre-brief prioritize failed for ${email}:`, err.message);
  }
  return result;
}

/**
 * Run the daily brief WITH a fresh sync first, so a brief always reflects the
 * latest mail. "Whenever a brief runs, mail is synced."
 */
export async function generateDailyReportWithSync(email, opts = {}) {
  await syncAndPrioritize(email);
  return generateDailyReport(email, { force: true, ...opts });
}


export default {
  generateDailyReport,
  generateWeeklyReport,
  generateReportForLatestAccount,
  syncAndPrioritize,
  generateDailyReportWithSync,
};
