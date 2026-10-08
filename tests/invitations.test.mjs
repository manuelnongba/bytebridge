import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationFrom } from '../dist/main/invitations.js';

test('extracts an invitation from launch arguments', () => {
  assert.equal(
    invitationFrom([
      '/Applications/ByteBridge.app',
      '--flag',
      'myapp://join?room=a-b_42',
    ]),
    'myapp://join?room=a-b_42',
  );
});

test('rejects malformed, missing-room, and unrelated URLs', () => {
  for (const value of [
    'bad',
    'https://join?room=one',
    'myapp-dev://join?room=one',
    'myapp://other?room=one',
    'myapp://join',
    'myapp://join?room=',
    'myapp://join?room=../other',
    `myapp://join?room=${'a'.repeat(129)}`,
  ]) {
    assert.equal(invitationFrom([value]), null, value);
  }
});
