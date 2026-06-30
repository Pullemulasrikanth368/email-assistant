import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ConnectionsDelivery.scss';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import fetchMethodRequest from '../../../config/service';
import config from '../../../config/config';
import configImages from '../../../config/configImages';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import Loader from '../../App/Loader';

// Delivery time options for the brief schedule
const BRIEF_TIMES = [
  { label: '05:00 AM', value: '05:00 AM' },
  { label: '05:30 AM', value: '05:30 AM' },
  { label: '06:00 AM', value: '06:00 AM' },
  { label: '06:30 AM', value: '06:30 AM' },
  { label: '07:00 AM', value: '07:00 AM' },
  { label: '08:00 AM', value: '08:00 AM' },
];

// AI engine options for the email-analysis flow.
const AI_MODEL_OPTIONS = [
  { label: 'OpenAI (GPT-4o)', value: 'openai' },
  { label: 'Ollama (local)', value: 'ollama' },
];

const ConnectionsDelivery = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [connectedProvider, setConnectedProvider] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [sourceAccounts, setSourceAccounts] = useState([]);

  // Delivery / schedule preferences (front-end state for the brief configuration)
  const [emailBrief, setEmailBrief] = useState(true);
  const [teamsBrief, setTeamsBrief] = useState(false);
  const [escalationAlerts, setEscalationAlerts] = useState(true);
  const [briefTime, setBriefTime] = useState('06:00 AM');

  // Microsoft (Teams) connection
  const [msConnected, setMsConnected] = useState(false);
  const [msEmail, setMsEmail] = useState('');

  // Gmail read options (persisted in DB)
  const [includeSpam, setIncludeSpam] = useState(false);

  // AI engine for the email-analysis flow (persisted in DB)
  const [aiModel, setAiModel] = useState('openai');

  // Live mail-sync progress (background workers + manual syncs)
  const [syncStatus, setSyncStatus] = useState(null);
  const syncPollRef = useRef(null);

  // Remove-account dialog
  const [removeDialog, setRemoveDialog] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    // Show a toast for the result of either OAuth round-trip, then clean the URL.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('emailAnalysis');
    if (result === 'connected') {
      showToasterMessage('Google account connected successfully', 'success');
    } else if (result === 'error') {
      showToasterMessage('Could not connect the Google account', 'error');
    }

    const outlookResult = params.get('outlook');
    if (outlookResult === 'connected') {
      showToasterMessage('Outlook account connected successfully', 'success');
    } else if (outlookResult === 'error') {
      showToasterMessage('Could not connect the Outlook account', 'error');
    }

    const msResult = params.get('microsoft');
    if (msResult === 'connected') {
      showToasterMessage('Microsoft account connected successfully', 'success');
    } else if (msResult === 'error') {
      showToasterMessage('Could not connect the Microsoft account', 'error');
    }

    if (result || msResult || outlookResult) {
      params.delete('emailAnalysis');
      params.delete('microsoft');
      params.delete('outlook');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }

    getConnectionStatus();
    getMicrosoftStatus();
    getIncludeSpam();
    getAiModel();

    // Poll mail-sync progress (no loader overlay) so the bar reflects the
    // background workers in real time.
    const pollSync = () => {
      fetchMethodRequest('GET', 'email-analysis/sync-status')
        .then((resp) => { if (resp?.status) setSyncStatus(resp.status); })
        .catch(() => { /* ignore transient errors */ });
    };
    pollSync();
    syncPollRef.current = setInterval(pollSync, 3000);
    return () => { if (syncPollRef.current) clearInterval(syncPollRef.current); };
  }, []);

  const apiRequest = async (method, url, body = null) => {
    try {
      setIsLoading(true);
      return await fetchMethodRequest(method, url, body);
    } catch (err) {
      showToasterMessage(err?.message || 'Network error', 'error');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const getConnectionStatus = async () => {
    const resp = await apiRequest('GET', 'auth/google/email-analysis/accounts');
    const source = (resp?.accounts || []).filter((a) => a.purpose !== 'send');
    setSourceAccounts(source);
    if (source.length) {
      const current = source.find((a) => a.email === adminEmail) || source[0];
      setConnectedProvider(current.provider || 'google');
      setAdminEmail(current.email || '');
    } else {
      setConnectedProvider(null);
      setAdminEmail('');
    }
  };

  const getLoginEmail = () => {
    try { return JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; }
    catch { return ''; }
  };

  const handleGoogleLogin = () => {
    const login = encodeURIComponent(getLoginEmail());
    window.location.href = `${config.apiUrl}auth/google/email-analysis?login=${login}`;
  };

  const handleOutlookLogin = () => {
    const login = encodeURIComponent(getLoginEmail());
    window.location.href = `${config.apiUrl}auth/microsoft/outlook?login=${login}`;
  };

  const getMicrosoftStatus = async () => {
    const resp = await apiRequest('GET', 'auth/microsoft/teams/status');
    if (resp?.connected) {
      setMsConnected(true);
      setMsEmail(resp.email || '');
    } else {
      setMsConnected(false);
      setMsEmail('');
    }
  };

  const handleMicrosoftLogin = () => {
    window.location.href = config.apiUrl + 'auth/microsoft/teams';
  };

  const getIncludeSpam = async () => {
    const resp = await apiRequest('GET', 'email-analysis/include-spam');
    setIncludeSpam(!!resp?.includeSpam);
  };

  const getAiModel = async () => {
    const resp = await apiRequest('GET', 'email-analysis/ai-model');
    setAiModel(resp?.model === 'ollama' ? 'ollama' : 'openai');
  };

  const changeAiModel = async (value) => {
    const prev = aiModel;
    setAiModel(value); // optimistic
    const resp = await apiRequest('POST', 'email-analysis/ai-model', { model: value });
    if (resp?.respCode) {
      showToasterMessage(`AI engine set to ${value === 'ollama' ? 'Ollama' : 'OpenAI'}`, 'success');
    } else {
      setAiModel(prev); // revert
      showToasterMessage(resp?.errorMessage || 'Could not update AI engine', 'error');
    }
  };

  const toggleIncludeSpam = async (value) => {
    setIncludeSpam(value); // optimistic
    const resp = await apiRequest('POST', 'email-analysis/include-spam', { includeSpam: value });
    if (resp?.respCode) {
      showToasterMessage(value ? 'Spam will be included on next sync' : 'Spam excluded from sync', 'success');
    } else {
      setIncludeSpam(!value); // revert on failure
      showToasterMessage(resp?.errorMessage || 'Could not update spam preference', 'error');
    }
  };

  const disconnectMicrosoft = async () => {
    const resp = await apiRequest('POST', 'auth/microsoft/teams/disconnect', { email: msEmail });
    if (resp?.respCode) {
      setMsConnected(false);
      setMsEmail('');
      showToasterMessage(resp?.respMessage || 'Microsoft account disconnected', 'success');
    } else {
      showToasterMessage(resp?.errorMessage || 'Unable to disconnect Microsoft account', 'error');
    }
  };

  // purgeData=false -> disconnect only (keep synced mail);
  // purgeData=true  -> disconnect + delete all synced mail/attachments.
  const acceptRemove = async (purgeData) => {
    setRemoving(true);
    try {
      const resp = await apiRequest('POST', 'auth/google/email-analysis/disconnect', {
        email: adminEmail,
        provider: connectedProvider,
        purgeData,
      });
      if (resp?.respCode) {
        setConnectedProvider(null);
        setAdminEmail('');
        setRemoveDialog(false);
        showToasterMessage(resp?.respMessage || 'Account removed successfully', 'success');
      } else {
        showToasterMessage(resp?.errorMessage || 'Unable to remove account', 'error');
      }
    } catch {
      /* network error already surfaced by apiRequest */
    } finally {
      setRemoving(false);
    }
  };

  const handleRemoveAccount = () => setRemoveDialog(true);

  const isGoogleConnected = sourceAccounts.some((a) => a.provider === 'google');
  const isOutlookConnected = sourceAccounts.some((a) => a.provider === 'outlook' || a.provider === 'microsoft');
  const hasSourceAccount = sourceAccounts.length > 0;

  const changeActiveSource = (email) => {
    const account = sourceAccounts.find((a) => a.email === email);
    setAdminEmail(email);
    setConnectedProvider(account?.provider || null);
  };

  const StatusPill = ({ on, children }) => (
    <span className={`cd-pill ${on ? 'ok' : 'off'}`}>{children}</span>
  );

  const SourceRow = ({ icon, name, desc, connected, account, onConnect }) => (
    <div className="cd-conn">
      <div className="cd-ic">{icon}</div>
      <div className="cd-conn-text">
        <div className="cd-nm">{name}</div>
        <div className="cd-ds">{desc}</div>
      </div>
      {connected ? (
        <div className="d-flex align-items-center gap-2">
          <StatusPill on>connected</StatusPill>
          <Button variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10" onClick={handleRemoveAccount}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button size="sm" className="app-btn" onClick={handleGoogleLogin}>Connect</Button>
      )}
    </div>
  );

  const DeliveryRow = ({ icon, name, desc, checked, onChange }) => (
    <div className="cd-conn">
      <div className="cd-ic">{icon}</div>
      <div className="cd-conn-text">
        <div className="cd-nm">{name}</div>
        <div className="cd-ds">{desc}</div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <StatusPill on={checked}>{checked ? 'on' : 'off'}</StatusPill>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
    </div>
  );

  return (
    <div className="conn-delivery">
      <Loader loader={isLoading} />

      <Dialog open={removeDialog} onOpenChange={(o) => { if (!o && !removing) setRemoveDialog(false); }}>
        <DialogContent className="max-w-[480px] w-[94vw]">
          <DialogHeader>
            <DialogTitle>Remove Google account</DialogTitle>
          </DialogHeader>
          <p className="cd-remove-intro">
            Choose how you want to remove {adminEmail ? <b>{adminEmail}</b> : 'this account'}.
          </p>

          <div className="cd-remove-option">
            <div className="cd-remove-option-text">
              <div className="cd-remove-option-title">Disconnect account only</div>
              <div className="cd-remove-option-desc">
                Removes the Google connection. Emails and attachments already synced into the
                system are kept.
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={removing} onClick={() => acceptRemove(false)}>
              Disconnect
            </Button>
          </div>

          <div className="cd-remove-option danger">
            <div className="cd-remove-option-text">
              <div className="cd-remove-option-title">Disconnect &amp; delete data</div>
              <div className="cd-remove-option-desc">
                Removes the connection and permanently deletes all synced emails and attachments
                for this account. This cannot be undone.
              </div>
            </div>
            <Button variant="destructive" size="sm" disabled={removing} onClick={() => acceptRemove(true)}>
              Delete all
            </Button>
          </div>

          <div className="cd-remove-footer">
            <Button variant="ghost" size="sm" disabled={removing} onClick={() => setRemoveDialog(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="cd-topbar">
        <div>
          <div className="cd-eyebrow">Settings</div>
          <h1 className="cd-title">Connections &amp; delivery</h1>
        </div>
        {hasSourceAccount && adminEmail && (
          <div className="cd-account">{connectedProvider === 'outlook' ? 'Outlook' : 'Gmail'} · {adminEmail}</div>
        )}
      </div>

      <div className="cd-grid">
        {/* Left column */}
        <div className="cd-col">
          {/* Sources */}
          <div className="cd-panel">
            <div className="cd-ph">Sources</div>
            <SourceRow
              icon={<img src={configImages.gmailLogo} alt="Gmail" className="cd-logo" />}
              name="Google Workspace inbox"
              desc="Reads overnight email for the brief"
            />

            {/* Live sync progress */}
            {isGoogleConnected && syncStatus && (syncStatus.active || syncStatus.phase === 'done' || syncStatus.phase === 'error') && (
              <div className="cd-syncbar">
                {syncStatus.active ? (
                  <>
                    <div className="cd-syncbar-head">
                      <span className="cd-syncbar-label">
                        {syncStatus.phase === 'saving' && syncStatus.total
                          ? `Syncing mail… ${syncStatus.processed}/${syncStatus.total}`
                          : syncStatus.phase === 'fetching' ? 'Fetching messages…' : 'Starting sync…'}
                      </span>
                      <span className="cd-syncbar-pct">
                        {syncStatus.saved ? `${syncStatus.saved} new` : ''}
                        {syncStatus.total ? `${syncStatus.saved ? ' · ' : ''}${syncStatus.percent}%` : ''}
                      </span>
                    </div>
                    <Progress
                      value={syncStatus.total ? syncStatus.percent : undefined}
                      className="cd-progress"
                    />
                  </>
                ) : syncStatus.phase === 'error' ? (
                  <div className="cd-sync-note err"><i className="pi pi-exclamation-triangle" /> Sync error: {syncStatus.error}</div>
                ) : (
                  <div className="cd-sync-note ok"><i className="pi pi-check-circle" /> Synced — last run added {syncStatus.saved || 0} new email(s)</div>
                )}
              </div>
            )}

            <DeliveryRow
              icon={<span className="cd-ic-text">!</span>}
              name="Include spam"
              desc="Also read Spam mail when syncing (shows as Junk in analytics)"
              checked={includeSpam}
              onChange={toggleIncludeSpam}
            />
          </div>

          {/* Delivery */}
          <div className="cd-panel">
            <div className="cd-ph">Delivery</div>
            <DeliveryRow
              icon={<span className="cd-ic-text">@</span>}
              name={`Email brief at ${briefTime}`}
              desc="Formatted brief to your inbox"
              checked={emailBrief}
              onChange={setEmailBrief}
            />
            {/* Microsoft Teams */}
            <div className="cd-conn">
              <div className="cd-ic"><span className="cd-ic-text">TM</span></div>
              <div className="cd-conn-text">
                <div className="cd-nm">Microsoft Teams</div>
                <div className="cd-ds">
                  {msConnected
                    ? `Connected as ${msEmail || 'Microsoft account'} — posts the brief to your channel`
                    : 'Sign in with Microsoft to post the brief to a Teams channel'}
                </div>
              </div>
              {msConnected ? (
                <div className="d-flex align-items-center gap-2">
                  <StatusPill on={teamsBrief}>{teamsBrief ? 'on' : 'off'}</StatusPill>
                  <Switch checked={teamsBrief} onCheckedChange={setTeamsBrief} />
                  <Button variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10" onClick={disconnectMicrosoft}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button size="sm" className="app-btn" onClick={handleMicrosoftLogin}>Connect</Button>
              )}
            </div>
            <DeliveryRow
              icon={<span className="cd-ic-text">!</span>}
              name="Escalation alerts"
              desc="Immediate ping when a risk scores ≥ 16"
              checked={escalationAlerts}
              onChange={setEscalationAlerts}
            />
          </div>
        </div>

        {/* Right column */}
        <div className="cd-col">
          {/* Tools */}
          <div className="cd-panel">
            <div className="cd-ph">Tools</div>
            <div className="cd-conn">
              <div className="cd-ic"><span className="cd-ic-text">↑</span></div>
              <div className="cd-conn-text">
                <div className="cd-nm">Bulk email send</div>
                <div className="cd-ds">Upload a .js file of emails and send them through this account</div>
              </div>
              <Button size="sm" className="app-btn" disabled={!isGoogleConnected} onClick={() => navigate('/bulkEmailSend')}>
                Open
              </Button>
            </div>
          </div>

          {/* AI engine */}
          <div className="cd-panel">
            <div className="cd-ph">AI engine</div>
            <div className="cd-field">
              <label>Model used to analyze, prioritize &amp; draft replies</label>
              <Select value={aiModel || ''} onValueChange={changeAiModel}>
                <SelectTrigger className="cd-time-dropdown">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(AI_MODEL_OPTIONS || []).map((o) => (
                    <SelectItem key={o.value || o} value={o.value || o}>{o.label || o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Schedule */}
          <div className="cd-panel">
            <div className="cd-ph">Schedule</div>
            <div className="cd-field">
              <label>Brief generated at</label>
              <Select value={briefTime || ''} onValueChange={setBriefTime}>
                <SelectTrigger className="cd-time-dropdown">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRIEF_TIMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionsDelivery;
