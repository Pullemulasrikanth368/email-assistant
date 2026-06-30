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
  const enabledSections = Array.isArray(rc.enabledSections) && rc.enabledSections.length
    ? rc.enabledSections
    : null; // null = all sections enabled (default)
  const selectedFields = Array.isArray(rc.selectedFields) && rc.selectedFields.length
    ? rc.selectedFields
    : null;
  const outputStyle = rc.outputStyle || 'detailed';
  const reportPromptInstruction = String(rc.promptInstruction || '').trim();

  const sectionInstruction = enabledSections
    ? `\nENABLED REPORT SECTIONS (only populate these in the output; leave other arrays empty):
${enabledSections.map((s) => `  - ${s}`).join('\n')}\n`
    : '';

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
1. Triage EVERY email into "Critical", "Important", or "Low" with a one-line reason. Use the CLASSIFICATION KEYWORDS above as signals. Rank by severity × urgency: anything threatening safety, legal/regulatory/compliance, customers, or revenue ranks highest; pure cost items or routine FYI rank lowest.
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
11. narrative: a 120-second, spoken-style summary. Lead with the most important thing.

Base EVERY field strictly on the emails provided — do NOT fabricate issues, names, dates, or numbers.
Every array item MUST carry a "sourceId" equal to the "id" of the email it came from.

OUTPUT:
Return ONLY a valid JSON object (no markdown) with EXACTLY these keys:
{
  "narrative": string,
  "triage": [{ "sourceId": string, "tier": "Critical"|"Important"|"Low", "reason": string, "matchedKeywords": [string] }],
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

export default { buildBriefPrompt };
