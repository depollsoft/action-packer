import { Workflow } from '../App';
import './WorkflowsList.css';

interface WorkflowsListProps {
  workflows: Workflow[];
}

export function WorkflowsList({ workflows }: WorkflowsListProps) {
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="workflows-list">
      <h2>Workflows</h2>
      {workflows.length === 0 ? (
        <p className="empty-state">No workflows found</p>
      ) : (
        <div className="workflows-grid">
          {workflows.map((workflow) => (
            <div key={workflow.id} className="workflow-card">
              <div className="workflow-header">
                <h3>{workflow.name}</h3>
                <span className={`enabled-badge ${workflow.enabled ? 'enabled' : 'disabled'}`}>
                  {workflow.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="workflow-description">{workflow.description}</p>
              <div className="workflow-details">
                <p>
                  <strong>Last Run:</strong> {formatDate(workflow.lastRun)}
                </p>
                <p>
                  <strong>Triggers:</strong> {workflow.triggers.join(', ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
