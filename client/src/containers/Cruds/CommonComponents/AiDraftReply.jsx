import { useState, useCallback } from 'react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import './AiDraftReply.scss';

/**
 * AI Draft Reply panel.
 *
 * Renders a "→ AI draft reply" trigger button alongside the quick-reply bar.
 * When clicked it calls the backend to generate a contextual reply, then
 * shows the editable draft with Send / Regenerate / Discard controls.
 *
 * Props:
 *   mailId        - EmailAnalysisMail._id (used to call generate-reply)
 *   sourceId      - providerMessageId (used to send the reply on the thread)
 *   onSent        - optional callback fired after the reply is sent
 */
const AiDraftReply = ({ mailId, sourceId, onSent }) => {
  const [phase, setPhase] = useState('idle'); // idle | generating | draft | sending | sent
  const [reply, setReply] = useState('');
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');

  const generate = useCallback(async () => {
    setPhase('generating');
    setError('');
    setReply('');
    try {
      const res = await fetchMethodRequest(
        'POST',
        `email-analysis/mails/${mailId}/generate-reply`,
        {}
      );
      if (res?.respCode === 200) {
        setReply(res.reply || '');
        setProvider(res.provider || '');
        setPhase('draft');
      } else {
        setError(res?.errorMessage || 'Could not generate reply. Try again.');
        setPhase('idle');
      }
    } catch {
      setError('Could not reach server.');
      setPhase('idle');
    }
  }, [mailId]);

  const handleSend = async () => {
    const text = reply.trim();
    if (!text) return;
    setPhase('sending');
    setError('');

    // Build a basic HTML wrapper around the plain-text reply.
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;white-space:pre-wrap">${
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }</div>`;

    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/reply', {
        sourceId,
        html,
      });
      if (res?.respCode === 200) {
        setPhase('sent');
        showToasterMessage('Reply sent successfully', 'success');
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
    setPhase('idle');
    setReply('');
    setError('');
    setProvider('');
  };

  // ── IDLE: show the "AI draft reply" button ──────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="aidr-trigger-row">
        {error && <span className="aidr-err">{error}</span>}
        <button
          type="button"
          className="aidr-trigger-btn"
          onClick={generate}
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
      </div>

      {error && <div className="aidr-err aidr-err--inline">{error}</div>}

      {/* Editable textarea */}
      <textarea
        className="aidr-textarea"
        value={reply}
        onChange={e => setReply(e.target.value)}
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
          onClick={generate}
          disabled={phase === 'sending'}
          title="Regenerate the AI reply"
        >
          <i className="pi pi-refresh" /> Regenerate
        </button>

        <button
          type="button"
          className="aidr-btn aidr-btn--discard"
          onClick={handleDiscard}
          disabled={phase === 'sending'}
        >
          Discard
        </button>
      </div>
    </div>
  );
};

export default AiDraftReply;
