/**
 * Tests for autoscaler service - label matching logic
 * 
 * Per GitHub docs: "a self-hosted runner must have ALL [requested] labels to be eligible"
 * https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/using-self-hosted-runners-in-a-workflow#using-custom-labels-to-route-jobs
 */

import { describe, it, expect } from 'vitest';
import { labelsMatch, getPoolEffectiveLabels } from '../src/services/autoscaler.js';
import type { RunnerPoolRow } from '../src/db/index.js';

describe('labelsMatch', () => {
  describe('basic matching - pool has all job labels', () => {
    it('should match when pool has exact same labels as job', () => {
      expect(labelsMatch(['self-hosted', 'linux'], ['self-hosted', 'linux'])).toBe(true);
    });

    it('should match when pool has MORE labels than job requests', () => {
      // Pool has docker, job doesn't need it - still a match
      expect(labelsMatch(['self-hosted', 'linux', 'docker'], ['self-hosted', 'linux'])).toBe(true);
    });

    it('should match when pool has all custom labels job requests', () => {
      expect(labelsMatch(['self-hosted', 'linux', 'docker', 'gpu'], ['self-hosted', 'docker'])).toBe(true);
    });
  });

  describe('non-matching scenarios - pool missing required labels', () => {
    it('should NOT match when pool is missing a label job requests', () => {
      // Job needs docker, pool doesn't have it
      expect(labelsMatch(['self-hosted', 'linux'], ['self-hosted', 'linux', 'docker'])).toBe(false);
    });

    it('should NOT match when pool has different custom label than job needs', () => {
      // Pool has gpu, job needs docker
      expect(labelsMatch(['self-hosted', 'linux', 'gpu'], ['self-hosted', 'linux', 'docker'])).toBe(false);
    });

    it('should NOT match when pool is missing multiple labels', () => {
      expect(labelsMatch(['self-hosted'], ['self-hosted', 'linux', 'docker'])).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('should match labels case-insensitively', () => {
      expect(labelsMatch(['self-hosted', 'Docker'], ['self-hosted', 'docker'])).toBe(true);
      expect(labelsMatch(['self-hosted', 'docker'], ['self-hosted', 'DOCKER'])).toBe(true);
    });

    it('should handle mixed case labels', () => {
      expect(labelsMatch(['Self-Hosted', 'Linux'], ['self-hosted', 'linux'])).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should match any pool when job requests no labels', () => {
      expect(labelsMatch(['self-hosted', 'linux', 'docker'], [])).toBe(true);
      expect(labelsMatch([], [])).toBe(true);
    });

    it('should NOT match empty pool when job requests labels', () => {
      expect(labelsMatch([], ['self-hosted'])).toBe(false);
    });

    it('should match when pool has many extra labels', () => {
      expect(labelsMatch(
        ['self-hosted', 'linux', 'x64', 'docker', 'gpu', 'ssd', 'fast'],
        ['self-hosted', 'docker']
      )).toBe(true);
    });
  });

  describe('real-world scenarios from GitHub docs', () => {
    it('should match GPU pool for GPU job', () => {
      // From docs: runs-on: [self-hosted, linux, x64, gpu]
      const poolLabels = ['self-hosted', 'linux', 'x64', 'gpu'];
      const jobLabels = ['self-hosted', 'linux', 'x64', 'gpu'];
      expect(labelsMatch(poolLabels, jobLabels)).toBe(true);
    });

    it('should NOT match non-GPU pool for GPU job', () => {
      const poolLabels = ['self-hosted', 'linux', 'x64'];
      const jobLabels = ['self-hosted', 'linux', 'x64', 'gpu'];
      expect(labelsMatch(poolLabels, jobLabels)).toBe(false);
    });

    it('should match GPU pool for basic linux job', () => {
      // GPU pool CAN run jobs that don't need GPU
      const poolLabels = ['self-hosted', 'linux', 'x64', 'gpu'];
      const jobLabels = ['self-hosted', 'linux'];
      expect(labelsMatch(poolLabels, jobLabels)).toBe(true);
    });
  });
});

describe('getPoolEffectiveLabels', () => {
  function createMockPool(overrides: Partial<RunnerPoolRow>): RunnerPoolRow {
    return {
      id: 'test-pool',
      name: 'Test Pool',
      credential_id: 'cred-1',
      platform: 'linux',
      architecture: 'x64',
      isolation_type: 'native',
      labels: '[]',
      min_runners: 0,
      max_runners: 5,
      warm_runners: 1,
      idle_timeout_minutes: 10,
      enabled: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('should include self-hosted label', () => {
    const pool = createMockPool({});
    const labels = getPoolEffectiveLabels(pool);
    expect(labels.map(l => l.toLowerCase())).toContain('self-hosted');
  });

  it('should map linux platform to Linux label', () => {
    const pool = createMockPool({ platform: 'linux' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('Linux');
  });

  it('should map darwin platform to macOS label', () => {
    const pool = createMockPool({ platform: 'darwin' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('macOS');
  });

  it('should map win32 platform to Windows label', () => {
    const pool = createMockPool({ platform: 'win32' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('Windows');
  });

  it('should map x64 architecture to X64 label', () => {
    const pool = createMockPool({ architecture: 'x64' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('X64');
  });

  it('should map arm64 architecture to ARM64 label', () => {
    const pool = createMockPool({ architecture: 'arm64' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('ARM64');
  });

  it('should include custom labels from pool', () => {
    const pool = createMockPool({ labels: '["docker", "gpu"]' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toContain('docker');
    expect(labels).toContain('gpu');
  });

  it('should not duplicate labels if custom label matches default', () => {
    const pool = createMockPool({ platform: 'linux', labels: '["Linux", "self-hosted"]' });
    const labels = getPoolEffectiveLabels(pool);
    const linuxCount = labels.filter(l => l.toLowerCase() === 'linux').length;
    const selfHostedCount = labels.filter(l => l.toLowerCase() === 'self-hosted').length;
    expect(linuxCount).toBe(1);
    expect(selfHostedCount).toBe(1);
  });

  it('should return correct labels for macOS ARM64 pool', () => {
    const pool = createMockPool({ platform: 'darwin', architecture: 'arm64', labels: '[]' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toEqual(['self-hosted', 'macOS', 'ARM64']);
  });

  it('should return correct labels for Linux x64 Docker pool', () => {
    const pool = createMockPool({ platform: 'linux', architecture: 'x64', isolation_type: 'docker', labels: '["docker"]' });
    const labels = getPoolEffectiveLabels(pool);
    expect(labels).toEqual(['self-hosted', 'Linux', 'X64', 'docker']);
  });

  describe('Docker isolation', () => {
    it('should use Linux label for Docker pools regardless of host platform', () => {
      // Docker on macOS host - runner is still Linux
      const pool = createMockPool({ 
        platform: 'darwin', 
        architecture: 'x64', 
        isolation_type: 'docker',
        labels: '[]' 
      });
      const labels = getPoolEffectiveLabels(pool);
      expect(labels).toContain('Linux');
      expect(labels).not.toContain('macOS');
    });

    it('should use Linux label for Docker on Windows host', () => {
      const pool = createMockPool({ 
        platform: 'win32', 
        architecture: 'x64', 
        isolation_type: 'docker',
        labels: '[]' 
      });
      const labels = getPoolEffectiveLabels(pool);
      expect(labels).toContain('Linux');
      expect(labels).not.toContain('Windows');
    });

    it('should preserve architecture from pool for Docker', () => {
      // Docker on ARM64 Mac running amd64 container via emulation
      const pool = createMockPool({ 
        platform: 'darwin', 
        architecture: 'x64',  // amd64 container
        isolation_type: 'docker',
        labels: '[]' 
      });
      const labels = getPoolEffectiveLabels(pool);
      expect(labels).toEqual(['self-hosted', 'Linux', 'X64']);
    });

    it('should use native platform for non-Docker isolation', () => {
      const pool = createMockPool({ 
        platform: 'darwin', 
        architecture: 'arm64', 
        isolation_type: 'native',
        labels: '[]' 
      });
      const labels = getPoolEffectiveLabels(pool);
      expect(labels).toContain('macOS');
      expect(labels).not.toContain('Linux');
    });
  });
});
