import axios from "axios";
import config from "../../config/config";

/**
 * Auth helper for the Microsoft Outlook email-reading connection.
 *
 * Uses the OAuth2 v2.0 authorization-code flow directly over HTTPS (no SDK),
 * exactly mirroring MicrosoftAuthService (Teams) but with MAIL scopes instead
 * of Teams/Channel scopes.
 *
 * Scopes:
 *  - openid / profile / email / offline_access  → sign-in + refresh token
 *  - User.Read       → read Graph /me profile
 *  - Mail.Read       → list + read emails
 *  - Mail.ReadWrite  → move messages to Deleted Items (cleanup)
 *  - Mail.Send       → send replies / quick replies
 *
 * Uses its own redirect URI (config.outlookRedirectUri) so it is isolated from
 * the Teams flow even though both may share the same Azure App Registration.
 */

const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
];

export default class OutlookAuthService {
  constructor() {
    this.tenant = config.microsoftTenant || "common";
    this.clientId = config.microsoftClient;
    this.clientSecret = config.microsoftSecret;
    this.redirectUri = config.outlookRedirectUri;
    this.authorityBase = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0`;
    this.graphBase = "https://graph.microsoft.com/v1.0";
  }

  /**
   * STEP 0: Build the consent URL the browser is redirected to.
   * @param {string} state - opaque string passed back by Microsoft unchanged
   * @returns {string} full authorize URL
   */
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

  /**
   * STEP 1: Exchange the authorization code for tokens.
   * @param {string} code
   */
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
    try {
      const { data } = await axios.post(
        `${this.authorityBase}/token`,
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      return this.#shapeTokens(data);
    } catch (err) {
      const detail = err?.response?.data?.error_description || err.message;
      throw new Error(`Outlook token exchange failed: ${detail}`);
    }
  }

  /**
   * Refresh an access token using a stored refresh token.
   * Microsoft MAY rotate the refresh token — always persist what is returned.
   * @param {string} refreshToken
   */
  async refreshTokens(refreshToken) {
    if (!refreshToken) throw new Error("Missing Outlook refresh token. Reconnect the account.");
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES.join(" "),
    });
    try {
      const { data } = await axios.post(
        `${this.authorityBase}/token`,
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      return this.#shapeTokens(data);
    } catch (err) {
      const detail = err?.response?.data?.error_description || err.message;
      throw new Error(`Outlook token refresh failed: ${detail}`);
    }
  }

  /**
   * STEP 2: Read the signed-in user's Graph profile.
   * @param {string} accessToken
   */
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

  /**
   * STEP 3: Combined helper — returns tokens + profile in one call.
   * @param {string} code  - authorization code from Microsoft callback
   */
  async authenticate(code) {
    const tokens = await this.getTokensFromCode(code);
    const profile = await this.getUserProfile(tokens.access_token);
    return { ...tokens, ...profile };
  }
}
