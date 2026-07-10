import axios from "axios";
import fs from "fs";
import path from "path";

import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import OutlookAuthService from "./outlook.auth.service";
import syncProgress from "./syncProgress";
import { safeAttachmentFilename } from "../../utils/gmailMessage.util";
import {
  ensureMasterCategories,
  bulkPushCategories,
  pushCategoriesToMessage,
} from "./outlookCategorySync.service";

import Settings from "../../models/settings.model";

const UPLOAD_DIR = path.resolve(__dirname, "../../upload/email-analysis");
const UPLOAD_REL = "server/upload/email-analysis";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Outlook folders we sync, with our sourceFolder tag and the user-doc field
// holding each folder's incremental delta cursor.
const SYNC_FOLDERS = [
  { folder: "inbox", tag: "inbox", cursorField: "deltaLink" },
  { folder: "junkemail", tag: "junk", cursorField: "junkDeltaLink" },
  { folder: "sentitems", tag: "sent", cursorField: "sentDeltaLink" },
  { folder: "drafts", tag: "draft", cursorField: "draftDeltaLink" },
];
const FOLDER_TAG = Object.fromEntries(SYNC_FOLDERS.map((f) => [f.folder, f.tag]));

const escapeODataString = (value = "") => String(value).replace(/'/g, "''");

function addressToString(addr = {}) {
  const email = addr?.emailAddress?.address || "";
  const name = addr?.emailAddress?.name || "";
  if (!email) return name;
  return name && name !== email ? `${name} <${email}>` : email;
}

function addressesToStrings(list = []) {
  return (list || []).map(addressToString).filter(Boolean);
}

function recipientList(list = []) {
  return (list || [])
    .map((address) => (typeof address === "string"
      ? { emailAddress: { address } }
      : { emailAddress: { address: address.email || address.address, name: address.name } }))
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

export default class OutlookMessagesService {
  constructor(email) {
    this.email = email;
    this.user = null;
    this.auth = new OutlookAuthService();
    this.backfillDays = 30;
    this.maxResults = 500;
  }

  async #loadSyncSettings() {
    try {
      const s = await Settings.findOne({ active: true })
        .select("emailAnalysisSyncBackfillDays emailAnalysisSyncMaxResults")
        .lean();
      if (s) {
        if (typeof s.emailAnalysisSyncBackfillDays === "number") {
          this.backfillDays = s.emailAnalysisSyncBackfillDays;
        }
        if (typeof s.emailAnalysisSyncMaxResults === "number") {
          this.maxResults = s.emailAnalysisSyncMaxResults;
        }
      }
    } catch (err) {
      console.warn("[Outlook] Failed to load sync settings, using defaults:", err.message);
    }
  }

  async #loadUser() {
    const user = await EmailAnalysisUser.findOne({
      email: this.email,
      active: true,
      provider: { $in: ["outlook", "microsoft"] },
    });
    if (!user) throw new Error(`No connected Outlook account for ${this.email}`);
    if (!user.refreshToken) throw new Error(`Missing Microsoft refresh token for ${this.email}. Reconnect Outlook.`);
    this.user = user;
    await this.#ensureAccessToken();
  }

  async #ensureAccessToken(force = false) {
    const expiresAt = this.user.expiryDate ? new Date(this.user.expiryDate).getTime() : 0;
    const shouldRefresh = force || !this.user.accessToken || expiresAt < Date.now() + 2 * 60 * 1000;
    if (!shouldRefresh) return this.user.accessToken;

    try {
      const tokens = await this.auth.refreshTokens(this.user.refreshToken);
      this.user.accessToken = tokens.access_token;
      if (tokens.refresh_token) this.user.refreshToken = tokens.refresh_token;
      this.user.scope = tokens.scope;
      this.user.idToken = tokens.id_token;
      this.user.expiryDate = tokens.expiry_date;
      await EmailAnalysisUser.saveData(this.user);
      return this.user.accessToken;
    } catch (err) {
      const detail = err?.response?.data?.error_description || err.message;
      throw new Error(`Outlook token refresh failed: ${detail}`);
    }
  }

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
        },
      });
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 && retry) {
        await this.#ensureAccessToken(true);
        return this.#graph(method, url, { data, params, responseType, retry: false });
      }
      const graphError = err?.response?.data?.error;
      throw new Error(graphError?.message || err.message || "Microsoft Graph request failed.");
    }
  }

  async syncForUser() {
    syncProgress.begin(this.email);
    try {
      await this.#loadSyncSettings();
      await this.#loadUser();
      // Ensure master categories exist before syncing emails
      await this.ensureOutlookMasterCategories();

      const result = this.user.initialSyncDone && this.user.deltaLink
        ? await this.#incrementalSync()
        : await this.#initialSync();
      syncProgress.done();
      return result;
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  async backfillRecent(days) {
    syncProgress.begin(this.email);
    try {
      await this.#loadSyncSettings();
      await this.#loadUser();
      const targetDays = typeof days === "number" ? days : this.backfillDays;
      const messages = await this.#listRecentMessages(targetDays);
      const saved = await this.#saveMessages(messages);
      await this.#reconcileDrafts(messages, targetDays);
      if (!this.user.deltaLink) await this.#baselineDelta();
      this.user.initialSyncDone = true;
      this.user.lastSyncedAt = new Date();
      await EmailAnalysisUser.saveData(this.user);
      syncProgress.done();
      return { mode: "backfill", saved };
    } catch (err) {
      syncProgress.fail(err.message);
      throw err;
    }
  }

  async #initialSync() {
    console.log(`[EmailAnalysis] Outlook initial sync (last ${this.backfillDays}d) for ${this.email}`);
    const messages = await this.#listRecentMessages(this.backfillDays);
    const saved = await this.#saveMessages(messages);
    await this.#reconcileDrafts(messages, this.backfillDays);
    await this.#baselineDelta();
    this.user.initialSyncDone = true;
    this.user.lastSyncedAt = new Date();
    await EmailAnalysisUser.saveData(this.user);
    return { mode: "initial", saved, deltaLink: this.user.deltaLink };
  }

  async #incrementalSync() {
    console.log(`[EmailAnalysis] Outlook incremental sync for ${this.email}`);
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
      console.warn(`[EmailAnalysis] Outlook delta expired for ${this.email}; re-baselining: ${err.message}`);
      await this.#baselineDelta();
      this.user.lastSyncedAt = new Date();
      await EmailAnalysisUser.saveData(this.user);
      return { mode: "rebaseline", saved: 0, deltaLink: this.user.deltaLink };
    }

    const saved = await this.#saveMessages(messages);
    const deleted = await this.#deactivateRemoved(removed);
    this.user.lastSyncedAt = new Date();
    await EmailAnalysisUser.saveData(this.user);
    return { mode: "incremental", saved, deleted, deltaLink: this.user.deltaLink };
  }

  /**
   * Soft-delete mails that were deleted/moved away at the provider (delta
   * `@removed` entries), so drafts discarded or sent in Outlook — and mail
   * deleted there — disappear here too.
   */
  async #deactivateRemoved(removedIds = []) {
    const ids = [...new Set(removedIds.filter(Boolean))];
    if (!ids.length) return 0;
    const res = await EmailAnalysisMail.updateMany(
      { email: this.email, provider: "outlook", providerMessageId: { $in: ids }, active: true },
      { $set: { active: false, removedAt: new Date(), removedReason: "removed-at-provider" } }
    );
    const n = res?.modifiedCount || 0;
    if (n) console.log(`[EmailAnalysis] Outlook: deactivated ${n} provider-removed mail(s) for ${this.email}`);
    return n;
  }

  /**
   * Reconcile drafts against the provider after a full folder listing: any
   * stored draft in the sync window that no longer exists in Outlook's Drafts
   * folder was discarded or sent — deactivate it. Skipped when the listing hit
   * the result cap (the live set would be incomplete).
   */
  async #reconcileDrafts(messages, days) {
    if ((messages || []).length >= this.maxResults) return 0;
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

  async #listRecentMessages(days) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const all = [];

    // Read ALL mail types: inbox, junk, sent and drafts folders.
    for (const { folder, tag } of SYNC_FOLDERS) {
      let url = `/me/mailFolders/${folder}/messages`;
      let params = {
        $top: 50,
        $orderby: "receivedDateTime desc",
        $filter: `receivedDateTime ge ${since}`,
        $select: this.#selectFields(),
      };

      do {
        const data = await this.#graph("GET", url, { params });
        (data.value || []).forEach((m) => {
          m._sourceFolder = tag;
          all.push(m);
        });
        url = data["@odata.nextLink"];
        params = null;
      } while (url && all.length < this.maxResults);
    }

    return all.slice(0, this.maxResults);
  }

  /**
   * Walk a delta feed to its end, collecting non-removed messages (tagged with
   * `_sourceFolder`) into `sink`. Accepts either a stored delta link or a
   * folder name (to start a fresh baseline). Returns the new delta link.
   */
  async #walkDelta(linkOrFolder, sink = [], sourceFolder = null, removed = []) {
    const isFolder = !!FOLDER_TAG[linkOrFolder];
    const folderTag = sourceFolder || FOLDER_TAG[linkOrFolder] || "inbox";
    let url = isFolder ? `/me/mailFolders/${linkOrFolder}/messages/delta` : linkOrFolder;
    let params = isFolder ? { $select: this.#selectFields(), $top: 50 } : null;
    let deltaLink = null;

    do {
      const data = await this.#graph("GET", url, { params });
      (data.value || []).forEach((m) => {
        if (m["@removed"]) {
          if (m.id) removed.push(m.id);
          return;
        }
        m._sourceFolder = folderTag;
        sink.push(m);
      });
      deltaLink = data["@odata.deltaLink"] || deltaLink;
      url = data["@odata.deltaLink"] ? null : data["@odata.nextLink"];
      params = null;
    } while (url);

    return deltaLink;
  }

  async #baselineDelta() {
    for (const { folder, cursorField } of SYNC_FOLDERS) {
      this.user[cursorField] = await this.#walkDelta(folder);
    }
  }

  #selectFields() {
    return [
      "id",
      "conversationId",
      "internetMessageId",
      "subject",
      "body",
      "bodyPreview",
      "from",
      "toRecipients",
      "ccRecipients",
      "bccRecipients",
      "replyTo",
      "receivedDateTime",
      "sentDateTime",
      "hasAttachments",
      "isRead",
      "importance",
      "parentFolderId",
    ].join(",");
  }

  async #saveMessages(messages) {
    const unique = [];
    const seen = new Set();
    for (const message of messages || []) {
      if (!message?.id || seen.has(message.id)) continue;
      seen.add(message.id);
      unique.push(message);
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
          continue;
        }

        const emailObject = this.#formatMessage(message);
        emailObject.body = await this.resolveInlineCidImages(message.id, emailObject.body);
        const attachments = await this.#saveAttachments(emailObject);
        const doc = new EmailAnalysisMail({
          ...emailObject,
          attachments,
          hasAttachments: attachments.length > 0 || !!message.hasAttachments,
          active: true,
        });
        await EmailAnalysisMail.saveData(doc);
        savedCount += 1;
        savedThis = 1;
      } catch (err) {
        if (err?.code !== 11000) {
          console.error(`[EmailAnalysis] Failed to save Outlook message ${message?.id} for ${this.email}:`, err.message);
        }
      } finally {
        syncProgress.tick(savedThis);
      }
    }
    return savedCount;
  }

  #formatMessage(message) {
    const sourceFolder = message._sourceFolder || "inbox";
    const isJunk = sourceFolder === "junk";
    return {
      email: this.email,
      provider: "outlook",
      from: addressToString(message.from),
      to: addressesToStrings(message.toRecipients).join(", "),
      cc: addressesToStrings(message.ccRecipients),
      bcc: addressesToStrings(message.bccRecipients),
      replyTo: addressesToStrings(message.replyTo).join(", "),
      subject: message.subject || "",
      body: htmlOrText(message.body),
      labels: [message.isRead ? "READ" : "UNREAD", message.importance, isJunk ? "JUNK" : null].filter(Boolean),
      sourceFolder,
      isJunk,
      mimeType: message.body?.contentType === "html" ? "text/html" : "text/plain",
      snippet: message.bodyPreview || "",
      providerMessageId: message.id,
      providerUserId: this.user.providerUserId || this.user.microsoftId,
      threadId: message.conversationId,
      receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
      attachments: [],
      hasAttachments: !!message.hasAttachments,
      isRepliedMail: false,
    };
  }

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
      console.error(`[EmailAnalysis] Could not fetch attachments for inline images on ${providerMessageId}:`, err.message);
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

  async #saveAttachments(emailObject) {
    if (!emailObject.hasAttachments) return [];
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const data = await this.#graph("GET", `/me/messages/${encodeURIComponent(emailObject.providerMessageId)}/attachments`);
    const out = [];
    for (const att of data.value || []) {
      const meta = {
        filename: safeAttachmentFilename(att.name),
        mimeType: att.contentType || "application/octet-stream",
        size: att.size || 0,
        saved: false,
      };
      if (att["@odata.type"] !== "#microsoft.graph.fileAttachment" || !att.contentBytes) {
        out.push({ ...meta, error: "Unsupported attachment type" });
        continue;
      }
      try {
        const fileName = `${Date.now()}_${safeAttachmentFilename(emailObject.providerMessageId)}_${meta.filename}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.writeFileSync(filePath, Buffer.from(att.contentBytes, "base64"));
        out.push({ ...meta, saved: true, savedPath: `${UPLOAD_REL}/${fileName}` });
      } catch (err) {
        out.push({ ...meta, error: err.message });
      }
    }
    return out;
  }

  async sendEmails({ to, emails }) {
    await this.#loadUser();
    if (!to) throw new Error("A 'to' address is required.");
    if (!Array.isArray(emails) || !emails.length) throw new Error("No emails to send.");

    const results = [];
    let sent = 0;
    for (let i = 0; i < emails.length; i += 1) {
      const item = emails[i] || {};
      const label = item.subject || item.id || `#${i + 1}`;
      try {
        await this.sendMail({
          to: [to],
          subject: item.subject || "(no subject)",
          html: item.html || item.body || "",
        });
        sent += 1;
        results.push({ id: item.id || i, label, ok: true });
      } catch (err) {
        results.push({ id: item.id || i, label, ok: false, error: err.message });
      }
    }
    return { total: emails.length, sent, failed: emails.length - sent, results };
  }

  async sendMail({ to = [], cc = [], bcc = [], subject = "", html = "", text = "" }) {
    await this.#loadUser();
    const isHtml = !!html;
    await this.#graph("POST", "/me/sendMail", {
      data: {
        message: {
          subject,
          body: { contentType: isHtml ? "HTML" : "Text", content: isHtml ? html : text },
          toRecipients: recipientList(to),
          ccRecipients: recipientList(cc),
          bccRecipients: recipientList(bcc),
        },
        saveToSentItems: true,
      },
    });
    return { sent: true };
  }

  async sendReplyToSource({ sourceId, html }) {
    return this.replyToMessage({ sourceId, html });
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
    if (!mail) throw new Error("Linked email not found for this account.");

    await this.#graph("POST", `/me/messages/${encodeURIComponent(sourceId)}/reply`, {
      data: {
        comment: text || "",
        message: {
          body: { contentType: "HTML", content: html || text },
        },
      },
    });
    const replyTo = mail.replyTo || mail.from;
    return { to: replyTo, subject: mail.subject, threadId: mail.threadId || null, messageId: null };
  }

  async forwardMessage({ sourceId, to = [], comment = "" }) {
    await this.#loadUser();
    if (!sourceId) throw new Error("sourceId is required.");
    await this.#graph("POST", `/me/messages/${encodeURIComponent(sourceId)}/forward`, {
      data: { comment, toRecipients: recipientList(to) },
    });
    return { forwarded: true };
  }

  async trashMessages(messageIds = []) {
    await this.#loadUser();
    let trashed = 0;
    let failed = 0;
    for (const id of [...new Set(messageIds.filter(Boolean))]) {
      try {
        await this.#graph("DELETE", `/me/messages/${encodeURIComponent(id)}`);
        trashed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[EmailAnalysis] Outlook delete failed for ${id}:`, err.message);
      }
    }
    return { trashed, failed };
  }

  async markRead(messageIds = [], isRead = true) {
    await this.#loadUser();
    let updated = 0;
    for (const id of [...new Set(messageIds.filter(Boolean))]) {
      await this.#graph("PATCH", `/me/messages/${encodeURIComponent(id)}`, { data: { isRead } });
      await EmailAnalysisMail.updateOne(
        { email: this.email, provider: "outlook", providerMessageId: id },
        isRead ? { $pull: { labels: "UNREAD" } } : { $addToSet: { labels: "UNREAD" } }
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
        console.error(`[EmailAnalysis] Outlook junk rescue failed for ${id}:`, err.message);
      }
    }
    return { rescued, failed };
  }

  async searchEmails(query, limit = 25) {
    await this.#loadUser();
    if (!query) return [];
    const data = await this.#graph("GET", "/me/messages", {
      params: {
        $search: `"${String(query).replace(/"/g, '\\"')}"`,
        $top: Math.min(Math.max(Number(limit) || 25, 1), 50),
        $select: this.#selectFields(),
      },
    });
    const messages = data.value || [];
    await this.#saveMessages(messages);
    return messages.map((m) => this.#formatMessage(m));
  }

  async getConversation(conversationId) {
    await this.#loadUser();
    if (!conversationId) return [];
    const data = await this.#graph("GET", "/me/messages", {
      params: {
        $filter: `conversationId eq '${escapeODataString(conversationId)}'`,
        $orderby: "receivedDateTime asc",
        $select: this.#selectFields(),
      },
    });
    return (data.value || []).map((m) => this.#formatMessage(m));
  }

  async fetchFullBody(providerMessageId) {
    await this.#loadUser();
    const data = await this.#graph("GET", `/me/messages/${encodeURIComponent(providerMessageId)}`, {
      params: { $select: "id,body,bodyPreview" },
    });
    const body = await this.resolveInlineCidImages(providerMessageId, htmlOrText(data.body));
    return {
      body,
      snippet: data.bodyPreview || "",
      mimeType: data.body?.contentType === "html" ? "text/html" : "text/plain",
    };
  }

  /* ─── Outlook category label sync ─── */

  /**
   * Ensure our custom master categories exist in the user's Outlook account.
   * Call once per session / after first sync. Best-effort.
   */
  async ensureOutlookMasterCategories() {
    await this.#loadUser();
    await ensureMasterCategories(this.#graph.bind(this), this.email);
  }

  /**
   * Push AI category labels back to a single Outlook message.
   *
   * @param {string} providerMessageId
   * @param {{ priority, category, intent, needsReply }} fields
   * @returns {Promise<{ pushed: boolean, labels: string[] }>}
   */
  async pushCategories(providerMessageId, fields) {
    await this.#loadUser();
    return pushCategoriesToMessage(this.#graph.bind(this), providerMessageId, fields);
  }

  /**
   * Bulk-push AI category labels for multiple messages after the prioritize pass.
   * Each item: { providerMessageId, priority, category, intent, needsReply }
   *
   * @param {Array} items
   * @returns {Promise<{ pushed: number, failed: number }>}
   */
  async bulkPushCategories(items = []) {
    await this.#loadUser();
    return bulkPushCategories(this.#graph.bind(this), items);
  }
}
