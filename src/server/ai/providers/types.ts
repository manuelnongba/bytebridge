import type { EvidenceItem, AIResult } from '../../../shared/ai.js';

export interface AIProvider {
  analyze(evidence: EvidenceItem[], signal: AbortSignal): Promise<AIResult>;
}
