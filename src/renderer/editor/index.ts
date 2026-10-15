import { initializeReviewTabs } from './review-tabs.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { WorkspaceFile, RoomProvider } from '../../shared/contracts.js';
import type * as Y from 'yjs';
import { element } from '../ui/dom.js';
import { MonacoBinding } from 'y-monaco';

import { EDITOR_CONFIG } from './config/index.js';
import { setupLanguage } from './config/language-features.js';
import { PresenceManager } from '../collaboration/presence.js';
import { APP_CONFIG } from '../app-config.js';
import { trackTyping, typingLabel } from '../collaboration/typing.js';
import { LEGACY_FILE, workspaceFiles } from '../workspace/data.js';

export function initializeEditor(
  provider: RoomProvider,
  ydoc: Y.Doc,
  name: string,
  attachSelection?: () => void,
) {
  const supportedLanguages = monaco.languages.getLanguages().map((lang) => ({
    id: lang.id,
    name: lang.aliases?.[0] || lang.id,
  }));

  element('editor').hidden = false;
  const editor = monaco.editor.create(element('editor'), EDITOR_CONFIG);

  editor.updateOptions({ fontSize: APP_CONFIG.appearance.editorFontSize });
  const selectionAction =
    APP_CONFIG.navigation.selectionAttachments && attachSelection
      ? editor.addAction({
          id: 'bytebridge.attachSelection',
          label: 'Attach selection to problem…',
          contextMenuGroupId: '9_cutcopypaste',
          contextMenuOrder: 10,
          precondition: 'editorHasSelection',
          run: attachSelection,
        })
      : null;
  editor.getModel()?.dispose();

  const models = new Map<
    string,
    {
      model: monaco.editor.ITextModel;
      binding: MonacoBinding;
      view: monaco.editor.ICodeEditorViewState | null;
    }
  >();
  let selected: WorkspaceFile | null = null;
  let denied = false;
  let reviewing = false;

  let disposeTyping = () => {};

  const languageSelect = element<HTMLSelectElement>('language-select');
  languageSelect.disabled = false;
  const remoteCursorName = element<HTMLParagraphElement>('remote-cursor-name');

  const disposeLanguage = setupLanguage(
    supportedLanguages,
    languageSelect,
    editor,
  );

  const presenceManager = new PresenceManager(editor);

  presenceManager.setupAwareness(
    editor,
    provider?.awareness,
    remoteCursorName,
    name,
  );

  const updatePresence = () => {
    const states =
      !reviewing && provider.wsconnected
        ? Array.from(provider.awareness.getStates()).filter(
            ([, state]) => (state.fileId || LEGACY_FILE) === selected?.id,
          )
        : [];

    presenceManager.updateCursors(
      states,
      provider?.awareness,
      remoteCursorName,
      APP_CONFIG.presence.cursorLabelsEnabled,
    );
    remoteCursorName.textContent = APP_CONFIG.presence.typingEnabled
      ? typingLabel(states, provider.awareness.clientID)
      : '';
  };

  provider.awareness.on('change', updatePresence);

  const reviews = initializeReviewTabs(
    (value) => {
      reviewing = value;
      element('editor').hidden = value;
      languageSelect.disabled = value;
      languageSelect.closest<HTMLElement>('.language-control')!.hidden = value;
      element('editor-panel').querySelector('.live-label')!.textContent = value
        ? 'READ ONLY'
        : 'LIVE';
      if (value) {
        disposeTyping();
        disposeTyping = () => {};
        provider.awareness.setLocalStateField('fileId', null);
        provider.awareness.setLocalStateField('filePath', null);
        provider.awareness.setLocalStateField('cursor', null);
        provider.awareness.setLocalStateField('selection', null);
        provider.awareness.setLocalStateField('editing', false);
        remoteCursorName.textContent = '';
      }
    },
    () => {
      if (selected) openFile(selected);
    },
  );

  const openFile = (file: WorkspaceFile) => {
    if (!file.text) return;

    const wasReviewing = reviewing;
    reviews.showLive();
    if (
      selected?.id === file.id &&
      !wasReviewing &&
      provider.awareness.getLocalState()?.fileId === file.id
    ) {
      editor.focus();

      return;
    }

    if (selected) models.get(selected.id)!.view = editor.saveViewState();

    disposeTyping();
    selected = file;
    provider.awareness.setLocalStateField('cursor', null);
    provider.awareness.setLocalStateField('selection', null);

    let entry = models.get(file.id);

    if (!entry) {
      const language = supportedLanguages.some(
        (item) => item.id === file.language,
      )
        ? file.language
        : 'plaintext';
      const model = monaco.editor.createModel(file.text.toString(), language);
      // Cursor presence is file-scoped below; no cross-file awareness binding.
      const binding = new MonacoBinding(file.text, model, new Set([editor]));

      entry = { model, binding, view: null };
      models.set(file.id, entry);
    }

    editor.setModel(entry.model);
    editor.updateOptions({ readOnly: denied || file.mode === 'reference' });

    if (entry.view) editor.restoreViewState(entry.view);

    languageSelect.value = entry.model.getLanguageId();
    disposeTyping = trackTyping(
      provider,
      file.text,
      entry.binding,
      APP_CONFIG.presence,
      updatePresence,
    );
    provider.awareness.setLocalStateField('fileId', file.id);
    provider.awareness.setLocalStateField('filePath', file.path);
    updatePresence();
    editor.focus();
  };

  openFile(workspaceFiles(ydoc)[0]!);

  const dispose = () => {
    reviews.dispose();
    disposeTyping();
    provider.awareness.off('change', updatePresence);
    presenceManager.dispose();
    disposeLanguage();
    selectionAction?.dispose();
    editor.dispose();

    for (const { model, binding } of models.values()) {
      binding.destroy();
      model.dispose();
    }

    provider.awareness.setLocalStateField('fileId', null);
    provider.awareness.setLocalStateField('filePath', null);
    provider.awareness.setLocalStateField('cursor', null);
    remoteCursorName.textContent = '';
  };

  dispose.setReadOnly = (readOnly: boolean) => {
    denied = readOnly;
    editor.updateOptions({
      readOnly: denied || selected?.mode === 'reference',
    });
  };
  dispose.getLanguage = () =>
    editor.getModel()?.getLanguageId() || 'javascript';
  dispose.getLegacyLanguage = () =>
    models.get(LEGACY_FILE)?.model.getLanguageId() || 'javascript';
  dispose.openFile = openFile;
  dispose.openReview = reviews.open;
  dispose.isReviewing = () => reviewing;
  dispose.getSelection = () => {
    if (reviewing) return null;
    const range = editor.getSelection();
    const model = editor.getModel();
    if (!range || range.isEmpty() || !model || !selected) return null;
    const content = model.getValueInRange(range);
    if (content.length > 32000)
      throw new Error('Select at most 32,000 characters.');
    return {
      filename: selected.path,
      language: model.getLanguageId(),
      lines: `${range.startLineNumber}:${range.startColumn}–${range.endLineNumber}:${range.endColumn}`,
      content,
    };
  };
  dispose.getFileId = () => selected?.id;
  dispose.closeFile = (id: string) => {
    if (selected?.id === id) return;

    const entry = models.get(id);

    entry?.binding.destroy();
    entry?.model.dispose();
    models.delete(id);
  };

  return dispose;
}
