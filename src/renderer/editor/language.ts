import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export function setupLanguageSelect(
  languages: { id: string; name: string }[],
  languageSelect: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor
) {
  languages.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang.id;
    option.textContent = lang.name;
    if (lang.id === 'javascript') {
      option.selected = true;
    }
    languageSelect.appendChild(option);
  });

  languageSelect.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const model = editor.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, target.value);
    }
  });
}
