import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

export const WEBSOCKET_URL = 'ws://localhost:1234';
export const ROOM_ID = 'room1';
export const DEFAULT_LANGUAGE = 'javascript';
export const EDITOR_CONFIG = {
  value: 'javascript',
  language: DEFAULT_LANGUAGE,
  theme: 'vs-dark',
  minimap: { enabled: true },
};

export function joinRoom(roomId: string) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider('ws://localhost:1234', roomId, ydoc);

  return { provider, ydoc };
}
