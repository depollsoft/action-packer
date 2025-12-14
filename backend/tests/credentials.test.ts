/**
 * Tests for credentials API routes
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { app, server } from '../src/index.js';
import db from '../src/db/schema.js';

// Helper to generate unique targets
let testCounter = 0;
function uniqueTarget() {
  return `owner/repo-${Date.now()}-${++testCounter}`;
}

describe('Credentials API', () => {
  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    // Clean up test data
    db.exec('DELETE FROM credentials');
  });

  describe('GET /api/credentials', () => {
    it('should return empty array when no credentials exist', async () => {
      const response = await request(app).get('/api/credentials');
      expect(response.status).toBe(200);
      expect(response.body.credentials).toEqual([]);
    });
  });

  describe('POST /api/credentials', () => {
    it('should create a new credential', async () => {
      const response = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          scope: 'repo',
          target: uniqueTarget(),
          token: 'ghp_test_token_12345',
        });
      
      expect(response.status).toBe(201);
      expect(response.body.credential).toBeDefined();
      expect(response.body.credential.name).toBe('Test PAT');
      expect(response.body.credential.scope).toBe('repo');
      expect(response.body.credential.target).toContain('owner/repo');
      expect(response.body.credential.type).toBe('pat');
      // Token should not be returned
      expect(response.body.credential.token).toBeUndefined();
      expect(response.body.credential.encrypted_token).toBeUndefined();
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          // Missing scope, target, token
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid scope', async () => {
      const response = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          scope: 'invalid',
          target: 'owner/repo',
          token: 'ghp_test_token_12345',
        });
      
      expect(response.status).toBe(400);
    });

    it('should reject duplicate credentials for same target', async () => {
      const target = uniqueTarget();
      // Create first credential
      await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT 1',
          scope: 'repo',
          target: target,
          token: 'ghp_test_token_12345',
        });
      
      // Try to create duplicate
      const response = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT 2',
          scope: 'repo',
          target: target,
          token: 'ghp_test_token_67890',
        });
      
      expect(response.status).toBe(409);
    });
  });

  describe('GET /api/credentials/:id', () => {
    it('should return a specific credential', async () => {
      // Create a credential first
      const createResponse = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          scope: 'repo',
          target: uniqueTarget(),
          token: 'ghp_test_token_12345',
        });
      
      const id = createResponse.body.credential.id;
      
      const response = await request(app).get(`/api/credentials/${id}`);
      expect(response.status).toBe(200);
      expect(response.body.credential.id).toBe(id);
      expect(response.body.credential.name).toBe('Test PAT');
    });

    it('should return 404 for non-existent credential', async () => {
      const response = await request(app).get('/api/credentials/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/credentials/:id', () => {
    it('should update credential name', async () => {
      // Create a credential first
      const createResponse = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          scope: 'repo',
          target: uniqueTarget(),
          token: 'ghp_test_token_12345',
        });
      
      const id = createResponse.body.credential.id;
      
      const response = await request(app)
        .patch(`/api/credentials/${id}`)
        .send({ name: 'Updated PAT' });
      
      expect(response.status).toBe(200);
      expect(response.body.credential.name).toBe('Updated PAT');
    });
  });

  describe('DELETE /api/credentials/:id', () => {
    it('should delete a credential', async () => {
      // Create a credential first
      const createResponse = await request(app)
        .post('/api/credentials')
        .send({
          name: 'Test PAT',
          scope: 'repo',
          target: uniqueTarget(),
          token: 'ghp_test_token_12345',
        });
      
      const id = createResponse.body.credential.id;
      
      const response = await request(app).delete(`/api/credentials/${id}`);
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await request(app).get(`/api/credentials/${id}`);
      expect(getResponse.status).toBe(404);
    });

    it('should return 404 for non-existent credential', async () => {
      const response = await request(app).delete('/api/credentials/non-existent-id');
      expect(response.status).toBe(404);
    });
  });
});
