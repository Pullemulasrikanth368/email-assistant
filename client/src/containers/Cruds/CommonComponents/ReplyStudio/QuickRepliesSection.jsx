import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import { fetchQuickVariants } from './replyStudio.service';
import QuickReplyCard from './QuickReplyCard';

const TYPES = ['yes', 'no', 'maybe'];

/**
 * "Quick Replies" card — three short editable replies (Yes / No / Maybe)
 * generated in one AI call and cached on the mail. Each card is edited in
 * place, and can be copied, regenerated individually, or sent (the parent
 * owns the send confirmation).
 *
 * The AI also returns a contextual button label per option (Accept / Reject,
 * Will attend / Unable to attend, …) which replaces the generic Yes/No/Maybe
 * and is reported up via `onLabels` so other sections can reuse it.
 *
 * @param mailId   EmailAnalysisMail._id
 * @param onSend   (text, label) => void — parent confirms + sends
 * @param onLabels (labels) => void — { yes, no, maybe } contextual labels
 * @param sendingType currently-sending type ('yes'|'no'|'maybe'|null)
 */
const QuickRepliesSection = ({ mailId, onSend, onLabels, sendingType = null }) => {
  const [texts, setTexts] = useState({ yes: '', no: '', maybe: '' });
  const [labels, setLabels] = useState({ yes: '', no: '', maybe: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [regenType, setRegenType] = useState(null);

  const load = useCallback(async () => {
    if (!mailId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchQuickVariants(mailId);
      if (res?.respCode === 200 && res.variants) {
        setTexts({
          yes: res.variants.yes?.text || '',
          no: res.variants.no?.text || '',
          maybe: res.variants.maybe?.text || '',
        });
        const nextLabels = {
          yes: res.variants.yes?.label || '',
          no: res.variants.no?.label || '',
          maybe: res.variants.maybe?.label || '',
        };
        setLabels(nextLabels);
        if (onLabels) onLabels(nextLabels);
      } else {
        setError(res?.errorMessage || 'Could not generate quick replies.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [mailId]);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (type) => {
    setRegenType(type);
    try {
      const res = await fetchQuickVariants(mailId, { replyType: type, force: true });
      if (res?.respCode === 200 && res.variants?.[type]?.text) {
        setTexts((t) => ({ ...t, [type]: res.variants[type].text }));
        showToasterMessage('Quick reply regenerated', 'success');
      } else {
        showToasterMessage(res?.errorMessage || 'Could not regenerate this reply', 'error');
      }
    } catch {
      showToasterMessage('Could not regenerate this reply', 'error');
    } finally {
      setRegenType(null);
    }
  };

  const copy = async (type) => {
    try {
      await navigator.clipboard.writeText(texts[type] || '');
      showToasterMessage('Reply copied to clipboard', 'success');
    } catch {
      showToasterMessage('Could not copy to clipboard', 'error');
    }
  };

  if (!mailId) return null;

  return (
    <section className="rs-card" aria-label="Quick replies">
      <div className="rs-card-head">
        <span className="rs-card-icon"><Zap size={14} /></span>
        <h4 className="rs-card-title">Quick Replies</h4>
        <span className="rs-card-sub">Short answers, ready to edit and send</span>
      </div>

      {error ? (
        <div className="rs-error">
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          <button type="button" className="rs-btn" onClick={load}>
            <i className="pi pi-refresh" /> Retry
          </button>
        </div>
      ) : (
        <div className="rs-qgrid">
          {TYPES.map((type) => (
            <QuickReplyCard
              key={type}
              type={type}
              label={labels[type]}
              value={texts[type]}
              loading={loading}
              regenerating={regenType === type}
              sending={sendingType === type}
              busy={!!regenType || !!sendingType}
              onChange={(v) => setTexts((t) => ({ ...t, [type]: v }))}
              onCopy={() => copy(type)}
              onRegenerate={() => regenerate(type)}
              onSend={() => onSend(texts[type], type)}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default QuickRepliesSection;
