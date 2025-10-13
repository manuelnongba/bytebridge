import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

export const WEBSOCKET_URL = 'ws://localhost:1234';

export function joinRoom(roomId: string) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(WEBSOCKET_URL, roomId, ydoc);

  return { provider, ydoc };
}
