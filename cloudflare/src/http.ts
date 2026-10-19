import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const secret = () => randomBytes(32).toString('base64url');

export const equal = (left: string, right: string) =>
  timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)));

export function json(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, X-Creation-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

export function failure(error: unknown): Response {
  return json(
    {
      error:
        error instanceof RequestError
          ? error.message
          : 'Unable to process request.',
    },
    error instanceof RequestError ? error.status : 500,
  );
}

export async function body(
  request: Request,
  limit = 4096,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();

  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      length += value.byteLength;

      if (length > limit) {
        await reader.cancel();

        throw new RequestError(413, 'Request too large.');
      }

      chunks.push(value);
    }

    const result: unknown = JSON.parse(
      Buffer.concat(chunks).toString('utf8') || '{}',
    );

    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new RequestError(400, 'Expected a JSON object.');

    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) throw error;

    throw new RequestError(400, 'Invalid JSON request.');
  } finally {
    reader.releaseLock();
  }
}
