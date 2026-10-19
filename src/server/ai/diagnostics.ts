/** Codes are safe to log; prompts, credentials, and upstream bodies are not. */
export class AIProviderError extends Error {
  constructor(
    public code:
      | 'connection'
      | 'redirect'
      | 'access'
      | 'credits'
      | 'rate_limit'
      | 'request'
      | 'empty'
      | 'size'
      | 'json'
      | 'provider'
      | 'incomplete'
      | 'validation',
    message: string,
    public upstreamStatus?: number,
  ) {
    super(message);
  }
}

export function reportAIFailure(error: unknown, aborted = false): void {
  console.warn({
    event: 'ai_request_failed',
    reason: aborted
      ? 'aborted'
      : error instanceof AIProviderError
        ? error.code
        : 'unexpected',
    upstreamStatus:
      error instanceof AIProviderError ? (error.upstreamStatus ?? null) : null,
  });
}
