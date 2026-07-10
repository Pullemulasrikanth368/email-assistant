import { useCallback, useEffect, useRef, useState } from 'react';
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
import fetchMethodRequest from '../../../config/service';
import './DraftEditor.scss';

// Right-click menu groups. Each parent opens a submenu of modes; the mode
// `value` is sent to the rewrite API. "Rewrite" changes the voice; "Refine"
// fixes / restructures / expands the text (using the thread context).
const REWRITE_MENUS = [
  {
    key: 'rewrite',
    label: 'Rewrite',
    icon: '✦',
    items: [
      { value: 'professional', label: 'Professional', icon: '💼' },
      { value: 'friendly', label: 'Friendly', icon: '😊' },
    ],
  },
  {
    key: 'refine',
    label: 'Refine',
    icon: '✎',
    items: [
      { value: 'polish', label: 'Polish', icon: '✨' },
      { value: 'reframe', label: 'Reframe', icon: '🔄' },
      { value: 'elaborate', label: 'Elaborate', icon: '📝' },
    ],
  },
];

/** Collect the plain text currently selected in the editor model. */
function getSelectedText(editor) {
  const selection = editor.model.document.selection;
  let text = '';
  for (const range of selection.getRanges()) {
    for (const item of range.getItems()) {
      if (item.is('$text') || item.is('$textProxy')) text += item.data;
    }
  }
  return text;
}

/**
 * Rich-text editor for email drafts (CKEditor 5 classic).
 *
 * Works on the draft's HTML directly — `value` is an HTML string and
 * `onChange` receives the edited HTML, so what is saved/sent is exactly what
 * the editor shows (no plain-text round trip).
 *
 * Selecting text and right-clicking opens a context menu with "Rewrite"
 * (Professional / Friendly) and "Refine" (Polish / Reframe / Elaborate)
 * submenus. Choosing one sends the selection — with the mail thread context —
 * to the AI rewrite endpoint and replaces it in place with the result.
 */
const DraftEditor = ({ value, onChange, disabled = false, placeholder = 'Write your draft…', contextMailId = null }) => {
  const editorRef = useRef(null);
  const selectedTextRef = useRef('');
  const savedRangesRef = useRef(null);
  const menuRef = useRef(null);

  const [menu, setMenu] = useState(null); // null | { x, y }
  const [openGroup, setOpenGroup] = useState(null); // which submenu is open
  const [rewriting, setRewriting] = useState(false);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setOpenGroup(null);
  }, []);

  // Show our menu on right-click when there is a non-empty selection.
  // Bound via React's onContextMenu on the wrapper so it survives editor
  // re-renders (no manual add/removeEventListener lifecycle to get wrong).
  const handleContextMenu = useCallback((evt) => {
    const editor = editorRef.current;
    if (!editor || disabled || rewriting) return;
    const selection = editor.model.document.selection;
    const text = getSelectedText(editor);
    if (selection.isCollapsed || !text.trim()) {
      // Nothing selected — let the browser's native menu handle it.
      return;
    }
    evt.preventDefault();
    selectedTextRef.current = text;
    savedRangesRef.current = Array.from(selection.getRanges());
    // Clamp roughly inside the viewport so the menu never opens off-screen.
    const x = Math.min(evt.clientX, window.innerWidth - 240);
    const y = Math.min(evt.clientY, window.innerHeight - 180);
    setOpenGroup(null);
    setMenu({ x, y });
  }, [disabled, rewriting]);

  const handleReady = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  // Close the menu on outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const onDocMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menu, closeMenu]);

  const handleRewrite = useCallback(async (mode) => {
    const editor = editorRef.current;
    const text = selectedTextRef.current;
    const ranges = savedRangesRef.current;
    closeMenu();
    if (!editor || !text?.trim() || !ranges?.length) return;

    setRewriting(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/rewrite-text', { text, mode, mailId: contextMailId });
      if (res?.respCode === 200 && res.text) {
        // Convert the returned plain text into HTML (blank line = new paragraph,
        // single newline = <br>) then parse it into a CKEditor model fragment so
        // paragraph / line-break structure is preserved instead of flattened.
        const html = textToHtml(String(res.text).trim());
        const viewFragment = editor.data.processor.toView(html);
        const modelFragment = editor.data.toModel(viewFragment);
        editor.model.change((writer) => {
          const selection = writer.createSelection(ranges);
          editor.model.insertContent(modelFragment, selection);
        });
        // Programmatic model changes fire the editor's change event, so onChange
        // is invoked automatically — but call it directly too to be safe.
        if (onChange) onChange(editor.getData());
      }
    } catch {
      /* silent — user can retry */
    } finally {
      setRewriting(false);
    }
  }, [onChange, closeMenu, contextMailId]);

  return (
    <div className="draft-ck" onContextMenu={handleContextMenu}>
      <CKEditor
        editor={ClassicEditor}
        data={value || ''}
        disabled={disabled || rewriting}
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
        onReady={handleReady}
        onChange={(_evt, editor) => onChange(editor.getData())}
      />

      {rewriting && (
        <div className="draft-ck__overlay" aria-busy="true">
          <div className="draft-ck__overlay-box">
            <i className="pi pi-spin pi-spinner" />
            <span>Rewriting…</span>
          </div>
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="draft-ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {REWRITE_MENUS.map((group) => (
            <div
              key={group.key}
              className="draft-ctx-item draft-ctx-item--parent"
              onMouseEnter={() => setOpenGroup(group.key)}
            >
              <span className="draft-ctx-item__icon">{group.icon}</span>
              <span className="draft-ctx-item__label">{group.label}</span>
              <span className="draft-ctx-item__arrow">▸</span>

              {openGroup === group.key && (
                <div className="draft-ctx-submenu">
                  {group.items.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="draft-ctx-item"
                      onClick={() => handleRewrite(item.value)}
                    >
                      <span className="draft-ctx-item__icon">{item.icon}</span>
                      <span className="draft-ctx-item__label">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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
