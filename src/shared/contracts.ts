import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

export interface ProjectFile {
  id: string;
  path: string;
  size: number;
}

export interface ProjectManifest {
  id: string;
  name: string;
  files: ProjectFile[];
  skipped: { path: string; reason: string }[];
  skippedCount: number;
  truncated: boolean;
}

export interface NativeAPI {
  ready(): Promise<string | null>;
  openProject(
    expectedProjectId?: string,
    scope?: string,
  ): Promise<ProjectManifest | null>;
  rememberProject(scope: string, projectId: string): Promise<void>;
  forgetProject(scope: string, projectId?: string): Promise<void>;
  restoreProjects(
    scope: string,
    projectIds: string[],
  ): Promise<{
    manifests: ProjectManifest[];
    failed: string[];
  }>;
  readProjectFile(
    projectId: string,
    fileId: string,
  ): Promise<{ content: string }>;
  inspectProjectFile(
    projectId: string,
    fileId: string,
  ): Promise<{ content: string; token: string }>;
  acceptProjectFile(
    projectId: string,
    fileId: string,
    token: string,
  ): Promise<{ content: string }>;
  saveProjectFile(
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<{ saved: boolean }>;
  closeProject(projectId: string): Promise<void>;
  saveWorkspaceFile(
    name: string,
    content: string,
  ): Promise<{ canceled: boolean }>;
  saveMarkdown(content: string): Promise<{ canceled: boolean }>;
  copyToClipboard(text: string): Promise<boolean>;
  onCreateRoom(callback: () => void): void;
  onDeepLink(callback: (url: string) => void): void;
}

export interface WorkspaceFile {
  id: string;
  path: string;
  language: string;
  mode: 'reference' | 'collaborative';
  text: Y.Text | null;
  projectId?: string | undefined;
  projectName?: string;
  loaded?: boolean;
}

export interface FileSnapshot {
  id: string;
  path: string;
  language: string;
  mode: string;
  code: string;
}

export interface WorkspaceConfig {
  enabled: boolean;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  loadTimeoutMs: number;
}

export interface InvestigationEvent {
  id: string;
  type: string;
  title: string;
  notes: string;
  output: string;
  author: string;
  createdAt: number;
  parentId?: string | null;
  issue?: string;
  outcome?: string;
  code?: string;
  language?: string;
  files?: FileSnapshot[];
}

export interface ResolutionRecord {
  id: string;
  type: 'resolution' | 'reopen';
  author: string;
  createdAt: number;
  cause?: string;
  fix?: string;
  evidence?: string;
  uncertainty?: string;
  tags: string[];
  evidenceIds: string[];
  beforeId?: string | null;
  afterId?: string | null;
  reason?: string;
  resolutionId?: string;
  simple?: boolean;
}

export interface SearchIndex {
  errorText: string;
  tags: string[];
  resolved: boolean;
  updatedAt: number;
}

export interface Room {
  id: string;
  server: string;
  token: string;
  role: 'owner' | 'editor';
  title?: string;
  archived?: boolean;
  search?: SearchIndex;
}

export type RoomProvider = WebsocketProvider;

export type Dispose = (() => void) & { setReadOnly(value: boolean): void };

export interface ReviewTab {
  id: string;
  label: string;
  render(container: HTMLElement, close: () => void): () => void;
}

export interface WorkspaceEditor {
  openReview(tab: ReviewTab): () => void;
  isReviewing(): boolean;
  openFile(file: WorkspaceFile): void;
  closeFile(id: string): void;
}

export type ContextKey =
  'problem' | 'expected' | 'actual' | 'steps' | 'issue' | 'logs' | 'attempts';

export type CollectionKey = 'attachments' | 'attemptEntries';

export type ContextEntry = Record<string, string>;

export type ContextSnapshot = Record<ContextKey, string> &
  Record<CollectionKey, ContextEntry[]>;

export interface Field {
  key: string;
  label: string;
  maxLength?: number;
  required?: boolean;
  options?: string[];
  displayLabel?: boolean;
  multiline?: boolean;
  optional?: boolean;
}

export interface CollectionSchema {
  key: CollectionKey;
  label: string;
  addLabel: string;
  maxItems: number;
  fileImport?: boolean;
  fields: Field[];
}

export interface Language {
  id: string;
  extensions?: string[];
  filenames?: string[];
  prefixes?: string[];
}

export interface DebugConfig {
  enabled: boolean;
  overviewBeforeEditor: boolean;
  primaryFields: ContextKey[];
  maxFieldLength: number;
  maxContextBytes: number;
  maxFileBytes: number;
  languages: Language[];
  fields: { key: ContextKey; label: string; collapsed?: boolean }[];
  collections: CollectionSchema[];
}

export interface TimelineConfig {
  enabled: boolean;
  eventTypes: string[];
  outcomes: string[];
  maxEvents: number;
  maxSnapshotLength: number;
  maxWorkspaceSnapshotBytes: number;
  maxBytes: number;
  fields: (Field & { maxLength: number })[];
}

export interface ResolutionConfig {
  enabled: boolean;
  maxEntries: number;
  maxBytes: number;
  maxTags: number;
  fields: (Field & { maxLength: number })[];
}
