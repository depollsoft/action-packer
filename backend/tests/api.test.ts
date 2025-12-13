import request from 'supertest';
import app from '../src/index.js';

describe('API Health Check', () => {
  it('should return 200 and status ok', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });
});

describe('Actions API', () => {
  it('should get all actions', async () => {
    const response = await request(app).get('/api/actions');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('should get action by ID', async () => {
    const response = await request(app).get('/api/actions/1');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id', '1');
    expect(response.body).toHaveProperty('name');
    expect(response.body).toHaveProperty('status');
  });

  it('should return 404 for non-existent action', async () => {
    const response = await request(app).get('/api/actions/999');
    expect(response.status).toBe(404);
  });

  it('should create a new action', async () => {
    const newAction = {
      name: 'Test Action',
      workflow: 'Test Workflow',
    };
    const response = await request(app)
      .post('/api/actions')
      .send(newAction);
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('name', 'Test Action');
    expect(response.body).toHaveProperty('status', 'queued');
  });
});

describe('Workflows API', () => {
  it('should get all workflows', async () => {
    const response = await request(app).get('/api/workflows');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('should get workflow by ID', async () => {
    const response = await request(app).get('/api/workflows/1');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id', '1');
    expect(response.body).toHaveProperty('name');
    expect(response.body).toHaveProperty('enabled');
  });

  it('should return 404 for non-existent workflow', async () => {
    const response = await request(app).get('/api/workflows/999');
    expect(response.status).toBe(404);
  });

  it('should create a new workflow', async () => {
    const newWorkflow = {
      name: 'Test Workflow',
      description: 'Test Description',
      enabled: true,
      triggers: ['push'],
    };
    const response = await request(app)
      .post('/api/workflows')
      .send(newWorkflow);
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('name', 'Test Workflow');
  });

  it('should update a workflow', async () => {
    const update = { enabled: false };
    const response = await request(app)
      .patch('/api/workflows/1')
      .send(update);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('enabled', false);
  });
});
