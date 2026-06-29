import { useEffect, useState } from 'react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import './QuickReplies.scss';

/**
 * One-click quick-reply bar for any screen that shows an email.
 * Generates context-aware short reply options for the email (by its
 * providerMessageId / sourceId) and sends the chosen one on the thread.
 *
 * @param {string} sourceId  the email's providerMessageId (a.k.a. brief sourceId)
 */
const QuickReplies = ({ sourceId }) => {
  const [state, setState] = useState({ loading: false, options: [], sentLabel: null, sending: false });

  useEffect(() => {
    let cancelled = false;
    if (!sourceId) {
      setState({ loading: false, options: [], sentLabel: null, sending: false });
      return undefined;
    }
    setState({ loading: true, options: [], sentLabel: null, sending: false });
    fetchMethodRequest('POST', 'email-analysis/quick-replies', { sourceId })
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, options: res?.eligible ? (res.options || []) : [], sentLabel: null, sending: false });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, options: [], sentLabel: null, sending: false }); });
    return () => { cancelled = true; };
  }, [sourceId]);

  const onReply = async (opt) => {
    setState((s) => ({ ...s, sending: true }));
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/quick-reply', {
        sourceId, reply: opt.reply, label: opt.label,
      });
      if (res?.respCode) {
        setState((s) => ({ ...s, sending: false, sentLabel: opt.label }));
        showToasterMessage(res.respMessage || 'Reply sent', 'success');
      } else {
        setState((s) => ({ ...s, sending: false }));
        showToasterMessage(res?.errorMessage || 'Could not send reply', 'error');
      }
    } catch {
      setState((s) => ({ ...s, sending: false }));
      showToasterMessage('Could not send reply', 'error');
    }
  };

  const { loading, options, sentLabel, sending } = state;
  if (!sourceId) return null;
  if (!loading && !options.length && !sentLabel) return null;

  return (
    <div className="qr-bar">
      {sentLabel ? (
        <span className="qr-sent"><i className="pi pi-check-circle" /> Replied: “{sentLabel}”</span>
      ) : loading ? (
        <span className="qr-loading"><i className="pi pi-spin pi-spinner" /> Suggesting quick replies…</span>
      ) : (
        <>
          <span className="qr-label">Quick reply</span>
          <div className="qr-btns">
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                className="qr-btn"
                disabled={sending}
                title={o.reply}
                onClick={() => onReply(o)}
              >
                {o.label}
              </button>
            ))}
            {sending && <i className="pi pi-spin pi-spinner qr-spin" />}
          </div>
        </>
      )}
    </div>
  );
};

export default QuickReplies;
