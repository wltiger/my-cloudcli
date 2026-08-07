import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import { filterFavoriteProjects } from './utils';

const createProject = (projectId: string, isStarred?: boolean): Project => ({
  projectId,
  displayName: projectId,
  fullPath: `/tmp/${projectId}`,
  ...(isStarred === undefined ? {} : { isStarred }),
});

const starred = createProject('starred', true);
const notStarred = createProject('not-starred', false);
const neverStarred = createProject('never-starred');

test('returns every project when the favorites filter is disabled', () => {
  const projects = [starred, notStarred, neverStarred];

  assert.deepEqual(filterFavoriteProjects(projects, false), projects);
});

test('keeps only starred projects when the favorites filter is enabled', () => {
  assert.deepEqual(
    filterFavoriteProjects([starred, notStarred, neverStarred], true),
    [starred],
  );
});

test('preserves the incoming order of the starred projects', () => {
  const secondStarred = createProject('starred-2', true);

  assert.deepEqual(
    filterFavoriteProjects([notStarred, secondStarred, starred], true),
    [secondStarred, starred],
  );
});

test('returns an empty list when the filter is enabled and nothing is starred', () => {
  assert.deepEqual(filterFavoriteProjects([notStarred, neverStarred], true), []);
});

test('returns an empty list for an empty project list', () => {
  assert.deepEqual(filterFavoriteProjects([], true), []);
  assert.deepEqual(filterFavoriteProjects([], false), []);
});
