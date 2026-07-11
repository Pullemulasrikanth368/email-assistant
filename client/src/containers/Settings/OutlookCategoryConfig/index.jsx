import { useEffect, useState, useCallback } from 'react';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { Tag } from 'primereact/tag';
import { Accordion, AccordionTab } from 'primereact/accordion';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import './OutlookCategoryConfig.scss';

/* ─── Graph preset colour options ─── */
const COLOUR_OPTIONS = [
  { label: 'None',         value: 'none',     hex: '#9ca3af' },
  { label: 'Red',         value: 'preset0',   hex: '#ef4444' },
  { label: 'Orange',      value: 'preset1',   hex: '#f97316' },
  { label: 'Green',       value: 'preset2',   hex: '#22c55e' },
  { label: 'Yellow',      value: 'preset3',   hex: '#eab308' },
  { label: 'Blue',        value: 'preset4',   hex: '#3b82f6' },
  { label: 'Purple',      value: 'preset5',   hex: '#a855f7' },
  { label: 'Teal',        value: 'preset6',   hex: '#14b8a6' },
  { label: 'Light Blue',  value: 'preset7',   hex: '#38bdf8' },
  { label: 'Pink',        value: 'preset8',   hex: '#ec4899' },
  { label: 'Gray',        value: 'preset9',   hex: '#6b7280' },
  { label: 'Light Green', value: 'preset10',  hex: '#4ade80' },
];

const colourHex = (value) => COLOUR_OPTIONS.find((c) => c.value === value)?.hex || '#9ca3af';

/* ─── Accordion tab header: icon + title + label count ─── */
const accHeader = (icon, title, count) => (
  <span className="occ-acc-header">
    <i className={`pi ${icon}`} />
    <span className="occ-acc-header-title">{title}</span>
    {count !== undefined && <span className="occ-acc-count">{count}</span>}
  </span>
);

/* ─── Section: renders a group of category entries (priority/category/intent) ─── */
function CategoryMapSection({ entries = [], onChange }) {
  const handleField = (idx, field, value) => {
    const next = entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e));
    onChange(next);
  };

  const colourTemplate = (option) => (
    <div className="occ-colour-option">
      <span className="occ-colour-dot" style={{ background: option.hex }} />
      <span>{option.label}</span>
    </div>
  );

  return (
    <div className="occ-entries">
      {entries.map((entry, idx) => (
          <div key={entry.dbValue} className={`occ-entry ${!entry.enabled ? 'occ-entry--disabled' : ''}`}>
            {/* Enable toggle */}
            <InputSwitch
              checked={entry.enabled !== false}
              onChange={(e) => handleField(idx, 'enabled', e.value)}
              className="occ-toggle"
              tooltip={entry.enabled !== false ? 'Enabled' : 'Disabled'}
              tooltipOptions={{ position: 'top' }}
            />

            {/* DB value (read-only — what we store in our DB) */}
            <div className="occ-db-value">
              <span className="occ-db-badge">{entry.dbValue}</span>
            </div>

            {/* Arrow */}
            <i className="pi pi-arrow-right occ-arrow" />

            {/* Outlook label (editable) */}
            <InputText
              value={entry.outlookLabel}
              onChange={(e) => handleField(idx, 'outlookLabel', e.target.value)}
              placeholder="Outlook label name"
              disabled={entry.enabled === false}
              className="occ-label-input"
            />

            {/* Colour picker */}
            <Dropdown
              value={entry.colour || 'none'}
              options={COLOUR_OPTIONS}
              onChange={(e) => handleField(idx, 'colour', e.value)}
              itemTemplate={colourTemplate}
              valueTemplate={(opt) => opt && (
                <div className="occ-colour-option">
                  <span className="occ-colour-dot" style={{ background: colourHex(opt.value) }} />
                  <span>{opt.label}</span>
                </div>
              )}
              disabled={entry.enabled === false}
              className="occ-colour-dropdown"
              placeholder="Colour"
            />

            {/* Live preview tag */}
            <Tag
              value={entry.outlookLabel || '—'}
              style={{
                background: entry.enabled !== false ? colourHex(entry.colour || 'none') : '#e5e7eb',
                color: '#fff',
                fontSize: '10px',
                minWidth: 64,
                textAlign: 'center',
                opacity: entry.enabled !== false ? 1 : 0.4,
              }}
            />
          </div>
        ))}
    </div>
  );
}

/* ─── Main component ─── */
export default function OutlookCategoryConfig() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [resetting, setResetting] = useState(false);

  const [config, setConfig] = useState(null);

  /* ── Load ── */
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/outlook-category-config');
      if (res?.respCode === 200 && res.config) {
        setConfig(res.config);
      }
    } catch {
      showToasterMessage('Failed to load Outlook category config', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  /* ── Save ── */
  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/outlook-category-config', config);
      if (res?.respCode === 200) {
        showToasterMessage('Category config saved. Outlook labels are being updated.', 'success');
        setConfig(res.config);
      } else {
        showToasterMessage(res?.errorMessage || 'Failed to save', 'error');
      }
    } catch {
      showToasterMessage('Failed to save Outlook category config', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── Reset ── */
  const handleReset = () => {
    confirmDialog({
      message: 'Reset all Outlook category labels to system defaults? This will also re-push default labels to all Outlook emails.',
      header: 'Reset to Defaults',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        setResetting(true);
        try {
          const res = await fetchMethodRequest('DELETE', 'email-analysis/outlook-category-config');
          if (res?.respCode === 200) {
            showToasterMessage('Reset to defaults.', 'success');
            setConfig(res.config);
          } else {
            showToasterMessage(res?.errorMessage || 'Reset failed', 'error');
          }
        } catch {
          showToasterMessage('Reset failed', 'error');
        } finally {
          setResetting(false);
        }
      },
    });
  };

  /* ── Helpers to update sub-maps ── */
  const setMap = (field) => (entries) => setConfig((c) => ({ ...c, [field]: entries }));

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="occ-loading">
        <i className="pi pi-spin pi-spinner" style={{ fontSize: '1.25rem', color: '#111827' }} />
        <span>Loading category config…</span>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="occ-root">
      <ConfirmDialog />

      {/* Header */}
      <div className="occ-header">
        <div className="occ-header-left">
          <i className="pi pi-microsoft occ-header-icon" />
          <div>
            <h2 className="occ-title">Outlook Category Labels</h2>
            <p className="occ-subtitle">
              Configure which labels are pushed to Outlook for each AI-assigned priority, category, and intent.
              Changes are applied to all existing Outlook emails automatically.
            </p>
          </div>
        </div>
        <div className="occ-header-actions">
          <Button
            label="Reset to Defaults"
            icon={resetting ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'}
            onClick={handleReset}
            disabled={saving || resetting}
            className="p-button-outlined p-button-secondary occ-reset-btn"
          />
          <Button
            label={saving ? 'Saving…' : 'Save & Push to Outlook'}
            icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-send'}
            onClick={handleSave}
            disabled={saving || resetting}
            className="occ-save-btn"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="occ-legend">
        <span className="occ-legend-item"><i className="pi pi-toggle-on" style={{color:'#22c55e'}}/> Enabled — label pushed to Outlook</span>
        <span className="occ-legend-item"><i className="pi pi-toggle-off" style={{color:'#9ca3af'}}/> Disabled — label skipped</span>
        <span className="occ-legend-item"><i className="pi pi-tag" style={{color:'#3b82f6'}}/> Preview shows how it appears in Outlook</span>
      </div>

      {/* Sections — accordion, open panel highlighted */}
      <Accordion multiple activeIndex={[0]} className="occ-accordion">
        {/* Priority Map */}
        <AccordionTab header={accHeader('pi-flag', 'Priority Labels', (config.priorityMap || []).length)}>
          <CategoryMapSection
            entries={config.priorityMap || []}
            onChange={setMap('priorityMap')}
          />
        </AccordionTab>

        {/* Category Map */}
        <AccordionTab header={accHeader('pi-th-large', 'Category Labels', (config.categoryMap || []).length)}>
          <CategoryMapSection
            entries={config.categoryMap || []}
            onChange={setMap('categoryMap')}
          />
        </AccordionTab>

        {/* Intent Map */}
        <AccordionTab header={accHeader('pi-bolt', 'Intent Labels', (config.intentMap || []).length)}>
          <CategoryMapSection
            entries={config.intentMap || []}
            onChange={setMap('intentMap')}
          />
        </AccordionTab>

        {/* Reply Needed */}
        <AccordionTab header={accHeader('pi-reply', 'Reply Needed Label')}>
          <div className="occ-reply-row">
          <InputSwitch
            checked={config.replyNeededEnabled !== false}
            onChange={(e) => setConfig((c) => ({ ...c, replyNeededEnabled: e.value }))}
            tooltip={config.replyNeededEnabled !== false ? 'Enabled' : 'Disabled'}
            tooltipOptions={{ position: 'top' }}
          />
          <span className="occ-db-badge">needsReply</span>
          <i className="pi pi-arrow-right occ-arrow" />
          <InputText
            value={config.replyNeededLabel || ''}
            onChange={(e) => setConfig((c) => ({ ...c, replyNeededLabel: e.target.value }))}
            placeholder="Reply needed label"
            disabled={config.replyNeededEnabled === false}
            className="occ-label-input"
          />
          <Dropdown
            value={config.replyNeededColour || 'none'}
            options={COLOUR_OPTIONS}
            onChange={(e) => setConfig((c) => ({ ...c, replyNeededColour: e.value }))}
            itemTemplate={(opt) => (
              <div className="occ-colour-option">
                <span className="occ-colour-dot" style={{ background: opt.hex }} />
                <span>{opt.label}</span>
              </div>
            )}
            valueTemplate={(opt) => opt && (
              <div className="occ-colour-option">
                <span className="occ-colour-dot" style={{ background: colourHex(opt.value) }} />
                <span>{opt.label}</span>
              </div>
            )}
            disabled={config.replyNeededEnabled === false}
            className="occ-colour-dropdown"
          />
          <Tag
            value={config.replyNeededLabel || '—'}
            style={{
              background: config.replyNeededEnabled !== false ? colourHex(config.replyNeededColour || 'none') : '#e5e7eb',
              color: '#fff',
              fontSize: '10px',
              minWidth: 64,
              textAlign: 'center',
              opacity: config.replyNeededEnabled !== false ? 1 : 0.4,
            }}
          />
          </div>
        </AccordionTab>
      </Accordion>

      {/* Footer save */}
      <div className="occ-footer">
        <Button
          label={saving ? 'Saving…' : 'Save & Push to Outlook'}
          icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-send'}
          onClick={handleSave}
          disabled={saving || resetting}
          className="occ-save-btn"
        />
      </div>
    </div>
  );
}
