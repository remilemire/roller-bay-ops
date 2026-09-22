import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasAnyRole } from './roles.js';

test('restricted access profiles do not inherit staff permissions', () => {
  assert.equal(hasAnyRole('pending', ['staff']), false);
  assert.equal(hasAnyRole('pending', ['pending']), true);
  assert.equal(hasAnyRole('production', ['staff']), false);
  assert.equal(hasAnyRole('production', ['production']), true);
});

test('the staff hierarchy inherits staff and production permissions', () => {
  assert.equal(hasAnyRole('staff', ['production']), true);
  assert.equal(hasAnyRole('admin', ['staff']), true);
  assert.equal(hasAnyRole('owner', ['admin']), true);
  assert.equal(hasAnyRole('staff', ['admin']), false);
  assert.equal(hasAnyRole('admin', ['owner']), false);
});
