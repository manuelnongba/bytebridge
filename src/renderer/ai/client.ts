import type { Room } from '../../shared/contracts.js';
import { serverAddress } from '../collaboration/access.js';

export async function aiRequest<T>(
  room: Room,
  signal: AbortSignal,
  data?: unknown,
): Promise<T> {
  const response = await fetch(
    `${serverAddress(room.server)}/rooms/${encodeURIComponent(room.id)}/ai`,
    {
      method: data ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${room.token}`,
        'Content-Type': 'application/json',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(data ? 65000 : 8000),
      ]),
    },
  );
  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      'The server did not return an AI response. Update the ByteBridge server to enable AI.',
    );
  }

  if (!response.ok) throw new Error(result?.error || 'The AI request failed.');

  return result as T;
}
