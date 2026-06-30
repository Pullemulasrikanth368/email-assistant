/**@Packages */
import fs from "fs";
import path from "path";

/**@Config */
import config from "../../config/config";

// Where email-analysis attachments are stored on disk (mirrors the service).
const ATTACHMENT_DIR = path.resolve(__dirname, "../../upload/email-analysis");

/**@OAuth + Service */
import googleEmailAnalysisOAuth from "../auth/googleEmailAnalysis.oauth";
import EmailAnalysisAuthService from "../services/emailAnalysis.auth.service";
import OutlookAuthService from "../services/outlook.auth.service";
import { createMailService } from "../services/mailProvider.service";

/**@Report engine + scheduling */
import reportService from "../services/report.service";
import prioritizeService from "../services/prioritize.service";
import analyticsService from "../services/analytics.service";
import syncProgress from "../services/syncProgress";
import aiClient from "../services/aiClient";
import { rescheduleReportCron } from "../jobs/report.job";

/**@Models (shared) */
import Settings from "../../models/settings.model";

/**@Models */
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import EmailAnalysisMail from "../models/emailAnalysisMail.model";
import EmailAnalysisReport from "../models/emailAnalysisReport.model";
import OutlookUser from "../../microsoft/models/outlookUser.model";

/**@KB + ReportConfig services */
import kbService from "../services/knowledgeBase.service";
import reportConfigService from "../services/reportConfig.service";

/**
 * Convert a stored attachment savedPath ("server/upload/email-analysis/<file>")
 * into a public URL. The server serves <server>/server/upload at "/images".
 */
function attachmentUrl(savedPath) {
  if (!savedPath) return "";
  const rel = String(savedPath).replace(/^server\/upload\//, "");
  const base = String(config.serverUrl || "").replace(/\/+$/, "");
  return `${base}/images/${rel}`;
}

function mapAttachments(attachments = []) {
  return attachments.map(att => ({
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    saved: att.saved,
    url: att.saved ? attachmentUrl(att.savedPath) : "",
  }));
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Kick off a mail sync for the connected account without blocking the caller.
 * First link backfills the last 7 days; later runs are incremental via history.
 */
function triggerMailSync(email) {
  createMailService(email)
    .then((service) => service.syncForUser())
    .then(async (result) => {
      // Assign an intent-based priority to the newly synced mail (per day).
      try {
        await prioritizeService.prioritizePendingForAccount(email);
      } catch (err) {
        console.error(`[EmailAnalysis] Prioritization failed for ${email}:`, err.message);
      }
      // After the FIRST read (initial backfill), generate the last-day report.
      if (result?.mode === "initial") {
        return reportService.generateReportForLatestAccount(email);
      }
      return null;
    })
    .catch((err) => {
      console.error(`[EmailAnalysis] Mail sync / report failed for ${email}:`, err.message);
    });
}

/**
 * Build the origin (scheme + host) of the admin frontend so we can redirect
 * back to the Connections & Delivery screen after the OAuth round-trip.
 * FRONTENDURL may include a path (e.g. ".../adminSettings"), so strip it.
 */
function getFrontendOrigin() {
  try {
    return new URL(config.frontendUrl).origin;
  } catch (e) {
    return config.frontendUrl || "";
  }
}

/**
 * STEP 1 - Start the email-analysis Google consent flow.
 * Redirects the browser to Google. The dedicated redirect URI must be
 * registered in the Google Cloud console.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function emailAnalysisGoogleLogin(req, res) {
  // purpose=send -> connect only to SEND bulk mail (no reading/syncing).
  // login=<admin email> -> who is connecting, so the inbox can be scoped to it.
  const purpose = req.query?.purpose === "send" ? "send" : "source";
  const login = String(req.query?.login || "").trim();
  // state carries both, separated by "::" (login may be empty).
  const state = `${purpose}::${login}`;
  const url = googleEmailAnalysisOAuth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    redirect_uri: config.emailAnalysisRedirectUri,
    // Full mailbox access: read for analysis + send/modify so we can send
    // mail from here in future. (https://mail.google.com/ covers read + send + modify.)
    scope: [
      "https://mail.google.com/",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ],
  });
  return res.redirect(url);
}

/**
 * STEP 2 - Webhook hit by Google after consent.
 * Exchanges the code, then upserts the account into `email_analysis_user`.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function emailAnalysisGoogleWebhook(req, res) {
  const origin = getFrontendOrigin();
  try {
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${origin}/connectionsDelivery?emailAnalysis=error`);
    }

    // state = "<purpose>::<loginEmail>" (see emailAnalysisGoogleLogin).
    const [statePurpose = "source", stateLogin = ""] = String(req.query.state || "").split("::");
    const purpose = statePurpose === "send" ? "send" : "source";
    const loginUserEmailId = (stateLogin || "").trim() || null;

    const service = new EmailAnalysisAuthService();
    const data = await service.authenticate(code);

    /**@Upsert - one connected account per email */
    let user = await EmailAnalysisUser.findOne({ email: data.email });
    if (!user) {
      user = new EmailAnalysisUser({ email: data.email });
    }

    user.name = data.name;
    user.picture = data.picture;
    user.googleId = data.googleId;
    user.providerUserId = data.googleId;
    user.provider = "google";
    user.purpose = purpose;
    if (loginUserEmailId) user.loginUserEmailId = loginUserEmailId;
    user.accessToken = data.access_token;
    if (data.refresh_token) user.refreshToken = data.refresh_token;
    user.scope = data.scope;
    user.idToken = data.id_token;
    user.expiryDate = data.expiry_date;
    user.active = true;

    await EmailAnalysisUser.saveData(user);

    if (purpose === "send") {
      // Send-only account: do NOT read/sync. Return to the bulk-send screen.
      return res.redirect(`${origin}/bulkEmailSend?account=connected`);
    }

    // Source account: start reading the user's mail (non-blocking).
    triggerMailSync(data.email);
    return res.redirect(`${origin}/connectionsDelivery?emailAnalysis=connected`);
  } catch (err) {
    console.error("emailAnalysisGoogleWebhook error:", err);
    return res.redirect(`${origin}/connectionsDelivery?emailAnalysis=error`);
  }
}

async function emailAnalysisOutlookLogin(req, res) {
  const purpose = req.query?.purpose === "send" ? "send" : "source";
  const login = String(req.query?.login || "").trim();
  const state = `${purpose}::${login}`;
  const service = new OutlookAuthService();
  return res.redirect(service.getAuthUrl(state));
}

async function emailAnalysisOutlookWebhook(req, res) {
  const origin = getFrontendOrigin();
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${origin}/connectionsDelivery?outlook=error`);

    const [statePurpose = "source", stateLogin = ""] = String(req.query.state || "").split("::");
    const purpose = statePurpose === "send" ? "send" : "source";
    const loginUserEmailId = (stateLogin || "").trim() || null;

    const service = new OutlookAuthService();
    const data = await service.authenticate(code);

    let user = await EmailAnalysisUser.findOne({ email: data.email, provider: "outlook" });
    if (!user) user = new EmailAnalysisUser({ email: data.email });

    user.name = data.name;
    user.picture = "";
    user.microsoftId = data.microsoftId;
    user.providerUserId = data.providerUserId || data.microsoftId;
    user.provider = "outlook";
    user.purpose = purpose;
    if (loginUserEmailId) user.loginUserEmailId = loginUserEmailId;
    user.accessToken = data.access_token;
    if (data.refresh_token) user.refreshToken = data.refresh_token;
    user.scope = data.scope;
    user.idToken = data.id_token;
    user.expiryDate = data.expiry_date;
    user.active = true;

    await EmailAnalysisUser.saveData(user);

    if (purpose === "send") {
      return res.redirect(`${origin}/bulkEmailSend?account=connected`);
    }

    triggerMailSync(data.email);
    return res.redirect(`${origin}/connectionsDelivery?outlook=connected`);
  } catch (err) {
    console.error("emailAnalysisOutlookWebhook error:", err);
    return res.redirect(`${origin}/connectionsDelivery?outlook=error`);
  }
}

/**
 * Return the currently connected email-analysis account (if any).
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function emailAnalysisStatus(req, res) {
  const user = await EmailAnalysisUser.findOne({ active: true, purpose: { $ne: "send" } }).sort({ updatedAt: -1 });
  if (user) {
    return res.json({ connected: true, email: user.email, name: user.name, picture: user.picture, provider: user.provider });
  }
  return res.json({ connected: false });
}

async function emailAnalysisProviderStatus(req, res) {
  const provider = req.params.provider || req.query.provider || (req.path?.includes("outlook") ? "outlook" : "");
  const providerQuery = provider === "outlook" ? { $in: ["outlook", "microsoft"] } : provider;
  const user = await EmailAnalysisUser.findOne({
    active: true,
    provider: providerQuery,
    purpose: { $ne: "send" },
  }).sort({ updatedAt: -1 });
  if (user) {
    return res.json({ connected: true, email: user.email, name: user.name, picture: user.picture, provider: user.provider });
  }
  return res.json({ connected: false, provider });
}

/**
 * List ALL connected email-analysis accounts (most recent first), for the
 * "send from" picker on the bulk-send screen.
 */
async function listEmailAnalysisAccounts(req, res) {
  const users = await EmailAnalysisUser.find({ active: true })
    .sort({ updatedAt: -1 })
    .select("email name picture provider purpose")
    .lean();
  return res.json({ accounts: users.map((u) => ({ email: u.email, name: u.name, picture: u.picture, provider: u.provider, purpose: u.purpose })) });
}

/**
 * Delete the saved attachment files for a set of mails (best-effort).
 * @returns {number} count of files removed
 */
function deleteAttachmentFiles(mails = []) {
  let deletedFiles = 0;
  for (const mail of mails) {
    for (const att of mail.attachments || []) {
      if (!att?.savedPath) continue;
      try {
        const filePath = path.join(ATTACHMENT_DIR, path.basename(att.savedPath));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedFiles += 1;
        }
      } catch (err) {
        console.error(`[EmailAnalysis] Failed to delete attachment file:`, err.message);
      }
    }
  }
  return deletedFiles;
}

/**
 * Disconnect (remove) an email-analysis account.
 * Body:
 *   email      - account to remove (required)
 *   purgeData  - when true, also delete all synced mails + attachment files
 *                for this account from our collections.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function disconnectEmailAnalysisAccount(req, res) {
  const { email, purgeData, provider } = req.body || {};
  if (!email) {
    return res.json({ errorCode: 9001, errorMessage: "Please provide an email." });
  }

  const accountQuery = { email };
  if (provider) accountQuery.provider = provider === "outlook" ? { $in: ["outlook", "microsoft"] } : provider;
  const removedAccount = await EmailAnalysisUser.findOne(accountQuery).lean();
  const result = await EmailAnalysisUser.deleteOne(accountQuery);
  if (!result || result.deletedCount === 0) {
    return res.json({ errorCode: 9001, errorMessage: "Email not matched." });
  }

  // Default: keep the already-synced data, only drop the connection.
  if (!purgeData) {
    return res.json({
      respCode: 200,
      respMessage: "Account disconnected. Synced emails were kept.",
      deletedMails: 0,
      deletedFiles: 0,
    });
  }

  // Purge: remove attachment files first, then the mail documents.
  const mailQuery = { email };
  if (removedAccount?.provider) mailQuery.provider = removedAccount.provider === "google" ? "gmail" : removedAccount.provider;
  const mails = await EmailAnalysisMail.find(mailQuery, { attachments: 1 }).lean();
  const deletedFiles = deleteAttachmentFiles(mails);
  const mailResult = await EmailAnalysisMail.deleteMany(mailQuery);
  const deletedMails = mailResult?.deletedCount || 0;

  return res.json({
    respCode: 200,
    respMessage: `Account removed with data. Deleted ${deletedMails} email(s) and ${deletedFiles} attachment file(s).`,
    deletedMails,
    deletedFiles,
  });
}

/**
 * Manually trigger a mail sync for a connected account (initial or incremental).
 * Body: { email } — defaults to the most recently connected account.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function syncEmailAnalysisMails(req, res) {
  let email = req.body?.email;
  if (!email) {
    // Check EmailAnalysisUser first, then fall back to OutlookUser
    const eaUser = await EmailAnalysisUser.findOne({ active: true }).sort({ updatedAt: -1 });
    email = eaUser?.email;
    if (!email) {
      const OutlookUser = (await import("../microsoft/models/outlookUser.model")).default;
      const msUser = await OutlookUser.findOne({ active: true }).sort({ updatedAt: -1 });
      email = msUser?.email;
    }
  }
  if (!email) {
    return res.json({ errorCode: 9001, errorMessage: "No connected account to sync." });
  }

  const service = await createMailService(email);
  const result = await service.syncForUser();

  // Prioritize any newly synced emails (best-effort, non-blocking for the response)
  prioritizeService.prioritizePendingForAccount(email, { force: false })
    .catch((err) => console.error(`[EmailAnalysis] Post-sync prioritize failed for ${email}:`, err.message));

  return res.json({ respCode: 200, respMessage: "Sync completed.", result });
}

/**
 * Extract an array of email objects from an uploaded .js module's source text.
 * Accepts the mockEmails.js shape — `export const mockEmails = [ ... ]` and/or
 * `export default [...]`.
 *
 * NOTE: evaluates the file body in a Function scope. This is an admin-only
 * seeding tool meant for trusted demo fixtures, not arbitrary user uploads.
 */
function parseEmailsFromSource(source = "") {
  const nameMatch = String(source).match(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*\[/);
  const target = nameMatch ? nameMatch[1] : null;
  const code = String(source)
    .replace(/import\s*\.\s*meta/g, '({url:""})')        // neutralize ESM-only import.meta
    .replace(/^\s*import\s[^\n;]*;?\s*$/gm, "")           // strip ES import statement lines only
    .replace(/export\s+default\s+/g, "var __default__ = ")
    .replace(/export\s+(const|let|var)\s+/g, "$1 ")      // strip named export keyword
    .replace(/export\s*\{[\s\S]*?\};?/g, "");            // drop export { ... }

  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict";
    var process = { argv: [] };
    ${code}
    ${target ? `try { if (typeof ${target} !== 'undefined') return ${target}; } catch (e) {}` : ""}
    if (typeof __default__ !== 'undefined') return __default__;
    return undefined;`);
  const result = fn();
  if (!Array.isArray(result)) {
    throw new Error("Could not find an exported array of emails in the uploaded file.");
  }
  return result;
}

/**
 * Bulk-send (seed) emails through the connected email-analysis Gmail account.
 * Body: { to, source?, emails?, email? }
 *   - to      : recipient address for every message (required)
 *   - emails  : pre-parsed array of email objects (preferred), OR
 *   - source  : raw .js module text to parse server-side
 *   - email   : which connected account to send from (defaults to most recent)
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function bulkSendEmails(req, res) {
  const to = String(req.body?.to || "").trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.json({ errorCode: 9007, errorMessage: "Provide a valid 'to' email address." });
  }

  let emails = Array.isArray(req.body?.emails) ? req.body.emails : null;
  if (!emails) {
    try {
      emails = parseEmailsFromSource(req.body?.source || "");
    } catch (err) {
      return res.json({ errorCode: 9008, errorMessage: err.message });
    }
  }
  if (!emails.length) {
    return res.json({ errorCode: 9008, errorMessage: "No emails found to send." });
  }

  const email = await resolveAccount(req.body?.email);
  if (!email) {
    return res.json({ errorCode: 9001, errorMessage: "No connected account to send from." });
  }

  const service = await createMailService(email);
  const summary = await service.sendEmails({ to, emails });
  return res.json({
    respCode: 200,
    respMessage: `Sent ${summary.sent} of ${summary.total} email(s) to ${to}.`,
    from: email,
    to,
    ...summary,
  });
}

/**
 * List analyzed mails (paginated, searchable, sorted).
 * Query: ?filter={ page, limit, sortfield, direction, search, email }
 * Returns { mails, pagination: { totalCount, page, limit } }.
 * The heavy `body` field is excluded from the list for performance.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function listEmailAnalysisMails(req, res) {
  let filter = {};
  try {
    filter = req.query.filter ? JSON.parse(req.query.filter) : {};
  } catch (e) {
    filter = {};
  }

  const page = Math.max(parseInt(filter.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 25, 1), 100);
  const sortfield = filter.sortfield || "receivedAt";
  const direction = filter.direction === "asc" ? 1 : -1;
  const search = (filter.search || req.query.search || "").trim();

  // Always scope to ONE connected account: the explicit filter email, otherwise
  // the account currently connected in Settings (most-recently connected).
  // `active: true` also keeps soft-deleted (cleaned-up) mail out of the inbox.
  const account = filter.email || await resolveAccount(null, filter.loginUserEmailId, filter.provider);
  if (!account) {
    return res.json({ mails: [], pagination: { totalCount: 0, page, limit } });
  }

  const query = { active: true, email: account };
  if (filter.provider) query.provider = filter.provider === "google" ? "gmail" : filter.provider;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ subject: rx }, { from: rx }, { to: rx }, { snippet: rx }];
  }

  const [totalCount, mails] = await Promise.all([
    EmailAnalysisMail.countDocuments(query),
    EmailAnalysisMail.find(query, { body: 0 })
      .sort({ [sortfield]: direction })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const mapped = mails.map(m => ({
    ...m,
    attachments: mapAttachments(m.attachments),
  }));

  return res.json({
    mails: mapped,
    pagination: { totalCount, page, limit },
  });
}

/**
 * Get a single analyzed mail by id (full body + attachment URLs).
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function getEmailAnalysisMail(req, res) {
  const mail = await EmailAnalysisMail.findOne({ _id: req.params.id, active: true }).lean();
  if (!mail) {
    return res.json({ errorCode: 9002, errorMessage: "Mail not found." });
  }
  mail.attachments = mapAttachments(mail.attachments);
  return res.json({ mail });
}

async function sendMail(req, res) {
  const email = await resolveAccount(req.body?.email, req.body?.loginUserEmailId, req.body?.provider);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });

  try {
    const service = await createMailService(email);
    const sent = await service.sendMail({
      to: req.body?.to || [],
      cc: req.body?.cc || [],
      bcc: req.body?.bcc || [],
      subject: req.body?.subject || "",
      html: req.body?.html || "",
      text: req.body?.text || req.body?.body || "",
    });
    return res.json({ respCode: 200, respMessage: "Email sent.", sent });
  } catch (err) {
    return res.json({ errorCode: 9101, errorMessage: err.message });
  }
}

async function replyMail(req, res) {
  const sourceId = String(req.body?.sourceId || "").trim();
  const email = await resolveAccount(req.body?.email, req.body?.loginUserEmailId, req.body?.provider);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  if (!sourceId) return res.json({ errorCode: 9102, errorMessage: "sourceId is required." });

  try {
    const service = await createMailService(email);
    const sent = await service.sendReplyToSource({
      sourceId,
      html: req.body?.html || req.body?.body || "",
      text: req.body?.text || "",
    });
    return res.json({ respCode: 200, respMessage: "Reply sent.", sent });
  } catch (err) {
    return res.json({ errorCode: 9103, errorMessage: err.message });
  }
}

async function forwardMail(req, res) {
  const sourceId = String(req.body?.sourceId || "").trim();
  const email = await resolveAccount(req.body?.email, req.body?.loginUserEmailId, req.body?.provider);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  if (!sourceId) return res.json({ errorCode: 9104, errorMessage: "sourceId is required." });

  try {
    const service = await createMailService(email);
    const forwarded = await service.forwardMessage({
      sourceId,
      to: req.body?.to || [],
      comment: req.body?.comment || req.body?.body || "",
    });
    return res.json({ respCode: 200, respMessage: "Email forwarded.", forwarded });
  } catch (err) {
    return res.json({ errorCode: 9105, errorMessage: err.message });
  }
}

async function deleteMails(req, res) {
  const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds : [req.body?.sourceId || req.body?.messageId].filter(Boolean);
  const email = await resolveAccount(req.body?.email, req.body?.loginUserEmailId, req.body?.provider);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });

  try {
    const service = await createMailService(email);
    const result = await service.trashMessages(messageIds);
    await EmailAnalysisMail.updateMany(
      { email, providerMessageId: { $in: messageIds } },
      { $set: { active: false, removedAt: new Date(), removedReason: "deleted" } }
    );
    return res.json({ respCode: 200, respMessage: "Email deleted.", result });
  } catch (err) {
    return res.json({ errorCode: 9106, errorMessage: err.message });
  }
}

async function markMailReadState(req, res) {
  const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds : [req.body?.sourceId || req.body?.messageId].filter(Boolean);
  const email = await resolveAccount(req.body?.email, req.body?.loginUserEmailId, req.body?.provider);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });

  try {
    const service = await createMailService(email);
    const result = await service.markRead(messageIds, req.body?.isRead !== false);
    return res.json({ respCode: 200, respMessage: "Email updated.", result });
  } catch (err) {
    return res.json({ errorCode: 9107, errorMessage: err.message });
  }
}

async function searchProviderMails(req, res) {
  const q = String(req.query.q || req.query.search || "").trim();
  const limit = parseInt(req.query.limit, 10) || 25;
  const email = await resolveAccount(req.query.email, req.query.loginUserEmailId, req.query.provider);
  if (!email) return res.json({ mails: [], pagination: { totalCount: 0, page: 1, limit } });
  if (!q) return res.json({ mails: [], pagination: { totalCount: 0, page: 1, limit } });

  try {
    const service = await createMailService(email);
    const mails = await service.searchEmails(q, limit);
    return res.json({ mails: mails.map((m) => ({ ...m, attachments: mapAttachments(m.attachments || []) })), pagination: { totalCount: mails.length, page: 1, limit } });
  } catch (err) {
    return res.json({ errorCode: 9108, errorMessage: err.message });
  }
}

async function getMailConversation(req, res) {
  const mail = await EmailAnalysisMail.findOne({ _id: req.params.id, active: true }).lean();
  if (!mail) return res.json({ errorCode: 9002, errorMessage: "Mail not found." });

  try {
    const service = await createMailService(mail.email);
    const mails = await service.getConversation(mail.threadId);
    return res.json({ mails: mails.map((m) => ({ ...m, attachments: mapAttachments(m.attachments || []) })) });
  } catch (err) {
    return res.json({ errorCode: 9109, errorMessage: err.message });
  }
}

async function downloadAttachment(req, res) {
  const mail = await EmailAnalysisMail.findOne({ _id: req.params.id, active: true }).lean();
  if (!mail) return res.status(404).json({ errorCode: 9002, errorMessage: "Mail not found." });

  const attachment = (mail.attachments || []).find((a) => a.savedPath && path.basename(a.savedPath) === req.params.file);
  if (!attachment) return res.status(404).json({ errorCode: 9110, errorMessage: "Attachment not found." });

  const filePath = path.join(ATTACHMENT_DIR, path.basename(attachment.savedPath));
  if (!fs.existsSync(filePath)) return res.status(404).json({ errorCode: 9111, errorMessage: "Attachment file not found." });
  return res.download(filePath, attachment.filename || path.basename(filePath));
}

/* ============================ REPORTS ============================ */

/** Resolve the SOURCE account to operate on. Priority:
 *  1) explicit email, 2) the source account THIS logged-in admin connected
 *  (loginUserEmailId), 3) the most-recent source account. Send-only
 *  (bulk-send) accounts are never picked as a source. */
async function resolveAccount(email, loginUserEmailId, provider) {
  if (email) return email;
  const base = { active: true, purpose: { $ne: "send" } };
  if (provider) {
    base.provider = provider === "outlook" ? { $in: ["outlook", "microsoft"] } : provider;
  }
  if (loginUserEmailId) {
    const own = await EmailAnalysisUser.findOne({ ...base, loginUserEmailId })
      .sort({ updatedAt: -1 }).lean();
    if (own?.email) return own.email;
  }
  const user = await EmailAnalysisUser.findOne(base).sort({ updatedAt: -1 }).lean();
  if (user?.email) return user.email;

  // Fallback: check OutlookUser collection (emails synced via microsoft.controller)
  if (!provider || provider === "outlook" || provider === "microsoft") {
    const outlookUser = await OutlookUser.findOne({ active: true, purpose: { $ne: "send" } })
      .sort({ updatedAt: -1 }).lean();
    if (outlookUser?.email) return outlookUser.email;
  }

  return null;
}

/**
 * Force-generate (or regenerate) a day report.
 * Body: { email?, date? } — date selects the day; defaults to the latest day.
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function generateEmailAnalysisReport(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) {
    return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  }

  // Weekly: idempotent — won't regenerate an already-built week unless forced.
  if (req.body?.type === "week") {
    // Sync + prioritize first (unless targeting a historical week) so the
    // weekly rollup — and the dashboards/reports that read the same mail — all
    // reflect the latest inbox.
    if (!req.body?.date) {
      await reportService.syncAndPrioritize(email);
    }
    const { report, created } = await reportService.generateWeeklyReport(email, {
      date: req.body?.date,
      force: !!req.body?.force,
    });
    return res.json({
      respCode: 200,
      created,
      respMessage: created ? "Weekly report generated." : "Weekly report already exists for this week.",
      report,
    });
  }

  // Daily: sync first, then regenerate on demand (brief always reflects fresh mail).
  // A specific historical date is just regenerated (no point syncing the past).
  const report = req.body?.date
    ? await reportService.generateDailyReport(email, { date: req.body.date, force: true })
    : await reportService.generateDailyReportWithSync(email);
  return res.json({ respCode: 200, created: true, respMessage: "Report generated.", report });
}

/**
 * List reports (day or week) for the report screen's master list.
 * Query: ?type=day|week&email=&limit=
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function listEmailAnalysisReports(req, res) {
  const reportType = req.query.type === "week" ? "week" : "day";
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 90);
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ reports: [] });

  const reports = await EmailAnalysisReport.find(
    { email, reportType, active: true },
    // exclude the heavy brief body from the list; cards use counts/label
    { brief: 0 }
  ).sort({ periodStart: -1 }).limit(limit).lean();

  return res.json({ reports });
}

/**
 * Get one full report. `id` may be a report _id or the literal "latest".
 * @param { import('express').Request } req
 * @param { import('express').Response } res
 */
async function getEmailAnalysisReport(req, res) {
  const { id } = req.params;
  let report;
  if (!id || id === "latest") {
    const email = await resolveAccount(req.query.email);
    if (!email) return res.json({ errorCode: 9002, errorMessage: "No connected account." });
    report = await EmailAnalysisReport.findOne({ email, reportType: "day", active: true })
      .sort({ periodStart: -1 }).lean();
  } else {
    report = await EmailAnalysisReport.findOne({ _id: id, active: true }).lean();
  }
  if (!report) return res.json({ errorCode: 9002, errorMessage: "Report not found." });
  return res.json({ report });
}

/**
 * Get the configured brief generation time (24h "HH:mm").
 */
async function getBriefTime(req, res) {
  const settings = await Settings.findOne({ active: true }).select("emailAnalysisBriefTime").lean();
  return res.json({ briefTime: settings?.emailAnalysisBriefTime || "06:00" });
}

/**
 * Update the brief generation time and reschedule the cron immediately.
 * Body: { briefTime: "HH:mm" } (24h).
 */
async function setBriefTime(req, res) {
  const briefTime = String(req.body?.briefTime || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(briefTime)) {
    return res.json({ errorCode: 9003, errorMessage: "Provide briefTime as 24h HH:mm." });
  }
  const settings = await Settings.findOne({ active: true });
  if (!settings) {
    return res.json({ errorCode: 9003, errorMessage: "Settings not found." });
  }
  settings.emailAnalysisBriefTime = briefTime;
  await Settings.saveData(settings);

  // Re-arm the cron right away so the new time takes effect without a restart.
  const expr = await rescheduleReportCron();
  return res.json({ respCode: 200, respMessage: "Brief time updated.", briefTime, cron: expr });
}

// Throttle background brief triggers from the dashboard (per account).
const briefTriggerAt = new Map();
const BRIEF_TRIGGER_COOLDOWN_MS = 5 * 60 * 1000;

function seriesIsEmpty(series) {
  if (!series) return true;
  const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0);
  return sum(series.crit) + sum(series.imp) + sum(series.low) + sum(series.junk) === 0;
}

/**
 * Operations Command Center analytics for the dashboard.
 * Query: ?email= (optional, defaults to most-recent account).
 *
 * If the week view has no data, kick off a sync+brief in the BACKGROUND (so the
 * matrix/series get populated) and tell the client we're generating, without
 * blocking this response. Throttled per account.
 */
async function getEmailAnalysisAnalytics(req, res) {
  const email = await resolveAccount(req.query.email, req.query.loginUserEmailId);
  const data = await analyticsService.getAnalytics(email);

  let generating = false;
  if (email && seriesIsEmpty(data.week)) {
    const last = briefTriggerAt.get(email) || 0;
    if (Date.now() - last > BRIEF_TRIGGER_COOLDOWN_MS) {
      briefTriggerAt.set(email, Date.now());
      generating = true;
      // fire-and-forget: sync + prioritize + brief
      reportService.generateDailyReportWithSync(email)
        .then(() => console.log(`[EmailAnalysis] Background brief generated for ${email} (empty week view)`))
        .catch((err) => console.error(`[EmailAnalysis] Background brief failed for ${email}:`, err.message));
    } else {
      generating = true; // a recent trigger is still in flight
    }
  }

  return res.json({ respCode: 200, generating, ...data });
}

/**
 * Generate a rich HTML reply for an action/todo's linked email.
 * Uses the email content + the (now completed) task so the reply is specific.
 */
async function generateReplyHtml(mail, task) {
  const plainBody = String(mail.body || mail.snippet || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);

  const messages = [
    {
      role: "system",
      content:
        "You are the executive assistant to a VP of Manufacturing Operations at a pharmaceutical company. " +
        "Write a professional, warm, specific email reply in clean semantic HTML — use <p>, <ul>/<li>, and <strong> where helpful. " +
        "Do NOT include <html>, <head>, <body> tags, a subject line, or markdown. Keep it 2–4 short paragraphs. " +
        "Sign off as 'Office of the VP, Manufacturing Operations'.",
    },
    {
      role: "user",
      content:
        `Write a reply to the email below. The linked action item "${task || "the requested action"}" has just been completed/handled. ` +
        "Acknowledge their message specifically, confirm the action is done (or being actioned), reference concrete details from their email, " +
        "and add a sensible next step or reassurance where appropriate.\n\n" +
        `ORIGINAL EMAIL\nFrom: ${mail.from || ""}\nSubject: ${mail.subject || ""}\n\n${plainBody}`,
    },
  ];

  const html = await aiClient.chatCompletion(messages);
  return String(html || "").trim();
}

/** Mark the matching todo as Completed in the stored report (best-effort). */
async function markTodoCompleted({ email, reportId, sourceId, task }) {
  const report = reportId
    ? await EmailAnalysisReport.findOne({ _id: reportId, active: true })
    : await EmailAnalysisReport.findOne({ email, reportType: "day", active: true }).sort({ periodStart: -1 });
  if (!report?.brief?.todoList) return false;

  let changed = false;
  report.brief.todoList = report.brief.todoList.map((t) => {
    if (t.sourceId === sourceId && (!task || t.task === task)) {
      changed = true;
      return { ...t, status: "Completed", completedAt: new Date() };
    }
    return t;
  });
  if (changed) {
    report.markModified("brief");
    await report.save();
  }
  return changed;
}

/**
 * Complete an action/todo: generate a rich AI reply from the linked email and
 * send it on that email's thread, then mark the todo completed in the report.
 * Body: { sourceId, task?, reportId?, email? }
 */
async function completeActionItem(req, res) {
  const sourceId = String(req.body?.sourceId || "").trim();
  const task = String(req.body?.task || "").trim();
  if (!sourceId) {
    return res.json({ errorCode: 9201, errorMessage: "sourceId is required." });
  }

  const email = await resolveAccount(req.body?.email);
  if (!email) {
    return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  }

  const mail = await EmailAnalysisMail.findOne({ email, providerMessageId: sourceId, active: true }).lean();
  if (!mail) {
    return res.json({ errorCode: 9202, errorMessage: "Linked email not found for this account." });
  }

  let html;
  try {
    html = await generateReplyHtml(mail, task);
    if (!html) throw new Error("Empty reply generated.");
  } catch (err) {
    return res.json({ errorCode: 9203, errorMessage: `Could not generate reply: ${err.message}` });
  }

  let sent;
  try {
    const service = await createMailService(email);
    sent = await service.sendReplyToSource({ sourceId, html });
  } catch (err) {
    return res.json({ errorCode: 9204, errorMessage: `Could not send reply: ${err.message}` });
  }

  let completed = false;
  try {
    completed = await markTodoCompleted({ email, reportId: req.body?.reportId, sourceId, task });
  } catch (err) {
    console.error("[EmailAnalysis] Could not persist todo completion:", err.message);
  }

  return res.json({
    respCode: 200,
    respMessage: `Reply sent to ${sent.to}.`,
    completed,
    sent,
    replyHtml: html,
  });
}

/** Strip HTML/whitespace to feed an email body into a prompt. */
function toPlain(s) {
  return String(s || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtmlText(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Resolve a mail for the account by sourceId (providerMessageId) or _id. */
async function findAccountMail(email, { sourceId, id }) {
  const query = { active: true };
  if (email) query.email = email;
  if (sourceId) {
    query.providerMessageId = sourceId;
    return EmailAnalysisMail.findOne(query).lean();
  }
  if (id) {
    query._id = id;
    return EmailAnalysisMail.findOne(query).lean();
  }
  return null;
}

/**
 * Generate one-click quick-reply options tailored to a single email's content.
 * Returns { eligible, options:[{label, reply}] } — label is 1–2 words for the
 * button, reply is the actual one-line message that gets sent.
 */
async function generateQuickReplies(mail) {
  const plain = toPlain(mail.body || mail.snippet || "").slice(0, 3000);
  const prompt =
    `You generate ONE-CLICK quick-reply buttons for the email below.\n` +
    `Return ONLY JSON: {"eligible": boolean, "options": [{"label": string, "reply": string}]}\n\n` +
    `RULES:\n` +
    `- eligible = true ONLY if the email expects a short answer: a yes/no question, a scheduling/availability ask, ` +
    `a "please confirm"/"is this correct?" check, a request needing acknowledgement, or a thanks that warrants a brief reply.\n` +
    `- Give 3-5 options that MATCH what THIS email is actually asking. Examples (do NOT just copy):\n` +
    `a scheduling question -> "Yes" / "No" / "Maybe"; a "please confirm" -> "Correct" / "Not correct";\n` +
    `an FYI needing acknowledgement -> "Got it" / "Thanks".\n` +
    `- "label": 1-2 words for the button. "reply": a natural one-line message to actually send ` +
    `(e.g. label "Yes" -> reply "Yes, that works for me.").\n` +
    `- eligible = false with an empty options array for newsletters, promotions, spam, no-reply/automated ` +
    `notifications, or anything with nothing to answer.\n\n` +
    `EMAIL\nFrom: ${mail.from || ""}\nSubject: ${mail.subject || ""}\n\n${plain}`;

  const out = await aiClient.createChat(prompt);
  const eligible = !!out?.eligible;
  const options = (Array.isArray(out?.options) ? out.options : [])
    .filter((o) => o && o.label && o.reply)
    .slice(0, 5)
    .map((o) => ({ label: String(o.label).trim().slice(0, 24), reply: String(o.reply).trim().slice(0, 500) }));
  return { eligible: eligible && options.length > 0, options };
}

/**
 * Quick-reply options for an email. Body: { sourceId? , id?, email? }.
 */
async function getQuickReplies(req, res) {
  const mail = await findAccountMail(req.body?.email, { sourceId: req.body?.sourceId, id: req.body?.id });
  if (!mail) return res.json({ errorCode: 9210, errorMessage: "Email not found." });

  // Resolve the account from the email document itself
  const email = mail.email;
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account associated with this email." });

  try {
    const { eligible, options } = await generateQuickReplies(mail);
    return res.json({ respCode: 200, eligible, options });
  } catch (err) {
    console.error("[EmailAnalysis] quick-reply generation failed:", err.message);
    return res.json({ respCode: 200, eligible: false, options: [] });
  }
}

/**
 * Send a chosen quick reply on the email's thread.
 * Body: { sourceId?, id?, reply, label?, email? }
 */
async function sendQuickReply(req, res) {
  const reply = String(req.body?.reply || "").trim();
  if (!reply) return res.json({ errorCode: 9211, errorMessage: "reply is required." });

  const mail = await findAccountMail(req.body?.email, { sourceId: req.body?.sourceId, id: req.body?.id });
  if (!mail) return res.json({ errorCode: 9210, errorMessage: "Email not found." });

  const email = mail.email;
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account associated with this email." });

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5"><p>${escapeHtmlText(reply)}</p></div>`;

  try {
    const service = await createMailService(email);
    const sent = await service.sendReplyToSource({ sourceId: mail.providerMessageId, html });
    return res.json({ respCode: 200, respMessage: `Reply sent to ${sent.to}.`, sent });
  } catch (err) {
    console.error("[EmailAnalysis] quick-reply send failed:", err.message);
    return res.json({ errorCode: 9212, errorMessage: `Could not send reply: ${err.message}` });
  }
}

/**
 * Cleanup category definitions — each returns a Mongo match for that bucket.
 * Combines Gmail labels (real inboxes) with AI intent/priority (works for
 * seeded/API-delivered mail that has no Gmail category labels).
 */
const CLEANUP_DEFS = {
  junk: { label: "Junk / Spam", match: () => ({ $or: [{ labels: "SPAM" }, { intent: /spam|phish|junk/i }] }) },
  promotional: { label: "Promotional", match: () => ({ $or: [{ labels: "CATEGORY_PROMOTIONS" }, { intent: /promo|market|newsletter|advert|sale/i }] }) },
  low: { label: "Low priority", match: () => ({ priority: "Low" }) },
};

/** Counts of removable mail per category (for the cleanup dialog). */
async function cleanupPreview(req, res) {
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ respCode: 200, counts: { junk: 0, promotional: 0, low: 0 } });

  const base = { email, active: true };
  const [junk, promotional, low] = await Promise.all([
    EmailAnalysisMail.countDocuments({ ...base, ...CLEANUP_DEFS.junk.match() }),
    EmailAnalysisMail.countDocuments({ ...base, ...CLEANUP_DEFS.promotional.match() }),
    EmailAnalysisMail.countDocuments({ ...base, ...CLEANUP_DEFS.low.match() }),
  ]);
  return res.json({ respCode: 200, counts: { junk, promotional, low } });
}

/**
 * Remove (soft-delete) junk/promotional/low mail for the account.
 * Body: { categories: ["junk","promotional","low"], email? }
 * Soft-delete (active:false) so it's reversible and never touches Gmail.
 */
async function cleanupMails(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });

  const categories = (Array.isArray(req.body?.categories) ? req.body.categories : [])
    .filter((c) => CLEANUP_DEFS[c]);
  if (!categories.length) {
    return res.json({ errorCode: 9220, errorMessage: "Select at least one category to remove." });
  }

  const query = { email, active: true, $or: categories.map((c) => CLEANUP_DEFS[c].match()) };

  // Capture provider ids BEFORE soft-deleting, so we can also trash in Gmail.
  const matched = await EmailAnalysisMail.find(query, { providerMessageId: 1 }).lean();
  const providerIds = matched.map((m) => m.providerMessageId).filter(Boolean);

  // Soft-delete in our collection (stamp when + why for the dashboard counts).
  const result = await EmailAnalysisMail.updateMany(query, {
    $set: { active: false, removedAt: new Date(), removedReason: categories.join(",") },
  });
  const removed = result?.modifiedCount ?? result?.nModified ?? 0;

  // Also move them to Gmail Trash (best-effort — never fails the request).
  let trashed = 0;
  try {
    const service = await createMailService(email);
    const r = await service.trashMessages(providerIds);
    trashed = r.trashed;
  } catch (err) {
    console.error("[EmailAnalysis] Cleanup Gmail trash failed:", err.message);
  }

  return res.json({
    respCode: 200,
    respMessage: `Removed ${removed} email(s)${trashed ? ` (${trashed} moved to Gmail Trash)` : ""}.`,
    removed,
    trashed,
  });
}

/**
 * Live mail-sync progress for the settings progress bar.
 */
async function getSyncStatus(req, res) {
  return res.json({ respCode: 200, status: syncProgress.get() });
}

/**
 * Get the AI backend for the email-analysis flow ("openai" | "ollama").
 */
async function getEmailAnalysisModel(req, res) {
  const settings = await Settings.findOne({ active: true }).select("emailAnalysisModel").lean();
  const model = (settings?.emailAnalysisModel || "openai").toLowerCase();
  return res.json({ model: model === "ollama" ? "ollama" : "openai" });
}

/**
 * Update the AI backend. Body: { model: "openai" | "ollama" }.
 */
async function setEmailAnalysisModel(req, res) {
  const model = String(req.body?.model || "").toLowerCase();
  if (model !== "openai" && model !== "ollama") {
    return res.json({ errorCode: 9401, errorMessage: 'model must be "openai" or "ollama".' });
  }
  const settings = await Settings.findOne({ active: true });
  if (!settings) {
    return res.json({ errorCode: 9401, errorMessage: "Settings not found." });
  }
  settings.emailAnalysisModel = model;
  await Settings.saveData(settings);
  return res.json({ respCode: 200, respMessage: `AI backend set to ${model}.`, model });
}

/**
 * Get the "include spam" preference for the email-analysis Gmail sync.
 */
async function getIncludeSpam(req, res) {
  const settings = await Settings.findOne({ active: true }).select("emailAnalysisIncludeSpam").lean();
  return res.json({ includeSpam: !!settings?.emailAnalysisIncludeSpam });
}

/**
 * Update the "include spam" preference. Body: { includeSpam: boolean }.
 */
async function setIncludeSpam(req, res) {
  const includeSpam = !!req.body?.includeSpam;
  const settings = await Settings.findOne({ active: true });
  if (!settings) {
    return res.json({ errorCode: 9301, errorMessage: "Settings not found." });
  }
  settings.emailAnalysisIncludeSpam = includeSpam;
  await Settings.saveData(settings);
  return res.json({ respCode: 200, respMessage: "Spam preference updated.", includeSpam });
}

/**
 * Manually (re)prioritize mails. Body: { email?, date?, force? }.
 * - date present  -> prioritize just that day.
 * - date absent   -> prioritize every day with pending (or all, if force) mails.
 */
async function prioritizeEmailAnalysisMails(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });

  const force = !!req.body?.force;
  const count = req.body?.date
    ? await prioritizeService.prioritizeDay(email, req.body.date, { force })
    : await prioritizeService.prioritizePendingForAccount(email, { force });

  return res.json({ respCode: 200, respMessage: `Prioritized ${count} mail(s).`, count });
}

/**
 * Get the day report for a specific date (no generation — view only).
 * Query: ?date=YYYY-MM-DD&email=
 */
async function getReportByDate(req, res) {
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ report: null });

  const base = req.query.date ? new Date(req.query.date) : new Date();
  if (isNaN(base.getTime())) return res.json({ errorCode: 9004, errorMessage: "Invalid date." });
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);

  const report = await EmailAnalysisReport.findOne({
    email, reportType: "day", periodStart: start, active: true,
  }).lean();

  return res.json({ report: report || null });
}

/**
 * Resolve a brief sourceId (== providerMessageId) back to its email, for the
 * email-detail drill-down. Includes full body + attachment URLs.
 */
async function getMailBySource(req, res) {
  const sourceId = req.params.sourceId;
  if (!sourceId) return res.json({ errorCode: 9005, errorMessage: "sourceId required." });

  const mail = await EmailAnalysisMail.findOne({ providerMessageId: sourceId, active: true }).lean();
  if (!mail) return res.json({ errorCode: 9005, errorMessage: "Source email not found." });
  mail.attachments = mapAttachments(mail.attachments);
  return res.json({ mail });
}

/**
 * Serve the rendered .md dashboard for a report (raw markdown).
 */
async function getReportMarkdown(req, res) {
  const report = await EmailAnalysisReport.findOne({ _id: req.params.id, active: true }).lean();
  if (!report || !report.mdPath || !fs.existsSync(report.mdPath)) {
    return res.status(404).json({ errorCode: 9006, errorMessage: "Markdown not found." });
  }
  res.type("text/markdown").send(fs.readFileSync(report.mdPath, "utf8"));
}

/* ====================== KNOWLEDGE BASE ====================== */

async function getKnowledgeBase(req, res) {
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await kbService.getActiveKnowledgeBaseConfig(email);
  return res.json({ respCode: 200, config });
}

async function saveKnowledgeBase(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await kbService.saveKnowledgeBaseConfig(email, req.body || {});
  return res.json({ respCode: 200, respMessage: "Knowledge base saved.", config });
}

async function patchKbKeywords(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await kbService.patchKeywords(email, req.body?.keywords || {});
  return res.json({ respCode: 200, respMessage: "Keywords updated.", config });
}

async function patchKbGlossary(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await kbService.patchGlossary(email, req.body?.glossary || {});
  return res.json({ respCode: 200, respMessage: "Glossary updated.", config });
}

/* ====================== REPORT CONFIG ====================== */

async function listReportConfigs(req, res) {
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ configs: [] });
  const configs = await reportConfigService.listReportConfigs(email);
  return res.json({ respCode: 200, configs });
}

async function getReportConfigById(req, res) {
  const email = await resolveAccount(req.query.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await reportConfigService.getReportConfig(email, req.params.id);
  if (!config || !config._id) return res.json({ errorCode: 9002, errorMessage: "Report config not found." });
  return res.json({ respCode: 200, config });
}

async function createReportConfigCtrl(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await reportConfigService.createReportConfig(email, req.body || {});
  return res.json({ respCode: 200, respMessage: "Report config created.", config });
}

async function updateReportConfigCtrl(req, res) {
  const email = await resolveAccount(req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const config = await reportConfigService.updateReportConfig(email, req.params.id, req.body || {});
  if (!config) return res.json({ errorCode: 9002, errorMessage: "Report config not found." });
  return res.json({ respCode: 200, respMessage: "Report config updated.", config });
}

async function deleteReportConfigCtrl(req, res) {
  const email = await resolveAccount(req.query.email || req.body?.email);
  if (!email) return res.json({ errorCode: 9001, errorMessage: "No connected account." });
  const ok = await reportConfigService.deleteReportConfig(email, req.params.id);
  if (!ok) return res.json({ errorCode: 9002, errorMessage: "Report config not found." });
  return res.json({ respCode: 200, respMessage: "Report config deleted." });
}

export default {
  emailAnalysisGoogleLogin,
  emailAnalysisGoogleWebhook,
  emailAnalysisOutlookLogin,
  emailAnalysisOutlookWebhook,
  emailAnalysisStatus,
  emailAnalysisProviderStatus,
  listEmailAnalysisAccounts,
  disconnectEmailAnalysisAccount,
  syncEmailAnalysisMails,
  bulkSendEmails,
  listEmailAnalysisMails,
  getEmailAnalysisMail,
  sendMail,
  replyMail,
  forwardMail,
  deleteMails,
  markMailReadState,
  searchProviderMails,
  getMailConversation,
  downloadAttachment,
  generateEmailAnalysisReport,
  listEmailAnalysisReports,
  getEmailAnalysisReport,
  getReportByDate,
  getMailBySource,
  getReportMarkdown,
  prioritizeEmailAnalysisMails,
  getBriefTime,
  setBriefTime,
  getEmailAnalysisAnalytics,
  getSyncStatus,
  completeActionItem,
  getQuickReplies,
  sendQuickReply,
  cleanupPreview,
  cleanupMails,
  getEmailAnalysisModel,
  setEmailAnalysisModel,
  getIncludeSpam,
  setIncludeSpam,
  getKnowledgeBase,
  saveKnowledgeBase,
  patchKbKeywords,
  patchKbGlossary,
  listReportConfigs,
  getReportConfigById,
  createReportConfigCtrl,
  updateReportConfigCtrl,
  deleteReportConfigCtrl,
};
