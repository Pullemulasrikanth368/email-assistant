import { Copy, RefreshCw, CornerDownLeft, Save, Send } from 'lucide-react';

/**
 * Shared action row for a reply editor.
 * Renders only the actions whose handler is provided:
 *   onRegenerate, onCopy, onSaveDraft, onInsert, onSend
 * `compact` renders icon-only buttons (quick-reply cards); the full row shows
 * labels. Send is always the primary action and is disabled when the content
 * is empty (`sendDisabled`) or anything is in flight (`busy`).
 */
const ReplyActions = ({
  onRegenerate,
  onCopy,
  onSaveDraft,
  onInsert,
  onSend,
  busy = false,
  regenerating = false,
  saving = false,
  sending = false,
  sendDisabled = false,
  compact = false,
}) => (
  <div className={`rs-actions${compact ? ' rs-actions--compact' : ''}`} role="group" aria-label="Reply actions">
    {onRegenerate && (
      <button
        type="button"
        className="rs-btn"
        onClick={onRegenerate}
        disabled={busy}
        title="Regenerate this reply"
        aria-label="Regenerate reply"
      >
        {regenerating ? <i className="pi pi-spin pi-spinner" /> : <RefreshCw size={13} />}
        {!compact && <span>Regenerate</span>}
      </button>
    )}
    {onCopy && (
      <button
        type="button"
        className="rs-btn"
        onClick={onCopy}
        disabled={busy || sendDisabled}
        title="Copy reply text"
        aria-label="Copy reply"
      >
        <Copy size={13} />
        {!compact && <span>Copy</span>}
      </button>
    )}
    {onSaveDraft && (
      <button
        type="button"
        className="rs-btn"
        onClick={onSaveDraft}
        disabled={busy || sendDisabled}
        title="Save this reply as a draft"
        aria-label="Save as draft"
      >
        {saving ? <i className="pi pi-spin pi-spinner" /> : <Save size={13} />}
        {!compact && <span>Save as Draft</span>}
      </button>
    )}
    {onInsert && (
      <button
        type="button"
        className="rs-btn rs-btn--insert"
        onClick={onInsert}
        disabled={busy || sendDisabled}
        title="Insert this reply into the main reply composer"
        aria-label="Insert into reply composer"
      >
        <CornerDownLeft size={13} />
        <span>{compact ? 'Insert' : 'Insert into Reply'}</span>
      </button>
    )}
    {onSend && (
      <button
        type="button"
        className="rs-btn rs-btn--send"
        onClick={onSend}
        disabled={busy || sendDisabled}
        title="Send this reply on the email thread"
        aria-label="Send reply"
      >
        {sending ? <i className="pi pi-spin pi-spinner" /> : <Send size={13} />}
        <span>{compact ? 'Send' : 'Send Reply'}</span>
      </button>
    )}
  </div>
);

export default ReplyActions;
