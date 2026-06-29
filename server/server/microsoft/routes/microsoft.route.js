import express from "express";
import asyncHandler from "express-async-handler";

import microsoftCtrl from "../controllers/microsoft.controller";

const router = express.Router(); // eslint-disable-line new-cap

/**
 * Microsoft Teams data + delivery endpoints. Mounted at /api/microsoft.
 * The OAuth connect/webhook/status/disconnect endpoints live under
 * /api/auth/microsoft/teams (auth.route) and are intentionally separate.
 */
router.get("/teams", asyncHandler(microsoftCtrl.listMicrosoftTeams));
router.post("/teams/send", asyncHandler(microsoftCtrl.sendTeamsMessage));

export default router;
