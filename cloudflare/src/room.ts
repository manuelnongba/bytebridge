import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import type { Env } from './env.js';
import {
  body,
  failure,
  hash,
  json,
  RequestError,
  secret,
  equal,
} from './http.js';
import { DocumentStore, MAX_DOCUMENT_BYTES } from './document.js';
import {
  AI_LIMITS,
  aiErrorMessage,
  validateEvidence,
} from '../../src/shared/ai.js';
import { openRouterProvider } from '../../src/server/ai/providers/openrouter.js';
import { reportAIFailure } from '../../src/server/ai/diagnostics.js';

interface Invite {
  id: string;
  hash: string;
  expiresAt: number;
  revoked: boolean;
}

interface Metadata {
  id: string;
  title: string;
  ownerHash: string;
  createdAt: number;
  invites: Invite[];
  deleted?: boolean;
}

interface Attachment {
  id: string;
  hash: string;
}

type Presence = {
  client: number;
  clock: number;
  state: string;
  socket: string;
};

export class Room extends DurableObject<Env> {
  private store: DocumentStore;
  private doc: Y.Doc | undefined;
  private analyses = new Map<AbortController, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)',
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS presence (client INTEGER PRIMARY KEY, clock INTEGER NOT NULL, state TEXT NOT NULL, socket TEXT NOT NULL)',
    );
    this.store = new DocumentStore(ctx.storage);

    // Socket attachments survive hibernation; presence has no background timer.
    const sockets = new Set(
      ctx.getWebSockets().map((ws) => this.attachment(ws).id),
    );

    for (const row of ctx.storage.sql
      .exec<{ socket: string }>('SELECT DISTINCT socket FROM presence')
      .toArray()) {
      if (!sockets.has(row.socket))
        ctx.storage.sql.exec(
          'DELETE FROM presence WHERE socket = ?',
          row.socket,
        );
    }
  }

  async initialize(
    id: string,
    title: string,
    ownerHash: string,
  ): Promise<void> {
    if (this.metadata()) throw new Error('Room already exists.');

    this.saveMetadata({
      id,
      title,
      ownerHash,
      createdAt: Date.now(),
      invites: [],
    });
  }

  private metadata(): Metadata | null {
    const row = this.ctx.storage.sql
      .exec<{ data: string }>('SELECT data FROM metadata WHERE id = 1')
      .toArray()[0];

    return row ? (JSON.parse(row.data) as Metadata) : null;
  }

  private saveMetadata(room: Metadata): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO metadata VALUES (1, ?)',
      JSON.stringify(room),
    );
  }

  private role(tokenHash: string): 'owner' | 'editor' | null {
    const room = this.metadata();

    if (!room || room.deleted) return null;

    if (equal(room.ownerHash, tokenHash)) return 'owner';

    return room.invites.some(
      (invite) =>
        !invite.revoked &&
        invite.expiresAt > Date.now() &&
        equal(invite.hash, tokenHash),
    )
      ? 'editor'
      : null;
  }

  private authorize(tokenHash: string, owner = false): Metadata {
    const role = this.role(tokenHash);

    if (!role || (owner && role !== 'owner'))
      throw new RequestError(
        403,
        'Room access expired, was revoked, is invalid, or the action requires its owner.',
      );

    return this.metadata()!;
  }

  private attachment(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private document(): Y.Doc {
    return (this.doc ||= this.store.load());
  }

  private send(ws: WebSocket, message: Uint8Array): void {
    if (!this.role(this.attachment(ws).hash)) {
      this.disconnect(ws, 4403, 'Access expired or revoked');
      return;
    }

    try {
      ws.send(message);
    } catch {
      this.disconnect(ws, 1011, 'Connection unavailable');
    }
  }

  private broadcast(message: Uint8Array): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, message);
  }

  private awareness(
    rows: { client: number; clock: number; state: string }[],
  ): Uint8Array {
    const payload = encoding.createEncoder();

    encoding.writeVarUint(payload, rows.length);

    for (const row of rows) {
      encoding.writeVarUint(payload, row.client);
      encoding.writeVarUint(payload, row.clock);
      encoding.writeVarString(payload, row.state);
    }

    const message = encoding.createEncoder();

    encoding.writeVarUint(message, 1);
    encoding.writeVarUint8Array(message, encoding.toUint8Array(payload));

    return encoding.toUint8Array(message);
  }

  private disconnect(
    ws: WebSocket,
    code = 1000,
    reason = 'Connection closed',
  ): void {
    const id = this.attachment(ws).id;
    const removed = this.ctx.storage.sql
      .exec<Presence>('SELECT * FROM presence WHERE socket = ?', id)
      .toArray();

    this.ctx.storage.sql.exec('DELETE FROM presence WHERE socket = ?', id);

    try {
      ws.close(code, reason);
    } catch {
      /* The socket may already be closed. */
    }

    if (removed.length)
      this.broadcast(
        this.awareness(
          removed.map((row) => ({
            ...row,
            clock: row.clock + 1,
            state: 'null',
          })),
        ),
      );
  }

  private revoke(): void {
    for (const [controller, tokenHash] of this.analyses) {
      if (!this.role(tokenHash)) controller.abort();
    }

    for (const ws of this.ctx.getWebSockets()) {
      if (!this.role(this.attachment(ws).hash))
        this.disconnect(ws, 4403, 'Access expired or revoked');
    }
  }

  private async expiry(): Promise<void> {
    const room = this.metadata();
    const expires =
      room?.invites
        .filter((invite) => !invite.revoked && invite.expiresAt > Date.now())
        .map((invite) => invite.expiresAt) || [];

    if (expires.length) await this.ctx.storage.setAlarm(Math.min(...expires));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    this.revoke();
    await this.expiry();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const upgrade =
        request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
      const token = upgrade
        ? url.searchParams.get('token') || ''
        : (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
      const tokenHash = hash(token);
      const room = this.authorize(tokenHash);
      const base = `/rooms/${room.id}`;

      if (upgrade) {
        if (request.method !== 'GET' || url.pathname !== `/${room.id}`)
          throw new RequestError(404, 'Not found');
        if (this.ctx.getWebSockets().length >= 32)
          throw new RequestError(
            429,
            'This room has reached its connection limit.',
          );

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        server.serializeAttachment({
          id: crypto.randomUUID(),
          hash: tokenHash,
        } satisfies Attachment);
        this.ctx.acceptWebSocket(server);

        const response = encoding.createEncoder();

        encoding.writeVarUint(response, 0);
        sync.writeSyncStep1(response, this.document());
        this.send(server, encoding.toUint8Array(response));
        this.revoke();
        this.send(
          server,
          this.awareness(
            this.ctx.storage.sql
              .exec<Presence>('SELECT * FROM presence')
              .toArray(),
          ),
        );
        await this.expiry();

        return new Response(null, { status: 101, webSocket: client });
      }

      if (url.pathname === `${base}/ai`)
        return await this.analyze(request, tokenHash);

      if (url.pathname === base) {
        if (request.method === 'GET')
          return json({
            id: room.id,
            title: room.title,
            role: this.role(tokenHash),
          });
        if (!['PATCH', 'DELETE'].includes(request.method))
          throw new RequestError(405, 'Method not allowed');

        this.authorize(tokenHash, true);

        const input = await body(request);
        const current = this.authorize(tokenHash, true);

        if (request.method === 'PATCH') {
          if (
            typeof input.title !== 'string' ||
            !input.title.trim() ||
            input.title.trim().length > 100
          )
            throw new RequestError(
              400,
              'Use a room name between 1 and 100 characters.',
            );

          current.title = input.title.trim();
          this.saveMetadata(current);

          return json({ id: current.id, title: current.title, role: 'owner' });
        }

        if (input.confirmTitle !== current.title)
          throw new RequestError(
            409,
            'The room name changed or does not match. Refresh and confirm its current name.',
          );

        // Denial and content erasure commit together. The tombstone prevents resurrection.
        this.ctx.storage.transactionSync(() => {
          this.saveMetadata({
            ...current,
            title: '',
            ownerHash: '',
            invites: [],
            deleted: true,
          });
          this.store.clear();
          this.ctx.storage.sql.exec('DELETE FROM presence');
        });
        this.doc?.destroy();
        this.doc = undefined;
        this.revoke();
        await this.ctx.storage.deleteAlarm();

        return json({ deleted: true });
      }

      this.authorize(tokenHash, true);

      if (url.pathname === `${base}/invites`) {
        if (request.method === 'GET')
          return json(room.invites.map(({ hash: _hash, ...invite }) => invite));
        if (request.method !== 'POST')
          throw new RequestError(405, 'Method not allowed');

        const { hours = 24 } = await body(request);
        const current = this.authorize(tokenHash, true);

        if (
          typeof hours !== 'number' ||
          !Number.isFinite(hours) ||
          hours <= 0 ||
          hours > 168
        )
          throw new RequestError(
            400,
            'Invitation duration must be between 0 and 168 hours.',
          );

        current.invites = current.invites.filter(
          (invite) => !invite.revoked && invite.expiresAt > Date.now(),
        );

        if (current.invites.length >= 100)
          throw new RequestError(
            429,
            'This room has too many active invitations. Revoke one first.',
          );

        const token = secret();
        const invite = {
          id: crypto.randomUUID(),
          hash: hash(token),
          expiresAt: Date.now() + hours * 3600000,
          revoked: false,
        };

        current.invites.push(invite);
        this.saveMetadata(current);
        await this.expiry();

        return json({ id: invite.id, token, expiresAt: invite.expiresAt }, 201);
      }

      const inviteId = url.pathname.slice(`${base}/invites/`.length);

      if (
        url.pathname.startsWith(`${base}/invites/`) &&
        request.method === 'DELETE'
      ) {
        const current = this.authorize(tokenHash, true);
        const invite = current.invites.find((entry) => entry.id === inviteId);

        if (!invite) throw new RequestError(404, 'Invitation not found');

        invite.revoked = true;
        this.saveMetadata(current);
        this.revoke();
        await this.expiry();

        return json({ revoked: true });
      }

      throw new RequestError(405, 'Method not allowed');
    } catch (error) {
      if (new URL(request.url).pathname.endsWith('/ai')) {
        const status = error instanceof RequestError ? error.status : 500;

        return json({ error: aiErrorMessage(status) }, status);
      }

      return failure(error);
    }
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (!this.role(this.attachment(ws).hash)) {
      this.disconnect(ws, 4403, 'Access expired or revoked');
      return;
    }

    if (
      typeof message === 'string' ||
      message.byteLength > MAX_DOCUMENT_BYTES
    ) {
      this.disconnect(ws, 1009, 'Invalid or oversized message');
      return;
    }

    try {
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const type = decoding.readVarUint(decoder);

      if (type === 0) {
        const subtype = decoding.readVarUint(decoder);
        const payload = decoding.readVarUint8Array(decoder);

        if (decoding.hasContent(decoder))
          throw new Error('Unexpected message data.');

        if (subtype === 0) {
          const response = encoding.createEncoder();

          encoding.writeVarUint(response, 0);
          sync.writeSyncStep2(response, this.document(), payload);
          this.send(ws, encoding.toUint8Array(response));
        } else if (subtype === 1 || subtype === 2) {
          const doc = this.document();

          Y.applyUpdate(doc, payload);
          // Persist the wire update even if its dependencies have not arrived yet.
          this.store.save(doc, payload);

          const response = encoding.createEncoder();

          encoding.writeVarUint(response, 0);
          sync.writeUpdate(response, payload);
          this.broadcast(encoding.toUint8Array(response));
        } else throw new Error('Unknown sync message.');
      } else if (type === 1) {
        if (message.byteLength > 65536)
          throw new Error('Presence message too large.');

        const payload = decoding.createDecoder(
          decoding.readVarUint8Array(decoder),
        );
        const count = decoding.readVarUint(payload);
        const id = this.attachment(ws).id;
        const changes: Presence[] = [];

        if (count > 64) throw new Error('Too many presence entries.');

        for (let index = 0; index < count; index++) {
          const client = decoding.readVarUint(payload);
          const clock = decoding.readVarUint(payload);
          const state = decoding.readVarString(payload);
          const value: unknown = JSON.parse(state);

          if (
            !Number.isSafeInteger(client) ||
            !Number.isSafeInteger(clock) ||
            (value !== null &&
              (typeof value !== 'object' || Array.isArray(value)))
          )
            throw new Error('Invalid presence.');

          const old = this.ctx.storage.sql
            .exec<Presence>('SELECT * FROM presence WHERE client = ?', client)
            .toArray()[0];

          if (
            old &&
            (old.socket !== id ||
              old.clock > clock ||
              (old.clock === clock && value !== null))
          )
            continue;

          changes.push({ client, clock, state, socket: id });
        }

        if (decoding.hasContent(payload) || decoding.hasContent(decoder))
          throw new Error('Unexpected presence data.');

        this.ctx.storage.transactionSync(() => {
          for (const row of changes) {
            if (row.state === 'null')
              this.ctx.storage.sql.exec(
                'DELETE FROM presence WHERE client = ? AND socket = ?',
                row.client,
                id,
              );
            else
              this.ctx.storage.sql.exec(
                'INSERT OR REPLACE INTO presence VALUES (?, ?, ?, ?)',
                row.client,
                row.clock,
                row.state,
                id,
              );
          }

          if (
            this.ctx.storage.sql
              .exec<{ count: number }>(
                'SELECT COUNT(*) AS count FROM presence WHERE socket = ?',
                id,
              )
              .one().count > 64
          )
            throw new Error('Too many presence entries.');
        });

        if (changes.length) this.broadcast(this.awareness(changes));
      } else if (type === 3) {
        this.revoke();
        this.send(
          ws,
          this.awareness(
            this.ctx.storage.sql
              .exec<Presence>('SELECT * FROM presence')
              .toArray(),
          ),
        );
      } else throw new Error('Unknown message type.');
    } catch {
      // Discard partial in-memory mutations. Only committed updates are replayed.
      this.doc?.destroy();
      this.doc = undefined;
      this.disconnect(
        ws,
        1008,
        'Invalid message or room storage limit reached',
      );
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.disconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.disconnect(ws, 1011, 'Connection error');
  }

  private async analyze(
    request: Request,
    tokenHash: string,
  ): Promise<Response> {
    const model =
      this.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash-lite';
    const key = this.env.OPENROUTER_API_KEY?.trim() || '';
    const enabled = this.env.AI_ENABLED === '1' && !!key;

    if (request.method === 'GET')
      return json({
        enabled,
        provider: 'openrouter',
        model: enabled ? model : '',
      });
    if (request.method !== 'POST')
      throw new RequestError(405, 'Method not allowed');
    if (!enabled) throw new RequestError(503, 'AI is disabled on this server.');

    const input = await body(request, AI_LIMITS.requestBytes);
    const room = this.authorize(tokenHash);

    if (input.consent !== true)
      throw new RequestError(
        400,
        'Start Catch me up to authorize sending session context to OpenRouter.',
      );
    if (input.model !== model)
      throw new RequestError(
        409,
        'The configured model changed. Reopen Catch me up.',
      );

    let evidence;

    try {
      evidence = validateEvidence(input.evidence);
    } catch {
      throw new RequestError(400, 'Invalid or oversized session context.');
    }

    const limiter = this.env.AI_LIMITER.getByName('global');
    const lease = await limiter.acquire(room.id);

    if (!lease)
      throw new RequestError(
        429,
        'An AI request is running or the request allowance was reached. Try again later.',
      );

    const controller = new AbortController();
    const timeout = AbortSignal.timeout(60000);

    this.analyses.set(controller, tokenHash);

    try {
      this.authorize(tokenHash);

      const result = await openRouterProvider(key, model).analyze(
        evidence,
        AbortSignal.any([controller.signal, request.signal, timeout]),
      );

      this.authorize(tokenHash);

      return json(result);
    } catch (error) {
      if (error instanceof RequestError) throw error;

      reportAIFailure(
        error,
        request.signal.aborted || controller.signal.aborted || timeout.aborted,
      );
      this.authorize(tokenHash);

      if (request.signal.aborted || controller.signal.aborted)
        throw new RequestError(499, 'The AI request was canceled.');

      if (timeout.aborted)
        throw new RequestError(
          504,
          'The AI request timed out after 60 seconds. Try again with less context.',
        );

      throw new RequestError(502, aiErrorMessage(502));
    } finally {
      this.analyses.delete(controller);
      await limiter.release(lease);
    }
  }
}
