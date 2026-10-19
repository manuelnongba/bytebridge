import { AI_LIMITS, aiErrorMessage } from '../shared/ai.js';
import { AIError, aiStatus, analyzeRoom } from './ai/service.js';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Doc } from 'yjs';
import https from 'node:https';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from 'node:fs';
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

interface ProjectPersistence {
  clearDocument(id: string): Promise<void>;
  getYDoc(id: string): Promise<Doc>;
  getAllDocNames(): Promise<string[]>;
  destroy(): Promise<void>;
}

interface StoredInvite {
  id: string;
  hash: string;
  expiresAt: number;
  revoked: boolean;
}

interface StoredRoom {
  id: string;
  title: string;
  ownerHash: string;
  createdAt: number;
  invites: StoredInvite[];
  deleted?: boolean;
}

class RoomSocket extends WebSocket {
  roomId = '';
  token = '';
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT || 1234);
const directory =
  process.env.YPERSISTENCE || path.join(root, '.bytebridge-data');

process.env.YPERSISTENCE = directory;

const remote = !['localhost', '127.0.0.1', '::1'].includes(host);
const tls = process.env.TLS_CERT && process.env.TLS_KEY;

if (remote && !tls && process.env.TRUST_TLS_PROXY !== '1')
  throw new Error(
    'Remote listeners require TLS_CERT/TLS_KEY or TRUST_TLS_PROXY=1 behind a TLS reverse proxy.',
  );

if (
  (remote || tls || process.env.TRUST_TLS_PROXY === '1') &&
  !process.env.ROOM_CREATION_KEY
)
  throw new Error('Set ROOM_CREATION_KEY before exposing this server.');

mkdirSync(directory, { recursive: true, mode: 0o700 });

const metadataFile = path.join(directory, 'rooms.json');
const rooms: Record<string, StoredRoom> = existsSync(metadataFile)
  ? JSON.parse(readFileSync(metadataFile, 'utf8'))
  : {};

function save() {
  writeFileSync(`${metadataFile}.tmp`, JSON.stringify(rooms), { mode: 0o600 });
  renameSync(`${metadataFile}.tmp`, metadataFile);
}

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const secret = () => randomBytes(32).toString('base64url');

const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

function access(roomId: string, token: string | null) {
  if (!Object.hasOwn(rooms, roomId)) return null;

  const room = rooms[roomId];

  if (!room || room.deleted || !token) return null;

  if (equal(room.ownerHash, hash(token))) return 'owner';

  const invite = room.invites.find((invite) => equal(invite.hash, hash(token)));

  return invite && !invite.revoked && invite.expiresAt > Date.now()
    ? 'editor'
    : null;
}

function respond(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Creation-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function body(
  req: IncomingMessage,
  maxBytes = 4096,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of req) {
    const data = Buffer.from(chunk);

    bytes += data.length;

    if (bytes > maxBytes) throw new AIError(413, 'Request too large.');

    chunks.push(data);
  }

  const value = Buffer.concat(chunks).toString('utf8');
  const result = value ? JSON.parse(value) : {};

  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new AIError(400, 'Expected a JSON object.');

  return result;
}

// Includes lazy project buffers plus Yjs history on reconnect; not a disk quota.
const wss = new WebSocketServer<typeof RoomSocket>({
  WebSocket: RoomSocket,
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
});

function revokeConnections() {
  for (const ws of wss.clients)
    if (!access(ws.roomId, ws.token))
      ws.close(4403, 'Access expired or revoked');
}

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  let isAIRequest = false;

  try {
    if (req.method === 'OPTIONS') return respond(res, 204, null);

    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health' && req.method === 'GET')
      return respond(res, 200, { ok: true });

    const aiMatch = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]{1,128})\/ai$/);

    if (aiMatch) {
      isAIRequest = true;

      const id = aiMatch[1]!;
      const token = String(req.headers.authorization || '').replace(
        /^Bearer /,
        '',
      );

      if (!access(id, token))
        return respond(res, 403, { error: 'Room access is no longer valid.' });

      if (req.method === 'GET') return respond(res, 200, aiStatus());

      if (req.method !== 'POST')
        return respond(res, 405, { error: 'Method not allowed' });

      const input = await body(req, AI_LIMITS.requestBytes);

      if (!access(id, token))
        return respond(res, 403, { error: 'Room access is no longer valid.' });

      if (res.destroyed) return;

      const controller = new AbortController();
      const cancel = () => controller.abort();

      res.once('close', cancel);

      const checkAccess = setInterval(() => {
        if (!access(id, token)) cancel();
      }, 1000);

      try {
        const result = await analyzeRoom(id, input, controller.signal);

        if (!access(id, token))
          return respond(res, 403, {
            error: 'Room access is no longer valid.',
          });

        if (!res.destroyed) return respond(res, 200, result);
      } finally {
        clearInterval(checkAccess);
        res.off('close', cancel);
      }

      return;
    }

    if (url.pathname === '/rooms' && req.method === 'POST') {
      if (
        process.env.ROOM_CREATION_KEY &&
        !equal(
          String(req.headers['x-creation-key'] || ''),
          process.env.ROOM_CREATION_KEY,
        )
      )
        return respond(res, 403, {
          error: 'A valid room creation key is required.',
        });

      const input = await body(req);
      const id = randomUUID();
      const token = secret();

      rooms[id] = {
        id,
        title: String(input.title || 'Shared workspace').slice(0, 100),
        ownerHash: hash(token),
        createdAt: Date.now(),
        invites: [],
      };
      save();

      return respond(res, 201, {
        id,
        token,
        role: 'owner',
        title: rooms[id].title,
      });
    }

    const match = url.pathname.match(
      /^\/rooms\/([a-zA-Z0-9_-]{1,128})(?:\/invites(?:\/([a-zA-Z0-9_-]+))?)?$/,
    );

    if (!match) return respond(res, 404, { error: 'Not found' });

    const id = match[1]!;
    const token = String(req.headers.authorization || '').replace(
      /^Bearer /,
      '',
    );
    const role = access(id, token);

    if (!role)
      return respond(res, 403, {
        error:
          'Room access expired, was revoked, is invalid, or the room was deleted.',
      });

    const room = rooms[id]!;

    if (url.pathname === `/rooms/${id}` && req.method === 'GET')
      return respond(res, 200, { id, title: room.title, role });

    if (
      url.pathname === `/rooms/${id}` &&
      ['PATCH', 'DELETE'].includes(req.method || '')
    ) {
      if (role !== 'owner')
        return respond(res, 403, {
          error: 'Only the owner can rename or delete this room.',
        });

      const input = await body(req);

      // Body reads yield: recheck authorization before mutating shared state.
      if (rooms[id] !== room || access(id, token) !== 'owner')
        return respond(res, 403, { error: 'Room access is no longer valid.' });

      if (req.method === 'PATCH') {
        if (
          typeof input.title !== 'string' ||
          !input.title.trim() ||
          input.title.trim().length > 100
        )
          return respond(res, 400, {
            error: 'Use a room name between 1 and 100 characters.',
          });

        const previous = room.title;

        room.title = input.title.trim();

        try {
          save();
        } catch (error) {
          room.title = previous;

          throw error;
        }

        return respond(res, 200, { id, title: room.title, role });
      }

      if (input.confirmTitle !== room.title)
        return respond(res, 409, {
          error:
            'The room name changed or does not match. Refresh the room and confirm its current name.',
        });

      // Persist denial before erasing content, so a crash cannot resurrect access.
      room.deleted = true;

      try {
        save();
      } catch (error) {
        delete room.deleted;

        throw error;
      }

      for (const ws of wss.clients)
        if (ws.roomId === id) ws.close(4403, 'Room deleted by owner');

      try {
        await eraseRoom(id);
      } catch {
        return respond(res, 503, {
          error:
            'Room access is disabled, but storage cleanup did not finish. Ask the server operator to restart the server to retry cleanup.',
        });
      }

      return respond(res, 200, { deleted: true });
    }

    if (url.pathname === `/rooms/${id}`)
      return respond(res, 405, { error: 'Method not allowed' });

    if (role !== 'owner')
      return respond(res, 403, {
        error: 'Only the owner can manage invitations.',
      });

    if (req.method === 'GET' && !match[2])
      return respond(
        res,
        200,
        room.invites.map(({ hash: _hash, ...invite }) => invite),
      );

    if (req.method === 'POST' && !match[2]) {
      const { hours = 24 } = await body(req);

      if (rooms[id] !== room || access(id, token) !== 'owner')
        return respond(res, 403, { error: 'Room access is no longer valid.' });

      if (
        typeof hours !== 'number' ||
        !Number.isFinite(hours) ||
        hours <= 0 ||
        hours > 168
      )
        return respond(res, 400, {
          error: 'Invitation duration must be between 0 and 168 hours.',
        });

      const inviteToken = secret();
      const invite = {
        id: randomUUID(),
        hash: hash(inviteToken),
        expiresAt: Date.now() + hours * 3600000,
        revoked: false,
      };

      room.invites.push(invite);
      save();

      return respond(res, 201, {
        id: invite.id,
        token: inviteToken,
        expiresAt: invite.expiresAt,
      });
    }

    if (req.method === 'DELETE' && match[2]) {
      const invite = room.invites.find((invite) => invite.id === match[2]);

      if (!invite) return respond(res, 404, { error: 'Invitation not found' });

      invite.revoked = true;
      save();
      revokeConnections();

      return respond(res, 200, { revoked: true });
    }

    respond(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    if (!res.destroyed)
      respond(res, error instanceof AIError ? error.status : 400, {
        error: isAIRequest
          ? aiErrorMessage(error instanceof AIError ? error.status : 400)
          : error instanceof AIError
            ? error.message
            : 'Unable to process request.',
      });
  }
};

const server = tls
  ? https.createServer(
      {
        cert: readFileSync(process.env.TLS_CERT!),
        key: readFileSync(process.env.TLS_KEY!),
      },
      handler,
    )
  : http.createServer(handler);
const { setupWSConnection, getPersistence, setPersistence, docs } =
  await import('@y/websocket-server/utils');
// Track initial disk loads; deletion must wait for their queued writes too.
const binding = new Map<string, Set<Promise<void>>>();
// Upstream's getPersistence declaration omits the runtime provider property.
const persistence = getPersistence() as
  | (NonNullable<ReturnType<typeof getPersistence>> & {
      provider: ProjectPersistence;
    })
  | null;

if (!persistence) throw new Error('Persistent storage is required.');

setPersistence({
  ...persistence,
  bindState(id, doc) {
    const pending = Promise.resolve(persistence!.bindState(id, doc));
    const pendingLoads = binding.get(id) || new Set();

    pendingLoads.add(pending);
    binding.set(id, pendingLoads);
    void pending
      .finally(() => {
        pendingLoads.delete(pending);

        if (!pendingLoads.size) binding.delete(id);
      })
      .catch(() => {});

    return pending;
  },
});

async function eraseRoom(id: string) {
  await Promise.all(binding.get(id) || []);

  const doc = docs.get(id);

  docs.delete(id);
  doc?.destroy();
  await persistence!.provider.clearDocument(id);

  const stored = await persistence!.provider.getYDoc(id);
  const empty = stored && stored.store.clients.size === 0;

  stored?.destroy();

  const remaining = await persistence!.provider.getAllDocNames();

  if (!empty || !Array.isArray(remaining) || remaining.includes(id))
    throw new Error(
      'Room storage could not be cleared; deletion will be retried on restart.',
    );

  const tombstone = rooms[id]!;

  delete rooms[id];

  try {
    save();
  } catch (error) {
    rooms[id] = tombstone;

    throw error;
  }
}

// Finish interrupted deletions before accepting any clients.
for (const [id, room] of Object.entries(rooms))
  if (room.deleted) await eraseRoom(id);

server.on('upgrade', (req, socket, head) => {
  let url;

  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    socket.destroy();

    return;
  }

  const id = url.pathname.slice(1);
  const token = url.searchParams.get('token');

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !access(id, token)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');

    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.roomId = id;
    ws.token = token!;

    const send = ws.send.bind(ws) as (
      data: Parameters<WebSocket['send']>[0],
      ...args: unknown[]
    ) => void;

    ws.send = (data, ...args: unknown[]) => {
      if (!access(id, token)) {
        ws.close(4403, 'Access expired or revoked');

        return;
      }

      send(data, ...args);
    };
    setupWSConnection(ws, req, { docName: id });

    // Check every incoming frame as well as handshake and periodic expiry.
    const listeners = ws.listeners('message');

    ws.removeAllListeners('message');
    ws.on('message', (...args) => {
      if (!access(id, token)) {
        ws.close(4403, 'Access expired or revoked');

        return;
      }

      for (const listener of listeners) listener.apply(ws, args);
    });
  });
});

const expiryTimer = setInterval(revokeConnections, 1000);

server.listen(port, host, () =>
  console.log(
    `running at '${host}' on port ${(server.address() as AddressInfo).port}`,
  ),
);

async function shutdown() {
  clearInterval(expiryTimer);

  for (const ws of wss.clients) ws.terminate();

  server.close();
  await persistence?.provider.destroy();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
