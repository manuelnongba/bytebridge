import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

// Independent models only: never bind history to the live Y.Text.
export function showCheckpointDiff(container, before, after) {
  const language = (id) =>
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
