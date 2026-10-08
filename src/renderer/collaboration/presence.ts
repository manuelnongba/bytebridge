import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { Awareness } from 'y-protocols/awareness.js';

export class PresenceManager {
  editor: monaco.editor.IStandaloneCodeEditor;
  decorations: Map<number, monaco.editor.IEditorDecorationsCollection>;
  styles = new Map<number, HTMLStyleElement>();
  listeners: monaco.IDisposable[] = [];

  constructor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.decorations = new Map();
  }

  updateCursors(
    states: AwarenessState,
    awareness: Awareness,
    remoteCursorName: HTMLParagraphElement,
    showLabels: boolean,
  ) {
    this.clearDecorations();
    this.styles.forEach((style) => style.remove());
    this.styles.clear();
    remoteCursorName.textContent = '';

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
            state.cursor.column + 1,
          ),
          options: {
            className: `cursor-${clientId}`,
            hoverMessage: showLabels
              ? {
                  value: String(state.user.name || 'Teammate')
                    .replace(/[\r\n]/g, ' ')
                    .slice(0, 60)
                    .replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1'),
                  isTrusted: false,
                }
              : null,
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        };
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
    this.styles.set(clientId, style);

    style.textContent = `
       .cursor-${clientId} {
          background-color: ${/^#[0-9a-f]{6}$/i.test(state.user.color) ? state.user.color : '#007acc'};
          width: 2px !important;
          margin-left: -1px;
        }
    `;
  }

  setupAwareness(
    editor: monaco.editor.IStandaloneCodeEditor,
    awareness: Awareness,
    remoteCursorName: HTMLParagraphElement,
    name: string,
  ) {
    awareness?.setLocalStateField('user', {
      name: name,
      color:
        '#' +
        Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, '0'),
    });

    this.listeners.push(
      editor.onDidChangeCursorPosition(() => {
        const position = editor.getPosition();
        if (position) {
          awareness?.setLocalStateField('cursor', {
            line: position.lineNumber,
            column: position.column,
          });
        }
      }),
    );
  }

  dispose() {
    this.listeners.forEach((listener) => listener.dispose());
    this.clearDecorations();
    this.styles.forEach((style) => style.remove());
    this.styles.clear();
  }

  clearDecorations() {
    this.decorations.forEach((collection) => collection.clear());
    this.decorations.clear();
  }
}
