interface PresenceState {
  user?: { name?: string; color?: string };
  cursor?: { line: number; column: number };
  editing?: boolean;
  fileId?: string | null;
}

type AwarenessState = Array<[number, PresenceState]>;

interface Window {
  api: import('../shared/contracts.js').NativeAPI;
  MonacoEnvironment: { getWorkerUrl(id: string, label: string): string };
}
