import * as Y from 'yjs';
import type {
  WorkspaceFile,
  WorkspaceConfig,
  ProjectManifest,
  FileSnapshot,
  InvestigationEvent,
} from '../../shared/contracts.js';
import { detectLanguage } from '../debugging/languages.js';

export const LEGACY_FILE = '@shared';

export function workspaceFiles(doc: Y.Doc): WorkspaceFile[] {
  const files: WorkspaceFile[] = [
    {
      id: LEGACY_FILE,
      path: 'Shared code',
      language: 'javascript',
      mode: 'collaborative',
      text: doc.getText('monaco'),
    },
  ];

  doc.getMap('workspace-files').forEach((file, id) => {
    if (!(file instanceof Y.Map)) return;

    const text = file.get('content');
    const projectId = file.get('projectId');

    if (!(text instanceof Y.Text) && typeof projectId !== 'string') return;

    const path = file.get('path');

    if (!validPath(path)) return;

    files.push({
      id,
      path,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      projectName: String(file.get('projectName') || ''),
      loaded: text instanceof Y.Text,
      mode:
        file.get('mode') === 'collaborative' ? 'collaborative' : 'reference',
      language: detectLanguage(path),
      text: text instanceof Y.Text ? text : null,
    });
  });

  return files.sort((a, b) =>
    a.id === LEGACY_FILE
      ? -1
      : b.id === LEGACY_FILE
        ? 1
        : a.path.localeCompare(b.path) || a.id.localeCompare(b.id),
  );
}

export function validPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\:\x00-\x1f\x7f]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

export function shareProject(
  doc: Y.Doc,
  manifest: ProjectManifest,
  config: WorkspaceConfig,
) {
  const map = doc.getMap('workspace-files');

  if (!manifest.files.length)
    throw new Error('No eligible files in this scope.');

  if (map.size + manifest.files.length > config.maxFiles)
    throw new Error(
      `Room file limit is ${config.maxFiles}. Choose a smaller subfolder.`,
    );

  const ids = new Set();

  for (const entry of manifest.files) {
    if (
      !validPath(entry.path) ||
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      map.has(entry.id)
    )
      throw new Error('Invalid or duplicate project file.');

    ids.add(entry.id);
  }

  doc.transact(() => {
    for (const entry of manifest.files) {
      const file = new Y.Map();

      file.set('path', entry.path);
      file.set('mode', 'collaborative');
      file.set('projectId', manifest.id);
      file.set('projectName', manifest.name);
      map.set(entry.id, file);
    }
  });
}

export function loadProjectFile(
  doc: Y.Doc,
  projectId: string,
  entry: { id: string; path: string },
  content: string,
  config: WorkspaceConfig,
) {
  const file = doc.getMap('workspace-files').get(entry.id);

  if (
    !(file instanceof Y.Map) ||
    file.get('projectId') !== projectId ||
    file.get('path') !== entry.path
  )
    throw new Error('Project scope changed. Reopen the project.');

  if (file.get('content') instanceof Y.Text) return;

  const bytes = (text: string) => new TextEncoder().encode(text).length;

  if (typeof content !== 'string' || bytes(content) > config.maxFileBytes)
    throw new Error('File exceeds the loading limit.');

  const total = workspaceFiles(doc).reduce(
    (sum, item) => sum + bytes(item.text?.toString() || ''),
    0,
  );

  if (total + bytes(content) > config.maxTotalBytes)
    throw new Error(
      'Loaded files exceed the room budget. Start a narrower project in a new room.',
    );

  file.set('content', new Y.Text(content));
}

export function snapshotWorkspace(
  doc: Y.Doc,
  legacyLanguage = 'javascript',
): FileSnapshot[] {
  return workspaceFiles(doc)
    .filter((file) => file.text)
    .map((file) => ({
      id: file.id,
      path: file.path,
      mode: file.mode,
      language: file.id === LEGACY_FILE ? legacyLanguage : file.language,
      code: file.text!.toString(),
    }));
}

export function checkpointFiles(
  event: Pick<InvestigationEvent, 'files' | 'code' | 'language'>,
): FileSnapshot[] {
  return Array.isArray(event.files)
    ? event.files
    : [
        {
          id: LEGACY_FILE,
          path: 'Shared code',
          language: event.language || 'plaintext',
          mode: 'collaborative',
          code: event.code || '',
        },
      ];
}
