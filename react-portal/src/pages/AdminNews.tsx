import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface AgentStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  last_run: string | null;
  last_articles: string[];
}

export const AdminNews: React.FC = () => {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: 'idle',
    last_run: null,
    last_articles: []
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Fetch agent status on mount
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await api.get<AgentStatus>('/api/news/status');
      setAgentStatus(response);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  const runAgent = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await api.post('/api/news/run-agent');
      setMessage(`Agent started: ${(response as any).message}`);
      // Poll for status updates
      setTimeout(() => {
        fetchStatus();
        const pollInterval = setInterval(() => {
          fetchStatus();
          if (agentStatus.state === 'done' || agentStatus.state === 'error') {
            clearInterval(pollInterval);
          }
        }, 2000);
      }, 1000);
    } catch (error) {
      setMessage('Failed to start agent');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const refreshNews = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await api.post('/api/news/refresh');
      setMessage((response as any).message);
    } catch (error) {
      setMessage('Failed to refresh news');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (agentStatus.state) {
      case 'idle': return 'text-slate-400';
      case 'running': return 'text-yellow-400';
      case 'done': return 'text-green-400';
      case 'error': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getStatusIcon = () => {
    switch (agentStatus.state) {
      case 'idle': return 'pause_circle';
      case 'running': return 'progress_activity';
      case 'done': return 'check_circle';
      case 'error': return 'error';
      default: return 'help';
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Agentic News Management</h1>
        
        {/* Status Card */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-4">Agent Status</h2>
          
          <div className="flex items-center gap-3 mb-4">
            <span className={`material-symbols-outlined text-2xl ${getStatusColor()}`}>
              {getStatusIcon()}
            </span>
            <div>
              <p className="text-white font-medium capitalize">{agentStatus.state}</p>
              {agentStatus.last_run && (
                <p className="text-slate-400 text-sm">
                  Last run: {new Date(agentStatus.last_run).toLocaleString()}
                </p>
              )}
            </div>
          </div>
          
          {agentStatus.last_articles.length > 0 && (
            <div className="mt-4">
              <p className="text-slate-400 text-sm mb-2">Last generated articles:</p>
              <ul className="list-disc list-inside text-slate-300 text-sm space-y-1">
                {agentStatus.last_articles.map((article, idx) => (
                  <li key={idx}>{article}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-4">Actions</h2>
          
          <div className="flex gap-4">
            <button
              onClick={runAgent}
              disabled={loading || agentStatus.state === 'running'}
              className="px-6 py-3 bg-primary hover:bg-primary/90 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined">
                {agentStatus.state === 'running' ? 'progress_activity' : 'play_arrow'}
              </span>
              {agentStatus.state === 'running' ? 'Running...' : 'Run Agent'}
            </button>
            
            <button
              onClick={refreshNews}
              disabled={loading}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined">refresh</span>
              Refresh News Feed
            </button>
          </div>
          
          {message && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              message.includes('error') 
                ? 'bg-red-900/50 text-red-300 border border-red-700' 
                : 'bg-green-900/50 text-green-300 border border-green-700'
            }`}>
              {message}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-4">About Agentic News</h2>
          
          <div className="space-y-3 text-slate-300">
            <p>
              The agentic news system automatically:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Searches for the latest AI news from various sources</li>
              <li>Selects the 2 most relevant and interesting articles</li>
              <li>Generates comprehensive 400-600 word articles with analysis</li>
              <li>Finds and includes relevant images</li>
              <li>Saves articles to both the database and as markdown files</li>
            </ul>
            
            <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-600">
              <p className="text-sm text-slate-400">
                <strong>Note:</strong> You need to set the <code>ANTHROPIC_API_KEY</code> environment 
                variable for the agent to work. The articles will appear in the main news feed 
                with an "AI" badge.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
