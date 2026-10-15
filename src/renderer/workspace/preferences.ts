export function workspaceKey(server: string, room: string) {
  return `bytebridge-workspace:${JSON.stringify([server, room])}`;
}
export function readWorkspace(key: string): {
  opened: string[];
  active: string;
} {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return {
      opened: Array.isArray(value?.opened)
        ? value.opened
            .filter((id: unknown) => typeof id === 'string')
            .slice(0, 2000)
        : [],
      active: typeof value?.active === 'string' ? value.active : '',
    };
  } catch {
    return { opened: [], active: '' };
  }
}
export function saveWorkspace(key: string, opened: string[], active: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ opened, active }));
  } catch {
    /* Preferences must not block editing. */
  }
}
