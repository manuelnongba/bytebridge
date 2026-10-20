export interface TerminalStart {
  id: string;
  projectId: string;
  cols: number;
  rows: number;
}

export type TerminalEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number };
