import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Sun,
  Mail,
  LayoutDashboard,
  FileText,
  Send,
  Settings,
  Menu,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import configImages from '@/config/configImages';
import './Sidebar.scss';

const NAV_ITEMS = [
  { label: 'Morning Brief', path: '/dailyBrief', icon: Sun },
  { label: 'Inbox Triage', path: '/emailAnalysisMails', icon: Mail },
  { label: 'Command Center', path: '/operationsCommandCenter', icon: LayoutDashboard },
  { label: 'Reports', path: '/operationsReport', icon: FileText },
  { label: 'Bulk Email', path: '/bulkEmailSend', icon: Send },
  { label: 'Connections', path: '/connectionsDelivery', icon: Settings },
];

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={cn('ea-sidebar', collapsed && 'ea-sidebar--collapsed')}>
      <div className="ea-sidebar__logo">
        {collapsed ? (
          /* Collapsed: just the toggle button centred */
          <Button
            variant="ghost"
            size="icon"
            className="ea-sidebar__collapse-btn ea-sidebar__collapse-btn--only"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <Menu size={14} />
          </Button>
        ) : (
          /* Expanded: Amneal logo + collapse button */
          <>
            <img
              src={configImages.amnealLogo}
              alt="Amneal"
              className="ea-sidebar__logo-img"
            />
            <Button
              variant="ghost"
              size="icon"
              className="ea-sidebar__collapse-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <Menu size={14} />
            </Button>
          </>
        )}
      </div>

      <nav className="ea-sidebar__nav">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn('ea-sidebar__item', isActive && 'ea-sidebar__item--active')
            }
          >
            <Icon size={15} className="ea-sidebar__item-icon" />
            {!collapsed && (
              <span className="ea-sidebar__item-label">{label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ea-sidebar__footer">
        <div className="ea-sidebar__user">
          <div className="ea-sidebar__avatar">A</div>
          {!collapsed && (
            <div className="ea-sidebar__user-info">
              <div className="ea-sidebar__user-name">Admin</div>
              <div className="ea-sidebar__user-role">Operations</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
