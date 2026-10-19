import type { Room } from '../../shared/contracts.js';
import { aiErrorMessage } from '../../shared/ai.js';
import { serverAddress } from '../collaboration/access.js';

/** Only locally authored messages may be displayed in the catch-up dialog. */
export class CatchUpError extends Error {}

export async function aiRequest<T>(
  room: Room,
  signal: AbortSignal,
  data?: unknown,
): Promise<T> {
  const timeout = AbortSignal.timeout(data ? 65000 : 8000);
  let response;

  try {
    response = await fetch(
      `${serverAddress(room.server)}/rooms/${encodeURIComponent(room.id)}/ai`,
      {
        method: data ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${room.token}`,
          'Content-Type': 'application/json',
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.any([signal, timeout]),
      },
    );
  } catch {
    throw new CatchUpError(
      aiErrorMessage(signal.aborted ? 499 : timeout.aborted ? 504 : 0),
    );
  }

  // Older servers may include provider details. Never forward their error text.
  if (!response.ok) throw new CatchUpError(aiErrorMessage(response.status));

  try {
    return (await response.json()) as T;
  } catch {
    throw new CatchUpError(aiErrorMessage(timeout.aborted ? 504 : 502));
  }
}
