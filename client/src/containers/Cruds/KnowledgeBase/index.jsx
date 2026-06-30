import KnowledgeBaseSettings from '../OperationsReport/KnowledgeBaseSettings';
import '../OperationsReport/OperationsReport.scss';
import './KnowledgeBase.scss';

const KnowledgeBasePage = () => (
  <div className="kb-page">
    <div className="kb-page-header">
      <div className="kb-page-eyebrow">Knowledge base</div>
      <h1 className="kb-page-title">The rules that run the brief</h1>
      <p className="kb-page-sub">
        Everything the AI uses to read, rank, and route your inbox lives here. Edits take effect on the next brief.
      </p>
    </div>
    <div className="kb-page-body">
      <KnowledgeBaseSettings />
    </div>
  </div>
);

export default KnowledgeBasePage;
