/**
 * Native runner manager service
 * Handles downloading, configuring, and managing GitHub Actions runners
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import https from 'https';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar-fs';
import { v4 as uuidv4 } from 'uuid';
import { db, type RunnerRow } from '../db/index.js';
import { type GitHubRunnerDownload } from './github.js';
import { createClientFromCredentialId, resolveCredentialById } from './credentialResolver.js';

// Runner storage directory
export const RUNNERS_DIR = process.env.RUNNERS_DIR || path.join(os.homedir(), '.action-packer', 'runners');

/**
 * Get the cache directory paths for a specific runner.
 * Each runner gets its own isolated cache directories to avoid conflicts.
 */
export function getRunnerCachePaths(runnerDir: string): { [key: string]: string } {
  const cacheBase = path.join(runnerDir, '_caches');
  return {
    cacheBase,
    gradleHome: path.join(cacheBase, 'gradle'),
    npmCache: path.join(cacheBase, 'npm'),
    cocoapodsCache: path.join(cacheBase, 'cocoapods'),
    derivedData: path.join(cacheBase, 'DerivedData'),
    androidHome: path.join(cacheBase, 'android'),
    wrapperBin: path.join(cacheBase, 'bin'),
  };
}

/**
 * xcodebuild wrapper script that automatically adds -derivedDataPath.
 * This is installed in each runner's PATH to intercept xcodebuild calls.
 */
const XCODEBUILD_WRAPPER = `#!/bin/bash
# Action Packer xcodebuild wrapper - automatically routes DerivedData to per-runner directory
DERIVED_DATA_PATH="\${RUNNER_DERIVED_DATA_PATH:-}"
REAL_XCODEBUILD="/usr/bin/xcodebuild"

if [ -z "$DERIVED_DATA_PATH" ]; then
  # No custom path set, use real xcodebuild directly
  exec "$REAL_XCODEBUILD" "$@"
fi

# Check if -derivedDataPath is already specified
for arg in "$@"; do
  if [ "$arg" = "-derivedDataPath" ]; then
    # User already specified it, don't override
    exec "$REAL_XCODEBUILD" "$@"
  fi
done

# Add our derived data path
exec "$REAL_XCODEBUILD" -derivedDataPath "$DERIVED_DATA_PATH" "$@"
`;

/**
 * Create cache directories, install wrapper scripts, and return environment variables.
 */
export async function setupRunnerCacheEnv(runnerDir: string): Promise<{ [key: string]: string }> {
  const cachePaths = getRunnerCachePaths(runnerDir);
  const { platform } = detectPlatform();

  // Create all cache directories
  await Promise.all(
    Object.values(cachePaths).map(dir => fs.mkdir(dir, { recursive: true }))
  );

  // Install xcodebuild wrapper on macOS
  if (platform === 'darwin') {
    const wrapperPath = path.join(cachePaths.wrapperBin, 'xcodebuild');
    await fs.writeFile(wrapperPath, XCODEBUILD_WRAPPER, { mode: 0o755 });
  }

  // Return environment variables that tools will use
  return {
    // Gradle
    GRADLE_USER_HOME: cachePaths.gradleHome,
    // npm
    npm_config_cache: cachePaths.npmCache,
    // CocoaPods
    CP_CACHE_DIR: cachePaths.cocoapodsCache,
    // Android
    ANDROID_USER_HOME: cachePaths.androidHome,
    // Xcode DerivedData (used by wrapper)
    RUNNER_DERIVED_DATA_PATH: cachePaths.derivedData,
    // Prepend wrapper bin to PATH so it intercepts xcodebuild
    PATH: `${cachePaths.wrapperBin}:${process.env.PATH || ''}`,
  };
}

/**
 * Clean up all cache directories for a runner.
 */
export async function cleanupRunnerCaches(runnerDir: string): Promise<void> {
  const cachePaths = getRunnerCachePaths(runnerDir);

  console.log(`[cleanup] Cleaning caches for runner at ${runnerDir}`);

  try {
    await fs.rm(cachePaths.cacheBase, { recursive: true, force: true });
    console.log(`[cleanup] Cleared runner caches`);
  } catch (error) {
    console.warn(`[cleanup] Could not clean caches:`, error);
  }
}

/**
 * Clean up global build caches that may have accumulated from runners
 * before per-runner cache isolation was implemented.
 * Only runs when no runners are currently active.
 */
export async function cleanupGlobalBuildCaches(): Promise<void> {
  const home = os.homedir();
  const { platform } = detectPlatform();

  // Only clean global caches if no runners are currently running
  if (runningProcesses.size > 0) {
    console.log(`[cleanup] Skipping global cache cleanup - ${runningProcesses.size} runners active`);
    return;
  }

  console.log('[cleanup] Cleaning global build caches...');

  const globalCaches = [
    // Xcode DerivedData (macOS) - the main offender
    ...(platform === 'darwin' ? [
      path.join(home, 'Library/Developer/Xcode/DerivedData'),
    ] : []),

    // Global npm cache (we now use per-runner)
    path.join(home, '.npm/_cacache'),

    // Global Gradle caches (we now use per-runner GRADLE_USER_HOME)
    path.join(home, '.gradle/caches'),
    path.join(home, '.gradle/daemon'),

    // CocoaPods cache (macOS)
    ...(platform === 'darwin' ? [
      path.join(home, 'Library/Caches/CocoaPods'),
    ] : []),

    // Android caches
    path.join(home, '.android/cache'),
  ];

  for (const cacheDir of globalCaches) {
    try {
      const stats = await fs.stat(cacheDir).catch(() => null);
      if (stats?.isDirectory()) {
        console.log(`[cleanup] Clearing global cache: ${cacheDir}`);
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`[cleanup] Could not clean ${cacheDir}:`, error);
    }
  }

  console.log('[cleanup] Global build cache cleanup complete');
}

// Track running processes
const runningProcesses = new Map<string, ChildProcess>();

// Track orphaned processes (ones we found running after restart but can't control)
const orphanedProcessIds = new Map<string, number>();

/**
 * Check if a process with the given PID is still running
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = no such process, EPERM = exists but no permission (still alive)
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return true;
    }
    return false;
  }
}

/**
 * Try to kill a process by PID
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a runner as having an orphaned process (running from before restart)
 * We can't control these processes directly, but we can track them and kill them
 */
export function trackOrphanedRunner(runnerId: string, pid: number): void {
  orphanedProcessIds.set(runnerId, pid);
}

/**
 * Check if a runner has an orphaned process or a tracked process running
 */
export function isRunnerProcessAlive(runnerId: string, storedPid?: number | null): boolean {
  // First check our in-memory tracked processes
  if (runningProcesses.has(runnerId)) {
    return true;
  }
  
  // Check orphaned processes
  const orphanedPid = orphanedProcessIds.get(runnerId);
  if (orphanedPid && isProcessAlive(orphanedPid)) {
    return true;
  }
  
  // Check the stored PID from database
  if (storedPid && isProcessAlive(storedPid)) {
    return true;
  }
  
  return false;
}

/**
 * Stop an orphaned runner process
 */
export async function stopOrphanedRunner(runnerId: string, storedPid?: number | null): Promise<boolean> {
  const pid = orphanedProcessIds.get(runnerId) || storedPid;
  
  if (!pid) {
    return false;
  }
  
  if (!isProcessAlive(pid)) {
    orphanedProcessIds.delete(runnerId);
    return false;
  }
  
  console.log(`Stopping orphaned runner process ${runnerId} (PID: ${pid})...`);
  
  // Try graceful shutdown first
  killProcess(pid, 'SIGTERM');
  
  // Wait a bit for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Force kill if still running
  if (isProcessAlive(pid)) {
    console.log(`Force killing orphaned process ${pid}...`);
    killProcess(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  orphanedProcessIds.delete(runnerId);
  return true;
}

// Platform detection
export function detectPlatform(): { platform: NodeJS.Platform; arch: string } {
  return {
    platform: process.platform,
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  };
}

// Prepared statements
const getRunnerById = db.prepare('SELECT * FROM runners WHERE id = ?');
const updateRunnerStatus = db.prepare(`
  UPDATE runners SET status = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerError = db.prepare(`
  UPDATE runners SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerGitHubId = db.prepare(`
  UPDATE runners SET github_runner_id = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerDir = db.prepare(`
  UPDATE runners SET runner_dir = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerProcessId = db.prepare(`
  UPDATE runners SET process_id = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerHeartbeat = db.prepare(`
  UPDATE runners SET last_heartbeat = datetime('now'), updated_at = datetime('now') WHERE id = ?
`);

/**
 * Get the correct runner download for the current platform
 */
function getRunnerDownload(
  downloads: GitHubRunnerDownload[],
  platform: NodeJS.Platform,
  arch: string
): GitHubRunnerDownload | undefined {
  const osMap: Record<string, string> = {
    darwin: 'osx',
    linux: 'linux',
    win32: 'win',
  };
  
  const targetOs = osMap[platform];
  if (!targetOs) return undefined;
  
  return downloads.find(d => d.os === targetOs && d.architecture === arch);
}

/**
 * Download a file from URL
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          file.on('close', async () => {
            try {
              await fs.unlink(destPath).catch(() => {});
              await downloadFile(redirectUrl, destPath);
              resolve();
            } catch (err) {
              reject(new Error(`Redirected download failed: ${err instanceof Error ? err.message : String(err)}`));
            }
          });
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      
      pipeline(response, file)
        .then(() => resolve())
        .catch(reject);
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

/**
 * Extract a tar.gz file
 */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const gunzip = createGunzip();
  const extractStream = extract(destDir);
  
  const fileStream = await fs.open(archivePath, 'r');
  const readStream = fileStream.createReadStream();
  
  await pipeline(readStream, gunzip, extractStream);
}

/**
 * Extract a zip file (for Windows)
 */
async function extractZip(archivePath: string, destDir: string): Promise<void> {
  // Use unzip command on Unix, PowerShell on Windows
  const { platform } = detectPlatform();
  
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    
    if (platform === 'win32') {
      proc = spawn('powershell', [
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
      ]);
    } else {
      proc = spawn('unzip', ['-o', archivePath, '-d', destDir]);
    }
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Extraction failed with code ${code}`));
    });
    
    proc.on('error', reject);
  });
}

/**
 * Download and extract the runner binary
 */
export async function downloadRunner(
  runnerId: string,
  credentialId: string
): Promise<string> {
  const client = await createClientFromCredentialId(credentialId);
  const downloads = await client.getRunnerDownloads();
  
  const { platform, arch } = detectPlatform();
  const download = getRunnerDownload(downloads, platform, arch);
  
  if (!download) {
    throw new Error(`No runner available for ${platform}/${arch}`);
  }
  
  // Create runner directory
  const runnerDir = path.join(RUNNERS_DIR, runnerId);
  await fs.mkdir(runnerDir, { recursive: true });
  
  // Download the runner
  const archivePath = path.join(runnerDir, download.filename);
  console.log(`Downloading runner from ${download.download_url}...`);
  await downloadFile(download.download_url, archivePath);
  
  // Extract
  console.log(`Extracting runner to ${runnerDir}...`);
  if (download.filename.endsWith('.tar.gz')) {
    await extractTarGz(archivePath, runnerDir);
  } else if (download.filename.endsWith('.zip')) {
    await extractZip(archivePath, runnerDir);
  }
  
  // Cleanup archive
  await fs.unlink(archivePath);
  
  // Update runner directory in database
  updateRunnerDir.run(runnerDir, runnerId);
  
  return runnerDir;
}

/**
 * Configure a runner with GitHub
 */
export async function configureRunner(
  runnerId: string,
  runnerName: string,
  labels: string[],
  credentialId: string,
  runnerDir: string,
  ephemeral: boolean = false
): Promise<void> {
  const resolved = await resolveCredentialById(credentialId);
  const client = await createClientFromCredentialId(credentialId);
  
  // Get registration token
  const regToken = await client.createRegistrationToken();
  
  // Build the URL
  const url = resolved.scope === 'repo'
    ? `https://github.com/${resolved.target}`
    : `https://github.com/${resolved.target}`;
  
  // Determine config script
  const { platform } = detectPlatform();
  const configScript = platform === 'win32' ? 'config.cmd' : './config.sh';
  
  // Build arguments
  const args = [
    '--url', url,
    '--token', regToken.token,
    '--name', runnerName,
    '--work', '_work',
    '--unattended',
  ];
  
  if (labels.length > 0) {
    args.push('--labels', labels.join(','));
  }
  
  if (ephemeral) {
    args.push('--ephemeral');
  }
  
  // Run configuration
  return new Promise((resolve, reject) => {
    updateRunnerStatus.run('configuring', runnerId);
    
    const proc = spawn(configScript, args, {
      cwd: runnerDir,
      shell: platform === 'win32',
      env: { ...process.env },
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      console.log(`[config ${runnerId}]`, data.toString().trim());
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error(`[config ${runnerId}]`, data.toString().trim());
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Configuration failed with code ${code}: ${stderr || stdout}`);
        updateRunnerError.run(error.message, runnerId);
        reject(error);
      }
    });
    
    proc.on('error', (err) => {
      updateRunnerError.run(err.message, runnerId);
      reject(err);
    });
  });
}

/**
 * Start a runner process
 */
export async function startRunner(runnerId: string, runnerDir: string): Promise<void> {
  const { platform } = detectPlatform();
  const runScript = platform === 'win32' ? 'run.cmd' : './run.sh';

  // Set up per-runner cache directories and get environment variables
  const cacheEnv = await setupRunnerCacheEnv(runnerDir);

  return new Promise((resolve, reject) => {
    const proc = spawn(runScript, [], {
      cwd: runnerDir,
      shell: platform === 'win32',
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...cacheEnv },
    });
    
    // Store the process
    runningProcesses.set(runnerId, proc);
    
    // Update process ID in database
    if (proc.pid) {
      updateRunnerProcessId.run(proc.pid, runnerId);
    }
    
    proc.stdout?.on('data', (data) => {
      console.log(`[runner ${runnerId}]`, data.toString().trim());
      updateRunnerHeartbeat.run(runnerId);
      
      // Check for status changes in output
      const output = data.toString();
      if (output.includes('Listening for Jobs') || output.includes('Running job')) {
        updateRunnerStatus.run('online', runnerId);
      }
    });
    
    proc.stderr?.on('data', (data) => {
      console.error(`[runner ${runnerId}]`, data.toString().trim());
    });
    
    proc.on('close', (code) => {
      runningProcesses.delete(runnerId);
      updateRunnerProcessId.run(null, runnerId);
      
      // Get runner info to check if ephemeral
      const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
      
      // If the runner record no longer exists (e.g., cleaned up concurrently),
      // skip further cleanup to avoid dereferencing undefined.
      if (!runner) {
        console.warn(`[runner] Runner ${runnerId} not found in database during close handler; skipping cleanup.`);
        return;
      }
      
      if (runner.ephemeral) {
        // Ephemeral runners should be cleaned up when their process exits
        // This happens when they finish a job (exit code 0) or encounter an error
        console.log(`[runner] Ephemeral runner ${runner.name} exited (code: ${code}), cleaning up...`);
        
        // Clean up the runner record and files (async, fire-and-forget)
        (async () => {
          try {
            // Re-fetch the runner to ensure it still exists and is ephemeral
            // (another cleanup mechanism may have already handled it)
            const latestRunner = getRunnerById.get(runnerId) as RunnerRow | undefined;
            if (!latestRunner || !latestRunner.ephemeral) {
              console.warn(
                `[runner] Runner ${runnerId} missing or no longer ephemeral during async cleanup; skipping.`
              );
              return;
            }

            // Delete runner directory (idempotent: force allows missing directories)
            if (latestRunner.runner_dir) {
              await fs.rm(latestRunner.runner_dir, { recursive: true, force: true }).catch(() => {});
            }
            
            // Delete database record (idempotent: guarded on ephemeral flag)
            db.prepare('DELETE FROM runners WHERE id = ? AND ephemeral = 1').run(runnerId);
            console.log(`[runner] Cleaned up ephemeral runner ${latestRunner.name}`);
            
            // Ensure warm runners for the pool (use dynamic import to avoid circular dependency)
            if (latestRunner.pool_id) {
              const { ensureWarmRunners, getPoolById } = await import('./autoscaler.js');
              const pool = getPoolById(latestRunner.pool_id);
              if (pool) {
                await ensureWarmRunners(pool);
              }
            }
          } catch (error) {
            console.error(`[runner] Failed to cleanup ephemeral runner ${runnerId}:`, error);
          }
        })();
      } else {
        // Non-ephemeral runners: clean up caches but keep the runner
        if (runner.runner_dir) {
          cleanupRunnerCaches(runner.runner_dir).catch(err => {
            console.error(`[runner] Failed to cleanup caches for ${runnerId}:`, err);
          });
        }

        if (code === 0) {
          updateRunnerStatus.run('offline', runnerId);
        } else {
          updateRunnerError.run(`Runner exited with code ${code}`, runnerId);
        }
      }
    });
    
    proc.on('error', (err) => {
      runningProcesses.delete(runnerId);
      updateRunnerError.run(err.message, runnerId);
      reject(err);
    });
    
    // Don't wait for the process to finish - it runs indefinitely
    // Give it a moment to start and check for immediate errors
    setTimeout(() => {
      if (runningProcesses.has(runnerId)) {
        updateRunnerStatus.run('online', runnerId);
        resolve();
      }
    }, 2000);
  });
}

/**
 * Stop a running runner
 */
export async function stopRunner(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  const proc = runningProcesses.get(runnerId);
  
  if (proc) {
    // Try graceful shutdown first
    proc.kill('SIGTERM');
    
    // Wait a bit then force kill if needed
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (runningProcesses.has(runnerId)) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, 5000);
      
      proc.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    runningProcesses.delete(runnerId);
  } else {
    // Check for orphaned process
    const stopped = await stopOrphanedRunner(runnerId, runner?.process_id);
    if (!stopped && runner?.process_id && isProcessAlive(runner.process_id)) {
      // Last resort: try to kill by stored PID
      console.log(`Stopping runner ${runnerId} by stored PID: ${runner.process_id}`);
      killProcess(runner.process_id, 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (isProcessAlive(runner.process_id)) {
        killProcess(runner.process_id, 'SIGKILL');
      }
    }
  }
  
  // Clear process ID in database
  updateRunnerProcessId.run(null, runnerId);
  updateRunnerStatus.run('offline', runnerId);
}

/**
 * Clean up runner files directly without GitHub API calls.
 * Use this for orphaned/stale runners that no longer exist in GitHub.
 * This is idempotent - safe to call even if runner is already cleaned up.
 */
export async function cleanupRunnerFiles(runnerDir: string | null): Promise<void> {
  if (!runnerDir) return;
  
  try {
    await fs.rm(runnerDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors - directory may already be gone
  }
}

/**
 * Remove a runner completely (stop, deregister, delete files)
 */
export async function removeRunner(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner) {
    throw new Error('Runner not found');
  }
  
  updateRunnerStatus.run('removing', runnerId);
  
  // Stop the runner if running
  await stopRunner(runnerId);
  
  // Deregister from GitHub if we have a GitHub runner ID
  if (runner.github_runner_id) {
    try {
      const client = await createClientFromCredentialId(runner.credential_id);
      await client.deleteRunner(runner.github_runner_id);
    } catch (error) {
      console.error('Failed to deregister runner from GitHub:', error);
      // Continue with local cleanup anyway
    }
  }
  
  // Run the remove script if directory exists
  if (runner.runner_dir) {
    try {
      const { platform } = detectPlatform();
      const client = await createClientFromCredentialId(runner.credential_id);
      const removeToken = await client.createRemoveToken();
      
      // Run the remove script
      const configScript = platform === 'win32' ? 'config.cmd' : './config.sh';
      
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(configScript, ['remove', '--token', removeToken.token], {
          cwd: runner.runner_dir!,
          shell: platform === 'win32',
        });
        
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Remove script failed with code ${code}`));
        });
        
        proc.on('error', reject);
      });
    } catch (error) {
      console.error('Failed to run remove script:', error);
    }
    
    // Delete the runner directory
    try {
      await fs.rm(runner.runner_dir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to delete runner directory:', error);
    }
  }
}

/**
 * Get the status of a runner
 */
export function getRunnerProcess(runnerId: string): ChildProcess | undefined {
  return runningProcesses.get(runnerId);
}

/**
 * Check if a runner process is running
 */
export function isRunnerRunning(runnerId: string): boolean {
  return runningProcesses.has(runnerId);
}

/**
 * Sync runner status with GitHub
 */
export async function syncRunnerStatus(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner || !runner.github_runner_id) return;
  
  try {
    const client = await createClientFromCredentialId(runner.credential_id);
    const ghRunner = await client.getRunner(runner.github_runner_id);
    
    if (ghRunner) {
      if (ghRunner.busy) {
        updateRunnerStatus.run('busy', runnerId);
      } else if (ghRunner.status === 'online') {
        updateRunnerStatus.run('online', runnerId);
      } else {
        updateRunnerStatus.run('offline', runnerId);
      }
    }
  } catch (error) {
    console.error('Failed to sync runner status:', error);
  }
}

/**
 * Create and start a new runner
 */
export async function createAndStartRunner(
  name: string,
  labels: string[],
  credentialId: string,
  platform: NodeJS.Platform,
  architecture: string,
  isolationType: string,
  ephemeral: boolean = false,
  poolId?: string
): Promise<string> {
  const id = uuidv4();
  
  // Insert runner record
  const insertRunner = db.prepare(`
    INSERT INTO runners (id, name, credential_id, platform, architecture, isolation_type, labels, ephemeral, pool_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  insertRunner.run(
    id,
    name,
    credentialId,
    platform,
    architecture,
    isolationType,
    JSON.stringify(labels),
    ephemeral ? 1 : 0,
    poolId || null
  );
  
  try {
    // Download runner
    const runnerDir = await downloadRunner(id, credentialId);
    
    // Configure runner
    await configureRunner(id, name, labels, credentialId, runnerDir, ephemeral);
    
    // Start runner
    await startRunner(id, runnerDir);
    
    // Try to get the GitHub runner ID
    try {
      const client = await createClientFromCredentialId(credentialId);
      const runners = await client.listRunners();
      const ghRunner = runners.find(r => r.name === name);
      
      if (ghRunner) {
        updateRunnerGitHubId.run(ghRunner.id, id);
      }
    } catch (error) {
      console.error('Failed to get GitHub runner ID:', error);
    }
    
    return id;
  } catch (error) {
    // Mark as error but keep the record
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateRunnerError.run(message, id);
    throw error;
  }
}
