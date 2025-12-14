/**
 * Docker runner service
 * Manages GitHub Actions runners in Docker containers (Linux arm64/amd64)
 */

import Docker from 'dockerode';
import { db, type RunnerRow } from '../db/index.js';
import { decrypt } from '../utils/index.js';
import { createGitHubClient, type GitHubScope } from './github.js';

// Docker client
let docker: Docker | null = null;

// Runner image name
const RUNNER_IMAGE = process.env.RUNNER_IMAGE || 'myoung34/github-runner:latest';

// Prepared statements
const getRunnerById = db.prepare('SELECT * FROM runners WHERE id = ?');
const updateRunnerStatus = db.prepare(`
  UPDATE runners SET status = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerError = db.prepare(`
  UPDATE runners SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerContainerId = db.prepare(`
  UPDATE runners SET container_id = ?, updated_at = datetime('now') WHERE id = ?
`);
const updateRunnerGitHubId = db.prepare(`
  UPDATE runners SET github_runner_id = ?, updated_at = datetime('now') WHERE id = ?
`);
const getCredentialById = db.prepare('SELECT * FROM credentials WHERE id = ?');

/**
 * Initialize Docker client
 */
export function initDocker(): Docker {
  if (!docker) {
    docker = new Docker();
  }
  return docker;
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const d = initDocker();
    await d.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Docker info
 */
export async function getDockerInfo(): Promise<object | null> {
  try {
    const d = initDocker();
    return await d.info();
  } catch {
    return null;
  }
}

/**
 * Pull the runner image for the specified platform
 * Note: Docker multi-arch images require explicit platform handling.
 * We pull with --platform and verify the architecture before use.
 */
export async function pullRunnerImage(
  architecture: string = 'amd64'
): Promise<string> {
  const d = initDocker();
  const platform = `linux/${architecture}`;
  // Parse image name and tag (e.g., "myoung34/github-runner:latest" -> repo="myoung34/github-runner", tag="latest")
  const [repo, _originalTag] = RUNNER_IMAGE.includes(':') 
    ? RUNNER_IMAGE.split(':') 
    : [RUNNER_IMAGE, 'latest'];
  const platformTag = `${repo}:${architecture}`;
  
  // Check if we already have the platform-specific tag with correct architecture
  try {
    const existingImage = await d.getImage(platformTag).inspect();
    const imageArch = existingImage.Architecture;
    // Normalize architecture names (amd64 = x64, arm64 = aarch64)
    const normalizedImageArch = imageArch === 'amd64' ? 'amd64' : (imageArch === 'arm64' ? 'arm64' : imageArch);
    const normalizedRequestedArch = architecture === 'x64' ? 'amd64' : architecture;
    
    if (normalizedImageArch === normalizedRequestedArch) {
      console.log(`Image ${platformTag} already exists with correct architecture (${imageArch})`);
      return platformTag;
    }
    console.log(`Image ${platformTag} exists but has wrong architecture (${imageArch}), re-pulling...`);
  } catch {
    // Image doesn't exist, need to pull
  }
  
  console.log(`Pulling image ${RUNNER_IMAGE} for ${platform}...`);
  
  await new Promise<void>((resolve, reject) => {
    d.pull(RUNNER_IMAGE, { platform }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        reject(new Error('No stream returned from pull'));
        return;
      }
      
      d.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      }, (event: { status?: string; progress?: string }) => {
        if (event.status) {
          console.log(`[pull] ${event.status}${event.progress ? ' ' + event.progress : ''}`);
        }
      });
    });
  });
  
  // Verify the pulled image has the correct architecture
  const pulledImage = await d.getImage(RUNNER_IMAGE).inspect();
  console.log(`Pulled image architecture: ${pulledImage.Architecture}`);
  
  // Tag the pulled image with architecture-specific tag
  console.log(`Tagging image as ${platformTag}...`);
  const image = d.getImage(RUNNER_IMAGE);
  await image.tag({ repo, tag: architecture });
  
  // Verify the tagged image
  const taggedImage = await d.getImage(platformTag).inspect();
  console.log(`Tagged image ${platformTag} architecture: ${taggedImage.Architecture}`);
  
  return platformTag;
}

/**
 * Create and start a Docker-based runner
 */
export async function createDockerRunner(
  runnerId: string,
  name: string,
  labels: string[],
  credentialId: string,
  architecture: string,
  ephemeral: boolean = false
): Promise<string> {
  const d = initDocker();
  
  // Get credential
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
  
  // Get registration token
  const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
  const regToken = await client.createRegistrationToken();
  
  // Build repo URL
  const repoUrl = credential.scope === 'repo'
    ? `https://github.com/${credential.target}`
    : `https://github.com/${credential.target}`;
  
  // Pull image and get the platform-specific tag
  const imageTag = await pullRunnerImage(architecture);
  
  // Map architecture to GitHub's label format
  const archLabel = architecture === 'amd64' || architecture === 'x64' ? 'X64' : 'ARM64';
  
  // Environment variables for the container
  const env = [
    `REPO_URL=${repoUrl}`,
    `RUNNER_NAME=${name}`,
    `RUNNER_TOKEN=${regToken.token}`,
    `RUNNER_WORKDIR=/tmp/runner/work`,
    // Disable automatic OS/arch label detection - we'll provide explicit labels
    `DISABLE_AUTO_UPDATE=true`,
  ];
  
  // Build labels: always include self-hosted, linux, and architecture
  // The myoung34/github-runner image adds self-hosted and linux automatically,
  // but we need to override the architecture detection
  const allLabels = ['self-hosted', 'linux', archLabel, ...labels];
  env.push(`LABELS=${allLabels.join(',')}`);
  
  if (ephemeral) {
    env.push('EPHEMERAL=true');
  }
  
  // For organization scope
  if (credential.scope === 'org') {
    env.push(`ORG_NAME=${credential.target}`);
  }
  
  updateRunnerStatus.run('configuring', runnerId);
  
  try {
    // Create container using the architecture-specific image tag
    const container = await d.createContainer({
      Image: imageTag,
      name: `action-packer-${runnerId}`,
      Env: env,
      HostConfig: {
        AutoRemove: ephemeral,
        RestartPolicy: ephemeral ? { Name: 'no' } : { Name: 'unless-stopped' },
      },
      Labels: {
        'action-packer.runner-id': runnerId,
        'action-packer.runner-name': name,
      },
    });
    
    // Update container ID
    updateRunnerContainerId.run(container.id, runnerId);
    
    // Start container
    await container.start();
    
    updateRunnerStatus.run('online', runnerId);
    
    // Try to get the GitHub runner ID after a short delay
    setTimeout(async () => {
      try {
        const runners = await client.listRunners();
        const ghRunner = runners.find(r => r.name === name);
        if (ghRunner) {
          updateRunnerGitHubId.run(ghRunner.id, runnerId);
        }
      } catch (error) {
        console.error('Failed to get GitHub runner ID:', error);
      }
    }, 10000);
    
    return container.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateRunnerError.run(message, runnerId);
    throw error;
  }
}

/**
 * Stop a Docker runner
 */
export async function stopDockerRunner(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner || !runner.container_id) {
    return;
  }
  
  try {
    const d = initDocker();
    const container = d.getContainer(runner.container_id);
    
    // Try graceful stop first
    await container.stop({ t: 10 });
    updateRunnerStatus.run('offline', runnerId);
  } catch (error) {
    // Container might already be stopped
    console.error('Failed to stop container:', error);
    updateRunnerStatus.run('offline', runnerId);
  }
}

/**
 * Start a stopped Docker runner
 */
export async function startDockerRunner(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner || !runner.container_id) {
    throw new Error('Runner or container not found');
  }
  
  try {
    const d = initDocker();
    const container = d.getContainer(runner.container_id);
    await container.start();
    updateRunnerStatus.run('online', runnerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateRunnerError.run(message, runnerId);
    throw error;
  }
}

/**
 * Remove a Docker runner completely
 */
export async function removeDockerRunner(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner) {
    throw new Error('Runner not found');
  }
  
  updateRunnerStatus.run('removing', runnerId);
  
  // Remove from GitHub first
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
    }
  }
  
  // Remove container
  if (runner.container_id) {
    try {
      const d = initDocker();
      const container = d.getContainer(runner.container_id);
      
      // Stop if running
      try {
        await container.stop({ t: 5 });
      } catch {
        // Already stopped
      }
      
      // Remove container
      await container.remove({ force: true });
      updateRunnerContainerId.run(null, runnerId);
    } catch (error) {
      console.error('Failed to remove container:', error);
    }
  }
}

/**
 * Get container status
 */
export async function getContainerStatus(containerId: string): Promise<{
  running: boolean;
  status: string;
} | null> {
  try {
    const d = initDocker();
    const container = d.getContainer(containerId);
    const info = await container.inspect();
    
    return {
      running: info.State.Running,
      status: info.State.Status,
    };
  } catch {
    return null;
  }
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  containerId: string,
  tail: number = 100
): Promise<string> {
  try {
    const d = initDocker();
    const container = d.getContainer(containerId);
    
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });
    
    return logs.toString();
  } catch {
    return '';
  }
}

/**
 * List all Action Packer containers
 */
export async function listActionPackerContainers(): Promise<Docker.ContainerInfo[]> {
  try {
    const d = initDocker();
    return await d.listContainers({
      all: true,
      filters: {
        label: ['action-packer.runner-id'],
      },
    });
  } catch {
    return [];
  }
}

/**
 * Sync container status with database
 */
export async function syncDockerRunnerStatus(runnerId: string): Promise<void> {
  const runner = getRunnerById.get(runnerId) as RunnerRow | undefined;
  if (!runner || !runner.container_id || runner.isolation_type !== 'docker') {
    return;
  }
  
  const status = await getContainerStatus(runner.container_id);
  if (!status) {
    updateRunnerStatus.run('error', runnerId);
    return;
  }
  
  if (status.running) {
    // Check GitHub status for busy state
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
          const ghRunner = await client.getRunner(runner.github_runner_id);
          
          if (ghRunner?.busy) {
            updateRunnerStatus.run('busy', runnerId);
            return;
          }
        }
      } catch {
        // Continue with container status
      }
    }
    updateRunnerStatus.run('online', runnerId);
  } else {
    updateRunnerStatus.run('offline', runnerId);
  }
}
