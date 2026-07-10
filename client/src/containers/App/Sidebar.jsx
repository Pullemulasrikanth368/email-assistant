import React, { useState, useMemo, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sun, Mail, LayoutDashboard, FileText, Send, Settings,
  Menu, Users, Shield, LogOut, BookOpen, PenLine, SlidersHorizontal, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import configImages from '@/config/configImages';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputSwitch } from 'primereact/inputswitch';
import fetchMethodRequest from '../../config/service';
import showToasterMessage from '../UI/ToasterMessage/toasterMessage';
import './Sidebar.scss';

const NAV_ITEMS = [
  { label: 'Morning Brief', path: '/dailyBrief', icon: Sun },
  { label: 'Inbox Triage', path: '/emailAnalysisMails', icon: Mail },
  { label: 'Command Center', path: '/operationsCommandCenter', icon: LayoutDashboard },
  { label: 'Reports', path: '/operationsReport', icon: FileText },
  { label: 'Report Config', path: '/reportConfig', icon: SlidersHorizontal },
  { label: 'Knowledge Base', path: '/knowledgeBase', icon: BookOpen },
  // { label: 'Drafts', path: '/drafts', icon: PenLine },
  // { label: 'Bulk Email', path: '/bulkEmailSend', icon: Send },
  { label: 'Connections', path: '/connectionsDelivery', icon: Settings },
  { label: 'Outlook Labels', path: '/outlookCategoryConfig', icon: SlidersHorizontal },
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
  const [autoSync, setAutoSync] = useState(true);
  const [syncValue, setSyncValue] = useState(15);
  const [syncUnit, setSyncUnit] = useState('minutes'); // 'minutes' | 'days'
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([
      fetchMethodRequest('GET', 'email-analysis/auto-sync'),
      fetchMethodRequest('GET', 'email-analysis/sync-interval'),
    ])
      .then(([syncRes, intervalRes]) => {
        if (syncRes?.autoSync !== undefined) {
          setAutoSync(syncRes.autoSync !== false);
        }
        if (intervalRes?.syncIntervalValue !== undefined) {
          setSyncValue(Number(intervalRes.syncIntervalValue) || 15);
          setSyncUnit(intervalRes.syncIntervalUnit || 'minutes');
        } else if (intervalRes?.syncIntervalMinutes !== undefined) {
          setSyncValue(Number(intervalRes.syncIntervalMinutes) || 15);
          setSyncUnit('minutes');
        }
      })
      .catch(() => {
        showToasterMessage('Could not load sync preferences', 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen]);

  const handleToggleAutoSync = async (checked) => {
    const next = typeof checked === 'boolean' ? checked : !autoSync;
    setAutoSync(next);
    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/auto-sync', { autoSync: next });
      if (res?.respCode) {
        showToasterMessage(next ? 'Auto-sync enabled' : 'Auto-sync disabled', 'success');
        window.dispatchEvent(new CustomEvent('syncSettingsUpdated'));
      } else {
        setAutoSync(!next);
        showToasterMessage(res?.errorMessage || 'Failed to update auto-sync', 'error');
      }
    } catch {
      setAutoSync(!next);
      showToasterMessage('Failed to update auto-sync', 'error');
    }
  };

  const handleSaveInterval = async (value, unit) => {
    const val = Number(value);
    if (isNaN(val) || val < 1) {
      showToasterMessage('Please enter a valid positive number', 'warning');
      return;
    }
    if (unit === 'minutes' && val > 60) {
      showToasterMessage('Minutes must be 60 or less', 'warning');
      return;
    }
    if (unit === 'hours' && val > 23) {
      showToasterMessage('Hours must be 23 or less', 'warning');
      return;
    }
    if (unit === 'days' && val > 31) {
      showToasterMessage('Days must be 31 or less', 'warning');
      return;
    }

    try {
      const res = await fetchMethodRequest('POST', 'email-analysis/sync-interval', {
        syncIntervalValue: val,
        syncIntervalUnit: unit,
      });
      if (res?.respCode) {
        showToasterMessage(`Sync interval updated to every ${val} ${unit}`, 'success');
        window.dispatchEvent(new CustomEvent('syncSettingsUpdated'));
      } else {
        showToasterMessage(res?.errorMessage || 'Failed to update interval', 'error');
      }
    } catch {
      showToasterMessage('Failed to update interval', 'error');
    }
  };

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

        <div className="py-4">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Sync Preferences</h4>

          {loading ? (
            <div className="flex justify-center py-6">
              <i className="pi pi-spin pi-spinner text-slate-400 text-xl" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Auto Sync Toggle */}
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <h5 className="text-sm font-semibold text-slate-900">Auto-sync mailboxes</h5>
                  <p className="text-xs text-slate-500 mt-0.5">Automatically sync connected mailboxes in the background</p>
                </div>
                <InputSwitch
                  checked={autoSync}
                  onChange={(e) => handleToggleAutoSync(e.value)}
                />
              </div>

              {/* Interval selection */}
              {autoSync && (
                <div className="space-y-3 pt-1 border-t border-slate-100">
                  <div>
                    <h5 className="text-sm font-semibold text-slate-900">Sync frequency</h5>
                    <p className="text-xs text-slate-500 mt-0.5">Configure how often the automated background sync runs</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-all ${syncUnit === 'minutes'
                        ? 'bg-blue-50 border-blue-500 text-blue-600'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      onClick={() => {
                        setSyncUnit('minutes');
                        if (syncValue > 60) setSyncValue(15);
                      }}
                    >
                      Minutes
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-all ${syncUnit === 'hours'
                        ? 'bg-blue-50 border-blue-500 text-blue-600'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      onClick={() => {
                        setSyncUnit('hours');
                        if (syncValue > 23) setSyncValue(1);
                      }}
                    >
                      Hours
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-all ${syncUnit === 'days'
                        ? 'bg-blue-50 border-blue-500 text-blue-600'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      onClick={() => {
                        setSyncUnit('days');
                        if (syncValue > 31) setSyncValue(1);
                      }}
                    >
                      Days
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={1}
                      max={syncUnit === 'minutes' ? 60 : (syncUnit === 'hours' ? 23 : 31)}
                      value={syncValue}
                      onChange={(e) => setSyncValue(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 bg-white"
                    />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{syncUnit}</span>
                    <button
                      type="button"
                      onClick={() => handleSaveInterval(syncValue, syncUnit)}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors ml-auto"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Sidebar;
