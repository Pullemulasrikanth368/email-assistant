import axios from "axios";
import config from "../../config/config";

/**
 * Auth helper for the Microsoft (Entra ID) Teams connection.
 *
 * Uses the OAuth2 v2.0 authorization-code flow directly over HTTPS (no SDK),
 * mirroring how EmailAnalysisAuthService isolates the email-analysis Google
 * connection from the login flow.
 *
 * Delegated scopes requested cover sign-in + reading the user's teams/channels
 * and sending channel messages. `offline_access` is what yields a refresh token.
 */
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Send",
  "Chat.ReadWrite",
];

export default class MicrosoftAuthService {
  constructor() {
    this.tenant = config.microsoftTenant || "common";
    this.clientId = config.microsoftClient;
    this.clientSecret = config.microsoftSecret;
    this.redirectUri = config.microsoftTeamsRedirectUri;
    this.authorityBase = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0`;
    this.graphBase = "https://graph.microsoft.com/v1.0";
  }

  /** STEP 0: Build the consent URL the browser is redirected to. */
  getAuthUrl(state = "") {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      response_mode: "query",
      scope: SCOPES.join(" "),
      prompt: "select_account",
    });
    if (state) params.set("state", state);
    return `${this.authorityBase}/authorize?${params.toString()}`;
  }

  /** Normalize a token response into our stored shape. */
  #shapeTokens(data) {
    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token,
      scope: data.scope,
      expiry_date: new Date(Date.now() + expiresInMs),
    };
  }

  /** STEP 1: Exchange the authorization code for tokens. */
  async getTokensFromCode(code) {
    if (!code) throw new Error("Authorization code required");
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES.join(" "),
    });
    const { data } = await axios.post(`${this.authorityBase}/token`, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return this.#shapeTokens(data);
  }

  /** Refresh an access token using a stored refresh token. */
  async refreshTokens(refreshToken) {
    if (!refreshToken) throw new Error("Missing Microsoft refresh token. Reconnect the account.");
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES.join(" "),
    });
    const { data } = await axios.post(`${this.authorityBase}/token`, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return this.#shapeTokens(data);
  }

  /** STEP 2: Read the signed-in user's Graph profile. */
  async getUserProfile(accessToken) {
    const { data } = await axios.get(`${this.graphBase}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      microsoftId: data.id,
      email: data.mail || data.userPrincipalName,
      name: data.displayName,
    };
  }

  /** STEP 3: Combined helper — returns tokens + profile. */
  async authenticate(code) {
    const tokens = await this.getTokensFromCode(code);
    const profile = await this.getUserProfile(tokens.access_token);
    return { ...tokens, ...profile };
  }
}
