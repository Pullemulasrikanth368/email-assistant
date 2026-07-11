import { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import DOMPurify from 'dompurify';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import { isEmptyHtml, textToHtml } from '../DraftEditor';
import { sendReplyOnThread, saveReplyDraft } from './replyStudio.service';
import QuickRepliesSection from './QuickRepliesSection';
import DetailedReplySection from './DetailedReplySection';
import CustomReplyGenerator from './CustomReplyGenerator';
import './ReplyStudio.scss';

/**
 * Reply Studio — the structured reply interface for the Reports email detail
 * view: Quick Replies (Yes / No / Maybe) + Detailed Reply + Custom AI Reply
 * Generator. Sits above the main reply composer (AiDraftReply); every
 * "Insert into Reply" pushes content into that composer via `onInsert`.
 *
 * Sending never happens in one click — a confirmation dialog always appears
 * first. All API calls live in replyStudio.service.js.
 *
 * @param mail     the source mail object
 * @param sourceId providerMessageId — the thread to reply on
 * @param onInsert (html) => void — insert into the main composer
 */
const ReplyStudio = ({ mail, sourceId, onInsert }) => {
  const mailId = mail?._id;

  // { html, label } queued for the confirmation dialog; null = closed.
  const [confirm, setConfirm] = useState(null);
  // Which section is mid-send: 'yes' | 'no' | 'maybe' | 'detailed …' | 'custom'
  const [sendingKey, setSendingKey] = useState(null);
  // Contextual option labels from the quick-reply generation (Accept/Reject,
  // Will attend/Unable to attend, …) — reused by the Detailed Reply dropdown.
  const [quickLabels, setQuickLabels] = useState({ yes: '', no: '', maybe: '' });

  const replySubject = /^\s*re:/i.test(mail?.subject || '')
    ? (mail?.subject || '')
    : `Re: ${mail?.subject || '(no subject)'}`;

  // Quick replies hold plain text; the composer and send API expect HTML.
  const askToSendText = (text, label) => {
    if (!String(text || '').trim()) return;
    setConfirm({ html: textToHtml(text), label });
  };
  const askToSendHtml = (html, label) => {
    if (isEmptyHtml(html)) return;
    setConfirm({ html, label });
  };

  const doSend = async () => {
    if (!confirm) return;
    const { html, label } = confirm;
    setConfirm(null);
    setSendingKey(label);
    try {
      const res = await sendReplyOnThread(sourceId, html);
      if (res?.respCode === 200) {
        showToasterMessage(res.respMessage || 'Reply sent successfully', 'success');
      } else {
        showToasterMessage(res?.errorMessage || 'Could not send the reply', 'error');
      }
    } catch {
      showToasterMessage('Could not send the reply', 'error');
    } finally {
      setSendingKey(null);
    }
  };

  const saveDraft = async (html) => {
    if (isEmptyHtml(html)) return;
    try {
      const res = await saveReplyDraft(mail, sourceId, html, replySubject);
      if (res?.respCode === 200) {
        showToasterMessage('Saved to Drafts', 'success');
      } else {
        showToasterMessage(res?.errorMessage || 'Could not save the draft', 'error');
      }
    } catch {
      showToasterMessage('Could not save the draft', 'error');
    }
  };

  const insertText = (text) => {
    if (!String(text || '').trim()) return;
    onInsert(textToHtml(text));
  };
  const insertHtml = (html) => {
    if (isEmptyHtml(html)) return;
    onInsert(html);
  };

  if (!mailId) return null;

  return (
    <div className="reply-studio">
      <QuickRepliesSection
        mailId={mailId}
        onInsert={insertText}
        onSend={askToSendText}
        onLabels={setQuickLabels}
        sendingType={['yes', 'no', 'maybe'].includes(sendingKey) ? sendingKey : null}
      />

      <DetailedReplySection
        mailId={mailId}
        typeLabels={quickLabels}
        onInsert={insertHtml}
        onSend={askToSendHtml}
        onSaveDraft={saveDraft}
        sending={String(sendingKey || '').startsWith('detailed')}
      />

      <CustomReplyGenerator
        mailId={mailId}
        onInsert={insertHtml}
        onSend={askToSendHtml}
        onSaveDraft={saveDraft}
        sending={sendingKey === 'custom'}
      />

      {/* Send confirmation — no reply ever goes out on a single click. */}
      <Dialog
        header="Send this reply?"
        visible={!!confirm}
        modal
        draggable={false}
        dismissableMask
        style={{ width: '480px', maxWidth: '94vw' }}
        onHide={() => setConfirm(null)}
      >
        {confirm && (
          <div className="rs-confirm">
            <p className="rs-confirm-note">
              This reply will be sent on the thread <b>{replySubject}</b>.
            </p>
            <div
              className="rs-confirm-preview"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(confirm.html) }}
            />
            <div className="rs-confirm-actions">
              <button type="button" className="rs-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="rs-btn rs-btn--send" onClick={doSend}>
                <i className="pi pi-send" /> Send Reply
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default ReplyStudio;
