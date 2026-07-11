import React, { useState, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sun, Mail, LayoutDashboard, FileText, Send, Settings,
  Menu, Users, Shield, LogOut, PenLine, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import configImages from '@/config/configImages';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import './Sidebar.scss';

const NAV_ITEMS = [
  { label: 'Morning Brief', path: '/dailyBrief', icon: Sun },
  { label: 'Inbox Triage', path: '/emailAnalysisMails', icon: Mail },
  { label: 'Command Center', path: '/operationsCommandCenter', icon: LayoutDashboard },
  { label: 'Reports', path: '/operationsReport', icon: FileText },
  // { label: 'Drafts', path: '/drafts', icon: PenLine },
  // { label: 'Bulk Email', path: '/bulkEmailSend', icon: Send },
  { label: 'Settings', path: '/settings', icon: Settings },
];

const ADMIN_ITEMS = [
  { label: 'Users', path: '/users', icon: Users },
  { label: 'Roles', path: '/roles', icon: Shield },
];

const getLoginUser = () => {
  try { return JSON.parse(localStorage.getItem('loginCredentials')) || {}; } catch { return {}; }
};

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const user = useMemo(getLoginUser, []);

  const handleLogout = () => {
    localStorage.removeItem('loginCredentials');
    navigate('/login', { replace: true });
  };

  return (
    <aside className={cn('ea-sidebar', collapsed && 'ea-sidebar--collapsed')}>
      {/* Logo */}
      <div className="ea-sidebar__logo">
        {collapsed ? (
          <Button
            variant="ghost" size="icon"
            className="ea-sidebar__collapse-btn ea-sidebar__collapse-btn--only"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <Menu size={14} />
          </Button>
        ) : (
          <>
            <img src={configImages.amnealLogo} alt="Amneal" className="ea-sidebar__logo-img" />
            <Button
              variant="ghost" size="icon"
              className="ea-sidebar__collapse-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <Menu size={14} />
            </Button>
          </>
        )}
      </div>

      {/* Main nav */}
      <nav className="ea-sidebar__nav">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path} to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) => cn('ea-sidebar__item', isActive && 'ea-sidebar__item--active')}
          >
            <Icon size={15} className="ea-sidebar__item-icon" />
            {!collapsed && <span className="ea-sidebar__item-label">{label}</span>}
          </NavLink>
        ))}

        {/* Admin section divider */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Admin</span>
          </div>
        )}
        {collapsed && <div className="border-t border-slate-100 my-2 mx-3" />}

        {ADMIN_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path} to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) => cn('ea-sidebar__item', isActive && 'ea-sidebar__item--active')}
          >
            <Icon size={15} className="ea-sidebar__item-icon" />
            {!collapsed && <span className="ea-sidebar__item-label">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer: user info + logout */}
      <div className="ea-sidebar__footer">
        <div className="ea-sidebar__user">
          <div
            className="ea-sidebar__user-clickable flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:bg-slate-50 p-1.5 rounded-lg transition-all"
            onClick={() => setProfileOpen(true)}
            title="View Profile & Settings"
          >
            <div className="ea-sidebar__avatar">
              {user.name?.[0]?.toUpperCase() || 'A'}
            </div>
            {!collapsed && (
              <div className="ea-sidebar__user-info flex-1 min-w-0">
                <div className="ea-sidebar__user-name truncate">{user.name || user.email || 'Admin'}</div>
                <div className="ea-sidebar__user-role">{user.role || 'Operations'}</div>
              </div>
            )}
          </div>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 ml-auto text-slate-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut size={14} />
          </Button>
        </div>
      </div>

      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
      />
    </aside>
  );
};

/* ------------------------------------------------------------------ */
/* Profile Modal Component                                            */
/* ------------------------------------------------------------------ */
const ProfileModal = ({ isOpen, onClose, user }) => {
  const navigate = useNavigate();

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[440px] w-[94vw] p-6 bg-white border border-slate-200 rounded-xl shadow-lg">
        <DialogHeader className="border-b border-slate-100 pb-3">
          <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
            <User size={18} className="text-slate-700" /> User Profile
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 py-4 border-b border-slate-100">
          <div className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
            {user.name?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-base font-semibold text-slate-900 truncate">{user.name || 'Admin'}</h4>
            <p className="text-sm text-slate-500 truncate">{user.email || 'No email'}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-full">
              {user.role || 'Operations'}
            </span>
          </div>
        </div>

        {/* Sync preferences now live in Settings → General */}
        <div className="py-4">
          <button
            type="button"
            onClick={() => { onClose(); navigate('/settings'); }}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings size={14} /> Sync preferences &amp; settings
            </span>
            <span className="text-xs text-slate-400">Settings → General</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Sidebar;
