import { APP_CONFIG } from '../app-config.js';

export function serverAddress(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error(
      'Use HTTPS for remote servers. HTTP is allowed only on localhost.',
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'Enter the server origin only, e.g. https://rooms.example.com',
    );
  return url.origin;
}

export function parseInvitation(value) {
  const url = new URL(value.trim());
  const id = url.searchParams.get('room');
  const token = url.searchParams.get('token');
  if (
    url.protocol !== 'myapp:' ||
    url.hostname !== 'join' ||
    !/^[\w-]{1,128}$/.test(id || '') ||
    !/^[\w-]{43}$/.test(token || '')
  )
    throw new Error(
      'This invitation is invalid or uses the old public-room format. Ask the owner for a new one.',
    );
  return {
    id,
    token,
    server: serverAddress(url.searchParams.get('server') || ''),
    role: 'editor',
  };
}

export async function request(
  server,
  route,
  { method = 'GET', token, data, creationKey } = {},
) {
  const response = await fetch(`${serverAddress(server)}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(creationKey ? { 'X-Creation-Key': creationKey } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(APP_CONFIG.requestTimeoutMs),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      'The server did not return JSON. Check the server address. For local development, stop the old y-websocket server and run npm run server from the ByteBridge project.',
    );
    error.denied = response.status === 401 || response.status === 403;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      result?.error || 'The server could not complete the request.',
    );
    error.denied = response.status === 401 || response.status === 403;
    throw error;
  }
  return result;
}
