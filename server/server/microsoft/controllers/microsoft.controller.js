/**@Config */
import config from "../../config/config";

/**@Services */
import MicrosoftAuthService from "../services/microsoft.auth.service";
import MicrosoftTeamsService from "../services/microsoftTeams.service";

/**@Models */
import MicrosoftUser from "../models/microsoftUser.model";

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

export default {
  microsoftLogin,
  microsoftWebhook,
  microsoftStatus,
  disconnectMicrosoftAccount,
  listMicrosoftTeams,
  sendTeamsMessage,
};
