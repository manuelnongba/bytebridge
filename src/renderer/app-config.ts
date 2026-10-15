// Public defaults bundled with the app. Never put credentials here.
// Saved server choices override defaultServer; invitations carry their own server.
import { ATTACHMENT_LANGUAGES } from './debugging/languages.js';
import type {
  DebugConfig,
  TimelineConfig,
  ResolutionConfig,
  WorkspaceConfig,
} from '../shared/contracts.js';

export const APP_CONFIG = {
  navigation: {
    enabled: true,
    quickOpen: true,
    selectionAttachments: true,
    conflictRecovery: true,
    restoreWorkspace: true,
    resultLimit: 40,
    // Use Mod for Command on macOS and Control elsewhere. Empty disables a binding.
    shortcuts: {
      commands: 'Mod+Shift+p',
      files: 'Mod+p',
      attach: 'Mod+Shift+a',
      save: 'Mod+s',
    },
    hiddenCommands: [] as string[],
  },
  appearance: {
    density: 'comfortable' as 'comfortable' | 'compact',
    fontSize: 13,
    editorFontSize: 14,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    colors: {
      background: '#111617',
      surface: '#192123',
      input: '#11191b',
      text: '#dce4e4',
      muted: '#aebcbd',
      accent: '#b5e8cb',
      border: '#465455',
      hover: '#283334',
      focus: '#b5e8cb',
    },
  },
  defaultServer: 'http://localhost:1234',
  requestTimeoutMs: 8000,
  accessCheckIntervalMs: 15000,
  workspace: {
    enabled: true,
    maxFiles: 2000,
    maxFileBytes: 256 * 1024,
    maxTotalBytes: 2 * 1024 * 1024,
    loadTimeoutMs: 15000,
  } as WorkspaceConfig,
  panels: {
    resizable: true,
    defaultWidth: 430,
    defaultHeightRatio: 0.45,
    minWidth: 260,
    minEditorWidth: 300,
    minHeight: 140,
    minEditorHeight: 140,
    keyboardStep: 20,
  },
  roomManagement: {
    renameEnabled: true,
    archiveEnabled: true,
    forgetEnabled: true,
    deleteEnabled: true,
    // UI limit; the server independently enforces 100 characters.
    titleMaxLength: 100,
  },
  presence: {
    typingEnabled: true,
    typingIdleMs: 2000,
    cursorLabelsEnabled: true,
  },
  timeline: {
    enabled: true,
    eventTypes: ['hypothesis', 'experiment', 'checkpoint', 'outcome'],
    outcomes: ['pending', 'failed', 'successful', 'inconclusive'],
    maxEvents: 150,
    maxSnapshotLength: 32000,
    maxWorkspaceSnapshotBytes: 160 * 1024,
    maxBytes: 512 * 1024,
    fields: [
      { key: 'title', label: 'Title', maxLength: 160, required: true },
      { key: 'notes', label: 'Reasoning / notes', maxLength: 4000 },
      {
        key: 'output',
        label: 'Manually supplied test output or logs',
        maxLength: 12000,
      },
    ],
  } as TimelineConfig,
  resolutions: {
    enabled: true,
    maxEntries: 60,
    maxBytes: 256 * 1024,
    maxTags: 10,
    fields: [
      { key: 'cause', label: 'Root cause', maxLength: 4000, required: true },
      { key: 'fix', label: 'What fixed it?', maxLength: 6000, required: true },
      {
        key: 'evidence',
        label: 'Why do you believe this worked?',
        maxLength: 4000,
      },
      {
        key: 'uncertainty',
        label: 'Remaining uncertainty / follow-up',
        maxLength: 4000,
      },
      { key: 'tags', label: 'Tags (comma-separated)', maxLength: 300 },
    ],
  } as ResolutionConfig,
  debugging: {
    languages: ATTACHMENT_LANGUAGES,
    enabled: true,
    overviewBeforeEditor: false,
    primaryFields: ['problem', 'expected'],
    maxFieldLength: 12000,
    maxContextBytes: 512 * 1024,
    maxFileBytes: 64 * 1024,
    collections: [
      {
        key: 'attachments',
        label: 'Selected files and snippets',
        addLabel: 'Add snippet',
        maxItems: 8,
        fileImport: true,
        fields: [
          { key: 'filename', label: 'Filename', maxLength: 320 },
          {
            key: 'language',
            label: 'Language',
            options: ATTACHMENT_LANGUAGES.map((language) => language.id),
          },
          {
            key: 'lines',
            label: 'Original line range (optional)',
            maxLength: 60,
            optional: true,
          },
          {
            key: 'content',
            label: 'Content',
            displayLabel: false,
            multiline: true,
            maxLength: 32000,
          },
        ],
      },
      {
        key: 'attemptEntries',
        label: 'Previous attempts',
        addLabel: 'Add attempt',
        maxItems: 20,
        fields: [
          {
            key: 'action',
            label: 'What did you try?',
            multiline: true,
            maxLength: 2000,
          },
          {
            key: 'outcome',
            label: 'Outcome',
            options: [
              'no-change',
              'failed',
              'partially-helped',
              'worked',
              'inconclusive',
            ],
          },
          {
            key: 'notes',
            label: 'What happened?',
            multiline: true,
            maxLength: 4000,
          },
        ],
      },
    ],
    fields: [
      { key: 'problem', label: 'What’s wrong?' },
      { key: 'expected', label: 'What should happen?' },
      { key: 'actual', label: 'Actual behavior' },
      { key: 'steps', label: 'Reproduction steps' },
      { key: 'issue', label: 'Issue URL (optional)' },
      { key: 'logs', label: 'Logs and error output', collapsed: true },
      {
        key: 'attempts',
        label: 'Previous attempt notes (legacy / additional context)',
        collapsed: true,
      },
    ],
  } as DebugConfig,
  invitations: {
    defaultHours: 24,
    // The server independently enforces a maximum of 168 hours.
    durations: [
      { hours: 1, label: '1 hour' },
      { hours: 24, label: '24 hours' },
      { hours: 168, label: '7 days' },
    ],
  },
};
