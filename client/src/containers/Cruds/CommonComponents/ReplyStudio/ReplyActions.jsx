import { Copy, RefreshCw, Send } from 'lucide-react';

/**
 * Shared action row for a reply editor.
 * Renders only the actions whose handler is provided:
 *   onRegenerate, onCopy, onSend
 * `compact` renders icon-only buttons (quick-reply cards); the full row shows
 * labels. Send is always the primary action and is disabled when the content
 * is empty (`sendDisabled`) or anything is in flight (`busy`).
 */
const ReplyActions = ({
  onRegenerate,
  onCopy,
  onSend,
  busy = false,
  regenerating = false,
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
