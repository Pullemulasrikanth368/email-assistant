import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { RefreshCw, Trash2, Flag, Link, ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, X, Inbox, Send, FileText, Ban, Tag, Mic, Sparkles } from 'lucide-react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import QuickReplies from '../CommonComponents/QuickReplies';
import AiDraftReply from '../CommonComponents/AiDraftReply';
import useCategoryLabels from '../CommonComponents/useCategoryLabels';
import DraftEditor, { isEmptyHtml, textToHtml } from '../CommonComponents/DraftEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dropdown } from 'primereact/dropdown';
import { cn } from '@/lib/utils';
import './EmailAnalysisMails.scss';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Split a raw `From`/`To` header into a display name + email address.
const parseAddress = (raw = '') => {
  if (!raw) return { name: 'Unknown', email: '' };
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) {
    const name = (match[1] || '').trim();
    const email = (match[2] || '').trim();
    return { name: name || email, email };
  }
  const trimmed = raw.trim();
  return { name: trimmed, email: trimmed.includes('@') ? trimmed : '' };
};

const initialOf = (text = '?') => {
  const ch = (text || '?').trim().charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(ch) ? ch : '?';
};

// Deterministic, pleasant avatar colour from a string.
const AVATAR_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#1e8e9e', '#c5221f', '#a142f4'];
const colorFor = (key = '') => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const formatListTime = (dateStr) => {
  if (!dateStr) return '';
  const d = moment(dateStr);
  if (!d.isValid()) return '';
  if (d.isSame(moment(), 'day')) return d.format('h:mm A');
  if (d.isSame(moment(), 'year')) return d.format('MMM D');
  return d.format('MM/DD/YY');
};

const formatFullDate = (dateStr) => {
  const d = moment(dateStr);
  return d.isValid() ? d.format('ddd, MMM D, YYYY [at] h:mm A') : '';
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const escapeHtml = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const looksLikeHtml = (s = '') => /<[a-z][\s\S]*>/i.test(s);

// Base styles injected at the START of <head> so they act as defaults the
// email's own CSS can override (kept light, matching how Gmail renders).
const EMAIL_HEAD = `<meta charset="utf-8"><base target="_blank">
<style>
  html{padding:14px;box-sizing:border-box}
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:Roboto,Arial,Helvetica,sans-serif;color:#202124;font-size:14px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}
  a{color:#1a73e8}
  table{max-width:100%}
  blockquote{margin:0 0 0 8px;padding-left:12px;border-left:2px solid #dadce0;color:#5f6368}
  pre.ea-plain{white-space:pre-wrap;font-family:Roboto,Arial,sans-serif;margin:0}
  .ea-empty-body{color:#80868b;font-style:italic}
</style>`;

// Wrap a sanitized fragment / plain text into a full document.
const wrapFragment = (inner) =>
  `<!doctype html><html><head>${EMAIL_HEAD}</head><body>${inner}</body></html>`;

// Inject our base + reset into an already-full sanitized document so that
// head <style> blocks (Google Alerts, newsletters, marketing emails) survive.
const injectIntoDocument = (html) => {
  let out = html;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${EMAIL_HEAD}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${EMAIL_HEAD}</head>`);
  } else {
    return wrapFragment(out);
  }
  return /^\s*<!doctype/i.test(out) ? out : `<!doctype html>${out}`;
};

// Pick an icon for an attachment based on its type.
const attachmentIcon = (att) => {
  const name = (att.filename || '').toLowerCase();
  const mime = (att.mimeType || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pi pi-file-pdf';
  if (mime.startsWith('image/')) return 'pi pi-image';
  if (mime.includes('sheet') || /\.(xlsx?|csv)$/.test(name)) return 'pi pi-file-excel';
  if (mime.includes('word') || /\.docx?$/.test(name)) return 'pi pi-file-word';
  if (mime.startsWith('audio/')) return 'pi pi-volume-up';
  if (mime.startsWith('video/')) return 'pi pi-video';
  return 'pi pi-file';
};

const PAGE_SIZE = 25;

// The admin app's logged-in user email — used to scope the inbox to the
// account THIS user connected.
const getLoginEmail = () => {
  try { return JSON.parse(localStorage.getItem('loginCredentials'))?.email || ''; }
  catch { return ''; }
};

// Cleanup categories shown in the one-click cleanup dialog.
const CLEANUP_CATS = [
  { key: 'junk', icon: 'pi pi-ban', title: 'Junk / Spam', desc: 'Flagged spam & phishing', color: '#b3261e' },
  { key: 'promotional', icon: 'pi pi-tag', title: 'Promotional', desc: 'Marketing, newsletters, sales', color: '#9a5b08' },
  { key: 'low', icon: 'pi pi-flag', title: 'Low priority', desc: 'FYI · no action needed', color: '#3f6212' },
];

// AI intent-based priority -> colour chip.
const PRIORITY_META = {
  Critical: { color: '#b3261e', bg: '#fbe9e7' },
  High: { color: '#c4631a', bg: '#fbeee2' },
  Medium: { color: '#9a7d12', bg: '#faf6e2' },
  Low: { color: '#5f6368', bg: '#eef0f2' },
};
const PRIORITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };

const VIEW_OPTIONS = [
  { label: 'Inbox', value: 'inbox', icon: 'pi pi-inbox' },
  { label: 'Priority', value: 'priority', icon: 'pi pi-flag' },
];

// Provider folders (styled like Gmail or Outlook depending on the connected account).
const FOLDERS = [
  { key: 'inbox', label: 'Inbox', Icon: Inbox },
  { key: 'sent', label: 'Sent', Icon: Send },
  { key: 'drafts', label: 'Drafts', Icon: FileText },
  { key: 'junk', label: 'Junk', Icon: Ban },
];

// AI categories assigned during sync (must match the server's list).
const MAIL_CATEGORIES = [
  'Action Required',
  'Meetings & Scheduling',
  'Finance & Invoices',
  'Sales & Leads',
  'Support & Complaints',
  'Notifications & Updates',
  'Newsletters',
  'Promotions & Marketing',
  'Personal',
  'Junk',
];

// Category filter options for the PrimeReact Dropdown. "All categories" uses a
// non-empty sentinel — PrimeReact returns the whole option object (not the
// value) when an option's value is falsy, which would break the API payload.
// The sentinel maps back to an empty `category` (omitted from the request).
const ALL_CATEGORIES = 'all';

// Rank used to sort highest -> lowest priority within a day.
const sortValue = (m) =>
  (Number.isFinite(m.priorityScore) ? m.priorityScore : 0) + (PRIORITY_RANK[m.priority] || 0) * 0.001;

// Is this mail an unsent draft?
const isDraftMail = (m) => m?.sourceFolder === 'draft' || (m?.labels || []).includes('DRAFT');

// Plain-text extraction from a stored HTML body (snippets, empty checks).
const htmlToText = (html = '') => {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
};

// Wrap edited plain text back into the HTML shape drafts are stored/sent in.
const localTextToHtml = (text = '') =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }</div>`;

// Mail type tag (Received / Sent / Draft / Junk) shown next to each mail.
const MAIL_TAGS = {
  received: { label: 'Received', color: '#188038', bg: '#e6f4ea' },
  sent: { label: 'Sent', color: '#1a73e8', bg: '#e8f0fe' },
  draft: { label: 'Draft', color: '#c50f1f', bg: '#fdf3f4' },
  junk: { label: 'Junk', color: '#b3261e', bg: '#fbe9e7' },
};
const mailTag = (m) => {
  const labels = m?.labels || [];
  if (isDraftMail(m)) return MAIL_TAGS.draft;
  if (m?.isJunk || m?.sourceFolder === 'junk' || labels.includes('SPAM') || labels.includes('JUNK')) return MAIL_TAGS.junk;
  if (m?.sourceFolder === 'sent' || (labels.includes('SENT') && !labels.includes('INBOX'))) return MAIL_TAGS.sent;
  return MAIL_TAGS.received;
};

const dayHeading = (dateStr) => {
  const d = moment(dateStr);
  if (!d.isValid()) return 'Undated';
  if (d.isSame(moment(), 'day')) return `Today · ${d.format('ddd, D MMM YYYY')}`;
  if (d.isSame(moment().subtract(1, 'day'), 'day')) return `Yesterday · ${d.format('ddd, D MMM YYYY')}`;
  return d.format('dddd, D MMM YYYY');
};

/* ------------------------------------------------------------------ */
/* Mail body (isolated iframe so the email's own CSS can't leak)      */
/* ------------------------------------------------------------------ */
const MailBody = ({ body, snippet }) => {
  const frameRef = useRef(null);
  const [showQuoted, setShowQuoted] = useState(false);

  // Build the full document, plus a "trimmed" variant with the quoted parent
  // mail (reply history) removed so it can collapse behind a ••• toggle.
  const { fullDoc, trimmedDoc, hasQuoted } = useMemo(() => {
    const raw = (body || snippet || '').trim();
    if (!raw) {
      return { fullDoc: wrapFragment('<p class="ea-empty-body">This message has no content.</p>'), trimmedDoc: null, hasQuoted: false };
    }
    if (!looksLikeHtml(raw)) {
      return { fullDoc: wrapFragment(`<pre class="ea-plain">${escapeHtml(raw)}</pre>`), trimmedDoc: null, hasQuoted: false };
    }
    // WHOLE_DOCUMENT keeps <head><style> blocks (otherwise head CSS is dropped
    // and emails like Google Alerts render unstyled). The iframe is sandboxed
    // (no allow-scripts) so sanitised markup still cannot execute.
    const clean = DOMPurify.sanitize(raw, {
      WHOLE_DOCUMENT: true,
      ADD_ATTR: ['target'],
    });
    const full = injectIntoDocument(clean);

    try {
      const doc = new DOMParser().parseFromString(clean, 'text/html');
      // Outlook reply separators: the quoted mail is the marker + everything after it.
      const markers = [...doc.querySelectorAll('#divRplyFwdMsg, [id^="x_divRplyFwdMsg"], #appendonsend, .OutlookMessageHeader')];
      markers.forEach((marker) => {
        let cur = marker;
        while (cur) {
          const next = cur.nextElementSibling;
          cur.remove();
          cur = next;
        }
      });
      // Gmail (and generic) quoted history containers.
      const quotes = [...doc.querySelectorAll('.gmail_quote, blockquote')]
        .filter((n) => n.isConnected && !(n.parentElement && n.parentElement.closest('.gmail_quote, blockquote')));
      quotes.forEach((n) => n.remove());

      const removedAny = markers.length > 0 || quotes.length > 0;
      const remainingText = (doc.body?.textContent || '').trim();
      if (removedAny && remainingText) {
        return { fullDoc: full, trimmedDoc: injectIntoDocument(doc.documentElement.outerHTML), hasQuoted: true };
      }
    } catch { /* fall back to the full document */ }
    return { fullDoc: full, trimmedDoc: null, hasQuoted: false };
  }, [body, snippet]);

  const srcDoc = hasQuoted && !showQuoted ? trimmedDoc : fullDoc;

  const handleLoad = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const setHeight = () => {
      const f = frameRef.current;
      if (!f) return;
      try {
        const doc = f.contentDocument || f.contentWindow.document;
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        f.style.height = `${h + 8}px`;
      } catch {
        f.style.height = '480px';
      }
    };

    setHeight();
    // Images/web fonts can reflow after the initial load — re-measure a few
    // times and whenever a still-loading image finishes, so nothing is cut off.
    [150, 500, 1200].forEach((t) => setTimeout(setHeight, t));
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      doc.querySelectorAll('img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', setHeight, { once: true });
      });
    } catch {
      /* cross-origin guard — ignore */
    }
  }, []);

  return (
    <>
      <iframe
        ref={frameRef}
        title="email-body"
        className="ea-mail-frame"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
      {hasQuoted && (
        <button
          type="button"
          className="ea-quote-toggle"
          onClick={() => setShowQuoted((v) => !v)}
          title={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
        >
          <span className="ea-quote-dots">•••</span>
          {showQuoted ? 'Hide quoted text' : 'Show quoted text'}
        </button>
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Inline draft editor — shown in place of a draft's rendered body      */
/* ------------------------------------------------------------------ */
const DRAFT_AUTOSAVE_MS = 900;

const DraftThreadEditor = ({ msg, onSave, onSaved, onSend, onDiscard }) => {
  const [subject, setSubject] = useState(msg.subject || '');
  // The editor works on the draft's HTML directly.
  const [html, setHtml] = useState(() => (
    msg.body && !isEmptyHtml(msg.body) ? msg.body : localTextToHtml(msg.snippet || '')
  ));
  const [saveState, setSaveState] = useState('');
  const [sending, setSending] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const subjectRef = useRef(subject);
  const htmlRef = useRef(html);
  const dirtyRef = useRef(false);
  const timer = useRef(null);

  const persist = useCallback(async () => {
    setSaveState('saving');
    const saved = await onSave(msg, { subject: subjectRef.current, html: htmlRef.current });
    if (saved) {
      dirtyRef.current = false;
      setSaveState('saved');
      if (onSaved) onSaved(saved);
    } else {
      setSaveState('failed');
    }
  }, [msg, onSave, onSaved]);

  const scheduleSave = () => {
    dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, DRAFT_AUTOSAVE_MS);
  };

  // Flush any unsaved edit when the editor unmounts (mail switched / screen left).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) onSave(msg, { subject: subjectRef.current, html: htmlRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubjectChange = (v) => { setSubject(v); subjectRef.current = v; scheduleSave(); };
  const handleHtmlChange = (v) => { setHtml(v); htmlRef.current = v; scheduleSave(); };

  const handleSend = async () => {
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) await persist();
    const ok = await onSend(msg);
    if (!ok) setSending(false);
  };

  const handleDiscard = async () => {
    setDiscarding(true);
    if (timer.current) clearTimeout(timer.current);
    const ok = await onDiscard(msg);
    if (!ok) setDiscarding(false);
  };

  const busy = sending || discarding;

  return (
    <div className="ea-draft-inline">
      <input
        type="text"
        className="ea-draft-inline-subject"
        value={subject}
        onChange={(e) => handleSubjectChange(e.target.value)}
        placeholder="Subject"
        disabled={busy}
      />
      <DraftEditor
        value={html}
        onChange={handleHtmlChange}
        disabled={busy}
        placeholder="Write your draft…"
        contextMailId={msg?._id}
      />
      <div className="ea-draft-inline-foot">
        <span className={cn('ea-draft-savestate', `ea-draft-savestate--${saveState || 'idle'}`)}>
          {saveState === 'saving' && (<><i className="pi pi-spin pi-spinner" /> Saving…</>)}
          {saveState === 'saved' && (<><i className="pi pi-check" /> Saved</>)}
          {saveState === 'failed' && (<><i className="pi pi-exclamation-triangle" /> Not saved</>)}
        </span>
        <div className="ea-draft-inline-btns">
          <Button
            size="sm"
            variant="outline"
            className="ea-draft-discard-btn"
            onClick={handleDiscard}
            disabled={busy}
          >
            {discarding ? <i className="pi pi-spin pi-spinner" /> : <Trash2 size={13} />} Discard
          </Button>
          <Button
            size="sm"
            className="ea-draft-send-btn"
            onClick={handleSend}
            disabled={busy || isEmptyHtml(html)}
          >
            {sending
              ? (<><i className="pi pi-spin pi-spinner" style={{ marginRight: 4 }} /> Sending…</>)
              : (<><Send size={13} /> Send</>)}
          </Button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main screen                                                        */
/* ------------------------------------------------------------------ */
const EmailAnalysisMails = () => {
  const navigate = useNavigate();
  // Category display names — the Outlook labels from the category config, so
  // the list, detail view and filter show the same tags as Outlook.
  const catLabel = useCategoryLabels();
  const categoryOptions = [
    { label: 'All categories', value: ALL_CATEGORIES },
    ...MAIL_CATEGORIES.map((c) => ({ label: catLabel(c), value: c })),
  ];

  const [mails, setMails] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [first, setFirst] = useState(0);
  const [rows] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  // Received-date filter ({ from, to } as YYYY-MM-DD). `dateRange` is applied;
  // `draftRange` is what the user is editing inside the filter popup.
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [draftRange, setDraftRange] = useState({ from: '', to: '' });
  const [dateDialog, setDateDialog] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedMail, setSelectedMail] = useState(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState(null);
  const [readIds, setReadIds] = useState(() => new Set());
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);
  const [syncIntervalValue, setSyncIntervalValue] = useState(15);
  const [syncIntervalUnit, setSyncIntervalUnit] = useState('minutes');
  const [showReadingPaneMobile, setShowReadingPaneMobile] = useState(false);

  // Connected provider ('gmail' | 'outlook') — drives the folder-bar styling.
  const [provider, setProvider] = useState('gmail');
  // Provider folder + AI category filters.
  const [folder, setFolder] = useState('inbox');
  const [category, setCategory] = useState('');

  // Full conversation of the opened mail. Only messages whose providerMessageId
  // is in `expandedMsgs` are shown expanded (the rest collapse to one line).
  const [thread, setThread] = useState([]);
  const [expandedMsgs, setExpandedMsgs] = useState(() => new Set());

  // Conversation thread summary states
  const [threadSummary, setThreadSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const formatInterval = () => {
    if (syncIntervalUnit === 'days') {
      return syncIntervalValue === 1 ? '1 day' : `${syncIntervalValue} days`;
    }
    if (syncIntervalUnit === 'hours') {
      return syncIntervalValue === 1 ? '1 hour' : `${syncIntervalValue} hours`;
    }
    return `${syncIntervalValue} min`;
  };

  // One-click cleanup (remove junk / promotional / low-priority mail).
  const [cleanup, setCleanup] = useState({
    visible: false, loading: false, counts: null, removing: false,
    sel: { junk: true, promotional: true, low: false },
  });

  // 'inbox' = normal split view, 'priority' = grouped priority table
  const [viewMode, setViewMode] = useState('inbox');
  const [priorityReading, setPriorityReading] = useState(false); // full-screen mail viewer in priority mode
  const [prioritizing, setPrioritizing] = useState(false);

  const searchDebounce = useRef(null);

  /* -------------------- provider detection (for folder-bar styling) ---- */
  useEffect(() => {
    (async () => {
      try {
        const outlook = await fetchMethodRequest('GET', 'auth/microsoft/outlook/status');
        if (outlook?.connected) { setProvider('outlook'); return; }
        const status = await fetchMethodRequest('GET', 'auth/google/email-analysis/status');
        const p = String(status?.provider || '').toLowerCase();
        setProvider(p.includes('outlook') || p.includes('microsoft') ? 'outlook' : 'gmail');
      } catch { /* keep the gmail default */ }
    })();
  }, []);

  /* -------------------- data fetching -------------------- */
  const fetchMails = useCallback(async (page, limit, searchTerm, range) => {
    setLoading(true);
    setError(null);
    try {
      const filter = {
        page,
        limit,
        sortfield: 'receivedAt',
        direction: 'desc',
        search: searchTerm || '',
        loginUserEmailId: getLoginEmail(),
        folder,
        ...(category ? { category } : {}),
        ...(range?.from ? { fromDate: range.from } : {}),
        ...(range?.to ? { toDate: range.to } : {}),
      };
      const url = `email-analysis/mails?filter=${encodeURIComponent(JSON.stringify(filter))}`;
      const res = await fetchMethodRequest('GET', url);
      setMails(Array.isArray(res?.mails) ? res.mails : []);
      setTotalRecords(res?.pagination?.totalCount || 0);
    } catch {
      setMails([]);
      setTotalRecords(0);
      setError('Could not load emails. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [folder, category]);

  // Changing folder/category restarts from the first page and closes the reader.
  const selectFolder = (key) => {
    if (key === folder) return;
    setFolder(key);
    setFirst(0);
    // The AI category filter only applies to the inbox; clear it when leaving
    // so a stale filter doesn't silently narrow Sent/Drafts/Junk.
    if (key !== 'inbox') setCategory('');
    setSelectedId(null);
    setSelectedMail(null);
    setShowReadingPaneMobile(false);
  };

  const selectCategory = (value) => {
    setCategory(value);
    setFirst(0);
  };

  useEffect(() => {
    const page = Math.floor(first / rows) + 1;
    fetchMails(page, rows, appliedSearch, dateRange);
  }, [first, rows, appliedSearch, dateRange, fetchMails]);

  // Fetch auto-sync and sync interval preferences for the logged-in user on mount & listen for updates.
  useEffect(() => {
    const loadSettings = () => {
      fetchMethodRequest('GET', 'email-analysis/auto-sync')
        .then((r) => { if (r?.autoSync !== undefined) setAutoSync(r.autoSync !== false); })
        .catch(() => { });
      fetchMethodRequest('GET', 'email-analysis/sync-interval')
        .then((r) => {
          if (r?.syncIntervalValue !== undefined) {
            setSyncIntervalValue(Number(r.syncIntervalValue) || 15);
            setSyncIntervalUnit(r.syncIntervalUnit || 'minutes');
          } else if (r?.syncIntervalMinutes !== undefined) {
            setSyncIntervalValue(Number(r.syncIntervalMinutes) || 15);
            setSyncIntervalUnit('minutes');
          }
        })
        .catch(() => { });
    };

    loadSettings();
    window.addEventListener('syncSettingsUpdated', loadSettings);
    return () => {
      window.removeEventListener('syncSettingsUpdated', loadSettings);
    };
  }, []);

  /* -------------------- search (debounced) -------------------- */
  const onSearchChange = (value) => {
    setSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setFirst(0);
      setAppliedSearch(value.trim());
    }, 400);
  };

  const clearSearch = () => {
    setSearch('');
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    setFirst(0);
    setAppliedSearch('');
  };

  /* -------------------- AI search -------------------- */
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const runAiSearch = (rawPrompt) => {
    const prompt = (rawPrompt ?? search).trim();
    if (!prompt) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    setSearch(prompt);
    setFirst(0);
    setAppliedSearch(prompt);
  };

  const toggleVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToasterMessage('Voice search is not supported in this browser', 'warning');
      return;
    }
    // Already listening → stop.
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setSearch(transcript);
        runAiSearch(transcript);
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  /* -------------------- open a mail -------------------- */
  const openMail = useCallback(async (mail) => {
    setSelectedId(mail._id);
    setShowReadingPaneMobile(true);
    setReadIds(prev => new Set(prev).add(mail._id));
    setMailLoading(true);
    setMailError(null);
    setSelectedMail(null);
    setThread([]);
    setExpandedMsgs(new Set());
    setThreadSummary(null);
    setSummaryLoading(false);
    setSummaryError(null);
    setSummaryExpanded(false);

    // Mark as read in the real mailbox too (fire-and-forget, like Gmail/Outlook).
    if ((mail.labels || []).includes('UNREAD') && mail.providerMessageId) {
      fetchMethodRequest('POST', 'email-analysis/mail/mark-read', {
        messageIds: [mail.providerMessageId],
        isRead: true,
        loginUserEmailId: getLoginEmail(),
      }).catch(() => { });
      setMails(prev => prev.map(m => (
        m._id === mail._id ? { ...m, labels: (m.labels || []).filter(l => l !== 'UNREAD') } : m
      )));
    }

    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/${mail._id}`);
      if (res?.mail) {
        setSelectedMail(res.mail);
        // Only the first message of the conversation starts expanded.
        setExpandedMsgs(new Set([res.mail.providerMessageId]));
        loadThread(mail._id, res.mail);
        // Pre-generate the AI reply in the background the first time the mail is
        // read — the server caches it on the mail, so the "AI draft reply" button
        // (and every later open) returns instantly instead of re-generating.
        if (!isDraftMail(res.mail) && !res.mail.aiReply?.text) {
          fetchMethodRequest('POST', `email-analysis/mails/${mail._id}/generate-reply`, {}).catch(() => { });
        }
      } else {
        setMailError('This email could not be found.');
      }
    } catch {
      setMailError('Could not open this email. Please try again.');
    } finally {
      setMailLoading(false);
    }
  }, []);

  const fetchThreadSummary = async (mailId, force = false) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetchMethodRequest('POST', `email-analysis/mails/${mailId}/conversation/summary`, { force });
      if (res?.respCode === 200 && res.summary) {
        setThreadSummary(res.summary);
      } else {
        setSummaryError(res?.errorMessage || 'Could not load conversation summary.');
      }
    } catch {
      setSummaryError('Failed to load conversation summary.');
    } finally {
      setSummaryLoading(false);
    }
  };

  // Fetch the whole conversation the opened mail belongs to (oldest first).
  const loadThread = async (mailId, openedMail) => {
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/${mailId}/conversation`);
      let msgs = Array.isArray(res?.mails) ? res.mails : [];
      // Make sure the opened mail itself is present, then sort chronologically.
      if (!msgs.some(m => m.providerMessageId === openedMail.providerMessageId)) {
        msgs = [...msgs, openedMail];
      }
      msgs.sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0));
      setThread(msgs);
      setExpandedMsgs(new Set([msgs[0]?.providerMessageId].filter(Boolean)));

      if (msgs.length >= 2) {
        fetchThreadSummary(mailId);
      }
    } catch {
      setThread([openedMail]);
      setExpandedMsgs(new Set([openedMail.providerMessageId]));
    }
  };

  const toggleThreadMsg = (id) => {
    setExpandedMsgs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* -------------------- mail actions (delete) --------------------------- */
  const [deletingMail, setDeletingMail] = useState(false);

  const closeReader = () => {
    setSelectedId(null);
    setSelectedMail(null);
    setThread([]);
    setShowReadingPaneMobile(false);
    if (viewMode === 'priority') setPriorityReading(false);
  };

  // Delete the opened mail — provider + local. (Drafts use their own inline
  // Discard button instead, since discarding also needs to clear the editor.)
  const deleteOpenMail = async () => {
    if (!selectedMail?.providerMessageId) return;
    if (!window.confirm('Delete this email? It will also be removed from your mailbox.')) return;
    setDeletingMail(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mail/delete', {
        messageIds: [selectedMail.providerMessageId],
        loginUserEmailId: getLoginEmail(),
      });
      if (res?.respCode) {
        showToasterMessage('Email deleted', 'success');
        closeReader();
        refresh();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not delete', 'error');
      }
    } catch {
      showToasterMessage('Delete failed. Please try again.', 'error');
    } finally {
      setDeletingMail(false);
    }
  };

  // Discard a draft message shown inline in the thread — deletes it at the
  // provider (Drafts folder) and locally, then closes the reader.
  const discardDraftMessage = async (msg) => {
    if (!msg?.providerMessageId && !msg?.localDraftId) return false;
    if (!window.confirm('Discard this draft?')) return false;
    try {
      const res = msg.localDraftId
        ? await fetchMethodRequest('DELETE', `email-analysis/drafts/${msg.localDraftId}`)
        : await fetchMethodRequest('POST', 'email-analysis/mail/delete', {
          messageIds: [msg.providerMessageId],
          loginUserEmailId: getLoginEmail(),
        });
      if (res?.respCode) {
        showToasterMessage('Draft discarded', 'success');
        closeReader();
        refresh();
        return true;
      }
      showToasterMessage(res?.errorMessage || 'Could not discard draft', 'error');
    } catch {
      showToasterMessage('Discard failed. Please try again.', 'error');
    }
    return false;
  };

  // Send a draft message shown inline in the thread as-is.
  const sendDraftMessage = async (msg) => {
    if (!msg?._id) return false;
    try {
      const res = msg.localDraftId
        ? await fetchMethodRequest('POST', `email-analysis/drafts/${msg.localDraftId}/send`)
        : await fetchMethodRequest('POST', `email-analysis/mails/${msg._id}/draft/send`, {});
      if (res?.respCode === 200) {
        showToasterMessage('Email sent', 'success');
        closeReader();
        refresh();
        return true;
      }
      showToasterMessage(res?.errorMessage || 'Send failed. Please try again.', 'error');
    } catch {
      showToasterMessage('Send failed. Please try again.', 'error');
    }
    return false;
  };

  // Persist inline edits to a draft (used for both debounced auto-save and
  // the flush-on-unmount when the user moves to another mail/screen).
  const saveDraftMessage = async (msg, { subject, html }) => {
    if (!msg?._id) return null;
    try {
      const body = html;
      if (msg.localDraftId) {
        const res = await fetchMethodRequest('POST', `email-analysis/drafts/${msg.localDraftId}/autosave`, {
          subject,
          body,
        });
        if (res?.respCode === 200) {
          return {
            ...msg,
            subject,
            body,
            snippet: htmlToText(body).replace(/\s+/g, ' ').trim().slice(0, 200),
          };
        }
        return null;
      }
      const res = await fetchMethodRequest('PUT', `email-analysis/mails/${msg._id}/draft`, { subject, body });
      if (res?.respCode === 200 && res?.mail) return res.mail;
    } catch { /* surfaced via the editor's own save-state indicator */ }
    return null;
  };

  /* -------------------- sync now -------------------- */
  const onSyncNow = async () => {
    setSyncing(true);
    try {
      // Detect active provider: try Outlook first, fall back to Google
      const outlookStatus = await fetchMethodRequest('GET', 'auth/microsoft/outlook/status');
      const isOutlook = outlookStatus?.connected;

      const endpoint = isOutlook
        ? 'auth/microsoft/outlook/sync'
        : 'auth/google/email-analysis/sync';

      const res = await fetchMethodRequest('POST', endpoint, {});
      if (res?.respCode) {
        showToasterMessage(
          res?.result?.saved ? `Synced ${res.result.saved} new email(s)` : 'Inbox is up to date',
          'success'
        );
        setFirst(0);
        fetchMails(1, rows, appliedSearch, dateRange);
      } else {
        showToasterMessage(res?.errorMessage || 'No connected account to sync', 'warning');
      }
    } catch {
      showToasterMessage('Sync failed. Please try again.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  /* -------------------- auto-sync toggle -------------------- */
  const onToggleAutoSync = async () => {
    const next = !autoSync;
    setAutoSync(next); // optimistic update
    setAutoSyncLoading(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/auto-sync', { autoSync: next });
      if (res?.respCode) {
        showToasterMessage(
          next ? `Auto-sync enabled — syncing every ${formatInterval()}` : 'Auto-sync paused',
          'success'
        );
      } else {
        setAutoSync(!next); // revert on failure
        showToasterMessage(res?.errorMessage || 'Could not update auto-sync', 'error');
      }
    } catch {
      setAutoSync(!next);
      showToasterMessage('Could not update auto-sync', 'error');
    } finally {
      setAutoSyncLoading(false);
    }
  };

  const refresh = () => {
    const page = Math.floor(first / rows) + 1;
    fetchMails(page, rows, appliedSearch, dateRange);
  };

  /* -------------------- cleanup (remove junk/promo/low) -------------------- */
  const openCleanup = async () => {
    setCleanup(c => ({ ...c, visible: true, loading: true, counts: null }));
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/cleanup/preview');
      setCleanup(c => ({ ...c, loading: false, counts: res?.counts || { junk: 0, promotional: 0, low: 0 } }));
    } catch {
      setCleanup(c => ({ ...c, loading: false, counts: { junk: 0, promotional: 0, low: 0 } }));
    }
  };

  const toggleCleanup = (key) => setCleanup(c => ({ ...c, sel: { ...c.sel, [key]: !c.sel[key] } }));

  const doCleanup = async () => {
    const categories = Object.keys(cleanup.sel).filter(k => cleanup.sel[k]);
    if (!categories.length) return;
    setCleanup(c => ({ ...c, removing: true }));
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/cleanup', { categories });
      if (res?.respCode) {
        showToasterMessage(res.respMessage || 'Inbox cleaned up', 'success');
        setCleanup({ visible: false, loading: false, counts: null, removing: false, sel: { junk: true, promotional: true, low: false } });
        setSelectedId(null);
        setSelectedMail(null);
        setFirst(0);
        fetchMails(1, rows, appliedSearch, dateRange);
      } else {
        setCleanup(c => ({ ...c, removing: false }));
        showToasterMessage(res?.errorMessage || 'Could not clean up', 'error');
      }
    } catch {
      setCleanup(c => ({ ...c, removing: false }));
      showToasterMessage('Cleanup failed. Please try again.', 'error');
    }
  };

  /* -------------------- pager (Gmail-style prev / next) -------------------- */
  const canPrev = first > 0;
  const canNext = first + rows < totalRecords;
  const goPrev = () => { if (canPrev) setFirst(Math.max(0, first - rows)); };
  const goNext = () => { if (canNext) setFirst(first + rows); };

  const rangeLabel = useMemo(() => {
    if (!totalRecords) return '0';
    const start = first + 1;
    const end = Math.min(first + rows, totalRecords);
    return `${start}–${end} of ${totalRecords}`;
  }, [first, rows, totalRecords]);

  /* -------------------- date filter -------------------- */
  const hasDateFilter = !!(dateRange.from || dateRange.to);

  const openDateDialog = () => {
    setDraftRange(dateRange);
    setDateDialog(true);
  };

  const applyDateFilter = () => {
    setDateRange(draftRange);
    setFirst(0);
    setDateDialog(false);
  };

  const clearDateFilter = () => {
    setDraftRange({ from: '', to: '' });
    setDateRange({ from: '', to: '' });
    setFirst(0);
    setDateDialog(false);
  };

  // Quick presets fill the draft inputs; Apply commits them.
  const DATE_PRESETS = [
    { label: 'Today', from: 0, to: 0 },
    { label: 'Yesterday', from: 1, to: 1 },
    { label: 'Last 7 days', from: 6, to: 0 },
    { label: 'Last 30 days', from: 29, to: 0 },
  ];
  const usePreset = (p) => setDraftRange({
    from: moment().subtract(p.from, 'days').format('YYYY-MM-DD'),
    to: moment().subtract(p.to, 'days').format('YYYY-MM-DD'),
  });

  // Human label for the applied range, shown on the filter chip.
  const dateChipLabel = useMemo(() => {
    if (!hasDateFilter) return '';
    const fmt = (d) => moment(d, 'YYYY-MM-DD').format('MMM D');
    if (dateRange.from && dateRange.to) {
      return dateRange.from === dateRange.to ? fmt(dateRange.from) : `${fmt(dateRange.from)} – ${fmt(dateRange.to)}`;
    }
    return dateRange.from ? `From ${fmt(dateRange.from)}` : `Until ${fmt(dateRange.to)}`;
  }, [dateRange, hasDateFilter]);

  // Approximate total to remove for the selected cleanup categories (categories
  // can overlap, so the exact count is reported back after removal).
  const selectedCleanupTotal = cleanup.counts
    ? Object.keys(cleanup.sel).reduce((s, k) => s + (cleanup.sel[k] ? (cleanup.counts[k] || 0) : 0), 0)
    : 0;

  // Group the current page by day (newest day first), and within each day sort
  // highest -> lowest priority. Used by the Priority view.
  const dayGroups = useMemo(() => {
    const map = new Map();
    for (const m of mails) {
      const key = m.receivedAt ? moment(m.receivedAt).format('YYYY-MM-DD') : 'undated';
      if (!map.has(key)) map.set(key, { key, date: m.receivedAt, items: [] });
      map.get(key).items.push(m);
    }
    const groups = [...map.values()];
    groups.sort((a, b) => moment(b.date).valueOf() - moment(a.date).valueOf());
    groups.forEach((g) => g.items.sort((a, b) => sortValue(b) - sortValue(a)));
    return groups;
  }, [mails]);

  // Run AI prioritization for the inbox, then refresh.
  const prioritizeNow = async () => {
    setPrioritizing(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/mails/prioritize', { force: true });
      if (res?.respCode) {
        showToasterMessage(`Prioritized ${res.count || 0} email(s)`, 'success');
        refresh();
      } else {
        showToasterMessage(res?.errorMessage || 'Could not prioritize', 'warning');
      }
    } catch {
      showToasterMessage('Prioritization failed', 'error');
    } finally {
      setPrioritizing(false);
    }
  };

  const openMailPriority = (mail) => { openMail(mail); setPriorityReading(true); };

  const closePriorityReading = () => {
    setPriorityReading(false);
    setSelectedId(null);
    setSelectedMail(null);
  };

  /* -------------------- render: list item -------------------- */
  const renderListItem = (mail) => {
    const { name } = parseAddress(mail.from);
    const isDraft = isDraftMail(mail);
    // Outlook/Gmail style: drafts are listed by recipient, prefixed "[Draft]" in red.
    const recipient = parseAddress(mail.to).name || 'No recipient';
    const displayName = isDraft ? recipient : name;
    const isRead = isDraft || readIds.has(mail._id) || !(mail.labels || []).includes('UNREAD');
    const isSelected = selectedId === mail._id;
    return (
      <div
        key={mail._id}
        className={cn('ea-row', { unread: !isRead, selected: isSelected })}
        onClick={() => openMail(mail)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') openMail(mail); }}
      >
        <span className="ea-avatar" style={{ backgroundColor: colorFor(displayName) }}>
          {initialOf(displayName)}
        </span>
        <div className="ea-row-main">
          <div className="ea-row-top">
            <span className="ea-sender" title={isDraft ? mail.to : mail.from}>
              {isDraft && <span className="ea-draft-tag">[Draft]</span>}
              {displayName}
            </span>
            <span className="ea-time">{formatListTime(mail.receivedAt)}</span>
          </div>
          <div className="ea-row-bottom">
            {mail.priority && PRIORITY_META[mail.priority] && (
              <span
                className={cn('ea-prio', { 'dot-only': mail.priority === 'Low' })}
                style={{ color: PRIORITY_META[mail.priority].color }}
                title={mail.intent ? `${mail.priority} · ${mail.intent}${mail.priorityReason ? ` — ${mail.priorityReason}` : ''}` : mail.priority}
              >
                {mail.priority !== 'Low' && mail.priority}
              </span>
            )}
            <span className="ea-subject">
              {mail.subject || '(no subject)'}
              {mail.snippet && <span className="ea-snippet"> — {mail.snippet}</span>}
            </span>
            {mail.category && <span className="ea-cat-chip" title={`Category: ${catLabel(mail.category)}`}>{catLabel(mail.category)}</span>}
            {mail.hasAttachments && <i className="pi pi-paperclip ea-clip" />}
          </div>
        </div>
      </div>
    );
  };

  /* -------------------- render: one message of a conversation ---------- */
  const renderThreadMessage = (msg, idx, isExpanded, isOnly) => {
    const from = parseAddress(msg.from);
    const to = parseAddress(msg.to);
    const attachments = msg.attachments || [];
    const key = msg.providerMessageId || msg._id || idx;

    if (!isExpanded) {
      const tag = mailTag(msg);
      return (
        <button
          type="button"
          key={key}
          className="ea-thread-collapsed"
          onClick={() => toggleThreadMsg(msg.providerMessageId)}
          title="Show this message"
        >
          <span className="ea-avatar sm" style={{ backgroundColor: colorFor(from.name) }}>
            {initialOf(from.name)}
          </span>
          <span className="ea-thread-sender">{from.name}</span>
          <span className="ea-thread-snippet">{msg.snippet || ''}</span>
          <span className="ea-thread-date">{formatListTime(msg.receivedAt)}</span>
          <span className="ea-mail-tag" style={{ color: tag.color, background: tag.bg, marginLeft: 'auto', flex: 'none' }}>{tag.label}</span>
        </button>
      );
    }

    return (
      <div className="ea-thread-msg" key={key}>
        {isDraftMail(msg) && (
          <div className="ea-draft-banner">
            <i className="pi pi-pencil" />
            <span><b>[Draft]</b> This message hasn&apos;t been sent.</span>
          </div>
        )}
        <div
          className={cn('ea-reader-meta', { 'ea-thread-toggle': !isOnly })}
          onClick={() => { if (!isOnly) toggleThreadMsg(msg.providerMessageId); }}
          role={isOnly ? undefined : 'button'}
        >
          <span className="ea-avatar lg" style={{ backgroundColor: colorFor(from.name) }}>
            {initialOf(from.name)}
          </span>
          <div className="ea-meta-text">
            <div className="ea-meta-line">
              <span className="ea-from-name">{from.name}</span>
              {from.email && <span className="ea-from-email">&lt;{from.email}&gt;</span>}
              <div className="ea-badges-container">
                {(() => {
                  const t = mailTag(msg); return (
                    <span className="ea-mail-tag" style={{ color: t.color, background: t.bg }}>{t.label}</span>
                  );
                })()}
                {msg.priority && PRIORITY_META[msg.priority] && (
                  <span
                    className="ea-priority-badge"
                    style={{ color: PRIORITY_META[msg.priority].color, background: PRIORITY_META[msg.priority].bg }}
                    title={msg.intent ? `${msg.priority} · ${msg.intent}` : msg.priority}
                  >
                    {msg.priority}
                  </span>
                )}
                {msg.category && (
                  <span className="ea-cat-chip" title={`Category: ${catLabel(msg.category)}`}>{catLabel(msg.category)}</span>
                )}
              </div>
            </div>
            <div className="ea-meta-sub">
              to {to.name || to.email || 'me'}
              {(msg.cc || []).length > 0 && `, cc: ${msg.cc.join(', ')}`}
            </div>
          </div>
          <div className="ea-meta-date">{formatFullDate(msg.receivedAt)}</div>
        </div>

        {isDraftMail(msg) ? (
          <DraftThreadEditor
            key={msg._id}
            msg={msg}
            onSave={saveDraftMessage}
            onSaved={(updated) => {
              setThread((prev) => prev.map((m) => (m._id === updated._id ? updated : m)));
              if (selectedMail?._id === updated._id) setSelectedMail(updated);
            }}
            onSend={sendDraftMessage}
            onDiscard={discardDraftMessage}
          />
        ) : (
          <MailBody body={msg.body} snippet={msg.snippet} />
        )}

        {attachments.length > 0 && (
          <div className="ea-attachments">
            <div className="ea-attachments-head">
              <i className="pi pi-paperclip" />
              {attachments.length} {attachments.length === 1 ? 'Attachment' : 'Attachments'}
            </div>
            <div className="ea-attachments-grid">
              {attachments.map((att, i) => (
                <div className="ea-attachment" key={`${att.filename}-${i}`}>
                  <span className="ea-att-icon"><i className={attachmentIcon(att)} /></span>
                  <div className="ea-att-info">
                    <div className="ea-att-name" title={att.filename}>{att.filename || 'attachment'}</div>
                    <div className="ea-att-size">{formatBytes(att.size)}</div>
                  </div>
                  {att.url ? (
                    <a
                      className="ea-att-download"
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      title="Download"
                    >
                      <i className="pi pi-download" />
                    </a>
                  ) : (
                    <span className="ea-att-missing" title="File not available">
                      <i className="pi pi-ban" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* -------------------- render: reading pane -------------------- */
  const renderReadingPane = () => {
    if (mailLoading) {
      return (
        <div className="ea-reader-state">
          <i className="pi pi-spin pi-spinner" />
          <span>Loading email…</span>
        </div>
      );
    }
    if (mailError) {
      return (
        <div className="ea-reader-state">
          <i className="pi pi-exclamation-triangle" />
          <span>{mailError}</span>
        </div>
      );
    }
    if (!selectedMail) {
      return (
        <div className="ea-reader-empty">
          <i className="pi pi-envelope" />
          <h3>Select an email to read</h3>
          <p>Choose a message from the list to view it here.</p>
        </div>
      );
    }

    // The conversation (oldest first); until it loads, show the opened mail alone.
    const msgs = thread.length ? thread : [selectedMail];

    return (
      <div className="ea-reader">
        <div className="ea-reader-toolbar">
          <Button
            size="icon"
            variant="ghost"
            className="ea-back-btn"
            onClick={() => {
              if (viewMode === 'priority') closePriorityReading();
              else setShowReadingPaneMobile(false);
            }}
            aria-label="Back to list"
            title="Back to list"
          >
            <ArrowLeft size={16} />
          </Button>
          <p className="ea-reader-subject">{selectedMail.subject || '(no subject)'}</p>
          {msgs.length > 1 && <span className="ea-thread-count">{msgs.length} messages</span>}
          <div className="ea-reader-actions">
            {!isDraftMail(selectedMail) && (
              <button
                type="button"
                className="ea-icon-btn ea-icon-btn--danger"
                onClick={deleteOpenMail}
                disabled={deletingMail}
                title="Delete email"
                aria-label="Delete email"
              >
                {deletingMail ? <i className="pi pi-spin pi-spinner" /> : <Trash2 size={15} />}
              </button>
            )}
          </div>
        </div>

        {/* Thread Summary Card */}
        {msgs.length >= 2 && (threadSummary || summaryLoading || summaryError) && (
          <div className={cn("ea-thread-summary-card", { expanded: summaryExpanded })}>
            <div className="ea-summary-header" onClick={() => setSummaryExpanded(!summaryExpanded)}>
              <span className="ea-summary-title">
                <i className="pi pi-sparkles ea-sparkles-icon" style={{ marginRight: 6, color: '#4f46e5' }} />
                AI Conversation Summary
              </span>
              <div className="ea-summary-header-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="ea-summary-refresh-btn"
                  onClick={() => fetchThreadSummary(selectedMail._id, true)}
                  disabled={summaryLoading}
                  title="Regenerate summary"
                >
                  <i className={cn("pi pi-sync", { "pi-spin": summaryLoading })} />
                </button>
                <i
                  role="button"
                  tabIndex={0}
                  className={cn("ea-summary-toggle-icon pi", summaryExpanded ? "pi-chevron-up" : "pi-chevron-down")}
                  onClick={() => setSummaryExpanded(!summaryExpanded)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSummaryExpanded(!summaryExpanded); }}
                />
              </div>
            </div>
            {summaryExpanded && (
              <div className="ea-summary-content">
                {summaryLoading && !threadSummary ? (
                  <div className="ea-summary-loading">
                    <i className="pi pi-spin pi-spinner" style={{ marginRight: 6 }} />
                    <span>Analyzing thread & generating summary...</span>
                  </div>
                ) : summaryError && !threadSummary ? (
                  <div className="ea-summary-error">
                    <i className="pi pi-exclamation-triangle" style={{ marginRight: 6, color: '#ef4444' }} />
                    <span>{summaryError}</span>
                  </div>
                ) : (
                  <div className="ea-summary-text-wrapper">
                    <div dangerouslySetInnerHTML={{ __html: threadSummary }} />
                    {summaryLoading && (
                      <div className="ea-summary-updating-overlay">
                        <i className="pi pi-spin pi-spinner" style={{ marginRight: 6 }} />
                        <span>Updating summary...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="ea-thread">

          {msgs.map((msg, idx) => renderThreadMessage(
            msg,
            idx,
            msgs.length === 1 || expandedMsgs.has(msg.providerMessageId),
            msgs.length === 1,
          ))}
        </div>

        {/* Quick replies + AI draft reply — sticky footer, Gmail-style:
            stays visible while reading, settles into flow at the mail's end.
            Hidden for drafts (you don't reply to your own unsent mail). */}
        {!isDraftMail(selectedMail) && (
          <div className="ea-reply-section">
            {/* <QuickReplies sourceId={selectedMail.providerMessageId} /> */}
            <AiDraftReply
              key={selectedMail._id}
              mailId={selectedMail._id}
              sourceId={selectedMail.providerMessageId}
              mail={selectedMail}
            />
          </div>
        )}
      </div>
    );
  };

  /* -------------------- render: list pane -------------------- */
  const renderListPane = () => {
    if (loading) {
      return (
        <div className="ea-list-state">
          <i className="pi pi-spin pi-spinner" />
          <span>Loading emails…</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className="ea-list-state">
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </div>
      );
    }
    if (!mails.length) {
      return (
        <div className="ea-list-empty">
          <i className="pi pi-inbox" />
          <h3>{appliedSearch ? 'No emails match your search' : 'No emails yet'}</h3>
          <p>
            {appliedSearch
              ? 'Try a different keyword.'
              : 'Connect a Google or Outlook account and sync to start reading your inbox here.'}
          </p>
          {!appliedSearch && (
            <Button size="sm" variant="outline" onClick={() => navigate('/connectionsDelivery')}>
              <Link size={14} /> Go to Connections
            </Button>
          )}
        </div>
      );
    }
    return <div className="ea-list">{mails.map(renderListItem)}</div>;
  };

  /* -------------------- render: priority table (grouped by day) -------------------- */
  const renderPriorityTable = () => {
    if (loading) {
      return <div className="ea-list-state"><i className="pi pi-spin pi-spinner" /><span>Loading emails…</span></div>;
    }
    if (error) {
      return <div className="ea-list-state"><i className="pi pi-exclamation-triangle" /><span>{error}</span><Button size="sm" variant="outline" onClick={refresh}>Retry</Button></div>;
    }
    if (!mails.length) {
      return (
        <div className="ea-list-empty">
          <i className="pi pi-flag" />
          <h3>{appliedSearch ? 'No emails match your search' : 'No emails to prioritize'}</h3>
          <p>{appliedSearch ? 'Try a different keyword.' : 'Sync your inbox, then prioritize.'}</p>
        </div>
      );
    }
    return (
      <div className="ea-prio-wrap">
        <table className="ea-ptable">
          <thead>
            <tr>
              <th className="c-prio">Priority</th>
              <th className="c-from">From</th>
              <th className="c-subj">Subject</th>
              <th className="c-intent">Intent</th>
              <th className="c-time">Received</th>
            </tr>
          </thead>
          <tbody>
            {dayGroups.map((g) => (
              <Fragment key={g.key}>
                <tr className="ea-day-row">
                  <td colSpan={5}>{g.key === 'undated' ? 'Undated' : dayHeading(g.date)}<span className="ea-day-count">{g.items.length}</span></td>
                </tr>
                {g.items.map((mail) => {
                  const { name } = parseAddress(mail.from);
                  const meta = PRIORITY_META[mail.priority];
                  return (
                    <tr
                      key={mail._id}
                      className={cn('ea-prow', { selected: selectedId === mail._id })}
                      onClick={() => openMailPriority(mail)}
                    >
                      <td className="c-prio">
                        {meta ? (
                          <span className="ea-prio" style={{ color: meta.color }}>
                            {mail.priority}{Number.isFinite(mail.priorityScore) ? ` ${mail.priorityScore}` : ''}
                          </span>
                        ) : <span className="ea-prio-none">—</span>}
                      </td>
                      <td className="c-from" title={mail.from}>{name}</td>
                      <td className="c-subj">
                        <span className="ea-psubj">{mail.subject || '(no subject)'}</span>
                        {mail.hasAttachments && <i className="pi pi-paperclip ea-clip" />}
                        <span className="ea-psnip">{mail.snippet}</span>
                      </td>
                      <td className="c-intent">{mail.intent || '—'}</td>
                      <td className="c-time">{formatListTime(mail.receivedAt)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={cn('email-analysis-mails', `ea-provider-${provider}`, { 'reading-mobile': showReadingPaneMobile, 'priority-mode': viewMode === 'priority' })}>
      {/* Header */}
      <div className="ea-header">
        <div className="ea-title">
          <i className="pi pi-envelope fw-bold" />
          <span>{FOLDERS.find((f) => f.key === folder)?.label || 'Inbox'}</span>
        </div>
        <div className="ea-search">
          <span className="ea-search-field">
            <Sparkles size={15} className="ea-search-icon ea-ai-icon" aria-hidden="true" />
            <Input
              value={search}
              placeholder="Ask AI to search your mail…"
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runAiSearch();
                }
              }}
              className="ea-search-input ea-ai-search-input"
            />
            {search && (
              <button
                type="button"
                className="ea-clear ea-clear-ai"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <i className="pi pi-times" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className={cn('ea-mic', { listening })}
              onClick={toggleVoiceSearch}
              aria-label="Voice search"
              title="Search by voice"
            >
              <Mic size={16} />
            </button>
          </span>
        </div>
        <div className="ea-actions">
          <Tabs
            value={viewMode}
            onValueChange={(v) => { if (v) { setViewMode(v); setPriorityReading(false); } }}
            className="ea-viewtoggle"
          >
            <TabsList>
              {VIEW_OPTIONS.map((o) => (
                <TabsTrigger key={o.value} value={o.value}>
                  <i className={o.icon} style={{ marginRight: 4 }} />{o.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {viewMode === 'priority' && (
            <Button
              variant="outline"
              size="sm"
              className="ea-prioritize-btn"
              onClick={prioritizeNow}
              disabled={prioritizing}
              title="Re-score this inbox using the latest Knowledge Base"
            >
              <Flag size={14} />
              <span>Prioritize</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ea-cleanup-btn"
            onClick={openCleanup}
            title="Remove junk, promotional & low-priority mail"
          >
            <Trash2 size={14} />
            <span>Clean up</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={15} />
          </Button>
          <Button
            size="sm"
            className="ea-sync-btn"
            onClick={onSyncNow}
            disabled={syncing}
          >
            {syncing ? <i className="pi pi-spin pi-spinner" style={{ marginRight: 4 }} /> : null}
            Sync
          </Button>
          <Button
            size="sm"
            id="auto-sync-toggle-btn"
            className={`ea-autosync-btn ${autoSync ? 'active' : ''}`}
            onClick={onToggleAutoSync}
            disabled={autoSyncLoading}
            title={autoSync
              ? `Auto-sync is ON — inbox refreshes every ${formatInterval()}. Click to pause.`
              : 'Auto-sync is OFF — only manual Sync runs. Click to enable.'}
          >
            <RefreshCw size={13} className={autoSync ? 'ea-spin-slow' : ''} />
            Auto {autoSync ? 'ON' : 'OFF'}
          </Button>
        </div>

      </div>

      {/* Auto-sync active indicator — sits just below the header */}
      {autoSync && (
        <div className="ea-autosync-hint">
          <i className="pi pi-check-circle" /> Auto-sync active &mdash; inbox refreshes every {formatInterval()}
        </div>
      )}

      {/* Sub-toolbar: date filter + Gmail-style pager */}
      <div className="ea-subbar">
        <div className="ea-subbar-left">
          {/* Provider folders — styled like Outlook or Gmail per the connected account */}
          <div className="ea-folderbar" role="tablist" aria-label="Mail folders">
            {FOLDERS.map(({ key, label, Icon }) => (
              <button
                type="button"
                key={key}
                role="tab"
                aria-selected={folder === key}
                className={cn('ea-folder-btn', { active: folder === key })}
                onClick={() => selectFolder(key)}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* AI category filter — inbox only */}
          {folder === 'inbox' && (
            <Dropdown
              value={category || ALL_CATEGORIES}
              options={categoryOptions}
              onChange={(e) => selectCategory(e.value === ALL_CATEGORIES ? '' : e.value)}
              className={cn('ea-cat-dd', { active: !!category })}
              panelClassName="ea-cat-dd-panel"
              aria-label="Filter by category"
              valueTemplate={(option) => (
                <span className="ea-cat-dd-value">
                  <Tag size={13} />
                  {option ? option.label : 'All categories'}
                </span>
              )}
            />
          )}

          <button
            type="button"
            className={cn('ea-datefilter-btn', { active: hasDateFilter })}
            onClick={openDateDialog}
            title="Filter by received date"
          >
            <CalendarDays size={14} />
            <span>{hasDateFilter ? dateChipLabel : 'Filter by date'}</span>
          </button>
          {hasDateFilter && (
            <button
              type="button"
              className="ea-datefilter-clear"
              onClick={clearDateFilter}
              title="Clear date filter"
              aria-label="Clear date filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="ea-pager">
          <span className="ea-count">{rangeLabel}</span>
          <button
            type="button"
            className="ea-page-btn"
            onClick={goPrev}
            disabled={!canPrev || loading}
            title="Newer"
            aria-label="Newer emails"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="ea-page-btn"
            onClick={goNext}
            disabled={!canNext || loading}
            title="Older"
            aria-label="Older emails"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Body: split view (inbox) or full-width priority table */}
      {viewMode === 'inbox' ? (
        <div className="ea-body">
          <div className="ea-list-pane">{renderListPane()}</div>
          <div className="ea-reader-pane">{renderReadingPane()}</div>
        </div>
      ) : (
        <div className="ea-prio-body">
          {/* Gmail-style: clicking a row replaces the table with the full mail in-screen */}
          {priorityReading ? renderReadingPane() : renderPriorityTable()}
        </div>
      )}

      {/* Date-range filter popup */}
      <Dialog open={dateDialog} onOpenChange={(o) => !o && setDateDialog(false)}>
        <DialogContent className="ea-date-dialog max-w-[400px] w-[92vw]">
          <div className="ea-date-head">
            <span className="ea-date-ic"><CalendarDays size={18} /></span>
            <div>
              <h2>Filter by date</h2>
              <p>Show only mail received in this range.</p>
            </div>
          </div>

          <div className="ea-date-presets">
            {DATE_PRESETS.map((p) => (
              <button key={p.label} type="button" className="ea-date-preset" onClick={() => usePreset(p)}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="ea-date-fields">
            <label className="ea-date-field">
              <span>From</span>
              <input
                type="date"
                value={draftRange.from}
                max={draftRange.to || moment().format('YYYY-MM-DD')}
                onChange={(e) => setDraftRange(r => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label className="ea-date-field">
              <span>To</span>
              <input
                type="date"
                value={draftRange.to}
                min={draftRange.from || undefined}
                max={moment().format('YYYY-MM-DD')}
                onChange={(e) => setDraftRange(r => ({ ...r, to: e.target.value }))}
              />
            </label>
          </div>

          <div className="ea-date-foot">
            <button type="button" className="ea-date-clear" onClick={clearDateFilter}>
              Clear
            </button>
            <button
              type="button"
              className="ea-date-apply"
              disabled={!draftRange.from && !draftRange.to}
              onClick={applyDateFilter}
            >
              Apply
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-click cleanup */}
      <Dialog
        open={cleanup.visible}
        onOpenChange={(o) => { if (!o && !cleanup.removing) setCleanup(c => ({ ...c, visible: false })); }}
      >
        <DialogContent className="ea-clean-dialog max-w-[460px] w-[94vw]">

          <div className="ea-clean-head">
            <span className="ea-clean-ic"><i className="pi pi-sparkles" /></span>
            <div>
              <h2>Clean up inbox</h2>
              <p>Remove low-value mail after analysis. This only hides it from here — your Gmail is untouched.</p>
            </div>
          </div>

          <div className="ea-clean-cats">
            {CLEANUP_CATS.map((cat) => {
              const n = cleanup.counts ? (cleanup.counts[cat.key] || 0) : 0;
              const on = !!cleanup.sel[cat.key];
              const disabled = !cleanup.loading && n === 0;
              return (
                <button
                  type="button"
                  key={cat.key}
                  className={cn('ea-clean-card', { on: on && !disabled, disabled })}
                  onClick={() => !disabled && toggleCleanup(cat.key)}
                  disabled={disabled}
                >
                  <span className="ea-clean-card-ic" style={{ color: cat.color, background: `${cat.color}1a` }}>
                    <i className={cat.icon} />
                  </span>
                  <span className="ea-clean-card-text">
                    <span className="t">{cat.title}</span>
                    <span className="d">{cat.desc}</span>
                  </span>
                  <span className="ea-clean-card-n">{cleanup.loading ? '…' : n}</span>
                  <span className={cn('ea-clean-check', { on: on && !disabled })}>
                    {on && !disabled && <i className="pi pi-check" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="ea-clean-foot">
            <button
              type="button"
              className="ea-clean-cancel"
              disabled={cleanup.removing}
              onClick={() => setCleanup(c => ({ ...c, visible: false }))}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ea-clean-remove"
              disabled={cleanup.removing || cleanup.loading || !Object.values(cleanup.sel).some(Boolean) || selectedCleanupTotal === 0}
              onClick={doCleanup}
            >
              {cleanup.removing
                ? (<><i className="pi pi-spin pi-spinner" /> Removing…</>)
                : (<><i className="pi pi-trash" /> Remove{selectedCleanupTotal ? ` ${selectedCleanupTotal}` : ''}</>)}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailAnalysisMails;
