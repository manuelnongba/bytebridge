import { initializeDropdown } from '../../ui/dropdown.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export function setupLanguage(
  languages: { id: string; name: string }[],
  languageSelect: HTMLSelectElement,
  editor: monaco.editor.IStandaloneCodeEditor,
) {
  languageSelect.replaceChildren();

  const registry = monaco.languages.getLanguages();

  for (const language of [...languages].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const option = document.createElement('option');
    const definition = registry.find((item) => item.id === language.id);

    option.value = language.id;
    option.textContent = language.name;
    option.dataset.search = [
      language.id,
      language.name,
      ...(definition?.aliases || []),
      ...(definition?.extensions || []),
    ]
      .join(' ')
      .toLowerCase();
    languageSelect.append(option);
  }

  const picker = initializeDropdown(languageSelect, {
    searchable: true,
    name: 'Language',
  });

  function refresh() {
    languageSelect.value = editor.getModel()?.getLanguageId() || 'plaintext';
    picker.refresh();
  }

  const onChange = () => {
    const model = editor.getModel();

    if (model && !languageSelect.disabled)
      monaco.editor.setModelLanguage(model, languageSelect.value);

    refresh();
  };
  const modelChange = editor.onDidChangeModel(refresh);
  const languageChange = editor.onDidChangeModelLanguage(refresh);

  languageSelect.addEventListener('change', onChange);
  refresh();

  return () => {
    picker.dispose();
    modelChange.dispose();
    languageChange.dispose();
    languageSelect.removeEventListener('change', onChange);
  };
}
