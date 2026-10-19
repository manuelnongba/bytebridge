import type { Room } from './room.js';
import type { AILimiter } from './limiter.js';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  AI_LIMITER: DurableObjectNamespace<AILimiter>;
  ROOM_CREATION_KEY: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  AI_ENABLED?: string;
  AI_ROOM_REQUESTS_PER_HOUR?: string;
  AI_REQUESTS_PER_HOUR?: string;
}
