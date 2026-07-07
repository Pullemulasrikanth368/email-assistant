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
import OutlookAuthService from "./outlookAuth.service";
import syncProgress from "../../emailAnalysis/services/syncProgress";
import { safeAttachmentFilename } from "../../utils/gmailMessage.util";

const UPLOAD_DIR = path.resolve(__dirname, "../../upload/email-analysis");
const UPLOAD_REL = "server/upload/email-analysis";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const BACKFILL_DAYS = 30;
const INITIAL_MAX_RESULTS = 500;

// Outlook folders we sync, with our sourceFolder tag and the user-doc field
// holding each folder's incremental delta cursor.
const SYNC_FOLDERS = [
  { folder: "inbox", tag: "inbox", cursorField: "deltaLink" },
  { folder: "junkemail", tag: "junk", cursorField: "junkDeltaLink" },
  { folder: "sentitems", tag: "sent", cursorField: "sentDeltaLink" },
  { folder: "drafts", tag: "draft", cursorField: "draftDeltaLink" },
];
const FOLDER_TAG = Object.fromEntries(SYNC_FOLDERS.map((f) => [f.folder, f.tag]));

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

function cleanCid(value = "") {
  return decodeURIComponent(value)
    .replace(/^</, "")
    .replace(/>$/, "")
    .trim()
    .toLowerCase();
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

  /* ─── private: field select helper ─── */

  #selectFields() { return SELECT_FIELDS; }

  /* ─── private: initial message list (up to INITIAL_MAX_RESULTS) ─── */

  async #listRecentMessages(days = BACKFILL_DAYS) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const all = [];

    // Read ALL mail types: inbox, junk, sent and drafts folders.
    for (const { folder, tag } of SYNC_FOLDERS) {
      let url = `/me/mailFolders/${folder}/messages`;
      let params = {
        $filter: `receivedDateTime ge ${since}`,  // only supported filter on Messages
        $select: this.#selectFields(),
        $top: 50,
      };

      // Page through results until we hit the cap or run out of pages.
      while (url && all.length < INITIAL_MAX_RESULTS) {
        const data = await this.#graph("GET", url, { params });
        // Drop drafts everywhere except the drafts folder itself (client-side —
        // Graph doesn't allow compound $filter on Messages).
        (data.value || []).forEach((m) => {
          if (tag === "draft" || !m.isDraft) {
            m._sourceFolder = tag;
            all.push(m);
          }
        });
        url    = data["@odata.nextLink"] || null;
        params = null; // nextLink already contains all params
      }
    }

    return all.slice(0, INITIAL_MAX_RESULTS);
  }

  /* ─── private: delta helpers ─── */

  /**
   * Walk a delta feed to its end, collecting non-removed, non-draft messages
   * (tagged with `_sourceFolder`) into `sink`. Accepts a stored delta link or
   * a folder name (fresh baseline). Returns the final delta link.
   */
  async #walkDelta(linkOrFolder, sink = [], sourceFolder = null, removed = []) {
    const isFolder = !!FOLDER_TAG[linkOrFolder];
    const folderTag = sourceFolder || FOLDER_TAG[linkOrFolder] || "inbox";
    const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let url = isFolder ? `/me/mailFolders/${linkOrFolder}/messages/delta` : linkOrFolder;
    let params = isFolder
      ? { $filter: `receivedDateTime ge ${since}`, $select: this.#selectFields() }
      : null;
    let deltaLink = null;

    do {
      const data = await this.#graph("GET", url, { params });
      (data.value || []).forEach((m) => {
        if (m["@removed"]) {
          if (m.id) removed.push(m.id);
          return;
        }
        if (folderTag !== "draft" && m.isDraft) return;
        m._sourceFolder = folderTag;
        sink.push(m);
      });
      deltaLink = data["@odata.deltaLink"] || deltaLink;
      url       = data["@odata.deltaLink"] ? null : (data["@odata.nextLink"] || null);
      params    = null;
    } while (url);

    return deltaLink;
  }

  /**
   * Soft-delete mails removed at the provider (delta `@removed` entries) so
   * drafts discarded/sent in Outlook — and deleted mail — disappear here too.
   */
  async #deactivateRemoved(removedIds = []) {
    const ids = [...new Set(removedIds.filter(Boolean))];
    if (!ids.length) return 0;
    const res = await EmailAnalysisMail.updateMany(
      { email: this.email, provider: "outlook", providerMessageId: { $in: ids }, active: true },
      { $set: { active: false, removedAt: new Date(), removedReason: "removed-at-provider" } }
    );
    const n = res?.modifiedCount || 0;
    if (n) console.log(`[Outlook] Deactivated ${n} provider-removed mail(s) for ${this.email}`);
    return n;
  }

  /**
   * Reconcile drafts after a full folder listing: stored drafts in the sync
   * window that no longer exist in Outlook were discarded or sent — deactivate
   * them. Skipped when the listing hit the cap (live set incomplete).
   */
  async #reconcileDrafts(messages, days) {
    if ((messages || []).length >= INITIAL_MAX_RESULTS) return 0;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const liveIds = messages.filter((m) => m._sourceFolder === "draft").map((m) => m.id);
    const res = await EmailAnalysisMail.updateMany(
      {
        email: this.email,
        provider: "outlook",
        sourceFolder: "draft",
        active: true,
        receivedAt: { $gte: since },
        providerMessageId: { $nin: liveIds },
      },
      { $set: { active: false, removedAt: new Date(), removedReason: "draft-removed-at-provider" } }
    );
    return res?.modifiedCount || 0;
  }

  /* ─── private: establish fresh delta cursors (all synced folders) ─── */

  async #baselineDelta() {
    for (const { folder, cursorField } of SYNC_FOLDERS) {
      this.user[cursorField] = await this.#walkDelta(folder);
    }
    await OutlookUser.saveData(this.user);
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
        if (existing) {
          // Drafts keep the same id while being edited — refresh their content.
          if (message._sourceFolder === "draft") {
            const fresh = this.#formatMessage(message);
            await EmailAnalysisMail.updateOne(
              { _id: existing._id },
              { $set: {
                subject: fresh.subject, body: fresh.body, snippet: fresh.snippet,
                to: fresh.to, cc: fresh.cc, bcc: fresh.bcc,
                labels: fresh.labels, receivedAt: fresh.receivedAt, active: true,
              } }
            );
          }
          syncProgress.tick(0);
          continue;
        }

        const emailObject = this.#formatMessage(message);
        emailObject.body = await this.resolveInlineCidImages(message.id, emailObject.body);
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
    const sourceFolder = message._sourceFolder || "inbox";
    const isJunk = sourceFolder === "junk";
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
      sourceFolder,
      isJunk,
      labels:            [
        message.isRead ? "READ" : "UNREAD",
        message.importance ? message.importance.toUpperCase() : null,
        isJunk ? "JUNK" : null,
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

  /* ─── public: resolve inline cid: images to data URIs ─── */

  // Outlook renders inline images as `<img src="cid:contentId">`. hasAttachments
  // can be false when a message only has inline images, so check the body directly.
  // Public (no #) so the controller can re-resolve at request time for mails
  // that were already saved to Mongo with raw cid: refs before this existed.
  async resolveInlineCidImages(providerMessageId, html) {
    await this.#loadUser();
    console.log("BEFORE INLINE REPLACE:", providerMessageId, String(html || "").includes("cid:"));
    if (!html || !/src=["']cid:/i.test(html)) return html;

    let attachments;
    try {
      const res = await this.#graph("GET", `/me/messages/${encodeURIComponent(providerMessageId)}/attachments`);
      attachments = res.value || [];
    } catch (err) {
      console.error(`[Outlook] Could not fetch attachments for inline images on ${providerMessageId}:`, err.message);
      return html;
    }

    console.log("ATTACHMENTS:", attachments.map((a) => ({
      name: a.name,
      isInline: a.isInline,
      contentId: a.contentId,
      contentType: a.contentType,
      hasBytes: !!a.contentBytes,
    })));

    const inlineAttachments = attachments.filter((att) => (
      att["@odata.type"] === "#microsoft.graph.fileAttachment"
      && att.isInline
      && att.contentId
      && att.contentBytes
    ));
    if (!inlineAttachments.length) return html;

    const finalHtml = html.replace(/src=["']cid:([^"']+)["']/gi, (match, cidFromHtml) => {
      const cleanHtmlCid = cleanCid(cidFromHtml);
      const matchedAttachment = inlineAttachments.find((att) => cleanCid(att.contentId) === cleanHtmlCid);
      if (!matchedAttachment) return match;
      const dataUrl = `data:${matchedAttachment.contentType};base64,${matchedAttachment.contentBytes}`;
      return `src="${dataUrl}"`;
    });

    console.log("AFTER INLINE REPLACE HAS CID:", finalHtml.includes("cid:"));
    console.log("AFTER INLINE REPLACE HAS DATA IMAGE:", finalHtml.includes("data:image"));
    return finalHtml;
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
      await this.#reconcileDrafts(messages, days);

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
    await this.#reconcileDrafts(messages, BACKFILL_DAYS);

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
    const removed = [];

    try {
      // Each synced folder keeps its own delta cursor. Accounts baselined
      // before a folder was added won't have that cursor yet — baseline it
      // on the fly (which also backfills that folder).
      for (const { folder, tag, cursorField } of SYNC_FOLDERS) {
        this.user[cursorField] = this.user[cursorField]
          ? await this.#walkDelta(this.user[cursorField], messages, tag, removed)
          : await this.#walkDelta(folder, messages);
      }
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
    const deleted = await this.#deactivateRemoved(removed);
    this.user.lastSyncedAt = new Date();
    await OutlookUser.saveData(this.user);

    console.log(`[Outlook] Incremental sync done for ${this.email}: saved=${saved}, deleted=${deleted}`);
    return { mode: "incremental", saved, deleted, deltaLink: this.user.deltaLink };
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
   * Update a synced Outlook draft in place (Graph PATCH keeps the same id).
   */
  async updateDraftByMessageId({ messageId, to = [], subject = "", body = "" }) {
    await this.#loadUser();
    await this.#graph("PATCH", `/me/messages/${encodeURIComponent(messageId)}`, {
      data: {
        subject: subject || "(no subject)",
        body: { contentType: "HTML", content: body || "" },
        toRecipients: recipientList(Array.isArray(to) ? to : [to]),
      },
    });
    return { newMessageId: null };
  }

  /**
   * Send an existing Outlook draft (identified by its message id) as-is.
   */
  async sendDraftByMessageId(messageId) {
    await this.#loadUser();
    await this.#graph("POST", `/me/messages/${encodeURIComponent(messageId)}/send`);
    return { sentMessageId: null };
  }

  /**
   * Move junk messages back to the real Inbox folder. Graph's move gives the
   * message a NEW id, so the stored providerMessageId is updated from the
   * response to keep reply/forward/mark-read working.
   * @param {Array<string>} messageIds providerMessageIds
   * @returns {Promise<{ rescued:number, failed:number }>}
   */
  async rescueFromJunk(messageIds = []) {
    const ids = [...new Set((messageIds || []).filter(Boolean))];
    if (!ids.length) return { rescued: 0, failed: 0 };
    await this.#loadUser();

    let rescued = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const moved = await this.#graph("POST", `/me/messages/${encodeURIComponent(id)}/move`, {
          data: { destinationId: "inbox" },
        });
        await EmailAnalysisMail.updateOne(
          { email: this.email, provider: "outlook", providerMessageId: id },
          {
            $set: {
              providerMessageId: moved?.id || id,
              isJunk: false,
              sourceFolder: "inbox",
              junkRescuedAt: new Date(),
            },
            $pull: { labels: "JUNK" },
          }
        );
        rescued += 1;
      } catch (err) {
        failed += 1;
        console.error(`[Outlook] Junk rescue failed for ${id}:`, err.message);
      }
    }
    return { rescued, failed };
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
