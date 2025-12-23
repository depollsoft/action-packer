/**
 * Dashboard component - overview of runners and system status
 */

import { useQuery } from '@tanstack/react-query';
import { Server, Activity, AlertCircle, CheckCircle, Clock, Cpu, Key, Layers } from 'lucide-react';
import { runnersApi, poolsApi, credentialsApi } from '../api';
import type { Runner } from '../types';
import { StatusBadge } from './StatusBadge';

function StatCard({
  title,
  value,
  icon: Icon,
  color = 'forest',
}: {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color?: 'forest' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    forest: 'text-forest-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  };
  
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <Icon className={`h-10 w-10 ${colorClasses[color]}`} />
      </div>
    </div>
  );
}

function RunnerCard({ runner }: { runner: Runner }) {
  const platformIcons: Record<string, string> = {
    darwin: '🍎',
    linux: '🐧',
    win32: '🪟',
  };
  
  return (
    <div className="card card-hover cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{platformIcons[runner.platform] || '💻'}</div>
          <div>
            <h3 className="font-medium">{runner.name}</h3>
            <p className="text-sm text-muted">{runner.target}</p>
          </div>
        </div>
        <StatusBadge status={runner.status} />
      </div>
      
      <div className="mt-4 flex flex-wrap gap-2">
        {runner.labels.map((label) => (
          <span
            key={label}
            className="px-2 py-0.5 bg-forest-700 rounded text-xs text-forest-200"
          >
            {label}
          </span>
        ))}
      </div>
      
      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {runner.architecture}
        </span>
        <span className="flex items-center gap-1">
          <Server className="h-3 w-3" />
          {runner.isolation_type}
        </span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: runnersData, isLoading: runnersLoading } = useQuery({
    queryKey: ['runners'],
    queryFn: () => runnersApi.list(),
    refetchInterval: 10000,
  });
  
  const { data: poolsData, isLoading: poolsLoading } = useQuery({
    queryKey: ['pools'],
    queryFn: () => poolsApi.list(),
    refetchInterval: 10000,
  });
  
  const { data: credentialsData, isLoading: credentialsLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsApi.list(),
  });
  
  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => runnersApi.getSystemInfo(),
  });
  
  const runners = runnersData?.runners || [];
  const pools = poolsData?.pools || [];
  const credentials = credentialsData?.credentials || [];
  
  const stats = {
    total: runners.length,
    online: runners.filter((r) => r.status === 'online').length,
    busy: runners.filter((r) => r.status === 'busy').length,
    error: runners.filter((r) => r.status === 'error').length,
  };
  
  const isLoading = runnersLoading || poolsLoading || credentialsLoading;
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted mt-1">
          Overview of your GitHub Actions runners
        </p>
      </div>
      
      {/* System Info */}
      {systemInfo && (
        <div className="card bg-forest-800/50">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted">Platform:</span>
            <span className="font-medium">
              {systemInfo.platform} ({systemInfo.architecture})
            </span>
            <span className="text-muted ml-4">Docker:</span>
            <span className={systemInfo.dockerAvailable ? 'text-green-400' : 'text-red-400'}>
              {systemInfo.dockerAvailable ? 'Available' : 'Not Available'}
            </span>
          </div>
        </div>
      )}
      
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Runners"
          value={stats.total}
          icon={Server}
          color="forest"
        />
        <StatCard
          title="Online"
          value={stats.online}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          title="Busy"
          value={stats.busy}
          icon={Activity}
          color="yellow"
        />
        <StatCard
          title="Errors"
          value={stats.error}
          icon={AlertCircle}
          color="red"
        />
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Key className="h-4 w-4" />
            <span className="text-sm">Credentials</span>
          </div>
          <p className="text-2xl font-bold">{credentials.length}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Layers className="h-4 w-4" />
            <span className="text-sm">Runner Pools</span>
          </div>
          <p className="text-2xl font-bold">{pools.length}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Ephemeral Runners</span>
          </div>
          <p className="text-2xl font-bold">
            {runners.filter((r) => r.ephemeral).length}
          </p>
        </div>
      </div>
      
      {/* Recent Runners */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Runners</h2>
        {isLoading ? (
          <div className="text-center py-8 text-muted">Loading...</div>
        ) : runners.length === 0 ? (
          <div className="card text-center py-8">
            <Server className="h-12 w-12 mx-auto text-forest-500 mb-4" />
            <p className="text-muted">No runners configured yet</p>
            <p className="text-sm text-forest-500 mt-2">
              Add a credential and create your first runner to get started
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {runners.map((runner) => (
              <RunnerCard key={runner.id} runner={runner} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
