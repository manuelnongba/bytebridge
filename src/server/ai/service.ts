import { validateEvidence } from '../../shared/ai.js';
import type { AIStatus } from '../../shared/ai.js';
import { openRouterProvider } from './providers/openrouter.js';

export class AIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const model =
  process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash-lite';
const key = process.env.OPENROUTER_API_KEY?.trim() || '';
const enabled = process.env.AI_ENABLED === '1' && !!key;
const provider = openRouterProvider(key, model);
const active = new Set<string>();
const requests = new Map<string, number[]>();
let globalRequests: number[] = [];
const hour = 60 * 60 * 1000;

function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const aiStatus = (): AIStatus => ({
  enabled,
  provider: 'openrouter',
  model: enabled ? model : '',
});

export async function analyzeRoom(
  roomId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  if (!enabled)
    throw new AIError(
      503,
      'AI is disabled on this server. Ask the administrator to configure OpenRouter.',
    );

  if (input.consent !== true)
    throw new AIError(
      400,
      'Start Catch me up to authorize sending session context to OpenRouter.',
    );

  if (input.model !== model)
    throw new AIError(
      409,
      'The configured model changed. Reopen Catch me up to review the new configuration.',
    );

  let evidence;

  try {
    evidence = validateEvidence(input.evidence);
  } catch (error) {
    throw new AIError(
      400,
      error instanceof Error ? error.message : 'Invalid evidence.',
    );
  }

  const now = Date.now();

  for (const [id, times] of requests) {
    const recent = times.filter((time) => now - time < hour);

    if (recent.length) requests.set(id, recent);
    else requests.delete(id);
  }

  globalRequests = globalRequests.filter((time) => now - time < hour);

  const recent = requests.get(roomId) || [];

  if (active.has(roomId) || active.size >= 4)
    throw new AIError(
      429,
      'An AI request is already running. Try again shortly.',
    );

  if (
    recent.length >= limit('AI_ROOM_REQUESTS_PER_HOUR', 20) ||
    globalRequests.length >= limit('AI_REQUESTS_PER_HOUR', 100)
  )
    throw new AIError(
      429,
      'The server AI request allowance has been reached. Try again later.',
    );

  requests.set(roomId, [...recent, now]);
  globalRequests.push(now);
  active.add(roomId);

  const timeout = AbortSignal.timeout(60000);

  try {
    return await provider.analyze(evidence, AbortSignal.any([signal, timeout]));
  } catch (error) {
    if (signal.aborted) throw new AIError(499, 'AI request canceled.');

    if (timeout.aborted)
      throw new AIError(
        504,
        'The AI request timed out. Try again with less context.',
      );

    // Only expose known application messages; parsing/network exceptions can carry upstream details.
    const message =
      error instanceof Error && /^(OpenRouter |The AI )/.test(error.message)
        ? error.message
        : 'The AI provider returned an invalid response. Try again later.';

    throw new AIError(502, message);
  } finally {
    active.delete(roomId);
  }
}
