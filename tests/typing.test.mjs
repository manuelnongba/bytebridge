import test from 'node:test';
import assert from 'node:assert/strict';
import { typingLabel } from '../dist/typescript/renderer/collaboration/typing.js';

test('typing label excludes self and idle participants and handles multiple editors', () => {
  const state = (name) => ({ user: { name }, editing: true });

  assert.equal(
    typingLabel(
      [
        [1, state('Me')],
        [2, { user: { name: 'Idle' }, editing: false }],
      ],
      1,
    ),
    '',
  );
  assert.equal(typingLabel([[2, state('Ada')]], 1), 'Ada is typing…');
  assert.equal(
    typingLabel(
      [
        [2, state('Ada')],
        [3, state('Sam')],
      ],
      1,
    ),
    'Ada and Sam are typing…',
  );
  assert.equal(
    typingLabel(
      [
        [2, state('Ada')],
        [3, state('Sam')],
        [4, state('Lee')],
      ],
      1,
    ),
    'Ada, Sam and 1 other are typing…',
  );
});
