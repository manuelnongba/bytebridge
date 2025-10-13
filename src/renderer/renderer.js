import 'monaco-editor';
import { initializeEditor } from './editor/index.js';
import { joinRoom } from './collaboration/connection.ts';

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

const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('name-input');
const joinButton = document.getElementById('join-button');
const editorSection = document.querySelector('section');

async function startEditing(roomId, name) {
  const { provider, ydoc } = joinRoom(roomId);

  await new Promise((resolve) => {
    provider.once('status', (event) => {
      if (event.status === 'connected') resolve();
    });
  });

  nameModal.style.display = 'none';
  editorSection.style.display = 'block';

  initializeEditor(provider, ydoc, name);
}

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

  // Show modal to enter name
  nameModal.style.display = 'flex';

  joinButton.onclick = () => {
    const name = nameInput.value;
    if (name) {
      localStorage.setItem('username', name);
      startEditing(roomId, name);
    }
  };
});

joinButton.addEventListener('click', () => {
  const name = nameInput.value;
  if (name) {
    localStorage.setItem('username', name);
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room') || 'default-room';
    startEditing(roomId, name);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('username');
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');

  if (savedName && !roomIdFromUrl) {
    startEditing('default-room', savedName);
  } else {
    nameModal.style.display = 'flex';
  }
});
