import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

export function joinRoom(roomId: string, server: string, token: string) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(
    server.replace(/^http/, 'ws'),
    roomId,
    ydoc,
    {
      params: { token },
      disableBc: true,
    },
  );

  return { provider, ydoc };
}
