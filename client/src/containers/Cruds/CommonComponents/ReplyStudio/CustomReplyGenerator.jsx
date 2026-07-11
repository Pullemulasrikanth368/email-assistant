import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import showToasterMessage from '../../../UI/ToasterMessage/toasterMessage';
import DraftEditor, { isEmptyHtml, textToHtml } from '../DraftEditor';
import { fetchCustomReply } from './replyStudio.service';
import ReplyActions from './ReplyActions';

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

const htmlToText = (html = '') => String(html)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>\s*<p>/gi, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .trim();

/**
 * "Generate Custom Reply" card — describe the reply you need (or pick a quick
 * prompt), optionally set tone / length / language, and generate. The result
 * lands in a rich-text editor with the standard action row.
 */
const CustomReplyGenerator = ({ mailId, onInsert, onSend, onSaveDraft, sending = false }) => {
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [language, setLanguage] = useState('english');
  const [html, setHtml] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const empty = isEmptyHtml(html);
  const busy = generating || saving || sending;

  const generate = async () => {
    if (!prompt.trim()) {
      showToasterMessage('Describe the reply you need first', 'warning');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const res = await fetchCustomReply(mailId, { prompt: prompt.trim(), tone, length, language });
      if (res?.respCode === 200 && res.reply) {
        setHtml(textToHtml(res.reply));
        showToasterMessage('Custom reply generated', 'success');
      } else {
        setError(res?.errorMessage || 'Could not generate the reply.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setGenerating(false);
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
    <section className="rs-card" aria-label="Generate custom reply">
      <div className="rs-card-head">
        <span className="rs-card-icon"><Sparkles size={14} /></span>
        <h4 className="rs-card-title">Generate Custom Reply</h4>
        <span className="rs-card-sub">Describe the response you need — AI writes it</span>
      </div>

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
          onClick={generate}
          disabled={busy || !prompt.trim()}
          title="Generate a reply from your description"
        >
          {generating
            ? <><i className="pi pi-spin pi-spinner" /> Generating…</>
            : <><Sparkles size={14} /> Generate Reply</>}
        </button>
      </div>

      {error && (
        <div className="rs-error">
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          <button type="button" className="rs-btn" onClick={generate}>
            <i className="pi pi-refresh" /> Retry
          </button>
        </div>
      )}

      {generating && (
        <div className="rs-skeleton rs-skeleton--tall" aria-label="Generating custom reply" aria-busy="true">
          <span /><span /><span /><span className="short" />
        </div>
      )}

      {!generating && !empty && (
        <>
          <DraftEditor
            value={html}
            onChange={setHtml}
            disabled={busy}
            placeholder="Generated reply will appear here…"
            contextMailId={mailId}
          />
          <ReplyActions
            onRegenerate={generate}
            onCopy={copy}
            onSaveDraft={saveDraft}
            onInsert={() => onInsert(html)}
            onSend={() => onSend(html, 'custom')}
            busy={busy}
            regenerating={generating}
            saving={saving}
            sending={sending}
            sendDisabled={empty}
          />
        </>
      )}
    </section>
  );
};

export default CustomReplyGenerator;
