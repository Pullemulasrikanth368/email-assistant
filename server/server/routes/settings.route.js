import express from 'express';
import asyncHandler from 'express-async-handler';
import settingsCtrl from '../controllers/settings.controller';

const router = express.Router(); // eslint-disable-line new-cap

/** GET /api/settings — fetch active settings */
router.get('/', asyncHandler(settingsCtrl.getSettings));

/** PUT /api/settings — update settings */
router.put('/', asyncHandler(settingsCtrl.updateSettings));

export default router;
