import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFrom, profileDirectory } from '../dist/main/profiles.js';

test('named profiles accept both argument forms and isolate paths', () => {
  assert.equal(profileFrom(['electron', '.', '--profile', 'Alice']), 'alice');
  assert.equal(profileFrom(['electron', '.', '--profile=bob']), 'bob');
  assert.equal(profileFrom(['electron', '.']), null);
  assert.equal(profileDirectory('/tmp/test', null), '/tmp/test/ByteBridge');
  assert.equal(
    profileDirectory('/tmp/test', 'alice'),
    '/tmp/test/ByteBridge/profiles/alice',
  );
});

test('profile names cannot escape the profile directory', () => {
  for (const value of [
    '',
    '../outside',
    '/tmp/outside',
    'two words',
    'a'.repeat(41),
  ])
    assert.throws(() => profileFrom([`--profile=${value}`]), /Profile names/);
  assert.throws(() => profileFrom(['--profile']), /Profile names/);
});
