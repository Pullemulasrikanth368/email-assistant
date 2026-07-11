/**
 * useCategoryLabels
 *
 * Maps internal DB category values (e.g. "Finance & Invoices") to the
 * user-editable Outlook labels (e.g. "Finance") from the Outlook category
 * config, so the app UI and Outlook show the same tag names.
 *
 * The DB value stays the canonical key everywhere (AI, grouping, chip colors);
 * this hook only changes what is DISPLAYED. Unknown / disabled values fall
 * back to the raw DB value, so old reports and "Other" render unchanged.
 *
 * The config is fetched once per page load and shared by every caller.
 */
import { useEffect, useState } from 'react';
import fetchMethodRequest from '../../../config/service';

let cachedMap = null;
let pending = null;

const loadLabelMap = () => {
  if (cachedMap) return Promise.resolve(cachedMap);
  if (!pending) {
    pending = fetchMethodRequest('GET', 'email-analysis/outlook-category-config')
      .then((res) => {
        const entries = res?.config?.categoryMap || [];
        cachedMap = new Map(
          entries
            .filter((e) => e?.enabled !== false && e?.dbValue && e?.outlookLabel)
            .map((e) => [e.dbValue, e.outlookLabel]),
        );
        return cachedMap;
      })
      .catch(() => {
        pending = null;
        return new Map();
      });
  }
  return pending;
};

/** Returns labelFor(dbValue) — the Outlook label, or the raw value as fallback. */
const useCategoryLabels = () => {
  const [map, setMap] = useState(cachedMap);
  useEffect(() => {
    if (map) return undefined;
    let cancelled = false;
    loadLabelMap().then((m) => { if (!cancelled) setMap(m); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (dbValue) => (map && map.get(dbValue)) || dbValue || '';
};

export default useCategoryLabels;
