/**
 * Tests for runners API routes
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { app, server } from '../src/index.js';
import db from '../src/db/schema.js';

describe('Runners API', () => {
  let credentialId: string;

  // Helper to generate unique targets
  let testCounter = 0;
  function uniqueTarget() {
    return `owner/repo-runners-${Date.now()}-${++testCounter}`;
  }

  beforeEach(async () => {
    // Create a credential for runner tests
    const response = await request(app)
      .post('/api/credentials')
      .send({
        name: 'Test PAT',
        scope: 'repo',
        target: uniqueTarget(),
        token: 'ghp_test_token_12345',
      });
    credentialId = response.body.credential.id;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    // Clean up test data
    db.exec('DELETE FROM runners');
    db.exec('DELETE FROM credentials');
  });

  describe('GET /api/runners/system-info', () => {
    it('should return system information', async () => {
      const response = await request(app).get('/api/runners/system-info');
      expect(response.status).toBe(200);
      expect(response.body.platform).toBeDefined();
      expect(response.body.architecture).toBeDefined();
      expect(response.body.dockerAvailable).toBeDefined();
      expect(response.body.supportedIsolationTypes).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/runners', () => {
    it('should return empty array when no runners exist', async () => {
      const response = await request(app).get('/api/runners');
      expect(response.status).toBe(200);
      expect(response.body.runners).toEqual([]);
    });
  });

  describe('POST /api/runners', () => {
    it('should create a new runner', async () => {
      const response = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          credentialId: credentialId,
          labels: ['self-hosted', 'test'],
          isolationType: 'native',
        });
      
      expect(response.status).toBe(202);  // 202 Accepted because runner creation is async
      expect(response.body.runner).toBeDefined();
      expect(response.body.runner.name).toBe('test-runner-1');
      expect(response.body.runner.status).toBe('pending');
      expect(response.body.runner.labels).toContain('self-hosted');
    });

    it('should reject missing credential ID', async () => {
      const response = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          labels: ['self-hosted'],
        });
      
      expect(response.status).toBe(400);
    });

    it('should reject invalid credential ID', async () => {
      const response = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          credentialId: 'non-existent-id',
          labels: ['self-hosted'],
        });
      
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/runners/:id', () => {
    it('should return a specific runner', async () => {
      // Create a runner first
      const createResponse = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          credentialId: credentialId,
          labels: ['self-hosted'],
        });
      
      const id = createResponse.body.runner.id;
      
      const response = await request(app).get(`/api/runners/${id}`);
      expect(response.status).toBe(200);
      expect(response.body.runner.id).toBe(id);
    });

    it('should return 404 for non-existent runner', async () => {
      const response = await request(app).get('/api/runners/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/runners/:id', () => {
    it('should update runner labels', async () => {
      // Create a runner first
      const createResponse = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          credentialId: credentialId,
          labels: ['self-hosted'],
        });
      
      const id = createResponse.body.runner.id;
      
      const response = await request(app)
        .patch(`/api/runners/${id}`)
        .send({ labels: ['self-hosted', 'linux', 'x64'] });
      
      expect(response.status).toBe(200);
      expect(response.body.runner.labels).toContain('linux');
    });
  });

  describe('DELETE /api/runners/:id', () => {
    it('should delete a runner', async () => {
      // Create a runner first
      const createResponse = await request(app)
        .post('/api/runners')
        .send({
          name: 'test-runner-1',
          credentialId: credentialId,
          labels: ['self-hosted'],
        });
      
      const id = createResponse.body.runner.id;
      
      const response = await request(app).delete(`/api/runners/${id}`);
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await request(app).get(`/api/runners/${id}`);
      expect(getResponse.status).toBe(404);
    });
  });
});
