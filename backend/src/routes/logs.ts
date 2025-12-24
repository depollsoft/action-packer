/**
 * Logs API routes
 * Provides live log streaming for the application and runners
 */

import { Router, Request, Response } from 'express';
import { getContainerLogs } from '../services/dockerRunner.js';
import { db, type RunnerRow } from '../db/index.js';
import { spawn } from 'child_process';
import path from 'node:path';

export const logsRouter = Router();

// Ring buffer for application logs
const MAX_LOG_ENTRIES = 1000;
const logBuffer: LogEntry[] = [];

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  source: string;
};

let logIdCounter = 0;

// Capture console output and store in ring buffer
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleDebug = console.debug;

function addLogEntry(level: LogLevel, message: string, source = 'app'): void {
  const entry: LogEntry = {
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
  };
  
  logBuffer.push(entry);
  
  // Keep buffer at max size
  while (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
  
  // Broadcast to WebSocket clients
  try {
    // Dynamic import to avoid circular dependency
    import('../index.js').then(({ broadcast }) => {
      broadcast('log_entry', entry);
    }).catch(() => {
      // Ignore broadcast errors during startup
    });
  } catch {
    // Ignore errors
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

// Override console methods to capture logs
console.log = (...args: unknown[]) => {
  originalConsoleLog.apply(console, args);
  addLogEntry('info', formatArgs(args));
};

console.warn = (...args: unknown[]) => {
  originalConsoleWarn.apply(console, args);
  addLogEntry('warn', formatArgs(args));
};

console.error = (...args: unknown[]) => {
  originalConsoleError.apply(console, args);
  addLogEntry('error', formatArgs(args));
};

console.debug = (...args: unknown[]) => {
  originalConsoleDebug.apply(console, args);
  addLogEntry('debug', formatArgs(args));
};

// Prepared statements
const getRunnerById = db.prepare('SELECT * FROM runners WHERE id = ?');

/**
 * Get recent application logs
 */
logsRouter.get('/', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, MAX_LOG_ENTRIES);
    const since = req.query.since ? parseInt(req.query.since as string) : 0;
    const level = req.query.level as LogLevel | undefined;
    
    let logs = since > 0 
      ? logBuffer.filter(log => log.id > since)
      : logBuffer.slice(-limit);
    
    // Filter by level if specified
    if (level) {
      const levels: LogLevel[] = level === 'error' 
        ? ['error'] 
        : level === 'warn' 
          ? ['error', 'warn']
          : level === 'info'
            ? ['error', 'warn', 'info']
            : ['error', 'warn', 'info', 'debug'];
      logs = logs.filter(log => levels.includes(log.level));
    }
    
    res.json({ 
      logs,
      lastId: logs.length > 0 ? logs[logs.length - 1].id : since,
    });
  } catch (error) {
    console.error('Failed to get logs:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * Get logs for a specific runner
 */
logsRouter.get('/runner/:id', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    const tail = Math.min(parseInt(req.query.tail as string) || 100, 1000);
    
    if (runner.isolation_type === 'docker' && runner.container_id) {
      // Get Docker container logs
      const logs = await getContainerLogs(runner.container_id, tail);
      res.json({ 
        logs: parseDockerLogs(logs),
        type: 'docker',
        containerId: runner.container_id,
      });
    } else if (runner.runner_dir) {
      // Get native runner logs from the runner directory
      const logs = await getNativeRunnerLogs(runner.runner_dir, tail);
      res.json({ 
        logs,
        type: 'native',
        runnerDir: runner.runner_dir,
      });
    } else {
      res.json({ 
        logs: [],
        type: runner.isolation_type,
        message: 'No logs available for this runner',
      });
    }
  } catch (error) {
    console.error('Failed to get runner logs:', error);
    res.status(500).json({ error: 'Failed to get runner logs' });
  }
});

/**
 * Stream logs for a specific runner via SSE (Server-Sent Events)
 */
logsRouter.get('/runner/:id/stream', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    if (runner.isolation_type === 'docker' && runner.container_id) {
      // Stream Docker container logs
      await streamDockerLogs(runner.container_id, res, req);
    } else if (runner.runner_dir) {
      // Stream native runner logs
      await streamNativeRunnerLogs(runner.runner_dir, res, req);
    } else {
      res.write('data: {"error": "No logs available for this runner"}\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Failed to stream runner logs:', error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to stream logs' })}\n\n`);
    res.end();
  }
});

/**
 * Parse Docker logs (which have timestamps and stream markers)
 */
function parseDockerLogs(rawLogs: string): Array<{ timestamp: string; message: string; stream: 'stdout' | 'stderr' }> {
  if (!rawLogs) return [];
  
  return rawLogs.split('\n').filter(line => line.trim()).map(line => {
    // Docker logs with timestamps: "2024-01-01T00:00:00.000000000Z message"
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)$/);
    if (match) {
      return {
        timestamp: match[1],
        message: match[2],
        stream: 'stdout' as const,
      };
    }
    return {
      timestamp: new Date().toISOString(),
      message: line,
      stream: 'stdout' as const,
    };
  });
}

/**
 * Get logs for a native runner from its log files
 */
async function getNativeRunnerLogs(runnerDir: string, tail: number): Promise<Array<{ timestamp: string; message: string }>> {
  const logs: Array<{ timestamp: string; message: string }> = [];
  
  try {
    // Check common log locations
    const logFiles = [
      path.join(runnerDir, '_diag', 'Runner_*.log'),
      path.join(runnerDir, '_diag', 'Worker_*.log'),
    ];
    
    // Use tail to get last N lines from log files
    const { execSync } = await import('child_process');
    
    for (const pattern of logFiles) {
      try {
        const result = execSync(`tail -n ${tail} ${pattern} 2>/dev/null || true`, {
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        
        if (result) {
          const lines = result.split('\n').filter(line => line.trim());
          for (const line of lines) {
            // Try to parse timestamp from log line
            const match = line.match(/^\[(\d{4}-\d{2}-\d{2}\s+[\d:.]+)\s+\w+\s+\w+\]\s*(.*)$/);
            if (match) {
              logs.push({
                timestamp: new Date(match[1]).toISOString(),
                message: match[2],
              });
            } else {
              logs.push({
                timestamp: new Date().toISOString(),
                message: line,
              });
            }
          }
        }
      } catch {
        // Ignore errors for individual files
      }
    }
  } catch {
    // Return empty if we can't read logs
  }
  
  // Sort by timestamp and return last N entries
  return logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-tail);
}

/**
 * Stream Docker container logs via SSE
 */
async function streamDockerLogs(containerId: string, res: Response, req: Request): Promise<void> {
  const { default: Docker } = await import('dockerode');
  const docker = new Docker();
  
  try {
    const container = docker.getContainer(containerId);
    
    // Check if container exists and is running
    const info = await container.inspect();
    if (!info.State.Running) {
      res.write(`data: ${JSON.stringify({ info: 'Container is not running' })}\n\n`);
    }
    
    // Get log stream with follow
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: 50,
      timestamps: true,
    });
    
    // Handle stream data
    stream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        const parsed = parseDockerLogs(line)[0];
        if (parsed) {
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        }
      }
    });
    
    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ info: 'Log stream ended' })}\n\n`);
      res.end();
    });
    
    stream.on('error', (error: Error) => {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });
    
    // Clean up on client disconnect
    req.on('close', () => {
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}

/**
 * Stream native runner logs via SSE using tail -f
 */
async function streamNativeRunnerLogs(runnerDir: string, res: Response, req: Request): Promise<void> {
  const diagDir = path.join(runnerDir, '_diag');
  
  // Find the most recent log file
  const { execSync } = await import('child_process');
  let logFile: string;
  
  try {
    logFile = execSync(`ls -t ${diagDir}/Runner_*.log 2>/dev/null | head -1`, {
      encoding: 'utf-8',
    }).trim();
    
    if (!logFile) {
      res.write(`data: ${JSON.stringify({ info: 'No log files found' })}\n\n`);
      res.end();
      return;
    }
  } catch {
    res.write(`data: ${JSON.stringify({ info: 'No log files found' })}\n\n`);
    res.end();
    return;
  }
  
  // Use tail -f to follow the log file
  const tail = spawn('tail', ['-f', '-n', '50', logFile]);
  
  tail.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const match = line.match(/^\[(\d{4}-\d{2}-\d{2}\s+[\d:.]+)\s+\w+\s+\w+\]\s*(.*)$/);
      const entry = match 
        ? { timestamp: new Date(match[1]).toISOString(), message: match[2] }
        : { timestamp: new Date().toISOString(), message: line };
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  });
  
  tail.stderr.on('data', (data: Buffer) => {
    res.write(`data: ${JSON.stringify({ error: data.toString() })}\n\n`);
  });
  
  tail.on('close', () => {
    res.write(`data: ${JSON.stringify({ info: 'Log stream ended' })}\n\n`);
    res.end();
  });
  
  // Clean up on client disconnect
  req.on('close', () => {
    tail.kill();
  });
}
