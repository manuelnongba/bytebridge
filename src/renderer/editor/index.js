import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { MonacoBinding } from 'y-monaco';

import { EDITOR_CONFIG } from './config/index.ts';
import { setupLanguage } from './config/language-features.ts';
import { PresenceManager } from '../collaboration/presence.ts';

export function initializeEditor(provider, ydoc, name) {
  const yText = ydoc.getText('monaco');

  const supportedLanguages = monaco.languages.getLanguages().map((lang) => ({
    id: lang.id,
    name: lang.aliases?.[0] || lang.id,
  }));

  const editor = monaco.editor.create(
    document.getElementById('editor'),
    EDITOR_CONFIG
  );

  const languageSelect = document.getElementById('language-select');
  const remoteCursorName = document.getElementById('remote-cursor-name');

  setupLanguage(supportedLanguages, languageSelect, editor);

  const presenceManager = new PresenceManager(editor);
  presenceManager.setupAwareness(
    editor,
    provider?.awareness,
    remoteCursorName,
    name
  );

  provider?.awareness.on('change', () => {
    presenceManager.updateCursors(
      Array.from(provider?.awareness.getStates()),
      provider?.awareness,
      remoteCursorName
    );
  });

  const model = editor.getModel();
  new MonacoBinding(yText, model, new Set([editor]), provider?.awareness);

  return editor;
}
