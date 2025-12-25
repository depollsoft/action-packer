/**
 * Tests for autoscaler service - label matching logic
 * 
 * Per GitHub docs: "a self-hosted runner must have ALL [requested] labels to be eligible"
 * https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/using-self-hosted-runners-in-a-workflow#using-custom-labels-to-route-jobs
 */

import { describe, it, expect } from 'vitest';
import { labelsMatch } from '../src/services/autoscaler.js';

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
