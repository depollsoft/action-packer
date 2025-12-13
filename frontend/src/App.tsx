import { useState, useEffect } from 'react';
import { ActionsList } from './components/ActionsList';
import { WorkflowsList } from './components/WorkflowsList';
import { api } from './services/api';
import './App.css';

export interface Action {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  workflow: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  lastRun?: string;
  triggers: string[];
}

function App() {
  const [actions, setActions] = useState<Action[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'actions' | 'workflows'>('actions');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [actionsData, workflowsData] = await Promise.all([
        api.getActions(),
        api.getWorkflows(),
      ]);
      setActions(actionsData);
      setWorkflows(workflowsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Action Packer</h1>
        <p>GitHub Actions Manager</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
          onClick={() => setActiveTab('actions')}
        >
          Actions
        </button>
        <button
          className={`tab ${activeTab === 'workflows' ? 'active' : ''}`}
          onClick={() => setActiveTab('workflows')}
        >
          Workflows
        </button>
      </nav>

      <main className="main">
        {loading && <div className="loading">Loading...</div>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && (
          <>
            {activeTab === 'actions' && <ActionsList actions={actions} />}
            {activeTab === 'workflows' && <WorkflowsList workflows={workflows} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
