import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { LeveldbPersistence } from 'y-leveldb';
import {
  serverAddress,
  parseInvitation,
} from '../src/renderer/collaboration/access.js';

test('remote connections require HTTPS and invitations need credentials', () => {
  assert.equal(serverAddress('http://localhost:1234'), 'http://localhost:1234');
  assert.equal(
    serverAddress('https://rooms.example.com/'),
    'https://rooms.example.com',
  );
  for (const address of [
    'http://rooms.example.com',
    'http://192.168.1.3',
    'https://user:pass@example.com',
    'https://example.com/path',
  ])
    assert.throws(() => serverAddress(address));
  assert.throws(() => parseInvitation('myapp://join?room=public-old-room'));
});

test(
  'room authorization, live revocation, expiry and restart persistence',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bytebridge-auth-'));
    let child,
      origin,
      port = 0;
    const clients = [];
    async function start() {
      child = spawn(process.execPath, ['scripts/server.mjs'], {
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          YPERSISTENCE: directory,
          ROOM_CREATION_KEY: 'test-creation-key',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Server startup timeout')),
          8000,
        );
        child.stdout.on('data', (data) => {
          const match = String(data).match(/port (\d+)/);
          if (match) {
            port = Number(match[1]);
            origin = `http://127.0.0.1:${port}`;
            clearTimeout(timeout);
            resolve();
          }
        });
        child.stderr.on('data', (data) => {
          clearTimeout(timeout);
          reject(new Error(String(data)));
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited ${code}`));
        });
      });
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      });
    }
    async function api(route, { method = 'GET', token, data, key } = {}) {
      const response = await fetch(origin + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { 'X-Creation-Key': key } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, data: await response.json() };
    }
    async function until(predicate) {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await delay(30);
      }
      throw new Error('Condition not reached');
    }
    function client(id, token) {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(
        origin.replace('http', 'ws'),
        id,
        doc,
        { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true },
      );
      const result = { doc, provider, text: doc.getText('monaco') };
      clients.push(result);
      return result;
    }
    async function denied(id, token) {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(
          `${origin.replace('http', 'ws')}/${id}?token=${token}`,
        );
        ws.on('unexpected-response', (_req, response) => {
          try {
            assert.equal(response.statusCode, 403);
            response.resume();
            ws.terminate();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        ws.on('open', () => {
          ws.close();
          reject(new Error('Unauthorized connection accepted'));
        });
        ws.on('error', () => {});
      });
    }
    try {
      await start();
      assert.equal((await api('/rooms', { method: 'POST' })).status, 403);
      const created = await api('/rooms', {
        method: 'POST',
        key: 'test-creation-key',
        data: { title: 'Persistent room' },
      });
      assert.equal(created.status, 201);
      const room = created.data;
      assert.equal((await api(`/rooms/${room.id}`)).status, 403);
      await denied(room.id, 'wrong');
      await denied('__proto__', 'wrong');
      const invite = (
        await api(`/rooms/${room.id}/invites`, {
          method: 'POST',
          token: room.token,
          data: { hours: 24 },
        })
      ).data;
      assert.equal(
        (
          await api(`/rooms/${room.id}/invites`, {
            method: 'POST',
            token: invite.token,
          })
        ).status,
        403,
      );
      const other = (
        await api('/rooms', { method: 'POST', key: 'test-creation-key' })
      ).data;
      await denied(other.id, invite.token);
      const owner = client(room.id, room.token),
        guest = client(room.id, invite.token);
      await until(() => owner.provider.synced && guest.provider.synced);
      owner.text.insert(0, 'durable content');
      await until(() => guest.text.toString() === 'durable content');
      for (const method of ['PATCH', 'DELETE']) {
        assert.equal(
          (
            await api(`/rooms/${room.id}`, {
              method,
              token: invite.token,
              data: { title: 'Unauthorized', confirmTitle: room.title },
            })
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await api(`/rooms/${room.id}`, {
            method: 'PATCH',
            token: room.token,
            data: { title: ' ' },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api(`/rooms/${room.id}`, {
            method: 'PATCH',
            token: room.token,
            data: { title: 'x'.repeat(101) },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api(`/rooms/${room.id}`, {
            method: 'PATCH',
            token: room.token,
            data: { title: 'Renamed room' },
          })
        ).status,
        200,
      );
      assert.equal(
        (await api(`/rooms/${room.id}`, { token: invite.token })).data.title,
        'Renamed room',
      );
      assert.equal(
        (
          await api(`/rooms/${room.id}`, {
            method: 'DELETE',
            token: room.token,
            data: { confirmTitle: 'Persistent room' },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await api(`/rooms/${room.id}/invites/${invite.id}`, {
            method: 'DELETE',
            token: room.token,
          })
        ).status,
        200,
      );
      await until(() => !guest.provider.wsconnected);
      guest.provider.disconnect();
      await denied(room.id, invite.token);
      assert.equal(
        (await api(`/rooms/${room.id}`, { token: invite.token })).status,
        403,
      );
      const temporary = (
        await api(`/rooms/${room.id}/invites`, {
          method: 'POST',
          token: room.token,
          data: { hours: 0.0005 },
        })
      ).data;
      const expiring = client(room.id, temporary.token);
      await until(() => expiring.provider.synced);
      await until(
        () =>
          Date.now() > temporary.expiresAt && !expiring.provider.wsconnected,
      );
      expiring.provider.disconnect();
      await denied(room.id, temporary.token);
      for (const c of clients) {
        c.provider.destroy();
        c.doc.destroy();
      }
      clients.length = 0;
      await stop();
      await start();
      assert.equal(
        (await api(`/rooms/${room.id}`, { token: room.token })).data.title,
        'Renamed room',
      );
      await denied(room.id, invite.token);
      const fresh = client(room.id, room.token);
      await until(
        () =>
          fresh.provider.synced && fresh.text.toString() === 'durable content',
      );
      const metadata = await readFile(
        path.join(directory, 'rooms.json'),
        'utf8',
      );
      assert.ok(
        !metadata.includes(room.token) && !metadata.includes(invite.token),
        'store token hashes, not credentials',
      );
      const deletionInvite = (
        await api(`/rooms/${room.id}/invites`, {
          method: 'POST',
          token: room.token,
        })
      ).data;
      const deletionGuest = client(room.id, deletionInvite.token);
      await until(() => deletionGuest.provider.synced);
      assert.equal(
        (
          await api(`/rooms/${room.id}`, {
            method: 'DELETE',
            token: room.token,
            data: { confirmTitle: 'Renamed room' },
          })
        ).status,
        200,
      );
      await until(
        () =>
          !fresh.provider.wsconnected && !deletionGuest.provider.wsconnected,
      );
      fresh.provider.disconnect();
      deletionGuest.provider.disconnect();
      await denied(room.id, room.token);
      await denied(room.id, deletionInvite.token);
      assert.equal(
        (await api(`/rooms/${other.id}`, { token: other.token })).status,
        200,
      );
      await stop();
      const storage = new LeveldbPersistence(directory);
      try {
        assert.equal((await storage.getAllDocNames()).includes(room.id), false);
      } finally {
        await storage.destroy();
      }
      await start();
      assert.equal(
        (await api(`/rooms/${room.id}`, { token: room.token })).status,
        403,
      );
      await denied(room.id, room.token);
      assert.equal(
        (await api(`/rooms/${other.id}`, { token: other.token })).status,
        200,
      );
      assert.equal(
        Object.hasOwn(
          JSON.parse(
            await readFile(path.join(directory, 'rooms.json'), 'utf8'),
          ),
          room.id,
        ),
        false,
      );
      // Simulate a crash after durable denial but before document cleanup.
      const interrupted = client(other.id, other.token);
      await until(() => interrupted.provider.synced);
      interrupted.text.insert(0, 'Pending deletion content');
      await delay(100);
      interrupted.provider.disconnect();
      await stop();
      const metadataPath = path.join(directory, 'rooms.json');
      const pendingMetadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      pendingMetadata[other.id].deleted = true;
      await writeFile(metadataPath, JSON.stringify(pendingMetadata));
      await start();
      await denied(other.id, other.token);
      assert.equal(
        Object.hasOwn(
          JSON.parse(await readFile(metadataPath, 'utf8')),
          other.id,
        ),
        false,
      );
      await stop();
      const recoveredStorage = new LeveldbPersistence(directory);
      try {
        const recovered = await recoveredStorage.getYDoc(other.id);
        assert.equal(recovered.getText('monaco').toString(), '');
        recovered.destroy();
        assert.equal(
          (await recoveredStorage.getAllDocNames()).includes(other.id),
          false,
        );
      } finally {
        await recoveredStorage.destroy();
      }
    } finally {
      for (const c of clients) {
        c.provider.destroy();
        c.doc.destroy();
      }
      await stop();
    }
  },
);
