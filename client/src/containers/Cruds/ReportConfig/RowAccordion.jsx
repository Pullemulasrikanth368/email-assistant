import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_ROW_MAX_HEIGHT, MAX_COLUMNS_PER_ROW } from '../OperationsReport/reportLayout';
import ColumnBoard from './ColumnBoard';

const COLUMN_OPTIONS = Array.from({ length: MAX_COLUMNS_PER_ROW }, (_, i) => i + 1);

/* One accordion per layout row: header summarises the row (columns, widths, max height)
   with reorder/remove controls; the body holds the column-count and max-height settings
   plus the per-column boards. */
export default function RowAccordion({
  rowIdx,
  row,
  rowCount,
  open,
  onToggle,
  onMoveRow,
  onRemoveRow,
  onSetColumnCount,
  onSetMaxHeight,
  boardProps, // passed through to ColumnBoard
}) {
  const widthSummary = row.columns.map((col) => `col-${col.width}`).join(' · ');

  return (
    <section className={`rcfg-row${open ? ' rcfg-row--open' : ''}`} id={`rcfg-row-${rowIdx}`}>
      <div
        className="rcfg-row-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
      >
        <span className="rcfg-row-num">{rowIdx + 1}</span>
        <div className="rcfg-row-headinfo">
          <span className="rcfg-row-title">
            Row {rowIdx + 1}
            <i className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'} rcfg-row-chev`} />
          </span>
          <span className="rcfg-row-meta">
            {row.columns.length} column{row.columns.length > 1 ? 's' : ''} · {widthSummary}
            {row.maxHeight ? ` · ${row.maxHeight}px` : ' · no height cap'}
          </span>
        </div>
        <span className="rcfg-row-headctrls" onClick={(e) => e.stopPropagation()}>
          <div className="rcfg-control">
            <label>Columns</label>
            <Select value={String(row.columns.length)} onValueChange={(n) => onSetColumnCount(rowIdx, Number(n))}>
              <SelectTrigger className="rcfg-cols-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLUMN_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} column{n > 1 ? 's' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rcfg-control">
            <label>Max height (px)</label>
            <input
              className="rcfg-height-input"
              type="number"
              min={200}
              max={1200}
              step={50}
              value={row.maxHeight ?? ''}
              placeholder={String(DEFAULT_ROW_MAX_HEIGHT)}
              title="Columns scroll inside this height. Leave empty for no cap."
              onChange={(e) => onSetMaxHeight(rowIdx, e.target.value)}
            />
          </div>
        </span>
        <span className="rcfg-row-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="Move row up" disabled={rowIdx === 0} onClick={() => onMoveRow(rowIdx, -1)}>
            <i className="pi pi-arrow-up" />
          </button>
          <button type="button" title="Move row down" disabled={rowIdx === rowCount - 1} onClick={() => onMoveRow(rowIdx, 1)}>
            <i className="pi pi-arrow-down" />
          </button>
          <button type="button" className="rcfg-row-remove" title="Remove row" onClick={() => onRemoveRow(rowIdx)}>
            <i className="pi pi-trash" />
          </button>
        </span>
      </div>

      {open && (
        <div className="rcfg-row-body">
          <ColumnBoard rowIdx={rowIdx} columns={row.columns} {...boardProps} />
        </div>
      )}
    </section>
  );
}
