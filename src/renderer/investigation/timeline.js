import { APP_CONFIG } from '../app-config.js';
import { closePanel, togglePanel } from '../ui/panels.js';
import {
  createEvent,
  validateAppend,
  eventSummary,
  catchUp,
} from './events.js';
import { showCheckpointDiff } from './checkpoint-diff.js';

export function initializeTimeline(ydoc, provider, name, getLanguage) {
  const config = APP_CONFIG.timeline;
  const panel = document.getElementById('investigation-panel');
  const toggle = document.getElementById('open-timeline');
  toggle.hidden = !config.enabled;
  panel.hidden = true;
  if (!config.enabled) return Object.assign(() => {}, { setReadOnly() {} });
  const events = ydoc.getArray('investigation-events');
  const context = ydoc.getMap('debug-context');
  let denied = false,
    draft = null,
    disposeDiff = null;
  const button = (text, id, handler) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'button secondary';
    el.textContent = text;
    if (id) el.id = id;
    if (handler) el.onclick = handler;
    return el;
  };
  const heading = document.createElement('h2');
  heading.textContent = 'Investigation timeline';
  const close = button('×', 'close-timeline', () => {
    closePanel(panel.id);
    clearDiff();
    toggle.focus();
  });
  close.className = 'close-control';
  close.setAttribute('aria-label', 'Close investigation timeline');
  const catchup = document.createElement('pre');
  catchup.id = 'timeline-catchup';
  const summary = document.createElement('details');
  const guide = document.createElement('p');
  guide.className = 'panel-help';
  guide.textContent =
    'Start with a suspected cause, record what you will try, then add its outcome. Checkpoints save shared code for comparison.';
  const summaryLabel = document.createElement('summary');
  summaryLabel.textContent = 'Catch up on this investigation';
  summary.append(summaryLabel, catchup);
  const list = document.createElement('ol');
  list.id = 'timeline-events';
  const form = document.createElement('form');
  form.id = 'timeline-form';
  form.hidden = true;
  const controls = new Map();
  const control = (key, label, options) => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement(options ? 'select' : 'textarea');
    input.id = `timeline-${key}`;
    if (options)
      for (const value of options) input.append(new Option(value, value));
    wrapper.append(input);
    form.append(wrapper);
    controls.set(key, input);
    return input;
  };
  const type = control('type', 'Entry type', config.eventTypes);
  for (const field of config.fields) {
    const input = control(field.key, field.label);
    input.maxLength = field.maxLength;
    input.required = !!field.required;
    input.rows = field.key === 'title' ? 1 : 3;
  }
  const parent = control(
    'parent',
    'Link to an earlier event (required for outcomes)',
    [],
  );
  const outcome = control(
    'outcome',
    'Participant-reported outcome',
    config.outcomes,
  );
  const warning = document.createElement('p');
  warning.textContent =
    'Review before sharing. Entries are retained as history. Remove secrets from notes, output, and code. Results are participant-reported; ByteBridge does not run or verify tests.';
  const preview = document.createElement('pre');
  preview.id = 'timeline-preview';
  preview.hidden = true;
  const status = document.createElement('p');
  status.id = 'timeline-status';
  status.setAttribute('role', 'status');
  const review = button('Review entry', 'review-timeline');
  review.type = 'submit';
  const publish = button('Share reviewed entry', 'share-timeline');
  publish.hidden = true;
  const invalidate = () => {
    draft = null;
    publish.hidden = preview.hidden = true;
  };
  const cancel = button('Discard draft', 'discard-timeline', () => {
    form.hidden = true;
    add.hidden = false;
    invalidate();
    status.textContent = '';
  });
  form.append(warning, preview, review, publish, cancel);
  const add = button('Add investigation entry', 'add-timeline', () => {
    form.reset();
    invalidate();
    updateFields();
    form.hidden = false;
    add.hidden = true;
    controls.get('title').focus();
  });
  const compare = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Compare historical checkpoints (read-only)';
  const before = document.createElement('select');
  before.id = 'checkpoint-before';
  before.setAttribute('aria-label', 'Earlier checkpoint');
  const after = document.createElement('select');
  after.id = 'checkpoint-after';
  after.setAttribute('aria-label', 'Later checkpoint');
  const diff = document.createElement('div');
  diff.id = 'checkpoint-diff';
  diff.hidden = true;
  const clearDiff = () => {
    disposeDiff?.();
    disposeDiff = null;
    diff.hidden = true;
  };
  const compareButton = button('Compare', 'compare-checkpoints', () => {
    clearDiff();
    const checkpoints = events
      .toArray()
      .filter((event) => event.type === 'checkpoint');
    const a = checkpoints.find((event) => event.id === before.value),
      b = checkpoints.find((event) => event.id === after.value);
    if (!a || !b || a.id === b.id) {
      status.textContent = 'Choose two different checkpoints.';
      return;
    }
    diff.hidden = false;
    disposeDiff = showCheckpointDiff(diff, a, b);
    status.textContent = `${a.title} → ${b.title}. Historical comparison only; live code is unchanged.`;
  });
  before.onchange = after.onchange = clearDiff;
  compare.append(legend, before, after, compareButton, diff);
  panel.replaceChildren(
    close,
    heading,
    guide,
    summary,
    add,
    form,
    status,
    list,
    compare,
  );
  const updateFields = () => {
    outcome.parentElement.hidden = type.value !== 'outcome';
    const output = controls.get('output');
    output.parentElement.hidden = !['experiment', 'outcome'].includes(
      type.value,
    );
    output.disabled = output.parentElement.hidden || denied;
    const selected = parent.value;
    parent.replaceChildren(new Option('No linked event', ''));
    for (const event of events.toArray()) {
      if (
        type.value === 'outcome' &&
        !['experiment', 'hypothesis'].includes(event.type)
      )
        continue;
      parent.append(new Option(`${event.type}: ${event.title}`, event.id));
    }
    if ([...parent.options].some((option) => option.value === selected))
      parent.value = selected;
  };
  type.onchange = () => {
    invalidate();
    updateFields();
  };
  form.oninput = invalidate;
  form.onchange = invalidate;
  form.onsubmit = (event) => {
    event.preventDefault();
    invalidate();
    if (denied || !provider.synced) return;
    try {
      draft = createEvent(
        {
          type: type.value,
          ...Object.fromEntries(
            config.fields.map((field) => [
              field.key,
              controls.get(field.key).value,
            ]),
          ),
          output: controls.get('output').disabled
            ? ''
            : controls.get('output').value,
          parentId: parent.value,
          outcome: outcome.value,
        },
        events.toArray(),
        config,
        {
          author: name,
          code: ydoc.getText('monaco').toString(),
          language: getLanguage(),
          issue: context.get('problem'),
        },
      );
      preview.textContent = eventSummary(draft);
      preview.hidden = publish.hidden = false;
      status.textContent = 'Review this exact entry before sharing.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  publish.onclick = () => {
    if (!draft || denied || !provider.synced) return;
    try {
      if (
        draft.type === 'checkpoint' &&
        draft.code !== ydoc.getText('monaco').toString()
      )
        throw new Error(
          'Live code changed after review. Review again to capture the latest code.',
        );
      validateAppend(events.toArray(), draft, config);
      events.push([draft]);
      invalidate();
      form.hidden = true;
      add.hidden = false;
      status.textContent =
        'Entry shared. Keep the app connected to synchronize it.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const render = () => {
    const all = events.toArray();
    list.replaceChildren();
    for (const event of all) {
      const item = document.createElement('li');
      item.dataset.eventId = event.id;
      const detail = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = `${event.type}: ${event.title} — ${event.author} · ${new Date(event.createdAt).toLocaleString()}`;
      const content = document.createElement('pre');
      content.textContent = eventSummary(event);
      detail.append(title, content);
      item.append(detail);
      list.append(item);
    }
    if (!all.length) list.textContent = 'No investigation entries yet.';
    catchup.textContent = catchUp(
      all,
      context.get('problem'),
      Array.isArray(context.get('attemptEntries'))
        ? context.get('attemptEntries')
        : [],
    );
    const checkpoints = all.filter((event) => event.type === 'checkpoint');
    for (const select of [before, after]) {
      const value = select.value;
      select.replaceChildren();
      for (const event of checkpoints)
        select.append(new Option(event.title, event.id));
      if (checkpoints.some((event) => event.id === value)) select.value = value;
      if (
        select === after &&
        checkpoints.length &&
        (!checkpoints.some((event) => event.id === value) ||
          value === before.value)
      )
        select.value = checkpoints.at(-1).id;
    }
    compareButton.disabled = checkpoints.length < 2;
    add.disabled =
      review.disabled =
      publish.disabled =
        denied || !provider.synced;
    updateFields();
  };
  toggle.onclick = () => {
    if (togglePanel(panel.id)) close.focus();
  };
  panel.addEventListener('panel-closed', clearDiff);
  panel.onkeydown = (event) => {
    if (event.key === 'Escape') close.click();
  };
  events.observe(render);
  context.observe(render);
  provider.on('sync', render);
  render();
  const dispose = () => {
    events.unobserve(render);
    context.unobserve(render);
    provider.off('sync', render);
    panel.removeEventListener('panel-closed', clearDiff);
    clearDiff();
    panel.replaceChildren();
    panel.hidden = toggle.hidden = true;
    toggle.onclick = panel.onkeydown = null;
  };
  dispose.setReadOnly = (value) => {
    denied = value;
    for (const control of controls.values()) control.disabled = value;
    render();
  };
  return dispose;
}
