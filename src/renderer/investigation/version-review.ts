import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type {
  FileSnapshot,
  InvestigationEvent,
  WorkspaceEditor,
} from '../../shared/contracts.js';
import { renderFileDiff, showCheckpointDiff } from './checkpoint-diff.js';
import { button } from '../ui/dom.js';

export function openCheckpointFile(
  editor: WorkspaceEditor,
  checkpoint: InvestigationEvent,
  file: FileSnapshot,
  current: () => FileSnapshot | undefined,
) {
  const stamp = `${checkpoint.title} · ${new Date(checkpoint.createdAt).toLocaleString()}`;
  return editor.openReview({
    id: `checkpoint:${checkpoint.id}:${file.id}`,
    label: `${file.path} · ${stamp} · Read-only`,
    render(container) {
      const heading = document.createElement('p');
      heading.className = 'version-caption';
      heading.textContent = `${file.path} — ${stamp}. Saved snapshot · read-only.`;
      const compare = button(
        'Compare with current',
        'compare-checkpoint-current',
        () => {
          const live = current();
          if (!live) {
            heading.textContent =
              'Current file is unavailable. Open the shared file first to load it.';
            return;
          }
          editor.openReview({
            id: `current:${checkpoint.id}:${file.id}`,
            label: `${file.path} · Checkpoint ↔ Room`,
            render(target) {
              const labels = document.createElement('p');
              labels.className = 'version-caption';
              labels.textContent = `Original: ${stamp} · Modified: room at ${new Date().toLocaleTimeString()}. Frozen comparison; reopen Compare with current to refresh.`;
              const diff = document.createElement('div');
              diff.className = 'version-content';
              target.append(labels, diff);
              return renderFileDiff(diff, file, live);
            },
          });
        },
      );
      const actions = document.createElement('div');
      actions.className = 'version-actions';
      actions.append(compare);
      const view = document.createElement('div');
      view.className = 'version-content checkpoint-snapshot';
      container.append(heading, actions, view);
      const model = monaco.editor.createModel(
        file.code,
        monaco.languages.getLanguages().some((l) => l.id === file.language)
          ? file.language
          : 'plaintext',
      );
      const snapshot = monaco.editor.create(view, {
        model,
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        theme: 'vs-dark',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });
      snapshot.focus();
      return () => {
        snapshot.dispose();
        model.dispose();
      };
    },
  });
}

export function openCheckpointComparison(
  editor: WorkspaceEditor,
  before: InvestigationEvent,
  after: InvestigationEvent,
) {
  editor.openReview({
    id: `compare:${before.id}:${after.id}`,
    label: `${before.title} ↔ ${after.title} · Read-only`,
    render(container) {
      const labels = document.createElement('p');
      labels.className = 'version-caption';
      labels.textContent = `Original: ${before.title} (${new Date(before.createdAt).toLocaleString()}) · Modified: ${after.title} (${new Date(after.createdAt).toLocaleString()})`;
      const diff = document.createElement('div');
      diff.id = 'checkpoint-diff';
      diff.className = 'version-content';
      container.append(labels, diff);
      return showCheckpointDiff(diff, before, after);
    },
  });
}
