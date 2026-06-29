import React, { useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import './Wrapper.scss';

const menuItems = [
  { label: 'Inbox', icon: 'pi pi-inbox', to: '/emailAnalysisMails' },
  { label: 'Daily Brief', icon: 'pi pi-calendar', to: '/dailyBrief' },
  { label: 'Operations Report', icon: 'pi pi-chart-line', to: '/operationsReport' },
  { label: 'Bulk Email', icon: 'pi pi-send', to: '/bulkEmailSend' },
  { label: 'Command Center', icon: 'pi pi-th-large', to: '/operationsCommandCenter' },
  { label: 'Connections', icon: 'pi pi-link', to: '/connectionsDelivery' },
  { label: 'Settings', icon: 'pi pi-cog', to: '/settings' },
];

const getLoginUser = () => {
  try {
    return JSON.parse(localStorage.getItem('loginCredentials')) || {};
  } catch {
    return {};
  }
};

const AppMenu = () => {
  const navigate = useNavigate();
  const user = useMemo(getLoginUser, []);

  const handleLogout = () => {
    localStorage.removeItem('loginCredentials');
    navigate('/login', { replace: true });
  };

  return (
    <header className="ea-app-shell">
      <div className="ea-app-shell__brand">
        <span className="ea-app-shell__brand-icon">
          <i className="pi pi-envelope" />
        </span>
        <span className="ea-app-shell__brand-text">Executive Email Assistant</span>
      </div>

      <nav className="ea-app-shell__nav" aria-label="Main navigation">
        {menuItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `ea-app-shell__link${isActive ? ' active' : ''}`}
          >
            <i className={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="ea-app-shell__account">
        <div className="ea-app-shell__user">
          <span>{user.name || user.email || 'User'}</span>
          {user.role ? <small>{user.role}</small> : null}
        </div>
        <button type="button" className="ea-app-shell__logout" onClick={handleLogout} aria-label="Logout">
          <i className="pi pi-sign-out" />
        </button>
      </div>
    </header>
  );
};

const Wrapper = () => {
  const location = useLocation();
  const isLoginScreen = location.pathname === '/login';

  return (
    <div className="theme-light ltr-support" dir="ltr">
      <div className="wrapper">
        {!isLoginScreen ? <AppMenu /> : null}
        <main className={!isLoginScreen ? 'ea-app-shell__main' : undefined}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Wrapper;
