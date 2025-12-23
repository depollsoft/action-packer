/**
 * Runner Manager component
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server,
  Plus,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Cpu,
  AlertCircle,
} from 'lucide-react';
import { runnersApi, credentialsApi } from '../api';
import type { Runner, IsolationType, Credential, SystemInfo } from '../types';
import { StatusBadge } from './StatusBadge';


type RunnerFormData = {
  name: string;
  credentialId: string;
  labels: string;
  isolationType: IsolationType;
  architecture: 'x64' | 'arm64';
  ephemeral: boolean;
};

function AddRunnerForm({
  credentials,
  systemInfo,
  onClose,
  onSuccess,
}: {
  credentials: Credential[];
  systemInfo: SystemInfo | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<RunnerFormData>({
    name: '',
    credentialId: credentials[0]?.id || '',
    labels: '',
    isolationType: systemInfo?.defaultIsolation || 'native',
    architecture: systemInfo?.architecture || 'x64',
    ephemeral: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [architectureTouched, setArchitectureTouched] = useState(false);

  useEffect(() => {
    if (!systemInfo || architectureTouched) return;
    setFormData((prev) => ({ ...prev, architecture: systemInfo.architecture }));
  }, [systemInfo, architectureTouched]);
  
  const createMutation = useMutation({
    mutationFn: runnersApi.create,
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const labels = formData.labels
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    
    createMutation.mutate({
      name: formData.name,
      credentialId: formData.credentialId,
      labels,
      isolationType: formData.isolationType,
      architecture: formData.isolationType === 'docker' ? formData.architecture : undefined,
      ephemeral: formData.ephemeral,
    });
  };
  
  const availableIsolationTypes = systemInfo?.supportedIsolationTypes || [
    { type: 'native' as IsolationType, available: true, description: 'Native runner' },
  ];
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold mb-4">Create Runner</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              placeholder="my-runner"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          
          <div>
            <label className="label">Credential</label>
            <select
              className="input"
              value={formData.credentialId}
              onChange={(e) => setFormData({ ...formData, credentialId: e.target.value })}
              required
            >
              {credentials.map((cred) => (
                <option key={cred.id} value={cred.id}>
                  {cred.name} ({cred.target})
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="label">Labels (comma-separated)</label>
            <input
              type="text"
              className="input"
              placeholder="self-hosted, linux, x64"
              value={formData.labels}
              onChange={(e) => setFormData({ ...formData, labels: e.target.value })}
            />
            <p className="text-xs text-muted mt-1">
              Optional labels for job targeting
            </p>
          </div>
          
          <div>
            <label className="label">Isolation Type</label>
            <select
              className="input"
              value={formData.isolationType}
              onChange={(e) =>
                setFormData({ ...formData, isolationType: e.target.value as IsolationType })
              }
            >
              {availableIsolationTypes.map((type) => (
                <option key={type.type} value={type.type} disabled={!type.available}>
                  {type.description}
                  {!type.available && ' (unavailable)'}
                </option>
              ))}
            </select>
            {formData.isolationType === 'docker' && (
              <p className="text-xs text-yellow-400 mt-1">
                Docker runners are Linux-only and won't match macOS/Windows jobs
              </p>
            )}
          </div>
          
          {formData.isolationType === 'docker' && (
            <div>
              <label className="label">Architecture</label>
              <select
                className="input"
                value={formData.architecture}
                onChange={(e) => {
                  setArchitectureTouched(true);
                  setFormData({ ...formData, architecture: e.target.value as 'x64' | 'arm64' });
                }}
              >
                <option value="arm64">
                  {systemInfo?.architecture === 'arm64' ? 'ARM64 (native)' : 'ARM64'}
                </option>
                <option value="x64">
                  x64/AMD64{systemInfo?.architecture === 'arm64' ? ' (emulated on ARM64)' : ''}
                </option>
              </select>
              {formData.architecture === 'x64' && systemInfo?.architecture === 'arm64' && (
                <p className="text-xs text-yellow-400 mt-1">
                  ⚠️ x64 will run under emulation on ARM64, which may be slower
                </p>
              )}
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ephemeral"
              className="h-4 w-4 rounded border-forest-500 bg-forest-800 text-forest-500 focus:ring-forest-500"
              checked={formData.ephemeral}
              onChange={(e) => setFormData({ ...formData, ephemeral: e.target.checked })}
            />
            <label htmlFor="ephemeral" className="text-sm text-secondary">
              Ephemeral (one-time use, auto-removes after job)
            </label>
          </div>
          
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-md text-sm text-red-200">
              {error}
            </div>
          )}
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={createMutation.isPending || credentials.length === 0}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Runner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RunnerRow({
  runner,
  onStart,
  onStop,
  onSync,
  onDelete,
}: {
  runner: Runner;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const platformIcons: Record<string, string> = {
    darwin: '🍎',
    linux: '🐧',
    win32: '🪟',
  };

  const platformLabels: Record<string, string> = {
    darwin: 'macos',
    linux: 'linux',
    win32: 'windows',
  };

  const effectivePlatform = runner.isolation_type === 'docker' ? 'linux' : runner.platform;
  
  const canStart = runner.status === 'offline';
  const canStop = runner.status === 'online' || runner.status === 'busy';
  
  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <span className="text-xl">{platformIcons[effectivePlatform] || '💻'}</span>
          <div>
            <div className="font-medium">{runner.name}</div>
            <div className="text-xs text-muted">{runner.target}</div>
          </div>
        </div>
      </td>
      <td>
        <StatusBadge status={runner.status} />
        {runner.error_message && (
          <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {runner.error_message.length > 50
              ? `${runner.error_message.slice(0, 50)}...`
              : runner.error_message}
          </div>
        )}
      </td>
      <td>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Cpu className="h-4 w-4" />
          {platformLabels[effectivePlatform] || effectivePlatform}/{runner.architecture}
        </div>
      </td>
      <td>
        <span className="text-sm">{runner.isolation_type}</span>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {runner.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 bg-forest-700 rounded text-xs text-forest-200"
            >
              {label}
            </span>
          ))}
          {runner.labels.length > 3 && (
            <span className="px-1.5 py-0.5 text-xs text-muted">
              +{runner.labels.length - 3}
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="flex items-center gap-1">
          {canStart && (
            <button
              onClick={() => onStart(runner.id)}
              className="btn btn-ghost btn-sm text-green-400"
              title="Start runner"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {canStop && (
            <button
              onClick={() => onStop(runner.id)}
              className="btn btn-ghost btn-sm text-yellow-400"
              title="Stop runner"
            >
              <Square className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => onSync(runner.id)}
            className="btn btn-ghost btn-sm"
            title="Sync status"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(runner.id)}
            className="btn btn-ghost btn-sm text-red-400"
            title="Delete runner"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function RunnerManager() {
  const [showAddForm, setShowAddForm] = useState(false);
  const queryClient = useQueryClient();
  
  const { data: runnersData, isLoading: runnersLoading } = useQuery({
    queryKey: ['runners'],
    queryFn: () => runnersApi.list(),
    refetchInterval: 5000,
  });
  
  const { data: credentialsData } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsApi.list(),
  });
  
  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => runnersApi.getSystemInfo(),
  });
  
  const startMutation = useMutation({
    mutationFn: runnersApi.start,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runners'] }),
  });
  
  const stopMutation = useMutation({
    mutationFn: runnersApi.stop,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runners'] }),
  });
  
  const syncMutation = useMutation({
    mutationFn: runnersApi.sync,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runners'] }),
  });
  
  const deleteMutation = useMutation({
    mutationFn: runnersApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runners'] }),
  });
  
  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this runner? This will stop the runner and deregister it from GitHub.')) {
      deleteMutation.mutate(id);
    }
  };
  
  const runners = runnersData?.runners || [];
  const credentials = credentialsData?.credentials || [];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runners</h1>
          <p className="text-muted mt-1">
            Manage your self-hosted GitHub Actions runners
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="btn btn-primary"
          disabled={credentials.length === 0}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Runner
        </button>
      </div>
      
      {credentials.length === 0 && (
        <div className="card bg-yellow-900/30 border-yellow-700 text-yellow-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <span>Add a credential before creating runners</span>
          </div>
        </div>
      )}
      
      {/* Runners Table */}
      {runnersLoading ? (
        <div className="text-center py-8 text-muted">Loading...</div>
      ) : runners.length === 0 ? (
        <div className="card text-center py-12">
          <Server className="h-12 w-12 mx-auto text-forest-500 mb-4" />
          <p className="text-muted">No runners configured</p>
          <p className="text-sm text-forest-500 mt-2">
            Create a runner to start processing GitHub Actions jobs
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Runner</th>
                <th>Status</th>
                <th>OS/Arch</th>
                <th>Isolation</th>
                <th>Labels</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runners.map((runner) => (
                <RunnerRow
                  key={runner.id}
                  runner={runner}
                  onStart={startMutation.mutate}
                  onStop={stopMutation.mutate}
                  onSync={syncMutation.mutate}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Add Form Modal */}
      {showAddForm && (
        <AddRunnerForm
          credentials={credentials}
          systemInfo={systemInfo}
          onClose={() => setShowAddForm(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['runners'] });
          }}
        />
      )}
    </div>
  );
}
