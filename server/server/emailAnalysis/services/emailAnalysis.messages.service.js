/**@Packages */
import { google } from "googleapis";
import fs from "fs";
import path from "path";

import {
  decodeBase64Url,
  decodeBase64UrlToBuffer,
  extractAttachments,
  getHeader,
  safeAttachmentFilename,
} from "../../utils/gmailMessage.util";

/**@Models */
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import Settings from "../../models/settings.model";

/**@Config */
import config from "../../config/config";

/**@Progress */
import syncProgress from "./syncProgress";

// Attachments are written here, mirroring the existing attachmentProcessor
// convention of saving under <server>/server/upload/<bucket>.
const UPLOAD_DIR = path.resolve(__dirname, "../../upload/email-analysis");
const UPLOAD_REL = "server/upload/email-analysis";

// Initial backfill window: the last month.
const BACKFILL_DAYS = 30;
const INITIAL_QUERY = `newer_than:${BACKFILL_DAYS}d`;
const INITIAL_MAX_RESULTS = 500;

// Gentle pause between sends to stay under Gmail's per-user rate limits.
const SEND_THROTTLE_MS = 200;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const encodeRawEmail = (rawEmail = "") =>
  Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

class GmailApiReader {
  constructor({ email }) {
    this.email = email;
    this.gmail = null;
  }

  gmailInit(gmail) {
    this.gmail = gmail;
  }

  #requireGmail() {
    if (!this.gmail) throw new Error("Gmail client is not initialized.");
    return this.gmail;
  }

  async listMessages({ query = "", labelIds = [], maxResults = 100, includeSpamTrash = false } = {}) {
    const gmail = this.#requireGmail();
    const messages = [];
    let pageToken;

    do {
      const remaining = Math.max(maxResults - messages.length, 0);
      if (!remaining) break;

      const res = await gmail.users.messages.list({
        userId: "me",
        q: query || undefined,
        labelIds: labelIds?.length ? labelIds : undefined,
        maxResults: Math.min(remaining, 500),
        includeSpamTrash,
        pageToken,
      });

      messages.push(...(res.data.messages || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken && messages.length < maxResults);

    return messages;
  }

  async getMessage(id, format = "full") {
    const res = await this.#requireGmail().users.messages.get({
      userId: "me",
      id,
      format,
    });
    return res.data;
  }

  async getLastHistory() {
    const res = await this.#requireGmail().users.getProfile({ userId: "me" });
    return res.data.historyId;
  }

  async getHistory(startHistoryId, historyTypes = ["messageAdded"]) {
    const gmail = this.#requireGmail();
    const history = [];
    let pageToken;
    let historyId;

    do {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes,
        pageToken,
      });
      history.push(...(res.data.history || []));
      historyId = res.data.historyId || historyId;
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return { history, historyId };
  }

  async sendRawEmail(rawEmail) {
    return this.#requireGmail().users.messages.send({
      userId: "me",
      requestBody: { raw: encodeRawEmail(rawEmail) },
    });
  }

  async replyToMessage({ threadId, rawEmail }) {
    return this.#requireGmail().users.messages.send({
      userId: "me",
      requestBody: { raw: encodeRawEmail(rawEmail), threadId },
    });
  }

  async trashMessage(id) {
    return this.#requireGmail().users.messages.trash({ userId: "me", id });
  }

  async downloadAttachment(messageId, attachmentId) {
    const res = await this.#requireGmail().users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    return decodeBase64UrlToBuffer(res.data.data || "");
  }
}

const isAscii = (s = "") => /^[\x00-\x7F]*$/.test(s);

// RFC 2047 encode a header value only when it contains non-ASCII characters.
function encodeHeader(text = "") {
  const t = String(text);
  return isAscii(t) ? t : `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`;
}

// "Display Name" <address> — display name quoted/encoded as needed.
function formatAddress(name, addr) {
  if (!name) return addr;
  const display = isAscii(name) ? `"${name.replace(/"/g, "")}"` : encodeHeader(name);
  return `${display} <${addr}>`;
}

// Split a raw `From` header ("Name <email>") into its parts.
function parseSender(raw = "") {
  const match = String(raw).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) return { name: (match[1] || "").trim(), email: (match[2] || "").trim() };
  const trimmed = String(raw).trim();
  return { name: trimmed, email: trimmed.includes("@") ? trimmed : "" };
}

// Does this string contain HTML markup?
const looksLikeHtml = (s = "") => /<[a-z!][\s\S]*>/i.test(String(s));

const escapeHtml = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Resolve the email content to send: explicit `html` wins, else an HTML-looking
// `body` is treated as HTML, otherwise it's plain text.
//   returns { isHtml: boolean, content: string }
function resolveContent(item = {}) {
  if (item.html && String(item.html).trim()) return { isHtml: true, raw: String(item.html) };
  const body = item.body || "";
  if (looksLikeHtml(body)) return { isHtml: true, raw: body };
  return { isHtml: false, raw: body };
}

// Provenance lines so a seeded inbox still shows who the message was "from".
function originMeta(item = {}) {
  const { name, email } = parseSender(item.from);
  const meta = [];
  const orig = [name, email && `<${email}>`].filter(Boolean).join(" ");
  if (orig) meta.push(["Originally from", orig]);
  if (item.receivedAt) meta.push(["Original date", String(item.receivedAt)]);
  if (item.meetingTime) meta.push(["Meeting time", String(item.meetingTime)]);
  return meta;
}

// Plain-text body with a provenance header.
function buildTextBody(item, raw) {
  const meta = originMeta(item);
  const header = meta.length
    ? `— Seeded test email —\n${meta.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${"-".repeat(40)}\n\n`
    : "";
  return header + (raw || "");
}

// HTML body with a provenance note prepended; the user's HTML is sent verbatim.
function buildHtmlBody(item, raw) {
  const meta = originMeta(item);
  const note = meta.length
    ? `<div style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#5f6368;border-left:3px solid #dadce0;background:#f8f9fa;padding:8px 12px;margin:0 0 14px">` +
      `<b>— Seeded test email —</b><br>${meta.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join("<br>")}</div>`
    : "";
  return `${note}${raw || ""}`;
}

// Build a raw RFC 822 message (base64 body) ready for Gmail's messages.send.
function buildRawMessage({ fromName, fromAddress, to, subject, body, date, isHtml = false }) {
  const headers = [
    `From: ${formatAddress(fromName, fromAddress)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
  ];
  if (date) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) headers.push(`Date: ${d.toUTCString()}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset="UTF-8"`);
  headers.push("Content-Transfer-Encoding: base64");
  const encodedBody = Buffer.from(body || "", "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${encodedBody}`;
}

/**
 * Reads Gmail for an email-analysis-connected account and persists messages
 * (and their attachments) into the dedicated `email_analysis_mails` collection.
 *
 * It does NOT touch the existing login/accessTokens/mail pipeline. It reuses
 * GmailMessagesService purely as a read/format helper by injecting an already
 * authenticated Gmail client via `gmailInit`.
 */
export default class EmailAnalysisMessagesService {
  constructor(email) {
    this.email = email;
    this.user = null;
    this.gmail = null;
    this.reader = null;
  }

  /**
   * Build an authenticated Gmail client from the stored refresh token.
   * The googleapis OAuth2 client auto-refreshes the access token when it is
   * expired (the refresh token itself does not expire unless revoked); we
   * persist any refreshed tokens back to `email_analysis_user`.
   */
  async #buildAuthedReader() {
    const user = await EmailAnalysisUser.findOne({ email: this.email, active: true });
    if (!user) {
      throw new Error(`No connected email-analysis account for ${this.email}`);
    }
    if (!user.refreshToken) {
      throw new Error(`Missing Google refresh token for ${this.email}. Reconnect the account.`);
    }
    this.user = user;

    const oauth = new google.auth.OAuth2(
      config.googleClient,
      config.googleSecret,
      config.emailAnalysisRedirectUri
    );
    oauth.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
      expiry_date: user.expiryDate ? new Date(user.expiryDate).getTime() : undefined,
    });

    // Persist refreshed credentials so the next run starts from a fresh token.
    oauth.on("tokens", async (tokens) => {
      try {
        if (tokens.access_token) this.user.accessToken = tokens.access_token;
        if (tokens.refresh_token) this.user.refreshToken = tokens.refresh_token;
        if (tokens.expiry_date) this.user.expiryDate = new Date(tokens.expiry_date);
        if (tokens.id_token) this.user.idToken = tokens.id_token;
        await EmailAnalysisUser.saveData(this.user);
      } catch (err) {
        console.error("[EmailAnalysis] Failed to persist refreshed token:", err.message);
      }
    });

    this.gmail = google.gmail({ version: "v1", auth: oauth });

    this.reader = new GmailApiReader({ email: this.email });
    this.reader.gmailInit(this.gmail);

    return this.reader;
  }

  /**
   * Send a batch of emails through the connected Gmail account.
   *
   * Gmail can only send FROM the authenticated account, so we set each message's
   * display name to the item's original sender and keep the original From/date
   * as a note in the body (see buildBodyWithOrigin). Used by the bulk-send /
   * inbox-seeding tool.
   *
   * @param {{ to: string, emails: Array<Object> }} args
   * @returns {Promise<{ total:number, sent:number, failed:number, results:Array }>}
   */
  async sendEmails({ to, emails }) {
    if (!to) throw new Error("A 'to' address is required.");
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new Error("No emails to send.");
    }

    await this.#buildAuthedReader();
    const fromAddress = this.user.email;

    const results = [];
    let sent = 0;
    for (let i = 0; i < emails.length; i += 1) {
      const item = emails[i] || {};
      const label = item.subject || item.id || `#${i + 1}`;
      try {
        const { isHtml, raw: contentRaw } = resolveContent(item);
        const body = isHtml ? buildHtmlBody(item, contentRaw) : buildTextBody(item, contentRaw);
        const raw = buildRawMessage({
          fromName: parseSender(item.from).name || "Mailbox",
          fromAddress,
          to,
          subject: item.subject || "(no subject)",
          body,
          date: item.receivedAt,
          isHtml,
        });
        const res = await this.reader.sendRawEmail(raw);
        sent += 1;
        results.push({ id: item.id || i, label, ok: true, messageId: res?.data?.id || null });
      } catch (err) {
        console.error(`[EmailAnalysis] Bulk send failed for "${label}":`, err.message);
        results.push({ id: item.id || i, label, ok: false, error: err.message });
      }
      if (i < emails.length - 1) await delay(SEND_THROTTLE_MS);
    }

    return { total: emails.length, sent, failed: emails.length - sent, results };
  }

  /**
   * Send an HTML reply on the thread of a previously-synced email (by its
   * providerMessageId / sourceId). Threads correctly via In-Reply-To/References
   * when available, falling back to a plain send if the thread can't be read.
   *
   * @param {{ sourceId: string, html: string }} args
   * @returns {Promise<{ to:string, subject:string, threadId?:string, messageId?:string }>}
   */
  async sendReplyToSource({ sourceId, html }) {
    if (!sourceId) throw new Error("sourceId is required.");
    if (!html) throw new Error("Reply content is required.");
    await this.#buildAuthedReader();

    const mail = await EmailAnalysisMail.findOne({
      email: this.email, providerMessageId: sourceId, active: true,
    }).lean();
    if (!mail) throw new Error("Linked email not found for this account.");

    const { name: toName, email: toAddr } = parseSender(mail.from);
    if (!toAddr) throw new Error("Could not determine the recipient from the original email.");

    // Pull original threading headers (best-effort) for proper Gmail threading.
    let inReplyTo = "";
    let references = "";
    try {
      const raw = await this.reader.getMessage(sourceId, "metadata");
      const hs = raw?.payload?.headers || [];
      const h = (n) => (hs.find((x) => (x.name || "").toLowerCase() === n.toLowerCase())?.value) || "";
      inReplyTo = h("Message-ID");
      references = [h("References"), inReplyTo].filter(Boolean).join(" ").trim();
    } catch (e) { /* threading headers optional */ }

    const subject = /^\s*re:/i.test(mail.subject || "") ? mail.subject : `Re: ${mail.subject || "(no subject)"}`;

    const headers = [
      `From: ${formatAddress(this.user.name || "", this.user.email)}`,
      `To: ${formatAddress(toName, toAddr)}`,
      `Subject: ${encodeHeader(subject)}`,
    ];
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references) headers.push(`References: ${references}`);
    headers.push("MIME-Version: 1.0");
    headers.push('Content-Type: text/html; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    const encoded = Buffer.from(html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    const rawEmail = `${headers.join("\r\n")}\r\n\r\n${encoded}`;

    let res;
    if (mail.threadId) {
      res = await this.reader.replyToMessage({ threadId: mail.threadId, rawEmail, flag: true });
    } else {
      res = await this.reader.sendRawEmail(rawEmail);
    }
    return { to: toAddr, subject, threadId: mail.threadId || null, messageId: res?.data?.id || null };
  }

  /**
   * Move a set of messages to Gmail Trash (best-effort). Used by one-click
   * cleanup so removed mail also leaves the real inbox. Reversible (Trash, not
   * permanent delete).
   * @param {Array<string>} messageIds  providerMessageIds
   * @returns {Promise<{ trashed:number, failed:number }>}
   */
  async trashMessages(messageIds = []) {
    const ids = [...new Set((messageIds || []).filter(Boolean))];
    if (!ids.length) return { trashed: 0, failed: 0 };
    await this.#buildAuthedReader();

    let trashed = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.reader.trashMessage(id);
        trashed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[EmailAnalysis] Trash failed for ${id}:`, err.message);
      }
    }
    return { trashed, failed };
  }

  /**
   * Entry point. First link -> backfill last month and store the historyId.
   * Subsequent runs -> incremental fetch via the Gmail History API.
   */
  async syncForUser() {
    syncProgress.begin(this.email);
    try {
      await this.#buildAuthedReader();
      const result = (!this.user.initialSyncDone || !this.user.historyId)
        ? await this.#initialSync()
        : await this.#incrementalSync();
      syncProgress.done();
      return result;
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  /**
   * Backfill the last `days` of mail for an already-connected account, saving
   * only messages we don't already have. Idempotent and safe to run on a
   * schedule — it guarantees the past-month window stays fully synced even for
   * accounts that were first connected before the window was widened.
   * @param {number} days
   * @returns {Promise<{ mode: string, saved: number }>}
   */
  async backfillRecent(days = BACKFILL_DAYS) {
    syncProgress.begin(this.email);
    try {
    await this.#buildAuthedReader();
    const includeSpam = await this.#includeSpamEnabled();
    syncProgress.phase("fetching");

    const messages = await this.reader.listMessages({
      query: includeSpam ? `newer_than:${days}d -in:trash` : `newer_than:${days}d`,
      labelIds: [],
      maxResults: INITIAL_MAX_RESULTS,
      includeSpamTrash: includeSpam,
    });

    const saved = await this.#saveMessages(messages.map((m) => m.id));

    // If this account never baselined a historyId, set it so incremental sync
    // can take over afterwards.
    if (!this.user.historyId) {
      this.user.historyId = await this.reader.getLastHistory(false);
      this.user.initialSyncDone = true;
      this.user.lastSyncedAt = new Date();
      await EmailAnalysisUser.saveData(this.user);
    }

    console.log(`[EmailAnalysis] Backfill (${days}d) for ${this.email}: saved=${saved}`);
    syncProgress.done();
    return { mode: "backfill", saved };
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  /** Read the DB "include spam" preference (defaults to false). */
  async #includeSpamEnabled() {
    try {
      const settings = await Settings.findOne({ active: true }).select("emailAnalysisIncludeSpam").lean();
      return !!settings?.emailAnalysisIncludeSpam;
    } catch (err) {
      console.error("[EmailAnalysis] Could not read include-spam setting:", err.message);
      return false;
    }
  }

  async #initialSync() {
    const includeSpam = await this.#includeSpamEnabled();
    console.log(`[EmailAnalysis] Initial sync (last ${BACKFILL_DAYS}d) for ${this.email}${includeSpam ? " (incl. spam)" : ""}`);

    // includeSpamTrash returns SPAM + TRASH; `-in:trash` keeps spam but drops trash.
    const messages = await this.reader.listMessages({
      query: includeSpam ? `${INITIAL_QUERY} -in:trash` : INITIAL_QUERY,
      labelIds: [],
      maxResults: INITIAL_MAX_RESULTS,
      includeSpamTrash: includeSpam,
    });
    if (messages.length >= INITIAL_MAX_RESULTS) {
      console.warn(`[EmailAnalysis] Initial sync hit the ${INITIAL_MAX_RESULTS} message cap for ${this.email}; older last-week mails may be skipped.`);
    }

    // Capture the current historyId BEFORE we rely on incremental sync.
    // persist=false so we do NOT write to the existing GmailHistory collection.
    const historyId = await this.reader.getLastHistory(false);

    const saved = await this.#saveMessages(messages.map(m => m.id));

    this.user.historyId = historyId;
    this.user.initialSyncDone = true;
    this.user.lastSyncedAt = new Date();
    await EmailAnalysisUser.saveData(this.user);

    console.log(`[EmailAnalysis] Initial sync done for ${this.email}: saved=${saved}, historyId=${historyId}`);
    return { mode: "initial", saved, historyId };
  }

  async #incrementalSync() {
    console.log(`[EmailAnalysis] Incremental sync for ${this.email} from historyId=${this.user.historyId}`);

    let messageIds = [];
    let newHistoryId = this.user.historyId;
    try {
      const { history, historyId } = await this.reader.getHistory(this.user.historyId, ["messageAdded"]);
      (history || []).forEach(h => {
        (h.messagesAdded || []).forEach(m => {
          if (m?.message?.id) messageIds.push(m.message.id);
        });
      });
      if (historyId) newHistoryId = historyId;

      // The History API (messageAdded) does not surface SPAM. When spam reading
      // is enabled, separately pull recent spam so new junk mail is captured too.
      if (await this.#includeSpamEnabled()) {
        const spam = await this.reader.listMessages({
          query: "in:spam newer_than:2d",
          labelIds: [],
          maxResults: 100,
          includeSpamTrash: true,
        });
        spam.forEach((m) => { if (m?.id) messageIds.push(m.id); });
      }
    } catch (err) {
      // A 404 means the stored historyId is too old/expired. Recover by
      // re-baselining to the current historyId (no backfill) so future
      // syncs stay consistent.
      const status = err?.response?.status || err?.code;
      if (status === 404) {
        console.warn(`[EmailAnalysis] historyId expired for ${this.email}; re-baselining.`);
        newHistoryId = await this.reader.getLastHistory(false);
        this.user.historyId = newHistoryId;
        this.user.lastSyncedAt = new Date();
        await EmailAnalysisUser.saveData(this.user);
        return { mode: "rebaseline", saved: 0, historyId: newHistoryId };
      }
      throw err;
    }

    const saved = await this.#saveMessages(messageIds);

    this.user.historyId = newHistoryId;
    this.user.lastSyncedAt = new Date();
    await EmailAnalysisUser.saveData(this.user);

    console.log(`[EmailAnalysis] Incremental sync done for ${this.email}: saved=${saved}, historyId=${newHistoryId}`);
    return { mode: "incremental", saved, historyId: newHistoryId };
  }

  /**
   * Fetch, format, persist (and download attachments for) the given message ids.
   * Skips ids already present for this account.
   * @returns {Promise<number>} number of new mails saved
   */
  async #saveMessages(messageIds) {
    const uniqueIds = [...new Set((messageIds || []).filter(Boolean))];
    syncProgress.total(uniqueIds.length);
    if (!uniqueIds.length) return 0;

    let savedCount = 0;
    for (const id of uniqueIds) {
      let savedThis = 0;
      try {
        // MANDATORY existence check: only sync (fetch + save) a mail when it is
        // NOT already stored for this account. Backed by the unique index on
        // { email, providerMessageId } to also guard against races.
        const existing = await EmailAnalysisMail.findOne({ email: this.email, providerMessageId: id });
        if (existing) {
          continue;
        }

        // Fetch the full message once, then format it ourselves so we keep the
        // HTML body (the shared formatter prefers the plain-text alternative,
        // which renders unstyled). Common read helpers are still reused.
        const raw = await this.reader.getMessage(id, "full");
        const emailObject = this.#formatMessage(raw);

        // Download + persist attachments, replacing raw metadata with file info.
        const attachments = await this.#saveAttachments(emailObject);

        const doc = new EmailAnalysisMail({
          ...emailObject,
          attachments,
          hasAttachments: attachments.length > 0,
          active: true,
        });
        await EmailAnalysisMail.saveData(doc);
        savedCount += 1;
        savedThis = 1;
      } catch (err) {
        // Duplicate key (race) is benign; log everything else and continue.
        if (err?.code !== 11000) {
          console.error(`[EmailAnalysis] Failed to save message ${id} for ${this.email}:`, err.message);
        }
      } finally {
        syncProgress.tick(savedThis);
      }
    }
    return savedCount;
  }

  /**
   * Format a Gmail message into our mail shape, preferring the HTML body.
   * Reuses the shared header/attachment utils but does its own body selection
   * (HTML first, plain-text fallback) so styled emails render correctly.
   */
  #formatMessage(message) {
    const payload = message?.payload;
    if (!message?.id || !payload) {
      throw new Error(`Gmail message payload missing for id=${message?.id || "unknown"}`);
    }
    const headers = payload.headers || [];
    const attachments = extractAttachments(payload);
    const cc = getHeader(headers, "Cc");
    const bcc = getHeader(headers, "Bcc");

    return {
      email: this.email,
      provider: "gmail",
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      cc: cc ? cc.split(",").map(v => v.trim()) : [],
      bcc: bcc ? bcc.split(",").map(v => v.trim()) : [],
      replyTo: getHeader(headers, "Reply-To"),
      subject: getHeader(headers, "Subject"),
      body: this.#extractHtmlBody(payload),
      labels: message.labelIds || [],
      mimeType: payload.mimeType,
      snippet: message.snippet,
      providerMessageId: message.id,
      threadId: message.threadId,
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
      attachments,
      hasAttachments: attachments.length > 0,
      isRepliedMail: !!getHeader(headers, "In-Reply-To"),
    };
  }

  /**
   * Walk the payload and return the HTML body, falling back to plain text.
   * (Opposite preference to the shared extractBody, which favours plain text.)
   */
  #extractHtmlBody(payload) {
    if (!payload) return "";
    if (payload.body?.data && payload.mimeType === "text/html") {
      return decodeBase64Url(payload.body.data);
    }

    const htmlParts = [];
    const textParts = [];
    const walk = (part) => {
      if (!part) return;
      if (part.body?.data) {
        if (part.mimeType === "text/html") htmlParts.push(decodeBase64Url(part.body.data));
        else if (part.mimeType === "text/plain") textParts.push(decodeBase64Url(part.body.data));
      }
      if (Array.isArray(part.parts)) part.parts.forEach(walk);
    };
    walk(payload);

    // Prefer HTML; fall back to the single-part body, then plain text.
    if (htmlParts.find(Boolean)) return htmlParts.find(Boolean);
    if (payload.body?.data) return decodeBase64Url(payload.body.data);
    return textParts.find(Boolean) || "";
  }

  /**
   * Downloads each attachment to the upload folder and returns cleaned metadata
   * (no raw base64) suitable for persisting on the mail document.
   */
  async #saveAttachments(emailObject) {
    const list = emailObject.attachments || [];
    if (!list.length) return [];

    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const out = [];
    for (const att of list) {
      const meta = { filename: att.filename, mimeType: att.mimeType, size: att.size, saved: false };
      try {
        let buffer;
        if (att.attachmentId) {
          buffer = await this.reader.downloadAttachment(emailObject.providerMessageId, att.attachmentId);
        } else if (att.inlineData) {
          buffer = decodeBase64UrlToBuffer(att.inlineData);
        } else {
          out.push({ ...meta, error: "No attachmentId or inline data" });
          continue;
        }

        const safeName = safeAttachmentFilename(att.filename);
        const messageId = safeAttachmentFilename(emailObject.providerMessageId || "message");
        const fileName = `${Date.now()}_${messageId}_${safeName}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        out.push({ ...meta, saved: true, savedPath: `${UPLOAD_REL}/${fileName}` });
      } catch (err) {
        console.error(`[EmailAnalysis] Attachment download failed "${att.filename}":`, err.message);
        out.push({ ...meta, error: err.message });
      }
    }
    return out;
  }
}
