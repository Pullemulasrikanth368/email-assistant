import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './AiSearchResults.scss';

/**
 * AI Search results screen.
 *
 * Reached from the inbox AI Search input. For now it renders a polished
 * placeholder state; the real prompt-driven results will be wired here later.
 */
const AiSearchResults = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prompt = params.get('q') || '';

  return (
    <div className="ai-search-results">
      {/* Header */}
      <div className="asr-header">
        <Button
          variant="ghost"
          size="icon"
          className="asr-back"
          onClick={() => navigate('/emailAnalysisMails')}
          title="Back to inbox"
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="asr-title">
          <Sparkles size={18} className="asr-title-icon" />
          <span>AI Search</span>
        </div>
      </div>

      {/* Prompt chip */}
      {prompt && (
        <div className="asr-prompt">
          <Search size={15} className="asr-prompt-icon" />
          <span className="asr-prompt-text">{prompt}</span>
        </div>
      )}

      {/* Empty / placeholder state */}
      <div className="asr-body">
        <div className="asr-empty">
          <div className="asr-halo">
            <Sparkles size={34} />
          </div>
          <h2 className="asr-empty-title">This is your prompt results</h2>
          <p className="asr-empty-sub">
            AI-powered search results will appear here once connected.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AiSearchResults;
