/**
 * Builds the single analysis prompt for the brief engine.
 * ALL analysis rules live here — do not scatter business logic elsewhere.
 *
 * @param {Array} emails           - mapped email shape: {id, from, subject, body, receivedAt, meetingTime?}
 * @param {Array} yesterdayRisks   - risks array from the previous report (for trend)
 * @param {Object} meta            - { periodLabel, knowledgeBaseConfig?, reportConfig? }
 * @returns {string} prompt
 */
export function buildBriefPrompt(emails = [], yesterdayRisks = [], meta = {}) {
  const periodLabel = meta.periodLabel || 'the latest day';
  const kb = meta.knowledgeBaseConfig || {};
  const rc = meta.reportConfig || {};

  // Trim bodies so the prompt stays within limits.
  const safeEmails = emails.map((e) => ({
    id: e.id,
    from: e.from || '',
    subject: e.subject || '',
    body: String(e.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
    receivedAt: e.receivedAt,
    meetingTime: e.meetingTime || null,
    category: e.category || '',
  }));

  // ---- Knowledge Base context ----
  const kbKeywords = kb.keywords || {};
  const criticalKw = (kbKeywords.critical || []).join(', ') || 'FDA, Form 483, OOS, recall, deviation, urgent, escalation';
  const importantKw = (kbKeywords.important || []).join(', ') || 'CAPA, audit, inspection, deadline, approval, review';
  const lowKw = (kbKeywords.low || []).join(', ') || 'FYI, newsletter, update, automated';

  const thresholds = kb.thresholds || {};
  const criticalScore = thresholds.criticalScore || 80;
  const elevatedScore = thresholds.elevatedScore || 50;
  const escalationScore = thresholds.escalationScore || 70;

  const glossary = kb.glossary || {};
  const glossaryLines = Object.entries(glossary)
    .map(([term, def]) => `  ${term}: ${def}`)
    .join('\n');
  const glossarySection = glossaryLines
    ? `\nDOMAIN GLOSSARY (use these definitions when you see these terms):\n${glossaryLines}\n`
    : '';

  const promptInstruction = kb.promptInstruction
    ? `\nEMAIL ANALYSIS INSTRUCTIONS FROM KNOWLEDGE BASE:\n${kb.promptInstruction}\nUse these instructions for classification, prioritization, risk scoring, routing, action extraction, and categorization. Do not treat these as report-layout requirements.\n`
    : '';

  // ---- Report config context ----
  // UI section keys -> JSON output keys the model must fill for that section.
  const SECTION_OUTPUT_KEYS = {
    narrativeSummary: ['narrative', 'narrativeKeyPoints'],
    inboxTriage: ['triage', 'categorySummaries'],
    decisionQueue: ['decisionQueue'],
    riskRadar: ['risks'],
    riskMatrix: ['risks'],
    todoList: ['todoList'],
    events: ['events'],
    calendarConflicts: ['collisions'],
    patterns: ['patterns'],
    actionRegister: ['actions'],
  };
  const enabledSections = Array.isArray(rc.enabledSections) && rc.enabledSections.length
    ? rc.enabledSections
    : null; // null = all sections enabled (default)
  const enabledOutputKeys = enabledSections
    ? [...new Set([
        ...enabledSections.flatMap((s) => SECTION_OUTPUT_KEYS[s] || []),
        'deadlines', // always extracted — feeds collisions and dated views
      ])]
    : null;
  const selectedFields = Array.isArray(rc.selectedFields) && rc.selectedFields.length
    ? rc.selectedFields
    : null;
  const outputStyle = rc.outputStyle || 'detailed';
  const reportPromptInstruction = String(rc.promptInstruction || '').trim();

  const sectionInstruction = enabledOutputKeys
    ? `\nREQUIRED OUTPUT KEYS — you MUST populate ALL of these JSON keys thoroughly (only keys NOT in this list may be left as empty arrays):
${enabledOutputKeys.map((k) => `  - ${k}`).join('\n')}\n`
    : '\nALL report sections are enabled: populate EVERY key in the output JSON thoroughly.\n';

  const fieldInstruction = selectedFields
    ? `\nSELECTED DETAIL FIELDS (include these fields in each item where applicable):
${selectedFields.map((f) => `  - ${f}`).join('\n')}\n`
    : '';

  const styleMap = {
    short: 'Be concise. Use short bullet points. Keep narrative under 60 words.',
    detailed: 'Be thorough. Include all context and details.',
    bullet: 'Use bullet points throughout. Minimize prose.',
    executive: 'Frame everything for a C-suite executive. Lead with business impact. Avoid jargon.',
    department: 'Organise items by department/category.',
    daily: 'Focus on today\'s actionable items only.',
    weekly: 'Provide week-over-week trend context.',
  };
  const styleGuide = styleMap[outputStyle] || styleMap.detailed;
  const reportInstruction = reportPromptInstruction
    ? `\nREPORT OUTPUT REQUIREMENT FROM REPORT CONFIGURATION:\n${reportPromptInstruction}\nUse this only to decide what should appear in the generated report: sections, detail level, UI emphasis, and any additional display requirement. Do not use it to change which emails are processed or how emails are categorized; Knowledge Base controls analysis. If the user asks to list events mentioned in emails, populate the "events" array with every meeting, audit, inspection, launch, deadline, travel, outage, shipment, release, campaign, or dated operational event found in the emails.\n`
    : '';

  return `You are the analysis engine for an AI Operations Command Center used by a senior operations leader (e.g. a VP or Director of Operations) in ANY industry — manufacturing, healthcare, finance, logistics, IT, retail, customer support, education, etc.
First INFER the recipient's sector and role from the inbox itself (senders, subjects, terminology), then turn the inbox below (covering ${periodLabel}) into a single structured "morning brief" framed for THAT sector. Do NOT assume a specific industry — adapt the categories, terminology and examples to whatever the emails are actually about.
${glossarySection}${promptInstruction}
OUTPUT STYLE: ${styleGuide}
${reportInstruction}
${sectionInstruction}${fieldInstruction}
CLASSIFICATION KEYWORDS:
- Critical keywords (treat emails containing these as Critical tier): ${criticalKw}
- Important keywords (treat emails containing these as Important tier): ${importantKw}
- Low priority keywords: ${lowKw}

RISK SCORE THRESHOLDS:
- Critical risk score >= ${criticalScore / 25} × 5 on the likelihood×impact scale (riskScore >= ${Math.round(criticalScore / 4)})
- Elevated risk score >= ${elevatedScore / 25} × 5 (riskScore >= ${Math.round(elevatedScore / 4)})
- Escalation threshold: riskScore >= ${Math.round(escalationScore / 4)} OR email contains escalation keywords

ANALYSIS RULES:
1. Triage EVERY email into "Critical", "Important", or "Low" with a one-line reason. Use the CLASSIFICATION KEYWORDS above as signals. Rank by severity × urgency: anything threatening safety, legal/regulatory/compliance, customers, or revenue ranks highest; pure cost items or routine FYI rank lowest. Also include the email's "subject", "from", and a "summary" (one complete, well-formed sentence explaining what the email is actually about and why it landed in this tier. Do not truncate mid-sentence or end with an ellipsis) so the reader can understand the item without opening the email.
2. Read the FULL body of each email. Catch real operational issues even when buried inside a routine/boring message.
3. For each operational risk, score: likelihood (1-5), impact (1-5), riskScore = likelihood * impact. Add: category, clock (time-to-impact, short string), affectedArea, a concrete mitigation, and a trend.
   - category: a SHORT, sector-appropriate label chosen from the email's own domain.
   - Set trend using YESTERDAY'S RISKS: "New" if not seen before, "Escalating" if worse, "Cooling" if improving, "Stable" otherwise.
   - If matchedKeywords field is selected, list which KB keywords triggered classification in a "matchedKeywords" field on triage items.
   - If reason field is selected, include a clear "reason" for classification.
4. decisionQueue: ONLY items the recipient must personally decide today (title, why, deadline, sourceId).
5. todoList: ONLY the recipient's own tasks, each {task, deadline, status:"Open", sourceId}, sorted by deadline. Do NOT include meetings, calls, appointments, or calendar invites — attending something is not a task; those belong ONLY in events. A meeting email produces a todoList item only when it asks the recipient to DO something beyond attending (e.g. prepare a document, send materials).
6. actions: the FULL action register across all emails {task, owner, deadline, sourceId}.
7. collisions: detect schedule clashes — meetings, inspections, audits, reviews, and deadlines that overlap. Each {type, summary, when, items:[sourceId...], suggestion}.
8. events: list every event mentioned in emails when relevant. Each {title, when, type, owner, sourceId}. Include both calendar-style events and business events, but do not invent dates.
9. patterns: array of strings — cross-email signals.
10. deadlines: {date, item, sourceId} for every dated commitment.
11. narrative: a concise, high-level summary of the overall period. Keep it to 2-3 complete, professional sentences summarizing the key operational events or alerts. Do not truncate mid-sentence.
12. narrativeKeyPoints: the narrative broken into 3-7 KEY POINTS, ordered most important first. GROUP related emails: when 2-3 emails belong to the same category/topic (e.g. several security alerts, several lead notifications, several policy updates), merge them into ONE key point whose "mails" array lists EVERY email in that group. Each key point:
    - "title": a short headline for the point/category (e.g. "Google security alerts", "Payment issue").
    - "summary": 1-2 complete, user-readable sentences with enough concrete info (who, what, deadline, what to do) that the reader doesn't need to open the emails. Do not truncate or end with an ellipsis.
    - "mails": [{ "sourceId", "subject", "from" }] — one entry per email backing this point, so the UI can link each mail beside the point. Never leave it empty.
13. categorySummaries: group the emails by their "category" field (emails with no category go under "Other"). For EACH distinct category produce { "category", "count", "summary", "keyPoints", "mails" }:
    - "summary": 2-3 COMPLETE sentences covering what the emails in that category were about — who they're from, the common theme, and anything needing attention. Write full, complete sentences; never truncate or end with an ellipsis. Format it with ONLY these inline HTML tags so the UI can style it: <b>…</b> around key entities (people, companies, batch/order/invoice numbers, dates, amounts), <mark>…</mark> around phrases the reader should notice, and <span class="danger">…</span> around genuinely urgent or risky words (e.g. recall, failure, deviation, overdue, urgent, breach, complaint, shortage, escalation). Use tags sparingly — highlight words or short phrases, never whole sentences; no other tags and no attributes except class="danger".
    - "keyPoints": 0-8 short phrases naming the concrete items in the category (e.g. "CAPA submission <span class="danger">overdue</span>", "Batch <b>B-102</b> deviation", "Audit on <b>Jul 12</b>"). Same inline tags allowed. Do not truncate phrases in the middle or make them too short to read. Leave the array empty for trivial categories like newsletters. DEDUPLICATE: two emails about the same thing produce ONE key point.
    - The summary and keyPoints must NOT repeat each other: the summary describes the overall theme and what needs attention; keyPoints name the individual items. Never enumerate subject lines inside the summary.
    - "mails": [{ "sourceId", "subject", "from" }] — one entry for EVERY email in that category, so the UI can link each mail under the summary.
    One entry per category — never skip a category that has at least one email. Do NOT use these HTML tags anywhere else in the output — plain text everywhere except categorySummaries.

COMPLETENESS REQUIREMENTS — apply to every required output key; an empty array is acceptable ONLY when no email contains any relevant material, never for brevity:
- risks: examine EVERY Critical and Important email for operational, compliance, financial, schedule, customer, security, or relationship risk. Most inboxes contain at least 1-3 scoreable risks — extract and score each one with likelihood, impact, riskScore, category, clock, affectedArea, mitigation and trend.
- actions: the action register must capture EVERY task, request, or commitment across ALL emails — including implicit ones ("please review", "can you send", "waiting on your reply", "let me know"). Any email asking the recipient or anyone else to do something produces an action.
- events: extract EVERY meeting, call, appointment, audit, inspection, review, launch, webinar, interview, travel, shipment, release, campaign, or dated occurrence mentioned anywhere in any email. An email containing a date/time and an activity produces an event.
- collisions: after building events and deadlines, compare ALL dated items against each other. Report every time overlap, same-day crowding (3+ commitments on one day), or deadline landing on a meeting-heavy day, with a concrete suggestion.
- patterns: ALWAYS provide 2-5 cross-email observations when there are 2 or more emails — recurring senders, repeated topics, escalating threads, clusters of similar notifications, rising urgency, unanswered follow-ups.
- deadlines: every dated commitment from any email, even if it also appears in events, actions, or todoList.

Base EVERY field strictly on the emails provided — do NOT fabricate issues, names, dates, or numbers.
Every array item MUST carry a "sourceId" equal to the "id" of the email it came from.

OUTPUT:
Return ONLY a valid JSON object (no markdown) with EXACTLY these keys:
{
  "narrative": string,
  "narrativeKeyPoints": [{ "title": string, "summary": string, "mails": [{ "sourceId": string, "subject": string, "from": string }] }],
  "triage": [{ "sourceId": string, "tier": "Critical"|"Important"|"Low", "reason": string, "subject": string, "from": string, "summary": string, "matchedKeywords": [string] }],
  "categorySummaries": [{ "category": string, "count": number, "summary": string, "keyPoints": [string], "mails": [{ "sourceId": string, "subject": string, "from": string }] }],
  "decisionQueue": [{ "title": string, "why": string, "deadline": string, "sourceId": string }],
  "risks": [{ "category": string, "summary": string, "likelihood": number, "impact": number, "riskScore": number, "clock": string, "affectedArea": string, "mitigation": string, "trend": "New"|"Escalating"|"Stable"|"Cooling", "sourceId": string }],
  "todoList": [{ "task": string, "deadline": string, "status": "Open", "sourceId": string }],
  "actions": [{ "task": string, "owner": string, "deadline": string, "sourceId": string }],
  "events": [{ "title": string, "when": string, "type": string, "owner": string, "sourceId": string }],
  "collisions": [{ "type": "Meeting"|"Inspection"|"Audit"|"Deadline", "summary": string, "when": string, "items": [string], "suggestion": string }],
  "patterns": [string],
  "deadlines": [{ "date": string, "item": string, "sourceId": string }]
}
If the inbox is quiet, still return the object with empty arrays and a short calm narrative.

YESTERDAY'S RISKS (for trend; may be empty):
${JSON.stringify(yesterdayRisks || [])}

INBOX (${safeEmails.length} emails):
${JSON.stringify(safeEmails)}
`;
}

/**
 * Small prompt that turns a meeting invitation into discussion topics /
 * keywords, used to retrieve the relevant emails for the pre-meeting brief.
 * Runs through the SAME aiClient (OpenAI/Ollama) as every other AI call.
 *
 * @param {Object} meeting - { title, whenText, participants[], description, organizer }
 * @returns {string} prompt (expects a JSON object back: { topics:[], keywords:[] })
 */
export function buildMeetingTopicsPrompt(meeting = {}) {
  const title = String(meeting.title || '').slice(0, 300);
  const when = String(meeting.whenText || '').slice(0, 120);
  const organizer = String(meeting.organizer || '').slice(0, 200);
  const participants = (meeting.participants || []).slice(0, 30).join(', ');
  const description = String(meeting.description || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

  return `You are preparing an executive for an upcoming meeting. From the meeting invitation below, infer the concrete DISCUSSION TOPICS and SEARCH KEYWORDS that would help find related emails in the executive's mailbox.

MEETING TITLE: ${title || '(none)'}
WHEN: ${when || '(unknown)'}
ORGANIZER: ${organizer || '(unknown)'}
PARTICIPANTS: ${participants || '(unknown)'}
DESCRIPTION / AGENDA:
${description || '(none provided)'}

Return ONLY a valid JSON object (no markdown) with EXACTLY these keys:
{
  "topics": [string],    // 3-8 short discussion topics likely to come up
  "keywords": [string]   // 5-15 distinctive search terms (project names, products, clients, systems, acronyms) — single words or short phrases, no generic filler
}
Base everything strictly on the invitation. Do NOT invent client or project names that are not implied by the text.`;
}

/**
 * Build the chat messages for a PRE-MEETING BRIEF. Unlike buildBriefPrompt this
 * is NOT a JSON-mode call — the model must return the meeting-specific HTML
 * document defined below verbatim (structure only; content is per-meeting), so
 * the client can render it directly (after sanitising). The candidate emails
 * passed in are a ranked (not pre-filtered) window of the account's recent mail
 * (see preMeetingBrief.service.retrieveCandidateEmails) — the model itself must
 * decide which ones are actually relevant to this meeting using the criteria
 * below, and must not fall back to summarising the whole inbox.
 *
 * @param {Object} meeting - { title, when, whenText, participants[], description, organizer, location }
 * @param {Array}  emails  - relevant emails: {sourceId, threadId, subject, from, to, receivedAt, body, category}
 * @returns {Array<{role:string, content:string}>} chat messages for aiClient.chatCompletion
 */
export function buildPreMeetingBriefPrompt(meeting = {}, emails = []) {
  const safeEmails = emails.map((e) => ({
    sourceId: e.sourceId,
    threadId: e.threadId || '',
    subject: e.subject || '',
    from: e.from || '',
    to: e.to || '',
    receivedAt: e.receivedAt,
    body: String(e.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));

  const attendees = (meeting.participants || []).slice(0, 40).join(', ') || 'Not available in the related emails';
  const dateObj = meeting.when ? new Date(meeting.when) : null;
  const meetingDate = dateObj && !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
    : (meeting.whenText || 'Not available in the related emails');
  const meetingStartTime = dateObj && !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'Not specified';
  const description = String(meeting.description || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) || 'Not available in the related emails';

  const now = new Date();
  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
  const todayIso = now.toISOString();

  const system = `You are generating a pre-meeting brief for a selected calendar event.

Today's date and time is ${todayLabel} (${todayIso}). Use it to judge what is overdue, upcoming, or stale, and to reason about how "today", "this week" or similar relative phrases in the emails map to actual dates.

You are given a ranked window of this account's recent emails — it is NOT pre-filtered to only this meeting. Your task is to analyze all of it and decide for yourself, using the criteria below, which emails and threads are actually relevant to the selected meeting, then base the brief only on those. Do not summarize the complete inbox, and do not treat an email as relevant just because it appears in the list.

Instructions:

1. Identify only emails related to the selected meeting using:
   * Meeting title
   * Subject similarity
   * Organizer and attendee email addresses
   * Thread ID
   * Reply and forwarded message relationships
   * Meeting description
   * Project, product, client, batch, audit or department names
   * Dates, deadlines and action items connected to the meeting

2. Exclude unrelated content such as:
   * Newsletters
   * Marketing or promotional emails
   * General company announcements
   * Employee joining announcements
   * Automated notifications unrelated to the meeting
   * Emails that only contain generic words such as "meeting", "today", "important" or "urgent" without contextual relevance

3. Group emails from the same conversation into one thread.
   * Treat subjects beginning with RE:, FW: or FWD: as part of the original thread when context matches.
   * Do not repeat the same subject multiple times.
   * Give priority to the latest message and current thread status.

4. Extract useful meeting information:
   * Meeting objective, important background, latest updates, key discussion points, previous decisions, pending action items, action owners, deadlines, risks or blockers, questions requiring answers, documents or reports to prepare.

5. Do not classify emails as Critical, Important or Low unless that classification directly helps the meeting preparation.

6. Do not display inbox statistics such as total emails in the inbox, number of critical/important emails, or general keyword-based inbox triage.

7. Do not invent facts. When information is unavailable, write "Not available in the related emails", "Owner not specified", or "Deadline not specified" as appropriate.

8. Return ONLY the HTML document described below — no preamble, no JSON, no markdown, no code fences, no <html>/<head>/<body> wrapper, no <script> or <style> tags and no "style"/"class"/"on*" attributes. Use ONLY these tags: h1, h2, h3, p, ul, ol, li, strong, em, span. Escape any literal "<" or "&" found in the source emails as "&lt;"/"&amp;" so they never break the markup.

9. Return a clear and concise brief using this EXACT structure (keep every heading, omit nothing, use "No previous decisions found" / "Not available in the related emails" where a section has nothing to report):

<h1>Pre-Meeting Brief</h1>

<h2>Meeting</h2>
<ul>
<li><strong>Title:</strong> ...</li>
<li><strong>Date and time:</strong> ...</li>
<li><strong>Organizer:</strong> ...</li>
<li><strong>Attendees:</strong> ...</li>
<li><strong>Location or link:</strong> ...</li>
</ul>

<h2>Meeting Objective</h2>
<p>1-3 sentences explaining why the meeting is being held.</p>

<h2>Executive Summary</h2>
<p>A concise summary of the most important information from the related email threads.</p>

<h2>Relevant Email Threads</h2>
<h3>1. {Thread Subject}</h3>
<ul>
<li><strong>Latest update:</strong> ...</li>
<li><strong>Participants:</strong> ...</li>
<li><strong>Current status:</strong> ...</li>
<li><strong>Pending response or action:</strong> ...</li>
</ul>
(repeat the h3/ul pair per unique, relevant thread)

<h2>Key Discussion Points</h2>
<ul><li>Topics that should be discussed during the meeting.</li></ul>

<h2>Previous Decisions</h2>
<ul><li>Decisions already made in related emails, or "No previous decisions found".</li></ul>

<h2>Pending Actions</h2>
<ul>
<li><strong>Action:</strong> ... — <strong>Owner:</strong> ... — <strong>Deadline:</strong> ... — <strong>Status:</strong> ...</li>
</ul>

<h2>Risks and Blockers</h2>
<ul><li>Production, operational, compliance, quality, customer or delivery risks.</li></ul>

<h2>Questions to Raise</h2>
<ul><li>Unresolved questions that should be asked during the meeting.</li></ul>

<h2>Suggested Preparation</h2>
<ul><li>Reports, documents, metrics, files or approvals that should be prepared.</li></ul>

<h2>Required Outcomes</h2>
<ul><li>Decisions or confirmations expected from the meeting.</li></ul>

10. If NONE of the provided emails are actually relevant to this meeting (or none were provided), do NOT use the structure above. Instead return this ALTERNATE structure, using ONLY the calendar event details — never invent specific figures, batch numbers, people, deadlines or incidents:

<h1>Pre-Meeting Brief</h1>

<h2>Meeting</h2>
<ul>
<li><strong>Title:</strong> ...</li>
<li><strong>Date and time:</strong> ...</li>
<li><strong>Organizer:</strong> ...</li>
<li><strong>Attendees:</strong> ...</li>
<li><strong>Location or link:</strong> ...</li>
</ul>

<h2>Available Context</h2>
<p>No previous email thread, decision, action item or meeting history was found for this meeting.</p>

<h2>Likely Meeting Objective</h2>
<p>Infer the likely objective ONLY from the meeting title and description, and clearly label it "Inferred from the meeting title." Never present this as a confirmed fact.</p>

<h2>Suggested Discussion Points</h2>
<ul><li>Practical discussion points inferred from the meeting title/subject area (e.g. for a production review: current production status, planned vs actual output, delays or downtime, material availability, quality issues, equipment/maintenance problems, staffing constraints, regulatory/safety concerns, pending approvals, next-period plan). Adapt to whatever subject area the title implies.</li></ul>

<h2>Information to Prepare</h2>
<ul><li>Reports or data worth having on hand for this type of meeting (e.g. latest status report, plan-vs-actual figures, open issues log, relevant approvals) — generic to the subject area, not fabricated specifics.</li></ul>

<h2>Questions to Raise</h2>
<ul><li>Useful generic questions for this type of meeting (e.g. is this on schedule, are there blockers, what needs management approval, what are the priorities before the next review).</li></ul>

<h2>Expected Outcomes</h2>
<ul><li>Confirm current position, identify major risks/blockers, assign owners for pending actions, confirm deadlines, agree next priorities.</li></ul>

<h2>Context Status</h2>
<p>No matching previous emails were found. This brief was generated from the calendar event details only.</p>

The final output must be a meeting-specific preparation brief, not an inbox summary. Never return a bare "no context" message with no structure.`;

  const user = `Today's date and time: ${todayLabel} (${todayIso})

Selected meeting details:

* Title: ${meeting.title || '(untitled meeting)'}
* Date: ${meetingDate}
* Start time: ${meetingStartTime}
* Start timestamp (ISO): ${dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj.toISOString() : 'Not specified'}
* End time: Not specified
* Organizer: ${meeting.organizer || 'Not available in the related emails'}
* Attendees: ${attendees}
* Description: ${description}
* Location or meeting link: ${meeting.location || 'Not available in the related emails'}

Available email data (${safeEmails.length} email(s) from this account, ranked by likely relevance but NOT pre-filtered — decide relevance yourself; each has an exact "receivedAt" timestamp):
${JSON.stringify(safeEmails)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export default { buildBriefPrompt, buildMeetingTopicsPrompt, buildPreMeetingBriefPrompt };
