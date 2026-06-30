import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Send, Save, Trash2, Paperclip, Loader2, AlertCircle,
  CheckCircle2, ChevronDown, ChevronUp, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import fetchMethodRequest from '@/config/service';
import { cn } from '@/lib/utils';

const AUTO_SAVE_DELAY_MS = 2500;

function RecipientInput({ label, value, onChange, placeholder }) {
  const [inputVal, setInputVal] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const trimmed = inputVal.trim().replace(/,$/, '');
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
      }
      setInputVal('');
    }
    if (e.key === 'Backspace' && !inputVal && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleBlur = () => {
    const trimmed = inputVal.trim().replace(/,$/, '');
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInputVal('');
    }
  };

  const removeTag = (tag) => onChange(value.filter(t => t !== tag));

  return (
    <div className="recipient-field">
      <span className="recipient-field__label">{label}:</span>
      <div className="recipient-field__input-wrap">
        {value.map(tag => (
          <span key={tag} className="recipient-tag">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="recipient-tag__remove">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          className="recipient-field__input"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
    </div>
  );
}

function AttachmentList({ attachments, draftId, onDraftUpdate, disabled }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !draftId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${window._EA_API_BASE || 'http://localhost:8676/'}api/email-analysis/drafts/${draftId}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('loginCredentials') || '{}').accessToken || ''}` },
        body: formData,
      });
      const json = await res.json();
      if (json?.respCode === 200) onDraftUpdate(json.data);
    } catch (err) {
      console.error('[ComposeDraft] Attachment upload failed:', err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemove = async (index) => {
    if (!draftId) return;
    setRemoving(index);
    try {
      const res = await fetchMethodRequest('DELETE', `email-analysis/drafts/${draftId}/attachments/${index}`);
      if (res?.respCode === 200) onDraftUpdate(res.data);
    } catch (err) {
      console.error('[ComposeDraft] Remove attachment failed:', err.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="compose-attachments">
      {attachments.map((att, idx) => (
        <span key={idx} className="compose-att-tag">
          <Paperclip size={10} />
          <span className="compose-att-name">{att.filename}</span>
          {att.size && <span className="compose-att-size">({(att.size / 1024).toFixed(1)}KB)</span>}
          <button
            type="button"
            disabled={removing === idx || disabled}
            onClick={() => handleRemove(idx)}
            className="compose-att-remove"
          >
            {removing === idx ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="compose-att-add"
        disabled={uploading || disabled || !draftId}
        title={!draftId ? 'Save the draft first to attach files' : 'Attach a file'}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
        {uploading ? 'Uploading…' : 'Attach file'}
      </button>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
    </div>
  );
}

export default function ComposeDraft({ draft, onClose }) {
  const isNew = !draft;
  const [draftId, setDraftId] = useState(draft?._id || null);
  const [provider, setProvider] = useState(draft?.provider || null);

  const [to, setTo] = useState(draft?.to || []);
  const [cc, setCc] = useState(draft?.cc || []);
  const [bcc, setBcc] = useState(draft?.bcc || []);
  const [subject, setSubject] = useState(draft?.subject || '');
  const [body, setBody] = useState(draft?.body || '');
  const [attachments, setAttachments] = useState(draft?.attachments || []);

  const [showCc, setShowCc] = useState((draft?.cc?.length || 0) > 0);
  const [showBcc, setShowBcc] = useState((draft?.bcc?.length || 0) > 0);

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'failed'
  const [error, setError] = useState('');

  const autoSaveTimer = useRef(null);
  const lastSavedRef = useRef({ to, cc, bcc, subject, body });

  const getLoginUser = () => {
    try { return JSON.parse(localStorage.getItem('loginCredentials')) || {}; } catch { return {}; }
  };

  // Create draft on first keystroke (if new)
  const ensureDraftCreated = useCallback(async (fields) => {
    if (draftId) return draftId;
    try {
      const user = getLoginUser();
      const res = await fetchMethodRequest('POST', 'email-analysis/drafts', {
        loginUserEmailId: user.email || null,
        to: fields.to,
        cc: fields.cc,
        bcc: fields.bcc,
        subject: fields.subject,
        body: fields.body,
      });
      if (res?.respCode === 200 && res.data?._id) {
        setDraftId(res.data._id);
        setProvider(res.data.provider);
        lastSavedRef.current = { to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject, body: fields.body };
        return res.data._id;
      }
    } catch (err) {
      console.error('[ComposeDraft] Create failed:', err.message);
    }
    return null;
  }, [draftId]);

  const doAutoSave = useCallback(async (fields) => {
    setSaveStatus('saving');
    try {
      const id = await ensureDraftCreated(fields);
      if (!id) { setSaveStatus('failed'); return; }
      const res = await fetchMethodRequest('POST', `email-analysis/drafts/${id}/autosave`, fields);
      if (res?.respCode === 200) {
        setSaveStatus('saved');
        lastSavedRef.current = { ...fields };
      } else {
        setSaveStatus('failed');
      }
    } catch {
      setSaveStatus('failed');
    }
  }, [ensureDraftCreated]);

  // Trigger auto-save after inactivity
  const scheduleAutoSave = useCallback((fields) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus('saving');
    autoSaveTimer.current = setTimeout(() => doAutoSave(fields), AUTO_SAVE_DELAY_MS);
  }, [doAutoSave]);

  const currentFields = () => ({ to, cc, bcc, subject, body });

  // Watch body/subject for auto-save
  useEffect(() => {
    const fields = currentFields();
    const hasContent = fields.to.length || fields.cc.length || fields.bcc.length || fields.subject || fields.body;
    if (!hasContent) return;
    const same = JSON.stringify(fields) === JSON.stringify(lastSavedRef.current);
    if (!same) scheduleAutoSave(fields);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [to, cc, bcc, subject, body]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleManualSave = async () => {
    setSaving(true);
    setError('');
    try {
      const fields = currentFields();
      const id = await ensureDraftCreated(fields);
      if (!id) { setError('Failed to create draft'); setSaving(false); return; }
      const res = await fetchMethodRequest('PUT', `email-analysis/drafts/${id}`, fields);
      if (res?.respCode === 200) {
        setSaveStatus('saved');
        lastSavedRef.current = { ...fields };
        setAttachments(res.data?.attachments || attachments);
      } else {
        setError(res?.errorMessage || 'Save failed');
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (to.length === 0) { setError('Please add at least one recipient (To field).'); return; }
    setSending(true);
    setError('');
    try {
      const fields = currentFields();
      const id = await ensureDraftCreated(fields);
      if (!id) { setError('Draft could not be created. Check your account connection.'); setSending(false); return; }

      // Flush latest content before sending
      if (draftId) {
        await fetchMethodRequest('PUT', `email-analysis/drafts/${id}`, fields);
      }

      const res = await fetchMethodRequest('POST', `email-analysis/drafts/${id}/send`);
      if (res?.respCode === 200) {
        onClose(true); // refresh list
      } else {
        setError(res?.errorMessage || 'Send failed. Check your provider connection.');
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!draftId) { onClose(false); return; }
    if (!window.confirm('Discard this draft?')) return;
    setDeleting(true);
    try {
      await fetchMethodRequest('DELETE', `email-analysis/drafts/${draftId}`);
    } catch { /* ignore */ }
    onClose(true);
  };

  const handleClose = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    onClose(saveStatus === 'saved' || !isNew);
  };

  return (
    <div className="compose-overlay">
      <div className="compose-modal">
        {/* Header */}
        <div className="compose-header">
          <div className="compose-header__left">
            <h2 className="compose-header__title">{isNew ? 'New Message' : 'Edit Draft'}</h2>
            {provider && (
              <Badge variant="outline" className={cn('provider-badge', `provider-badge--${provider}`)}>
                {provider === 'gmail' ? 'Gmail' : 'Outlook'}
              </Badge>
            )}
          </div>
          <div className="compose-header__actions">
            {/* Auto-save status */}
            <span className={cn('save-status', saveStatus && `save-status--${saveStatus}`)}>
              {saveStatus === 'saving' && <><Loader2 size={11} className="animate-spin" /> Saving…</>}
              {saveStatus === 'saved' && <><CheckCircle2 size={11} /> Saved</>}
              {saveStatus === 'failed' && <><AlertCircle size={11} /> Save failed</>}
            </span>
            <button className="compose-header__close" onClick={handleClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="compose-error">
            <AlertCircle size={13} />
            {error}
          </div>
        )}

        {/* Fields */}
        <div className="compose-fields">
          <RecipientInput label="To" value={to} onChange={setTo} placeholder="Recipient email addresses" />

          <div className="compose-cc-bcc-row">
            {!showCc && (
              <button className="compose-toggle-btn" onClick={() => setShowCc(true)}>Cc</button>
            )}
            {!showBcc && (
              <button className="compose-toggle-btn" onClick={() => setShowBcc(true)}>Bcc</button>
            )}
          </div>

          {showCc && <RecipientInput label="Cc" value={cc} onChange={setCc} placeholder="" />}
          {showBcc && <RecipientInput label="Bcc" value={bcc} onChange={setBcc} placeholder="" />}

          <div className="compose-subject-row">
            <span className="compose-field-label">Subject:</span>
            <Input
              className="compose-subject-input"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
            />
          </div>
        </div>

        {/* Body */}
        <textarea
          className="compose-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message…"
        />

        {/* Attachments */}
        <div className="compose-att-section">
          <AttachmentList
            attachments={attachments}
            draftId={draftId}
            onDraftUpdate={(updated) => setAttachments(updated.attachments || [])}
            disabled={sending || deleting}
          />
        </div>

        {/* Footer */}
        <div className="compose-footer">
          <div className="compose-footer__left">
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending || deleting}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending…' : 'Send'}
            </Button>

            <Button
              variant="outline" size="sm"
              onClick={handleManualSave}
              disabled={saving || sending || deleting}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save Draft'}
            </Button>
          </div>

          <Button
            variant="ghost" size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={handleDelete}
            disabled={sending}
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
