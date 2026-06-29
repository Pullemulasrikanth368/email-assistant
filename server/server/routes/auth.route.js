import express from 'express';
import emailAnalysisCtrl from '../emailAnalysis/controllers/emailAnalysis.controller';
import microsoftCtrl from '../microsoft/controllers/microsoft.controller';
import asyncHandler from 'express-async-handler';

const router = express.Router(); // eslint-disable-line new-cap

/**
 * Email-analysis Google connection (separate, isolated flow).
 * Register the webhook URL in the Google Cloud console as an authorized
 * redirect URI: <serverUrl>/api/auth/google/email-analysis/webhook
 */
router.get("/google/email-analysis", asyncHandler(emailAnalysisCtrl.emailAnalysisGoogleLogin));
router.get("/google/email-analysis/webhook", asyncHandler(emailAnalysisCtrl.emailAnalysisGoogleWebhook));
router.get("/google/email-analysis/status", asyncHandler(emailAnalysisCtrl.emailAnalysisStatus));
router.get("/google/email-analysis/accounts", asyncHandler(emailAnalysisCtrl.listEmailAnalysisAccounts));
router.post("/google/email-analysis/disconnect", asyncHandler(emailAnalysisCtrl.disconnectEmailAnalysisAccount));
router.post("/google/email-analysis/sync", asyncHandler(emailAnalysisCtrl.syncEmailAnalysisMails));

/**
 * Microsoft (Entra ID) Teams connection (separate, isolated flow).
 * Register the webhook URL in the Azure app registration as a Web redirect URI:
 * <serverUrl>/api/auth/microsoft/teams/webhook
 */
router.get("/microsoft/teams", asyncHandler(microsoftCtrl.microsoftLogin));
router.get("/microsoft/teams/webhook", asyncHandler(microsoftCtrl.microsoftWebhook));
router.get("/microsoft/teams/status", asyncHandler(microsoftCtrl.microsoftStatus));
router.post("/microsoft/teams/disconnect", asyncHandler(microsoftCtrl.disconnectMicrosoftAccount));

/**
 * /me endpoint — returns minimal user info based on token.
 * In this standalone app the token is a simple JWT; return the decoded payload.
 */
router.get("/me", (req, res) => {
  // The token is decoded by the auth middleware when a protected route hits this.
  // For auth routes (not protected), just return a 200 with empty data.
  if (req.tokenInfo) {
    return res.json({ respCode: 200, details: req.tokenInfo });
  }
  return res.json({ respCode: 200, details: null });
});

module.exports = router;
