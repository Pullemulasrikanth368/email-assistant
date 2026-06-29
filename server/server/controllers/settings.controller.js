import httpStatus from 'http-status';
import Settings from '../models/settings.model';

/**
 * GET /api/settings
 * Returns the single active settings document (creates a default one if none exists).
 */
async function getSettings(req, res, next) {
  try {
    let settings = await Settings.findOne({ active: true }).lean();

    if (!settings) {
      // Seed a default settings document on first run
      const defaults = new Settings({ active: true });
      settings = await defaults.save();
      settings = settings.toObject();
    }

    return res.json({ respCode: 200, settings: [settings] });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/settings
 * Updates the active settings document with the provided fields.
 * Body: { emailAnalysisBriefTime?, emailAnalysisIncludeSpam?, emailAnalysisModel?,
 *         sendGridApiKey?, sendGridEmail?, aiType?, companyName?, adminEmail?, ... }
 */
async function updateSettings(req, res, next) {
  try {
    const allowed = [
      'companyName', 'companyImg', 'adminEmail',
      'sendGridApiKey', 'sendGridEmail',
      'aiType',
      'emailAnalysisBriefTime',
      'emailAnalysisIncludeSpam',
      'emailAnalysisModel',
    ];

    const update = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = req.body[key];
      }
    });

    if (Object.keys(update).length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({
        errorCode: 400,
        errorMessage: 'No valid fields provided for update',
      });
    }

    update.updated = new Date();

    let settings = await Settings.findOneAndUpdate(
      { active: true },
      { $set: update },
      { new: true, upsert: true }
    );

    // If briefTime changed, reschedule the report cron dynamically
    if (update.emailAnalysisBriefTime) {
      try {
        const { rescheduleReportCron } = await import('../emailAnalysis/jobs/report.job');
        await rescheduleReportCron();
      } catch (e) {
        console.error('[Settings] Could not reschedule report cron:', e.message);
      }
    }

    return res.json({ respCode: 205, settings, message: 'Settings updated successfully' });
  } catch (err) {
    next(err);
  }
}

export default { getSettings, updateSettings };
