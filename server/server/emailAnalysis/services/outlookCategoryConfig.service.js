/**
 * outlookCategoryConfig.service.js
 *
 * CRUD service for OutlookCategoryConfig.
 * Provides get/save/reset helpers, and a runtime resolver that merges
 * saved DB config with the hardcoded defaults so callers always get a
 * complete map regardless of whether the user has configured anything yet.
 *
 * When a label is UPDATED (via saveOutlookCategoryConfig), this service also:
 *  1. Updates the DB config
 *  2. Re-pushes updated Outlook categories to all already-prioritized emails
 *     that are affected by the changed mapping.
 */
import OutlookCategoryConfig from '../models/outlookCategoryConfig.model';
import EmailAnalysisMail from '../models/emailAnalysisMail.model';
import {
  PRIORITY_CATEGORY as DEFAULT_PRIORITY,
  CATEGORY_MAP     as DEFAULT_CATEGORY,
  INTENT_CATEGORY  as DEFAULT_INTENT,
  ALL_CATEGORY_LABELS,
} from './outlookCategorySync.service';
import { createMailService } from './mailProvider.service';

/* ─── Default seed rows (built from the hardcoded maps) ─── */

const PRIORITY_COLOUR = {
  Critical: 'preset0', High: 'preset1', Medium: 'preset3', Low: 'preset9',
};
const CATEGORY_COLOUR = {
  'Action Required':         'preset2',
  'Meetings & Scheduling':   'preset6',
  'Finance & Invoices':      'preset4',
  'Sales & Leads':           'preset5',
  'Support & Complaints':    'preset1',
  'Notifications & Updates': 'preset7',
  'Newsletters':             'preset9',
  'Promotions & Marketing':  'preset8',
  'Personal':                'preset10',
  'Junk':                    'preset9',
};
const INTENT_COLOUR = {
  'approval-request': 'preset3',
  'deadline':         'preset0',
  'invoice':          'preset4',
  'escalation':       'preset0',
  'complaint':        'preset1',
};

function defaultPriorityMap() {
  return Object.entries(DEFAULT_PRIORITY).map(([dbValue, outlookLabel]) => ({
    dbValue, outlookLabel, colour: PRIORITY_COLOUR[dbValue] || 'none', enabled: true,
  }));
}

function defaultCategoryMap() {
  return Object.entries(DEFAULT_CATEGORY).map(([dbValue, outlookLabel]) => ({
    dbValue, outlookLabel, colour: CATEGORY_COLOUR[dbValue] || 'none', enabled: true,
  }));
}

function defaultIntentMap() {
  return Object.entries(DEFAULT_INTENT).map(([dbValue, outlookLabel]) => ({
    dbValue, outlookLabel, colour: INTENT_COLOUR[dbValue] || 'none', enabled: true,
  }));
}

/**
 * Build the complete default config object (not persisted — used as fallback).
 */
export function buildDefaultConfig(email) {
  return {
    email,
    priorityMap:        defaultPriorityMap(),
    categoryMap:        defaultCategoryMap(),
    intentMap:          defaultIntentMap(),
    replyNeededEnabled: true,
    replyNeededLabel:   '💬 Reply Needed',
    replyNeededColour:  'preset6',
  };
}

/* ─── Merge helpers ─── */

/**
 * Merge a saved map with defaults so entries added to the defaults in a code
 * update are surfaced to users who already have a saved config.
 *
 * @param {Array} saved  - rows from DB
 * @param {Array} defaults - rows from buildDefault*Map()
 */
function mergeMap(saved = [], defaults = []) {
  const savedByValue = new Map((saved || []).map((e) => [e.dbValue, e]));
  return defaults.map((def) => ({
    ...def,
    ...(savedByValue.get(def.dbValue) || {}),
  }));
}

/* ─── Public: Get config (DB + merged defaults) ─── */

/**
 * Load the saved config for an email account, merged with system defaults.
 * Never throws — always returns a complete config object.
 *
 * @param {string} email
 * @returns {Promise<Object>} complete config
 */
export async function getOutlookCategoryConfig(email) {
  if (!email) return buildDefaultConfig('');

  const saved = await OutlookCategoryConfig.findOne({ email, active: true }).lean();
  const defaults = buildDefaultConfig(email);

  if (!saved) return defaults;

  return {
    ...defaults,
    ...saved,
    priorityMap: mergeMap(saved.priorityMap, defaults.priorityMap),
    categoryMap:  mergeMap(saved.categoryMap,  defaults.categoryMap),
    intentMap:    mergeMap(saved.intentMap,    defaults.intentMap),
  };
}

/* ─── Runtime resolver (used by outlookCategorySync.service.js) ─── */

/**
 * Build lookup Maps from the resolved config — fast O(1) label lookups at push time.
 *
 * @param {Object} config - output of getOutlookCategoryConfig
 * @returns {{ priorityMap, categoryMap, intentMap, replyNeededLabel, replyNeededEnabled }}
 */
export function buildLookupMaps(config) {
  const toMap = (entries) => new Map(
    (entries || []).filter((e) => e.enabled).map((e) => [e.dbValue, e.outlookLabel]),
  );
  return {
    priorityMap:        toMap(config.priorityMap),
    categoryMap:        toMap(config.categoryMap),
    intentMap:          toMap(config.intentMap),
    replyNeededEnabled: config.replyNeededEnabled !== false,
    replyNeededLabel:   config.replyNeededLabel   || '💬 Reply Needed',
  };
}

/* ─── Public: Save / update config ─── */

/**
 * Save (upsert) the Outlook category config for an account.
 * After saving, re-push updated labels to all already-prioritized Outlook
 * emails so Outlook reflects the new label names immediately.
 *
 * @param {string} email
 * @param {Object} data  - partial or full config body from the API
 * @returns {Promise<Object>} saved config (merged with defaults)
 */
export async function saveOutlookCategoryConfig(email, data) {
  if (!email) throw new Error('email is required');

  // Upsert
  let doc = await OutlookCategoryConfig.findOne({ email });
  if (!doc) {
    doc = new OutlookCategoryConfig({ email });
  }

  // Apply only the fields the caller provided
  const fields = [
    'priorityMap', 'categoryMap', 'intentMap',
    'replyNeededEnabled', 'replyNeededLabel', 'replyNeededColour',
  ];
  for (const field of fields) {
    if (data[field] !== undefined) doc[field] = data[field];
  }
  doc.active = true;
  await OutlookCategoryConfig.saveData(doc);

  const merged = await getOutlookCategoryConfig(email);

  // Re-push labels to Outlook for all already-categorized emails (best-effort)
  _repushOutlookLabels(email, merged).catch((err) => {
    console.error(`[OutlookCategoryConfig] Re-push labels failed for ${email}:`, err.message);
  });

  return merged;
}

/* ─── Public: Reset to defaults ─── */

/**
 * Delete the saved config (hard-delete the doc) so the system defaults are used.
 */
export async function resetOutlookCategoryConfig(email) {
  if (!email) throw new Error('email is required');
  await OutlookCategoryConfig.deleteOne({ email });
  return buildDefaultConfig(email);
}

/* ─── Internal: re-push to Outlook after a config update ─── */

/**
 * Find all active, already-prioritized Outlook emails for the account and
 * re-push their category labels using the new config. Called automatically
 * when the config is saved. Runs in the background — never blocks the API.
 */
async function _repushOutlookLabels(email, config) {
  const lookup = buildLookupMaps(config);

  // Only emails that have been AI-prioritized (have category/priority set)
  const mails = await EmailAnalysisMail.find(
    {
      email,
      provider: 'outlook',
      active: true,
      priority: { $ne: null },
    },
    { providerMessageId: 1, priority: 1, category: 1, intent: 1, needsReply: 1 },
  ).lean();

  if (!mails.length) return;

  const items = mails.map((m) => ({
    providerMessageId: m.providerMessageId,
    priority:   m.priority,
    category:   m.category,
    intent:     m.intent,
    needsReply: !!m.needsReply,
    _lookup:    lookup, // pass resolved lookup to bulkPushCategories
  }));

  try {
    const service = await createMailService(email);

    // Sync/update master category definitions/colors in Outlook first
    if (typeof service.ensureOutlookMasterCategories === 'function') {
      await service.ensureOutlookMasterCategories().catch((err) => {
        console.warn(`[OutlookCategoryConfig] Master category sync failed during repush for ${email}:`, err.message);
      });
    }

    if (typeof service.bulkPushCategories !== 'function') return;

    // bulkPushCategories uses buildOutlookCategories internally — we need to
    // pass the custom lookup. We do this by temporarily using the configAware variant.
    await _bulkPushWithConfig(service, items, lookup);

    console.log(`[OutlookCategoryConfig] Re-pushed labels to ${mails.length} Outlook email(s) for ${email}`);
  } catch (err) {
    console.error(`[OutlookCategoryConfig] Re-push failed for ${email}:`, err.message);
  }
}

/**
 * Bulk push using a pre-resolved lookup map (bypasses the default hardcoded maps).
 * Uses the service's internal #graph via the public pushCategories method.
 */
async function _bulkPushWithConfig(service, items, lookup) {
  let pushed = 0;
  let failed = 0;
  for (const item of items) {
    const labels = _buildLabelsFromLookup(item, lookup);
    if (!labels.length) continue;
    try {
      await service.pushCategories(item.providerMessageId, { _rawLabels: labels });
      pushed += 1;
      await EmailAnalysisMail.updateOne(
        { email: service.email, provider: 'outlook', providerMessageId: item.providerMessageId },
        { $set: { categoriesSynced: true } }
      );
    } catch (err) {
      failed += 1;
      console.error(`[OutlookCategoryConfig] Push failed for ${item.providerMessageId}:`, err.message);
    }
  }
  console.log(`[OutlookCategoryConfig] Re-push complete: pushed=${pushed}, failed=${failed}`);
}

function _buildLabelsFromLookup({ priority, category, intent, needsReply }, lookup) {
  const labels = [];
  if (priority && lookup.priorityMap.has(priority))   labels.push(lookup.priorityMap.get(priority));
  if (category && lookup.categoryMap.has(category))   labels.push(lookup.categoryMap.get(category));
  if (intent   && lookup.intentMap.has(intent))       labels.push(lookup.intentMap.get(intent));
  if (needsReply && lookup.replyNeededEnabled)         labels.push(lookup.replyNeededLabel);
  return [...new Set(labels)];
}

export default {
  getOutlookCategoryConfig,
  saveOutlookCategoryConfig,
  resetOutlookCategoryConfig,
  buildDefaultConfig,
  buildLookupMaps,
};
