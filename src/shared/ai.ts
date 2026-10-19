/** Public AI contracts. Credentials and provider configuration stay on the server. */
export const AI_LIMITS = {
  items: 60,
  itemChars: 24000,
  contextBytes: 96000,
  requestBytes: 112000,
  outputTokens: 1800,
};

export interface EvidenceItem {
  id: string;
  label: string;
  content: string;
}

export const ANALYSIS_SECTIONS = {
  knownFacts: 'At a glance',
  previousAttempts: 'What was tried',
  openQuestions: 'Open questions',
  hypotheses: 'Hypotheses — unverified',
  nextExperiments: 'Try next',
} as const;
export const ANALYSIS_POINT_LIMITS = {
  knownFacts: 2,
  previousAttempts: 2,
  openQuestions: 1,
  hypotheses: 1,
  nextExperiments: 2,
} as const;
export const ANALYSIS_POINT_CHARS = 320;

export type AnalysisSection = keyof typeof ANALYSIS_SECTIONS;

export interface AnalysisPoint {
  text: string;
  evidenceIds: string[];
}

export type Analysis = Record<AnalysisSection, AnalysisPoint[]>;

export interface AIStatus {
  enabled: boolean;
  provider: 'openrouter';
  model: string;
}

export interface AIResult {
  analysis: Analysis;
  model: string;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
}

export function validateEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value) || !value.length || value.length > AI_LIMITS.items)
    throw new Error(`Select between 1 and ${AI_LIMITS.items} evidence items.`);

  const ids = new Set<string>();
  const items = value.map((item): EvidenceItem => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.label !== 'string' ||
      !item.label.trim() ||
      item.label.length > 240 ||
      typeof item.content !== 'string' ||
      !item.content.trim() ||
      item.content.length > AI_LIMITS.itemChars
    )
      throw new Error(
        'Evidence is invalid or too large. Shorten the selected text.',
      );

    ids.add(item.id);

    return { id: item.id, label: item.label, content: item.content };
  });

  if (
    new TextEncoder().encode(JSON.stringify(items)).byteLength >
    AI_LIMITS.contextBytes
  )
    throw new Error(
      'Selected context is too large. Deselect items or shorten their text.',
    );

  return items;
}

export const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(ANALYSIS_SECTIONS),
  properties: Object.fromEntries(
    Object.keys(ANALYSIS_SECTIONS).map((key) => [
      key,
      {
        type: 'array',
        maxItems: ANALYSIS_POINT_LIMITS[key as AnalysisSection],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'evidenceIds'],
          properties: {
            text: { type: 'string', maxLength: ANALYSIS_POINT_CHARS },
            evidenceIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    ]),
  ),
};

export function validateAnalysis(
  value: unknown,
  evidence: EvidenceItem[],
): Analysis {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid AI response.');

  const ids = new Set(evidence.map((item) => item.id));
  const data = value as Record<string, unknown>;

  if (Object.keys(data).some((key) => !(key in ANALYSIS_SECTIONS)))
    throw new Error('Unexpected AI response fields.');

  const result = {} as Analysis;

  for (const key of Object.keys(ANALYSIS_SECTIONS) as AnalysisSection[]) {
    const points = data[key];

    if (!Array.isArray(points) || points.length > ANALYSIS_POINT_LIMITS[key])
      throw new Error('Invalid AI response section.');

    result[key] = points.map((point): AnalysisPoint => {
      if (
        !point ||
        typeof point.text !== 'string' ||
        !point.text.trim() ||
        point.text.length > ANALYSIS_POINT_CHARS ||
        !Array.isArray(point.evidenceIds) ||
        !point.evidenceIds.length ||
        point.evidenceIds.length > 10 ||
        point.evidenceIds.some(
          (id: unknown) => typeof id !== 'string' || !ids.has(id),
        )
      )
        throw new Error(
          'The AI returned missing or unknown evidence references. Try again.',
        );

      return {
        text: point.text,
        evidenceIds: [...new Set<string>(point.evidenceIds)],
      };
    });
  }

  if (!Object.values(result).some((points) => points.length))
    throw new Error('The AI returned an empty analysis.');

  return result;
}

/** User-facing copy shared by both servers and the desktop client. */
export function aiErrorMessage(status = 502): string {
  switch (status) {
    case 0:
      return 'Couldn’t connect. Check your connection and try again.';
    case 400:
    case 413:
      return 'We couldn’t use this session’s content. Try a shorter problem description or less code.';
    case 401:
    case 403:
      return 'You no longer have access to this room. Ask for a new invitation.';
    case 409:
      return 'Catch-up settings changed. Please try again.';
    case 429:
      return 'Catch-up is busy or its usage limit has been reached. Please try again later.';
    case 499:
      return 'Catch-up canceled.';
    case 503:
      return 'Catch-up isn’t available right now. Please try again later.';
    case 504:
      return 'Your catch-up took too long. Please try again.';
    default:
      return 'We couldn’t create your catch-up. Please try again.';
  }
}
