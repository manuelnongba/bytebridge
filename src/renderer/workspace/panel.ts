import { initializeTerminalPanel } from '../terminal/panel.js';
import type * as Y from 'yjs';
import type { RoomProvider, WorkspaceEditor } from '../../shared/contracts.js';
import { element, errorMessage, setButtonVariant } from '../ui/dom.js';
import { APP_CONFIG } from '../app-config.js';
import { closePanel, togglePanel } from '../ui/panels.js';
import { LEGACY_FILE, workspaceFiles, removeProject } from './data.js';
import { readWorkspace, saveWorkspace } from './preferences.js';
import { showDiskConflict } from './conflict.js';
import { createHosting } from './hosting.js';

export function initializeWorkspace(
  doc: Y.Doc,
  provider: RoomProvider,
  editor: WorkspaceEditor,
  preferenceKey: string,
) {
  const config = APP_CONFIG.workspace;
  const panel = element('files-panel');
  const toggle = element('open-files');
  const tabs = element('file-tabs');
  const title = element('active-file-label');

  if (!config.enabled)
    return Object.assign(() => {}, {
      setReadOnly() {},
      open: async (_id: string) => {},
      canReviewDisk: () => false,
    });

  toggle.hidden = tabs.hidden = false;

  let alive = true,
    denied = false,
    loading = false,
    saving = false;
  let currentId = LEGACY_FILE,
    selection = 0,
    renderedState = '';
  const remembered = APP_CONFIG.navigation.restoreWorkspace
    ? readWorkspace(preferenceKey)
    : { opened: [], active: '' };
  let restored = false;
  let pendingOfflineFile: string | null = null;
  const rememberedProjects = new Set<string>();
  let knownProjects = new Set<string>();
  let terminal: ReturnType<typeof initializeTerminalPanel> | undefined;
  let closeConflict = () => {};
  let renderedDiskChanges = '';
  const persist = () => {
    if (restored && APP_CONFIG.navigation.restoreWorkspace)
      saveWorkspace(preferenceKey, opened, currentId);
  };
  const opened = [LEGACY_FILE],
    expanded = new Set(),
    knownFolders = new Set();

  const button = (text: string, id: string | null, handler: () => void) => {
    const el = document.createElement('button');

    el.type = 'button';
    el.className = 'button secondary';
    el.textContent = text;

    if (id) el.id = id;

    el.onclick = handler;

    return el;
  };

  const heading = document.createElement('h2');

  heading.textContent = 'Files';

  const close = button('×', 'close-files', () => {
    closePanel(panel.id);
    toggle.focus();
  });

  close.className = 'close-control';
  close.setAttribute('aria-label', 'Close files');

  const help = document.createElement('div');
  const summary = document.createElement('span');
  const info = button('ⓘ', 'files-info', () => {});
  const details = document.createElement('div');
  const detailsHeading = document.createElement('strong');
  const detailsList = document.createElement('ul');

  help.className = 'panel-help files-help';
  summary.textContent = 'Share a folder to edit files together.';
  info.className = 'button ghost files-info-button';
  info.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';
  info.setAttribute('aria-label', 'About sharing files');
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', 'files-sharing-info');
  details.id = 'files-sharing-info';
  details.className = 'files-info-popover';
  details.popover = 'auto';
  details.setAttribute('role', 'note');
  details.setAttribute('aria-labelledby', 'files-info-heading');
  detailsHeading.id = 'files-info-heading';
  detailsHeading.textContent = 'Sharing files';

  for (const text of [
    'Files load when opened.',
    'Tabs are personal; edits are shared.',
    'Only the host can save to the original files.',
    'Loaded content stays in room storage and checkpoints.',
  ]) {
    const item = document.createElement('li');

    item.textContent = text;
    detailsList.append(item);
  }

  details.append(detailsHeading, detailsList);
  help.append(summary, info);

  const hideInfo = () => details.hidePopover();

  info.onclick = () => {
    if (details.matches(':popover-open')) {
      hideInfo();
      return;
    }

    details.showPopover();

    const anchor = info.getBoundingClientRect();
    const popup = details.getBoundingClientRect();

    details.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - popup.width - 8))}px`;
    details.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - popup.height - 8))}px`;
  };
  details.addEventListener('toggle', () => {
    info.setAttribute(
      'aria-expanded',
      String(details.matches(':popover-open')),
    );
  });
  panel.addEventListener('panel-closed', hideInfo);
  window.addEventListener('resize', hideInfo);

  const status = document.createElement('p');

  status.id = 'files-status';
  status.setAttribute('role', 'status');

  const diskNotice = document.createElement('section');

  diskNotice.className = 'disk-change-notice';
  diskNotice.hidden = true;
  diskNotice.setAttribute('aria-label', 'Files changed on disk');

  const diskCheckStatus = document.createElement('p');

  diskCheckStatus.className = 'panel-help';
  diskCheckStatus.setAttribute('role', 'status');
  diskCheckStatus.hidden = true;

  let revealedFile = '';
  const tree = document.createElement('nav');

  tree.id = 'file-tree';
  tree.setAttribute('aria-label', 'Room files');

  const filter = document.createElement('input');
  const treeTools = document.createElement('div');
  const searchScope = document.createElement('p');

  searchScope.className = 'file-search-scope';
  searchScope.textContent = 'Code search includes loaded files only.';
  const count = document.createElement('span');
  const collapse = button('Collapse folders', null, () => {
    tree.querySelectorAll('details').forEach((folder) => {
      folder.open = false;
    });
    expanded.clear();
  });

  filter.type = 'search';
  filter.placeholder = 'Search files, paths, or code…';
  filter.setAttribute('aria-label', 'Search filenames, paths, and loaded code');
  filter.className = 'file-filter';
  filter.oninput = () => render();
  treeTools.className = 'file-tree-tools';
  count.setAttribute('role', 'status');
  collapse.className = 'button ghost';
  treeTools.append(count, collapse);

  async function connectProject(expectedProjectId?: string) {
    if (!alive || denied || loading || saving || !provider.synced) return;

    loading = true;
    render();

    try {
      const manifest = await window.api.openProject(
        expectedProjectId,
        preferenceKey,
      );

      if (!manifest) return;

      if (
        !alive ||
        denied ||
        !provider.synced ||
        (expectedProjectId &&
          !workspaceFiles(doc).some(
            (file) => file.projectId === expectedProjectId,
          ))
      ) {
        await window.api.closeProject(manifest.id);

        return;
      }

      await hosting.add(manifest);

      if (!alive || denied) return;

      await window.api.rememberProject(preferenceKey, manifest.id);
      rememberedProjects.add(manifest.id);
      status.textContent = `${manifest.name}: ${manifest.files.length} file names shared; ${manifest.skippedCount} files/folders excluded.${manifest.truncated ? ' Partial list: scan limit reached.' : ''} Contents load on demand.`;

      const pending = workspaceFiles(doc).find(
        (file) =>
          file.id === pendingOfflineFile && file.projectId === manifest.id,
      );

      if (pending) await open(pending.id);
    } catch (error) {
      if (alive) status.textContent = errorMessage(error);
    } finally {
      loading = false;
      render();
    }
  }

  const pick = button('Share project…', 'open-project', () => connectProject());
  const stop = button('Stop hosting', 'stop-hosting', async () => {
    if (loading) return;

    closeConflict();

    try {
      await window.api.forgetProject(preferenceKey);
      rememberedProjects.clear();
      await hosting.stop();

      if (alive)
        status.textContent =
          'Hosting stopped and automatic reconnection disabled for this room. Loaded buffers and history remain shared.';
    } catch (error) {
      await hosting.stop();

      if (alive)
        status.textContent = `Hosting stopped, but saved access could not be cleared: ${errorMessage(error)}`;
    }
  });
  const save = button('Save to project', 'save-project-file', async () => {
    const file = workspaceFiles(doc).find((item) => item.id === currentId);

    if (
      denied ||
      editor.isReviewing() ||
      saving ||
      !file?.text ||
      !hosting.local.has(file.projectId || '')
    )
      return;

    const content = file.text.toString();
    let conflictDetected = false;

    saving = true;
    render();

    try {
      await hosting.save(file, content);

      if (alive)
        status.textContent =
          file.text.toString() === content
            ? `Saved ${file.path} to the original project file.`
            : `Saved ${file.path}, but newer shared edits are still unsaved.`;
    } catch (error) {
      if (alive) status.textContent = errorMessage(error);
      conflictDetected = errorMessage(error).includes(
        'changed outside ByteBridge',
      );
    } finally {
      saving = false;
      render();
      if (
        alive &&
        conflictDetected &&
        currentId === file.id &&
        APP_CONFIG.navigation.conflictRecovery
      )
        conflict.click();
    }
  });
  const copy = button('Save copy…', 'save-workspace-file', async () => {
    const file = workspaceFiles(doc).find((item) => item.id === currentId);

    if (!file?.text || editor.isReviewing()) return;

    copy.disabled = true;

    try {
      const result = await window.api.saveWorkspaceFile(
        file.id === LEGACY_FILE ? 'shared-code.txt' : file.path,
        file.text.toString(),
      );

      if (alive)
        status.textContent = result.canceled
          ? 'Save canceled.'
          : 'File snapshot saved. Future edits will not update this copy.';
    } catch (error) {
      if (alive) status.textContent = errorMessage(error);
    } finally {
      if (alive) copy.disabled = false;
    }
  });

  function reviewDisk(id: string) {
    const file = workspaceFiles(doc).find((item) => item.id === id);
    if (
      !file?.text ||
      !alive ||
      denied ||
      saving ||
      !hosting.local.has(file.projectId || '')
    )
      return;
    closeConflict();
    closeConflict = showDiskConflict(
      file,
      {
        allowed: () =>
          alive &&
          !denied &&
          !saving &&
          hosting.local.has(file.projectId || ''),
        inspect: () => window.api.inspectProjectFile(file.projectId!, file.id),
        accept: (token, disk, reload, expected) =>
          hosting.acceptDisk(file, token, disk, reload, expected),
        report: (message) => {
          status.textContent = message;
        },
      },
      editor,
    );
  }

  const conflict = button('Review disk changes…', 'review-disk-changes', () =>
    reviewDisk(currentId),
  );
  const actions = document.createElement('div');

  const projectActions = document.createElement('div');
  const fileActions = document.createElement('div');
  const fileButtons = document.createElement('div');

  actions.className = 'files-actions';
  projectActions.className = 'files-project-actions';
  projectActions.setAttribute('role', 'group');
  projectActions.setAttribute('aria-label', 'Project sharing');
  fileActions.className = 'files-current-actions';
  fileActions.setAttribute('role', 'group');
  fileActions.setAttribute('aria-label', 'Current file actions');
  fileButtons.className = 'files-action-buttons';
  pick.title = 'Choose a local folder to share with this room';
  stop.title =
    'Stop hosting all your projects in this room and disable automatic reconnection';
  save.title = 'Write the current shared file to its original location on disk';
  copy.title =
    'Save a separate copy of the current file to a location you choose';
  copy.textContent = 'Save copy…';
  conflict.hidden = true;
  setButtonVariant(save, 'primary');
  setButtonVariant(stop, 'danger');
  setButtonVariant(copy, 'secondary');
  projectActions.append(pick, stop);
  fileButtons.append(save, copy);
  fileActions.append(fileButtons);
  actions.append(projectActions, fileActions);
  panel.replaceChildren(
    close,
    heading,
    help,
    details,
    actions,
    status,
    diskNotice,
    diskCheckStatus,
    filter,
    searchScope,
    treeTools,
    tree,
    conflict,
  );

  const hosting = createHosting(doc, provider, config, window.api, render);

  terminal = initializeTerminalPanel({
    projects: () =>
      [...hosting.local.values()].map(({ id, name }) => ({ id, name })),
    blocked: (projectId) => {
      if (!alive || denied || !provider.synced)
        return 'Connect to the room with edit access to open a terminal.';
      if (!hosting.local.has(projectId))
        return 'Share a local project to open a terminal.';
      if (loading || saving)
        return 'Wait for the current file operation to finish.';
      if (hosting.diskCheckError) return hosting.diskCheckError;
      const files = workspaceFiles(doc).filter(
        (file) => file.projectId === projectId && file.text,
      );

      if (files.some((file) => hosting.diskChanges.has(file.id)))
        return 'Review disk changes before opening a terminal.';
      if (files.some((file) => hosting.isDirty(file)))
        return 'Save your shared edits to the project before opening a terminal.';
      return '';
    },
    checkDisk: () => hosting.checkDisk(),
  });

  async function open(id: string) {
    const token = ++selection;
    let file = workspaceFiles(doc).find((item) => item.id === id);

    if (!file || denied) return;

    pendingOfflineFile = null;

    if (!file.text && file.projectId && !hosting.online(file.projectId)) {
      pendingOfflineFile = file.id;
      status.textContent =
        'This folder is offline. Use the reconnect or locate action beside the project if you shared it. Otherwise, ask its host to reopen the room.';

      return;
    }

    try {
      if (!file.text) {
        status.textContent = `Loading ${file.path} from its host…`;
        await hosting.load(file);

        if (!alive || denied || token !== selection) return;

        file = workspaceFiles(doc).find((item) => item.id === id);
        status.textContent = `Loaded ${file?.path || 'file'}. Shared edits do not automatically write to disk.`;
      }

      if (!file?.text) return;

      if (!opened.includes(id)) opened.push(id);

      currentId = id;
      editor.openFile(file);
      persist();
      render();
    } catch (error) {
      if (alive && token === selection)
        status.textContent = errorMessage(error);
    }
  }

  function render() {
    if (!alive) return;

    terminal?.refresh();

    const files = workspaceFiles(doc);

    if (restored && provider.synced) {
      const projects = new Set(
        files.flatMap((file) => (file.projectId ? [file.projectId] : [])),
      );

      for (const id of knownProjects) {
        if (!projects.has(id)) {
          rememberedProjects.delete(id);
          void window.api.forgetProject(preferenceKey, id).catch((error) => {
            if (alive) status.textContent = errorMessage(error);
          });
        }
      }

      knownProjects = projects;
    }

    const current = files.find((file) => file.id === currentId);
    for (let i = opened.length - 1; i >= 0; i--) {
      const id = opened[i]!;
      if (!files.some((file) => file.id === id) && id !== currentId) {
        opened.splice(i, 1);
        editor.closeFile(id);
      }
    }

    if (!current) {
      void open(LEGACY_FILE);

      return;
    }

    const states = provider.wsconnected
      ? [...provider.awareness.getStates()]
      : [];

    pick.disabled = denied || loading || !provider.synced;
    stop.hidden = !hosting.local.size && !rememberedProjects.size;
    stop.disabled = loading;
    save.hidden = !hosting.local.has(current.projectId || '');
    save.disabled = denied || saving || !current.text || editor.isReviewing();
    copy.disabled = editor.isReviewing();
    conflict.hidden = true;
    conflict.disabled = denied || saving || !current.text;

    diskCheckStatus.hidden = !hosting.diskCheckError;
    diskCheckStatus.textContent = hosting.diskCheckError;

    const diskFiles = files.filter((file) => hosting.diskChanges.has(file.id));
    toggle.textContent = diskFiles.length
      ? `Files · ${diskFiles.length} changed`
      : 'Files';

    const diskSignature = JSON.stringify([
      denied,
      saving,
      diskFiles.map((file) => [
        file.id,
        file.path,
        hosting.diskChanges.get(file.id),
      ]),
    ]);

    if (diskSignature !== renderedDiskChanges) {
      renderedDiskChanges = diskSignature;
      diskNotice.hidden = !diskFiles.length;
      diskNotice.replaceChildren();

      const message = document.createElement('p');

      message.setAttribute('role', 'status');
      message.textContent = diskFiles.some(
        (file) => hosting.diskChanges.get(file.id) === 'changed',
      )
        ? 'Files changed on disk. Review before updating the shared session.'
        : 'Some shared files are missing from disk. Their shared content is kept.';
      diskNotice.append(message);

      for (const file of diskFiles) {
        const row = document.createElement('div');
        const name = document.createElement('span');
        const review = button('Review…', null, () => reviewDisk(file.id));
        const unavailable = hosting.diskChanges.get(file.id) === 'unavailable';

        row.className = 'disk-change-file';
        name.textContent = `${file.projectName}/${file.path}${unavailable ? ' · unavailable on disk' : ''}`;
        review.setAttribute(
          'aria-label',
          `Review disk changes for ${file.path}`,
        );
        review.disabled = denied || saving || unavailable;
        row.append(name, review);
        diskNotice.append(row);
      }

      if (
        diskFiles.some(
          (file) => hosting.diskChanges.get(file.id) === 'unavailable',
        )
      ) {
        const help = document.createElement('small');

        help.textContent =
          'Unavailable files may have been removed or moved. Their shared content is kept. Restore access to review them.';
        diskNotice.append(help);
      }
    }

    const query = filter.value.trim().toLowerCase();
    const codeMatches = new Map<string, { line: number; preview: string }>();

    if (query) {
      for (const file of files) {
        if (!file.text) continue;

        const code = file.text.toString();
        const index = code.toLowerCase().indexOf(query);

        if (index < 0) continue;

        const lineStart = code.lastIndexOf('\n', index - 1) + 1;
        const lineEnd = code.indexOf('\n', index);
        const start = Math.max(lineStart, index - 50);

        codeMatches.set(file.id, {
          line: code.slice(0, index).split('\n').length,
          preview: `${start > lineStart ? '…' : ''}${code.slice(start, Math.min(lineEnd < 0 ? code.length : lineEnd, start + 180)).trim()}`,
        });
      }
    }

    searchScope.hidden = !query;

    const signature = JSON.stringify({
      codeMatches: [...codeMatches],
      filter: filter.value,
      currentId,
      reviewing: editor.isReviewing(),
      dirty: !!hosting.isDirty(current),
      opened,
      denied,
      synced: provider.synced,
      loading,
      saving,
      files: files.map(({ id, path, mode, projectId, projectName, text }) => ({
        id,
        path,
        mode,
        projectId,
        projectName,
        loaded: !!text,
        online: hosting.online(projectId),
      })),
      presence: states.map(([id, state]) => [
        id,
        state.user?.name,
        state.fileId,
        state.editing,
      ]),
    });

    if (signature === renderedState) return;

    renderedState = signature;
    if (!editor.isReviewing())
      title.textContent = `${current.path} · ${current.mode === 'reference' ? 'Reference — read-only' : hosting.isDirty(current) ? 'Unsaved to project' : 'Shared buffer'}`;
    if (!editor.isReviewing()) title.title = current.path;
    tabs.replaceChildren();

    for (const id of opened) {
      const file = files.find((item) => item.id === id);

      if (!file) continue;

      const tab = document.createElement('div');

      tab.className = 'file-tab';

      const activate = button(file.path, null, () => open(id));

      activate.dataset.fileId = id;
      activate.setAttribute(
        'aria-pressed',
        String(id === currentId && !editor.isReviewing()),
      );

      const closeTab = button('×', null, () => {
        const index = opened.indexOf(id);

        opened.splice(index, 1);

        if (currentId === id)
          void open(opened[Math.max(0, index - 1)] || LEGACY_FILE);

        // Shared code remains the fallback tab, so never dispose its active model.
        if (currentId !== id) editor.closeFile(id);

        persist();
        render();
      });

      closeTab.setAttribute('aria-label', `Close tab ${file.path}`);
      tab.append(activate, closeTab);
      tabs.append(tab);
    }

    if (!tree.dataset.filtered)
      tree.querySelectorAll('details').forEach((el) => {
        if (el.open) expanded.add(el.dataset.path);
        else expanded.delete(el.dataset.path);
      });
    tree.replaceChildren();
    tree.dataset.filtered = filter.value.trim() ? 'true' : '';

    const folders = new Map<string, HTMLElement>([['', tree]]);

    const visibleFiles = files
      .filter(
        (file) =>
          `${file.projectName || ''}/${file.path}`
            .toLowerCase()
            .includes(query) || codeMatches.has(file.id),
      )
      .sort((a, b) => {
        const projectOrder = (a.projectName || '').localeCompare(
          b.projectName || '',
          undefined,
          { numeric: true },
        );
        if (projectOrder) return projectOrder;

        const left = a.path.split('/');
        const right = b.path.split('/');
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
          const leftFolder = i < left.length - 1;
          const rightFolder = i < right.length - 1;
          if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
          const order = left[i]!.localeCompare(right[i]!, undefined, {
            numeric: true,
          });
          if (order) return order;
        }
        return left.length - right.length;
      });

    count.textContent = query
      ? `${visibleFiles.length} of ${files.length} files`
      : `${files.length} files`;
    collapse.disabled = !!query;

    if (!visibleFiles.length) {
      const empty = document.createElement('p');
      empty.className = 'panel-help';
      empty.textContent = 'No matches in filenames, paths, or loaded code.';
      tree.append(empty);
    }

    for (const file of visibleFiles) {
      const parts = file.path.split('/');
      let parent = '',
        container: HTMLElement = tree;
      const segments = file.projectId
        ? [
            {
              key: file.projectId,
              label: `${file.projectName} · ${hosting.local.has(file.projectId || '') ? 'hosting' : hosting.online(file.projectId) ? 'host online' : 'host offline'}`,
            },
            ...parts.slice(0, -1).map((label) => ({ key: label, label })),
          ]
        : parts.slice(0, -1).map((label) => ({ key: label, label }));

      for (const { key, label: name } of segments) {
        const folderPath = parent ? `${parent}/${key}` : key;

        if (!folders.has(folderPath)) {
          const folder = document.createElement('details');

          folder.dataset.path = folderPath;
          folder.open =
            !!query ||
            expanded.has(folderPath) ||
            (key === file.projectId && !knownFolders.has(folderPath));
          knownFolders.add(folderPath);

          const label = document.createElement('summary');

          const folderName = document.createElement('span');
          folderName.textContent = name;
          folderName.className = 'folder-name';
          label.title = name;
          label.classList.add('folder-heading');
          label.append(folderName);
          if (key === file.projectId) {
            label.classList.add('project-heading');

            if (!hosting.online(file.projectId)) {
              const reconnect = button(
                rememberedProjects.has(file.projectId!)
                  ? 'Locate folder…'
                  : 'Reconnect folder…',
                null,
                () => {},
              );

              reconnect.classList.add('reconnect-project');
              reconnect.setAttribute(
                'aria-label',
                `Reconnect ${file.projectName} folder`,
              );
              reconnect.title =
                'Select the folder using the profile that shared it';
              reconnect.disabled =
                denied || !provider.synced || loading || saving;
              reconnect.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                void connectProject(file.projectId);
              };
              label.append(reconnect);
            }

            const remove = button('×', null, () => {});
            remove.className = 'remove-project';
            remove.setAttribute(
              'aria-label',
              `Remove ${file.projectName} from room`,
            );
            remove.title = 'Remove project from room';
            remove.disabled = denied || !provider.synced || saving;
            remove.onclick = (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (denied || !provider.synced || saving) return;
              if (
                !window.confirm(
                  `Remove “${file.projectName}” from this room for everyone? Shared buffers, including unsaved edits, will be removed. Original disk files and saved checkpoints are kept. Export or save any edits you need first.`,
                )
              )
                return;
              closeConflict();
              removeProject(doc, file.projectId!);
              persist();
              status.textContent =
                'Project removed from the room. Disk files and checkpoints are unchanged.';
            };
            label.append(remove);
          }
          folder.append(label);
          container.append(folder);
          folders.set(folderPath, folder);
        }

        container = folders.get(folderPath)!;
        parent = folderPath;
      }

      const row = document.createElement('div');

      row.className = 'workspace-file';
      row.dataset.fileId = file.id;
      row.dataset.path = file.path;
      row.dataset.loaded = String(!!file.text);

      const select = button(parts.at(-1) || file.path, null, () =>
        open(file.id),
      );

      select.setAttribute('aria-pressed', String(file.id === currentId));
      select.title = `${file.path}${!file.text ? ' · Opens on demand' : ''}`;
      select.classList.add('file-select');

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = parts.at(-1) || file.path;
      select.replaceChildren(name);

      if (file.mode === 'reference' || !file.text) {
        const badge = document.createElement('span');
        badge.className = 'file-state';
        badge.textContent =
          file.mode === 'reference' ? 'Read-only' : 'On demand';
        select.append(badge);
      }

      const presence = document.createElement('small');

      presence.className = 'file-presence';
      presence.textContent = states
        .filter(
          ([id, state]) =>
            id !== provider.awareness.clientID &&
            (state.fileId || LEGACY_FILE) === file.id &&
            state.fileId !== null,
        )
        .map(
          ([, state]) =>
            `${String(state.user?.name || 'Teammate').slice(0, 60)} ${state.editing ? 'editing' : 'viewing'}`,
        )
        .join(', ');
      row.append(select);

      const match = codeMatches.get(file.id);

      if (match) {
        const preview = document.createElement('small');

        preview.className = 'file-code-match';
        preview.textContent = `Line ${match.line}: ${match.preview}`;
        preview.title = preview.textContent;
        row.append(preview);
      }

      row.append(presence);
      container.append(row);

      if (!query && file.id === currentId && revealedFile !== currentId) {
        let ancestor = row.parentElement;

        while (ancestor && ancestor !== tree) {
          if (ancestor instanceof HTMLDetailsElement) {
            ancestor.open = true;
            expanded.add(ancestor.dataset.path);
          }
          ancestor = ancestor.parentElement;
        }
      }
    }

    revealedFile = currentId;
  }

  toggle.onclick = () => {
    if (togglePanel(panel.id)) close.focus();
  };
  panel.onkeydown = (event) => {
    if (event.key !== 'Escape') return;

    if (details.matches(':popover-open')) {
      event.preventDefault();
      hideInfo();
      info.focus();
    } else close.click();
  };
  async function restoreHosting() {
    loading = true;
    render();

    try {
      const ids = [
        ...new Set(
          workspaceFiles(doc).flatMap((file) =>
            file.projectId ? [file.projectId] : [],
          ),
        ),
      ];
      const result = await window.api.restoreProjects(preferenceKey, ids);

      for (const id of result.failed) rememberedProjects.add(id);

      for (const manifest of result.manifests) {
        if (
          !alive ||
          denied ||
          !provider.synced ||
          !workspaceFiles(doc).some((file) => file.projectId === manifest.id)
        ) {
          await window.api.closeProject(manifest.id);
          continue;
        }

        try {
          await hosting.add(manifest);
          rememberedProjects.add(manifest.id);
        } catch {
          rememberedProjects.add(manifest.id);
          result.failed.push(manifest.id);
        }
      }

      if (!alive || denied) return;

      if (result.failed.length)
        status.textContent =
          'Some folders could not reconnect. Use Locate folder… beside the project to select its current location.';
      else if (result.manifests.length)
        status.textContent = 'Shared folders reconnected.';

      const pending = workspaceFiles(doc).find(
        (file) =>
          file.id === pendingOfflineFile &&
          hosting.local.has(file.projectId || ''),
      );

      if (pending) await open(pending.id);
    } catch (error) {
      if (alive)
        status.textContent = `Folders could not reconnect: ${errorMessage(error)}`;
    } finally {
      loading = false;
      render();
    }
  }

  const restore = () => {
    if (restored || !provider.synced || denied) return;

    restored = true;
    const files = workspaceFiles(doc);
    const restoredIds = [...new Set(remembered.opened)].filter((id) =>
      files.some((file) => file.id === id),
    );
    if (restoredIds.length) opened.splice(0, opened.length, ...restoredIds);
    if (
      remembered.active &&
      files.some((file) => file.id === remembered.active && file.text)
    )
      void open(remembered.active);
    else {
      if (files.some((file) => file.id === remembered.active))
        pendingOfflineFile = remembered.active;

      render();
      persist();
    }

    void restoreHosting();
  };
  const checkDisk = () => {
    if (!alive || denied || loading || saving || document.hidden) return;

    void hosting.checkDisk();
  };
  const diskTimer = window.setInterval(checkDisk, 5000);

  window.addEventListener('focus', checkDisk);
  document.addEventListener('visibilitychange', checkDisk);
  element('editor-panel').addEventListener('review-change', render);
  provider.on('sync', restore);
  provider.on('sync', render);
  restore();
  provider.on('status', render);
  render();

  const dispose = () => {
    persist();
    window.clearInterval(diskTimer);
    window.removeEventListener('focus', checkDisk);
    document.removeEventListener('visibilitychange', checkDisk);
    element('editor-panel').removeEventListener('review-change', render);
    closeConflict();
    hideInfo();
    panel.removeEventListener('panel-closed', hideInfo);
    window.removeEventListener('resize', hideInfo);
    alive = false;
    provider.off('sync', restore);
    terminal?.dispose();
    hosting.dispose();
    provider.off('sync', render);
    provider.off('status', render);
    panel.replaceChildren();
    tabs.replaceChildren();
    panel.hidden = toggle.hidden = tabs.hidden = true;
    toggle.onclick = panel.onkeydown = null;
    title.textContent = 'Shared code';
    toggle.textContent = 'Files';
  };

  dispose.open = open;
  dispose.canReviewDisk = () =>
    APP_CONFIG.navigation.conflictRecovery &&
    !denied &&
    !saving &&
    !editor.isReviewing() &&
    !!workspaceFiles(doc).find(
      (file) =>
        file.id === currentId &&
        file.text &&
        hosting.local.has(file.projectId || ''),
    );
  dispose.setReadOnly = (value: boolean) => {
    denied = value;

    if (value) {
      closeConflict();
      void hosting.stop();
    }

    render();
  };

  return dispose;
}
