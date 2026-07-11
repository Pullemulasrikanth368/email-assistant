import { useEffect, useRef, useState } from 'react';
import { FileText, CheckCircle2, XCircle, HelpCircle, Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import DraftEditor, { isEmptyHtml, textToHtml } from '../DraftEditor';
import { fetchDetailedReply, fetchCustomReply } from './replyStudio.service';
import ReplyActions from './ReplyActions';

const TYPE_OPTIONS = [
  { value: 'yes', label: 'Yes', Icon: CheckCircle2, className: 'rs-type--yes' },
  { value: 'no', label: 'No', Icon: XCircle, className: 'rs-type--no' },
  { value: 'maybe', label: 'Maybe', Icon: HelpCircle, className: 'rs-type--maybe' },
];

const QUICK_PROMPTS = [
  'Accept the request professionally',
  'Decline politely',
  'Ask for more information',
  'Confirm the meeting',
  'Request a deadline extension',
  'Send a follow-up',
  'Escalate the issue',
];

const TONES = ['Professional', 'Friendly', 'Formal', 'Concise', 'Apologetic', 'Persuasive'];
const LENGTHS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];
const LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'auto', label: 'Auto-detect' },
];

const AUTOSAVE_DELAY_MS = 1200;

const htmlToText = (html = '') => String(html)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>\s*<p>/gi, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .trim();

/**
 * "Detailed Reply" card — the single reply workspace of the studio, with two
 * modes switched from the header:
 *
 *   Detailed  — pick Yes / No / Maybe; a thread-aware reply is generated once
 *               per type and then remembered (switching types or coming back
 *               never regenerates — it just shows what's already there).
 *   Custom AI — describe the reply (tone / length / language) and generate.
 *               The result lives in its own slot, so flipping between Custom
 *               and Detailed shows each mode's content, never overwrites it.
 *
 * Whatever is currently in the editor is mirrored to ONE real draft (created
 * on the first save, then updated in place — never a second draft) via
 * `onAutosave`, debounced while typing and flushed on unmount.
 *
 * @param mailId       EmailAnalysisMail._id
 * @param typeLabels   { yes, no, maybe } contextual option labels from the
 *                     quick-reply generation (e.g. Accept / Reject / Tentative)
 * @param initialDraft stored draft for this mail (auto-created earlier);
 *                     when present it seeds the editor instead of generating
 * @param onAutosave   (html) => Promise<boolean> — parent creates/updates the
 *                     single draft; resolves false on failure
 * @param onSend       (html, label) => void — parent confirms + sends
 * @param sending      true while the parent is sending this card's reply
 */
const DetailedReplySection = ({ mailId, typeLabels = {}, initialDraft, onAutosave, onSend, sending = false }) => {
  const [mode, setMode] = useState('detailed'); // 'detailed' | 'custom'
  const [replyType, setReplyType] = useState('');
  // Per-slot editor content — yes/no/maybe for Detailed, plus the Custom AI
  // result. Preserved across every switch so nothing is lost or regenerated.
  const [drafts, setDrafts] = useState({ yes: '', no: '', maybe: '', custom: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState(''); // '' | saving | saved | failed

  // Custom AI controls.
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [language, setLanguage] = useState('english');
  const [customizing, setCustomizing] = useState(false);

  const activeKey = mode === 'custom' ? 'custom' : replyType;
  const html = activeKey ? drafts[activeKey] : '';
  const empty = isEmptyHtml(html);
  const busy = loading || customizing || sending;

  // Refs mirror the latest values so the debounced save / unmount flush never
  // see stale state.
  const htmlRef = useRef('');
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  htmlRef.current = html;

  const persist = async (value) => {
    if (isEmptyHtml(value)) return;
    setSaveState('saving');
    const ok = await onAutosave(value);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) dirtyRef.current = false;
  };

  const scheduleSave = () => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(htmlRef.current), AUTOSAVE_DELAY_MS);
  };

  // Flush pending edits when the card unmounts (user opens another mail or
  // leaves the screen) — the draft is saved, not lost.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirtyRef.current && !isEmptyHtml(htmlRef.current)) onAutosave(htmlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailId]);

  const generate = async (type, force = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchDetailedReply(mailId, type, force);
      if (res?.respCode === 200 && res.reply) {
        const value = textToHtml(res.reply);
        setDrafts((d) => ({ ...d, [type]: value }));
        htmlRef.current = value;
        scheduleSave();
      } else {
        setError(res?.errorMessage || 'Could not generate the reply.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  // When the mail opens: resume its existing draft if there is one, otherwise
  // generate the "yes" reply up front — the user just edits it or switches.
  useEffect(() => {
    if (!mailId) return;
    setError('');
    setSaveState('');
    dirtyRef.current = false;
    setMode('detailed');
    setPrompt('');
    const saved = initialDraft?.body && !isEmptyHtml(initialDraft.body) ? initialDraft.body : '';
    setDrafts({ yes: saved, no: '', maybe: '', custom: '' });
    setReplyType('yes');
    if (saved) setSaveState('saved');
    else generate('yes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailId]);

  // The draft mirrors the editor — switching what's shown re-syncs it.
  const showSlot = (key) => {
    if (!isEmptyHtml(drafts[key])) {
      htmlRef.current = drafts[key];
      scheduleSave();
    }
  };

  const onPickMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setError('');
    showSlot(next === 'custom' ? 'custom' : replyType);
  };

  const onPickType = (type) => {
    setReplyType(type);
    setError('');
    // A type is generated once and then remembered — only generate when empty.
    if (isEmptyHtml(drafts[type])) generate(type);
    else showSlot(type);
  };

  const generateCustom = async () => {
    if (!prompt.trim()) {
      showToasterMessage('Describe the reply you need first', 'warning');
      return;
    }
    setCustomizing(true);
    setError('');
    try {
      const res = await fetchCustomReply(mailId, { prompt: prompt.trim(), tone, length, language });
      if (res?.respCode === 200 && res.reply) {
        const value = textToHtml(res.reply);
        setDrafts((d) => ({ ...d, custom: value }));
        htmlRef.current = value;
        scheduleSave();
        showToasterMessage('Custom reply generated', 'success');
      } else {
        setError(res?.errorMessage || 'Could not generate the reply.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCustomizing(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(htmlToText(html));
      showToasterMessage('Reply copied to clipboard', 'success');
    } catch {
      showToasterMessage('Could not copy to clipboard', 'error');
    }
  };

  const regenerate = () => {
    if (mode === 'custom') generateCustom();
    else generate(replyType, true);
  };

  if (!mailId) return null;

  const generatingNow = loading || customizing;
  const showEditor = mode === 'custom' ? !isEmptyHtml(drafts.custom) : !!replyType;

  return (
    <section className="rs-card" aria-label="Detailed reply">
      <div className="rs-card-head">
        <span className="rs-card-icon"><FileText size={14} /></span>
        <h4 className="rs-card-title">Detailed Reply</h4>
        <span className="rs-card-sub">A full reply written from the whole thread</span>

        <div className="rs-type-pick">
          <div className="rs-mode-switch" role="tablist" aria-label="Reply mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'detailed'}
              className={`rs-mode-btn${mode === 'detailed' ? ' active' : ''}`}
              onClick={() => onPickMode('detailed')}
              disabled={busy}
              title="Thread-aware reply by type (Yes / No / Maybe)"
            >
              <FileText size={13} /> Detailed
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'custom'}
              className={`rs-mode-btn${mode === 'custom' ? ' active' : ''}`}
              onClick={() => onPickMode('custom')}
              disabled={busy}
              title="Generate the reply from your own instructions"
            >
              <Sparkles size={13} /> Custom AI
            </button>
          </div>

          {mode === 'detailed' && (
            <Select value={replyType} onValueChange={onPickType} disabled={busy}>
              <SelectTrigger className="rs-select" aria-label="Select reply type">
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
          )}
        </div>
      </div>

      {mode === 'custom' && (
        <div className="rs-custom-panel" aria-label="Custom AI reply controls">
          <textarea
            className="rs-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            rows={3}
            aria-label="Describe the reply you need"
            placeholder="Example: Write a professional reply confirming the meeting and request the agenda before the call."
          />

          <div className="rs-chips" role="group" aria-label="Quick prompt suggestions">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                className={`rs-chip${prompt === p ? ' active' : ''}`}
                onClick={() => setPrompt(p)}
                disabled={busy}
                title={`Use prompt: ${p}`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="rs-controls">
            <span className="rs-control">
              <label className="rs-field-label" htmlFor="rs-tone">Tone</label>
              <Select value={tone} onValueChange={setTone} disabled={busy}>
                <SelectTrigger id="rs-tone" className="rs-select" aria-label="Tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t.toLowerCase()}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>

            <span className="rs-control">
              <label className="rs-field-label" htmlFor="rs-length">Reply length</label>
              <Select value={length} onValueChange={setLength} disabled={busy}>
                <SelectTrigger id="rs-length" className="rs-select" aria-label="Reply length">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LENGTHS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </span>

            <span className="rs-control">
              <label className="rs-field-label" htmlFor="rs-language">Language</label>
              <Select value={language} onValueChange={setLanguage} disabled={busy}>
                <SelectTrigger id="rs-language" className="rs-select" aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </span>

            <button
              type="button"
              className="rs-generate-btn"
              onClick={generateCustom}
              disabled={busy || !prompt.trim()}
              title={isEmptyHtml(drafts.custom)
                ? 'Generate a reply from your description'
                : 'Generate again — replaces the current custom reply'}
            >
              {customizing
                ? <><i className="pi pi-spin pi-spinner" /> Generating…</>
                : <><Sparkles size={14} /> {isEmptyHtml(drafts.custom) ? 'Generate Reply' : 'Regenerate'}</>}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rs-error">
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          <button type="button" className="rs-btn" onClick={regenerate}>
            <i className="pi pi-refresh" /> Retry
          </button>
        </div>
      )}

      {!error && generatingNow && (
        <div className="rs-skeleton rs-skeleton--tall" aria-label="Generating reply" aria-busy="true">
          <span /><span /><span /><span /><span className="short" />
        </div>
      )}

      {!error && !generatingNow && mode === 'custom' && !showEditor && (
        <div className="rs-placeholder">
          Describe the reply above and hit Generate — the result appears here, ready to edit and send.
        </div>
      )}

      {!error && !generatingNow && showEditor && (
        <>
          <DraftEditor
            value={html}
            onChange={(v) => {
              setDrafts((d) => ({ ...d, [activeKey]: v }));
              htmlRef.current = v;
              scheduleSave();
            }}
            disabled={busy}
            placeholder="Generated reply will appear here…"
            contextMailId={mailId}
          />
          <div className="rs-draft-foot">
            <span className={`rs-savestate rs-savestate--${saveState || 'idle'}`} role="status">
              {saveState === 'saving' && (<><i className="pi pi-spin pi-spinner" /> Saving draft…</>)}
              {saveState === 'saved' && (<><i className="pi pi-check" /> Saved to Drafts</>)}
              {saveState === 'failed' && (<><i className="pi pi-exclamation-triangle" /> Draft not saved</>)}
            </span>
            <ReplyActions
              onRegenerate={regenerate}
              onCopy={copy}
              onSend={() => onSend(html, mode === 'custom' ? 'detailed custom' : `detailed ${replyType}`)}
              busy={busy}
              regenerating={generatingNow}
              sending={sending}
              sendDisabled={empty}
            />
          </div>
        </>
      )}
    </section>
  );
};

export default DetailedReplySection;
