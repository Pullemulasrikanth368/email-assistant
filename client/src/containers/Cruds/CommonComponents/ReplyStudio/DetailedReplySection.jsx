import { useState } from 'react';
import { FileText, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import DraftEditor, { isEmptyHtml, textToHtml } from '../DraftEditor';
import { fetchDetailedReply } from './replyStudio.service';
import ReplyActions from './ReplyActions';

const TYPE_OPTIONS = [
  { value: 'yes', label: 'Yes', Icon: CheckCircle2, className: 'rs-type--yes' },
  { value: 'no', label: 'No', Icon: XCircle, className: 'rs-type--no' },
  { value: 'maybe', label: 'Maybe', Icon: HelpCircle, className: 'rs-type--maybe' },
];

const htmlToText = (html = '') => String(html)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>\s*<p>/gi, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .trim();

/**
 * "Detailed Reply" card — pick Yes / No / Maybe from a dropdown and a full
 * thread-aware reply is generated into a rich-text editor. Edits are kept
 * per type, so switching between types never loses unsaved content.
 *
 * @param mailId      EmailAnalysisMail._id
 * @param typeLabels  { yes, no, maybe } contextual option labels from the
 *                    quick-reply generation (e.g. Accept / Reject / Tentative);
 *                    falls back to Yes / No / Maybe while they load
 * @param onInsert    (html) => void — push HTML into the main composer
 * @param onSend      (html, label) => void — parent confirms + sends
 * @param onSaveDraft (html) => Promise — parent saves as a real draft
 * @param sending     true while the parent is sending this card's reply
 */
const DetailedReplySection = ({ mailId, typeLabels = {}, onInsert, onSend, onSaveDraft, sending = false }) => {
  const [replyType, setReplyType] = useState('');
  // Per-type editor content — preserved when the user switches types.
  const [drafts, setDrafts] = useState({ yes: '', no: '', maybe: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  const html = replyType ? drafts[replyType] : '';
  const empty = isEmptyHtml(html);
  const busy = loading || saving || sending || regenerating;

  const generate = async (type, force = false) => {
    if (force) setRegenerating(true); else setLoading(true);
    setError('');
    try {
      const res = await fetchDetailedReply(mailId, type, force);
      if (res?.respCode === 200 && res.reply) {
        setDrafts((d) => ({ ...d, [type]: textToHtml(res.reply) }));
        if (force) showToasterMessage('Detailed reply regenerated', 'success');
      } else {
        setError(res?.errorMessage || 'Could not generate the reply.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  const onPickType = (type) => {
    setReplyType(type);
    setError('');
    // Unsaved edits for this type are kept — only generate when it's empty.
    if (isEmptyHtml(drafts[type])) generate(type, false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(htmlToText(html));
      showToasterMessage('Reply copied to clipboard', 'success');
    } catch {
      showToasterMessage('Could not copy to clipboard', 'error');
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await onSaveDraft(html);
    } finally {
      setSaving(false);
    }
  };

  if (!mailId) return null;

  return (
    <section className="rs-card" aria-label="Detailed reply">
      <div className="rs-card-head">
        <span className="rs-card-icon"><FileText size={14} /></span>
        <h4 className="rs-card-title">Detailed Reply</h4>
        <span className="rs-card-sub">A full reply written from the whole thread</span>

        <div className="rs-type-pick">
          <label className="rs-field-label" htmlFor="rs-detailed-type">Reply type</label>
          <Select value={replyType} onValueChange={onPickType} disabled={busy}>
            <SelectTrigger id="rs-detailed-type" className="rs-select" aria-label="Select reply type">
              <SelectValue placeholder="Select reply type" />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(({ value, label, Icon, className }) => (
                <SelectItem key={value} value={value}>
                  <span className={`rs-type-opt ${className}`}>
                    <Icon size={13} /> {String(typeLabels[value] || '').trim() || label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!replyType && !error && (
        <div className="rs-placeholder">
          Select a reply type above — a detailed reply is generated for you and stays fully editable.
        </div>
      )}

      {error && (
        <div className="rs-error">
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          {replyType && (
            <button type="button" className="rs-btn" onClick={() => generate(replyType, false)}>
              <i className="pi pi-refresh" /> Retry
            </button>
          )}
        </div>
      )}

      {replyType && !error && (
        loading ? (
          <div className="rs-skeleton rs-skeleton--tall" aria-label="Generating detailed reply" aria-busy="true">
            <span /><span /><span /><span /><span className="short" />
          </div>
        ) : (
          <>
            <DraftEditor
              value={html}
              onChange={(v) => setDrafts((d) => ({ ...d, [replyType]: v }))}
              disabled={busy}
              placeholder="Generated detailed reply will appear here…"
              contextMailId={mailId}
            />
            <ReplyActions
              onRegenerate={() => generate(replyType, true)}
              onCopy={copy}
              onSaveDraft={saveDraft}
              onInsert={() => onInsert(html)}
              onSend={() => onSend(html, `detailed ${replyType}`)}
              busy={busy}
              regenerating={regenerating}
              saving={saving}
              sending={sending}
              sendDisabled={empty}
            />
          </>
        )
      )}
    </section>
  );
};

export default DetailedReplySection;
