import axios from "axios";
import config from "../../config/config";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
];

export default class OutlookAuthService {
  constructor() {
    this.tenant = config.microsoftTenant || "common";
    this.clientId = config.microsoftClient;
    this.clientSecret = config.microsoftSecret;
    this.redirectUri = config.microsoftOutlookRedirectUri;
    this.authorityBase = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0`;
    this.graphBase = "https://graph.microsoft.com/v1.0";
  }

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

  async refreshTokens(refreshToken) {
    if (!refreshToken) throw new Error("Missing Microsoft refresh token. Reconnect the Outlook account.");
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

  async getUserProfile(accessToken) {
    const { data } = await axios.get(`${this.graphBase}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      microsoftId: data.id,
      providerUserId: data.id,
      email: data.mail || data.userPrincipalName,
      name: data.displayName,
    };
  }

  async authenticate(code) {
    const tokens = await this.getTokensFromCode(code);
    const profile = await this.getUserProfile(tokens.access_token);
    return { ...tokens, ...profile };
  }
}
