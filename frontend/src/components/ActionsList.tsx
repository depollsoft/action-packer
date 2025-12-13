import { Action } from '../App';
import './ActionsList.css';

interface ActionsListProps {
  actions: Action[];
}

export function ActionsList({ actions }: ActionsListProps) {
  const getStatusColor = (status: Action['status']) => {
    switch (status) {
      case 'completed':
        return '#28a745';
      case 'running':
        return '#0366d6';
      case 'failed':
        return '#d73a49';
      case 'queued':
        return '#dbab09';
      default:
        return '#586069';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  return (
    <div className="actions-list">
      <h2>Recent Actions</h2>
      {actions.length === 0 ? (
        <p className="empty-state">No actions found</p>
      ) : (
        <div className="actions-grid">
          {actions.map((action) => (
            <div key={action.id} className="action-card">
              <div className="action-header">
                <h3>{action.name}</h3>
                <span
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(action.status) }}
                >
                  {action.status}
                </span>
              </div>
              <div className="action-details">
                <p>
                  <strong>Workflow:</strong> {action.workflow}
                </p>
                <p>
                  <strong>Started:</strong> {formatDate(action.startedAt)}
                </p>
                {action.completedAt && (
                  <p>
                    <strong>Completed:</strong> {formatDate(action.completedAt)}
                  </p>
                )}
                {action.duration !== undefined && (
                  <p>
                    <strong>Duration:</strong> {formatDuration(action.duration)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
