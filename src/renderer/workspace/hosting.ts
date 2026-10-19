import { APP_CONFIG } from '../app-config.js';
import { createEvent } from '../investigation/events.js';
import { workspaceFiles, shareProject, loadProjectFile } from './data.js';
import type {
  InvestigationEvent,
  NativeAPI,
  ProjectManifest,
  WorkspaceConfig,
  WorkspaceFile,
  RoomProvider,
} from '../../shared/contracts.js';
import type * as Y from 'yjs';

// Native folder capabilities stay local. Awareness carries transient read requests,
// never filesystem paths or permission to write to disk.
export function createHosting(
  doc: Y.Doc,
  provider: RoomProvider,
  config: WorkspaceConfig,
  api: NativeAPI,
  changed: () => void,
) {
  const local = new Map<string, ProjectManifest>();
  const saved = new Map<string, string>();
  const needsReview = new Set<string>();
  const diskChanges = new Map<string, 'changed' | 'unavailable'>();
  let checking = false;
  let diskCheckError = '';
  const pending = new Map<
    string,
    { nonce: string; resolve(): void; reject(error: Error): void }
  >();
  const handled = new Map<number, string>();
  const queued = new Set<number>();
  let alive = true;
  let queue = Promise.resolve();
  const awareness = provider.awareness;

  const advertise = () =>
    awareness.setLocalStateField('hostedProjects', [...local.keys()]);

  const file = (id: string) =>
    workspaceFiles(doc).find((entry) => entry.id === id);

  const online = (projectId?: string) =>
    !!projectId &&
    (local.has(projectId) ||
      (provider.wsconnected &&
        [...awareness.getStates().values()].some(
          (state) =>
            Array.isArray(state.hostedProjects) &&
            state.hostedProjects.includes(projectId),
        )));

  const loadLocal = async (projectId: string, fileId: string) => {
    const manifest = local.get(projectId);
    const entry = manifest?.files.find((item) => item.id === fileId);

    if (!entry || !alive)
      throw new Error('The host is no longer sharing this file.');

    if (file(fileId)?.text && saved.has(fileId)) return;

    const result = await api.readProjectFile(projectId, fileId);

    if (!alive || !local.has(projectId))
      throw new Error('Project hosting stopped.');

    const existing = file(fileId)?.text;
    if (existing && existing.toString() !== result.content)
      needsReview.add(fileId);
    saved.set(fileId, result.content);
    loadProjectFile(doc, projectId, entry, result.content, config);
  };

  function changedFiles() {
    const remaining = new Set(
      workspaceFiles(doc).map((entry) => entry.projectId),
    );
    for (const id of local.keys())
      if (!remaining.has(id)) {
        local.delete(id);
        void api.closeProject(id).catch(() => {});
        advertise();
      }
    for (const id of diskChanges.keys())
      if (!local.has(file(id)?.projectId || '')) diskChanges.delete(id);

    for (const id of saved.keys())
      if (!file(id)) {
        saved.delete(id);
        needsReview.delete(id);
        diskChanges.delete(id);
      }
    for (const [id, request] of pending) {
      if (!file(id)) {
        request.reject(new Error('Project was removed from the room.'));
        pending.delete(id);
        continue;
      }
      if (file(id)?.text) {
        request.resolve();
        pending.delete(id);
      }
    }

    changed();
  }

  function activity() {
    if (!alive) return;

    for (const [client, state] of awareness.getStates()) {
      const response = state.workspaceResponse;

      if (response?.requester === awareness.clientID) {
        for (const [id, request] of pending) {
          if (request.nonce === response.nonce && response.error) {
            request.reject(new Error(String(response.error).slice(0, 400)));
            pending.delete(id);
          }
        }
      }

      const request = state.workspaceRequest;

      if (
        client === awareness.clientID ||
        !request ||
        typeof request.nonce !== 'string' ||
        !local.has(request.projectId)
      )
        continue;

      if (handled.get(client) === request.nonce) continue;

      // Coalesce rapid requests from one participant instead of an unbounded queue.
      if (queued.has(client)) continue;

      handled.set(client, request.nonce);
      queued.add(client);
      queue = queue.then(async () => {
        if (!alive) return;

        let error;

        try {
          await loadLocal(request.projectId, request.fileId);
        } catch (failure) {
          error =
            failure instanceof Error ? failure.message : 'File load failed.';
        }

        if (alive)
          awareness.setLocalStateField('workspaceResponse', {
            requester: client,
            nonce: request.nonce,
            error,
          });

        queued.delete(client);

        if (alive) activity();
      });
    }

    for (const client of handled.keys())
      if (!awareness.getStates().has(client)) handled.delete(client);

    changed();
  }

  doc.getMap('workspace-files').observeDeep(changedFiles);
  awareness.on('change', activity);

  return {
    local,
    online,
    diskChanges,
    get diskCheckError() {
      return diskCheckError;
    },
    async checkDisk() {
      if (!alive || checking) return;

      checking = true;

      let checkError = '';

      try {
        for (const entry of workspaceFiles(doc)) {
          if (!alive) break;
          if (!entry.text || !local.has(entry.projectId || '')) continue;

          const project = local.get(entry.projectId!);

          try {
            const state = await api.checkProjectFile(
              entry.projectId!,
              entry.id,
            );

            if (
              !alive ||
              local.get(entry.projectId!) !== project ||
              !file(entry.id)
            )
              continue;
            if (state === 'busy') continue;

            if (state === 'untracked') {
              // Share the existing load queue instead of racing file reads.
              const task = queue.then(() =>
                loadLocal(entry.projectId!, entry.id),
              );

              queue = task.catch(() => {});
              await task;
              diskChanges.delete(entry.id);
              continue;
            }

            if (state === 'error') {
              checkError =
                'Some files could not be checked. Shared content is unchanged; disk checks will retry automatically.';
              continue;
            }

            if (state === 'changed' || state === 'unavailable')
              diskChanges.set(entry.id, state);
            else if (needsReview.has(entry.id))
              diskChanges.set(entry.id, 'changed');
            else diskChanges.delete(entry.id);
          } catch (error) {
            if (
              alive &&
              local.get(entry.projectId!) === project &&
              file(entry.id)
            ) {
              const message = error instanceof Error ? error.message : '';

              if (message.includes('File operation already in progress'))
                continue;

              checkError =
                message.includes('No handler registered') ||
                message.includes('checkProjectFile is not a function')
                  ? 'Restart ByteBridge to enable disk-change detection. Shared content is unchanged.'
                  : 'Disk-change detection could not complete. Shared content is unchanged; checks will retry automatically.';
            }
          }
        }
      } finally {
        checking = false;

        if (alive) {
          diskCheckError = checkError;
          changed();
        }
      }
    },
    isDirty(entry: WorkspaceFile) {
      return (
        !!entry.projectId &&
        local.has(entry.projectId) &&
        entry.text &&
        saved.get(entry.id) !== entry.text.toString()
      );
    },
    async save(entry: WorkspaceFile, content: string) {
      const approved = local
        .get(entry.projectId || '')
        ?.files.find((item) => item.id === entry.id);

      if (!approved || approved.path !== entry.path)
        throw new Error('Project scope changed. Save blocked.');

      if (!saved.has(entry.id)) await loadLocal(entry.projectId!, entry.id);
      if (needsReview.has(entry.id))
        throw new Error(
          'Save blocked: file changed outside ByteBridge or the room has retained edits. Review disk changes before saving.',
        );
      await api.saveProjectFile(entry.projectId!, entry.id, content);
      saved.set(entry.id, content);
      diskChanges.delete(entry.id);
      changed();
    },
    async acceptDisk(
      entry: WorkspaceFile,
      token: string,
      disk: string,
      reload: boolean,
      expected: string,
    ) {
      if (
        !alive ||
        !local.has(entry.projectId || '') ||
        entry.text?.toString() !== expected
      )
        throw new Error(
          'Room content or hosting changed. Refresh the comparison.',
        );
      const result = await api.acceptProjectFile(
        entry.projectId!,
        entry.id,
        token,
      );
      if (!alive || !local.has(entry.projectId || ''))
        throw new Error('Hosting stopped.');

      if (reload) {
        if (entry.text?.toString() !== expected) {
          needsReview.add(entry.id);
          diskChanges.set(entry.id, 'changed');
          changed();
          throw new Error(
            'A teammate edited this file. Refresh before reloading.',
          );
        }
        if (result.content !== disk)
          throw new Error('Disk changed. Refresh before reloading.');

        if (expected !== disk) {
          const events = doc.getArray<InvestigationEvent>(
            'investigation-events',
          );
          let recovery: InvestigationEvent;

          try {
            recovery = createEvent(
              {
                type: 'checkpoint',
                title: `Before keeping disk: ${entry.path}`.slice(0, 160),
                notes:
                  'Automatic recovery checkpoint of this file before replacing its shared content with the reviewed disk version.',
                output: '',
                parentId: '',
              },
              events.toArray(),
              APP_CONFIG.timeline,
              {
                author: String(awareness.getLocalState()?.user?.name || 'Host'),
                code: '',
                language: entry.language,
                issue: String(doc.getMap('debug-context').get('problem') || ''),
                files: [
                  {
                    id: entry.id,
                    path: entry.path,
                    mode: entry.mode,
                    language: entry.language,
                    code: expected,
                  },
                ],
              },
            );
          } catch {
            needsReview.add(entry.id);
            diskChanges.set(entry.id, 'changed');
            changed();
            throw new Error(
              'Could not save a recovery checkpoint. Shared content was not replaced. Check the file size and history limits before retrying.',
            );
          }

          // No await between recording the reviewed snapshot and replacing it.
          doc.transact(() => {
            events.push([recovery]);
            entry.text!.delete(0, entry.text!.length);
            entry.text!.insert(0, disk);
          });
        }
      }

      saved.set(entry.id, result.content);
      needsReview.delete(entry.id);
      diskChanges.delete(entry.id);
      changed();
    },
    async add(manifest: ProjectManifest) {
      if (!alive) {
        await api.closeProject(manifest.id);

        return;
      }

      try {
        shareProject(doc, manifest, config);
      } catch (error) {
        await api.closeProject(manifest.id);

        throw error;
      }

      local.set(manifest.id, manifest);
      advertise();
    },
    async load(entry: WorkspaceFile) {
      if (entry.text) return;

      if (entry.projectId && local.has(entry.projectId)) {
        const task = queue.then(() => loadLocal(entry.projectId!, entry.id));

        queue = task.catch(() => {});

        return task;
      }

      if (!online(entry.projectId))
        throw new Error(
          'Host offline: this file has not been loaded. Ask the host to reconnect.',
        );

      if (pending.size) throw new Error('Wait for the current file to load.');

      const nonce = crypto.randomUUID();

      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(entry.id);
          reject(
            new Error(
              'File request timed out. Check the host connection and try again.',
            ),
          );
        }, config.loadTimeoutMs);

        pending.set(entry.id, {
          nonce,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        awareness.setLocalStateField('workspaceRequest', {
          projectId: entry.projectId,
          fileId: entry.id,
          nonce,
        });
      }).finally(() => awareness.setLocalStateField('workspaceRequest', null));
    },
    async stop() {
      const ids = [...local.keys()];

      local.clear();
      saved.clear();
      needsReview.clear();
      diskChanges.clear();
      diskCheckError = '';
      advertise();
      await Promise.all(ids.map((id) => api.closeProject(id).catch(() => {})));
      changed();
    },
    dispose() {
      alive = false;
      doc.getMap('workspace-files').unobserveDeep(changedFiles);
      awareness.off('change', activity);

      for (const request of pending.values())
        request.reject(new Error('Room closed.'));

      pending.clear();

      for (const id of local.keys()) void api.closeProject(id).catch(() => {});

      local.clear();
      saved.clear();
      needsReview.clear();
      diskChanges.clear();
      diskCheckError = '';
      awareness.setLocalStateField('hostedProjects', []);
      awareness.setLocalStateField('workspaceRequest', null);
      awareness.setLocalStateField('workspaceResponse', null);
    },
  };
}
