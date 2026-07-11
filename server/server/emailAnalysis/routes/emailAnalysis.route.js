import express from "express";
import asyncHandler from "express-async-handler";

import emailAnalysisCtrl from "../controllers/emailAnalysis.controller";
import authenticate from "../../middlewares/authenticate";

const router = express.Router(); // eslint-disable-line new-cap

// Protect all email-analysis endpoints
router.use(authenticate.isAllowed);

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
router.get("/mails/search", asyncHandler(emailAnalysisCtrl.searchProviderMails));
// by-source (sourceId == providerMessageId) drill-down — before /mails/:id
router.get("/mails/by-source/:sourceId", asyncHandler(emailAnalysisCtrl.getMailBySource));
// Batch reply/draft status for a set of source mails (to-do list tags).
router.post("/mails/reply-status", asyncHandler(emailAnalysisCtrl.getMailReplyStatus));
router.get("/mails/:id/conversation", asyncHandler(emailAnalysisCtrl.getMailConversation));
router.post("/mails/:id/conversation/summary", asyncHandler(emailAnalysisCtrl.getConversationSummary));
// Edit a synced provider draft (subject/body) in place.
router.put("/mails/:id/draft", asyncHandler(emailAnalysisCtrl.updateMailDraft));
// Send a synced provider draft as-is.
router.post("/mails/:id/draft/send", asyncHandler(emailAnalysisCtrl.sendMailDraft));
router.get("/mails/:id/attachments/:file/download", asyncHandler(emailAnalysisCtrl.downloadAttachment));
router.get("/mails/:id", asyncHandler(emailAnalysisCtrl.getEmailAnalysisMail));
router.post("/mail/send", asyncHandler(emailAnalysisCtrl.sendMail));
router.post("/mail/reply", asyncHandler(emailAnalysisCtrl.replyMail));
router.post("/mail/forward", asyncHandler(emailAnalysisCtrl.forwardMail));
router.post("/mail/delete", asyncHandler(emailAnalysisCtrl.deleteMails));
router.post("/mail/mark-read", asyncHandler(emailAnalysisCtrl.markMailReadState));

// AI-generated draft reply for a single email.
router.post("/mails/:id/generate-reply", asyncHandler(emailAnalysisCtrl.generateAiReply));
// Reply Studio variants: quick yes/no/maybe trio, detailed per-type reply,
// or a custom-prompt reply with tone/length/language controls.
router.post("/mails/:id/reply-variants", asyncHandler(emailAnalysisCtrl.generateReplyVariants));
// Rewrite a selected snippet of draft text in a tone (professional | friendly).
router.post("/rewrite-text", asyncHandler(emailAnalysisCtrl.rewriteDraftText));

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
 * Pre-Meeting Brief — generates (and caches) a preparation brief for a
 * meeting-like "event" surfaced in a report, from the account's
 * already-analyzed mail. Powers the info button on meeting events.
 */
router.post("/pre-meeting-briefs/generate", asyncHandler(emailAnalysisCtrl.generatePreMeetingBrief));

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
router.patch("/report-configs/:id/default", asyncHandler(emailAnalysisCtrl.setDefaultReportConfigCtrl));
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

/**
 * Per-user auto-sync cron toggle.
 * Reads / writes Employee.autoSync scoped to the logged-in user via JWT.
 */
router.get("/auto-sync",  asyncHandler(emailAnalysisCtrl.getAutoSync));
router.post("/auto-sync", asyncHandler(emailAnalysisCtrl.setAutoSync));

/**
 * Per-user sync interval preference (in minutes).
 */
router.get("/sync-interval",  asyncHandler(emailAnalysisCtrl.getSyncInterval));
router.post("/sync-interval", asyncHandler(emailAnalysisCtrl.setSyncInterval));

/**
 * Outlook category label configuration.
 * Lets users rename / recolour / disable category labels from the UI.
 * On POST/PUT the service automatically re-pushes updated labels to all
 * already-prioritized Outlook emails.
 */
router.get("/outlook-category-config",    asyncHandler(emailAnalysisCtrl.getOutlookCategoryConfig));
router.post("/outlook-category-config",   asyncHandler(emailAnalysisCtrl.saveOutlookCategoryConfig));
router.put("/outlook-category-config",    asyncHandler(emailAnalysisCtrl.saveOutlookCategoryConfig));
router.delete("/outlook-category-config", asyncHandler(emailAnalysisCtrl.resetOutlookCategoryConfig));

export default router;
