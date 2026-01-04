/**
 * Pool Manager component for autoscaling runner pools
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Users,
  Activity,
  AlertCircle,
  Pencil,
} from 'lucide-react';
import { poolsApi, credentialsApi, runnersApi } from '../api';
import type { RunnerPool, IsolationType, Credential, SystemInfo } from '../types';

type PoolFormData = {
  name: string;
  credentialId: string;
  labels: string;
  isolationType: IsolationType;
  architecture: 'x64' | 'arm64';
  minRunners: number;
  maxRunners: number;
  warmRunners: number;
  idleTimeoutMinutes: number;
};

function AddPoolForm({
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
  const [formData, setFormData] = useState<PoolFormData>({
    name: '',
    credentialId: credentials[0]?.id || '',
    labels: '',
    isolationType: systemInfo?.defaultIsolation || 'native',
    architecture: systemInfo?.architecture || 'x64',
    minRunners: 0,
    maxRunners: 5,
    warmRunners: 1,
    idleTimeoutMinutes: 10,
  });
  const [error, setError] = useState<string | null>(null);
  const [architectureTouched, setArchitectureTouched] = useState(false);

  useEffect(() => {
    if (!systemInfo || architectureTouched) return;
    setFormData((prev) => ({ ...prev, architecture: systemInfo.architecture }));
  }, [systemInfo, architectureTouched]);
  
  const createMutation = useMutation({
    mutationFn: poolsApi.create,
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
      minRunners: formData.minRunners,
      maxRunners: formData.maxRunners,
      warmRunners: formData.warmRunners,
      idleTimeoutMinutes: formData.idleTimeoutMinutes,
    });
  };
  
  const availableIsolationTypes = systemInfo?.supportedIsolationTypes || [
    { type: 'native' as IsolationType, available: true, description: 'Native runner' },
  ];
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Create Runner Pool</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Pool Name</label>
            <input
              type="text"
              className="input"
              placeholder="my-pool"
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
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Min Runners</label>
              <input
                type="number"
                className="input"
                min={0}
                value={formData.minRunners}
                onChange={(e) =>
                  setFormData({ ...formData, minRunners: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className="label">Max Runners</label>
              <input
                type="number"
                className="input"
                min={1}
                value={formData.maxRunners}
                onChange={(e) =>
                  setFormData({ ...formData, maxRunners: parseInt(e.target.value) || 1 })
                }
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Warm Runners</label>
              <input
                type="number"
                className="input"
                min={0}
                value={formData.warmRunners}
                onChange={(e) =>
                  setFormData({ ...formData, warmRunners: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted mt-1">Pre-warmed idle runners</p>
            </div>
            <div>
              <label className="label">Idle Timeout (min)</label>
              <input
                type="number"
                className="input"
                min={1}
                value={formData.idleTimeoutMinutes}
                onChange={(e) =>
                  setFormData({ ...formData, idleTimeoutMinutes: parseInt(e.target.value) || 10 })
                }
              />
            </div>
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
              {createMutation.isPending ? 'Creating...' : 'Create Pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type EditPoolFormData = {
  name: string;
  labels: string;
  minRunners: number;
  maxRunners: number;
  warmRunners: number;
  idleTimeoutMinutes: number;
};

function EditPoolForm({
  pool,
  onClose,
  onSuccess,
}: {
  pool: RunnerPool;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<EditPoolFormData>({
    name: pool.name,
    labels: pool.labels.join(', '),
    minRunners: pool.min_runners,
    maxRunners: pool.max_runners,
    warmRunners: pool.warm_runners,
    idleTimeoutMinutes: pool.idle_timeout_minutes,
  });
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof poolsApi.update>[1]) =>
      poolsApi.update(pool.id, data),
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

    // Validate
    if (formData.minRunners > formData.maxRunners) {
      setError('Min runners cannot exceed max runners');
      return;
    }
    if (formData.warmRunners > formData.maxRunners) {
      setError('Warm runners cannot exceed max runners');
      return;
    }

    updateMutation.mutate({
      name: formData.name,
      labels,
      minRunners: formData.minRunners,
      maxRunners: formData.maxRunners,
      warmRunners: formData.warmRunners,
      idleTimeoutMinutes: formData.idleTimeoutMinutes,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Edit Pool: {pool.name}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Pool Name</label>
            <input
              type="text"
              className="input"
              placeholder="my-pool"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
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
          </div>

          {/* Read-only info */}
          <div className="p-3 bg-forest-800/50 rounded-md text-sm text-muted space-y-1">
            <p>
              <span className="font-medium text-forest-200">Credential:</span>{' '}
              {pool.credential_name} ({pool.target})
            </p>
            <p>
              <span className="font-medium text-forest-200">Isolation:</span>{' '}
              {pool.isolation_type}
            </p>
            <p>
              <span className="font-medium text-forest-200">Platform:</span>{' '}
              {pool.platform} / {pool.architecture}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Min Runners</label>
              <input
                type="number"
                className="input"
                min={0}
                value={formData.minRunners}
                onChange={(e) =>
                  setFormData({ ...formData, minRunners: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className="label">Max Runners</label>
              <input
                type="number"
                className="input"
                min={1}
                value={formData.maxRunners}
                onChange={(e) =>
                  setFormData({ ...formData, maxRunners: parseInt(e.target.value) || 1 })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Warm Runners</label>
              <input
                type="number"
                className="input"
                min={0}
                value={formData.warmRunners}
                onChange={(e) =>
                  setFormData({ ...formData, warmRunners: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted mt-1">Pre-warmed idle runners</p>
            </div>
            <div>
              <label className="label">Idle Timeout (min)</label>
              <input
                type="number"
                className="input"
                min={1}
                value={formData.idleTimeoutMinutes}
                onChange={(e) =>
                  setFormData({ ...formData, idleTimeoutMinutes: parseInt(e.target.value) || 10 })
                }
              />
            </div>
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
              disabled={updateMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PoolCard({
  pool,
  onToggle,
  onDelete,
  onEdit,
}: {
  pool: RunnerPool;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (pool: RunnerPool) => void;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${pool.enabled ? 'bg-green-900/50' : 'bg-gray-700'}`}>
            <Layers className={`h-5 w-5 ${pool.enabled ? 'text-green-400' : 'text-gray-400'}`} />
          </div>
          <div>
            <h3 className="font-medium">{pool.name}</h3>
            <p className="text-sm text-muted">{pool.target}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(pool)}
            className="btn btn-ghost btn-sm text-forest-300"
            title="Edit pool"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onToggle(pool.id, !pool.enabled)}
            className={`btn btn-ghost btn-sm ${pool.enabled ? 'text-green-400' : 'text-gray-400'}`}
            title={pool.enabled ? 'Disable pool' : 'Enable pool'}
          >
            {pool.enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onDelete(pool.id)}
            className="btn btn-ghost btn-sm text-red-400"
            title="Delete pool"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold">{pool.runner_count}</div>
          <div className="text-xs text-muted flex items-center justify-center gap-1">
            <Users className="h-3 w-3" />
            Total
          </div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">{pool.online_count}</div>
          <div className="text-xs text-muted">Online</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-400">{pool.busy_count}</div>
          <div className="text-xs text-muted flex items-center justify-center gap-1">
            <Activity className="h-3 w-3" />
            Busy
          </div>
        </div>
      </div>
      
      {/* Config */}
      <div className="mt-4 pt-4 border-t border-forest-700">
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>Min: {pool.min_runners}</span>
          <span>Max: {pool.max_runners}</span>
          <span>Warm: {pool.warm_runners}</span>
          <span>Idle timeout: {pool.idle_timeout_minutes}m</span>
        </div>
      </div>
      
      {/* Labels */}
      {pool.labels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {pool.labels.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 bg-forest-700 rounded text-xs text-forest-200"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PoolManager() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPool, setEditingPool] = useState<RunnerPool | null>(null);
  const queryClient = useQueryClient();
  
  const { data: poolsData, isLoading } = useQuery({
    queryKey: ['pools'],
    queryFn: () => poolsApi.list(),
    refetchInterval: 10000,
  });
  
  const { data: credentialsData } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsApi.list(),
  });
  
  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => runnersApi.getSystemInfo(),
  });
  
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      poolsApi.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pools'] }),
  });
  
  const deleteMutation = useMutation({
    mutationFn: poolsApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pools'] }),
  });
  
  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this pool? Runners in the pool will be orphaned.')) {
      deleteMutation.mutate(id);
    }
  };
  
  const pools = poolsData?.pools || [];
  const credentials = credentialsData?.credentials || [];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runner Pools</h1>
          <p className="text-muted mt-1">
            Configure autoscaling pools for ephemeral runners
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="btn btn-primary"
          disabled={credentials.length === 0}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Pool
        </button>
      </div>
      
      {credentials.length === 0 && (
        <div className="card bg-yellow-900/30 border-yellow-700 text-yellow-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <span>Add a credential before creating pools</span>
          </div>
        </div>
      )}
      
      {/* Info Card */}
      <div className="card bg-forest-800/50">
        <h3 className="font-medium mb-2">How Autoscaling Works</h3>
        <ul className="text-sm text-muted space-y-1">
          <li>• Pools maintain a configurable number of warm (idle) runners</li>
          <li>• When a job is queued, new runners are spun up automatically</li>
          <li>• Ephemeral runners are removed after completing a job</li>
          <li>• Requires webhook setup to receive GitHub events</li>
        </ul>
      </div>
      
      {/* Pools */}
      {isLoading ? (
        <div className="text-center py-8 text-muted">Loading...</div>
      ) : pools.length === 0 ? (
        <div className="card text-center py-12">
          <Layers className="h-12 w-12 mx-auto text-forest-500 mb-4" />
          <p className="text-muted">No runner pools configured</p>
          <p className="text-sm text-forest-500 mt-2">
            Create a pool to enable autoscaling
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })}
              onDelete={handleDelete}
              onEdit={setEditingPool}
            />
          ))}
        </div>
      )}
      
      {/* Add Form Modal */}
      {showAddForm && (
        <AddPoolForm
          credentials={credentials}
          systemInfo={systemInfo}
          onClose={() => setShowAddForm(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['pools'] });
          }}
        />
      )}

      {/* Edit Form Modal */}
      {editingPool && (
        <EditPoolForm
          pool={editingPool}
          onClose={() => setEditingPool(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['pools'] });
          }}
        />
      )}
    </div>
  );
}
