/**
 * Services module entry point
 */

export {
  GitHubClient,
  createGitHubClient,
  createGitHubClientFromOctokit,
  type GitHubScope,
  type GitHubRunner,
  type GitHubRunnerDownload,
  type RegistrationToken,
  type Repository,
  type Organization,
} from './github.js';

export {
  GitHubAppClient,
  generateAppManifest,
  generateAppJWT,
  exchangeManifestCode,
  getAppInfo,
  listInstallations,
  getRepoInstallation,
  getOrgInstallation,
  getUserInstallation,
  getInstallationAccessToken,
  getOAuthAuthorizationUrl,
  exchangeOAuthCode,
  getAuthenticatedUser,
  type GitHubAppManifest,
  type GitHubAppPermissions,
  type GitHubWebhookEvent,
  type GitHubAppCredentials,
  type GitHubAppInstallation,
  type InstallationAccessToken,
  type GitHubUserAccessToken,
  type GitHubUser,
} from './githubApp.js';

export {
  detectPlatform,
  downloadRunner,
  configureRunner,
  startRunner,
  stopRunner,
  removeRunner,
  getRunnerProcess,
  isRunnerRunning,
  isRunnerProcessAlive,
  isProcessAlive,
  trackOrphanedRunner,
  stopOrphanedRunner,
  syncRunnerStatus,
  createAndStartRunner,
} from './runnerManager.js';

export {
  resolveCredentialToken,
  resolveCredentialById,
  createClientFromCredential,
  createClientFromCredentialId,
  type ResolvedCredential,
} from './credentialResolver.js';

export {
  initDocker,
  isDockerAvailable,
  getDockerInfo,
  pullRunnerImage,
  createDockerRunner,
  stopDockerRunner,
  startDockerRunner,
  removeDockerRunner,
  getContainerStatus,
  getContainerLogs,
  listActionPackerContainers,
  syncDockerRunnerStatus,
} from './dockerRunner.js';

export {
  initializeRunnersOnStartup,
} from './startup.js';
