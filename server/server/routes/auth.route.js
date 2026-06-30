import express from 'express';
import asyncHandler from 'express-async-handler';
import emailAnalysisCtrl from '../emailAnalysis/controllers/emailAnalysis.controller';
import microsoftCtrl from '../microsoft/controllers/microsoft.controller';
import authCtrl from '../controllers/auth.controller';

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

/** POST /api/auth/register — create a new employee account, returns JWT */
router.post("/register", asyncHandler(authCtrl.register));

/** POST /api/auth/login — employee email/password login, returns JWT */
router.post("/login", asyncHandler(authCtrl.login));

/** POST /api/auth/logout — client-side token invalidation */
router.post("/logout", asyncHandler(authCtrl.logout));

/** GET /api/auth/me — return current user from token */
router.get("/me", asyncHandler(authCtrl.me));

export default router;
