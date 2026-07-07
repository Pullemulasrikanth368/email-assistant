import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* Fixed top bar: heading, saved-view picker, view-name input and save/update actions. */
export default function ConfigHeader({
  configs,
  form,
  viewName,
  onViewNameChange,
  onSelectView,
  onSaveAsNew,
  onUpdate,
  onSetDefault,
  onDelete,
  onBack,
  saving,
}) {
  return (
    <header className="rcfg-header">
      <div className="rcfg-header-titles">
        <div className="rcfg-eyebrow">Operations command center</div>
        <h1 className="rcfg-title">Report Configuration</h1>
        <p className="rcfg-sub">
          Design the report layout as rows and columns, pick the sections each column shows,
          and save it as a named view. The default view is used when generating briefs.
        </p>
      </div>

      <div className="rcfg-header-controls">
        <div className="rcfg-control">
          <label>Saved view</label>
          <Select
            value={form._id || ''}
            onValueChange={(id) => onSelectView(id)}
          >
            <SelectTrigger className="rcfg-view-select"><SelectValue placeholder="Select a view" /></SelectTrigger>
            <SelectContent>
              {configs.filter((cfg) => cfg._id).map((cfg) => (
                <SelectItem key={cfg._id} value={cfg._id}>
                  {cfg.reportName || 'Untitled view'}{cfg.isDefault ? ' ★' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rcfg-control">
          <label>View name</label>
          <input
            className="rcfg-name-input"
            type="text"
            value={viewName}
            placeholder="e.g. Morning ops view"
            onChange={(e) => onViewNameChange(e.target.value)}
          />
        </div>

        <div className="rcfg-header-actions">
          <Button size="sm" onClick={onSaveAsNew} disabled={saving}>
            {saving ? <i className="pi pi-spin pi-spinner" /> : null} Save as new view
          </Button>
          <Button size="sm" variant="outline" onClick={onUpdate} disabled={saving || !form._id}>
            Update view
          </Button>
          <Button size="sm" variant="outline" onClick={onSetDefault} disabled={saving || !form._id || form.isDefault}>
            Set as default
          </Button>
          <Button size="sm" variant="outline" className="rcfg-danger" onClick={onDelete} disabled={saving || !form._id}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <i className="pi pi-arrow-left" style={{ fontSize: 11, marginRight: 4 }} /> Reports
          </Button>
        </div>
      </div>
    </header>
  );
}
