import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSavedRooms,
  manageSavedRooms,
  sameRoom,
} from '../src/renderer/collaboration/room-store.js';

test('local management preserves credentials/status, scopes by server, and forgets all room credentials', () => {
  const room = {
    id: 'one',
    server: 'http://localhost',
    token: 'owner',
    search: { resolved: false },
  };
  const other = { ...room, server: 'https://other.example' };
  const rooms = [room, { ...room, token: 'guest' }, other];
  const archived = manageSavedRooms(rooms, room, 'archive', true);
  assert.equal(archived[0].archived, true);
  assert.equal(archived[1].archived, true);
  assert.equal(archived[2], other);
  assert.equal(room.archived, undefined);
  assert.equal(archived[0].token, 'owner');
  assert.equal(archived[0].search.resolved, false);
  assert.equal(
    manageSavedRooms(archived, room, 'archive', false)[0].archived,
    false,
  );
  const renamed = manageSavedRooms(archived, room, 'rename', 'New name');
  assert.equal(renamed[1].title, 'New name');
  assert.equal(renamed[0].archived, true);
  assert.deepEqual(manageSavedRooms(renamed, room, 'forget'), [other]);
  assert.equal(sameRoom(null, room), false);
});

test('saved rooms tolerate malformed and inaccessible storage', () => {
  for (const value of [null, '{broken', '{}', 'null', '[null, 1, {}]']) {
    assert.deepEqual(readSavedRooms({ getItem: () => value }), []);
  }
  assert.deepEqual(
    readSavedRooms({
      getItem() {
        throw new Error('unavailable');
      },
    }),
    [],
  );
});

test('saved rooms retain credentials and ignore incomplete entries', () => {
  const room = {
    id: 'room',
    server: 'https://example.com',
    token: 'secret',
    role: 'owner',
  };
  const storage = {
    getItem: () => JSON.stringify([room, { id: 'missing-token' }]),
  };
  assert.deepEqual(readSavedRooms(storage), [room]);
});
