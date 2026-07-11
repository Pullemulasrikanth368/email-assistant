import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TabView, TabPanel } from 'primereact/tabview';
import './SettingsTabs.scss';

// Lazy-load each configuration screen so a tab's code loads only when opened
const GeneralSettings = React.lazy(() => import('../index.jsx'));
const ReportConfig = React.lazy(() => import('../../Cruds/ReportConfig/index.jsx'));
const OutlookCategoryConfig = React.lazy(() => import('../OutlookCategoryConfig/index.jsx'));
const KnowledgeBase = React.lazy(() => import('../../Cruds/KnowledgeBase/index.jsx'));
const ConnectionsDelivery = React.lazy(() => import('../ConnectionsDelivery/index.jsx'));

// Tab registry — `key` is used in the URL (?tab=...) so tabs are deep-linkable
const TABS = [
  { key: 'general', header: 'General Settings', icon: 'pi pi-cog', Component: GeneralSettings },
  { key: 'reportConfig', header: 'Report Config', icon: 'pi pi-sliders-h', Component: ReportConfig },
  { key: 'outlookLabels', header: 'Outlook Labels', icon: 'pi pi-tags', Component: OutlookCategoryConfig },
  { key: 'knowledgeBase', header: 'Knowledge Base', icon: 'pi pi-book', Component: KnowledgeBase },
  { key: 'connections', header: 'Connections', icon: 'pi pi-link', Component: ConnectionsDelivery },
];

const TabLoading = () => (
  <div className="ea-settings-tabs__loading">
    <i className="pi pi-spin pi-spinner" />
    <p>Loading…</p>
  </div>
);

const SettingsTabs = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.key === tabParam));

  const handleTabChange = (e) => {
    setSearchParams({ tab: TABS[e.index].key }, { replace: true });
  };

  return (
    <div className="ea-settings-tabs">
      <TabView
        activeIndex={activeIndex}
        onTabChange={handleTabChange}
        renderActiveOnly
        scrollable
        className="ea-settings-tabs__tabview"
      >
        {TABS.map(({ key, header, icon, Component }) => (
          <TabPanel key={key} header={header} leftIcon={`${icon} mr-2`}>
            <Suspense fallback={<TabLoading />}>
              <Component />
            </Suspense>
          </TabPanel>
        ))}
      </TabView>
    </div>
  );
};

export default SettingsTabs;
