import { google } from "googleapis";
import googleEmailAnalysisOAuth from "../auth/googleEmailAnalysis.oauth";
import config from "../../config/config";

/**
 * Auth helper for the email-analysis Google connection.
 *
 * Mirrors GoogleAuthService but uses the dedicated email-analysis OAuth client
 * and always passes the email-analysis redirect URI explicitly, so it stays
 * fully isolated from the existing login flow.
 */
export default class EmailAnalysisAuthService {
  constructor() {
    this.oauth2Client = googleEmailAnalysisOAuth;
  }

  /* STEP 1: Exchange auth code for tokens */
  async getTokensFromCode(code) {
    if (!code) throw new Error("Authorization code required");
    const { tokens } = await this.oauth2Client.getToken({
      code,
      redirect_uri: config.emailAnalysisRedirectUri,
    });
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /* STEP 2: Get the user's Google profile */
  async getUserProfile() {
    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
      version: "v2",
    });

    const { data } = await oauth2.userinfo.get();

    return {
      googleId: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  }

  /* STEP 3: Combined helper - returns tokens + profile */
  async authenticate(code) {
    const tokens = await this.getTokensFromCode(code);
    const profile = await this.getUserProfile();

    return {
      ...tokens,
      ...profile,
    };
  }
}
