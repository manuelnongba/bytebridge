import { APP_CONFIG } from '../app-config.js';
import { closePanel, togglePanel } from '../ui/panels.js';
import {
  createResolution,
  validateResolutionAppend,
  resolutionState,
  resolutionText,
  exportResolution,
} from './data.js';
import { showCheckpointDiff } from '../investigation/checkpoint-diff.js';

export function initializeResolution(ydoc, provider, room, name, updateIndex) {
  const config = APP_CONFIG.resolutions;
  const panel = document.getElementById('resolution-panel'),
    toggle = document.getElementById('open-resolution'),
    badge = document.getElementById('resolution-badge');
  panel.hidden = true;
  toggle.hidden = badge.hidden = !config.enabled;
  if (!config.enabled) return Object.assign(() => {}, { setReadOnly() {} });
  const records = ydoc.getArray('resolution-events'),
    timeline = ydoc.getArray('investigation-events'),
    context = ydoc.getMap('debug-context');
  let denied = false,
    draft = null,
    baseId = null,
    disposeDiff = null;
  const button = (label, id, handler) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'button secondary';
    el.textContent = label;
    el.id = id;
    el.onclick = handler;
    return el;
  };
  const heading = document.createElement('h2');
  heading.textContent = 'Resolve and hand over';
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent =
    'Explain the cause and fix, link your evidence, then review and share. Resolved is a team-reported status, not an automatic verification.';
  const clearDiff = () => {
    disposeDiff?.();
    disposeDiff = null;
    diff.hidden = true;
  };
  const close = button('×', 'close-resolution', () => {
    closePanel(panel.id);
    toggle.focus();
  });
  close.className = 'close-control';
  close.setAttribute('aria-label', 'Close resolution');
  const current = document.createElement('pre');
  current.id = 'resolution-current';
  const status = document.createElement('p');
  status.id = 'resolution-status';
  status.setAttribute('role', 'status');
  const form = document.createElement('form');
  form.id = 'resolution-form';
  form.hidden = true;
  const inputs = new Map();
  for (const field of config.fields) {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('textarea');
    input.id = `resolution-${field.key}`;
    input.rows = field.key === 'tags' ? 1 : 3;
    input.required = !!field.required;
    input.maxLength = field.maxLength;
    inputs.set(field.key, input);
    label.append(input);
    form.append(label);
  }
  const select = (labelText, id, multiple = false) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const el = document.createElement('select');
    el.id = id;
    el.multiple = multiple;
    label.append(el);
    form.append(label);
    return el;
  };
  const evidence = select(
    'Output to attach (Cmd/Ctrl-click for multiple)',
    'resolution-evidence-ids',
    true,
  );
  const before = select('Before checkpoint (optional)', 'resolution-before'),
    after = select('After checkpoint (optional)', 'resolution-after');
  const preview = document.createElement('pre');
  preview.id = 'resolution-preview';
  preview.hidden = true;
  const invalidate = () => {
    draft = null;
    preview.hidden = share.hidden = true;
  };
  const review = button('Review resolution', 'review-resolution');
  review.type = 'submit';
  const share = button('Share and mark resolved', 'share-resolution');
  share.hidden = true;
  share.classList.add('primary');
  const cancel = button('Discard draft', 'discard-resolution', () => {
    form.hidden = true;
    current.hidden = false;
    edit.hidden = false;
    invalidate();
  });
  const warning = document.createElement('p');
  warning.textContent =
    'Remove secrets before sharing. This record is retained in room history. Existing editor access is unchanged when a room is marked resolved.';
  form.append(warning, preview, review, share, cancel);
  const edit = button('Write resolution', 'edit-resolution', () => {
    const state = resolutionState(records.toArray());
    baseId = state.latest?.id || null;
    for (const [key, input] of inputs)
      input.value =
        key === 'tags'
          ? state.resolution?.tags.join(', ') || ''
          : state.resolution?.[key] || '';
    for (const option of evidence.options)
      option.selected =
        state.resolution?.evidenceIds.includes(option.value) || false;
    before.value = state.resolution?.beforeId || '';
    after.value = state.resolution?.afterId || '';
    form.hidden = false;
    current.hidden = true;
    edit.hidden = true;
    invalidate();
    inputs.get('cause').focus();
  });
  form.oninput = form.onchange = invalidate;
  form.onsubmit = (event) => {
    event.preventDefault();
    invalidate();
    if (denied || !provider.synced) return;
    try {
      draft = createResolution(
        {
          ...Object.fromEntries(
            [...inputs].map(([key, input]) => [key, input.value]),
          ),
          evidenceIds: [...evidence.selectedOptions].map(
            (option) => option.value,
          ),
          beforeId: before.value,
          afterId: after.value,
        },
        timeline.toArray(),
        config,
        name,
      );
      validateResolutionAppend(records.toArray(), draft, config);
      preview.textContent = resolutionText(draft, timeline.toArray());
      preview.hidden = share.hidden = false;
      status.textContent = 'Review the resolution before publishing.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  share.onclick = () => {
    if (!draft || denied || !provider.synced) return;
    try {
      if ((resolutionState(records.toArray()).latest?.id || null) !== baseId)
        throw new Error(
          'The resolution changed while you were editing. Copy your draft, discard, and review the latest version.',
        );
      validateResolutionAppend(records.toArray(), draft, config);
      records.push([draft]);
      invalidate();
      form.hidden = true;
      current.hidden = false;
      edit.hidden = false;
      status.textContent =
        'Marked resolved by a participant. History and editor access are preserved.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const reopenForm = document.createElement('form');
  const reasonLabel = document.createElement('label');
  reasonLabel.textContent = 'Reason for reopening';
  const reason = document.createElement('textarea');
  reason.id = 'reopen-reason';
  reason.required = true;
  reason.maxLength = 2000;
  reason.rows = 2;
  reasonLabel.append(reason);
  const reopen = button('Reopen investigation', 'reopen-resolution');
  reopen.type = 'submit';
  reopenForm.append(reasonLabel, reopen);
  reopenForm.onsubmit = (event) => {
    event.preventDefault();
    if (
      denied ||
      !provider.synced ||
      !reason.value.trim() ||
      !resolutionState(records.toArray()).resolved
    )
      return;
    try {
      const record = {
        id: crypto.randomUUID(),
        type: 'reopen',
        author: name,
        createdAt: Date.now(),
        reason: reason.value.trim(),
        resolutionId: resolutionState(records.toArray()).resolution.id,
      };
      validateResolutionAppend(records.toArray(), record, config);
      records.push([record]);
      reason.value = '';
      status.textContent =
        'Reopened. Previous resolutions and checkpoints are preserved.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const diff = document.createElement('div');
  diff.id = 'resolution-diff';
  diff.hidden = true;
  const compare = button(
    'View linked code changes',
    'compare-resolution',
    () => {
      clearDiff();
      const r = resolutionState(records.toArray()).resolution;
      const events = timeline.toArray();
      const a = events.find((e) => e.id === r?.beforeId),
        b = events.find((e) => e.id === r?.afterId);
      if (!a || !b) {
        status.textContent = 'No linked checkpoint pair is available.';
        return;
      }
      diff.hidden = false;
      disposeDiff = showCheckpointDiff(diff, a, b);
    },
  );
  const exportArea = document.createElement('textarea');
  exportArea.id = 'resolution-markdown';
  exportArea.rows = 12;
  exportArea.hidden = true;
  exportArea.setAttribute(
    'aria-label',
    'Markdown export preview; edit to redact before saving',
  );
  const save = button('Save Markdown…', 'save-resolution', async () => {
    save.disabled = true;
    try {
      const result = await window.api.saveMarkdown(exportArea.value);
      status.textContent = result.canceled
        ? 'Export canceled.'
        : 'Markdown saved.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
  save.hidden = true;
  const exportButton = button(
    'Review Markdown export',
    'export-resolution',
    () => {
      try {
        exportArea.value = exportResolution({
          title: room.title || room.id,
          context: context.toJSON(),
          events: timeline.toArray(),
          records: records.toArray(),
        });
        exportArea.hidden = save.hidden = false;
        status.textContent =
          'Review or redact this export before saving. Export edits do not change shared room data.';
      } catch (error) {
        status.textContent = error.message;
      }
    },
  );
  const history = document.createElement('details');
  const historyTitle = document.createElement('summary');
  historyTitle.textContent = 'Resolution and reopening history';
  const historyText = document.createElement('pre');
  history.append(historyTitle, historyText);
  panel.replaceChildren(
    close,
    heading,
    help,
    edit,
    compare,
    exportButton,
    current,
    form,
    reopenForm,
    diff,
    exportArea,
    save,
    status,
    history,
  );
  const render = () => {
    const state = resolutionState(records.toArray());
    badge.textContent = state.resolved ? 'Resolved · reported' : 'Open';
    badge.dataset.state = state.resolved ? 'resolved' : 'open';
    current.textContent = state.resolution
      ? `${state.resolved ? '' : 'Reopened — earlier resolution retained\n\n'}${resolutionText(state.resolution, timeline.toArray())}`
      : 'No resolution yet. Record what you learned when the investigation is ready to hand over.';
    historyText.textContent = records
      .toArray()
      .map(
        (record) =>
          `${new Date(record.createdAt).toLocaleString()}\n${resolutionText(record, timeline.toArray())}`,
      )
      .join('\n\n');
    reopenForm.hidden = !state.resolved;
    compare.disabled = !state.resolution?.beforeId;
    exportButton.disabled = !state.resolution;
    for (const el of [edit, review, share, reopen])
      el.disabled = denied || !provider.synced;
    const events = timeline.toArray();
    for (const el of [before, after, evidence]) {
      const selected = [...el.selectedOptions].map((option) => option.value);
      el.replaceChildren();
      if (el !== evidence) el.append(new Option('Not linked', ''));
      for (const entry of events.filter((event) =>
        el === evidence ? !!event.output?.trim() : event.type === 'checkpoint',
      )) {
        const option = new Option(entry.title, entry.id);
        option.selected = selected.includes(entry.id);
        el.append(option);
      }
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
  };
  toggle.onclick = () => {
    if (togglePanel(panel.id)) close.focus();
  };
  panel.onkeydown = (event) => {
    if (event.key === 'Escape') close.click();
  };
  panel.addEventListener('panel-closed', clearDiff);
  records.observe(render);
  timeline.observe(render);
  context.observe(render);
  provider.on('sync', render);
  render();
  const dispose = () => {
    records.unobserve(render);
    timeline.unobserve(render);
    context.unobserve(render);
    provider.off('sync', render);
    panel.removeEventListener('panel-closed', clearDiff);
    clearDiff();
    panel.replaceChildren();
    panel.hidden = toggle.hidden = badge.hidden = true;
    toggle.onclick = panel.onkeydown = null;
  };
  dispose.setReadOnly = (value) => {
    denied = value;
    for (const el of form.querySelectorAll('input,textarea,select,button'))
      el.disabled = value;
    reason.disabled = value;
    render();
  };
  return dispose;
}
