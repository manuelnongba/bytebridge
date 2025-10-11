import 'monaco-editor';
import { initializeEditor } from './editor/index.js';
import { joinRoom } from './editor/config.ts';

let yProvider;

self.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    if (label === 'json') {
      return './json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './ts.worker.js';
    }
    return './editor.worker.js';
  },
};

function copyInviteLink() {
  const roomId =
    Math.random().toString(36).substring(2) +
    Date.now().toString(36).substring(2);

  const link = `myapp://join?room=${roomId}`;
  const isCopied = window.api.copyToClipboard(link);
  if (isCopied) alert(`Invite link copied: ${link}`);
}

window.api.onCreateRoom(() => {
  copyInviteLink();
});

window.api.onDeepLink(async (url) => {
  const params = new URL(url);
  const roomId = params.searchParams.get('room');
  console.log('deeplink-renderer', roomId);

  if (!roomId) return;

  const { provider, ydoc } = joinRoom(roomId);

  // Wait for provider connection
  await new Promise((resolve) => {
    provider.once('status', (event) => {
      if (event.status === 'connected') resolve();
    });
  });

  initializeEditor(provider, ydoc);
});

const { provider, ydoc } = joinRoom(1);

initializeEditor(provider, ydoc);
