import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, server } from '../src/index.js';

afterAll(() => {
  server.close();
});

describe('Health endpoint', () => {
  it('should return ok status', async () => {
    const response = await request(app).get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.uptime).toBeDefined();
  });
});

describe('API endpoint', () => {
  it('should return welcome message', async () => {
    const response = await request(app).get('/api');
    
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Welcome to the Action Packer API');
    expect(response.body.version).toBe('1.0.0');
  });
});

describe('404 handling', () => {
  it('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');
    
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not Found');
  });
});
