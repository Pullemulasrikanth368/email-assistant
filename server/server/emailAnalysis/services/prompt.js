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
1. Triage EVERY email into "Critical", "Important", or "Low" with a one-line reason. Use the CLASSIFICATION KEYWORDS above as signals. Rank by severity × urgency: anything threatening safety, legal/regulatory/compliance, customers, or revenue ranks highest; pure cost items or routine FYI rank lowest. Also include the email's "subject", "from", and a "summary" (one clear sentence explaining what the email is actually about and why it landed in this tier) so the reader can understand the item without opening the email.
2. Read the FULL body of each email. Catch real operational issues even when buried inside a routine/boring message.
3. For each operational risk, score: likelihood (1-5), impact (1-5), riskScore = likelihood * impact. Add: category, clock (time-to-impact, short string), affectedArea, a concrete mitigation, and a trend.
   - category: a SHORT, sector-appropriate label chosen from the email's own domain.
   - Set trend using YESTERDAY'S RISKS: "New" if not seen before, "Escalating" if worse, "Cooling" if improving, "Stable" otherwise.
   - If matchedKeywords field is selected, list which KB keywords triggered classification in a "matchedKeywords" field on triage items.
   - If reason field is selected, include a clear "reason" for classification.
4. decisionQueue: ONLY items the recipient must personally decide today (title, why, deadline, sourceId).
5. todoList: ONLY the recipient's own tasks, each {task, deadline, status:"Open", sourceId}, sorted by deadline.
6. actions: the FULL action register across all emails {task, owner, deadline, sourceId}.
7. collisions: detect schedule clashes — meetings, inspections, audits, reviews, and deadlines that overlap. Each {type, summary, when, items:[sourceId...], suggestion}.
8. events: list every event mentioned in emails when relevant. Each {title, when, type, owner, sourceId}. Include both calendar-style events and business events, but do not invent dates.
9. patterns: array of strings — cross-email signals.
10. deadlines: {date, item, sourceId} for every dated commitment.
11. narrative: a 120-second, spoken-style summary. Lead with the most important thing. Keep it to 1-2 sentences — the detail lives in narrativeKeyPoints.
12. narrativeKeyPoints: the narrative broken into 3-7 KEY POINTS, ordered most important first. GROUP related emails: when 2-3 emails belong to the same category/topic (e.g. several security alerts, several lead notifications, several policy updates), merge them into ONE key point whose "mails" array lists EVERY email in that group. Each key point:
    - "title": a short headline for the point/category (e.g. "Google security alerts", "Payment issue").
    - "summary": 1-2 sentences with enough concrete info (who, what, deadline, what to do) that the reader doesn't need to open the emails.
    - "mails": [{ "sourceId", "subject", "from" }] — one entry per email backing this point, so the UI can link each mail beside the point. Never leave it empty.
13. categorySummaries: group the emails by their "category" field (emails with no category go under "Other"). For EACH distinct category produce { "category", "count", "summary", "keyPoints", "mails" }:
    - "summary": 2-3 COMPLETE sentences covering what the emails in that category were about — who they're from, the common theme, and anything needing attention. Write full sentences; never truncate or end with an ellipsis. Format it with ONLY these inline HTML tags so the UI can style it: <b>…</b> around key entities (people, companies, batch/order/invoice numbers, dates, amounts), <mark>…</mark> around phrases the reader should notice, and <span class="danger">…</span> around genuinely urgent or risky words (e.g. recall, failure, deviation, overdue, urgent, breach, complaint, shortage, escalation). Use tags sparingly — highlight words or short phrases, never whole sentences; no other tags and no attributes except class="danger".
    - "keyPoints": 0-8 ultra-short phrases, AT MOST 4-5 words each, naming the concrete items in the category (e.g. "CAPA submission <span class="danger">overdue</span>", "Batch <b>B-102</b> deviation", "Audit on <b>Jul 12</b>"). Same inline tags allowed. Leave the array empty for trivial categories like newsletters. DEDUPLICATE: two emails about the same thing produce ONE key point.
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
 * Build the single analysis prompt for a PRE-MEETING BRIEF. Produces the SAME
 * JSON contract as buildBriefPrompt so the existing brief engine, dashboard and
 * markdown renderer work unchanged — only the framing changes: instead of a
 * "morning brief" over a day, it is a preparation brief for ONE meeting, built
 * from emails already selected as relevant to that meeting.
 *
 * @param {Object} meeting - { title, whenText, participants[], description, organizer, location, topics[] }
 * @param {Array}  emails  - relevant emails (engine shape: {id, from, subject, body, receivedAt, category, priority})
 * @param {Object} meta    - { knowledgeBaseConfig? }
 * @returns {string} prompt
 */
export function buildPreMeetingPrompt(meeting = {}, emails = [], meta = {}) {
  const kb = meta.knowledgeBaseConfig || {};

  const safeEmails = emails.map((e) => ({
    id: e.id,
    from: e.from || '',
    subject: e.subject || '',
    body: String(e.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500),
    receivedAt: e.receivedAt,
    category: e.category || '',
    priority: e.priority || '',
  }));

  // ---- Knowledge Base context (reused verbatim from the daily brief) ----
  const kbKeywords = kb.keywords || {};
  const criticalKw = (kbKeywords.critical || []).join(', ') || 'FDA, Form 483, OOS, recall, deviation, urgent, escalation';
  const importantKw = (kbKeywords.important || []).join(', ') || 'CAPA, audit, inspection, deadline, approval, review';

  const glossary = kb.glossary || {};
  const glossaryLines = Object.entries(glossary).map(([term, def]) => `  ${term}: ${def}`).join('\n');
  const glossarySection = glossaryLines
    ? `\nDOMAIN GLOSSARY (use these definitions when you see these terms):\n${glossaryLines}\n`
    : '';
  const promptInstruction = kb.promptInstruction
    ? `\nANALYSIS INSTRUCTIONS FROM KNOWLEDGE BASE:\n${kb.promptInstruction}\n`
    : '';

  const participants = (meeting.participants || []).slice(0, 40).join(', ');
  const topics = (meeting.topics || []).slice(0, 12).join(', ');
  const description = String(meeting.description || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

  return `You are the preparation engine for an AI Executive Assistant. Your job is to prepare a senior leader for ONE upcoming meeting, using ONLY the emails provided below — these have already been selected as relevant to the meeting (by participants, sender domain and topic). First INFER the sector and context from the meeting and emails, then produce a single structured PRE-MEETING BRIEF framed as "what you need to know and do before walking into this meeting".
${glossarySection}${promptInstruction}
MEETING
- Title: ${String(meeting.title || '(untitled meeting)').slice(0, 300)}
- When: ${String(meeting.whenText || 'unknown').slice(0, 120)}
- Location: ${String(meeting.location || 'n/a').slice(0, 200)}
- Organizer: ${String(meeting.organizer || 'unknown').slice(0, 200)}
- Participants: ${participants || 'unknown'}
- Likely topics: ${topics || '(infer from emails)'}
- Agenda/description: ${description || '(none provided)'}

CLASSIFICATION KEYWORDS (signals for what matters most):
- Critical: ${criticalKw}
- Important: ${importantKw}

ANALYSIS RULES — map meeting-prep content onto these JSON keys:
1. narrative: a 60-90 second spoken-style briefing — lead with the single most important thing to know before this meeting. 1-2 sentences.
2. narrativeKeyPoints: 3-7 key preparation points ordered most important first. GROUP related emails into one point. Each: { "title", "summary" (concrete: who/what/status/what to do), "mails":[{ "sourceId","subject","from" }] }.
3. decisionQueue: decisions the leader must be ready to make IN or BEFORE this meeting — { "title","why","deadline","sourceId" }.
4. risks: open issues, blockers or sensitivities to be aware of going in. Score likelihood (1-5), impact (1-5), riskScore = likelihood*impact, plus category, clock, affectedArea, mitigation, trend:"New". Each with "sourceId".
5. todoList: prep tasks to do BEFORE the meeting — { "task","deadline","status":"Open","sourceId" }, most urgent first.
6. actions: open action items / commitments involving the participants or topics — { "task","owner","deadline","sourceId" }.
7. events: related meetings, deadlines or dated commitments connected to this meeting or its participants — { "title","when","type","owner","sourceId" }. Do not invent dates.
8. collisions: scheduling clashes around the meeting time or competing deadlines — { "type","summary","when","items":[sourceId...],"suggestion" }.
9. patterns: 2-5 cross-email observations about the history/context with these participants or topics (recurring asks, slipping dates, unanswered follow-ups, rising urgency).
10. deadlines: every dated commitment found — { "date","item","sourceId" }.
11. triage: classify EVERY provided email into "Critical"|"Important"|"Low" for meeting relevance with a one-line "reason", plus "subject","from","summary","matchedKeywords".
12. categorySummaries: group the emails by their "category" field (emails with no category go under "Other"). For EACH category: { "category","count","summary","keyPoints","mails" }. The "summary" is 2-3 complete sentences; use ONLY these inline tags: <b>…</b>, <mark>…</mark>, <span class="danger">…</span>. "keyPoints" are 0-8 ultra-short phrases naming concrete items. "mails":[{ "sourceId","subject","from" }] one per email.

COMPLETENESS: populate every key that has ANY supporting material in the emails; an empty array is acceptable only when nothing relevant exists. Base EVERY field strictly on the emails provided — do NOT fabricate names, dates, or numbers. Every array item MUST carry a "sourceId" equal to the "id" of the email it came from.

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
If there is little related mail, still return the object with mostly empty arrays and a short narrative noting there is limited prior context for this meeting.

RELEVANT EMAILS (${safeEmails.length}):
${JSON.stringify(safeEmails)}
`;
}

export default { buildBriefPrompt, buildMeetingTopicsPrompt, buildPreMeetingPrompt };
