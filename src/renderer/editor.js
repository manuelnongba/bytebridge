import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { MonacoBinding } from 'y-monaco';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:1234', 'room1', ydoc);
const yText = ydoc.getText('monaco');

const editor = monaco.editor.create(document.getElementById('editor'), {
  value: '',
  language: 'javascript',
  theme: 'vs-dark',
});

new MonacoBinding(
  yText,
  editor.getModel(),
  new Set([editor]),
  provider.awareness
);
