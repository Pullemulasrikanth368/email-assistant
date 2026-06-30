import express from "express";
import asyncHandler from "express-async-handler";

import emailAnalysisCtrl from "../controllers/emailAnalysis.controller";

const router = express.Router(); // eslint-disable-line new-cap

/**
 * Email-analysis mail data endpoints (read-only views over email_analysis_mails).
 * Mounted at /api/email-analysis. The OAuth/connect endpoints live under
 * /api/auth/google/email-analysis (auth.route) and are intentionally separate.
 */
router.get("/mails", asyncHandler(emailAnalysisCtrl.listEmailAnalysisMails));
// Bulk-send (seed) emails through the connected Gmail account.
router.post("/bulk-send", asyncHandler(emailAnalysisCtrl.bulkSendEmails));
// Complete an action/todo: AI-generate + send a reply on the linked email's thread.
router.post("/actions/complete", asyncHandler(emailAnalysisCtrl.completeActionItem));
// One-click quick replies: generate context-aware options, then send the chosen one.
router.post("/quick-replies", asyncHandler(emailAnalysisCtrl.getQuickReplies));
router.post("/quick-reply", asyncHandler(emailAnalysisCtrl.sendQuickReply));
// One-click cleanup: remove junk / promotional / low-priority mail after analysis.
router.get("/cleanup/preview", asyncHandler(emailAnalysisCtrl.cleanupPreview));
router.post("/cleanup", asyncHandler(emailAnalysisCtrl.cleanupMails));
// (re)prioritize mails by intent — before the /mails/:id catch-all
router.post("/mails/prioritize", asyncHandler(emailAnalysisCtrl.prioritizeEmailAnalysisMails));
// by-source (sourceId == providerMessageId) drill-down — before /mails/:id
router.get("/mails/by-source/:sourceId", asyncHandler(emailAnalysisCtrl.getMailBySource));
router.get("/mails/:id", asyncHandler(emailAnalysisCtrl.getEmailAnalysisMail));

/**
 * Reports (the generated "morning brief").
 * Specific paths are declared before the "/reports/:id" catch-all.
 */
router.post("/reports/generate", asyncHandler(emailAnalysisCtrl.generateEmailAnalysisReport));
router.get("/reports", asyncHandler(emailAnalysisCtrl.listEmailAnalysisReports));
router.get("/reports/by-date", asyncHandler(emailAnalysisCtrl.getReportByDate));
router.get("/reports/:id/md", asyncHandler(emailAnalysisCtrl.getReportMarkdown));
router.get("/reports/:id", asyncHandler(emailAnalysisCtrl.getEmailAnalysisReport));

/**
 * Brief schedule time (drives the dynamic report cron).
 */
router.get("/brief-time", asyncHandler(emailAnalysisCtrl.getBriefTime));
router.post("/brief-time", asyncHandler(emailAnalysisCtrl.setBriefTime));

/**
 * Knowledge Base configuration (keywords, thresholds, glossary, prompt instruction).
 */
router.get("/knowledge-base", asyncHandler(emailAnalysisCtrl.getKnowledgeBase));
router.post("/knowledge-base", asyncHandler(emailAnalysisCtrl.saveKnowledgeBase));
router.put("/knowledge-base", asyncHandler(emailAnalysisCtrl.saveKnowledgeBase));
router.patch("/knowledge-base/keywords", asyncHandler(emailAnalysisCtrl.patchKbKeywords));
router.patch("/knowledge-base/glossary", asyncHandler(emailAnalysisCtrl.patchKbGlossary));

/**
 * Report configuration (sections, fields, output style).
 * Specific paths before the :id catch-all.
 */
router.get("/report-configs", asyncHandler(emailAnalysisCtrl.listReportConfigs));
router.post("/report-configs", asyncHandler(emailAnalysisCtrl.createReportConfigCtrl));
router.get("/report-configs/:id", asyncHandler(emailAnalysisCtrl.getReportConfigById));
router.put("/report-configs/:id", asyncHandler(emailAnalysisCtrl.updateReportConfigCtrl));
router.delete("/report-configs/:id", asyncHandler(emailAnalysisCtrl.deleteReportConfigCtrl));

/**
 * Operations Command Center analytics (dashboard data).
 */
router.get("/analytics", asyncHandler(emailAnalysisCtrl.getEmailAnalysisAnalytics));

/**
 * Live mail-sync progress (for the settings progress bar).
 */
router.get("/sync-status", asyncHandler(emailAnalysisCtrl.getSyncStatus));

/**
 * AI backend (openai | ollama) for the email-analysis flow.
 */
router.get("/ai-model", asyncHandler(emailAnalysisCtrl.getEmailAnalysisModel));
router.post("/ai-model", asyncHandler(emailAnalysisCtrl.setEmailAnalysisModel));

/**
 * "Include spam" preference for the Gmail sync.
 */
router.get("/include-spam", asyncHandler(emailAnalysisCtrl.getIncludeSpam));
router.post("/include-spam", asyncHandler(emailAnalysisCtrl.setIncludeSpam));

export default router;
