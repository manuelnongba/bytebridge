import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { InvestigationEvent } from '../../shared/contracts.js';
import { checkpointFiles } from '../workspace/data.js';

// Independent models only: never bind history to the live Y.Text.
export function showCheckpointDiff(
  container: HTMLElement,
  before: InvestigationEvent,
  after: InvestigationEvent,
) {
  const earlier = checkpointFiles(before);
  const later = checkpointFiles(after);
  const ids = [...new Set([...earlier, ...later].map((file) => file.id))];
  const picker = document.createElement('select');

  picker.className = 'checkpoint-file-picker';
  picker.setAttribute('aria-label', 'Checkpoint file to compare');

  for (const id of ids) {
    const a = earlier.find((file) => file.id === id);
    const b = later.find((file) => file.id === id);

    picker.append(
      new Option(
        `${(b || a)!.path}${!a ? ' (not captured before)' : !b ? ' (not captured after)' : a.code === b.code ? ' (unchanged)' : ' (changed)'}`,
        id,
      ),
    );
  }

  const view = document.createElement('div');

  view.className = 'checkpoint-file-diff';
  container.replaceChildren(picker, view);

  let dispose = () => {};

  const render = () => {
    dispose();

    const a = earlier.find((file) => file.id === picker.value);
    const b = later.find((file) => file.id === picker.value);

    dispose = renderFileDiff(
      view,
      a || { code: '', language: b!.language },
      b || { code: '', language: a!.language },
    );
  };

  picker.onchange = render;
  render();

  return () => {
    dispose();
    container.replaceChildren();
  };
}

function renderFileDiff(
  container: HTMLElement,
  before: { code: string; language: string },
  after: { code: string; language: string },
) {
  const language = (id: string) =>
    monaco.languages.getLanguages().some((item) => item.id === id)
      ? id
      : 'plaintext';

  const original = monaco.editor.createModel(
    before.code,
    language(before.language),
  );
  const modified = monaco.editor.createModel(
    after.code,
    language(after.language),
  );
  const editor = monaco.editor.createDiffEditor(container, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: false,
    minimap: { enabled: false },
    theme: 'vs-dark',
    scrollBeyondLastLine: false,
  });

  editor.setModel({ original, modified });

  return () => {
    editor.dispose();
    original.dispose();
    modified.dispose();
  };
}
