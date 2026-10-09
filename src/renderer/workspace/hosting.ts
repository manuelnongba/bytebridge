import { workspaceFiles, shareProject, loadProjectFile } from './data.js';
import type {
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

    if (file(fileId)?.text) return;

    const result = await api.readProjectFile(projectId, fileId);

    if (!alive || !local.has(projectId))
      throw new Error('Project hosting stopped.');

    saved.set(fileId, result.content);
    loadProjectFile(doc, projectId, entry, result.content, config);
  };

  function changedFiles() {
    for (const [id, request] of pending) {
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

      await api.saveProjectFile(entry.projectId!, entry.id, content);
      saved.set(entry.id, content);
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
      awareness.setLocalStateField('hostedProjects', []);
      awareness.setLocalStateField('workspaceRequest', null);
      awareness.setLocalStateField('workspaceResponse', null);
    },
  };
}
