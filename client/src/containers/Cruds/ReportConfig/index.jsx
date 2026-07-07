import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';
import {
  DEFAULT_ROWS,
  normalizeRows,
  sectionsFromRows,
  addRow,
  removeRow,
  moveRow,
  setRowMaxHeight,
  setRowColumnCount,
  setColumnWidth,
  addSectionToColumn,
  removeSection,
  moveSection,
  SECTION_KEYS,
} from '../OperationsReport/reportLayout';
import ConfigHeader from './ConfigHeader';
import SectionRail from './SectionRail';
import RowAccordion from './RowAccordion';
import SettingsAccordion, { DEFAULT_FIELDS } from './SettingsAccordion';
import '../OperationsReport/OperationsReport.scss';
import './ReportConfig.scss';

const deepCopyRows = (rows) => rows.map((row) => ({
  maxHeight: row.maxHeight,
  columns: row.columns.map((col) => ({ width: col.width, sections: [...col.sections] })),
}));

const emptyConfig = () => ({
  _id: null,
  reportName: '',
  rows: deepCopyRows(DEFAULT_ROWS),
  selectedFields: [...DEFAULT_FIELDS],
  promptInstruction: '',
  outputStyle: 'detailed',
  isDefault: false,
});

const normalizeConfig = (cfg = {}) => ({
  _id: cfg._id || null,
  reportName: cfg.reportName || '',
  rows: normalizeRows(cfg),
  selectedFields: (cfg.selectedFields || []).length ? cfg.selectedFields : [...DEFAULT_FIELDS],
  promptInstruction: cfg.promptInstruction || '',
  outputStyle: cfg.outputStyle || 'detailed',
  isDefault: Boolean(cfg.isDefault),
});

export default function ReportConfigPage() {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState([]);
  const [form, setForm] = useState(emptyConfig());
  const [viewName, setViewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set([0]));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // One drag state for the whole page so a section can be dragged across rows.
  const [drag, setDrag] = useState({ key: null, over: null });

  const applyConfig = (cfg) => {
    const next = cfg ? normalizeConfig(cfg) : emptyConfig();
    setForm(next);
    setViewName(next.reportName);
  };

  const fetchConfigs = useCallback(async (selectId) => {
    try {
      const res = await fetchMethodRequest('GET', 'email-analysis/report-configs');
      const list = Array.isArray(res?.configs) ? res.configs : [];
      setConfigs(list);
      const picked = (selectId && list.find((c) => c._id === selectId))
        || list.find((c) => c.isDefault) || list[0];
      applyConfig(picked);
    } catch {
      showToasterMessage('Could not load report configurations', 'warning');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setRows = (updater) => setForm((current) => ({ ...current, rows: updater(current.rows) }));

  const selectView = (id) => {
    const cfg = configs.find((c) => c._id === id);
    if (cfg) applyConfig(cfg);
  };

  const buildPayload = (name) => ({
    ...form,
    reportName: name,
    enabledSections: sectionsFromRows(form.rows),
  });

  const saveAsNew = async () => {
    const name = viewName.trim();
    if (!name) {
      showToasterMessage('Enter a view name before saving', 'warning');
      return;
    }
    setSaving(true);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/report-configs', { ...buildPayload(name), _id: null });
      if (res?.respCode) {
        showToasterMessage('View saved', 'success');
        await fetchConfigs(res.config?._id);
      } else {
        showToasterMessage(res?.errorMessage || 'Save failed', 'warning');
      }
    } catch {
      showToasterMessage('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateView = async () => {
    if (!form._id) return;
    setSaving(true);
    try {
      const res = await fetchMethodRequest('PUT', `email-analysis/report-configs/${form._id}`, buildPayload(viewName.trim() || form.reportName || 'Untitled view'));
      if (res?.respCode) {
        showToasterMessage('View updated', 'success');
        await fetchConfigs(form._id);
      } else {
        showToasterMessage(res?.errorMessage || 'Update failed', 'warning');
      }
    } catch {
      showToasterMessage('Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async () => {
    if (!form._id) return;
    setSaving(true);
    try {
      const res = await fetchMethodRequest('PATCH', `email-analysis/report-configs/${form._id}/default`, {});
      if (res?.respCode) {
        showToasterMessage('Default view set — briefs now use this layout', 'success');
        await fetchConfigs(form._id);
      } else {
        showToasterMessage(res?.errorMessage || 'Could not set default', 'warning');
      }
    } catch {
      showToasterMessage('Could not set default', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteView = async () => {
    if (!form._id) return;
    if (!window.confirm(`Delete the view "${form.reportName || 'Untitled view'}"?`)) return;
    setSaving(true);
    try {
      const res = await fetchMethodRequest('DELETE', `email-analysis/report-configs/${form._id}`);
      if (res?.respCode) {
        showToasterMessage('View deleted', 'success');
        await fetchConfigs();
      } else {
        showToasterMessage(res?.errorMessage || 'Delete failed', 'warning');
      }
    } catch {
      showToasterMessage('Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (idx) => setOpenRows((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  const handleAddRow = () => {
    setRows((rows) => addRow(rows));
    setOpenRows((prev) => new Set(prev).add(form.rows.length));
  };

  const usedSections = sectionsFromRows(form.rows);
  const availableSections = SECTION_KEYS.filter((key) => !usedSections.includes(key));

  const boardProps = {
    availableSections,
    drag,
    setDrag,
    onSetWidth: (rowIdx, colIdx, width) => setRows((rows) => setColumnWidth(rows, rowIdx, colIdx, width)),
    onAddSection: (rowIdx, colIdx, key) => setRows((rows) => addSectionToColumn(rows, rowIdx, colIdx, key)),
    onRemoveSection: (key) => setRows((rows) => removeSection(rows, key)),
    onMoveSection: (key, rowIdx, colIdx, beforeKey) => setRows((rows) => moveSection(rows, key, rowIdx, colIdx, beforeKey)),
  };

  if (loading) {
    return (
      <div className="rcfg-page">
        <div className="rcfg-loading"><i className="pi pi-spin pi-spinner" /> Loading configuration...</div>
      </div>
    );
  }

  return (
    <div className="rcfg-page">
      <ConfigHeader
        configs={configs}
        form={form}
        viewName={viewName}
        onViewNameChange={setViewName}
        onSelectView={selectView}
        onSaveAsNew={saveAsNew}
        onUpdate={updateView}
        onSetDefault={setDefault}
        onDelete={deleteView}
        onBack={() => navigate('/operationsReport')}
        saving={saving}
      />

      <div className="rcfg-body">
        <SectionRail rows={form.rows} />

        <main className="rcfg-main rc-panel">
          <SettingsAccordion
            form={form}
            setField={setField}
            open={settingsOpen}
            onToggle={() => setSettingsOpen((v) => !v)}
          />

          {form.rows.map((row, rowIdx) => (
            <RowAccordion
              key={rowIdx}
              rowIdx={rowIdx}
              row={row}
              rowCount={form.rows.length}
              open={openRows.has(rowIdx)}
              onToggle={() => toggleRow(rowIdx)}
              onMoveRow={(idx, dir) => setRows((rows) => moveRow(rows, idx, dir))}
              onRemoveRow={(idx) => setRows((rows) => removeRow(rows, idx))}
              onSetColumnCount={(idx, n) => setRows((rows) => setRowColumnCount(rows, idx, n))}
              onSetMaxHeight={(idx, value) => setRows((rows) => setRowMaxHeight(rows, idx, value))}
              boardProps={boardProps}
            />
          ))}

          <div className="rcfg-addrow">
            <Button variant="outline" size="sm" onClick={handleAddRow}>
              <i className="pi pi-plus" style={{ fontSize: 11, marginRight: 5 }} /> Add row
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
