/**@Config */
import config from "../../config/config";

/**@Services — Teams delivery */
import MicrosoftAuthService from "../services/microsoft.auth.service";
import MicrosoftTeamsService from "../services/microsoftTeams.service";

/**@Services — Outlook email reading */
import OutlookAuthService from "../services/outlookAuth.service";
import OutlookMessagesService from "../services/outlookMessages.service";

/**@Services — Analysis pipeline (shared with Google flow) */
import prioritizeService from "../../emailAnalysis/services/prioritize.service";
import reportService from "../../emailAnalysis/services/report.service";

/**@Models */
import MicrosoftUser from "../models/microsoftUser.model";
import OutlookUser from "../models/outlookUser.model";
import EmailAnalysisMail from "../../emailAnalysis/models/emailAnalysisMail.model";

/**
 * Build the origin (scheme + host) of the admin frontend so we can redirect
 * back to the Connections & Delivery screen after the OAuth round-trip.
 */
function getFrontendOrigin() {
  try {
    return new URL(config.frontendUrl).origin;
  } catch (e) {
    return config.frontendUrl || "";
  }
}

/**
 * STEP 1 - Start the Microsoft consent flow. Redirects the browser to Microsoft.
 * The redirect URI (config.microsoftTeamsRedirectUri) must be registered in the
 * Azure app registration.
 */
async function microsoftLogin(req, res) {
  if (!config.microsoftClient) {
    return res.status(500).send("Microsoft client is not configured (MS_CLIENT_ID).");
  }
  const url = new MicrosoftAuthService().getAuthUrl();
  return res.redirect(url);
}

/**
 * STEP 2 - Callback hit by Microsoft after consent. Exchanges the code and
 * upserts the account into `microsoft_user`, then returns to the settings page.
 */
async function microsoftWebhook(req, res) {
  const origin = getFrontendOrigin();
  try {
    const { code, error, error_description: errorDescription } = req.query;
    if (error) {
      console.error("microsoftWebhook consent error:", error, errorDescription);
      return res.redirect(`${origin}/connectionsDelivery?microsoft=error`);
    }
    if (!code) {
      return res.redirect(`${origin}/connectionsDelivery?microsoft=error`);
    }

    const data = await new MicrosoftAuthService().authenticate(code);

    // One connected Microsoft account per email.
    let user = await MicrosoftUser.findOne({ email: data.email });
    if (!user) user = new MicrosoftUser({ email: data.email });

    user.name = data.name;
    user.microsoftId = data.microsoftId;
    user.provider = "microsoft";
    user.accessToken = data.access_token;
    if (data.refresh_token) user.refreshToken = data.refresh_token;
    user.scope = data.scope;
    user.idToken = data.id_token;
    user.expiryDate = data.expiry_date;
    user.active = true;

    await MicrosoftUser.saveData(user);

    return res.redirect(`${origin}/connectionsDelivery?microsoft=connected`);
  } catch (err) {
    console.error("microsoftWebhook error:", err?.response?.data || err.message);
    return res.redirect(`${origin}/connectionsDelivery?microsoft=error`);
  }
}

/** Return the currently connected Microsoft account (if any). */
async function microsoftStatus(req, res) {
  const user = await MicrosoftUser.findOne({ active: true }).sort({ updatedAt: -1 });
  if (user) {
    return res.json({
      connected: true,
      email: user.email,
      name: user.name,
      defaultTeamId: user.defaultTeamId || null,
      defaultChannelId: user.defaultChannelId || null,
    });
  }
  return res.json({ connected: false });
}

/** Disconnect (remove) the Microsoft account. Body: { email? }. */
async function disconnectMicrosoftAccount(req, res) {
  let email = req.body?.email;
  if (!email) {
    const user = await MicrosoftUser.findOne({ active: true }).sort({ updatedAt: -1 });
    email = user?.email;
  }
  if (!email) {
    return res.json({ errorCode: 9101, errorMessage: "No connected account to remove." });
  }
  const result = await MicrosoftUser.deleteOne({ email });
  if (!result || result.deletedCount === 0) {
    return res.json({ errorCode: 9101, errorMessage: "Email not matched." });
  }
  return res.json({ respCode: 200, respMessage: "Microsoft account disconnected." });
}

/** List the user's teams + channels (for a destination picker). */
async function listMicrosoftTeams(req, res) {
  try {
    const service = new MicrosoftTeamsService(req.query?.email);
    const teams = await service.listTeamsWithChannels();
    return res.json({ respCode: 200, teams });
  } catch (err) {
    console.error("listMicrosoftTeams error:", err?.response?.data || err.message);
    return res.json({ errorCode: 9102, errorMessage: err.message });
  }
}

/**
 * Send a message to a Teams channel.
 * Body: { teamId, channelId, message, isHtml?, email? }
 */
async function sendTeamsMessage(req, res) {
  const { teamId, channelId, message, isHtml, email } = req.body || {};
  if (!teamId || !channelId || !message) {
    return res.json({ errorCode: 9103, errorMessage: "teamId, channelId and message are required." });
  }
  try {
    const service = new MicrosoftTeamsService(email);
    const sent = await service.sendChannelMessage({ teamId, channelId, message, isHtml });
    return res.json({ respCode: 200, respMessage: "Message sent to Teams.", sent });
  } catch (err) {
    console.error("sendTeamsMessage error:", err?.response?.data || err.message);
    return res.json({ errorCode: 9104, errorMessage: err.message });
  }
}

/* ================================================================
   OUTLOOK EMAIL READING — OAuth handlers
   Route prefix: /api/auth/microsoft/outlook
   ================================================================ */

/**
 * STEP 1 — Redirect the browser to Microsoft's consent screen.
 * Scopes: Mail.Read, Mail.ReadWrite, Mail.Send (see OutlookAuthService).
 *
 * Query params accepted:
 *   login  — the admin user's email (stored on OutlookUser for scoping)
 *   purpose — "source" (default) | "send"
 */
async function outlookLogin(req, res) {
  if (!config.microsoftClient) {
    return res.status(500).send("Microsoft client is not configured (MICROSOFT_CLIENT_ID).");
  }
  const login   = req.query?.login   || "";
  const purpose = req.query?.purpose || "source";
  const state   = `${purpose}::${login}`;
  const url = new OutlookAuthService().getAuthUrl(state);
  return res.redirect(url);
}

/**
 * STEP 2 — Microsoft callback after consent.
 * Exchanges the authorization code → upserts OutlookUser → triggers initial sync.
 */
async function outlookWebhook(req, res) {
  const origin = getFrontendOrigin();
  try {
    const { code, error, error_description: errorDescription, state = "" } = req.query;
    if (error) {
      console.error("outlookWebhook consent error:", error, errorDescription);
      return res.redirect(`${origin}/connectionsDelivery?outlook=error`);
    }
    if (!code) {
      return res.redirect(`${origin}/connectionsDelivery?outlook=error`);
    }

    const [purpose, loginUserEmailId] = state.split("::");
    const data = await new OutlookAuthService().authenticate(code);

    // One OutlookUser per email — upsert.
    let user = await OutlookUser.findOne({ email: data.email });
    if (!user) user = new OutlookUser({ email: data.email });

    user.name               = data.name;
    user.microsoftId        = data.microsoftId;
    user.provider           = "outlook";
    user.purpose            = purpose || "source";
    user.loginUserEmailId   = loginUserEmailId || "";
    user.accessToken        = data.access_token;
    if (data.refresh_token) user.refreshToken = data.refresh_token;
    user.scope              = data.scope;
    user.idToken            = data.id_token;
    user.expiryDate         = data.expiry_date;
    user.active             = true;

    await OutlookUser.saveData(user);

    // Kick off the initial 30-day backfill asynchronously (non-blocking),
    // then prioritize and generate the first daily report — same pipeline as Gmail.
    new OutlookMessagesService(data.email)
      .syncForUser()
      .then(async (result) => {
        try {
          await prioritizeService.prioritizePendingForAccount(data.email);
        } catch (err) {
          console.error(`[Outlook] Post-sync prioritization failed for ${data.email}:`, err.message);
        }
        if (result?.mode === "initial") {
          try {
            await reportService.generateDailyReport(data.email, { force: true });
            console.log(`[Outlook] Initial report generated for ${data.email}`);
          } catch (err) {
            console.error(`[Outlook] Initial report generation failed for ${data.email}:`, err.message);
          }
        }
      })
      .catch((err) => console.error(`[Outlook] Initial sync error for ${data.email}:`, err.message));

    return res.redirect(`${origin}/connectionsDelivery?outlook=connected`);
  } catch (err) {
    console.error("outlookWebhook error:", err?.response?.data || err.message);
    return res.redirect(`${origin}/connectionsDelivery?outlook=error`);
  }
}

/** Return the currently connected Outlook account (if any). */
async function outlookStatus(req, res) {
  const query = req.query?.email
    ? { email: req.query.email, active: true }
    : { active: true };
  const user = await OutlookUser.findOne(query).sort({ updatedAt: -1 });
  if (user) {
    return res.json({
      connected:   true,
      email:       user.email,
      name:        user.name,
      provider:    user.provider,
      lastSyncedAt: user.lastSyncedAt || null,
      initialSyncDone: user.initialSyncDone,
    });
  }
  return res.json({ connected: false, provider: "outlook" });
}

/**
 * Disconnect (deactivate) an Outlook account.
 * Body: { email?, purgeData? }
 * When purgeData=true the synced emails are soft-deleted from email_analysis_mails.
 */
async function disconnectOutlook(req, res) {
  let email = req.body?.email;
  if (!email) {
    const user = await OutlookUser.findOne({ active: true }).sort({ updatedAt: -1 });
    email = user?.email;
  }
  if (!email) {
    return res.json({ errorCode: 9201, errorMessage: "No connected Outlook account to remove." });
  }

  // Deactivate the account record.
  const result = await OutlookUser.updateOne({ email }, { $set: { active: false } });
  if (!result || result.modifiedCount === 0) {
    return res.json({ errorCode: 9201, errorMessage: "Outlook account email not matched." });
  }

  // Optional: soft-delete all synced Outlook mails for this account.
  const purgeData = req.body?.purgeData;
  let purged = 0;
  if (purgeData) {
    const pr = await EmailAnalysisMail.updateMany(
      { email, provider: "outlook", active: true },
      { $set: { active: false, removedAt: new Date(), removedReason: "account-disconnected" } }
    );
    purged = pr?.modifiedCount || 0;
  }

  return res.json({
    respCode:    200,
    respMessage: purgeData
      ? `Outlook account disconnected and ${purged} email(s) purged.`
      : "Outlook account disconnected (emails retained).",
  });
}

/**
 * Manual sync trigger.
 * Body: { email? }
 */
async function syncOutlook(req, res) {
  let email = req.body?.email;
  if (!email) {
    const user = await OutlookUser.findOne({ active: true, purpose: { $ne: "send" } }).sort({ updatedAt: -1 });
    email = user?.email;
  }
  if (!email) {
    return res.json({ errorCode: 9202, errorMessage: "No connected Outlook source account." });
  }
  // Non-blocking — return immediately.
  new OutlookMessagesService(email)
    .syncForUser()
    .catch((err) => console.error(`[Outlook] Manual sync error for ${email}:`, err.message));
  return res.json({ respCode: 200, respMessage: `Outlook sync triggered for ${email}.` });
}

export default {
  // ── Teams delivery ──
  microsoftLogin,
  microsoftWebhook,
  microsoftStatus,
  disconnectMicrosoftAccount,
  listMicrosoftTeams,
  sendTeamsMessage,

  // ── Outlook email reading ──
  outlookLogin,
  outlookWebhook,
  outlookStatus,
  disconnectOutlook,
  syncOutlook,
};
