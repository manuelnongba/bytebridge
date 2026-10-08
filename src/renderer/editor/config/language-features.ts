import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export function setupLanguage(
  languages: { id: string; name: string }[],
  languageSelect: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
) {
  languageSelect.replaceChildren();
  languages.forEach((lang) => {
    const option = document.createElement('option');

    option.value = lang.id;
    option.textContent = lang.name;
    if (lang.id === editor.getModel()?.getLanguageId()) option.selected = true;

    languageSelect.appendChild(option);
  });

  const onChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    const model = editor.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, target.value);
    }
  };
  languageSelect.addEventListener('change', onChange);
  return () => languageSelect.removeEventListener('change', onChange);
}
