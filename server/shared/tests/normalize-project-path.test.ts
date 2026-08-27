import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectPath } from '@/shared/utils.js';

test('normalizeProjectPath folds drive-letter casing to the same key', () => {
  assert.equal(
    normalizeProjectPath('D:\\Code\\Opensource\\ClaudeCodeUI'),
    normalizeProjectPath('d:\\code\\opensource\\claudecodeui')
  );
  assert.equal(normalizeProjectPath('D:\\code\\project'), 'd:\\code\\project');
});

test('normalizeProjectPath folds UNC share casing to the same key', () => {
  assert.equal(
    normalizeProjectPath('\\\\Server\\Share\\Project'),
    normalizeProjectPath('\\\\server\\share\\project')
  );
});

test('normalizeProjectPath composes case-folding with separator/dot-segment normalization', () => {
  assert.equal(
    normalizeProjectPath('D:\\Code\\Project\\..\\Project\\'),
    normalizeProjectPath('d:\\code\\project')
  );
});

test(
  'normalizeProjectPath preserves case for non-Windows-shaped paths on non-Windows hosts',
  { skip: process.platform === 'win32' },
  () => {
    assert.equal(normalizeProjectPath('/Workspace/Project'), '/Workspace/Project');
  }
);
