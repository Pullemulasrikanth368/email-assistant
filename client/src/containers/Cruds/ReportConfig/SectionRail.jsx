import { sectionLabel, sectionsFromRows, SECTION_KEYS } from '../OperationsReport/reportLayout';

/* Fixed left rail: which sections are placed in the layout (and in which row),
   and which are still pending. Clicking a placed section scrolls to its row. */
export default function SectionRail({ rows }) {
  const used = sectionsFromRows(rows);
  const rowOf = (key) => rows.findIndex((row) => row.columns.some((col) => col.sections.includes(key)));
  const pending = SECTION_KEYS.filter((key) => !used.includes(key));
  const columnCount = rows.reduce((sum, row) => sum + row.columns.length, 0);

  const scrollToRow = (key) => {
    const el = document.getElementById(`rcfg-row-${rowOf(key)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <aside className="rcfg-rail">
      <div className="rcfg-rail-summary">
        <div className="rcfg-rail-stat">
          <span className="v">{rows.length}</span>
          <span className="k">Row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="rcfg-rail-stat">
          <span className="v">{columnCount}</span>
          <span className="k">Column{columnCount === 1 ? '' : 's'}</span>
        </div>
        <div className="rcfg-rail-stat">
          <span className="v">{used.length}</span>
          <span className="k">Section{used.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="rcfg-rail-group">
        <div className="rcfg-rail-head">In report <span className="pill">{used.length}</span></div>
        {used.map((key) => (
          <button
            key={key}
            type="button"
            className="rcfg-rail-item used"
            title="Scroll to its row"
            onClick={() => scrollToRow(key)}
          >
            <span className="dot" />
            <span className="lbl">{sectionLabel(key)}</span>
            <span className="row-tag">Row {rowOf(key) + 1}</span>
          </button>
        ))}
        {!used.length && <div className="rcfg-rail-empty">Nothing placed yet</div>}
      </div>

      <div className="rcfg-rail-group">
        <div className="rcfg-rail-head">Pending <span className="pill pill-muted">{pending.length}</span></div>
        {pending.map((key) => (
          <div key={key} className="rcfg-rail-item pending">
            <span className="dot" />
            <span className="lbl">{sectionLabel(key)}</span>
          </div>
        ))}
        {!pending.length && <div className="rcfg-rail-empty">All sections placed</div>}
      </div>
    </aside>
  );
}
