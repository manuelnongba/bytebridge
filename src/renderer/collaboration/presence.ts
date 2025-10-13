import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { Awareness } from 'y-protocols/awareness.js';

export class PresenceManager {
  editor: monaco.editor.IStandaloneCodeEditor;
  decorations: Map<number, monaco.editor.IEditorDecorationsCollection>;

  constructor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.decorations = new Map();
  }

  updateCursors(
    states: AwarenessState,
    awareness: Awareness,
    remoteCursorName: HTMLParagraphElement
  ) {
    this.clearDecorations();

    states.forEach(([clientId, state]) => {
      if (
        clientId !== awareness?.clientID &&
        state.user &&
        state.cursor &&
        state.user.color
      ) {
        const decoration = {
          range: new monaco.Range(
            state.cursor.line,
            state.cursor.column,
            state.cursor.line,
            state.cursor.column + 1
          ),
          options: {
            className: `cursor-${clientId}`,
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        };
        if (state.editing) {
          remoteCursorName.textContent = state.user.name + ' is editing...';

          setTimeout(() => {
            remoteCursorName.textContent = '';
          }, 1000);
        }
        this.updateCursorStyle(clientId, state);
        const collection = this.editor.createDecorationsCollection([
          decoration,
        ]);
        this.decorations.set(clientId, collection);
      }
    });
  }

  updateCursorStyle(clientId: number, state: any) {
    const style = document.createElement('style');
    document.head.appendChild(style);

    style.textContent = `
       .cursor-${clientId} {
          background-color: ${state.user.color};
          width: 2px !important;
          margin-left: -1px;
        }
    `;
  }

  setupAwareness(
    editor: monaco.editor.IStandaloneCodeEditor,
    awareness: Awareness,
    remoteCursorName: HTMLParagraphElement,
    name: string
  ) {
    awareness?.setLocalStateField('user', {
      name: name,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16),
    });

    editor.onDidChangeCursorPosition((e) => {
      const position = editor.getPosition();
      if (position) {
        awareness?.setLocalStateField('cursor', {
          line: position.lineNumber,
          column: position.column,
        });
      }
    });

    editor.onKeyUp(() => {
      awareness?.setLocalStateField('editing', true);
      setTimeout(() => {
        remoteCursorName.textContent = '';
        awareness?.setLocalStateField('editing', false);
      }, 1000);
    });
  }

  clearDecorations() {
    this.decorations.forEach((collection) => collection.clear());
    this.decorations.clear();
  }
}
