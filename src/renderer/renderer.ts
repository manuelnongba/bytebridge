import { initializeDropdown } from './ui/dropdown.js';
import { initializeAI } from './ai/panel.js';
import {
  openCheckpointFile,
  openCheckpointComparison,
} from './investigation/version-review.js';
import { initializeSessionPicker } from './ui/session-picker.js';
import 'monaco-editor';
import type { Room, Dispose } from '../shared/contracts.js';
import type { ViewElements } from './ui/view-elements.js';
import { element, errorMessage } from './ui/dom.js';
import { APP_CONFIG } from './app-config.js';
import { initializeContext } from './debugging/context.js';
import { initializeHistory } from './debugging/history.js';
import { searchSessions } from './resolution/data.js';
import { openPanel, closePanel } from './ui/panels.js';
import { initializeRoomManagement } from './ui/room-management.js';
import { initializePanelResize } from './ui/panel-resize.js';
import { DEFAULT_LANGUAGE } from './editor/config/index.js';
import { initializeEditor } from './editor/index.js';
import { initializeWorkspace } from './workspace/panel.js';
import { initializeNavigation, type Command } from './ui/navigation.js';
import { initializeAppearance } from './ui/appearance.js';
import { workspaceKey } from './workspace/preferences.js';
import { workspaceFiles } from './workspace/data.js';
import { snapshotWorkspace } from './workspace/data.js';
import { joinRoom } from './collaboration/connection.js';
import {
  readSavedRooms,
  sameRoom,
  manageSavedRooms,
} from './collaboration/room-store.js';
import {
  accessDenied,
  parseInvitation,
  request,
  serverAddress,
} from './collaboration/access.js';

self.MonacoEnvironment = {
  getWorkerUrl(_id, label) {
    if (label === 'json') return './json.worker.js';

    if (['css', 'scss', 'less'].includes(label)) return './css.worker.js';

    if (['html', 'handlebars', 'razor'].includes(label))
      return './html.worker.js';

    if (['typescript', 'javascript'].includes(label)) return './ts.worker.js';

    return './editor.worker.js';
  },
};

const $ = <K extends keyof ViewElements>(id: K): ViewElements[K] =>
  element<ViewElements[K]>(id);

type Session = Room &
  ReturnType<typeof joinRoom> & {
    room: Room;
    denied: boolean;
    checking: boolean;
    disposeEditor: ReturnType<typeof initializeEditor> | null;
    disposeWorkspace?: ReturnType<typeof initializeWorkspace>;
    disposeContext: ReturnType<typeof initializeContext>;
    disposeHistory?: Dispose;
    disposeAI?: ReturnType<typeof initializeAI>;
    accessTimer?: ReturnType<typeof setInterval>;
  };

initializeAppearance();
const panelResize = initializePanelResize(APP_CONFIG.panels);

let active: Session | null = null;
let busy = false;
let managementBusy = false;
let joinAttempt = 0;
let accessAttempt = 0;
let returnFocus: HTMLElement | null = null;
let invitationReceived = false;
const saved = readSavedRooms(localStorage);
const renderManagement = initializeRoomManagement({
  selected: () =>
    $('saved-room').value === '' ? null : saved[Number($('saved-room').value)],
  update: updateSavedRoom,
  setBusy(value) {
    managementBusy = value;
    $('join-button').disabled = value || busy;

    for (const id of [
      'saved-room',
      'session-filter',
      'session-search',
      'room-mode',
    ] as const)
      $(id).disabled = value;

    sessionPicker.refresh();
    if (!value) fields();
  },
  async openForExport(room) {
    if (sameRoom(active, room)) {
      hideJoin();
      openPanel('debug-context');
      $('problem-history').open = true;

      return;
    }

    const name = $('name-input').value.trim();

    if (!name) throw new Error('Enter your display name first.');

    if (!canSwitch()) throw new Error('Room switch canceled.');

    const metadata = await request(room.server, `/rooms/${room.id}`, {
      token: room.token,
    });

    startEditing({ ...room, ...metadata }, name);
    $('open-context').click();
    $('problem-history').open = true;
    $('room-notice').textContent =
      'Wait for sync, then use Export history in Problem. Deletion has not been performed.';
  },
});

const sessionPicker = initializeSessionPicker(
  (query) =>
    new Set(searchSessions(saved, query).map(({ index }) => String(index))),
);

$('server-input').value =
  localStorage.getItem('bytebridge-server') || APP_CONFIG.defaultServer;
$('name-input').value = localStorage.getItem('username') || '';

for (const { hours, label } of APP_CONFIG.invitations.durations) {
  const option = new Option(label, String(hours));

  option.selected = hours === APP_CONFIG.invitations.defaultHours;
  $('invite-hours').append(option);
}

const roomDropdowns = ['room-mode', 'session-filter', 'invite-hours'].map(
  (id) => initializeDropdown(element<HTMLSelectElement>(id)),
);

function renderSaved() {
  const selected = $('saved-room').value;

  $('saved-room').replaceChildren();

  const matches = searchSessions(saved, '').filter(({ room }) => {
    const filter = $('session-filter').value;

    return (
      filter === 'all' ||
      (filter === 'archived' ? room.archived : !room.archived)
    );
  });

  matches.forEach(({ room, index }) => {
    const option = document.createElement('option');

    option.value = String(index);
    option.dataset.title = room.title || room.id;
    option.dataset.detail = `${room.search?.resolved ? 'Resolved' : 'Open'} · ${room.role} · ${room.server}${room.search?.tags?.length ? ' · ' + room.search.tags.join(', ') : ''}`;
    option.textContent = `${room.title || room.id} — ${room.search?.resolved ? 'Resolved' : 'Open'} — ${room.server} (${room.role})${room.search?.tags?.length ? ` · ${room.search.tags.join(', ')}` : ''}`;
    $('saved-room').append(option);
  });

  if (matches.some(({ index }) => String(index) === selected))
    $('saved-room').value = selected;

  sessionPicker.refresh();
  renderManagement();
}

function updateSavedRoom(
  room: Room,
  action: 'rename' | 'archive' | 'forget',
  value?: string | boolean,
) {
  const next = manageSavedRooms(saved, room, action, value);

  // Persist first: a storage failure must not silently lose the only owner credential.
  localStorage.setItem('bytebridge-rooms', JSON.stringify(next));
  saved.splice(0, saved.length, ...next);

  if (active && sameRoom(active, room)) {
    if (action === 'rename') {
      active.title = String(value || '');
      active.room.title = String(value || '');

      if ('setTitle' in active.disposeContext)
        active.disposeContext.setTitle(String(value || ''));

      $('room-label').textContent = `${value} · ${active.role}`;
    } else if (action === 'forget') {
      leaveRoom();
      $('editor-panel').style.display = 'none';
      $('empty-workspace').hidden = false;
      $('room-overview').hidden = true;

      for (const id of [
        'open-context',
        'resolution-badge',
        'manage-invites',
      ] as const)
        $(id).hidden = true;

      closePanel('access-panel');
      $('copy-invite').disabled = true;
      $('room-label').textContent = 'Your next idea starts here';
      $('room-label').title = '';
      $('room-notice').textContent = '';
      $('connection-status').textContent = 'Not connected';
      $('connection-status').dataset.state = 'idle';
      $('local-user').textContent = 'Ready when you are';
      $('cancel-join').textContent = 'Cancel';
    }
  }

  renderSaved();
}

function fields() {
  sessionPicker.close();
  const titles: Record<string, string> = {
    create: 'Create a shared space',
    join: 'Join your teammates',
    resume: 'Welcome back',
  };

  $('join-title').textContent = titles[$('room-mode').value] || 'Join a room';

  for (const [mode, id] of [
    ['create', 'create-fields'],
    ['join', 'invite-fields'],
    ['resume', 'resume-fields'],
  ] as const) {
    const hidden = $('room-mode').value !== mode;

    $(id).hidden = hidden;
    $(id)
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input, select, textarea')
      .forEach((input) => {
        input.disabled = hidden;
      });
  }
  sessionPicker.refresh();
}

function showJoin(mode: string) {
  if ($('name-modal').style.display !== 'flex')
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

  invalidateJoin();
  $('workspace').inert = true;
  $('cancel-join').textContent = active ? 'Back to current room' : 'Cancel';
  $('join-error').textContent = '';
  $('room-mode').value = mode;
  $('session-search').value = '';
  $('session-filter').value = 'active';

  for (const picker of roomDropdowns) picker.refresh();
  fields();
  renderSaved();
  $('name-modal').style.display = 'flex';
  $('name-input').focus();
}

function hideJoin() {
  for (const picker of roomDropdowns) picker.close();

  sessionPicker.close();
  $('workspace').inert = false;
  $('name-modal').style.display = 'none';

  const target =
    returnFocus?.isConnected && returnFocus !== document.body
      ? returnFocus
      : $('open-join');

  target.focus();
}

function invalidateJoin() {
  joinAttempt++;
  busy = false;
  $('join-button').disabled = false;
}

function cancelJoin() {
  invalidateJoin();
  hideJoin();
}

function leaveRoom() {
  if (!active) return;

  const old = active;

  active = null;
  clearInterval(old.accessTimer);
  old.disposeAI?.();
  old.disposeWorkspace?.();
  old.disposeEditor?.();
  old.disposeContext();
  old.disposeHistory?.();
  old.provider.destroy();
  old.ydoc.destroy();
}

function canSwitch() {
  return (
    !active ||
    active.provider.synced ||
    window.confirm(
      'This room has not finished syncing. Switching rooms can discard unsent edits. Switch anyway?',
    )
  );
}

function remember(room: Room) {
  const index = saved.findIndex(
    (item) =>
      item.id === room.id &&
      item.server === room.server &&
      item.token === room.token,
  );

  if (index >= 0)
    saved[index] = {
      ...saved[index],
      ...room,
      archived: !!saved[index]?.archived,
    };
  else saved.push(room);

  localStorage.setItem('bytebridge-rooms', JSON.stringify(saved));
  localStorage.setItem('bytebridge-server', room.server);
}

function startEditing(room: Room, name: string) {
  leaveRoom();
  remember(room);
  localStorage.setItem('username', name);
  hideJoin();
  $('empty-workspace').hidden = true;
  $('editor-panel').style.display = 'none';
  $('workspace-body').dataset.stage = 'overview';
  $('room-label').textContent = `${room.title || room.id} · ${room.role}`;
  $('room-label').title = `${room.server} / ${room.id}`;
  $('room-notice').textContent = '';
  $('copy-invite').disabled = room.role !== 'owner';
  $('manage-invites').hidden = room.role !== 'owner';
  $('access-panel').hidden = true;
  accessAttempt++;
  $('local-user').textContent = name;

  const { provider, ydoc } = joinRoom(room.id, room.server, room.token);
  const session: Session = {
    ...room,
    room,
    provider,
    ydoc,
    denied: false,
    checking: false,
    disposeEditor: null,
    disposeContext: initializeContext(ydoc, provider, room.title || room.id),
  };

  active = session;
  if (APP_CONFIG.navigation.restoreWorkspace)
    panelResize?.setRoom(workspaceKey(room.server, room.id));
  session.disposeHistory = initializeHistory(
    ydoc,
    provider,
    $('debug-context'),
    name,
    () =>
      snapshotWorkspace(
        ydoc,
        session.disposeEditor?.getLegacyLanguage() || DEFAULT_LANGUAGE,
      ),
    (search) => {
      if (active !== session) return;

      try {
        remember({ ...room, search });
      } catch {
        $('room-notice').textContent =
          'Local session cache is full. Shared room data is unaffected.';
      }
    },
    {
      open(checkpoint, file) {
        if (!session.disposeEditor) openEditor();
        if (!session.disposeEditor) return;
        openCheckpointFile(session.disposeEditor, checkpoint, file, () => {
          const live = workspaceFiles(ydoc).find((item) => item.id === file.id);
          return live?.text
            ? {
                id: live.id,
                path: live.path,
                language: live.language,
                mode: live.mode,
                code: live.text.toString(),
              }
            : undefined;
        });
      },
      compare(before, after) {
        if (!session.disposeEditor) openEditor();
        if (session.disposeEditor)
          openCheckpointComparison(session.disposeEditor, before, after);
      },
    },
  );

  const openEditor = () => {
    if (active !== session || session.denied || session.disposeEditor) return;

    $('room-overview').hidden = true;
    closePanel('debug-context');
    $('debug-context').classList.remove('overview-mode');
    $('editor-panel').style.display = 'flex';
    $('workspace-body').dataset.stage = 'editing';
    session.disposeEditor = initializeEditor(provider, ydoc, name, () => {
      try {
        attachSelection();
      } catch (error) {
        $('room-notice').textContent = errorMessage(error);
      }
    });
    session.disposeWorkspace = initializeWorkspace(
      ydoc,
      provider,
      session.disposeEditor,
      workspaceKey(room.server, room.id),
    );

    if (APP_CONFIG.workspace.enabled) openPanel('files-panel');
  };

  session.disposeAI = initializeAI(
    ydoc,
    provider,
    room,
    $('debug-context'),
    () => {
      if (!session.disposeEditor) openEditor();

      return session.disposeEditor;
    },
  );

  $('enter-editor').onclick = openEditor;

  const showOverview =
    APP_CONFIG.debugging.enabled && APP_CONFIG.debugging.overviewBeforeEditor;

  $('room-overview').hidden = !showOverview;
  $('debug-context').classList.toggle('overview-mode', showOverview);
  $('debug-context').hidden = !showOverview;

  if (showOverview) openPanel('debug-context');

  if (!showOverview) openEditor();

  const updateStatus = () => {
    if (active !== session) return;

    const connected = provider.synced && provider.wsconnected;

    $('enter-editor').disabled = session.denied || !provider.synced;
    $('overview-status').textContent = session.denied
      ? 'Access expired, revoked, or room deleted. Check with the owner.'
      : connected
        ? 'Review the problem, selected snippets, and previous attempts below. Open the editor when ready.'
        : 'Waiting for the server to load the room context…';
    $('connection-status').dataset.state = connected ? 'connected' : 'offline';
    $('connection-status').textContent = session.denied
      ? 'Access expired, revoked, or room deleted. Check with the owner.'
      : connected
        ? 'Connected'
        : provider.wsconnected
          ? 'Syncing…'
          : 'Disconnected — retrying automatically. Keep this window open to retain unsynced edits.';
  };

  const checkAccess = async () => {
    if (active !== session || session.checking || session.denied) return;

    session.checking = true;

    try {
      const metadata = await request(room.server, `/rooms/${room.id}`, {
        token: room.token,
      });

      if (active === session && metadata.title !== room.title)
        updateSavedRoom(room, 'rename', metadata.title);
    } catch (error) {
      if (accessDenied(error) && active === session) {
        session.denied = true;
        provider.disconnect();
        session.disposeEditor?.setReadOnly(true);
        session.disposeWorkspace?.setReadOnly(true);
        session.disposeContext.setReadOnly(true);
        session.disposeHistory?.setReadOnly(true);
        session.disposeAI?.setReadOnly(true);
        updateStatus();
      }
    } finally {
      session.checking = false;
    }
  };

  provider.on('status', updateStatus);
  provider.on('sync', updateStatus);
  provider.on('connection-error', checkAccess);
  provider.on('connection-close', checkAccess);
  session.accessTimer = setInterval(
    checkAccess,
    APP_CONFIG.accessCheckIntervalMs,
  );
  updateStatus();
  void checkAccess();
}

function invitationPreview() {
  try {
    $('invite-destination').textContent =
      `Connect to ${parseInvitation($('invite-input').value).server}`;
  } catch {
    $('invite-destination').textContent = '';
  }
}

function acceptInvitation(value: string) {
  invitationReceived = true;
  $('invite-input').value = value;
  invitationPreview();
  showJoin('join');
}

async function copyInvitation() {
  if (!active || active.role !== 'owner') return;

  const room = active;

  try {
    const invite = await request<{ token: string; expiresAt: number }>(
      room.server,
      `/rooms/${room.id}/invites`,
      {
        method: 'POST',
        token: room.token,
        data: { hours: Number($('invite-hours').value) },
      },
    );

    if (active !== room) return;

    const url = new URL('myapp://join');

    url.search = new URLSearchParams({
      room: room.id,
      server: room.server,
      token: invite.token,
    }).toString();

    const copied = await window.api.copyToClipboard(url.href);

    if (!copied) throw new Error('Could not copy the invitation. Try again.');

    $('room-notice').textContent =
      `Invitation copied. Anyone with this link can edit until ${new Date(invite.expiresAt).toLocaleString()}.`;

    if (!$('access-panel').hidden) await manageInvites();
  } catch (error) {
    $('room-notice').textContent = errorMessage(error);
  }
}

async function manageInvites() {
  if (!active || active.role !== 'owner') return;

  const room = active;
  const attempt = ++accessAttempt;

  openPanel('access-panel');
  $('invite-list').textContent = 'Loading invitations…';

  try {
    const invites = await request<
      { id: string; revoked: boolean; expiresAt: number }[]
    >(room.server, `/rooms/${room.id}/invites`, {
      token: room.token,
    });

    if (active !== room || attempt !== accessAttempt) return;

    $('invite-list').replaceChildren();

    for (const invite of invites) {
      const row = document.createElement('div');

      row.className = 'invite-row';

      const label = document.createElement('span');

      label.textContent = `${invite.id.slice(0, 8)} · ${invite.revoked ? 'Revoked' : `Expires ${new Date(invite.expiresAt).toLocaleString()}`}`;

      const button = document.createElement('button');

      button.className = 'button danger';
      button.textContent = 'Revoke';
      button.disabled = invite.revoked;
      button.onclick = async () => {
        button.disabled = true;

        try {
          await request(room.server, `/rooms/${room.id}/invites/${invite.id}`, {
            method: 'DELETE',
            token: room.token,
          });

          if (active === room && !$('access-panel').hidden)
            await manageInvites();
        } catch (error) {
          button.disabled = false;
          $('room-notice').textContent = errorMessage(error);
        }
      };
      row.append(label, button);
      $('invite-list').append(row);
    }
  } catch (error) {
    if (active !== room || attempt !== accessAttempt) return;

    $('invite-list').textContent = '';
    $('room-notice').textContent = errorMessage(error);
  }
}

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (busy || managementBusy || !$('name-input').value.trim() || !canSwitch())
    return;

  busy = true;

  const attempt = ++joinAttempt;
  const mode = $('room-mode').value;
  const name = $('name-input').value.trim();

  $('join-button').disabled = true;
  $('join-error').textContent = '';

  try {
    let room;

    if (mode === 'create') {
      const server = serverAddress($('server-input').value);
      const result = await request(server, '/rooms', {
        method: 'POST',
        creationKey: $('creation-key').value,
        data: { title: $('room-title').value },
      });

      room = { ...result, server };
      // Keep the owner credential even if the dialog was dismissed during creation.
      remember(room);
      renderSaved();
    } else {
      room =
        mode === 'join'
          ? parseInvitation($('invite-input').value)
          : $('saved-room').value === ''
            ? null
            : saved[Number($('saved-room').value)];

      if (!room)
        throw new Error(
          'No saved room selected. Create a room or paste an invitation.',
        );

      room = { ...room, server: serverAddress(room.server) };

      try {
        room = {
          ...room,
          ...(await request(room.server, `/rooms/${room.id}`, {
            token: room.token,
          })),
        };
      } catch (error) {
        // Resume a previously admitted room offline; never admit a new invitation without validation.
        if (accessDenied(error) || mode !== 'resume') throw error;
      }
    }

    if (attempt === joinAttempt) startEditing(room, name);
  } catch (error) {
    if (attempt !== joinAttempt) return;

    $('join-error').textContent =
      errorMessage(error) ||
      'Could not reach the server. Check its address and try again.';
  } finally {
    if (attempt === joinAttempt) {
      busy = false;
      $('join-button').disabled = false;
    }
  }
});
$('room-mode').onchange = () => {
  invalidateJoin();
  fields();
};
$('invite-input').oninput = invitationPreview;
$('create-room').onclick = () => showJoin('create');
$('open-join').onclick = () => showJoin('join');
$('copy-invite').onclick = copyInvitation;
$('manage-invites').onclick = () => {
  if ($('access-panel').hidden) void manageInvites();
  else closeAccess();
};

function closeAccess() {
  accessAttempt++;
  closePanel('access-panel');
  $('manage-invites').focus();
}

$('close-access').onclick = closeAccess;
$('access-panel').onkeydown = (event) => {
  if (event.key === 'Escape') closeAccess();
};
$('resume-room').onclick = () => showJoin('resume');
// $('open-library').onclick = () => showJoin('resume');
$('session-filter').onchange = renderSaved;
$('saved-room').onchange = () => {
  sessionPicker.refresh();
  renderManagement();
};
$('cancel-join').onclick = cancelJoin;
$('close-join').onclick = cancelJoin;
$('name-modal').addEventListener('click', (event) => {
  if (event.target === $('name-modal')) cancelJoin();
});
window.api.onCreateRoom(() => showJoin('create'));
window.api.onDeepLink(acceptInvitation);
$('name-modal').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelJoin();
  }

  if (event.key !== 'Tab') return;

  const fields = [
    ...$('join-form').querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      'input, button, select, textarea, summary',
    ),
  ].filter((el) => el.getClientRects().length && !el.disabled);
  const first = fields[0],
    last = fields[fields.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
window.addEventListener('beforeunload', leaveRoom);

async function initialize() {
  const pending = await window.api.ready();

  if (pending && !invitationReceived) acceptInvitation(pending);

  if (!invitationReceived) showJoin(saved.length ? 'resume' : 'create');
}

function attachSelection() {
  if (!active || active.denied || !active.provider.synced) return;
  const selection = active.disposeEditor?.getSelection();
  if (!selection) {
    $('room-notice').textContent = 'Select a code range in the editor first.';
    return;
  }
  active.disposeContext.addAttachment(selection);
}
const roomAvailable = () => !!active?.disposeEditor && !active.denied;
const buttonAvailable = (id: string) => {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  return roomAvailable() && !!button && !button.hidden && !button.disabled;
};
const shortcuts = APP_CONFIG.navigation.shortcuts;
document
  .getElementById('open-terminal')
  ?.setAttribute(
    'title',
    `Open terminal (${shortcuts.terminal}); click again to close and end the shell`,
  );
const commands: Command[] = [
  {
    id: 'terminal',
    label: 'Open terminal',
    group: 'Workspace',
    shortcut: shortcuts.terminal,
    available: () => buttonAvailable('open-terminal'),
    run: () =>
      document
        .getElementById('open-terminal')
        ?.dispatchEvent(new Event('terminal-open')),
  },
  {
    id: 'ai-catch-up',
    label: 'Catch me up',
    group: 'Problem',
    available: () => !!active && !active.denied && active.provider.synced,
    run: () => active?.disposeAI?.show(),
  },
  {
    id: 'commands',
    label: 'Show all commands',
    group: 'Navigation',
    shortcut: shortcuts.commands,
    available: () => true,
    run: () => navigation.show('commands'),
  },
  {
    id: 'files',
    label: 'Open file…',
    group: 'Navigation',
    shortcut: shortcuts.files,
    available: () => roomAvailable() && APP_CONFIG.navigation.quickOpen,
    run: () => navigation.show('files'),
  },
  {
    id: 'attach',
    label: 'Attach selection to problem…',
    group: 'Problem',
    shortcut: shortcuts.attach,
    available: () =>
      roomAvailable() &&
      !!active?.provider.synced &&
      APP_CONFIG.navigation.selectionAttachments &&
      APP_CONFIG.debugging.enabled,
    run: attachSelection,
  },
  ...[
    ['problem', 'Show problem', 'Problem', 'open-context'],
    ['file-panel', 'Show files', 'Files', 'open-files'],
    ['share', 'Share project…', 'Files', 'open-project'],
    ['save', 'Save to project', 'Files', 'save-project-file'],
    ['copy', 'Save file copy…', 'Files', 'save-workspace-file'],
    ['conflict', 'Review disk changes…', 'Files', 'review-disk-changes'],
  ].map(([id, label, group, target]) => ({
    id: id!,
    label: label!,
    group: group!,
    shortcut: id === 'save' ? shortcuts.save : '',
    available: () =>
      id === 'conflict'
        ? !!active?.disposeWorkspace?.canReviewDisk()
        : buttonAvailable(target!),
    run: () => document.getElementById(target!)?.click(),
  })),
];
const navigation = initializeNavigation(
  commands,
  () =>
    active
      ? workspaceFiles(active.ydoc).map((file) => ({
          id: file.id,
          label: file.path,
          detail: `${file.projectName || 'Room'} · ${file.text ? 'loaded' : 'loads from host when opened'}`,
          run: () => {
            void active?.disposeWorkspace?.open(file.id);
          },
        }))
      : [],
  (message) => {
    $('room-notice').textContent = message;
  },
);
window.api.onMenuCommand((id) => {
  if (document.querySelector('dialog[open]')) return;

  if (id === 'create-room' || id === 'join-room' || id === 'saved-sessions') {
    showJoin(
      id === 'create-room' ? 'create' : id === 'join-room' ? 'join' : 'resume',
    );
    return;
  }

  if ($('workspace').inert) return;

  const command = commands.find((item) => item.id === id);

  if (!command?.available()) {
    $('room-notice').textContent =
      'This action is not available in the current session.';
    return;
  }

  command.run();
});
const commandsButton = document.createElement('button');
commandsButton.className = 'editor-command-button';
commandsButton.id = 'open-commands';
commandsButton.type = 'button';
commandsButton.textContent = 'Commands';
const commandHint = document.createElement('kbd');
commandHint.textContent = shortcuts.commands
  .replace('Mod', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl')
  .replace('Shift', '⇧');
commandHint.setAttribute('aria-hidden', 'true');
commandsButton.append(commandHint);
commandsButton.setAttribute('aria-label', 'Open command palette');
commandsButton.title = `Search commands (${shortcuts.commands})`;
commandsButton.hidden = !APP_CONFIG.navigation.enabled;
commandsButton.onclick = () => navigation.show('commands');
element('editor-actions').append(commandsButton);
void initialize();
