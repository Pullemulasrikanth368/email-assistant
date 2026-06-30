/**
 * OutlookMessagesService
 *
 * Microsoft Graph API sync engine for Outlook email reading.
 * Mirrors EmailAnalysisMessagesService (Gmail) exactly — same public interface,
 * same `email_analysis_mails` collection, just a different provider ("outlook").
 *
 * SYNC STRATEGY (Delta Query):
 *   Initial run:
 *     GET /me/mailFolders/inbox/messages/delta
 *         ?$filter=receivedDateTime ge {30 days ago}
 *         &$select={fields}
 *     → pages until @odata.deltaLink is returned
 *     → store deltaLink on OutlookUser
 *
 *   Subsequent runs:
 *     GET {stored deltaLink}   (no extra params — MS remembers filter + select)
 *     → returns only new/changed messages
 *     → store new deltaLink
 *
 * OPERATIONS EXPOSED (same interface as EmailAnalysisMessagesService):
 *   syncForUser()              - entry point: initial or incremental
 *   backfillRecent(days)       - scheduled full re-fetch of past N days
 *   sendEmails({to, emails})   - bulk-send seeding tool
 *   sendMail({to,subject,...}) - new compose
 *   sendReplyToSource(...)     - reply on a thread
 *   replyToMessage(...)        - alias
 *   forwardMessage(...)        - forward
 *   trashMessages(ids)         - move to Deleted Items (recoverable!)
 *   markRead(ids, bool)        - toggle isRead
 *   searchEmails(query, limit) - Graph $search
 *   getConversation(threadId)  - full thread from DB
 */
import axios from "axios";
import fs from "fs";
import path from "path";

import OutlookUser from "../models/outlookUser.model";
import EmailAnalysisMail from "../../emailAnalysis/models/emailAnalysisMail.model";
import Settings from "../../models/settings.model";
import OutlookAuthService from "./outlookAuth.service";
import syncProgress from "../../emailAnalysis/services/syncProgress";
import { safeAttachmentFilename } from "../../utils/gmailMessage.util";

const UPLOAD_DIR = path.resolve(__dirname, "../../upload/email-analysis");
const UPLOAD_REL = "server/upload/email-analysis";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const BACKFILL_DAYS = 30;
const INITIAL_MAX_RESULTS = 500;

// Fields we request in every message select — keeps payloads lean.
const SELECT_FIELDS = [
  "id", "subject", "from", "toRecipients", "ccRecipients", "bccRecipients",
  "replyTo", "body", "bodyPreview", "receivedDateTime", "conversationId",
  "hasAttachments", "isRead", "isDraft", "importance", "categories",
  "flag",
].join(",");

// Token refresh buffer: refresh 2 minutes before actual expiry.
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

/* ─────────────────────── helpers ─────────────────────── */

function addressToString(addr = {}) {
  const email = addr?.emailAddress?.address || "";
  const name  = addr?.emailAddress?.name  || "";
  if (!email) return name;
  return name && name !== email ? `${name} <${email}>` : email;
}

function addressesToStrings(list = []) {
  return (list || []).map(addressToString).filter(Boolean);
}

function recipientList(list = []) {
  return (list || [])
    .map((a) =>
      typeof a === "string"
        ? { emailAddress: { address: a } }
        : { emailAddress: { address: a.email || a.address, name: a.name } }
    )
    .filter((r) => r.emailAddress.address);
}

function htmlOrText(content = {}) {
  return content?.content || "";
}

function escapeODataString(value = "") {
  return String(value).replace(/'/g, "''");
}

/* ─────────────────────── class ─────────────────────── */

export default class OutlookMessagesService {
  constructor(email) {
    this.email  = email;
    this.user   = null;          // OutlookUser document
    this.auth   = new OutlookAuthService();
  }

  /* ─── private: account + token management ─── */

  /**
   * Load the OutlookUser and ensure a valid access token.
   * Refreshes when less than REFRESH_BUFFER_MS remains.
   */
  async #loadUser() {
    const user = await OutlookUser.findOne({
      email: this.email,
      active: true,
    });
    if (!user) {
      throw new Error(`No connected Outlook account for ${this.email}. Connect via Connections & Delivery.`);
    }
    if (!user.refreshToken) {
      throw new Error(`Missing Microsoft refresh token for ${this.email}. Reconnect the Outlook account.`);
    }
    this.user = user;
    await this.#ensureAccessToken();
  }

  async #ensureAccessToken(force = false) {
    const expiresAt = this.user.expiryDate ? new Date(this.user.expiryDate).getTime() : 0;
    const needsRefresh = force || !this.user.accessToken || expiresAt < Date.now() + REFRESH_BUFFER_MS;
    if (!needsRefresh) return this.user.accessToken;

    const tokens = await this.auth.refreshTokens(this.user.refreshToken);
    this.user.accessToken = tokens.access_token;
    if (tokens.refresh_token)  this.user.refreshToken = tokens.refresh_token; // MS may rotate
    if (tokens.id_token)       this.user.idToken      = tokens.id_token;
    if (tokens.scope)          this.user.scope         = tokens.scope;
    this.user.expiryDate = tokens.expiry_date;
    await OutlookUser.saveData(this.user);
    return this.user.accessToken;
  }

  /**
   * Authenticated Graph API call. Retries once on 401 by refreshing token.
   * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
   * @param {string} url  - path relative to GRAPH_BASE or full URL
   * @param {{ data?, params?, responseType? }} opts
   */
  async #graph(method, url, { data, params, responseType, retry = true } = {}) {
    await this.#ensureAccessToken();
    const fullUrl = /^https?:\/\//i.test(url) ? url : `${GRAPH_BASE}${url}`;
    try {
      const res = await axios({
        method,
        url: fullUrl,
        data,
        params,
        responseType,
        headers: {
          Authorization: `Bearer ${this.user.accessToken}`,
          "Content-Type": "application/json",
          // Prefer minimal metadata for smaller responses
          Prefer: 'outlook.body-content-type="html"',
        },
      });
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      // Re-try once after a 401 by forcing a token refresh.
      if (status === 401 && retry) {
        await this.#ensureAccessToken(true);
        return this.#graph(method, url, { data, params, responseType, retry: false });
      }
      const graphError = err?.response?.data?.error;
      throw new Error(graphError?.message || err.message || "Microsoft Graph request failed.");
    }
  }

  /* ─── private: spam preference ─── */

  async #includeSpamEnabled() {
    try {
      const s = await Settings.findOne({ active: true }).select("emailAnalysisIncludeSpam").lean();
      return !!s?.emailAnalysisIncludeSpam;
    } catch {
      return false;
    }
  }

  /* ─── private: field select helper ─── */

  #selectFields() { return SELECT_FIELDS; }

  /* ─── private: initial message list (up to INITIAL_MAX_RESULTS) ─── */

  async #listRecentMessages(days = BACKFILL_DAYS) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const includeSpam = await this.#includeSpamEnabled();
    const folders = includeSpam ? ["inbox", "junkemail"] : ["inbox"];
    const all = [];

    for (const folder of folders) {
      let url = `/me/mailFolders/${folder}/messages`;
      let params = {
        $filter: `receivedDateTime ge ${since}`,  // only supported filter on Messages
        $select: this.#selectFields(),
        $top: 50,
      };

      // Page through results until we hit the cap or run out of pages.
      while (url && all.length < INITIAL_MAX_RESULTS) {
        const data = await this.#graph("GET", url, { params });
        // Filter isDraft client-side — Graph doesn't allow compound $filter on Messages
        (data.value || []).forEach((m) => {
          if (!m.isDraft) all.push(m);
        });
        url    = data["@odata.nextLink"] || null;
        params = null; // nextLink already contains all params
      }
    }

    return all.slice(0, INITIAL_MAX_RESULTS);
  }

  /* ─── private: establish a fresh delta cursor ─── */

  async #baselineDelta() {
    // Open a delta request but DON'T page — just get the first deltaLink.
    const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let url = `/me/mailFolders/inbox/messages/delta`;
    let params = {
      $filter: `receivedDateTime ge ${since}`,  // only supported filter on delta
      $select: this.#selectFields(),
    };
    let deltaLink = null;

    // Walk through ALL pages to reach the final deltaLink.
    do {
      const data = await this.#graph("GET", url, { params });
      deltaLink = data["@odata.deltaLink"] || null;
      url       = data["@odata.nextLink"]  || null;
      params    = null;
    } while (url && !deltaLink);

    if (deltaLink) {
      this.user.deltaLink = deltaLink;
      await OutlookUser.saveData(this.user);
    }
  }

  /* ─── private: save a batch of messages ─── */

  async #saveMessages(messages = []) {
    const unique = [];
    const seen   = new Set();
    for (const m of messages) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      unique.push(m);
    }

    syncProgress.total(unique.length);
    if (!unique.length) return 0;

    let savedCount = 0;
    for (const message of unique) {
      let savedThis = 0;
      try {
        const existing = await EmailAnalysisMail.findOne({
          email: this.email,
          provider: "outlook",
          providerMessageId: message.id,
        });
        if (existing) { syncProgress.tick(0); continue; }

        const emailObject = this.#formatMessage(message);
        const attachments = await this.#saveAttachments(emailObject, message.hasAttachments);

        const doc = new EmailAnalysisMail({
          ...emailObject,
          attachments,
          hasAttachments: attachments.length > 0 || !!message.hasAttachments,
          active: true,
        });
        await EmailAnalysisMail.saveData(doc);
        savedCount += 1;
        savedThis   = 1;
      } catch (err) {
        if (err?.code !== 11000) {
          console.error(`[Outlook] Failed to save message ${message?.id} for ${this.email}:`, err.message);
        }
      } finally {
        syncProgress.tick(savedThis);
      }
    }
    return savedCount;
  }

  /* ─── private: format a Graph message into our mail shape ─── */

  #formatMessage(message) {
    return {
      email:             this.email,
      provider:          "outlook",
      from:              addressToString(message.from),
      to:                addressesToStrings(message.toRecipients).join(", "),
      cc:                addressesToStrings(message.ccRecipients),
      bcc:               addressesToStrings(message.bccRecipients),
      replyTo:           addressesToStrings(message.replyTo).join(", "),
      subject:           message.subject || "",
      body:              htmlOrText(message.body),
      snippet:           message.bodyPreview || "",
      labels:            [
        message.isRead ? "READ" : "UNREAD",
        message.importance ? message.importance.toUpperCase() : null,
        ...(message.categories || []),
      ].filter(Boolean),
      mimeType:          message.body?.contentType === "html" ? "text/html" : "text/plain",
      providerMessageId: message.id,
      threadId:          message.conversationId,
      receivedAt:        message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
      attachments:       [],
      hasAttachments:    !!message.hasAttachments,
      isRepliedMail:     false,
    };
  }

  /* ─── private: download and persist attachments ─── */

  async #saveAttachments(emailObject, hasAttachments) {
    if (!hasAttachments) return [];
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    let attachmentList;
    try {
      const data = await this.#graph(
        "GET",
        `/me/messages/${encodeURIComponent(emailObject.providerMessageId)}/attachments`
      );
      attachmentList = data.value || [];
    } catch (err) {
      console.error(`[Outlook] Could not fetch attachments for ${emailObject.providerMessageId}:`, err.message);
      return [];
    }

    const out = [];
    for (const att of attachmentList) {
      const meta = {
        filename:  safeAttachmentFilename(att.name || "attachment"),
        mimeType:  att.contentType || "application/octet-stream",
        size:      att.size || 0,
        saved:     false,
      };
      if (att["@odata.type"] !== "#microsoft.graph.fileAttachment" || !att.contentBytes) {
        out.push({ ...meta, error: "Unsupported attachment type or no inline data" });
        continue;
      }
      try {
        const fileName = `${Date.now()}_${safeAttachmentFilename(emailObject.providerMessageId)}_${meta.filename}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.writeFileSync(filePath, Buffer.from(att.contentBytes, "base64"));
        out.push({ ...meta, saved: true, savedPath: `${UPLOAD_REL}/${fileName}` });
      } catch (err) {
        console.error(`[Outlook] Attachment write failed "${att.name}":`, err.message);
        out.push({ ...meta, error: err.message });
      }
    }
    return out;
  }

  /* ─────────────────────── PUBLIC API ─────────────────────── */

  /**
   * Entry point — called by sync cron and triggerMailSync().
   * Routes to #initialSync or #incrementalSync based on stored state.
   */
  async syncForUser() {
    syncProgress.begin(this.email);
    try {
      await this.#loadUser();
      const result = (this.user.initialSyncDone && this.user.deltaLink)
        ? await this.#incrementalSync()
        : await this.#initialSync();
      syncProgress.done();
      return result;
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  /**
   * Backfill the last `days` of mail. Idempotent — skips already-stored
   * messages. Called by the 03:30 daily cron and on first boot.
   */
  async backfillRecent(days = BACKFILL_DAYS) {
    syncProgress.begin(this.email);
    try {
      await this.#loadUser();
      syncProgress.phase("fetching");
      const messages = await this.#listRecentMessages(days);
      syncProgress.phase("saving");
      const saved = await this.#saveMessages(messages);

      if (!this.user.deltaLink) await this.#baselineDelta();
      this.user.initialSyncDone = true;
      this.user.lastSyncedAt    = new Date();
      await OutlookUser.saveData(this.user);

      console.log(`[Outlook] Backfill (${days}d) for ${this.email}: saved=${saved}`);
      syncProgress.done();
      return { mode: "backfill", saved };
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  /* ─── private sync modes ─── */

  async #initialSync() {
    console.log(`[Outlook] Initial sync (last ${BACKFILL_DAYS}d) for ${this.email}`);
    syncProgress.phase("fetching");
    const messages = await this.#listRecentMessages(BACKFILL_DAYS);

    if (messages.length >= INITIAL_MAX_RESULTS) {
      console.warn(`[Outlook] Initial sync hit the ${INITIAL_MAX_RESULTS} cap for ${this.email}.`);
    }

    syncProgress.phase("saving");
    const saved = await this.#saveMessages(messages);

    // Establish the delta cursor AFTER saving so the next run is incremental.
    await this.#baselineDelta();
    this.user.initialSyncDone = true;
    this.user.lastSyncedAt    = new Date();
    await OutlookUser.saveData(this.user);

    console.log(`[Outlook] Initial sync done for ${this.email}: saved=${saved}, deltaLink set`);
    return { mode: "initial", saved, deltaLink: this.user.deltaLink };
  }

  async #incrementalSync() {
    console.log(`[Outlook] Incremental sync for ${this.email}`);
    const messages = [];
    let next = this.user.deltaLink;

    try {
      do {
        const data = await this.#graph("GET", next);
        // @removed entries are deletions — skip them (we soft-delete in our DB separately)
        (data.value || [])
          .filter((m) => !m["@removed"] && !m.isDraft)
          .forEach((m) => messages.push(m));

        next = data["@odata.nextLink"] || null;
        if (data["@odata.deltaLink"]) {
          this.user.deltaLink = data["@odata.deltaLink"];
          next = null;
        }
      } while (next);
    } catch (err) {
      // 410 Gone means the delta link has expired — re-baseline (no backfill).
      // For OTHER errors we also re-baseline defensively, but log the detail.
      const status = err?.response?.status;
      if (status === 410) {
        console.warn(`[Outlook] Delta link expired for ${this.email}; re-baselining.`);
      } else {
        console.error(`[Outlook] Delta sync error for ${this.email} (status=${status}); re-baselining: ${err.message}`);
      }
      await this.#baselineDelta();
      this.user.lastSyncedAt = new Date();
      await OutlookUser.saveData(this.user);
      return { mode: "rebaseline", saved: 0, deltaLink: this.user.deltaLink };
    }

    const saved = await this.#saveMessages(messages);
    this.user.lastSyncedAt = new Date();
    await OutlookUser.saveData(this.user);

    console.log(`[Outlook] Incremental sync done for ${this.email}: saved=${saved}`);
    return { mode: "incremental", saved, deltaLink: this.user.deltaLink };
  }

  /* ─── sending ─── */

  /**
   * Send a new email from the connected Outlook account.
   */
  async sendMail({ to = [], cc = [], bcc = [], subject = "", html = "", text = "" }) {
    await this.#loadUser();
    const isHtml = !!html;
    await this.#graph("POST", "/me/sendMail", {
      data: {
        message: {
          subject,
          body: { contentType: isHtml ? "HTML" : "Text", content: isHtml ? html : text },
          toRecipients:  recipientList(Array.isArray(to) ? to : [to]),
          ccRecipients:  recipientList(Array.isArray(cc) ? cc : [cc]),
          bccRecipients: recipientList(Array.isArray(bcc) ? bcc : [bcc]),
        },
        saveToSentItems: true,
      },
    });
    return { sent: true };
  }

  /**
   * Bulk-send seeding tool — mirrors EmailAnalysisMessagesService.sendEmails().
   */
  async sendEmails({ to, emails }) {
    await this.#loadUser();
    if (!to) throw new Error("A 'to' address is required.");
    if (!Array.isArray(emails) || !emails.length) throw new Error("No emails to send.");

    const results = [];
    let sent = 0;
    for (let i = 0; i < emails.length; i += 1) {
      const item  = emails[i] || {};
      const label = item.subject || item.id || `#${i + 1}`;
      try {
        await this.sendMail({
          to: [to],
          subject: item.subject || "(no subject)",
          html: item.html || item.body || "",
          text: item.text || "",
        });
        sent += 1;
        results.push({ id: item.id || i, label, ok: true });
      } catch (err) {
        results.push({ id: item.id || i, label, ok: false, error: err.message });
      }
    }
    return { total: emails.length, sent, failed: emails.length - sent, results };
  }

  /**
   * Reply on the thread of a previously-synced email.
   * Uses the Graph reply endpoint — Microsoft handles threading automatically.
   */
  async sendReplyToSource({ sourceId, html, text = "" }) {
    return this.replyToMessage({ sourceId, html, text });
  }

  async replyToMessage({ sourceId, html = "", text = "" }) {
    await this.#loadUser();
    if (!sourceId) throw new Error("sourceId is required.");

    const mail = await EmailAnalysisMail.findOne({
      email: this.email,
      provider: "outlook",
      providerMessageId: sourceId,
      active: true,
    }).lean();
    if (!mail) throw new Error("Linked email not found for this Outlook account.");

    await this.#graph("POST", `/me/messages/${encodeURIComponent(sourceId)}/reply`, {
      data: {
        comment: text || "",
        message: { body: { contentType: "HTML", content: html || text } },
      },
    });
    return { to: mail.from, subject: mail.subject, threadId: mail.threadId || null, messageId: null };
  }

  /**
   * Forward an email.
   */
  async forwardMessage({ sourceId, to = [], comment = "" }) {
    await this.#loadUser();
    if (!sourceId) throw new Error("sourceId is required.");
    await this.#graph("POST", `/me/messages/${encodeURIComponent(sourceId)}/forward`, {
      data: { comment, toRecipients: recipientList(Array.isArray(to) ? to : [to]) },
    });
    return { forwarded: true };
  }

  /**
   * Move messages to Deleted Items (recoverable — equivalent to Gmail Trash).
   * Uses POST /messages/{id}/move with destinationId "deleteditems" rather than
   * DELETE (which is a permanent hard delete).
   */
  async trashMessages(messageIds = []) {
    await this.#loadUser();
    const ids = [...new Set((messageIds || []).filter(Boolean))];
    if (!ids.length) return { trashed: 0, failed: 0 };

    let trashed = 0;
    let failed  = 0;
    for (const id of ids) {
      try {
        await this.#graph("POST", `/me/messages/${encodeURIComponent(id)}/move`, {
          data: { destinationId: "deleteditems" },
        });
        trashed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[Outlook] Move to deleted items failed for ${id}:`, err.message);
      }
    }
    return { trashed, failed };
  }

  /**
   * Toggle the isRead flag on one or more messages.
   * Mirrors EmailAnalysisMessagesService.markRead().
   */
  async markRead(messageIds = [], isRead = true) {
    await this.#loadUser();
    const ids = [...new Set((messageIds || []).filter(Boolean))];
    if (!ids.length) return { updated: 0 };

    let updated = 0;
    for (const id of ids) {
      await this.#graph("PATCH", `/me/messages/${encodeURIComponent(id)}`, {
        data: { isRead },
      });
      // Keep our DB in sync.
      await EmailAnalysisMail.updateOne(
        { email: this.email, provider: "outlook", providerMessageId: id },
        {
          $set: {
            labels: isRead
              ? (await EmailAnalysisMail.findOne({ email: this.email, providerMessageId: id }).select("labels").lean())
                  ?.labels?.filter((l) => l !== "UNREAD") || []
              : undefined,
          },
          ...(isRead ? {} : { $addToSet: { labels: "UNREAD" } }),
        }
      );
      updated += 1;
    }
    return { updated };
  }

  /**
   * Search emails via Graph $search.
   * Saves any new results into email_analysis_mails as a side-effect.
   */
  async searchEmails(query, limit = 25) {
    await this.#loadUser();
    if (!query) return [];
    const data = await this.#graph("GET", "/me/messages", {
      params: {
        $search: `"${String(query).replace(/"/g, '\\"')}"`,
        $top:    Math.min(Math.max(Number(limit) || 25, 1), 50),
        $select: this.#selectFields(),
      },
    });
    const messages = (data.value || []).filter((m) => !m.isDraft);
    await this.#saveMessages(messages);
    return messages.map((m) => this.#formatMessage(m));
  }

  /**
   * Return the full conversation thread (all messages sharing conversationId).
   * Reads from our DB — no live Graph call needed.
   */
  async getConversation(conversationId) {
    if (!conversationId) return [];
    return EmailAnalysisMail.find({
      email:    this.email,
      provider: "outlook",
      threadId: conversationId,
      active:   true,
    }).sort({ receivedAt: 1 }).lean();
  }
}
