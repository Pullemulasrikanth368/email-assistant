import React, { useState, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sun, Mail, LayoutDashboard, FileText, Send, Settings,
  Menu, Users, Shield, LogOut, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import configImages from '@/config/configImages';
import './Sidebar.scss';

const NAV_ITEMS = [
  { label: 'Morning Brief',   path: '/dailyBrief',              icon: Sun },
  { label: 'Inbox Triage',    path: '/emailAnalysisMails',      icon: Mail },
  { label: 'Command Center',  path: '/operationsCommandCenter', icon: LayoutDashboard },
  { label: 'Reports',         path: '/operationsReport',        icon: FileText },
  { label: 'Knowledge Base',  path: '/knowledgeBase',           icon: BookOpen },
  { label: 'Bulk Email',      path: '/bulkEmailSend',           icon: Send },
  { label: 'Connections',     path: '/connectionsDelivery',     icon: Settings },
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
          <div className="ea-sidebar__avatar">
            {user.name?.[0]?.toUpperCase() || 'A'}
          </div>
          {!collapsed && (
            <div className="ea-sidebar__user-info">
              <div className="ea-sidebar__user-name">{user.name || user.email || 'Admin'}</div>
              <div className="ea-sidebar__user-role">{user.role || 'Operations'}</div>
            </div>
          )}
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
    </aside>
  );
};

export default Sidebar;
