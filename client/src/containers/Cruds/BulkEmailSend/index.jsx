import { useEffect, useRef, useState } from 'react';
import { Send, Plus } from 'lucide-react';
import fetchMethodRequest from '../../../config/service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import config from '../../../config/config';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import './BulkEmailSend.scss';

/* ------------------------------------------------------------------ */
/* Parse an uploaded .js module's text into an array of email objects. */
/* Accepts the mockEmails.js shape:                                    */
/*   export const mockEmails = [ ... ];  export default mockEmails;     */
/* This runs only on a file the admin explicitly uploads.              */
/* ------------------------------------------------------------------ */
const parseEmailsFromJs = (source = '') => {
  const nameMatch = source.match(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*\[/);
  const target = nameMatch ? nameMatch[1] : null;
  const code = String(source)
    .replace(/import\s*\.\s*meta/g, '({url:""})')   // neutralize ESM-only import.meta
    .replace(/^\s*import\s[^\n;]*;?\s*$/gm, '')      // strip ES import statement lines only
    .replace(/export\s+default\s+/g, 'var __default__ = ')
    .replace(/export\s+(const|let|var)\s+/g, '$1 ')
    .replace(/export\s*\{[\s\S]*?\};?/g, '');

  // `process` is shimmed (self-contained — NOT the Vite polyfill, which has no
  // argv) so files referencing process.argv in run-as-script blocks don't throw.
  const fn = new Function(`"use strict";
    var process = { argv: [] };
    ${code}
    ${target ? `try { if (typeof ${target} !== 'undefined') return ${target}; } catch (e) {}` : ''}
    if (typeof __default__ !== 'undefined') return __default__;
    return undefined;`);
  const result = fn();
  if (!Array.isArray(result)) {
    throw new Error('Could not find an exported array of emails in this file.');
  }
  return result;
};

const parseSenderName = (raw = '') => {
  const match = String(raw).match(/^\s*"?([^"<]*)"?\s*</);
  return match ? (match[1] || '').trim() : String(raw).trim();
};

const looksLikeHtml = (s = '') => /<[a-z!][\s\S]*>/i.test(String(s));
// An email is sent as HTML if it has an explicit `html` field or an HTML-looking body.
const isHtmlEmail = (m = {}) => !!(m.html && String(m.html).trim()) || looksLikeHtml(m.body);

const BulkEmailSend = () => {
  const fileInputRef = useRef(null);

  const [toAddress, setToAddress] = useState('');
  const [fileName, setFileName] = useState('');
  const [emails, setEmails] = useState([]);
  const [parseError, setParseError] = useState('');

  const [accounts, setAccounts] = useState([]);          // all connected mail accounts
  const [fromAccount, setFromAccount] = useState('');    // selected "send from" account
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState(null);

  /* Load all connected accounts for the "send from" picker. */
  const loadAccounts = () => {
    fetchMethodRequest('GET', 'auth/google/email-analysis/accounts')
      .then((resp) => {
        const list = Array.isArray(resp?.accounts) ? resp.accounts : [];
        setAccounts(list);
        // keep current selection if still present, else default to the most recent
        setFromAccount((prev) => (list.some((a) => a.email === prev) ? prev : (list[0]?.email || '')));
      })
      .catch(() => { /* surfaced when sending */ });
  };

  useEffect(() => {
    loadAccounts();
    // Toast + clean URL after returning from a "connect new account" round-trip.
    const params = new URLSearchParams(window.location.search);
    if (params.get('account') === 'connected') {
      showToasterMessage('Account connected — you can now send from it', 'success');
      params.delete('account');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }, []);

  // Connect a new account for SENDING ONLY (purpose=send → never read/synced).
  // Returns to this screen; the new account then appears in the picker.
  const connectNewAccount = (provider = 'google') => {
    let login = '';
    try { login = JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; } catch { /* ignore */ }
    const path = provider === 'outlook' ? 'auth/microsoft/outlook' : 'auth/google/email-analysis';
    window.location.href = `${config.apiUrl}${path}?purpose=send&login=${encodeURIComponent(login)}`;
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.js$/i.test(file.name)) {
      setParseError('Please upload a .js file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseEmailsFromJs(String(e.target.result || ''));
        setEmails(parsed);
        setFileName(file.name);
        setParseError('');
        setSummary(null);
      } catch (err) {
        setEmails([]);
        setFileName(file.name);
        setParseError(err.message || 'Could not read this file.');
      }
    };
    reader.onerror = () => setParseError('Could not read this file.');
    reader.readAsText(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const clearFile = () => {
    setEmails([]);
    setFileName('');
    setParseError('');
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toAddress.trim());
  const canSend = validEmail && emails.length > 0 && !!fromAccount && !sending;

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    setSummary(null);
    try {
      const resp = await fetchMethodRequest('POST', 'email-analysis/bulk-send', {
        email: fromAccount,
        to: toAddress.trim(),
        emails,
      });
      if (resp?.respCode) {
        setSummary(resp);
        showToasterMessage(resp.respMessage || 'Emails sent', resp.failed ? 'warning' : 'success');
      } else {
        showToasterMessage(resp?.errorMessage || 'Could not send emails', 'error');
      }
    } catch {
      showToasterMessage('Send failed. Please try again.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bulk-email-send">
      <div className="bes-topbar">
        <div>
          <div className="bes-eyebrow">Tools</div>
          <h1 className="bes-title">Bulk email send</h1>
          <p className="bes-sub">
            Upload a <code>.js</code> file that exports an array of emails and send each one,
            through your connected Gmail account, to a single recipient. An email with an{' '}
            <code>html</code> field (or an HTML <code>body</code>) is sent as a formatted HTML email.
          </p>
        </div>
        <div className="bes-account">
          {fromAccount
            ? <span className="bes-pill ok">Sending from {fromAccount}</span>
            : <span className="bes-pill off">No account selected</span>}
        </div>
      </div>

      {/* Step 1 — send-from account */}
      <div className="bes-panel">
        <div className="bes-ph">1 · Send from (account)</div>
        {accounts.length > 0 ? (
          <div className="bes-field">
            <label>Emails are sent from this connected account</label>
            <div className="bes-from-row">
              <Select value={fromAccount || ''} onValueChange={setFromAccount}>
                <SelectTrigger className="bes-account-dd">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={`${a.provider}-${a.email}`} value={a.email}>
                      {a.name ? `${a.name} · ${a.email}` : a.email} ({a.provider === 'outlook' ? 'Outlook' : 'Gmail'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="bes-from-action">
                <Button size="sm" className="bes-btn-theme" onClick={connectNewAccount}>
                  <Plus size={14} /> Gmail
                </Button>
                <Button size="sm" variant="outline" onClick={() => connectNewAccount('outlook')}>
                  <Plus size={14} /> Outlook
                </Button>
              </div>
            </div>
            <small className="bes-hint-muted">
              Selecting an existing account reuses its saved sign-in — no login needed.
            </small>
          </div>
        ) : (
          <div className="bes-noacct">
            <span>No connected accounts yet.</span>
            <div className="bes-from-action">
              <Button size="sm" className="bes-btn-theme" onClick={connectNewAccount}><Plus size={14} /> Connect</Button>
            </div>
          </div>
        )}
      </div>

      {/* Step 2 — recipient */}
      <div className="bes-panel">
        <div className="bes-ph">2 · Recipient (To)</div>
        <div className="bes-field">
          <label htmlFor="bes-to">Every email is sent to this address</label>
          <Input
            id="bes-to"
            value={toAddress}
            placeholder="name@example.com"
            onChange={(e) => setToAddress(e.target.value)}
            className={!toAddress || validEmail ? '' : 'border-destructive'}
          />
          {!!toAddress && !validEmail && <small className="bes-err">Enter a valid email address.</small>}
        </div>
      </div>

      {/* Step 3 — upload */}
      <div className="bes-panel">
        <div className="bes-ph">3 · Email file (.js)</div>
        <div
          className="bes-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click(); }}
        >
          <i className="pi pi-upload" />
          <div className="bes-drop-text">
            {fileName ? <b>{fileName}</b> : <span>Drop a <code>.js</code> file here, or click to browse</span>}
          </div>
          {fileName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); clearFile(); }}
            >
              <i className="pi pi-times" style={{ marginRight: 4 }} /> Remove
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".js,text/javascript,application/javascript"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {parseError && (
          <div className="bes-parse-err"><i className="pi pi-exclamation-triangle" /> {parseError}</div>
        )}

        {emails.length > 0 && (
          <div className="bes-preview">
            <div className="bes-preview-head">
              {emails.length} email(s) found
              <span className="bes-preview-sub"> · {emails.filter(isHtmlEmail).length} HTML</span>
            </div>
            <div className="bes-preview-list">
              {emails.slice(0, 50).map((m, i) => (
                <div className="bes-preview-row" key={m.id || i}>
                  <span className="bes-pr-from">{parseSenderName(m.from) || '—'}</span>
                  <span className="bes-pr-subj">{m.subject || '(no subject)'}</span>
                  <span className={`bes-pr-type ${isHtmlEmail(m) ? 'html' : 'text'}`}>
                    {isHtmlEmail(m) ? 'HTML' : 'TEXT'}
                  </span>
                </div>
              ))}
              {emails.length > 50 && <div className="bes-preview-more">+ {emails.length - 50} more…</div>}
            </div>
          </div>
        )}
      </div>

      {/* Step 3 — send */}
      <div className="bes-actions">
        <Button className="bes-btn-theme" onClick={onSend} disabled={!canSend}>
          {sending
            ? <><i className="pi pi-spin pi-spinner" style={{ marginRight: 6 }} />Sending…</>
            : <><Send size={14} style={{ marginRight: 6 }} />{`Send ${emails.length || ''} email${emails.length === 1 ? '' : 's'}`}</>}
        </Button>
        {!fromAccount && <span className="bes-hint">Select or connect a sending account first.</span>}
      </div>

      {/* Result summary */}
      {summary && (
        <div className="bes-panel bes-summary">
          <div className="bes-ph">Result</div>
          <div className="bes-summary-stats">
            <span className="bes-stat ok"><b>{summary.sent}</b> sent</span>
            {summary.failed > 0 && <span className="bes-stat fail"><b>{summary.failed}</b> failed</span>}
            <span className="bes-stat"><b>{summary.total}</b> total → {summary.to}</span>
          </div>
          {Array.isArray(summary.results) && summary.results.some((r) => !r.ok) && (
            <div className="bes-fail-list">
              {summary.results.filter((r) => !r.ok).map((r, i) => (
                <div className="bes-fail-row" key={i}>
                  <span className="bes-fail-label">{r.label}</span>
                  <span className="bes-fail-msg">{r.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BulkEmailSend;
