import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  BlockQuote,
  FontColor,
  FontSize,
  RemoveFormat,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import './DraftEditor.scss';

/**
 * Rich-text editor for email drafts (CKEditor 5 classic).
 *
 * Works on the draft's HTML directly — `value` is an HTML string and
 * `onChange` receives the edited HTML, so what is saved/sent is exactly what
 * the editor shows (no plain-text round trip).
 */
const DraftEditor = ({ value, onChange, disabled = false, placeholder = 'Write your draft…' }) => (
  <div className="draft-ck">
    <CKEditor
      editor={ClassicEditor}
      data={value || ''}
      disabled={disabled}
      config={{
        licenseKey: 'GPL',
        plugins: [
          Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough,
          Link, List, BlockQuote, FontColor, FontSize, RemoveFormat,
        ],
        toolbar: [
          'undo', 'redo', '|',
          'heading', '|',
          'bold', 'italic', 'underline', 'strikethrough', '|',
          'fontSize', 'fontColor', '|',
          'link', 'bulletedList', 'numberedList', 'blockQuote', '|',
          'removeFormat',
        ],
        link: { addTargetToExternalLinks: true },
        placeholder,
      }}
      onChange={(_evt, editor) => onChange(editor.getData())}
    />
  </div>
);

/** True when the HTML has no visible text content (empty draft). */
export const isEmptyHtml = (html = '') =>
  !String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim();

/** Plain text -> simple HTML paragraphs (blank line = new paragraph). */
export const textToHtml = (text = '') => {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
};

export default DraftEditor;
