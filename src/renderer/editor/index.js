import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { MonacoBinding } from 'y-monaco';

import { EDITOR_CONFIG } from './config/index.ts';
import { setupLanguage } from './config/language-features.ts';
import { PresenceManager } from '../collaboration/presence.ts';
import { APP_CONFIG } from '../app-config.js';
import { trackTyping, typingLabel } from '../collaboration/typing.js';

export function initializeEditor(provider, ydoc, name) {
  const yText = ydoc.getText('monaco');

  const supportedLanguages = monaco.languages.getLanguages().map((lang) => ({
    id: lang.id,
    name: lang.aliases?.[0] || lang.id,
  }));

  const editor = monaco.editor.create(
    document.getElementById('editor'),
    EDITOR_CONFIG,
  );

  const languageSelect = document.getElementById('language-select');
  const remoteCursorName = document.getElementById('remote-cursor-name');

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
    const states = provider.wsconnected
      ? Array.from(provider.awareness.getStates())
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

  const model = editor.getModel();
  const binding = new MonacoBinding(
    yText,
    model,
    new Set([editor]),
    provider.awareness,
  );
  const disposeTyping = trackTyping(
    provider,
    yText,
    binding,
    APP_CONFIG.presence,
    updatePresence,
  );
  updatePresence();
  editor.focus();

  const dispose = () => {
    disposeTyping();
    provider.awareness.off('change', updatePresence);
    presenceManager.dispose();
    disposeLanguage();
    binding.destroy();
    editor.dispose();
    model.dispose();
    remoteCursorName.textContent = '';
  };
  dispose.setReadOnly = (readOnly) => editor.updateOptions({ readOnly });
  dispose.getLanguage = () => model.getLanguageId();
  return dispose;
}
