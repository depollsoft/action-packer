import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { credentialsRouter } from './routes/credentials.js';
import { runnersRouter } from './routes/runners.js';
import { poolsRouter } from './routes/pools.js';
import { webhooksRouter } from './routes/webhooks.js';
import { onboardingRouter, authRouter, githubAppRouter } from './routes/onboarding.js';
import { logsRouter, setBroadcastFunction } from './routes/logs.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { initializeSchema, db } from './db/index.js';
import { initializeRunnersOnStartup } from './services/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Trust reverse proxies (e.g. Cloudflare Tunnel) for correct protocol/host handling
app.set('trust proxy', true);

const DEBUG_OAUTH = process.env.DEBUG_OAUTH === '1' || process.env.DEBUG_OAUTH === 'true';

function mask(value: string | null | undefined, visible: number = 6): string {
  if (!value) return '<none>';
  if (value.length <= visible) return value;
  return `…${value.slice(-visible)}`;
}

function getQueryParam(originalUrl: string, key: string): string | null {
  try {
    const url = new URL(originalUrl, 'http://localhost');
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

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
  
  // Mark connection as alive for ping/pong heartbeat
  (ws as WebSocket & { isAlive: boolean }).isAlive = true;
  ws.on('pong', () => {
    (ws as WebSocket & { isAlive: boolean }).isAlive = true;
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// WebSocket ping/pong heartbeat to keep connections alive through reverse proxies
// This prevents Cloudflare Tunnel and other proxies from timing out idle connections
const wsHeartbeatInterval = setInterval(() => {
  clients.forEach((ws) => {
    const extWs = ws as WebSocket & { isAlive: boolean };
    if (extWs.isAlive === false) {
      console.log('🔌 Terminating unresponsive WebSocket client');
      clients.delete(ws);
      return ws.terminate();
    }
    extWs.isAlive = false;
    ws.ping();
  });
}, 30000); // Ping every 30 seconds

wsHeartbeatInterval.unref(); // Don't prevent process from exiting

// Broadcast function for real-time updates
export function broadcast(type: string, data: unknown): void {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Register the broadcast function with the logs router to avoid circular imports
setBroadcastFunction(broadcast);

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());

// Extra diagnostics for OAuth callback reachability
if (DEBUG_OAUTH) {
  app.use((req, res, next) => {
    const path = req.path;
    const isOauthRelevant =
      path === '/api/auth/callback' ||
      path === '/api/onboarding/auth/callback' ||
      path === '/api/auth/login' ||
      path === '/api/onboarding/auth/login' ||
      path === '/api/auth/me' ||
      path === '/api/onboarding/auth/me' ||
      path === '/api/auth/logout' ||
      path === '/api/onboarding/auth/logout';

    if (!isOauthRelevant) {
      next();
      return;
    }

    const state = getQueryParam(req.originalUrl, 'state');
    const hasCode = !!getQueryParam(req.originalUrl, 'code');
    const start = Date.now();

    console.log('[oauth] hit', {
      method: req.method,
      url: req.originalUrl,
      host: req.headers.host,
      forwardedHost: req.headers['x-forwarded-host'],
      forwardedProto: req.headers['x-forwarded-proto'],
      userAgent: req.headers['user-agent'],
      query: {
        hasCode,
        state: mask(state),
      },
    });

    res.on('finish', () => {
      console.log('[oauth] done', {
        method: req.method,
        url: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Date.now() - start,
      });
    });

    next();
  });
}
// Capture raw body for webhook signature verification
app.use('/api/webhooks', express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody: Buffer }).rawBody = buf;
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRouter);
app.use('/api', apiRouter);
// Protected admin routes - require authentication after setup is complete
app.use('/api/credentials', requireAuth, credentialsRouter);
app.use('/api/runners', requireAuth, runnersRouter);
app.use('/api/pools', requireAuth, poolsRouter);
// Logs require authentication
app.use('/api/logs', requireAuth, logsRouter);
// Webhooks don't require user auth (they use webhook secret verification)
app.use('/api/webhooks', webhooksRouter);
// Onboarding and auth routes handle their own auth logic
app.use('/api/onboarding', onboardingRouter);
app.use('/api/github-app', githubAppRouter);
app.use('/api/auth', authRouter);

// Production: serve the built frontend from the backend (Option A)
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  const indexHtmlPath = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(frontendDistPath));

    // SPA fallback: send index.html for non-API routes
    // NOTE: Express 5 + path-to-regexp v6 does not accept '*' as a route pattern.
    // Use a regex instead.
    app.get(/^(?!\/(?:api|health|ws)(?:\/|$)).*/, (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
  } else {
    console.warn(`⚠️  Frontend build not found at ${indexHtmlPath}. Run \`npm run build\` first.`);
  }
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3001;

export const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);

  // Initialize runners and pools on startup (skip in test mode)
  if (process.env.NODE_ENV !== 'test') {
    initializeRunnersOnStartup().catch((err) => {
      console.error('❌ Failed to initialize runners on startup:', err);
    });
  }
});

// Graceful shutdown
let shutdownInProgress = false;
let forceExitArmed = false;

function shutdown(signal: string): void {
  if (shutdownInProgress) {
    if (!forceExitArmed) {
      forceExitArmed = true;
      console.log('Shutdown already in progress. Press Ctrl+C again to force exit.');
      return;
    }
    console.log('Force exiting...');
    process.exit(1);
  }

  shutdownInProgress = true;
  console.log(`${signal} received, shutting down...`);

  // If something prevents shutdown (e.g. open sockets), force exit after a short delay.
  const forceTimer = setTimeout(() => {
    console.error('Shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  // Stop accepting new websocket connections and terminate existing ones.
  try {
    wss.close();
  } catch {
    // ignore
  }
  clients.forEach((client) => {
    try {
      client.terminate();
    } catch {
      // ignore
    }
  });
  clients.clear();

  // Stop accepting new HTTP connections.
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
