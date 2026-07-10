/**
 * AI text-rewrite helper for the draft editor.
 *
 * Takes a snippet the user selected in a draft and re-writes it according to a
 * requested MODE. Modes fall into two groups:
 *   Tone    — professional / friendly  (change the voice)
 *   Refine  — polish / reframe / elaborate  (fix, restructure or expand)
 *
 * When a source mail is supplied its thread context is passed in so the result
 * fits the conversation. Uses the shared aiClient so it follows the same
 * OpenAI/Ollama switch as the rest of the flow.
 */
import aiClient from './aiClient';

const MAX_LEN = 4000;

// Per-mode instructions. `expand` lets the model change length/structure freely
// (reframe/elaborate) instead of staying close to the original.
const MODES = {
  professional: {
    instruction:
      'produce polished, professional wording suitable for formal business email, with strong clarity and correct grammar.',
    expand: false,
  },
  friendly: {
    instruction:
      'produce warm, approachable, friendly wording that is still appropriate for email.',
    expand: false,
  },
  polish: {
    instruction:
      'fix grammar, spelling, punctuation and awkward phrasing and tighten it for clarity, keeping the wording close to the source.',
    expand: false,
  },
  reframe: {
    instruction:
      'restructure and rephrase so it reads clearly and flows well — reorganize the sentences and improve structure and transitions; the wording and order may change substantially.',
    expand: true,
  },
  elaborate: {
    instruction:
      'produce a complete, well-structured message with helpful detail and connective phrasing; it may be noticeably longer.',
    expand: true,
  },
};

const DEFAULT_MODE = 'professional';

/** Normalise/validate a requested mode; falls back to "professional". */
function normaliseMode(mode) {
  const m = String(mode || '').toLowerCase().trim();
  return MODES[m] ? m : DEFAULT_MODE;
}

// Placeholder names the model sometimes emits for a sign-off.
const NAME_PLACEHOLDER_RE = /\[\s*(your\s+full\s+name|your\s+name|full\s+name|name)\s*\]/gi;

/**
 * Replace "[Your Name]" style placeholders with the real account holder's name
 * (Gmail or Outlook). No-op when the name is unknown.
 */
export function applySenderName(text, name) {
  const clean = String(name || '').trim();
  if (!clean) return text;
  return String(text || '').replace(NAME_PLACEHOLDER_RE, clean);
}

// Does the selection already open with a greeting line?
function hasGreeting(text) {
  return /^\s*(hi|hello|hey|dear|greetings|good\s+(morning|afternoon|evening))\b/i.test(text);
}

// Does the selection already end with a sign-off (Best regards, Sincerely, …)?
function hasSignOff(text) {
  const tail = String(text).slice(-220);
  return /\b(best\s+regards|kind\s+regards|warm\s+regards|regards|sincerely|best\s+wishes|thank\s+you,|thanks,|cheers|yours\s+(truly|sincerely|faithfully))\b/i.test(tail);
}

function buildMessages(text, mode, contextText = '', senderName = '') {
  const { instruction, expand } = MODES[mode];

  // If the selection is missing a greeting AND/OR a sign-off, rebuild it as a
  // full email; if it already has both, optimise it in place.
  const needsStructure = !(hasGreeting(text) && hasSignOff(text));

  const lengthRule = expand || needsStructure
    ? '- You may change the length and structure as needed.'
    : '- Keep it roughly the same length as the source content; do not pad it out.';

  const signOffName = senderName || '[Your Name]';

  const structureRule = needsStructure
    ? `- The selection is missing a proper greeting and/or sign-off, so RECREATE it as a complete email:
    • Open with a greeting addressed to the recipient by name from the thread (e.g. "Hi <first name>," or "Dear <first name>,"; use "Hello," if unknown).
    • Then the body in short paragraphs.
    • Close with a sign-off line ("Best regards,") followed by "${signOffName}" on its own line.
    • Separate the greeting, each paragraph and the sign-off with a BLANK line.`
    : `- The selection already has a greeting and sign-off — OPTIMISE it in place, keeping that same overall structure. If it has a sign-off name/placeholder, use "${signOffName}".`;

  const system = `You are helping a user draft an email reply. They have selected a piece of text from their draft. Produce the text that should REPLACE that selection.

FIRST, decide what the selected text is:
- INSTRUCTION — a directive to you about the reply (e.g. "make this shorter", "add that I'll join the call", "ask them for the invoice", "politely decline", "give me a formal response"). In this case, WRITE the reply content that carries out the instruction, grounded in the conversation thread below.
- DRAFT CONTENT — actual sentences meant for the email. In this case: ${instruction}

THEN apply the requested style in every case: ${instruction}

STRUCTURE:
${structureRule}

RULES:
- Ground the result in the conversation thread (below) so it stays relevant to what was actually said.
- Do NOT invent facts, names, dates, numbers, links or commitments that are not supported by the thread or the user's own text. When a needed detail is missing, use a clear placeholder like "[please confirm]".
- NEVER output a placeholder such as "[Your Name]" for the signature${senderName ? ` — always sign as "${senderName}"` : ''}.
- Return ONLY the text to insert — no preamble, no quotes, no labels, no explanation of what you did.
${lengthRule}`;

  const contextSection = contextText
    ? `--- CONVERSATION THREAD (for grounding and relevance) ---\n${contextText}\n--- END THREAD ---\n\n`
    : '';

  const user = `${contextSection}SELECTED TEXT (instruction or draft content):\n"""\n${text}\n"""`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Rewrite a selected snippet of draft text in the given mode.
 *
 * @param {string} text - The plain-text selection to rewrite.
 * @param {string} mode - professional | friendly | polish | reframe | elaborate.
 * @param {Object} [opts] - Optional: { contextText } — thread/email context to
 *                          keep the rewrite relevant to the conversation.
 * @returns {Promise<{text: string, mode: string, provider: string}>}
 */
async function rewriteText(text, mode, opts = {}) {
  const source = String(text || '').trim().slice(0, MAX_LEN);
  if (!source) throw new Error('No text was provided to rewrite.');

  const finalMode = normaliseMode(mode);
  const contextText = String(opts.contextText || '').trim().slice(0, MAX_LEN);
  const senderName = String(opts.senderName || '').trim();
  console.log(`rewriteText: mode=${finalMode}, context=${contextText ? 'yes' : 'no'}, senderName=${senderName ? 'yes' : 'no'}`, senderName);
  const messages = buildMessages(source, finalMode, contextText, senderName);

  const provider = await aiClient.currentProvider();
  const raw = await aiClient.chatCompletion(messages);

  // Strip wrapping quotes / whitespace the model sometimes adds, then swap any
  // leftover "[Your Name]" placeholder for the real account holder's name.
  let rewritten = String(raw || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  rewritten = applySenderName(rewritten, senderName);
  if (!rewritten) throw new Error('AI returned an empty rewrite. Try again.');

  return { text: rewritten, mode: finalMode, provider };
}

export default { rewriteText };
