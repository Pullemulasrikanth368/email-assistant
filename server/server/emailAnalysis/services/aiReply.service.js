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
import EmailAnalysisUser from '../models/emailAnalysisUser.model';
import OutlookUser from '../../microsoft/models/outlookUser.model';

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
    ? { threadId: mail.threadId || mail.providerMessageId }  // Outlook stores conversationId as threadId
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
 * Build a plain-text context block for a mail — its thread history (oldest
 * first) plus the email itself. Reused by the rewrite flow so a rewritten
 * snippet stays relevant to the conversation it belongs to.
 *
 * @returns {Promise<string>} formatted context, or '' when there's nothing.
 */
export async function buildMailContextText(mail) {
  if (!mail) return '';
  const thread = await fetchThreadContext(mail);
  const threadSection = thread.length > 0
    ? `CONVERSATION HISTORY (oldest first):\n${thread.map(formatThreadMsg).join('\n\n')}\n\n`
    : '';
  const incoming = `--- EMAIL BEING REPLIED TO ---
From: ${sanitiseAddr(mail.from)}
Subject: ${String(mail.subject || '').slice(0, 300)}

${toPlain(mail.body || mail.snippet || '', 2000)}
--- END OF EMAIL ---`;
  return `${threadSection}${incoming}`;
}

/**
 * Resolve the display name of the connected account that owns this mailbox,
 * so the reply can be signed with the real user's name (Gmail or Outlook)
 * instead of a "[Your Name]" placeholder.
 *
 * Matches by the mailbox email first; if that misses (e.g. the mail's stored
 * email doesn't exactly match the connected account), it falls back to the
 * logged-in user's most-recent active account for the same provider.
 */
export async function resolveSenderName(mail) {
  if (!mail) return '';
  const isOutlook = ['outlook', 'microsoft'].includes(String(mail.provider || '').toLowerCase());

  try {
    // 1) Exact mailbox match on either collection.
    if (mail.email) {
      const byEmail =
        (await EmailAnalysisUser.findOne({ email: mail.email, active: true }).select('name').lean()) ||
        (await OutlookUser.findOne({ email: mail.email, active: true }).select('name').lean());
      if (byEmail?.name) return byEmail.name.trim();
    }

    // 2) Fall back to the account the logged-in user connected for this
    //    provider (most recent active one). Covers stored-email mismatches.
    const scope = mail.loginUserEmailId ? { loginUserEmailId: mail.loginUserEmailId } : {};
    if (isOutlook) {
      const ol = await OutlookUser.findOne({ active: true, ...scope }).sort({ updatedAt: -1 }).select('name').lean();
      if (ol?.name) return ol.name.trim();
    } else {
      const gm = await EmailAnalysisUser.findOne({ active: true, ...scope }).sort({ updatedAt: -1 }).select('name').lean();
      if (gm?.name) return gm.name.trim();
    }

    // 3) Last resort: any active account for this provider.
    const any = isOutlook
      ? await OutlookUser.findOne({ active: true }).sort({ updatedAt: -1 }).select('name').lean()
      : await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 }).select('name').lean();
    return (any?.name || '').trim();
  } catch {
    return '';
  }
}

/**
 * Build the full message array for chatCompletion.
 *
 * System message sets the AI persona and strict rules.
 * User message provides the email context and generates the reply.
 */
function buildMessages({ mail, thread, tone = 'professional', senderName = '', instruction = '' }) {
  const signOffRule = senderName
    ? `- End with a professional sign-off addressed from the account holder, e.g. "Best regards,\n${senderName}". Use exactly this name — do NOT invent or change it.`
    : `- End with a professional sign-off (e.g. "Best regards,\n[Your Name]") but do NOT invent a name.`;

  const system = `You are an expert executive email assistant. Your task is to draft a reply to an email on behalf of the recipient.

STRUCTURE THE REPLY AS A PROPER EMAIL:
- Start with a greeting line addressed to the sender by name (e.g. "Hi <first name>," or "Dear <first name>,"). Use the sender's name from the incoming email; if it is unknown, use "Hello,".
- Then the body in one or more short paragraphs.
- Then a sign-off line, then the sender's name on its own line.
- Separate the greeting, each body paragraph, and the sign-off with a BLANK line (an empty line between blocks) so it renders as distinct paragraphs.

STRICT RULES:
- Write ONLY the reply body — no subject line, no "From:", no "To:", no email headers.
- Do NOT start with "Subject:" or any metadata.
- Keep the reply concise, clear, and ${tone}.
- Match the formality of the incoming email.
- Address the sender's specific request or question directly.
- Do NOT hallucinate facts. If you lack specific information, use a professional placeholder like "[please fill in]".
- Do NOT add unnecessary filler, repetition, or padding.
${signOffRule}
- Output ONLY the reply text — nothing else.`;

  const threadSection = thread.length > 0
    ? `\n\nCONVERSATION HISTORY (oldest first, for context):\n${thread.map(formatThreadMsg).join('\n\n')}`
    : '';

  const priorityContext = mail.priority
    ? `\nPriority: ${mail.priority}${mail.intent ? ` · Intent: ${mail.intent}` : ''}${mail.priorityReason ? ` — ${mail.priorityReason}` : ''}`
    : '';

  const instructionSection = instruction
    ? `\n\nSPECIFIC INSTRUCTION FROM THE USER (follow this when writing the reply): ${instruction}`
    : '';

  const user = `Draft a reply to the following email.${instructionSection}${priorityContext}${threadSection}

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
  const senderName = opts.senderName || (await resolveSenderName(mail));
  const messages = buildMessages({
    mail,
    thread,
    tone: opts.tone || 'professional',
    senderName,
    instruction: opts.instruction || '',
  });

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
