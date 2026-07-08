import { useState, useCallback, useRef, useEffect } from 'react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import DraftEditor, { isEmptyHtml, textToHtml } from './DraftEditor';
import './AiDraftReply.scss';

// Split a raw `From` header into name + address.
const parseAddress = (raw = '') => {
  const match = String(raw).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) return { name: (match[1] || '').trim(), email: (match[2] || '').trim() };
  const trimmed = String(raw).trim();
  return { name: trimmed, email: trimmed.includes('@') ? trimmed : '' };
};

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
 *   mailId       - EmailAnalysisMail._id (used to call generate-reply)
 *   sourceId     - providerMessageId (used to send the reply on the thread)
 *   mail         - the source mail object (from/subject/threadId — draft context)
 *   initialDraft - stored draft for this mail (auto-created at categorization);
 *                  when present the panel opens showing the draft thread.
 *   todo         - open to-do linked to this mail ({ task }); switches the send
 *                  actions to "Mark as complete & send" and "Send only".
 *   reportId     - report the to-do belongs to (completion is persisted there)
 *   onSent       - optional callback fired after the reply is sent
 *   onCompleted  - optional callback fired after the to-do is marked complete
 */
const AiDraftReply = ({ mailId, sourceId, mail, initialDraft, todo, reportId, onSent, onCompleted }) => {
  // The editor works on the draft's HTML directly — `reply` is an HTML string.
  const initialHtml = initialDraft?.body && !isEmptyHtml(initialDraft.body) ? initialDraft.body : '';
  const hasInitialDraft = !!(initialDraft?._id && initialHtml);

  const [phase, setPhase] = useState(hasInitialDraft ? 'draft' : 'idle'); // idle | generating | draft | sending | sent
  const [reply, setReply] = useState(initialHtml);
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  const [draftId, setDraftId] = useState(hasInitialDraft ? initialDraft._id : null);
  const [saveState, setSaveState] = useState(hasInitialDraft ? 'saved' : ''); // '' | saving | saved | failed

  // Refs mirror the latest values so the unmount flush never sees stale state.
  const draftIdRef = useRef(hasInitialDraft ? initialDraft._id : null);
  const replyRef = useRef(initialHtml);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);

  const replySubject = /^\s*re:/i.test(mail?.subject || '')
    ? (mail?.subject || '')
    : `Re: ${mail?.subject || '(no subject)'}`;

  const autosave = useCallback(async (id, html) => {
    if (!id) return;
    setSaveState('saving');
    try {
      await fetchMethodRequest('POST', `email-analysis/drafts/${id}/autosave`, {
        body: html,
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
        body: replyRef.current,
      }).catch(() => {});
    }
  }, []);

  // Create the draft in the app + provider Drafts folder, or update the
  // existing one on regenerate.
  const persistDraft = useCallback(async (html) => {
    setSaveState('saving');
    try {
      if (draftIdRef.current) {
        await fetchMethodRequest('PUT', `email-analysis/drafts/${draftIdRef.current}`, {
          body: html,
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
          body: html,
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
        const html = textToHtml(res.reply || '');
        setReply(html);
        replyRef.current = html;
        setProvider(res.provider || '');
        setPhase('draft');
        // First generate creates the draft; regenerate updates the same one.
        await persistDraft(html);
      } else {
        setError(res?.errorMessage || 'Could not generate reply. Try again.');
        setPhase('idle');
      }
    } catch {
      setError('Could not reach server.');
      setPhase('idle');
    }
  }, [mailId, persistDraft]);

  const handleSend = async (markComplete = false) => {
    if (isEmptyHtml(reply)) return;
    setPhase('sending');
    setError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);

    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/reply', {
        sourceId,
        html: reply,
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
        // The reply itself already went out — skipSend only records completion.
        if (markComplete && todo) {
          try {
            const done = await fetchMethodRequest('POST', 'email-analysis/actions/complete', {
              sourceId,
              task: todo.task,
              reportId,
              skipSend: true,
            });
            if (done?.respCode) {
              showToasterMessage('To-do marked as completed', 'success');
              if (onCompleted) onCompleted(todo);
            } else {
              showToasterMessage(done?.errorMessage || 'Reply sent, but the to-do was not marked complete', 'warning');
            }
          } catch {
            showToasterMessage('Reply sent, but the to-do was not marked complete', 'warning');
          }
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
        {hasInitialDraft ? 'DRAFT REPLY · SAVED IN YOUR DRAFTS' : 'AI-DRAFTED REPLY · REVIEW BEFORE SENDING'}
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

      {/* Rich-text draft editor (edits the draft's HTML directly) */}
      <DraftEditor
        value={reply}
        onChange={onReplyChange}
        disabled={phase === 'sending'}
        placeholder="AI-generated reply will appear here…"
      />

      {/* Action buttons — a to-do email gets "Mark as complete & send" and
          "Send only"; everything else keeps the single "Send reply". */}
      <div className="aidr-actions">
        {todo ? (
          <>
            <button
              type="button"
              className="aidr-btn aidr-btn--send"
              onClick={() => handleSend(true)}
              disabled={phase === 'sending' || isEmptyHtml(reply)}
              title="Send this reply and mark the to-do as completed"
            >
              {phase === 'sending'
                ? <><i className="pi pi-spin pi-spinner" /> Sending…</>
                : <><i className="pi pi-check-circle" /> Mark as complete & send</>}
            </button>
            <button
              type="button"
              className="aidr-btn aidr-btn--send"
              onClick={() => handleSend(false)}
              disabled={phase === 'sending' || isEmptyHtml(reply)}
              title="Send this reply without completing the to-do"
            >
              <i className="pi pi-send" /> Send only
            </button>
          </>
        ) : (
          <button
            type="button"
            className="aidr-btn aidr-btn--send"
            onClick={() => handleSend(false)}
            disabled={phase === 'sending' || isEmptyHtml(reply)}
          >
            {phase === 'sending'
              ? <><i className="pi pi-spin pi-spinner" /> Sending…</>
              : <><i className="pi pi-send" /> Send reply</>}
          </button>
        )}

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
