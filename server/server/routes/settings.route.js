import express from 'express';
import asyncHandler from 'express-async-handler';
import settingsCtrl from '../controllers/settings.controller';
import authenticate from '../middlewares/authenticate';

const router = express.Router(); // eslint-disable-line new-cap

/** GET /api/settings — fetch active settings */
router.get('/', authenticate.isAllowed, asyncHandler(settingsCtrl.getSettings));

/** PUT /api/settings — update settings */
router.put('/', authenticate.isAllowed, asyncHandler(settingsCtrl.updateSettings));

export default router;
