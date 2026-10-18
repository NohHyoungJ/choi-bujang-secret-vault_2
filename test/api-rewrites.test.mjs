import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resourceForPath } from '../src/resource-ids.mjs';

test('seven aliases retain distinct resource routes using one function; total functions stay below Hobby limit', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const root = new URL('../api/', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(name => /\.js$/u.test(name));
  assert.equal(files.length, 7);
  assert.equal(config.rewrites.length, 7);
  for (const rule of config.rewrites) {
    assert.equal(rule.destination, '/api/learning-notes');
    assert(resourceForPath(rule.source.replace(':id', 'test-id')));
  }
  const notices = resourceForPath('/api/instructor-notices');
  const admin = resourceForPath('/api/admin/instructor-notices');
  assert.notEqual(notices.resourceId, admin.resourceId);
  assert.notEqual(admin.resourceId, resourceForPath('/api/learning-notes').resourceId);
  assert.equal(resourceForPath('/api/admin/instructor-notices/unexpected/nested'), null);
});
