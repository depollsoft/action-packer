/**
 * Tests for pools API routes
 */

import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { app, server } from '../src/index.js';
import db from '../src/db/schema.js';

describe('Pools API', () => {
  let credentialId: string;

  // Helper to generate unique targets
  let testCounter = 0;
  function uniqueTarget() {
    return `owner/repo-pools-${Date.now()}-${++testCounter}`;
  }

  beforeEach(async () => {
    // Create a credential for pool tests
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
    db.exec('DELETE FROM runner_pools');
    db.exec('DELETE FROM credentials');
  });

  describe('GET /api/pools', () => {
    it('should return empty array when no pools exist', async () => {
      const response = await request(app).get('/api/pools');
      expect(response.status).toBe(200);
      expect(response.body.pools).toEqual([]);
    });
  });

  describe('POST /api/pools', () => {
    it('should create a new pool', async () => {
      const response = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
          labels: ['self-hosted', 'linux'],
          minRunners: 0,
          maxRunners: 5,
          warmRunners: 1,
          idleTimeoutMinutes: 10,
        });
      
      expect(response.status).toBe(201);
      expect(response.body.pool).toBeDefined();
      expect(response.body.pool.name).toBe('test-pool-1');
      expect(response.body.pool.min_runners).toBe(0);
      expect(response.body.pool.max_runners).toBe(5);
      expect(response.body.pool.enabled).toBe(true);
    });

    it('should reject missing credential ID', async () => {
      const response = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          labels: ['self-hosted'],
        });
      
      expect(response.status).toBe(400);
    });

    it('should reject invalid credential ID', async () => {
      const response = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: 'non-existent-id',
          labels: ['self-hosted'],
        });
      
      expect(response.status).toBe(404);
    });

    it('should validate min/max runner constraints', async () => {
      const response = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
          minRunners: 10,
          maxRunners: 5, // Invalid: max < min
        });
      
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/pools/:id', () => {
    it('should return a specific pool', async () => {
      // Create a pool first
      const createResponse = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
          labels: ['self-hosted'],
        });
      
      const id = createResponse.body.pool.id;
      
      const response = await request(app).get(`/api/pools/${id}`);
      expect(response.status).toBe(200);
      expect(response.body.pool.id).toBe(id);
    });

    it('should return 404 for non-existent pool', async () => {
      const response = await request(app).get('/api/pools/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/pools/:id', () => {
    it('should update pool settings', async () => {
      // Create a pool first
      const createResponse = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
          minRunners: 0,
          maxRunners: 5,
        });
      
      const id = createResponse.body.pool.id;
      
      const response = await request(app)
        .patch(`/api/pools/${id}`)
        .send({
          maxRunners: 10,
          warmRunners: 2,
        });
      
      expect(response.status).toBe(200);
      expect(response.body.pool.max_runners).toBe(10);
      expect(response.body.pool.warm_runners).toBe(2);
    });

    it('should toggle pool enabled state', async () => {
      // Create a pool first
      const createResponse = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
        });
      
      const id = createResponse.body.pool.id;
      
      const response = await request(app)
        .patch(`/api/pools/${id}`)
        .send({ enabled: false });
      
      expect(response.status).toBe(200);
      expect(response.body.pool.enabled).toBe(false);
    });
  });

  describe('DELETE /api/pools/:id', () => {
    it('should delete a pool', async () => {
      // Create a pool first
      const createResponse = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-1',
          credentialId: credentialId,
        });
      
      const id = createResponse.body.pool.id;
      
      const response = await request(app).delete(`/api/pools/${id}`);
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await request(app).get(`/api/pools/${id}`);
      expect(getResponse.status).toBe(404);
    });

    it('should clean up associated runners when deleting a pool', async () => {
      // Create a pool first
      const createResponse = await request(app)
        .post('/api/pools')
        .send({
          name: 'test-pool-with-runners',
          credentialId: credentialId,
        });
      
      const poolId = createResponse.body.pool.id;
      
      // Insert test runners directly into the database (simulating runners that exist)
      // Note: These are simplified test runners without runner_dir or process_id.
      // The cleanup code handles this gracefully - removeRunner will fail but the
      // fallback cleanup and database deletion will still succeed.
      const runnerId1 = 'test-runner-1-' + Date.now();
      const runnerId2 = 'test-runner-2-' + Date.now();
      
      db.prepare(`
        INSERT INTO runners (id, name, status, pool_id, credential_id, isolation_type, ephemeral, platform, architecture, labels)
        VALUES (?, ?, 'offline', ?, ?, 'native', 0, 'linux', 'x64', '[]')
      `).run(runnerId1, 'test-runner-1', poolId, credentialId);
      
      db.prepare(`
        INSERT INTO runners (id, name, status, pool_id, credential_id, isolation_type, ephemeral, platform, architecture, labels)
        VALUES (?, ?, 'offline', ?, ?, 'native', 0, 'linux', 'x64', '[]')
      `).run(runnerId2, 'test-runner-2', poolId, credentialId);
      
      // Verify runners exist
      const runnersBefore = db.prepare('SELECT id FROM runners WHERE pool_id = ?').all(poolId);
      expect(runnersBefore.length).toBe(2);
      
      // Delete the pool
      const response = await request(app).delete(`/api/pools/${poolId}`);
      expect(response.status).toBe(204);
      
      // Verify the pool is deleted
      const getPoolResponse = await request(app).get(`/api/pools/${poolId}`);
      expect(getPoolResponse.status).toBe(404);
      
      // Verify runners are also deleted (not just orphaned with NULL pool_id)
      const runnersAfter = db.prepare('SELECT id FROM runners WHERE id IN (?, ?)').all(runnerId1, runnerId2);
      expect(runnersAfter.length).toBe(0);
    });
  });
});
