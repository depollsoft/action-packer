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
import { decrypt } from '../utils/index.js';
import { createGitHubClient, type GitHubScope, type GitHubRunnerDownload } from './github.js';

// Runner storage directory
const RUNNERS_DIR = process.env.RUNNERS_DIR || path.join(os.homedir(), '.action-packer', 'runners');

// Track running processes
const runningProcesses = new Map<string, ChildProcess>();

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
const getCredentialById = db.prepare('SELECT * FROM credentials WHERE id = ?');

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
          fs.unlink(destPath).catch(() => {});
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
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
  const credential = getCredentialById.get(credentialId) as any;
  if (!credential) {
    throw new Error('Credential not found');
  }
  
  // Decrypt token
  const token = decrypt({
    encrypted: credential.encrypted_token,
    iv: credential.iv,
    authTag: credential.auth_tag,
  });
  
  const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
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
  const credential = getCredentialById.get(credentialId) as any;
  if (!credential) {
    throw new Error('Credential not found');
  }
  
  // Decrypt token
  const token = decrypt({
    encrypted: credential.encrypted_token,
    iv: credential.iv,
    authTag: credential.auth_tag,
  });
  
  const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
  
  // Get registration token
  const regToken = await client.createRegistrationToken();
  
  // Build the URL
  const url = credential.scope === 'repo'
    ? `https://github.com/${credential.target}`
    : `https://github.com/${credential.target}`;
  
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
  
  return new Promise((resolve, reject) => {
    const proc = spawn(runScript, [], {
      cwd: runnerDir,
      shell: platform === 'win32',
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
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
      
      if (code === 0) {
        updateRunnerStatus.run('offline', runnerId);
      } else {
        updateRunnerError.run(`Runner exited with code ${code}`, runnerId);
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
  }
  
  runningProcesses.delete(runnerId);
  updateRunnerStatus.run('offline', runnerId);
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
      const credential = getCredentialById.get(runner.credential_id) as any;
      if (credential) {
        const token = decrypt({
          encrypted: credential.encrypted_token,
          iv: credential.iv,
          authTag: credential.auth_tag,
        });
        
        const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
        await client.deleteRunner(runner.github_runner_id);
      }
    } catch (error) {
      console.error('Failed to deregister runner from GitHub:', error);
      // Continue with local cleanup anyway
    }
  }
  
  // Run the remove script if directory exists
  if (runner.runner_dir) {
    try {
      const { platform } = detectPlatform();
      const credential = getCredentialById.get(runner.credential_id) as any;
      
      if (credential) {
        const token = decrypt({
          encrypted: credential.encrypted_token,
          iv: credential.iv,
          authTag: credential.auth_tag,
        });
        
        const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
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
      }
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
    const credential = getCredentialById.get(runner.credential_id) as any;
    if (!credential) return;
    
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
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
    const credential = getCredentialById.get(credentialId) as any;
    if (credential) {
      const token = decrypt({
        encrypted: credential.encrypted_token,
        iv: credential.iv,
        authTag: credential.auth_tag,
      });
      
      const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
      const runners = await client.listRunners();
      const ghRunner = runners.find(r => r.name === name);
      
      if (ghRunner) {
        updateRunnerGitHubId.run(ghRunner.id, id);
      }
    }
    
    return id;
  } catch (error) {
    // Mark as error but keep the record
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateRunnerError.run(message, id);
    throw error;
  }
}
