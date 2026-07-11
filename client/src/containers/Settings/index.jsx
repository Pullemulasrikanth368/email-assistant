import { useEffect, useRef, useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import fetchMethodRequest from '../../config/service';
import showToasterMessage from '../UI/ToasterMessage/toasterMessage';
import './Settings.scss';

const AI_MODEL_OPTIONS = [
  { label: 'OpenAI (GPT-4o)', value: 'openai' },
  { label: 'Ollama (local)', value: 'ollama' },
];

const BRIEF_TIME_OPTIONS = [
  { label: '05:00 AM', value: '05:00' },
  { label: '05:30 AM', value: '05:30' },
  { label: '06:00 AM', value: '06:00' },
  { label: '06:30 AM', value: '06:30' },
  { label: '07:00 AM', value: '07:00' },
  { label: '08:00 AM', value: '08:00' },
  { label: '09:00 AM', value: '09:00' },
];

const SYNC_UNIT_OPTIONS = [
  { label: 'Minutes', value: 'minutes' },
  { label: 'Hours', value: 'hours' },
  { label: 'Days', value: 'days' },
];

const SYNC_UNIT_MAX = { minutes: 60, hours: 23, days: 31 };

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    companyName: '',
    adminEmail: '',
    sendGridApiKey: '',
    sendGridEmail: '',
    emailAnalysisBriefTime: '06:00',
    emailAnalysisModel: 'openai',
  });

  // Sync preferences (moved here from the sidebar profile modal)
  const [autoSync, setAutoSync] = useState(true);
  const [syncValue, setSyncValue] = useState(15);
  const [syncUnit, setSyncUnit] = useState('minutes');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [res, syncRes, intervalRes] = await Promise.all([
        fetchMethodRequest('GET', 'settings'),
        fetchMethodRequest('GET', 'email-analysis/auto-sync').catch(() => null),
        fetchMethodRequest('GET', 'email-analysis/sync-interval').catch(() => null),
      ]);
      if (res && res.respCode === 200 && res.settings && res.settings[0]) {
        const s = res.settings[0];
        setForm({
          companyName: s.companyName || '',
          adminEmail: s.adminEmail || '',
          sendGridApiKey: s.sendGridApiKey || '',
          sendGridEmail: s.sendGridEmail || '',
          emailAnalysisBriefTime: s.emailAnalysisBriefTime || '06:00',
          emailAnalysisModel: s.emailAnalysisModel || 'openai',
        });
      }
      if (syncRes?.autoSync !== undefined) {
        setAutoSync(syncRes.autoSync !== false);
      }
      if (intervalRes?.syncIntervalValue !== undefined) {
        setSyncValue(Number(intervalRes.syncIntervalValue) || 15);
        setSyncUnit(intervalRes.syncIntervalUnit || 'minutes');
      } else if (intervalRes?.syncIntervalMinutes !== undefined) {
        setSyncValue(Number(intervalRes.syncIntervalMinutes) || 15);
        setSyncUnit('minutes');
      }
    } catch {
      showToasterMessage('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    // Validate sync interval before saving anything
    const val = Number(syncValue);
    if (autoSync && (isNaN(val) || val < 1 || val > SYNC_UNIT_MAX[syncUnit])) {
      showToasterMessage(`Sync frequency must be between 1 and ${SYNC_UNIT_MAX[syncUnit]} ${syncUnit}`, 'warning');
      return;
    }

    setSaving(true);
    try {
      const [res, syncRes, intervalRes] = await Promise.all([
        fetchMethodRequest('PUT', 'settings', form),
        fetchMethodRequest('POST', 'email-analysis/auto-sync', { autoSync }).catch(() => null),
        autoSync
          ? fetchMethodRequest('POST', 'email-analysis/sync-interval', {
              syncIntervalValue: val,
              syncIntervalUnit: syncUnit,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (res && (res.respCode === 205 || res.respCode === 200)) {
        showToasterMessage('Settings saved successfully', 'success');
        if (syncRes?.respCode || intervalRes?.respCode) {
          window.dispatchEvent(new CustomEvent('syncSettingsUpdated'));
        }
      } else {
        showToasterMessage(res?.errorMessage || 'Failed to save settings', 'error');
      }
    } catch {
      showToasterMessage('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ea-settings-loading">
        <i className="pi pi-spin pi-spinner" style={{ fontSize: '1.5rem', color: '#111827' }} />
        <p>Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="ea-settings-page">
      <div className="ea-settings-container">

        {/* Page Header */}
        <div className="ea-settings-header">
          <div className="ea-settings-header-left">
            <i className="pi pi-cog ea-settings-header-icon" />
            <div>
              <h1 className="ea-settings-title">Settings</h1>
              <p className="ea-settings-subtitle">Configure the Executive Email Assistant</p>
            </div>
          </div>
          <Button
            label={saving ? 'Saving…' : 'Save Changes'}
            icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
            onClick={handleSave}
            disabled={saving}
            className="ea-settings-save-btn"
          />
        </div>

        {/* Section cards — fill the width, no wasted space */}
        <div className="ea-settings-sections">

        {/* Section: General */}
        <section className="ea-settings-section">
          <h2 className="ea-section-title">
            <i className="pi pi-building" /> General
          </h2>
          <div className="ea-settings-grid">
            <div className="ea-field">
              <label className="ea-label">Company Name</label>
              <InputText
                value={form.companyName}
                onChange={(e) => handleChange('companyName', e.target.value)}
                placeholder="Acme Inc."
                className="ea-input"
              />
            </div>
            <div className="ea-field">
              <label className="ea-label">Admin Email</label>
              <InputText
                type="email"
                value={form.adminEmail}
                onChange={(e) => handleChange('adminEmail', e.target.value)}
                placeholder="admin@company.com"
                className="ea-input"
              />
            </div>
          </div>
        </section>

        {/* Section: Email Analysis */}
        <section className="ea-settings-section">
          <h2 className="ea-section-title">
            <i className="pi pi-envelope" /> Email Analysis
          </h2>
          <div className="ea-settings-grid">
            <div className="ea-field">
              <label className="ea-label">Daily Brief Time</label>
              <Dropdown
                value={form.emailAnalysisBriefTime}
                options={BRIEF_TIME_OPTIONS}
                onChange={(e) => handleChange('emailAnalysisBriefTime', e.value)}
                className="ea-input"
                placeholder="Select time"
              />
              <span className="ea-field-hint">Time the morning brief is generated (server timezone)</span>
            </div>
            <div className="ea-field">
              <label className="ea-label">AI Model</label>
              <Dropdown
                value={form.emailAnalysisModel}
                options={AI_MODEL_OPTIONS}
                onChange={(e) => handleChange('emailAnalysisModel', e.value)}
                className="ea-input"
                placeholder="Select AI model"
              />
              <span className="ea-field-hint">Backend used for email analysis and brief generation</span>
            </div>
          </div>
        </section>

        {/* Section: SendGrid */}
        <section className="ea-settings-section">
          <h2 className="ea-section-title">
            <i className="pi pi-send" /> SendGrid (Bulk Email)
          </h2>
          <div className="ea-settings-grid">
            <div className="ea-field">
              <label className="ea-label">SendGrid API Key</label>
              <InputText
                value={form.sendGridApiKey}
                onChange={(e) => handleChange('sendGridApiKey', e.target.value)}
                placeholder="SG.xxxx"
                className="ea-input"
                type="password"
              />
            </div>
            <div className="ea-field">
              <label className="ea-label">SendGrid From Email</label>
              <InputText
                type="email"
                value={form.sendGridEmail}
                onChange={(e) => handleChange('sendGridEmail', e.target.value)}
                placeholder="noreply@company.com"
                className="ea-input"
              />
            </div>
          </div>
        </section>

        {/* Section: Sync Preferences (moved from profile modal) */}
        <section className="ea-settings-section">
          <h2 className="ea-section-title">
            <i className="pi pi-sync" /> Sync Preferences
          </h2>
          <div className="ea-settings-grid">
            <div className="ea-field ea-field-switch">
              <label className="ea-label">Auto-sync mailboxes</label>
              <InputSwitch
                checked={autoSync}
                onChange={(e) => setAutoSync(e.value)}
              />
              <span className="ea-field-hint">Automatically sync connected mailboxes in the background</span>
            </div>
            {autoSync && (
              <div className="ea-field">
                <label className="ea-label">Sync Frequency</label>
                <div className="ea-sync-frequency">
                  <InputText
                    type="number"
                    min={1}
                    max={SYNC_UNIT_MAX[syncUnit]}
                    value={syncValue}
                    onChange={(e) => setSyncValue(Math.max(1, parseInt(e.target.value) || 1))}
                    className="ea-input ea-sync-value"
                  />
                  <Dropdown
                    value={syncUnit}
                    options={SYNC_UNIT_OPTIONS}
                    onChange={(e) => {
                      setSyncUnit(e.value);
                      if (syncValue > SYNC_UNIT_MAX[e.value]) setSyncValue(1);
                    }}
                    className="ea-input ea-sync-unit"
                  />
                </div>
                <span className="ea-field-hint">How often the automated background sync runs</span>
              </div>
            )}
          </div>
        </section>

        </div>

        {/* Bottom Save */}
        <div className="ea-settings-footer">
          <Button
            label={saving ? 'Saving…' : 'Save Changes'}
            icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
            onClick={handleSave}
            disabled={saving}
            className="ea-settings-save-btn"
          />
          <Button
            label="Refresh"
            icon="pi pi-refresh"
            onClick={fetchSettings}
            className="p-button-outlined ea-settings-refresh-btn"
            disabled={loading || saving}
          />
        </div>
      </div>
    </div>
  );
};

export default Settings;
