import type { Env } from './env.js';
import {
  body,
  equal,
  failure,
  json,
  RequestError,
  hash,
  secret,
} from './http.js';

export { Room } from './room.js';
export { AILimiter } from './limiter.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') return json(null, 204);

      if (url.pathname === '/health' && request.method === 'GET')
        return json({
          ok: true,
          backend: 'cloudflare',
          configured: !!env.ROOM_CREATION_KEY,
        });

      if (url.pathname === '/rooms' && request.method === 'POST') {
        if (!env.ROOM_CREATION_KEY)
          throw new RequestError(
            503,
            'The server administrator must configure a room creation key.',
          );

        if (
          !equal(
            request.headers.get('X-Creation-Key') || '',
            env.ROOM_CREATION_KEY,
          )
        )
          throw new RequestError(403, 'A valid room creation key is required.');

        const input = await body(request);
        const id = crypto.randomUUID();
        const token = secret();
        const title = String(input.title || 'Shared workspace').slice(0, 100);

        await env.ROOMS.getByName(id).initialize(id, title, hash(token));

        return json({ id, token, title, role: 'owner' }, 201);
      }

      const websocket =
        request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
      const match = websocket
        ? url.pathname.match(/^\/([a-zA-Z0-9_-]{1,128})$/)
        : url.pathname.match(
            /^\/rooms\/([a-zA-Z0-9_-]{1,128})(?:\/ai|\/invites(?:\/[a-zA-Z0-9_-]+)?)?$/,
          );

      if (!match) return json({ error: 'Not found' }, 404);

      // Only these public routes reach a room. Initialization is internal RPC.
      return await env.ROOMS.getByName(match[1]!).fetch(request);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
