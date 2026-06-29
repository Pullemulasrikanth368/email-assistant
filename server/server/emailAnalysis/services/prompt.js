/**
 * Builds the single analysis prompt for the brief engine.
 * ALL analysis rules live here — do not scatter business logic elsewhere.
 *
 * @param {Array} emails           - mapped email shape: {id, from, subject, body, receivedAt, meetingTime?}
 * @param {Array} yesterdayRisks   - risks array from the previous report (for trend)
 * @param {Object} meta            - { periodLabel }
 * @returns {string} prompt
 */
export function buildBriefPrompt(emails = [], yesterdayRisks = [], meta = {}) {
  const periodLabel = meta.periodLabel || 'the latest day';

  // Trim bodies so the prompt stays within limits but keeps enough to catch
  // buried issues.
  const safeEmails = emails.map((e) => ({
    id: e.id,
    from: e.from || '',
    subject: e.subject || '',
    body: String(e.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
    receivedAt: e.receivedAt,
    meetingTime: e.meetingTime || null,
  }));

  return `You are the analysis engine for an AI Operations Command Center used by a senior operations leader (e.g. a VP or Director of Operations) in ANY industry — manufacturing, healthcare, finance, logistics, IT, retail, customer support, education, etc.
First INFER the recipient's sector and role from the inbox itself (senders, subjects, terminology), then turn the inbox below (covering ${periodLabel}) into a single structured "morning brief" framed for THAT sector. Do NOT assume a specific industry — adapt the categories, terminology and examples to whatever the emails are actually about.

ANALYSIS RULES:
1. Triage EVERY email into "Critical", "Important", or "Low" with a one-line reason. Rank by severity × urgency: anything threatening safety, legal/regulatory/compliance, customers, or revenue ranks highest; pure cost items or routine FYI rank lowest.
2. Read the FULL body of each email. Catch real operational issues even when buried inside a routine/boring message (e.g. a "minor update" that actually hides a multi-day outage, a missed deadline, or a financial/customer risk).
3. For each operational risk, score: likelihood (1-5), impact (1-5), riskScore = likelihood * impact. Add: category, clock (time-to-impact, short string), affectedArea, a concrete mitigation, and a trend.
   - category: a SHORT, sector-appropriate label you choose from the email's own domain (examples only, not a fixed list: Quality, Safety, Security, Compliance, Finance, Supply, Customer, IT, HR, Operations, Legal). Pick whatever fits the inbox.
   - Set trend using YESTERDAY'S RISKS: "New" if not seen before, "Escalating" if worse, "Cooling" if improving, "Stable" otherwise.
4. decisionQueue: ONLY items the recipient must personally decide today (title, why, deadline, sourceId).
5. todoList: ONLY the recipient's own tasks, each {task, deadline, status:"Open", sourceId}, sorted by deadline.
6. actions: the FULL action register across all emails {task, owner, deadline, sourceId}.
7. collisions: detect schedule clashes and pile-ups — meetings, inspections, audits, reviews, site visits, and deadlines that overlap or stack. Map each to the CLOSEST type: "Meeting" | "Inspection" | "Audit" | "Deadline" (use "Meeting" for general events/reviews, "Deadline" for stacked due-dates). Each {type, summary, when, items:[sourceId...], suggestion}.
8. patterns: array of strings — cross-email signals (e.g. a recurring issue showing up as several separate emails is ONE pattern).
9. deadlines: {date, item, sourceId} for every dated commitment.
10. narrative: a 120-second, spoken-style summary of the day. Lead with the most important thing.

Base EVERY field strictly on the emails provided — do NOT fabricate issues, names, dates, or numbers that are not present in the inbox. If the sector is ambiguous, stay neutral and generic rather than guessing a specific industry.
Every array item MUST carry a "sourceId" equal to the "id" of the email it came from (collisions use "items": [sourceId...]).

OUTPUT:
Return ONLY a valid JSON object (no markdown) with EXACTLY these keys:
{
  "narrative": string,
  "triage": [{ "sourceId": string, "tier": "Critical"|"Important"|"Low", "reason": string }],
  "decisionQueue": [{ "title": string, "why": string, "deadline": string, "sourceId": string }],
  "risks": [{ "category": string, "summary": string, "likelihood": number, "impact": number, "riskScore": number, "clock": string, "affectedArea": string, "mitigation": string, "trend": "New"|"Escalating"|"Stable"|"Cooling", "sourceId": string }],
  "todoList": [{ "task": string, "deadline": string, "status": "Open", "sourceId": string }],
  "actions": [{ "task": string, "owner": string, "deadline": string, "sourceId": string }],
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

export default { buildBriefPrompt };
