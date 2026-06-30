import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, Shield, Users, LayoutGrid, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const EMPTY_FORM = { name: '', description: '' };

export default function RolesScreen() {
  const [roles, setRoles]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [view, setView]         = useState('table');

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'roles');
      if (res?.respCode === 200) setRoles(res.roles || []);
    } catch {
      showToasterMessage('Failed to load roles', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const openEdit   = (role) => { setEditing(role); setForm({ name: role.name, description: role.description || '' }); setOpen(true); };
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToasterMessage('Role name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetchMethodRequest('PUT', `roles/${editing._id}`, form)
        : await fetchMethodRequest('POST', 'roles', form);
      if (res?.respCode === 201 || res?.respCode === 205) {
        showToasterMessage(editing ? 'Role updated' : 'Role created', 'success');
        setOpen(false);
        loadRoles();
      } else {
        showToasterMessage(res?.errorMessage || 'Operation failed', 'error');
      }
    } catch {
      showToasterMessage('Could not reach server', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetchMethodRequest('DELETE', `roles/${id}`);
      if (res?.respCode === 206) {
        showToasterMessage('Role deleted', 'success');
        setRoles((prev) => prev.filter((r) => r._id !== id));
      } else {
        showToasterMessage(res?.errorMessage || 'Delete failed', 'error');
      }
    } catch {
      showToasterMessage('Could not reach server', 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-3 space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Shield size={13} className="text-primary" />
          <span className="text-sm font-semibold text-primary">Roles</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary">
            {roles.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setView('table')}
              className={`p-1.5 transition-colors ${view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-primary/5'}`}
              title="Table view"
            >
              <Table2 size={12} />
            </button>
            <button
              onClick={() => setView('card')}
              className={`p-1.5 transition-colors ${view === 'card' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-primary/5'}`}
              title="Card view"
            >
              <LayoutGrid size={12} />
            </button>
          </div>
          <Button onClick={openCreate} size="sm" className="h-7 text-xs px-2.5 gap-1">
            <Plus size={12} /> Add Role
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-xs gap-1.5">
          <Loader2 size={13} className="animate-spin text-accent" /> Loading roles…
        </div>
      )}

      {/* Empty */}
      {!loading && roles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Shield size={28} strokeWidth={1.2} className="text-accent" />
          <p className="text-xs text-muted-foreground">No roles yet</p>
          <Button onClick={openCreate} variant="outline" size="sm" className="h-7 text-xs mt-1">Add first role</Button>
        </div>
      )}

      {/* Table view */}
      {!loading && roles.length > 0 && view === 'table' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-primary/5">
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Role name</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Description</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Users</th>
                <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {roles.map((role) => (
                <tr key={role._id} className="hover:bg-primary/[0.03] transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-primary/10">
                        <Shield size={11} className="text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{role.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                    {role.description || <span className="italic text-border">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-accent font-medium">
                      <Users size={11} />
                      <span>{role.userCount ?? 0}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => openEdit(role)}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-primary/10"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => handleDelete(role._id)}
                        disabled={deleting === role._id}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        title="Delete"
                      >
                        {deleting === role._id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border/40 px-3 py-1 bg-primary/5 text-[10px] text-primary font-medium">
            {roles.length} role{roles.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Card view */}
      {!loading && roles.length > 0 && view === 'card' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {roles.map((role) => (
            <div
              key={role._id}
              className="bg-card border border-primary/15 rounded-lg p-3 flex flex-col gap-2 transition-shadow hover:shadow-sm hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-1">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary">
                  <Shield size={13} className="text-primary-foreground" />
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => openEdit(role)}
                    className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-primary/10"
                    title="Edit"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => handleDelete(role._id)}
                    disabled={deleting === role._id}
                    className="p-1 rounded transition-colors text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    title="Delete"
                  >
                    {deleting === role._id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary truncate">{role.name}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {role.description || <span className="italic">No description</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-accent font-medium mt-auto pt-1.5 border-t border-border/40">
                <Users size={11} />
                <span>{role.userCount ?? 0} user{(role.userCount ?? 0) !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
          <button
            onClick={openCreate}
            className="bg-primary/5 border border-dashed border-primary/30 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors min-h-[90px]"
          >
            <Plus size={16} />
            <span className="text-[11px] font-medium">Add Role</span>
          </button>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm text-primary">{editing ? 'Edit Role' : 'Add Role'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Role name</label>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Manager" disabled={saving} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description <span className="font-normal opacity-60">(optional)</span></label>
              <Input value={form.description} onChange={set('description')} placeholder="What can this role do?" disabled={saving} className="h-8 text-xs" />
            </div>
            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving} className="h-7 text-xs">Cancel</Button>
              <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs gap-1">
                {saving && <Loader2 size={11} className="animate-spin" />}
                {editing ? 'Save changes' : 'Create role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
