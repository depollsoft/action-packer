/**
 * Status Badge component with emoji indicators and hover tooltips
 */

import type { RunnerStatus } from '../types';

type StatusConfig = {
  emoji: string;
  label: string;
  description: string;
  colorClass: string;
};

const statusConfig: Record<RunnerStatus, StatusConfig> = {
  online: {
    emoji: '🟢',
    label: 'Online',
    description: 'Runner is connected and ready to accept jobs',
    colorClass: 'text-green-400',
  },
  offline: {
    emoji: '⚫',
    label: 'Offline',
    description: 'Runner is not connected to GitHub',
    colorClass: 'text-gray-400',
  },
  busy: {
    emoji: '🔵',
    label: 'Busy',
    description: 'Runner is currently executing a job',
    colorClass: 'text-blue-400',
  },
  error: {
    emoji: '🔴',
    label: 'Error',
    description: 'Runner encountered an error',
    colorClass: 'text-red-400',
  },
  pending: {
    emoji: '🟡',
    label: 'Pending',
    description: 'Runner is being provisioned',
    colorClass: 'text-yellow-400',
  },
  configuring: {
    emoji: '🟠',
    label: 'Configuring',
    description: 'Runner is registering with GitHub',
    colorClass: 'text-orange-400',
  },
  removing: {
    emoji: '⏳',
    label: 'Removing',
    description: 'Runner is being deregistered and cleaned up',
    colorClass: 'text-gray-400',
  },
};

export function StatusBadge({ 
  status, 
  showLabel = true,
  size = 'md',
}: { 
  status: RunnerStatus;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const config = statusConfig[status] || statusConfig.offline;
  
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };
  
  return (
    <span 
      className={`inline-flex items-center gap-1.5 ${sizeClasses[size]}`}
      title={config.description}
    >
      <span role="img" aria-label={config.label}>{config.emoji}</span>
      {showLabel && (
        <span className={config.colorClass}>{config.label}</span>
      )}
    </span>
  );
}

/**
 * Compact status indicator (emoji only) for tables and lists
 */
export function StatusIndicator({ status }: { status: RunnerStatus }) {
  return <StatusBadge status={status} showLabel={false} size="md" />;
}

/**
 * Status legend for explaining what each status means
 */
export function StatusLegend() {
  const statuses: RunnerStatus[] = ['online', 'busy', 'pending', 'configuring', 'offline', 'error', 'removing'];
  
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {statuses.map((status) => {
        const config = statusConfig[status];
        return (
          <span key={status} className="inline-flex items-center gap-1" title={config.description}>
            <span>{config.emoji}</span>
            <span className="text-muted">{config.label}</span>
          </span>
        );
      })}
    </div>
  );
}
