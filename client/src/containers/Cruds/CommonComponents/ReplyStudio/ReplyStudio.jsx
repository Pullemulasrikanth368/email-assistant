import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import DOMPurify from 'dompurify';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import { isEmptyHtml, textToHtml } from '../DraftEditor';
import {
  sendReplyOnThread,
  saveReplyDraft,
  autosaveReplyDraft,
  deleteReplyDraft,
} from './replyStudio.service';
import QuickRepliesSection from './QuickRepliesSection';
import DetailedReplySection from './DetailedReplySection';
import './ReplyStudio.scss';

/**
 * Reply Studio — the structured reply interface for the Reports email detail
 * view: Quick Replies (Yes / No / Maybe) for short answers you edit and send
 * in place, plus the Detailed Reply workspace (with the "Customize with AI"
 * panel folded in). There is no separate composer below — the Detailed Reply
 * editor IS the composer.
 *
 * The studio keeps exactly ONE real draft per mail: the first autosave from
 * the Detailed Reply creates it (or resumes `mail.draft`, the auto-created
 * one), every later autosave updates it in place, and a successful send of
 * the detailed reply removes it.
 *
 * Sending never happens in one click — a confirmation dialog always appears
 * first. All API calls live in replyStudio.service.js.
 *
 * @param mail     the source mail object (mail.draft = existing draft, if any)
 * @param sourceId providerMessageId — the thread to reply on
 * @param onSent   optional callback fired after a reply is sent
 */
const ReplyStudio = ({ mail, sourceId, onSent }) => {
  const mailId = mail?._id;

  // { html, label } queued for the confirmation dialog; null = closed.
  const [confirm, setConfirm] = useState(null);
  // Which section is mid-send: 'yes' | 'no' | 'maybe' | 'detailed …'
  const [sendingKey, setSendingKey] = useState(null);
  // Contextual option labels from the quick-reply generation (Accept/Reject,
  // Will attend/Unable to attend, …) — reused by the Detailed Reply dropdown.
  const [quickLabels, setQuickLabels] = useState({ yes: '', no: '', maybe: '' });

  // The mail's single studio draft. Created on the first autosave, updated in
  // place afterwards — saving repeatedly never piles up drafts.
  const draftIdRef = useRef(null);
  useEffect(() => {
    draftIdRef.current = mail?.draft?._id || null;
  }, [mailId]);

  const replySubject = /^\s*re:/i.test(mail?.subject || '')
    ? (mail?.subject || '')
    : `Re: ${mail?.subject || '(no subject)'}`;

  // Quick replies hold plain text; the send API expects HTML.
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
        // The detailed reply just went out — its draft is no longer needed.
        if (String(label || '').startsWith('detailed') && draftIdRef.current) {
          deleteReplyDraft(draftIdRef.current).catch(() => {});
          draftIdRef.current = null;
        }
        if (onSent) onSent();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not send the reply', 'error');
      }
    } catch {
      showToasterMessage('Could not send the reply', 'error');
    } finally {
      setSendingKey(null);
    }
  };

  // Create-once / update-after persistence for the Detailed Reply editor.
  const autosaveDraft = async (html) => {
    if (isEmptyHtml(html)) return true;
    try {
      if (draftIdRef.current) {
        await autosaveReplyDraft(draftIdRef.current, html, replySubject);
        return true;
      }
      const res = await saveReplyDraft(mail, sourceId, html, replySubject);
      if (res?.respCode === 200 && res?.data?._id) {
        draftIdRef.current = res.data._id;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  if (!mailId) return null;

  return (
    <div className="reply-studio">
      <QuickRepliesSection
        mailId={mailId}
        onSend={askToSendText}
        onLabels={setQuickLabels}
        sendingType={['yes', 'no', 'maybe'].includes(sendingKey) ? sendingKey : null}
      />

      <DetailedReplySection
        mailId={mailId}
        typeLabels={quickLabels}
        initialDraft={mail?.draft}
        onAutosave={autosaveDraft}
        onSend={askToSendHtml}
        sending={String(sendingKey || '').startsWith('detailed')}
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
