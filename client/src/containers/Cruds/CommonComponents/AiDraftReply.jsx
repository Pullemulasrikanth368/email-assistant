import { useState, useCallback, useRef, useEffect } from 'react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import './AiDraftReply.scss';

// Split a raw `From` header into name + address.
const parseAddress = (raw = '') => {
  const match = String(raw).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) return { name: (match[1] || '').trim(), email: (match[2] || '').trim() };
  const trimmed = String(raw).trim();
  return { name: trimmed, email: trimmed.includes('@') ? trimmed : '' };
};

// The drafts API stores/sends HTML — wrap the plain-text reply the same way
// the send path does.
const toHtml = (text = '') =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;white-space:pre-wrap">${
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }</div>`;

const getLoginEmail = () => {
  try { return JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; }
  catch { return ''; }
};

const AUTOSAVE_DELAY_MS = 1200;

/**
 * AI Draft Reply panel.
 *
 * Generating a reply also creates a REAL draft (in the app's drafts and the
 * provider's Drafts folder). Regenerating updates that same draft, edits
 * auto-save (debounced + on unmount, i.e. when another mail is opened or the
 * user navigates away), Send delivers the reply and removes the draft, and
 * Discard deletes it everywhere.
 *
 * Props:
 *   mailId   - EmailAnalysisMail._id (used to call generate-reply)
 *   sourceId - providerMessageId (used to send the reply on the thread)
 *   mail     - the source mail object (from/subject/threadId — draft context)
 *   onSent   - optional callback fired after the reply is sent
 */
const AiDraftReply = ({ mailId, sourceId, mail, onSent }) => {
  const [phase, setPhase] = useState('idle'); // idle | generating | draft | sending | sent
  const [reply, setReply] = useState('');
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  const [draftId, setDraftId] = useState(null);
  const [saveState, setSaveState] = useState(''); // '' | saving | saved | failed

  // Refs mirror the latest values so the unmount flush never sees stale state.
  const draftIdRef = useRef(null);
  const replyRef = useRef('');
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);

  const replySubject = /^\s*re:/i.test(mail?.subject || '')
    ? (mail?.subject || '')
    : `Re: ${mail?.subject || '(no subject)'}`;

  const autosave = useCallback(async (id, text) => {
    if (!id) return;
    setSaveState('saving');
    try {
      await fetchMethodRequest('POST', `email-analysis/drafts/${id}/autosave`, {
        body: toHtml(text),
        subject: replySubject,
      });
      dirtyRef.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [replySubject]);

  // Debounced auto-save while typing.
  const onReplyChange = (value) => {
    setReply(value);
    replyRef.current = value;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      autosave(draftIdRef.current, replyRef.current);
    }, AUTOSAVE_DELAY_MS);
  };

  // Flush pending edits when the panel unmounts — i.e. when the user opens
  // another mail or moves to a different screen the draft is saved, not lost.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirtyRef.current && draftIdRef.current) {
      fetchMethodRequest('POST', `email-analysis/drafts/${draftIdRef.current}/autosave`, {
        body: toHtml(replyRef.current),
      }).catch(() => {});
    }
  }, []);

  // Create the draft in the app + provider Drafts folder, or update the
  // existing one on regenerate.
  const persistDraft = useCallback(async (text) => {
    setSaveState('saving');
    try {
      if (draftIdRef.current) {
        await fetchMethodRequest('PUT', `email-analysis/drafts/${draftIdRef.current}`, {
          body: toHtml(text),
          subject: replySubject,
        });
      } else {
        const toAddr = parseAddress(mail?.from).email;
        const res = await fetchMethodRequest('POST', 'email-analysis/drafts', {
          email: mail?.email || null,
          loginUserEmailId: getLoginEmail(),
          provider: mail?.provider || null,
          to: toAddr ? [toAddr] : [],
          subject: replySubject,
          body: toHtml(text),
          threadId: mail?.threadId || null,
          conversationId: mail?.threadId || null,
          replyToMessageId: sourceId || null,
        });
        if (res?.respCode === 200 && res?.data?._id) {
          draftIdRef.current = res.data._id;
          setDraftId(res.data._id);
        } else {
          throw new Error(res?.errorMessage || 'Draft create failed');
        }
      }
      dirtyRef.current = false;
      setSaveState('saved');
      return true;
    } catch (err) {
      setError(err?.message || 'Draft generated, but it was not saved to Drafts.');
      setSaveState('failed');
      return false;
    }
  }, [mail, replySubject, sourceId]);

  // The server caches the generated reply on the mail, so the first click after
  // opening a read mail returns instantly; force=true (Regenerate) makes a fresh one.
  const generate = useCallback(async (force = false) => {
    setPhase('generating');
    setError('');
    setReply('');
    try {
      const res = await fetchMethodRequest(
        'POST',
        `email-analysis/mails/${mailId}/generate-reply`,
        force ? { force: true } : {}
      );
      if (res?.respCode === 200) {
        const text = res.reply || '';
        setReply(text);
        replyRef.current = text;
        setProvider(res.provider || '');
        setPhase('draft');
        // First generate creates the draft; regenerate updates the same one.
        await persistDraft(text);
      } else {
        setError(res?.errorMessage || 'Could not generate reply. Try again.');
        setPhase('idle');
      }
    } catch {
      setError('Could not reach server.');
      setPhase('idle');
    }
  }, [mailId, persistDraft]);

  const handleSend = async () => {
    const text = reply.trim();
    if (!text) return;
    setPhase('sending');
    setError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);

    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/reply', {
        sourceId,
        html: toHtml(text),
      });
      if (res?.respCode === 200) {
        setPhase('sent');
        showToasterMessage('Reply sent successfully', 'success');
        // The reply went out on the thread — remove the now-redundant draft
        // from the app and the provider's Drafts folder.
        if (draftIdRef.current) {
          fetchMethodRequest('DELETE', `email-analysis/drafts/${draftIdRef.current}`).catch(() => {});
          draftIdRef.current = null;
          setDraftId(null);
          dirtyRef.current = false;
        }
        if (onSent) onSent();
      } else {
        setError(res?.errorMessage || 'Send failed. Please try again.');
        setPhase('draft');
      }
    } catch {
      setError('Could not reach server.');
      setPhase('draft');
    }
  };

  const handleDiscard = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Discard removes the draft everywhere (app + provider Drafts folder).
    if (draftIdRef.current) {
      fetchMethodRequest('DELETE', `email-analysis/drafts/${draftIdRef.current}`).catch(() => {});
      draftIdRef.current = null;
      setDraftId(null);
    }
    dirtyRef.current = false;
    setPhase('idle');
    setReply('');
    setError('');
    setProvider('');
    setSaveState('');
  };

  // ── IDLE: show the "AI draft reply" button ──────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="aidr-trigger-row">
        {error && <span className="aidr-err">{error}</span>}
        <button
          type="button"
          className="aidr-trigger-btn"
          onClick={() => generate(false)}
          disabled={!mailId}
          title="Generate an AI-drafted reply for this email"
        >
          <span className="aidr-trigger-icon">✦</span>
          AI draft reply
          <span className="aidr-trigger-arrow">↑</span>
        </button>
      </div>
    );
  }

  // ── GENERATING: spinner ─────────────────────────────────────────────────
  if (phase === 'generating') {
    return (
      <div className="aidr-panel aidr-panel--loading">
        <div className="aidr-label">
          <span className="aidr-dot aidr-dot--pulse" />
          Generating AI reply…
        </div>
        <div className="aidr-spinner-wrap">
          <i className="pi pi-spin pi-spinner" />
          <span>Analysing email context and drafting a reply…</span>
        </div>
      </div>
    );
  }

  // ── SENT: confirmation ──────────────────────────────────────────────────
  if (phase === 'sent') {
    return (
      <div className="aidr-panel aidr-panel--sent">
        <i className="pi pi-check-circle aidr-sent-icon" />
        <span>Reply sent successfully.</span>
      </div>
    );
  }

  // ── DRAFT / SENDING: editable reply area ───────────────────────────────
  return (
    <div className="aidr-panel">
      {/* Header */}
      <div className="aidr-label">
        <span className="aidr-dot" />
        AI-DRAFTED REPLY · REVIEW BEFORE SENDING
        {provider && (
          <span className="aidr-provider-tag">{provider.toUpperCase()}</span>
        )}
        <span className={`aidr-save-state aidr-save-state--${saveState || 'idle'}`}>
          {saveState === 'saving' && (<><i className="pi pi-spin pi-spinner" /> Saving…</>)}
          {saveState === 'saved' && (<><i className="pi pi-check" /> Saved to Drafts</>)}
          {saveState === 'failed' && (<><i className="pi pi-exclamation-triangle" /> Draft not saved</>)}
        </span>
      </div>

      {error && <div className="aidr-err aidr-err--inline">{error}</div>}

      {/* Editable textarea */}
      <textarea
        className="aidr-textarea"
        value={reply}
        onChange={e => onReplyChange(e.target.value)}
        rows={6}
        placeholder="AI-generated reply will appear here…"
        disabled={phase === 'sending'}
      />

      {/* Action buttons */}
      <div className="aidr-actions">
        <button
          type="button"
          className="aidr-btn aidr-btn--send"
          onClick={handleSend}
          disabled={phase === 'sending' || !reply.trim()}
        >
          {phase === 'sending'
            ? <><i className="pi pi-spin pi-spinner" /> Sending…</>
            : <><i className="pi pi-send" /> Send reply</>}
        </button>

        <button
          type="button"
          className="aidr-btn aidr-btn--regen"
          onClick={() => generate(true)}
          disabled={phase === 'sending'}
          title="Regenerate the AI reply (updates the same draft)"
        >
          <i className="pi pi-refresh" /> Regenerate
        </button>

        <button
          type="button"
          className="aidr-btn aidr-btn--discard"
          onClick={handleDiscard}
          disabled={phase === 'sending'}
          title="Discard and delete the draft"
        >
          Discard
        </button>
      </div>
    </div>
  );
};

export default AiDraftReply;
