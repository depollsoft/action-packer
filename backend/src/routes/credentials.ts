/**
 * Credentials API routes
 * Handles PAT storage, validation, and management
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, type CredentialRow } from '../db/index.js';
import { encrypt, decrypt } from '../utils/index.js';
import { createGitHubClient, type GitHubScope } from '../services/github.js';

export const credentialsRouter = Router();

type CreateCredentialBody = {
  name: string;
  type?: 'pat' | 'github_app';
  scope: 'repo' | 'org';
  target: string;
  token: string;
};

type UpdateCredentialBody = {
  name?: string;
  token?: string;
};

// Prepared statements
const insertCredential = db.prepare(`
  INSERT INTO credentials (id, name, type, scope, target, encrypted_token, iv, auth_tag)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getCredentialById = db.prepare(`
  SELECT * FROM credentials WHERE id = ?
`);

const getAllCredentials = db.prepare(`
  SELECT id, name, type, scope, target, created_at, updated_at, validated_at
  FROM credentials ORDER BY created_at DESC
`);

const updateCredentialName = db.prepare(`
  UPDATE credentials SET name = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateCredentialToken = db.prepare(`
  UPDATE credentials SET encrypted_token = ?, iv = ?, auth_tag = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateCredentialValidation = db.prepare(`
  UPDATE credentials SET validated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
`);

const deleteCredentialById = db.prepare(`
  DELETE FROM credentials WHERE id = ?
`);

/**
 * List all credentials (without sensitive token data)
 */
credentialsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const credentials = getAllCredentials.all();
    res.json({ credentials });
  } catch (error) {
    console.error('Failed to list credentials:', error);
    res.status(500).json({ error: 'Failed to list credentials' });
  }
});

/**
 * Get a single credential by ID (without token)
 */
credentialsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Return without sensitive data
    const { encrypted_token: _et, iv: _iv, auth_tag: _at, ...safeCredential } = credential;
    res.json({ credential: safeCredential });
  } catch (error) {
    console.error('Failed to get credential:', error);
    res.status(500).json({ error: 'Failed to get credential' });
  }
});

/**
 * Create a new credential
 */
credentialsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateCredentialBody;
    
    // Validate required fields
    if (!body.name || !body.scope || !body.target || !body.token) {
      res.status(400).json({ error: 'Missing required fields: name, scope, target, token' });
      return;
    }
    
    // Validate scope
    if (body.scope !== 'repo' && body.scope !== 'org') {
      res.status(400).json({ error: 'Invalid scope. Must be "repo" or "org"' });
      return;
    }
    
    // Validate target format for repo scope
    if (body.scope === 'repo' && !body.target.includes('/')) {
      res.status(400).json({ error: 'Invalid target for repo scope. Expected format: owner/repo' });
      return;
    }
    
    // Validate the token with GitHub
    const client = createGitHubClient(body.token, body.scope as GitHubScope, body.target);
    const validation = await client.validateToken();
    
    if (!validation.valid) {
      res.status(400).json({ error: `Invalid token: ${validation.error}` });
      return;
    }
    
    // Check admin access
    const accessCheck = await client.checkAdminAccess();
    if (!accessCheck.hasAccess) {
      res.status(403).json({ error: accessCheck.error || 'Insufficient permissions' });
      return;
    }
    
    // Encrypt the token
    const { encrypted, iv, authTag } = encrypt(body.token);
    
    // Create credential
    const id = uuidv4();
    insertCredential.run(
      id,
      body.name,
      body.type || 'pat',
      body.scope,
      body.target,
      encrypted,
      iv,
      authTag
    );
    
    // Update validation timestamp
    updateCredentialValidation.run(id);
    
    res.status(201).json({
      credential: {
        id,
        name: body.name,
        type: body.type || 'pat',
        scope: body.scope,
        target: body.target,
        validated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Failed to create credential:', error);
    // Check for UNIQUE constraint violation
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'A credential for this target already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

/**
 * Update a credential
 */
credentialsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    const body = req.body as UpdateCredentialBody;
    
    // Update name if provided
    if (body.name) {
      updateCredentialName.run(body.name, req.params.id);
    }
    
    // Update token if provided
    if (body.token) {
      // Validate the new token
      const client = createGitHubClient(body.token, credential.scope as GitHubScope, credential.target);
      const validation = await client.validateToken();
      
      if (!validation.valid) {
        res.status(400).json({ error: `Invalid token: ${validation.error}` });
        return;
      }
      
      // Check admin access
      const accessCheck = await client.checkAdminAccess();
      if (!accessCheck.hasAccess) {
        res.status(403).json({ error: accessCheck.error || 'Insufficient permissions' });
        return;
      }
      
      // Encrypt and update
      const { encrypted, iv, authTag } = encrypt(body.token);
      updateCredentialToken.run(encrypted, iv, authTag, req.params.id);
      updateCredentialValidation.run(req.params.id);
    }
    
    // Get updated credential
    const updated = getCredentialById.get(req.params.id) as CredentialRow;
    const { encrypted_token: _et, iv: _iv, auth_tag: _at, ...safeCredential } = updated;
    
    res.json({ credential: safeCredential });
  } catch (error) {
    console.error('Failed to update credential:', error);
    res.status(500).json({ error: 'Failed to update credential' });
  }
});

/**
 * Delete a credential
 */
credentialsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id);
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    deleteCredentialById.run(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

/**
 * Validate a credential's token
 */
credentialsRouter.post('/:id/validate', async (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Decrypt the token
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    // Validate with GitHub
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
    const validation = await client.validateToken();
    
    if (!validation.valid) {
      res.json({ valid: false, error: validation.error });
      return;
    }
    
    // Check admin access
    const accessCheck = await client.checkAdminAccess();
    if (!accessCheck.hasAccess) {
      res.json({ valid: false, error: accessCheck.error });
      return;
    }
    
    // Update validation timestamp
    updateCredentialValidation.run(req.params.id);
    
    res.json({ valid: true, login: validation.login });
  } catch (error) {
    console.error('Failed to validate credential:', error);
    res.status(500).json({ error: 'Failed to validate credential' });
  }
});

/**
 * List repositories accessible with this credential
 */
credentialsRouter.get('/:id/repos', async (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Decrypt the token
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
    const repos = await client.listRepositories();
    
    res.json({ repositories: repos });
  } catch (error) {
    console.error('Failed to list repositories:', error);
    res.status(500).json({ error: 'Failed to list repositories' });
  }
});

/**
 * List organizations accessible with this credential
 */
credentialsRouter.get('/:id/orgs', async (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Decrypt the token
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
    const orgs = await client.listOrganizations();
    
    res.json({ organizations: orgs });
  } catch (error) {
    console.error('Failed to list organizations:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

/**
 * Get GitHub runners registered for this credential's target
 */
credentialsRouter.get('/:id/github-runners', async (req: Request, res: Response) => {
  try {
    const credential = getCredentialById.get(req.params.id) as CredentialRow | undefined;
    
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Decrypt the token
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
    const runners = await client.listRunners();
    
    res.json({ runners });
  } catch (error) {
    console.error('Failed to list GitHub runners:', error);
    res.status(500).json({ error: 'Failed to list GitHub runners' });
  }
});
