import { google } from "googleapis";
import config from "../../config/config";

/**
 * Dedicated OAuth2 client for the email-analysis Google connection.
 *
 * Kept as its own instance (with its own redirect URI) so token exchange here
 * never mutates the credentials on the shared `googleOAuth` client used by the
 * existing login flow.
 */
const googleEmailAnalysisOAuth = new google.auth.OAuth2(
  config.googleClient,
  config.googleSecret,
  config.emailAnalysisRedirectUri
);

export default googleEmailAnalysisOAuth;
