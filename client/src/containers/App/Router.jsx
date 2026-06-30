import { createBrowserRouter, Navigate } from 'react-router-dom';
import React, { Suspense } from 'react';
import Wrapper from './Wrapper.jsx';
import { ProtectedRoute } from './ProtectedRoute.jsx';

// Auth screens (public — rendered without sidebar)
import Login from '../Auth/Login.jsx';
import Register from '../Auth/Register.jsx';

// Lazy-load app screens
const Users                   = React.lazy(() => import('../Admin/Users/index.jsx'));
const Roles                   = React.lazy(() => import('../Admin/Roles/index.jsx'));
const EmailAnalysisMails      = React.lazy(() => import('../Cruds/EmailAnalysisMails/index.jsx'));
const OperationsReport        = React.lazy(() => import('../Cruds/OperationsReport/index.jsx'));
const DailyBrief              = React.lazy(() => import('../Cruds/DailyBrief/index.jsx'));
const BulkEmailSend           = React.lazy(() => import('../Cruds/BulkEmailSend/index.jsx'));
const OperationsCommandCenter = React.lazy(() => import('../Cruds/OperationsCommandCenter/index.jsx'));
const KnowledgeBase           = React.lazy(() => import('../Cruds/KnowledgeBase/index.jsx'));
const ConnectionsDelivery     = React.lazy(() => import('../Settings/ConnectionsDelivery/index.jsx'));
const Settings                = React.lazy(() => import('../Settings/index.jsx'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <div style={{ width: 40, height: 40, border: '4px solid #e5e5e5', borderTop: '4px solid #007ad9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const S = (Component) => (
  <Suspense fallback={<Loading />}>
    <Component />
  </Suspense>
);

const P = (Component) => (
  <ProtectedRoute>
    {S(Component)}
  </ProtectedRoute>
);

const router = createBrowserRouter([
  // ── Auth routes (no sidebar) ──────────────────────────────────────────────
  { path: '/login',    Component: Login },
  { path: '/register', Component: Register },

  // ── App routes (with Sidebar via Wrapper) ─────────────────────────────────
  {
    path: '/',
    Component: Wrapper,
    children: [
      { index: true, Component: () => <Navigate to="/emailAnalysisMails" replace /> },
      { path: '/emailAnalysisMails',       Component: () => P(EmailAnalysisMails) },
      { path: '/operationsReport',         Component: () => P(OperationsReport) },
      { path: '/dailyBrief',               Component: () => P(DailyBrief) },
      { path: '/bulkEmailSend',            Component: () => P(BulkEmailSend) },
      { path: '/operationsCommandCenter',  Component: () => P(OperationsCommandCenter) },
      { path: '/knowledgeBase',            Component: () => P(KnowledgeBase) },
      { path: '/connectionsDelivery',      Component: () => P(ConnectionsDelivery) },
      { path: '/settings',                 Component: () => P(Settings) },
      { path: '/users',                    Component: () => P(Users) },
      { path: '/roles',                    Component: () => P(Roles) },
      { path: '*',                         Component: () => <Navigate to="/emailAnalysisMails" replace /> },
    ],
  },
]);

export default router;
