import express from "express";

const router = express.Router(); // eslint-disable-line new-cap

// API Logging Middleware
router.use((req, res, next) => {
  console.log(`[EXECUTIVE-EMAIL-ASSISTANT API HIT] ${req.method} ${req.originalUrl}`);
  next();
});

/** GET /health-check - Check service health */
router.get("/health-check", (req, res) => res.send("OK"));

import authRoutes from "./auth.route";
// mount auth routes at /auth
router.use("/auth", authRoutes);

import emailAnalysisRoutes from "../emailAnalysis/routes/emailAnalysis.route";
// mount email-analysis mail data routes at /email-analysis
router.use("/email-analysis", emailAnalysisRoutes);

import emailDraftRoutes from "../emailAnalysis/routes/emailDraft.route";
// mount draft management routes at /email-analysis/drafts
router.use("/email-analysis/drafts", emailDraftRoutes);

import microsoftRoutes from "../microsoft/routes/microsoft.route";
// mount Microsoft Teams data + delivery routes at /microsoft
router.use("/microsoft", microsoftRoutes);

import settingsRoutes from "./settings.route";
// mount settings routes at /settings
router.use("/settings", settingsRoutes);

import usersRoutes from "./users.route";
router.use("/users", usersRoutes);

import rolesRoutes from "./roles.route";
router.use("/roles", rolesRoutes);

export default router;
