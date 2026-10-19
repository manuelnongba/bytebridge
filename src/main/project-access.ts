import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Local approvals only. Folder paths never enter room data or renderer storage. */
export function projectAccess(directory: string) {
  const location = path.join(directory, 'project-access.json');
  const entries = new Map<string, Map<string, string>>();

  if (existsSync(location)) {
    const data: unknown = JSON.parse(readFileSync(location, 'utf8'));

    if (!Array.isArray(data)) throw new Error('Invalid saved project access.');

    for (const entry of data) {
      if (!Array.isArray(entry) || entry.length !== 3) continue;

      const [scope, id, root] = entry;

      if (
        typeof scope !== 'string' ||
        typeof id !== 'string' ||
        typeof root !== 'string' ||
        !path.isAbsolute(root)
      )
        continue;

      const projects = entries.get(scope) || new Map<string, string>();

      projects.set(id, root);
      entries.set(scope, projects);
    }
  }

  function save() {
    const data = [...entries].flatMap(([scope, projects]) =>
      [...projects].map(([id, root]) => [scope, id, root]),
    );

    writeFileSync(`${location}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${location}.tmp`, location);
  }

  return {
    get(scope: string, id: string) {
      return entries.get(scope)?.get(id);
    },
    remember(scope: string, id: string, root: string) {
      const projects = entries.get(scope) || new Map<string, string>();

      projects.set(id, root);
      entries.set(scope, projects);
      save();
    },
    forget(scope: string, id?: string) {
      const projects = entries.get(scope);

      if (!projects) return;

      if (id) projects.delete(id);
      else projects.clear();

      if (!projects.size) entries.delete(scope);

      save();
    },
    retain(scope: string, ids: string[]) {
      const projects = entries.get(scope);

      if (!projects) return;

      for (const id of projects.keys()) {
        if (!ids.includes(id)) projects.delete(id);
      }

      if (!projects.size) entries.delete(scope);

      save();
    },
  };
}
