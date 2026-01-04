/**
 * Database schema definitions and initialization
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file location - store in data directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'action-packer.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database connection
const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize database schema
 */
function initializeSchemaImpl(): void {
  function hasColumn(table: string, column: string): boolean {
    // Table names are internal constants, not user input.
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some(r => r.name === column);
  }

  function addColumnIfMissing(table: string, column: string, definition: string): void {
    if (hasColumn(table, column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }

  // App settings table - stores GitHub App configuration and onboarding state
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // GitHub App credentials table - stores the GitHub App configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_app (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_id INTEGER NOT NULL,
      app_slug TEXT NOT NULL,
      app_name TEXT NOT NULL,
      client_id TEXT NOT NULL,
      encrypted_client_secret TEXT NOT NULL,
      client_secret_iv TEXT NOT NULL,
      client_secret_auth_tag TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      private_key_iv TEXT NOT NULL,
      private_key_auth_tag TEXT NOT NULL,
      encrypted_webhook_secret TEXT NOT NULL,
      webhook_secret_iv TEXT NOT NULL,
      webhook_secret_auth_tag TEXT NOT NULL,
      -- Legacy columns for backwards compatibility (no longer used)
      iv TEXT,
      auth_tag TEXT,
      owner_login TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      owner_type TEXT NOT NULL DEFAULT 'User',
      html_url TEXT,
      permissions TEXT NOT NULL DEFAULT '{}',
      events TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // GitHub App installations table - tracks where the app is installed
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_app_installations (
      id INTEGER PRIMARY KEY,
      app_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('User', 'Organization')),
      account_login TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      repository_selection TEXT NOT NULL CHECK (repository_selection IN ('all', 'selected')),
      permissions TEXT NOT NULL DEFAULT '{}',
      events TEXT NOT NULL DEFAULT '[]',
      suspended_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Sessions table - stores authenticated user sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_login TEXT NOT NULL,
      user_name TEXT,
      user_email TEXT,
      user_avatar_url TEXT,
      encrypted_access_token TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Credentials table - stores PATs and future GitHub App credentials
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pat', 'github_app')),
      scope TEXT NOT NULL CHECK (scope IN ('repo', 'org')),
      target TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      installation_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      validated_at TEXT,
      UNIQUE(scope, target)
    )
  `);

  // Migrations for existing databases (CREATE TABLE IF NOT EXISTS does not add columns)
  addColumnIfMissing('credentials', 'installation_id', 'installation_id INTEGER');

  // Legacy GitHub App schema migrations
  // Older databases may have a github_app table without the newer per-field IV/auth columns.
  addColumnIfMissing('github_app', 'client_secret_iv', 'client_secret_iv TEXT');
  addColumnIfMissing('github_app', 'client_secret_auth_tag', 'client_secret_auth_tag TEXT');
  addColumnIfMissing('github_app', 'encrypted_private_key', 'encrypted_private_key TEXT');
  addColumnIfMissing('github_app', 'private_key_iv', 'private_key_iv TEXT');
  addColumnIfMissing('github_app', 'private_key_auth_tag', 'private_key_auth_tag TEXT');
  addColumnIfMissing('github_app', 'encrypted_webhook_secret', 'encrypted_webhook_secret TEXT');
  addColumnIfMissing('github_app', 'webhook_secret_iv', 'webhook_secret_iv TEXT');
  addColumnIfMissing('github_app', 'webhook_secret_auth_tag', 'webhook_secret_auth_tag TEXT');

  // Runners table - stores runner configurations and status
  db.exec(`
    CREATE TABLE IF NOT EXISTS runners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      github_runner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'configuring', 'online', 'offline', 'busy', 'error', 'removing')),
      platform TEXT NOT NULL CHECK (platform IN ('darwin', 'linux', 'win32')),
      architecture TEXT NOT NULL CHECK (architecture IN ('x64', 'arm64')),
      isolation_type TEXT NOT NULL DEFAULT 'native' CHECK (isolation_type IN ('native', 'docker', 'tart', 'hyperv')),
      labels TEXT NOT NULL DEFAULT '[]',
      runner_dir TEXT,
      process_id INTEGER,
      container_id TEXT,
      error_message TEXT,
      pool_id TEXT,
      ephemeral INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat TEXT,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
      FOREIGN KEY (pool_id) REFERENCES runner_pools(id) ON DELETE SET NULL
    )
  `);

  // Runner pools table - for autoscaling configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS runner_pools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('darwin', 'linux', 'win32')),
      architecture TEXT NOT NULL CHECK (architecture IN ('x64', 'arm64')),
      isolation_type TEXT NOT NULL DEFAULT 'native' CHECK (isolation_type IN ('native', 'docker', 'tart', 'hyperv')),
      labels TEXT NOT NULL DEFAULT '[]',
      min_runners INTEGER NOT NULL DEFAULT 0,
      max_runners INTEGER NOT NULL DEFAULT 5,
      warm_runners INTEGER NOT NULL DEFAULT 1,
      idle_timeout_minutes INTEGER NOT NULL DEFAULT 10,
      enable_kvm INTEGER NOT NULL DEFAULT 0,
      enable_docker_socket INTEGER NOT NULL DEFAULT 0,
      enable_privileged INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
    )
  `);

  // Migration for existing databases - add new columns
  addColumnIfMissing('runner_pools', 'enable_kvm', 'enable_kvm INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('runner_pools', 'enable_docker_socket', 'enable_docker_socket INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('runner_pools', 'enable_privileged', 'enable_privileged INTEGER NOT NULL DEFAULT 0');

  // Webhook configurations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_configs (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      webhook_id INTEGER,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["workflow_job"]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
      UNIQUE(credential_id)
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runners_credential ON runners(credential_id);
    CREATE INDEX IF NOT EXISTS idx_runners_status ON runners(status);
    CREATE INDEX IF NOT EXISTS idx_runners_pool ON runners(pool_id);
    CREATE INDEX IF NOT EXISTS idx_pools_credential ON runner_pools(credential_id);
  `);
}

// Initialize schema at module load time so tables exist before any imports
initializeSchemaImpl();

// Export initialize function for reference (already run at import time)
export function initializeSchema(): void {
  // Schema is already initialized at module load time
  // This function exists for API consistency and logging
}

// Export the database instance
export default db;

// Type definitions for database rows
export type CredentialRow = {
  id: string;
  name: string;
  type: 'pat' | 'github_app';
  scope: 'repo' | 'org';
  target: string;
  encrypted_token: string;
  iv: string;
  auth_tag: string;
  installation_id: number | null;
  created_at: string;
  updated_at: string;
  validated_at: string | null;
};

export type AppSettingRow = {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
};

export type GitHubAppRow = {
  id: number;
  app_id: number;
  app_slug: string;
  app_name: string;
  client_id: string;
  encrypted_client_secret: string;
  client_secret_iv: string;
  client_secret_auth_tag: string;
  encrypted_private_key: string;
  private_key_iv: string;
  private_key_auth_tag: string;
  encrypted_webhook_secret: string;
  webhook_secret_iv: string;
  webhook_secret_auth_tag: string;
  owner_login: string;
  owner_id: number;
  owner_type: 'User' | 'Organization';
  html_url: string | null;
  permissions: string;
  events: string;
  created_at: string;
  updated_at: string;
};

export type GitHubAppInstallationRow = {
  id: number;
  app_id: number;
  target_id: number;
  target_type: 'User' | 'Organization';
  account_login: string;
  account_id: number;
  repository_selection: 'all' | 'selected';
  permissions: string;
  events: string;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionRow = {
  id: string;
  user_id: number;
  user_login: string;
  user_name: string | null;
  user_email: string | null;
  user_avatar_url: string | null;
  encrypted_access_token: string;
  iv: string;
  auth_tag: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type RunnerRow = {
  id: string;
  name: string;
  credential_id: string;
  github_runner_id: number | null;
  status: 'pending' | 'configuring' | 'online' | 'offline' | 'busy' | 'error' | 'removing';
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'x64' | 'arm64';
  isolation_type: 'native' | 'docker' | 'tart' | 'hyperv';
  labels: string;
  runner_dir: string | null;
  process_id: number | null;
  container_id: string | null;
  error_message: string | null;
  pool_id: string | null;
  ephemeral: number;
  created_at: string;
  updated_at: string;
  last_heartbeat: string | null;
};

export type RunnerPoolRow = {
  id: string;
  name: string;
  credential_id: string;
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'x64' | 'arm64';
  isolation_type: 'native' | 'docker' | 'tart' | 'hyperv';
  labels: string;
  min_runners: number;
  max_runners: number;
  warm_runners: number;
  idle_timeout_minutes: number;
  enable_kvm: number;
  enable_docker_socket: number;
  enable_privileged: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type WebhookConfigRow = {
  id: string;
  credential_id: string;
  webhook_id: number | null;
  secret: string;
  events: string;
  active: number;
  created_at: string;
  updated_at: string;
};
