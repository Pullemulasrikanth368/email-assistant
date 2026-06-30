import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenLine, Trash2, Send, RefreshCw, Mail, Clock, Paperclip, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import fetchMethodRequest from '@/config/service';
import { cn } from '@/lib/utils';
import ComposeDraft from './ComposeDraft';
import './Drafts.scss';

const PAGE_LIMIT = 20;

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SyncBadge({ status }) {
  if (status === 'synced') return <span className="sync-badge sync-badge--synced"><CheckCircle2 size={10} /> Synced</span>;
  if (status === 'failed') return <span className="sync-badge sync-badge--failed"><AlertCircle size={10} /> Sync failed</span>;
  return <span className="sync-badge sync-badge--pending"><Loader2 size={10} className="animate-spin" /> Pending</span>;
}

function ProviderBadge({ provider }) {
  return (
    <Badge variant="outline" className={cn('provider-badge', `provider-badge--${provider}`)}>
      {provider === 'gmail' ? 'Gmail' : 'Outlook'}
    </Badge>
  );
}

export default function Drafts() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sending, setSending] = useState(null);

  const getLoginUser = () => {
    try { return JSON.parse(localStorage.getItem('loginCredentials')) || {}; } catch { return {}; }
  };

  const fetchDrafts = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const user = getLoginUser();
      const params = new URLSearchParams({ page: pg, limit: PAGE_LIMIT });
      if (user.email) params.append('loginUserEmailId', user.email);
      const res = await fetchMethodRequest('GET', `email-analysis/drafts?${params.toString()}`);
      if (res?.respCode === 200) {
        setDrafts(res.drafts || []);
        setTotal(res.total || 0);
        setPage(res.page || pg);
        setPages(res.pages || 1);
      } else {
        setError(res?.errorMessage || 'Failed to load drafts');
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrafts(1); }, [fetchDrafts]);

  const handleEdit = (draft) => {
    setEditingDraft(draft);
    setComposing(true);
  };

  const handleNewDraft = () => {
    setEditingDraft(null);
    setComposing(true);
  };

  const handleComposeClose = (refresh) => {
    setComposing(false);
    setEditingDraft(null);
    if (refresh) fetchDrafts(page);
  };

  const handleDelete = async (draft) => {
    if (!window.confirm(`Delete draft "${draft.subject || '(no subject)'}"?`)) return;
    setDeleting(draft._id);
    try {
      const res = await fetchMethodRequest('DELETE', `email-analysis/drafts/${draft._id}`);
      if (res?.respCode === 200) {
        setDrafts(prev => prev.filter(d => d._id !== draft._id));
        setTotal(prev => Math.max(0, prev - 1));
      } else {
        alert(res?.errorMessage || 'Delete failed');
      }
    } catch {
      alert('Could not reach server');
    } finally {
      setDeleting(null);
    }
  };

  const handleSend = async (draft) => {
    if (!draft.to?.length) {
      alert('Please add at least one recipient before sending.');
      handleEdit(draft);
      return;
    }
    if (!window.confirm(`Send draft "${draft.subject || '(no subject)'}" now?`)) return;
    setSending(draft._id);
    try {
      const res = await fetchMethodRequest('POST', `email-analysis/drafts/${draft._id}/send`);
      if (res?.respCode === 200) {
        setDrafts(prev => prev.filter(d => d._id !== draft._id));
        setTotal(prev => Math.max(0, prev - 1));
      } else {
        alert(res?.errorMessage || 'Send failed');
      }
    } catch {
      alert('Could not reach server');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="drafts-page">
      {/* Header */}
      <div className="drafts-header">
        <div className="drafts-header__left">
          <h1 className="drafts-header__title">
            <Mail size={20} />
            Drafts
            {total > 0 && <span className="drafts-header__count">{total}</span>}
          </h1>
        </div>
        <div className="drafts-header__actions">
          <Button variant="outline" size="sm" onClick={() => fetchDrafts(page)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleNewDraft}>
            <PenLine size={14} />
            Compose
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="drafts-error">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && drafts.length === 0 && (
        <div className="drafts-list">
          {[1, 2, 3].map(i => (
            <div key={i} className="draft-item draft-item--skeleton">
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line skeleton--short" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && drafts.length === 0 && !error && (
        <div className="drafts-empty">
          <PenLine size={40} className="drafts-empty__icon" />
          <p className="drafts-empty__title">No drafts yet</p>
          <p className="drafts-empty__sub">Compose a new draft to get started.</p>
          <Button onClick={handleNewDraft} className="mt-4">
            <PenLine size={14} />
            Compose Draft
          </Button>
        </div>
      )}

      {/* Draft list */}
      {drafts.length > 0 && (
        <div className="drafts-list">
          {drafts.map(draft => (
            <div key={draft._id} className="draft-item">
              <div className="draft-item__main" onClick={() => handleEdit(draft)}>
                <div className="draft-item__row1">
                  <span className="draft-item__subject">
                    {draft.subject || <em className="text-slate-400">(no subject)</em>}
                  </span>
                  <div className="draft-item__badges">
                    <ProviderBadge provider={draft.provider} />
                    {draft.status === 'failed' && (
                      <Badge variant="destructive" className="text-[10px]">Send failed</Badge>
                    )}
                    <SyncBadge status={draft.syncStatus} />
                  </div>
                </div>

                <div className="draft-item__row2">
                  <span className="draft-item__to">
                    {draft.to?.length > 0
                      ? `To: ${draft.to.slice(0, 2).join(', ')}${draft.to.length > 2 ? ` +${draft.to.length - 2}` : ''}`
                      : <span className="text-slate-400">No recipients</span>}
                  </span>
                  <div className="draft-item__meta">
                    {draft.attachments?.length > 0 && (
                      <span className="draft-item__att">
                        <Paperclip size={11} />
                        {draft.attachments.length}
                      </span>
                    )}
                    <span className="draft-item__time">
                      <Clock size={11} />
                      {formatDate(draft.updatedAt)}
                    </span>
                  </div>
                </div>

                {draft.syncError && (
                  <div className="draft-item__sync-error">
                    <AlertCircle size={11} />
                    {draft.syncError}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="draft-item__actions">
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-blue-500 hover:bg-blue-50"
                  title="Edit draft"
                  onClick={() => handleEdit(draft)}
                >
                  <PenLine size={14} />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-green-600 hover:bg-green-50"
                  title="Send draft"
                  disabled={sending === draft._id}
                  onClick={() => handleSend(draft)}
                >
                  {sending === draft._id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Send size={14} />}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-red-500 hover:bg-red-50"
                  title="Delete draft"
                  disabled={deleting === draft._id}
                  onClick={() => handleDelete(draft)}
                >
                  {deleting === draft._id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="drafts-pagination">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => fetchDrafts(page - 1)}>
            Previous
          </Button>
          <span className="drafts-pagination__info">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => fetchDrafts(page + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Compose / Edit modal */}
      {composing && (
        <ComposeDraft
          draft={editingDraft}
          onClose={handleComposeClose}
        />
      )}
    </div>
  );
}
