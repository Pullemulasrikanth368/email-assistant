import { useState } from 'react';
import ReportConfigPanel from '../OperationsReport/ReportConfigPanel';
import '../OperationsReport/OperationsReport.scss';
import './ReportConfig.scss';

const ReportConfigPage = () => {
  const [selectedConfigId, setSelectedConfigId] = useState(null);

  return (
    <div className="rc-page">
      <div className="rc-page-header">
        <div className="rc-page-eyebrow">Operations command center</div>
        <h1 className="rc-page-title">Report Configuration</h1>
        <p className="rc-page-sub">
          Create and manage report configurations that control which sections, fields, filters
          and output style are used when generating a brief.
        </p>
      </div>
      <div className="rc-page-body">
        <ReportConfigPanel
          selectedConfigId={selectedConfigId}
          onSelect={setSelectedConfigId}
        />
      </div>
    </div>
  );
};

export default ReportConfigPage;
