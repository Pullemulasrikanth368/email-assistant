import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import moment from 'moment';
import fetchMethodRequest from '../../../config/service';

/* Sanitised email body in an isolated iframe (keeps email CSS, blocks scripts) */
export const MailFrame = ({ body, snippet }) => {
  const ref = useRef(null);
  const srcDoc = useMemo(() => {
    const raw = (body || snippet || '').trim();
    const HEAD = '<meta charset="utf-8"><base target="_blank"><style>html{padding:12px;box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;color:#202124;font-size:14px;line-height:1.6;word-break:break-word}img{max-width:100%;height:auto}a{color:#1a73e8}table{max-width:100%}</style>';
    if (!raw) return `<!doctype html><html><head>${HEAD}</head><body><p style="color:#80868b">No content.</p></body></html>`;
    if (!/<[a-z][\s\S]*>/i.test(raw)) {
      const escd = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<!doctype html><html><head>${HEAD}</head><body><pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escd}</pre></body></html>`;
    }
    const clean = DOMPurify.sanitize(raw, { WHOLE_DOCUMENT: true, ADD_ATTR: ['target'] });
    if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head([^>]*)>/i, `<head$1>${HEAD}`);
    if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html([^>]*)>/i, `<html$1><head>${HEAD}</head>`);
    return `<!doctype html><html><head>${HEAD}</head><body>${clean}</body></html>`;
  }, [body, snippet]);

  const onLoad = useCallback(() => {
    const f = ref.current;
    if (!f) return;
    try {
      const doc = f.contentDocument || f.contentWindow.document;
      f.style.height = `${Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) + 8}px`;
    } catch { f.style.height = '420px'; }
  }, []);

  return (
    <iframe
      ref={ref}
      title="source-email"
      className="orm-mail-frame"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      srcDoc={srcDoc}
      onLoad={onLoad}
    />
  );
};

// "Name <addr>" -> display name (falls back to the address).
const senderName = (raw = '') => {
  const match = String(raw).match(/^\s*"?([^"<]+?)"?\s*</);
  return (match ? match[1] : String(raw)).trim() || String(raw).trim();
};

/**
 * Complete conversation thread for a mail in the email detail view.
 *
 * Loads every message of the provider thread (Gmail thread / Outlook
 * conversation) via mails/:id/conversation and renders them oldest-first:
 * older messages collapse to a one-line header, the focused mail and the
 * latest message start expanded, and any row toggles on click. Drafts are
 * filtered out — the editable draft is shown in the AiDraftReply panel below.
 * While loading (or for a single-message thread) it renders just the mail
 * itself, so the drawer never blocks on the thread fetch.
 */
const MailThread = ({ mail }) => {
  const [thread, setThread] = useState(null); // null = loading/none
  const [expanded, setExpanded] = useState(null); // Set of open providerMessageIds

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setExpanded(null);
    if (!mail?._id || !mail.threadId) return undefined;
    fetchMethodRequest('GET', `email-analysis/mails/${mail._id}/conversation`)
      .then((res) => {
        if (cancelled) return;
        const mails = Array.isArray(res?.mails) ? res.mails : [];
        setThread(mails);
      })
      .catch(() => { if (!cancelled) setThread([]); });
    return () => { cancelled = true; };
  }, [mail?._id, mail?.threadId]);

  // Drafts never render in the thread — the draft editor below the thread is
  // the only place a draft shows (and edits) its content.
  const isDraftMsg = (m) =>
    m?.isDraft
    || m?.sourceFolder === 'draft'
    || (m?.labels || []).map((l) => String(l).toUpperCase()).includes('DRAFT');

  const messages = useMemo(() => (
    (thread || [])
      .filter((m) => !isDraftMsg(m))
      .sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0))
  ), [thread]);

  // Single message (or thread still loading / unavailable) — plain body view.
  if (messages.length <= 1) return <MailFrame body={mail.body} snippet={mail.snippet} />;

  const defaultOpen = new Set([mail.providerMessageId, messages[messages.length - 1].providerMessageId]);
  const openSet = expanded || defaultOpen;
  const toggle = (id) => {
    const next = new Set(openSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="orm-thread">
      <div className="orm-thread-count">
        <i className="pi pi-comments" />
        {messages.length} messages in this conversation
      </div>
      {messages.map((m, i) => {
        const id = m.providerMessageId || `msg-${i}`;
        const open = openSet.has(id);
        const when = m.receivedAt ? moment(m.receivedAt).format('MMM D, YYYY h:mm A') : '';
        return (
          <div className={`orm-thread-msg${open ? ' open' : ''}`} key={id}>
            <div
              className="orm-thread-head"
              role="button"
              tabIndex={0}
              onClick={() => toggle(id)}
              onKeyDown={(e) => { if (e.key === 'Enter') toggle(id); }}
            >
              <span className="f">{senderName(m.from)}</span>
              {!open && <span className="s">{m.snippet || ''}</span>}
              <span className="d">{when}</span>
              <i className={`pi ${open ? 'pi-chevron-up' : 'pi-chevron-down'}`} />
            </div>
            {open && <MailFrame body={m.body} snippet={m.snippet} />}
          </div>
        );
      })}
    </div>
  );
};

export default MailThread;
