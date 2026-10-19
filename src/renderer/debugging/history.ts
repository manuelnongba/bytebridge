import { initializeDropdown } from '../ui/dropdown.js';
import type * as Y from 'yjs';
import type {
  FileSnapshot,
  InvestigationEvent,
  ResolutionRecord,
  RoomProvider,
  SearchIndex,
} from '../../shared/contracts.js';
import { APP_CONFIG } from '../app-config.js';
import { createEvent, eventSummary } from '../investigation/events.js';
import {
  resolutionState,
  resolutionText,
  validateResolutionAppend,
  fenced,
} from '../resolution/data.js';
import { checkpointFiles } from '../workspace/data.js';
import { button, element, errorMessage, setButtonVariant } from '../ui/dom.js';

/** Keeps the existing Yjs collections and record IDs; no history migration/deletion. */
export function initializeHistory(
  doc: Y.Doc,
  provider: RoomProvider,
  panel: HTMLElement,
  name: string,
  getFiles: () => FileSnapshot[],
  updateIndex: (value: SearchIndex) => void,
  inspect: {
    open(checkpoint: InvestigationEvent, file: FileSnapshot): void;
    compare(before: InvestigationEvent, after: InvestigationEvent): void;
  },
) {
  if (!APP_CONFIG.debugging.enabled)
    return Object.assign(() => {}, { setReadOnly(_value: boolean) {} });

  const events = doc.getArray<InvestigationEvent>('investigation-events');
  const records = doc.getArray<ResolutionRecord>('resolution-events');
  const context = doc.getMap('debug-context');
  const root = document.createElement('section');

  root.className = 'problem-tools';

  const status = document.createElement('p');

  status.id = 'problem-history-status';
  status.setAttribute('role', 'status');

  const badge = element('resolution-badge');

  badge.hidden = false;

  let denied = false,
    alive = true,
    baseId: string | null = null;
  const checkpoint = button('Save checkpoint', 'save-checkpoint', () => {
    if (denied || !provider.synced) return;

    try {
      const files = getFiles();

      events.push([
        createEvent(
          {
            type: 'checkpoint',
            title: `Checkpoint ${events.toArray().filter((item) => item.type === 'checkpoint').length + 1}`,
            notes: '',
            output: '',
            parentId: '',
          },
          events.toArray(),
          APP_CONFIG.timeline,
          {
            author: name,
            code: doc.getText('monaco').toString(),
            language: files[0]?.language || 'javascript',
            issue: String(context.get('problem') || ''),
            files,
          },
        ),
      ]);
      status.textContent = `Checkpoint saved: ${files.length} loaded buffers. Unopened project files are not captured.`;
    } catch (error) {
      status.textContent = errorMessage(error);
    }
  });
  const solveForm = document.createElement('form');

  solveForm.hidden = true;

  const label = document.createElement('label');

  label.textContent = 'What fixed it? (optional)';

  const note = document.createElement('textarea');

  note.id = 'solved-note';
  note.rows = 3;
  note.maxLength = 6000;
  label.append(note);

  const warning = document.createElement('p');

  warning.className = 'panel-help';
  warning.textContent =
    'This note is shared with the room. Remove sensitive details before saving. Solved is a participant-reported status.';

  const confirm = button('Mark solved', 'confirm-solved');

  setButtonVariant(confirm, 'primary');

  confirm.type = 'submit';

  const cancel = button('Cancel', 'cancel-solved', () => {
    solveForm.hidden = true;
    note.value = '';
  });

  solveForm.append(label, warning, confirm, cancel);

  setButtonVariant(cancel, 'ghost');

  const solve = button('Mark solved', 'mark-solved', () => {
    baseId = records.toArray().at(-1)?.id || null;
    solveForm.hidden = false;
    note.focus();
  });

  solveForm.onsubmit = (event) => {
    event.preventDefault();

    if (denied || !provider.synced) return;

    try {
      if ((records.toArray().at(-1)?.id || null) !== baseId)
        throw new Error(
          'Status changed while this note was open. Cancel and try again; your draft has not been shared.',
        );

      if (note.value.length > 6000)
        throw new Error('The fix note is too long.');

      const record: ResolutionRecord = {
        id: crypto.randomUUID(),
        type: 'resolution',
        author: name,
        createdAt: Date.now(),
        simple: true,
        cause: '',
        fix: note.value.trim(),
        evidence: '',
        uncertainty: '',
        tags: [],
        evidenceIds: [],
        beforeId: null,
        afterId: null,
      };

      validateResolutionAppend(
        records.toArray(),
        record,
        APP_CONFIG.resolutions,
      );
      records.push([record]);
      solveForm.hidden = true;
      note.value = '';
      status.textContent =
        'Marked solved. You can keep editing or reopen the problem.';
    } catch (error) {
      status.textContent = errorMessage(error);
    }
  };

  const reopen = button('Reopen problem', 'reopen-problem', () => {
    if (
      denied ||
      !provider.synced ||
      !resolutionState(records.toArray()).resolved
    )
      return;

    try {
      const record: ResolutionRecord = {
        id: crypto.randomUUID(),
        type: 'reopen',
        author: name,
        createdAt: Date.now(),
        reason: '',
        tags: [],
        evidenceIds: [],
      };

      validateResolutionAppend(
        records.toArray(),
        record,
        APP_CONFIG.resolutions,
      );
      records.push([record]);
      status.textContent =
        'Problem reopened. Previous notes and checkpoints remain in history.';
    } catch (error) {
      status.textContent = errorMessage(error);
    }
  });
  const actions = document.createElement('div');

  actions.className = 'workspace-actions';
  actions.append(solve, reopen);

  const solvedNote = document.createElement('p');

  solvedNote.id = 'problem-fix';

  const history = document.createElement('details');

  history.id = 'problem-history';

  const summary = document.createElement('summary');

  summary.textContent = 'History & checkpoints';

  const historyList = document.createElement('div');

  historyList.id = 'problem-history-list';

  const before = document.createElement('select'),
    after = document.createElement('select');

  before.id = 'checkpoint-before';
  after.id = 'checkpoint-after';
  before.setAttribute('aria-label', 'Earlier checkpoint');
  after.setAttribute('aria-label', 'Later checkpoint');

  const compare = button('Compare checkpoints', 'compare-checkpoints', () => {
    const all = events.toArray();
    const a = all.find((entry) => entry.id === before.value),
      b = all.find((entry) => entry.id === after.value);

    if (!a || !b || a.id === b.id) {
      status.textContent = 'Choose two different checkpoints.';

      return;
    }

    inspect.compare(structuredClone(a), structuredClone(b));
    status.textContent =
      'Comparison opened in the editor. Both checkpoints are read-only.';
  });
  const exportButton = button(
    'Export Markdown…',
    'export-history',
    async () => {
      exportButton.disabled = true;
      const content = [
        '# ByteBridge problem history',
        'Participant-reported information; loaded buffers only.',
        '## Problem & optional details',
        fenced(JSON.stringify(context.toJSON(), null, 2)),
        ...events.toArray().map((entry) => fenced(eventSummary(entry))),
        ...records
          .toArray()
          .map((record) => fenced(resolutionText(record, events.toArray()))),
      ].join('\n\n');
      try {
        const result = await window.api.saveMarkdown(content);
        if (alive)
          status.textContent = result.canceled
            ? 'Export canceled.'
            : 'Markdown saved.';
      } catch (error) {
        if (alive) status.textContent = errorMessage(error);
      } finally {
        if (alive) exportButton.disabled = false;
      }
    },
  );
  const historyActions = document.createElement('div');
  historyActions.className = 'workspace-actions';
  historyActions.append(checkpoint, exportButton);
  const comparisons = document.createElement('details');
  comparisons.className = 'checkpoint-comparison-options';
  const comparisonLabel = document.createElement('summary');
  comparisonLabel.textContent = 'Compare checkpoints';
  comparisons.append(comparisonLabel, before, after, compare);
  history.append(summary, historyActions, historyList, comparisons);
  root.append(actions, solveForm, solvedNote, status, history);
  panel.append(root);

  const checkpointPickers = [before, after].map((select) =>
    initializeDropdown(select),
  );

  function render() {
    const state = resolutionState(records.toArray());

    badge.textContent = state.resolved ? 'Solved · reported' : 'Open';
    badge.dataset.state = state.resolved ? 'resolved' : 'open';
    checkpoint.hidden = !APP_CONFIG.timeline.enabled;
    solve.hidden = state.resolved || !APP_CONFIG.resolutions.enabled;
    reopen.hidden = !state.resolved || !APP_CONFIG.resolutions.enabled;
    solvedNote.textContent = state.resolved
      ? state.resolution?.fix || 'Marked solved without a fix note.'
      : '';

    for (const control of [checkpoint, solve, reopen, confirm])
      control.disabled = denied || !provider.synced;

    note.disabled = denied;

    const all = events.toArray();
    const checkpoints = all.filter((entry) => entry.type === 'checkpoint');

    for (const [select, fallback] of [
      [before, checkpoints.at(-2)?.id],
      [after, checkpoints.at(-1)?.id],
    ] as const) {
      const previous = select.value;

      select.replaceChildren(new Option('Choose checkpoint', ''));

      for (const entry of checkpoints)
        select.append(new Option(entry.title, entry.id));

      select.value = checkpoints.some((entry) => entry.id === previous)
        ? previous
        : fallback || '';
    }

    if (checkpoints.length >= 2 && before.value === after.value)
      after.value = checkpoints.at(-1)!.id;

    for (const picker of checkpointPickers) picker.refresh();

    compare.disabled = checkpoints.length < 2;
    historyList.replaceChildren();

    for (const entry of [
      ...all.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        title: entry.title,
        text: eventSummary(entry),
      })),
      ...records.toArray().map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        title:
          record.type === 'reopen' ? 'Problem reopened' : 'Fix / resolution',
        text: resolutionText(record, all),
      })),
    ].sort((a, b) => a.createdAt - b.createdAt)) {
      const detail = document.createElement('details');

      detail.dataset.recordId = entry.id;

      const heading = document.createElement('summary');

      heading.textContent = `${entry.title} · ${new Date(entry.createdAt).toLocaleString()}`;

      const text = document.createElement('pre');

      text.textContent = entry.text;
      detail.append(heading);
      const checkpoint = all.find(
        (item) => item.id === entry.id && item.type === 'checkpoint',
      );
      if (checkpoint) {
        const note = document.createElement('p');
        note.className = 'checkpoint-note';
        note.textContent = [checkpoint.author, checkpoint.notes]
          .filter(Boolean)
          .join(' · ');
        if (note.textContent) detail.append(note);
        const files = document.createElement('div');
        files.className = 'checkpoint-files';
        for (const file of checkpointFiles(checkpoint)) {
          const open = button(file.path, '', () =>
            inspect.open(structuredClone(checkpoint), structuredClone(file)),
          );
          open.dataset.checkpointFile = file.id;
          open.title = `Open ${file.path} from ${checkpoint.title} (read-only)`;
          files.append(open);
        }
        detail.append(files);
      } else detail.append(text);
      historyList.append(detail);
    }

    if (provider.synced)
      updateIndex({
        errorText: [
          context.get('problem'),
          context.get('actual'),
          context.get('logs'),
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 6000),
        tags: state.resolution?.tags || [],
        resolved: state.resolved,
        updatedAt: Date.now(),
      });
  }

  records.observe(render);
  events.observe(render);
  context.observe(render);
  provider.on('sync', render);
  render();

  const dispose = () => {
    alive = false;

    for (const picker of checkpointPickers) picker.dispose();
    records.unobserve(render);
    events.unobserve(render);
    context.unobserve(render);
    provider.off('sync', render);
    root.remove();
    badge.hidden = true;
  };

  dispose.setReadOnly = (value: boolean) => {
    denied = value;
    render();
  };

  return dispose;
}
