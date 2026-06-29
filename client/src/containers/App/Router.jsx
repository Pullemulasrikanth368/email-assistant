import { createBrowserRouter } from 'react-router-dom';
import React, { Suspense } from 'react';
import Wrapper from './Wrapper.jsx';
import { ProtectedRoute } from './ProtectedRoute.jsx';

// Lazy-load only the email analysis screens
const EmailAnalysisMails = React.lazy(() => import('../Cruds/EmailAnalysisMails/index.jsx'));
const OperationsReport   = React.lazy(() => import('../Cruds/OperationsReport/index.jsx'));
const DailyBrief         = React.lazy(() => import('../Cruds/DailyBrief/index.jsx'));
const BulkEmailSend      = React.lazy(() => import('../Cruds/BulkEmailSend/index.jsx'));
const OperationsCommandCenter = React.lazy(() => import('../Cruds/OperationsCommandCenter/index.jsx'));
const ConnectionsDelivery = React.lazy(() => import('../Settings/ConnectionsDelivery/index.jsx'));

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

const router = createBrowserRouter([
  {
    path: '/',
    Component: Wrapper,
    children: [
      {
        index: true,
        Component: () => {
          window.location.replace('/emailAnalysisMails');
          return null;
        },
      },
      {
        path: '/emailAnalysisMails',
        Component: () => S(EmailAnalysisMails),
      },
      {
        path: '/operationsReport',
        Component: () => S(OperationsReport),
      },
      {
        path: '/dailyBrief',
        Component: () => S(DailyBrief),
      },
      {
        path: '/bulkEmailSend',
        Component: () => S(BulkEmailSend),
      },
      {
        path: '/operationsCommandCenter',
        Component: () => S(OperationsCommandCenter),
      },
      {
        path: '/connectionsDelivery',
        Component: () => S(ConnectionsDelivery),
      },
    ],
  },
]);

export default router;
