/**
 * AI Smart Reply generator for the email-analysis flow.
 *
 * Uses the shared aiClient (OpenAI or Ollama, chosen at runtime from Settings)
 * so switching providers requires no change here. The prompt is designed to
 * produce a single, professional reply body — no subject line, no salutation
 * duplication — ready for the user to review and send.
 */
import aiClient from './aiClient';
import EmailAnalysisMail from '../models/emailAnalysisMail.model';

// Strip HTML tags to plain text, then truncate.
function toPlain(html = '', maxLen = 4000) {
  const plain = String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

// Sanitise a single address string for prompt inclusion.
const sanitiseAddr = (s = '') => String(s).slice(0, 200).replace(/\n/g, ' ');

// Format a thread message for prompt context.
function formatThreadMsg(msg, idx) {
  const from = sanitiseAddr(msg.from || 'Unknown');
  const date = msg.receivedAt ? new Date(msg.receivedAt).toUTCString() : '';
  const body = toPlain(msg.body || msg.snippet || '', 1500);
  return `--- Email ${idx + 1} (${date}) ---\nFrom: ${from}\n${body}`;
}

/**
 * Fetch thread context: earlier messages in the same Gmail thread or Outlook
 * conversation that are stored in our `email_analysis_mails` collection.
 * Returns the last 5 messages (oldest first) excluding the current mail.
 */
async function fetchThreadContext(mail) {
  const threadKey = mail.provider === 'outlook'
    ? { conversationId: mail.threadId || mail.providerMessageId }  // Outlook stores conversationId as threadId
    : { threadId: mail.threadId };

  if (!mail.threadId) return [];

  try {
    const thread = await EmailAnalysisMail.find({
      email: mail.email,
      provider: mail.provider,
      ...threadKey,
      active: true,
      _id: { $ne: mail._id },
    })
      .sort({ receivedAt: 1 })
      .limit(5)
      .select('from to subject body snippet receivedAt')
      .lean();
    return thread;
  } catch {
    return [];
  }
}

/**
 * Build the full message array for chatCompletion.
 *
 * System message sets the AI persona and strict rules.
 * User message provides the email context and generates the reply.
 */
function buildMessages({ mail, thread, tone = 'professional' }) {
  const system = `You are an expert executive email assistant. Your task is to draft a reply to an email on behalf of the recipient.

STRICT RULES:
- Write ONLY the reply body — no subject line, no "From:", no "To:", no email headers.
- Do NOT start with "Subject:" or any metadata.
- Keep the reply concise, clear, and ${tone}.
- Match the formality of the incoming email.
- Address the sender's specific request or question directly.
- Do NOT hallucinate facts. If you lack specific information, use a professional placeholder like "[please fill in]".
- Do NOT add unnecessary filler, repetition, or padding.
- End with a professional sign-off (e.g. "Best regards,\n[Your Name]") but do NOT invent a name.
- Output ONLY the reply text — nothing else.`;

  const threadSection = thread.length > 0
    ? `\n\nCONVERSATION HISTORY (oldest first, for context):\n${thread.map(formatThreadMsg).join('\n\n')}`
    : '';

  const priorityContext = mail.priority
    ? `\nPriority: ${mail.priority}${mail.intent ? ` · Intent: ${mail.intent}` : ''}${mail.priorityReason ? ` — ${mail.priorityReason}` : ''}`
    : '';

  const user = `Draft a professional reply to the following email.${priorityContext}${threadSection}

--- INCOMING EMAIL TO REPLY TO ---
From: ${sanitiseAddr(mail.from)}
To: ${sanitiseAddr(mail.to)}
${(mail.cc || []).length > 0 ? `Cc: ${mail.cc.slice(0, 5).join(', ')}\n` : ''}Subject: ${String(mail.subject || '').slice(0, 300)}
Date: ${mail.receivedAt ? new Date(mail.receivedAt).toUTCString() : 'Unknown'}

${toPlain(mail.body || mail.snippet || '', 3000)}
--- END OF EMAIL ---

Write the reply now:`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Generate an AI-drafted reply for a mail document.
 *
 * @param {Object} mail   - Full EmailAnalysisMail document (lean or Mongoose)
 * @param {Object} opts   - Optional: { tone }
 * @returns {Promise<{reply: string, provider: string, model: string}>}
 */
async function generateReply(mail, opts = {}) {
  const thread = await fetchThreadContext(mail);
  const messages = buildMessages({ mail, thread, tone: opts.tone || 'professional' });

  const provider = await aiClient.currentProvider();
  const rawReply = await aiClient.chatCompletion(messages);

  // Trim leading/trailing whitespace and strip any accidental subject prefix.
  let reply = String(rawReply || '').trim();
  // Remove common accidental prefix patterns the model sometimes emits.
  reply = reply
    .replace(/^(Subject:\s*.+\n+)+/i, '')
    .replace(/^(From:\s*.+\n+)+/i, '')
    .replace(/^(To:\s*.+\n+)+/i, '')
    .trim();

  if (!reply) throw new Error('AI returned an empty reply. Try again.');

  return { reply, provider, threadCount: thread.length };
}

export default { generateReply };
