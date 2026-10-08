import { APP_CONFIG } from '../app-config.js';
import { request } from '../collaboration/access.js';

export function initializeRoomManagement({
  selected,
  update,
  openForExport,
  setBusy,
}) {
  const root = document.getElementById('session-management');
  const config = APP_CONFIG.roomManagement;
  let running = false;
  const button = (label, id, handler) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'button secondary';
    el.id = id;
    el.textContent = label;
    el.onclick = handler;
    return el;
  };
  return function render() {
    if (running) return;
    root.replaceChildren();
    const room = selected();
    if (!room) return;
    const menu = document.createElement('details');
    const toggle = document.createElement('summary');
    toggle.textContent = '⋯ Manage selected session';
    const status = document.createElement('p');
    status.id = 'session-action-status';
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const confirmation = document.createElement('div');
    confirmation.id = 'session-confirmation';
    const run = async (work) => {
      if (running) return;
      running = true;
      setBusy(true);
      root
        .querySelectorAll('button, input')
        .forEach((el) => (el.disabled = true));
      status.textContent = 'Working…';
      try {
        const message = await work();
        running = false;
        render();
        document.getElementById('join-error').textContent = message;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        running = false;
        setBusy(false);
        root
          .querySelectorAll('button, input')
          .forEach((el) => (el.disabled = false));
      }
    };
    const ask = (description, label, id, handler, inputLabel) => {
      confirmation.replaceChildren();
      const text = document.createElement('p');
      text.textContent = description;
      confirmation.append(text);
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'session-confirm-input';
      if (inputLabel) {
        const labelEl = document.createElement('label');
        labelEl.textContent = inputLabel;
        labelEl.append(input);
        confirmation.append(labelEl);
      }
      const confirm = button(label, id, () => run(() => handler(input.value)));
      const cancel = button('Cancel action', 'cancel-session-action', () => {
        confirmation.replaceChildren();
        status.textContent = '';
        toggle.focus();
      });
      confirmation.append(confirm, cancel);
      if (inputLabel) input.focus();
      else cancel.focus();
      // Enter in an action input must never submit the outer join form.
      input.onkeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          confirm.click();
        }
      };
      return { input, confirm };
    };
    if (config.renameEnabled && room.role === 'owner')
      actions.append(
        button('Rename', 'rename-session', () => {
          const { input } = ask(
            'Rename this room for everyone. Connected clients refresh the title periodically.',
            'Save name',
            'confirm-rename-session',
            async (title) => {
              title = title.trim();
              if (!title || title.length > config.titleMaxLength)
                throw new Error(`Use 1–${config.titleMaxLength} characters.`);
              const result = await request(room.server, `/rooms/${room.id}`, {
                method: 'PATCH',
                token: room.token,
                data: { title },
              });
              update(room, 'rename', result.title);
              return 'Room renamed.';
            },
            'Room name',
          );
          input.maxLength = config.titleMaxLength;
          input.value = room.title || '';
        }),
      );
    if (config.archiveEnabled)
      actions.append(
        button(room.archived ? 'Unarchive' : 'Archive', 'archive-session', () =>
          run(async () => {
            update(room, 'archive', !room.archived);
            return room.archived
              ? 'Session restored to your list.'
              : 'Archived on this profile only. Access and investigation status are unchanged.';
          }),
        ),
      );
    if (config.forgetEnabled)
      actions.append(
        button('Forget on this device', 'forget-session', () => {
          ask(
            `Forget “${room.title || room.id}”? This removes all saved credentials and search details for this room from this profile and closes it if active. Unsent edits and private drafts will be lost. The server room is not deleted. You will need an invitation to return; an owner who forgets their only owner credential loses room-management access.`,
            'Forget session',
            'confirm-forget-session',
            async () => {
              update(room, 'forget');
              return 'Forgotten on this profile. The server room was not deleted.';
            },
          );
        }),
      );
    if (config.deleteEnabled && room.role === 'owner')
      actions.append(
        button('Delete permanently…', 'delete-session', () => {
          const { input, confirm } = ask(
            `Permanently delete “${room.title || room.id}” for everyone? This disconnects collaborators and removes server-held code, context, investigation history, and invitations. It cannot be undone. Existing exports, backups, and other devices’ copies are not erased. Export anything you need first.`,
            'Delete room for everyone',
            'confirm-delete-session',
            async (confirmTitle) => {
              if (confirmTitle !== room.title)
                throw new Error('Type the exact room name to confirm.');
              await request(room.server, `/rooms/${room.id}`, {
                method: 'DELETE',
                token: room.token,
                data: { confirmTitle },
              });
              update(room, 'forget');
              return 'Room permanently deleted from the server and forgotten on this profile. Existing copies/backups are unaffected.';
            },
            `Type the room name exactly: ${room.title}`,
          );
          confirm.classList.add('danger');
          confirm.disabled = true;
          input.oninput = () => (confirm.disabled = input.value !== room.title);
          confirmation.prepend(
            button(
              'Open room to review/export first',
              'export-before-delete',
              () =>
                run(async () => {
                  await openForExport(room);
                  return '';
                }),
            ),
          );
        }),
      );
    menu.append(toggle, actions, confirmation, status);
    root.append(menu);
  };
}
