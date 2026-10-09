import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../dist/typescript/renderer/collaboration/access.js';

test('legacy plain-text server produces an actionable error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('okay'));
  await assert.rejects(request('http://localhost:1234', '/rooms'), {
    message: /stop the old y-websocket server and run npm run server/,
  });
});

test('non-JSON authentication failures still mark access as denied', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('Forbidden', { status: 403 }),
  );
  await assert.rejects(request('http://localhost:1234', '/rooms/example'), {
    denied: true,
  });
});

test('valid server JSON is returned unchanged', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ id: 'example' }),
  );
  assert.deepEqual(await request('http://localhost:1234', '/rooms/example'), {
    id: 'example',
  });
});
