import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* Fixed top bar: a title block with a back action, and a toolbar card holding
   the saved-view picker, view-name input and the save/update/default/delete
   actions. */
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
      <div className="rcfg-header-top">
        <div className="rcfg-header-titles">
          <div className="rcfg-eyebrow">Operations Command Center</div>
          <h1 className="rcfg-title">Report Configuration</h1>
          <p className="rcfg-sub">
            Design the report layout as rows and columns, pick the sections each column
            shows, and save it as a named view. The default view is used when generating briefs.
          </p>
        </div>

        <Button size="sm" variant="ghost" className="rcfg-back" onClick={onBack}>
          <i className="pi pi-arrow-left" /> Reports
        </Button>
      </div>

      <div className="rcfg-toolbar">
        <div className="rcfg-toolbar-fields">
          <div className="rcfg-control">
            <label>Saved view</label>
            <Select value={form._id || ''} onValueChange={(id) => onSelectView(id)}>
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

          {form.isDefault && (
            <span className="rcfg-default-badge" title="Briefs are generated with this view">
              <i className="pi pi-star-fill" /> Default view
            </span>
          )}
        </div>

        <div className="rcfg-toolbar-actions">
          <Button size="sm" onClick={onSaveAsNew} disabled={saving} className="rcfg-btn-primary">
            {saving ? <i className="pi pi-spin pi-spinner" /> : <i className="pi pi-plus" />} Save as new
          </Button>
          <Button size="sm" variant="outline" onClick={onUpdate} disabled={saving || !form._id}>
            <i className="pi pi-check" /> Update
          </Button>
          <Button size="sm" variant="outline" onClick={onSetDefault} disabled={saving || !form._id || form.isDefault}>
            <i className="pi pi-star" /> Set default
          </Button>
          <Button size="sm" variant="outline" className="rcfg-danger" onClick={onDelete} disabled={saving || !form._id}>
            <i className="pi pi-trash" /> Delete
          </Button>
        </div>
      </div>
    </header>
  );
}
