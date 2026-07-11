import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import ReplyActions from './ReplyActions';

const TYPE_META = {
  yes: { label: 'Yes', Icon: CheckCircle2, className: 'rs-qcard--yes' },
  no: { label: 'No', Icon: XCircle, className: 'rs-qcard--no' },
  maybe: { label: 'Maybe', Icon: HelpCircle, className: 'rs-qcard--maybe' },
};

/**
 * One small quick-reply editor. `type` (yes/no/maybe) drives the icon and
 * color; `label` is the AI's contextual button label for this mail (e.g.
 * "Accept", "Will attend", "Tentative") and falls back to Yes/No/Maybe.
 * Text stays editable; actions: Copy, Insert into composer, Regenerate, Send.
 */
const QuickReplyCard = ({
  type,
  label,
  value,
  onChange,
  onCopy,
  onInsert,
  onRegenerate,
  onSend,
  loading = false,
  regenerating = false,
  sending = false,
  busy = false,
}) => {
  const meta = TYPE_META[type] || TYPE_META.maybe;
  const { Icon } = meta;
  const display = String(label || '').trim() || meta.label;
  const empty = !String(value || '').trim();

  return (
    <div className={`rs-qcard ${meta.className}`}>
      <div className="rs-qcard-head">
        <span className="rs-qcard-badge" aria-hidden="true"><Icon size={14} /></span>
        <span className="rs-qcard-label">{display}</span>
      </div>

      {loading ? (
        <div className="rs-skeleton" aria-label={`Generating ${display} reply`} aria-busy="true">
          <span /><span /><span className="short" />
        </div>
      ) : (
        <textarea
          className="rs-qcard-text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          rows={5}
          aria-label={`${display} quick reply text`}
          placeholder={`Editable "${display}" reply…`}
        />
      )}

      <ReplyActions
        compact
        onCopy={onCopy}
        onInsert={onInsert}
        onRegenerate={onRegenerate}
        onSend={onSend}
        busy={busy || loading}
        regenerating={regenerating}
        sending={sending}
        sendDisabled={empty}
      />
    </div>
  );
};

export default QuickReplyCard;
