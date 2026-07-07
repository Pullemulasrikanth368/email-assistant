import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sectionLabel } from '../OperationsReport/reportLayout';

const WIDTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

/* One droppable board per column of a row: a col-N width select, an "add section"
   select limited to sections not used anywhere on the grid, and draggable section
   chips (native HTML5 drag-drop, same pattern as the old SectionColumnBoard —
   drag works across every column of every row since drag state lives in the page). */
export default function ColumnBoard({
  rowIdx,
  columns,
  availableSections,
  drag, // { key, over: 'rowIdx:colIdx' | null }
  setDrag,
  onSetWidth,
  onAddSection,
  onRemoveSection,
  onMoveSection, // (key, rowIdx, colIdx, beforeKey)
}) {
  const overId = (colIdx) => `${rowIdx}:${colIdx}`;

  return (
    <div className="rc-col-board" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(170px, 1fr))` }}>
      {columns.map((col, colIdx) => (
        <div
          key={colIdx}
          className={`rc-col${drag.over === overId(colIdx) ? ' rc-col-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag((d) => ({ ...d, over: overId(colIdx) })); }}
          onDragLeave={() => setDrag((d) => (d.over === overId(colIdx) ? { ...d, over: null } : d))}
          onDrop={(e) => {
            e.preventDefault();
            onMoveSection(drag.key, rowIdx, colIdx, null);
            setDrag({ key: null, over: null });
          }}
        >
          <div className="rcfg-col-head">
            <span className="rc-col-head">Column {colIdx + 1}</span>
            <Select value={String(col.width)} onValueChange={(w) => onSetWidth(rowIdx, colIdx, Number(w))}>
              <SelectTrigger className="rcfg-width-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WIDTH_OPTIONS.map((w) => <SelectItem key={w} value={String(w)}>col-{w}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {col.sections.map((key) => (
            <div
              key={key}
              className="rc-order-row"
              draggable
              onDragStart={() => setDrag({ key, over: null })}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDrag((d) => ({ ...d, over: overId(colIdx) })); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMoveSection(drag.key, rowIdx, colIdx, key);
                setDrag({ key: null, over: null });
              }}
              onDragEnd={() => setDrag({ key: null, over: null })}
            >
              <i className="pi pi-bars rc-order-handle" title="Drag to reorder or move to another column" />
              <span className="rcfg-chip-label">{sectionLabel(key)}</span>
              <button
                type="button"
                className="rcfg-chip-remove"
                title="Remove from report"
                onClick={() => onRemoveSection(key)}
              >
                <i className="pi pi-times" />
              </button>
            </div>
          ))}

          {col.sections.length === 0 && <div className="rc-col-empty">Drop or add a section</div>}

          <Select value="" onValueChange={(key) => onAddSection(rowIdx, colIdx, key)}>
            <SelectTrigger className="rcfg-add-select" disabled={!availableSections.length}>
              <SelectValue placeholder={availableSections.length ? '+ Add section' : 'All sections placed'} />
            </SelectTrigger>
            <SelectContent>
              {availableSections.map((key) => (
                <SelectItem key={key} value={key}>{sectionLabel(key)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
