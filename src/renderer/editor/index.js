import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { MonacoBinding } from 'y-monaco';
import { WEBSOCKET_URL, ROOM_ID, EDITOR_CONFIG } from './config.ts';
import { setupLanguageSelect } from './language.ts';
import { PresenceManager } from './presence.ts';

export function initializeEditor() {
  const ydoc = new Y.Doc();
  const yText = ydoc.getText('monaco');

  const supportedLanguages = monaco.languages.getLanguages().map((lang) => ({
    id: lang.id,
    name: lang.aliases?.[0] || lang.id,
  }));

  const provider = new WebsocketProvider(WEBSOCKET_URL, ROOM_ID, ydoc);
  const editor = monaco.editor.create(
    document.getElementById('editor'),
    EDITOR_CONFIG
  );

  const languageSelect = document.getElementById('language-select');
  const remoteCursorName = document.getElementById('remote-cursor-name');

  setupLanguageSelect(supportedLanguages, languageSelect, editor);

  const presenceManager = new PresenceManager(editor);
  presenceManager.setupAwareness(editor, provider.awareness, remoteCursorName);

  provider.awareness.on('change', () => {
    presenceManager.updateCursors(
      Array.from(provider.awareness.getStates()),
      provider.awareness,
      remoteCursorName
    );
  });

  const model = editor.getModel();
  new MonacoBinding(yText, model, new Set([editor]), provider.awareness);

  return editor;
}
