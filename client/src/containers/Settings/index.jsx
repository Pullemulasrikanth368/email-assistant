import { useEffect, useRef, useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Divider } from 'primereact/divider';
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

const AI_TYPE_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Ollama', value: 'ollama' },
];

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    companyName: '',
    adminEmail: '',
    sendGridApiKey: '',
    sendGridEmail: '',
    aiType: 'openai',
    emailAnalysisBriefTime: '06:00',
    emailAnalysisIncludeSpam: false,
    emailAnalysisModel: 'openai',
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'settings');
      if (res && res.respCode === 200 && res.settings && res.settings[0]) {
        const s = res.settings[0];
        setForm({
          companyName: s.companyName || '',
          adminEmail: s.adminEmail || '',
          sendGridApiKey: s.sendGridApiKey || '',
          sendGridEmail: s.sendGridEmail || '',
          aiType: s.aiType || 'openai',
          emailAnalysisBriefTime: s.emailAnalysisBriefTime || '06:00',
          emailAnalysisIncludeSpam: s.emailAnalysisIncludeSpam || false,
          emailAnalysisModel: s.emailAnalysisModel || 'openai',
        });
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
    setSaving(true);
    try {
      const res = await fetchMethodRequest('PUT', 'settings', form);
      if (res && (res.respCode === 205 || res.respCode === 200)) {
        showToasterMessage('Settings saved successfully', 'success');
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
        <i className="pi pi-spin pi-spinner" style={{ fontSize: '2rem', color: '#1a73e8' }} />
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

        <Divider />

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

        <Divider />

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
            <div className="ea-field ea-field-switch">
              <label className="ea-label">Include Spam in Sync</label>
              <InputSwitch
                checked={form.emailAnalysisIncludeSpam}
                onChange={(e) => handleChange('emailAnalysisIncludeSpam', e.value)}
              />
              <span className="ea-field-hint">When enabled, Gmail spam folder is included in the analysis</span>
            </div>
          </div>
        </section>

        <Divider />

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

        <Divider />

        {/* Section: AI */}
        <section className="ea-settings-section">
          <h2 className="ea-section-title">
            <i className="pi pi-microchip-ai" /> AI Provider
          </h2>
          <div className="ea-settings-grid">
            <div className="ea-field">
              <label className="ea-label">Default AI Type</label>
              <Dropdown
                value={form.aiType}
                options={AI_TYPE_OPTIONS}
                onChange={(e) => handleChange('aiType', e.value)}
                className="ea-input"
                placeholder="Select AI type"
              />
              <span className="ea-field-hint">Global AI provider used across all features</span>
            </div>
          </div>
        </section>

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
