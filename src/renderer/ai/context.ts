import type * as Y from 'yjs';
import type {
  InvestigationEvent,
  ResolutionRecord,
} from '../../shared/contracts.js';
import { AI_LIMITS, validateEvidence } from '../../shared/ai.js';
import type { EvidenceItem } from '../../shared/ai.js';
import { APP_CONFIG } from '../app-config.js';
import { readContext, entrySummary } from '../debugging/data.js';
import { eventSummary } from '../investigation/events.js';
import { resolutionText } from '../resolution/data.js';
import { checkpointFiles, workspaceFiles } from '../workspace/data.js';

/** Priority order: Problem, recent attempts/status, current code, older snapshots. */
export function collectEvidence(doc: Y.Doc): EvidenceItem[] {
  const result: EvidenceItem[] = [];
  const add = (label: string, content: string) => {
    if (content.trim())
      result.push({
        id: `evidence-${result.length + 1}`,
        label: label.slice(0, 240),
        content,
      });
  };
  const context = readContext(
    doc.getMap('debug-context'),
    APP_CONFIG.debugging,
  );

  for (const field of APP_CONFIG.debugging.fields)
    add(field.label, String(context[field.key] || ''));

  const collections = APP_CONFIG.debugging.collections;

  for (const collection of collections.filter((item) => !item.fileImport))
    [...context[collection.key]]
      .reverse()
      .forEach((entry, index) =>
        add(
          `${collection.label} · recent ${index + 1}`,
          entrySummary(entry, collection),
        ),
      );

  const events = doc
    .getArray<InvestigationEvent>('investigation-events')
    .toArray();
  const records = doc.getArray<ResolutionRecord>('resolution-events').toArray();
  const history = [
    ...events.map((event) => ({
      createdAt: event.createdAt,
      label: event.title,
      content:
        event.type === 'checkpoint'
          ? `${event.author} · ${new Date(event.createdAt).toISOString()}\n${event.notes || ''}\n${event.issue || ''}`
          : eventSummary(event),
    })),
    ...records.map((record) => ({
      createdAt: record.createdAt,
      label:
        record.type === 'reopen' ? 'Problem reopened' : 'Reported resolution',
      content: resolutionText(record, events),
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  // Preserve the latest history before code; older history follows loaded code.
  for (const entry of history.slice(0, 10)) add(entry.label, entry.content);

  for (const collection of collections.filter((item) => item.fileImport))
    context[collection.key].forEach((entry, index) =>
      add(`${collection.label} ${index + 1}`, entrySummary(entry, collection)),
    );

  for (const file of workspaceFiles(doc))
    if (file.text) add(`Current buffer · ${file.path}`, file.text.toString());

  for (const entry of history.slice(10)) add(entry.label, entry.content);

  for (const event of [...events].reverse())
    if (event.type === 'checkpoint')
      for (const file of checkpointFiles(event))
        add(`${event.title} · ${file.path}`, file.code);

  return result;
}

/** Build a bounded request automatically; excerpts are marked in the actual evidence. */
export function selectEvidence(all: EvidenceItem[]) {
  const evidence: EvidenceItem[] = [];
  let excerpted = 0;
  const encoder = new TextEncoder();
  const marker =
    '\n\n[Excerpt: middle omitted to fit the catch-up context limit.]\n\n';

  for (const item of all) {
    if (evidence.length >= AI_LIMITS.items) break;

    // Leave room for multiple sources rather than letting one file use the budget.
    let length = Math.min(item.content.length, 6000);

    while (length >= Math.min(item.content.length, 300)) {
      const clipped = length < item.content.length;
      const content = clipped
        ? item.content.slice(0, Math.ceil(length * 0.75)) +
          marker +
          item.content.slice(-Math.floor(length * 0.25))
        : item.content;
      const candidate = { ...item, content };

      if (
        encoder.encode(JSON.stringify([...evidence, candidate])).byteLength <=
        AI_LIMITS.contextBytes
      ) {
        evidence.push(candidate);

        if (clipped) excerpted++;

        break;
      }

      length = Math.floor(length / 2);
    }
  }

  return {
    evidence: validateEvidence(evidence),
    omitted: all.length - evidence.length,
    excerpted,
  };
}
