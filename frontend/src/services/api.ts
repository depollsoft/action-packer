const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const api = {
  async getActions() {
    const response = await fetch(`${API_BASE_URL}/actions`);
    if (!response.ok) throw new Error('Failed to fetch actions');
    return response.json();
  },

  async getAction(id: string) {
    const response = await fetch(`${API_BASE_URL}/actions/${id}`);
    if (!response.ok) throw new Error('Failed to fetch action');
    return response.json();
  },

  async createAction(action: { name: string; workflow: string }) {
    const response = await fetch(`${API_BASE_URL}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!response.ok) throw new Error('Failed to create action');
    return response.json();
  },

  async deleteAction(id: string) {
    const response = await fetch(`${API_BASE_URL}/actions/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete action');
  },

  async getWorkflows() {
    const response = await fetch(`${API_BASE_URL}/workflows`);
    if (!response.ok) throw new Error('Failed to fetch workflows');
    return response.json();
  },

  async getWorkflow(id: string) {
    const response = await fetch(`${API_BASE_URL}/workflows/${id}`);
    if (!response.ok) throw new Error('Failed to fetch workflow');
    return response.json();
  },

  async createWorkflow(workflow: {
    name: string;
    description: string;
    enabled: boolean;
    triggers: string[];
  }) {
    const response = await fetch(`${API_BASE_URL}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    });
    if (!response.ok) throw new Error('Failed to create workflow');
    return response.json();
  },

  async updateWorkflow(id: string, update: Partial<{
    name: string;
    description: string;
    enabled: boolean;
    triggers: string[];
  }>) {
    const response = await fetch(`${API_BASE_URL}/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!response.ok) throw new Error('Failed to update workflow');
    return response.json();
  },

  async deleteWorkflow(id: string) {
    const response = await fetch(`${API_BASE_URL}/workflows/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete workflow');
  },
};
