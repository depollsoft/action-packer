import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout, Dashboard, CredentialManager, RunnerManager, PoolManager } from './components';
import { useWebSocket } from './hooks';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
    },
  },
});

export type Page = 'dashboard' | 'credentials' | 'runners' | 'pools' | 'settings';

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const { isConnected, lastMessage } = useWebSocket();

  // Handle WebSocket messages for real-time updates
  useEffect(() => {
    if (lastMessage) {
      console.log('WebSocket message:', lastMessage);
      // Trigger query invalidations based on message type
      if (lastMessage.type === 'runner_update') {
        queryClient.invalidateQueries({ queryKey: ['runners'] });
      } else if (lastMessage.type === 'pool_update') {
        queryClient.invalidateQueries({ queryKey: ['pools'] });
      } else if (lastMessage.type === 'credential_update') {
        queryClient.invalidateQueries({ queryKey: ['credentials'] });
      }
    }
  }, [lastMessage]);

  const handlePageChange = (page: string) => {
    setCurrentPage(page as Page);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'credentials':
        return <CredentialManager />;
      case 'runners':
        return <RunnerManager />;
      case 'pools':
        return <PoolManager />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout
      currentPage={currentPage}
      onPageChange={handlePageChange}
      isConnected={isConnected}
    >
      {renderPage()}
    </Layout>
  );
}

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted mt-1">Configure Action Packer preferences</p>
      </div>

      <div className="card">
        <h2 className="font-medium mb-4">Environment</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">API URL</span>
            <span className="font-mono">{import.meta.env.VITE_API_URL || 'http://localhost:3001'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">WebSocket URL</span>
            <span className="font-mono">ws://localhost:3001/ws</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-medium mb-4">Webhook Configuration</h2>
        <p className="text-sm text-muted mb-4">
          To enable autoscaling, configure GitHub to send webhook events to your server.
        </p>
        <div className="bg-forest-800 p-3 rounded-md font-mono text-sm">
          POST /api/webhooks/github
        </div>
        <p className="text-xs text-muted mt-2">
          Configure this URL in your repository or organization webhook settings.
          Enable the <code className="bg-forest-800 px-1 rounded">workflow_job</code> event.
        </p>
      </div>

      <div className="card">
        <h2 className="font-medium mb-4">About</h2>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-muted">Version:</span> 1.0.0
          </p>
          <p className="text-muted">
            Action Packer is a self-hosted GitHub Actions runner management application.
            It provides an interface for creating, managing, and autoscaling GitHub Actions runners.
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
