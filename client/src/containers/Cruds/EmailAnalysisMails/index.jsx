import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Paginator } from 'primereact/paginator';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { RefreshCw, Trash2, Flag, Link } from 'lucide-react';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import QuickReplies from '../CommonComponents/QuickReplies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// Rank used to sort highest -> lowest priority within a day.
const sortValue = (m) =>
  (Number.isFinite(m.priorityScore) ? m.priorityScore : 0) + (PRIORITY_RANK[m.priority] || 0) * 0.001;

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

  const srcDoc = useMemo(() => {
    const raw = (body || snippet || '').trim();
    if (!raw) {
      return wrapFragment('<p class="ea-empty-body">This message has no content.</p>');
    }
    if (!looksLikeHtml(raw)) {
      return wrapFragment(`<pre class="ea-plain">${escapeHtml(raw)}</pre>`);
    }
    // WHOLE_DOCUMENT keeps <head><style> blocks (otherwise head CSS is dropped
    // and emails like Google Alerts render unstyled). The iframe is sandboxed
    // (no allow-scripts) so sanitised markup still cannot execute.
    const clean = DOMPurify.sanitize(raw, {
      WHOLE_DOCUMENT: true,
      ADD_ATTR: ['target'],
    });
    return injectIntoDocument(clean);
  }, [body, snippet]);

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
    <iframe
      ref={frameRef}
      title="email-body"
      className="ea-mail-frame"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      srcDoc={srcDoc}
      onLoad={handleLoad}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Main screen                                                        */
/* ------------------------------------------------------------------ */
const EmailAnalysisMails = () => {
  const navigate = useNavigate();

  const [mails, setMails] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [selectedMail, setSelectedMail] = useState(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState(null);
  const [readIds, setReadIds] = useState(() => new Set());
  const [syncing, setSyncing] = useState(false);
  const [showReadingPaneMobile, setShowReadingPaneMobile] = useState(false);

  // One-click cleanup (remove junk / promotional / low-priority mail).
  const [cleanup, setCleanup] = useState({
    visible: false, loading: false, counts: null, removing: false,
    sel: { junk: true, promotional: true, low: false },
  });

  // 'inbox' = normal split view, 'priority' = grouped priority table
  const [viewMode, setViewMode] = useState('inbox');
  const [mailDialog, setMailDialog] = useState(false); // mail viewer in priority mode
  const [prioritizing, setPrioritizing] = useState(false);

  const searchDebounce = useRef(null);

  /* -------------------- data fetching -------------------- */
  const fetchMails = useCallback(async (page, limit, searchTerm) => {
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
  }, []);

  useEffect(() => {
    const page = Math.floor(first / rows) + 1;
    fetchMails(page, rows, appliedSearch);
  }, [first, rows, appliedSearch, fetchMails]);

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

  /* -------------------- open a mail -------------------- */
  const openMail = useCallback(async (mail) => {
    setSelectedId(mail._id);
    setShowReadingPaneMobile(true);
    setReadIds(prev => new Set(prev).add(mail._id));
    setMailLoading(true);
    setMailError(null);
    setSelectedMail(null);
    try {
      const res = await fetchMethodRequest('GET', `email-analysis/mails/${mail._id}`);
      if (res?.mail) {
        setSelectedMail(res.mail);
      } else {
        setMailError('This email could not be found.');
      }
    } catch {
      setMailError('Could not open this email. Please try again.');
    } finally {
      setMailLoading(false);
    }
  }, []);

  /* -------------------- sync now -------------------- */
  const onSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetchMethodRequest('POST', 'auth/google/email-analysis/sync', {});
      if (res?.respCode) {
        showToasterMessage(
          res?.result?.saved ? `Synced ${res.result.saved} new email(s)` : 'Inbox is up to date',
          'success'
        );
        setFirst(0);
        fetchMails(1, rows, appliedSearch);
      } else {
        showToasterMessage(res?.errorMessage || 'No connected account to sync', 'warning');
      }
    } catch {
      showToasterMessage('Sync failed. Please try again.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const refresh = () => {
    const page = Math.floor(first / rows) + 1;
    fetchMails(page, rows, appliedSearch);
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
        fetchMails(1, rows, appliedSearch);
      } else {
        setCleanup(c => ({ ...c, removing: false }));
        showToasterMessage(res?.errorMessage || 'Could not clean up', 'error');
      }
    } catch {
      setCleanup(c => ({ ...c, removing: false }));
      showToasterMessage('Cleanup failed. Please try again.', 'error');
    }
  };

  const onPageChange = (e) => {
    setFirst(e.first);
    setRows(e.rows);
  };

  const rangeLabel = useMemo(() => {
    if (!totalRecords) return '0';
    const start = first + 1;
    const end = Math.min(first + rows, totalRecords);
    return `${start}–${end} of ${totalRecords}`;
  }, [first, rows, totalRecords]);

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
      const res = await fetchMethodRequest('POST', 'email-analysis/mails/prioritize', {});
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

  const openMailPriority = (mail) => { openMail(mail); setMailDialog(true); };

  /* -------------------- render: list item -------------------- */
  const renderListItem = (mail) => {
    const { name } = parseAddress(mail.from);
    const isRead = readIds.has(mail._id) || !(mail.labels || []).includes('UNREAD');
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
        <span className="ea-avatar" style={{ backgroundColor: colorFor(name) }}>
          {initialOf(name)}
        </span>
        <div className="ea-row-main">
          <div className="ea-row-top">
            <span className="ea-sender" title={mail.from}>{name}</span>
            <span className="ea-time">{formatListTime(mail.receivedAt)}</span>
          </div>
          <div className="ea-row-bottom">
            {mail.priority && PRIORITY_META[mail.priority] && (
              <span
                className="ea-prio"
                style={{ color: PRIORITY_META[mail.priority].color }}
                title={mail.intent ? `${mail.priority} · ${mail.intent}${mail.priorityReason ? ` — ${mail.priorityReason}` : ''}` : mail.priority}
              >
                {mail.priority}
              </span>
            )}
            <span className="ea-subject">{mail.subject || '(no subject)'}</span>
            {mail.hasAttachments && <i className="pi pi-paperclip ea-clip" />}
          </div>
          <div className="ea-snippet">{mail.snippet}</div>
        </div>
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

    const from = parseAddress(selectedMail.from);
    const to = parseAddress(selectedMail.to);
    const attachments = selectedMail.attachments || [];

    return (
      <div className="ea-reader">
        <div className="ea-reader-toolbar">
          <Button
            icon="pi pi-arrow-left"
            className="ea-back-btn p-button-text"
            onClick={() => setShowReadingPaneMobile(false)}
            aria-label="Back"
          />
          <h2 className="ea-reader-subject">{selectedMail.subject || '(no subject)'}</h2>
        </div>

        <div className="ea-reader-meta">
          <span className="ea-avatar lg" style={{ backgroundColor: colorFor(from.name) }}>
            {initialOf(from.name)}
          </span>
          <div className="ea-meta-text">
            <div className="ea-meta-line">
              <span className="ea-from-name">{from.name}</span>
              {from.email && <span className="ea-from-email">&lt;{from.email}&gt;</span>}
            </div>
            <div className="ea-meta-sub">
              to {to.name || to.email || 'me'}
              {(selectedMail.cc || []).length > 0 && `, cc: ${selectedMail.cc.join(', ')}`}
            </div>
          </div>
          <div className="ea-meta-date">{formatFullDate(selectedMail.receivedAt)}</div>
        </div>

        <MailBody body={selectedMail.body} snippet={selectedMail.snippet} />

        {/* One-click quick replies (AI-suggested, sent on the thread) */}
        <QuickReplies sourceId={selectedMail.providerMessageId} />

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
              : 'Connect a Google account and sync to start reading your inbox here.'}
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
    <div className={cn('email-analysis-mails', { 'reading-mobile': showReadingPaneMobile, 'priority-mode': viewMode === 'priority' })}>
      {/* Header */}
      <div className="ea-header">
        <div className="ea-title">
          <i className="pi pi-envelope fw-bold" />
          <span>Inbox</span>
        </div>
        <div className="ea-search">
          <span className="ea-search-field">
            <i className="pi pi-search ea-search-icon" aria-hidden="true" />
            <Input
              value={search}
              placeholder="Search mail"
              onChange={(e) => onSearchChange(e.target.value)}
              className="ea-search-input"
            />
            {search && (
              <button
                type="button"
                className="ea-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <i className="pi pi-times" aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        <div className="ea-actions">
          <Tabs value={viewMode} onValueChange={(v) => v && setViewMode(v)} className="ea-viewtoggle">
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
              title="Re-score this inbox by intent"
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
        </div>

      </div>

      {/* Sub-toolbar: count + paginator */}
      <div className="ea-subbar">
        <span className="ea-count">{rangeLabel}</span>
        <Paginator
          first={first}
          rows={rows}
          totalRecords={totalRecords}
          rowsPerPageOptions={[25, 50, 100]}
          template="FirstPageLink PrevPageLink NextPageLink LastPageLink RowsPerPageDropdown"
          onPageChange={onPageChange}
          className="ea-paginator"
        />
      </div>

      {/* Body: split view (inbox) or full-width priority table */}
      {viewMode === 'inbox' ? (
        <div className="ea-body">
          <div className="ea-list-pane">{renderListPane()}</div>
          <div className="ea-reader-pane">{renderReadingPane()}</div>
        </div>
      ) : (
        <div className="ea-prio-body">{renderPriorityTable()}</div>
      )}

      {/* Mail viewer for priority mode (no side reading pane there) */}
      <Dialog open={mailDialog} onOpenChange={(o) => !o && setMailDialog(false)}>
        <DialogContent className="ea-dialog-content max-w-[720px] w-[96vw]">
          {renderReadingPane()}
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
