import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { credentialsRouter } from './routes/credentials.js';
import { runnersRouter } from './routes/runners.js';
import { poolsRouter } from './routes/pools.js';
import { webhooksRouter } from './routes/webhooks.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { initializeSchema, db } from './db/index.js';

const app = express();
const httpServer = createServer(app);

// Initialize database schema
initializeSchema();
console.log('📦 Database initialized');

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Track connected clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  clients.add(ws);
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Broadcast function for real-time updates
export function broadcast(type: string, data: unknown): void {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRouter);
app.use('/api', apiRouter);
app.use('/api/credentials', credentialsRouter);
app.use('/api/runners', runnersRouter);
app.use('/api/pools', poolsRouter);
app.use('/api/webhooks', webhooksRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3001;

export const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

export { app };
