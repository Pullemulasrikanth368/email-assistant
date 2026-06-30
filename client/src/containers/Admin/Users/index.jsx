import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, Users as UsersIcon, Search, LayoutGrid, Table2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import fetchMethodRequest from '../../../config/service';
import showToasterMessage from '../../UI/ToasterMessage/toasterMessage';

const EMPTY_FORM = { name: '', email: '', password: '', role: 'Admin' };
const ROLES = ['Admin', 'Manager', 'Viewer'];

const ROLE_CLASS = {
  Admin:   'bg-primary/10 text-primary',
  Manager: 'bg-accent/15 text-accent',
  Viewer:  'bg-muted text-muted-foreground',
};

const StatusDot = ({ active }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${active ? 'text-green-600' : 'text-muted-foreground'}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-border'}`} />
    {active ? 'Active' : 'Inactive'}
  </span>
);

const RoleBadge = ({ role }) => (
  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${ROLE_CLASS[role] || ROLE_CLASS.Viewer}`}>
    {role || '—'}
  </span>
);

const Avatar = ({ name, size = 'sm' }) => {
  const sz = size === 'lg' ? 'w-9 h-9 text-sm' : 'w-5 h-5 text-[9px]';
  return (
    <div className={`${sz} rounded-full font-bold flex items-center justify-center flex-shrink-0 bg-accent/20 text-accent`}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>
);

export default function UsersScreen() {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [view, setView]         = useState('table');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMethodRequest('GET', 'users');
      if (res?.respCode === 200) setUsers(res.users || []);
    } catch {
      showToasterMessage('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const openEdit = (u) => { setEditing(u); setForm({ name: u.name, email: u.email, password: '', role: u.role || 'Admin' }); setOpen(true); };
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email) { showToasterMessage('Name and email are required', 'error'); return; }
    if (!editing && !form.password) { showToasterMessage('Password is required', 'error'); return; }
    setSaving(true);
    try {
      const body = { name: form.name, email: form.email, role: form.role };
      if (form.password) body.password = form.password;
      const res = editing
        ? await fetchMethodRequest('PUT', `users/${editing._id}`, body)
        : await fetchMethodRequest('POST', 'users', { ...body, password: form.password });
      if (res?.respCode === 201 || res?.respCode === 205) {
        showToasterMessage(editing ? 'User updated' : 'User created', 'success');
        setOpen(false); loadUsers();
      } else {
        showToasterMessage(res?.errorMessage || 'Operation failed', 'error');
      }
    } catch { showToasterMessage('Could not reach server', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetchMethodRequest('DELETE', `users/${id}`);
      if (res?.respCode === 206) {
        showToasterMessage('User removed', 'success');
        setUsers((prev) => prev.filter((u) => u._id !== id));
      } else { showToasterMessage(res?.errorMessage || 'Delete failed', 'error'); }
    } catch { showToasterMessage('Could not reach server', 'error'); }
    finally { setDeleting(null); }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
  });

  return (
    <div className="p-3 space-y-2">

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <UsersIcon size={13} className="text-primary" />
          <span className="text-sm font-semibold text-primary">Users</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary">
            {users.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-accent" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-6 h-7 text-xs w-40"
            />
          </div>
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
            <Plus size={12} /> Add User
          </Button>
        </div>
      </div>

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-primary/5">
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">#</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Name</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Email</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Role</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Status</th>
                <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Created</th>
                <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-primary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground">
                    <div className="flex items-center justify-center gap-1.5">
                      <Loader2 size={13} className="animate-spin text-accent" /> Loading…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground text-xs">
                    {search ? `No results for "${search}"` : 'No users yet'}
                  </td>
                </tr>
              ) : filtered.map((user, i) => (
                <tr key={user._id} className="hover:bg-primary/[0.03] transition-colors">
                  <td className="px-3 py-1.5 text-muted-foreground/50 text-[11px]">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Avatar name={user.name} />
                      <span className="font-medium text-foreground">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{user.email}</td>
                  <td className="px-3 py-1.5"><RoleBadge role={user.role} /></td>
                  <td className="px-3 py-1.5"><StatusDot active={user.active !== false} /></td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-primary/10"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => handleDelete(user._id)}
                        disabled={deleting === user._id}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        title="Remove"
                      >
                        {deleting === user._id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length > 0 && (
            <div className="border-t border-border/40 px-3 py-1 bg-primary/5 text-[10px] text-primary font-medium">
              Showing {filtered.length} of {users.length} users
            </div>
          )}
        </div>
      )}

      {/* Card view */}
      {view === 'card' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-xs gap-1.5">
              <Loader2 size={13} className="animate-spin text-accent" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <UsersIcon size={28} strokeWidth={1.2} className="text-accent" />
              <p className="text-xs text-muted-foreground">{search ? `No results for "${search}"` : 'No users yet'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {filtered.map((user) => (
                <div
                  key={user._id}
                  className="bg-card border border-primary/15 rounded-lg p-3 flex flex-col gap-2 transition-shadow hover:shadow-sm hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-1">
                    <Avatar name={user.name} size="lg" />
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-primary/10"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => handleDelete(user._id)}
                        disabled={deleting === user._id}
                        className="p-1 rounded transition-colors text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        title="Remove"
                      >
                        {deleting === user._id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-primary truncate">{user.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Mail size={10} className="text-accent flex-shrink-0" />
                      <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-border/40">
                    <RoleBadge role={user.role} />
                    <StatusDot active={user.active !== false} />
                  </div>
                </div>
              ))}
              <button
                onClick={openCreate}
                className="bg-primary/5 border border-dashed border-primary/30 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors min-h-[110px]"
              >
                <Plus size={16} />
                <span className="text-[11px] font-medium">Add User</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm text-primary">{editing ? 'Edit User' : 'Add User'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3 pt-1">
            <Field label="Full name">
              <Input value={form.name} onChange={set('name')} placeholder="Jane Smith" disabled={saving} className="h-8 text-xs" />
            </Field>
            <Field label="Email address">
              <Input type="email" value={form.email} onChange={set('email')} placeholder="jane@company.com" disabled={saving} className="h-8 text-xs" />
            </Field>
            <Field label={editing ? 'New password (blank = keep current)' : 'Password'}>
              <Input type="password" value={form.password} onChange={set('password')} placeholder={editing ? 'Leave blank to keep' : 'Min. 8 characters'} disabled={saving} className="h-8 text-xs" />
            </Field>
            <Field label="Role">
              <select
                value={form.role} onChange={set('role')} disabled={saving}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving} className="h-7 text-xs">Cancel</Button>
              <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs gap-1">
                {saving && <Loader2 size={11} className="animate-spin" />}
                {editing ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
