import { APP_CONFIG } from '../app-config.js';
import { closePanel, togglePanel } from '../ui/panels.js';
import { collectionEditor } from './collection-editor.js';
import {
  readContext,
  validateContext,
  contextChanges,
  contextSummary,
  entrySummary,
} from './data.js';

// Only explicitly submitted values enter Yjs. Keystrokes in this form stay local.
export function initializeContext(ydoc, provider, title) {
  const config = APP_CONFIG.debugging;
  const panel = document.getElementById('debug-context');
  const toggle = document.getElementById('open-context');
  toggle.hidden = !config.enabled;
  panel.hidden = true;
  if (!config.enabled) return Object.assign(() => {}, { setReadOnly() {} });
  const shared = ydoc.getMap('debug-context');
  let readOnly = false;
  let base = {};
  let draft = null;
  panel.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = `${title} — debugging context`;
  const overview = document.createElement('div');
  overview.id = 'context-overview';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'button secondary';
  edit.textContent = 'Edit context';
  edit.id = 'edit-context';
  const form = document.createElement('form');
  form.hidden = true;
  const inputs = new Map();
  for (const field of config.fields) {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('textarea');
    input.id = `context-${field.key}`;
    input.rows = field.key === 'issue' ? 1 : 3;
    input.maxLength = config.maxFieldLength;
    label.append(input);
    form.append(label);
    inputs.set(field.key, input);
  }
  const warning = document.createElement('p');
  warning.textContent =
    'Drafts stay on this device until shared. Remove passwords, tokens, personal data, and private logs before sharing. Removing previously shared text cannot erase copies or server history.';
  const preview = document.createElement('pre');
  preview.id = 'context-preview';
  preview.hidden = true;
  const status = document.createElement('p');
  status.id = 'context-status';
  status.setAttribute('role', 'status');
  const invalidate = () => {
    draft = null;
    preview.hidden = publish.hidden = true;
  };
  const collections = new Map(
    config.collections.map((schema) => [
      schema.key,
      collectionEditor(schema, config, invalidate, (message) => {
        status.textContent = message;
      }),
    ]),
  );
  for (const collection of collections.values()) form.append(collection.root);
  const review = document.createElement('button');
  review.type = 'submit';
  review.className = 'button secondary';
  review.textContent = 'Review before sharing';
  review.id = 'review-context';
  const publish = document.createElement('button');
  publish.type = 'button';
  publish.className = 'button primary';
  publish.textContent = 'Share reviewed context';
  publish.id = 'share-context';
  publish.hidden = true;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button secondary';
  cancel.textContent = 'Discard draft';
  cancel.id = 'discard-context';
  cancel.onclick = () => {
    form.hidden = true;
    overview.hidden = false;
    edit.hidden = false;
    draft = null;
    status.textContent = '';
    for (const collection of collections.values()) collection.dispose();
  };
  form.append(warning, preview, review, publish, cancel);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close-control';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close debugging context');
  close.onclick = () => {
    closePanel(panel.id);
    toggle.focus();
  };
  panel.onkeydown = (event) => {
    if (event.key === 'Escape') close.click();
  };
  panel.append(close, heading, edit, overview, form, status);
  toggle.onclick = () => {
    if (togglePanel(panel.id)) close.focus();
  };
  const render = () => {
    const snapshot = readContext(shared, config);
    overview.replaceChildren();
    for (const field of config.fields) {
      if (field.collapsed && !snapshot[field.key]) continue;
      const label = document.createElement(field.collapsed ? 'summary' : 'h3');
      label.textContent = field.label;
      const content = document.createElement('pre');
      content.textContent = snapshot[field.key] || 'Not provided yet';
      if (field.collapsed) {
        const detail = document.createElement('details');
        detail.append(label, content);
        overview.append(detail);
      } else overview.append(label, content);
    }
    for (const schema of config.collections) {
      const label = document.createElement('h3');
      label.textContent = `${schema.label} (${snapshot[schema.key].length})`;
      overview.append(label);
      for (const entry of snapshot[schema.key]) {
        const detail = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = schema.fields
          .slice(0, 2)
          .map((field) => String(entry?.[field.key] || ''))
          .join(' — ');
        const content = document.createElement('pre');
        content.textContent = entrySummary(entry, schema);
        detail.append(summary, content);
        overview.append(detail);
      }
    }
    edit.disabled = readOnly || !provider.synced;
    publish.disabled = readOnly || !provider.synced;
  };
  edit.onclick = () => {
    base = readContext(shared, config);
    for (const [key, input] of inputs) input.value = base[key];
    try {
      for (const [key, collection] of collections) collection.load(base[key]);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    form.hidden = false;
    overview.hidden = true;
    edit.hidden = true;
    preview.hidden = publish.hidden = true;
    status.textContent = '';
    inputs.values().next().value?.focus();
  };
  form.oninput = invalidate;
  form.onsubmit = (event) => {
    event.preventDefault();
    invalidate();
    try {
      if ([...collections.values()].some((collection) => collection.pending))
        throw new Error(
          'Wait for the selected file to finish loading before reviewing.',
        );
      draft = validateContext(
        Object.fromEntries([
          ...[...inputs].map(([key, input]) => [key, input.value]),
          ...[...collections].map(([key, collection]) => [
            key,
            collection.read(),
          ]),
        ]),
        config,
      );
      preview.textContent = contextSummary(draft, config);
      preview.hidden = publish.hidden = false;
      status.textContent =
        'Review everything below before sharing with the room.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  publish.onclick = () => {
    if (!draft || readOnly || !provider.synced) return;
    let changed;
    try {
      const current = readContext(shared, config);
      changed = contextChanges(base, draft, current);
      validateContext(
        {
          ...current,
          ...Object.fromEntries(changed.map((key) => [key, draft[key]])),
        },
        config,
      );
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    ydoc.transact(() => {
      for (const key of changed) shared.set(key, draft[key]);
    });
    form.hidden = true;
    overview.hidden = false;
    edit.hidden = false;
    draft = null;
    status.textContent =
      'Context shared. Keep this window open until connected to sync changes.';
  };
  shared.observe(render);
  provider.on('sync', render);
  render();
  const dispose = () => {
    shared.unobserve(render);
    provider.off('sync', render);
    panel.replaceChildren();
    panel.hidden = true;
    toggle.hidden = true;
    toggle.onclick = null;
    panel.onkeydown = null;
    for (const collection of collections.values()) collection.dispose();
  };
  dispose.setTitle = (value) => {
    heading.textContent = `${value} — debugging context`;
  };
  dispose.setReadOnly = (value) => {
    readOnly = value;
    for (const input of inputs.values()) input.disabled = value;
    for (const collection of collections.values())
      collection.setReadOnly(value);
    review.disabled = value;
    render();
  };
  return dispose;
}
