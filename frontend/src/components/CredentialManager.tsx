/**
 * Credential Manager component
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import { credentialsApi } from '../api';
import type { Credential } from '../types';

type CredentialFormData = {
  name: string;
  scope: 'repo' | 'org';
  target: string;
  token: string;
};

function AddCredentialForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<CredentialFormData>({
    name: '',
    scope: 'repo',
    target: '',
    token: '',
  });
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const createMutation = useMutation({
    mutationFn: credentialsApi.create,
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
    createMutation.mutate(formData);
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold mb-4">Add GitHub Credential</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              placeholder="My Repository PAT"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          
          <div>
            <label className="label">Scope</label>
            <select
              className="input"
              value={formData.scope}
              onChange={(e) =>
                setFormData({ ...formData, scope: e.target.value as 'repo' | 'org' })
              }
            >
              <option value="repo">Repository</option>
              <option value="org">Organization</option>
            </select>
          </div>
          
          <div>
            <label className="label">
              {formData.scope === 'repo' ? 'Repository (owner/repo)' : 'Organization'}
            </label>
            <input
              type="text"
              className="input"
              placeholder={formData.scope === 'repo' ? 'owner/repo' : 'organization-name'}
              value={formData.target}
              onChange={(e) => setFormData({ ...formData, target: e.target.value })}
              required
            />
          </div>
          
          <div>
            <label className="label">Personal Access Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="input pr-10"
                placeholder="ghp_xxxxxxxxxxxx"
                value={formData.token}
                onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-forest-500 hover:text-forest-300"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted mt-1">
              Requires <code className="text-forest-400">admin:org</code> or{' '}
              <code className="text-forest-400">repo</code> scope
            </p>
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
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Credential'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CredentialCard({
  credential,
  onDelete,
}: {
  credential: Credential;
  onDelete: (id: string) => void;
}) {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  
  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await credentialsApi.validate(credential.id);
      setValidationResult({
        valid: result.valid,
        message: result.valid
          ? `Valid (${result.login})`
          : result.error || 'Invalid',
      });
    } catch (err) {
      setValidationResult({
        valid: false,
        message: err instanceof Error ? err.message : 'Validation failed',
      });
    } finally {
      setValidating(false);
    }
  };
  
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-forest-700 rounded-lg">
            <Key className="h-5 w-5 text-forest-300" />
          </div>
          <div>
            <h3 className="font-medium">{credential.name}</h3>
            <p className="text-sm text-muted flex items-center gap-1">
              {credential.scope === 'repo' ? 'Repository' : 'Organization'}:{' '}
              <a
                href={`https://github.com/${credential.target}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-forest-400 hover:text-forest-300 flex items-center gap-1"
              >
                {credential.target}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleValidate}
            className="btn btn-ghost btn-sm"
            disabled={validating}
            title="Validate token"
          >
            <RefreshCw className={`h-4 w-4 ${validating ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onDelete(credential.id)}
            className="btn btn-ghost btn-sm text-red-400 hover:text-red-300 hover:bg-red-900/30"
            title="Delete credential"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      {validationResult && (
        <div
          className={`mt-3 p-2 rounded-md text-sm flex items-center gap-2 ${
            validationResult.valid
              ? 'bg-green-900/30 text-green-300'
              : 'bg-red-900/30 text-red-300'
          }`}
        >
          {validationResult.valid ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {validationResult.message}
        </div>
      )}
      
      <div className="mt-3 text-xs text-muted">
        Added {new Date(credential.created_at).toLocaleDateString()}
        {credential.validated_at && (
          <> · Last validated {new Date(credential.validated_at).toLocaleDateString()}</>
        )}
      </div>
    </div>
  );
}

export function CredentialManager() {
  const [showAddForm, setShowAddForm] = useState(false);
  const queryClient = useQueryClient();
  
  const { data, isLoading, error } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsApi.list(),
  });
  
  const deleteMutation = useMutation({
    mutationFn: credentialsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
  });
  
  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this credential? This will also remove any associated runners.')) {
      deleteMutation.mutate(id);
    }
  };
  
  const credentials = data?.credentials || [];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Credentials</h1>
          <p className="text-muted mt-1">
            Manage GitHub Personal Access Tokens for runner registration
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="btn btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Credential
        </button>
      </div>
      
      {/* Content */}
      {isLoading ? (
        <div className="text-center py-8 text-muted">Loading...</div>
      ) : error ? (
        <div className="card bg-red-900/30 border-red-700 text-red-200">
          Failed to load credentials: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : credentials.length === 0 ? (
        <div className="card text-center py-12">
          <Key className="h-12 w-12 mx-auto text-forest-500 mb-4" />
          <p className="text-muted">No credentials configured</p>
          <p className="text-sm text-forest-500 mt-2">
            Add a GitHub PAT to start registering runners
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn btn-primary mt-4"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Credential
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {credentials.map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
      
      {/* Add Form Modal */}
      {showAddForm && (
        <AddCredentialForm
          onClose={() => setShowAddForm(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['credentials'] });
          }}
        />
      )}
    </div>
  );
}
