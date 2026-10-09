import type * as Y from 'yjs';
import type {
  ContextSnapshot,
  ContextKey,
  RoomProvider,
} from '../../shared/contracts.js';
import { element, errorMessage } from '../ui/dom.js';
import { APP_CONFIG } from '../app-config.js';
import { closePanel, togglePanel } from '../ui/panels.js';
import { collectionEditor } from './collection-editor.js';
import {
  readContext,
  validateContext,
  contextChanges,
  entrySummary,
} from './data.js';

// Only explicitly submitted values enter Yjs. Keystrokes in this form stay local.
export function initializeContext(
  ydoc: Y.Doc,
  provider: RoomProvider,
  title: string,
) {
  const config = APP_CONFIG.debugging;
  const panel = element('debug-context');
  const toggle = element<HTMLButtonElement>('open-context');

  toggle.hidden = !config.enabled;
  panel.hidden = true;

  if (!config.enabled) return Object.assign(() => {}, { setReadOnly() {} });

  const shared = ydoc.getMap('debug-context');
  let readOnly = false;
  let base = readContext(shared, config);

  panel.replaceChildren();

  const heading = document.createElement('h2');

  heading.textContent = 'Problem';

  const overview = document.createElement('div');

  overview.id = 'context-overview';

  const edit = document.createElement('button');

  edit.type = 'button';
  edit.className = 'button secondary';
  edit.textContent = 'Edit problem';
  edit.id = 'edit-context';

  const form = document.createElement('form');

  form.hidden = true;

  const inputs = new Map<ContextKey, HTMLTextAreaElement>();
  const optional = document.createElement('details');
  const optionalTitle = document.createElement('summary');

  optionalTitle.textContent = 'Optional details & snippets';
  optional.append(optionalTitle);

  for (const field of config.fields) {
    const label = document.createElement('label');

    label.textContent = field.label;

    const input = document.createElement('textarea');

    input.id = `context-${field.key}`;
    input.rows = field.key === 'issue' ? 1 : 3;
    input.maxLength = config.maxFieldLength;
    label.append(input);
    (config.primaryFields.includes(field.key) ? form : optional).append(label);
    inputs.set(field.key, input);
  }

  const warning = document.createElement('p');

  warning.textContent =
    'Drafts stay on this device until shared. Remove passwords, tokens, personal data, and private logs before sharing. Removing previously shared text cannot erase copies or server history.';

  const status = document.createElement('p');

  status.id = 'context-status';
  status.setAttribute('role', 'status');

  const invalidate = () => {
    status.textContent = '';
  };

  const collections = new Map(
    config.collections.map((schema) => [
      schema.key,
      collectionEditor(schema, config, invalidate, (message: string) => {
        status.textContent = message;
      }),
    ]),
  );

  for (const [key, collection] of collections) {
    if (key === 'attachments') optional.append(collection.root);
  }

  form.append(optional);

  const review = document.createElement('button');

  review.type = 'submit';
  review.className = 'button secondary';
  review.textContent = 'Save & share problem';
  review.id = 'review-context';

  const cancel = document.createElement('button');

  cancel.type = 'button';
  cancel.className = 'button secondary';
  cancel.textContent = 'Discard draft';
  cancel.id = 'discard-context';
  cancel.onclick = () => {
    form.hidden = true;
    overview.hidden = false;
    edit.hidden = false;
    status.textContent = '';

    for (const collection of collections.values()) collection.dispose();
  };
  form.append(warning, review, cancel);

  const close = document.createElement('button');

  close.type = 'button';
  close.className = 'close-control';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close problem');
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

    const extra = document.createElement('details');
    const extraTitle = document.createElement('summary');

    extraTitle.textContent = 'More details';
    extra.append(extraTitle);

    for (const field of config.fields) {
      const primary = config.primaryFields.includes(field.key);

      if (!primary && !snapshot[field.key]) continue;

      const label = document.createElement('h3');

      label.textContent = field.label;

      const content = document.createElement('pre');

      content.textContent = snapshot[field.key] || 'Not provided yet';
      (primary ? overview : extra).append(label, content);
    }

    for (const schema of config.collections) {
      if (!snapshot[schema.key].length) continue;

      const label = document.createElement('h3');

      label.textContent = `${schema.label} (${snapshot[schema.key].length})`;
      extra.append(label);

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
        extra.append(detail);
      }
    }

    if (extra.children.length > 1) overview.append(extra);

    edit.disabled = readOnly || !provider.synced;
    review.disabled = readOnly || !provider.synced;
  };

  edit.onclick = () => {
    base = readContext(shared, config);

    for (const [key, input] of inputs) input.value = base[key];

    try {
      for (const [key, collection] of collections) collection.load(base[key]);
    } catch (error) {
      status.textContent = errorMessage(error);

      return;
    }

    form.hidden = false;
    overview.hidden = true;
    edit.hidden = true;
    status.textContent = '';
    inputs.values().next().value?.focus();
  };
  form.oninput = invalidate;
  form.onsubmit = (event) => {
    event.preventDefault();

    if (readOnly || !provider.synced) return;

    invalidate();

    try {
      if ([...collections.values()].some((collection) => collection.pending))
        throw new Error(
          'Wait for the selected file to finish loading before sharing.',
        );

      const draft = validateContext(
        Object.fromEntries([
          ...[...inputs].map(([key, input]) => [key, input.value]),
          ...[...collections].map(([key, collection]) => [
            key,
            collection.read(),
          ]),
        ]) as ContextSnapshot,
        config,
      );
      const current = readContext(shared, config);
      const changed = contextChanges(base, draft, current);

      validateContext(
        {
          ...current,
          ...Object.fromEntries(changed.map((key) => [key, draft[key]])),
        },
        config,
      );
      ydoc.transact(() => {
        for (const key of changed) shared.set(key, draft[key]);
      });
      form.hidden = true;
      overview.hidden = false;
      edit.hidden = false;
      status.textContent = 'Problem shared with the room.';
    } catch (error) {
      status.textContent = errorMessage(error);
    }
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

  dispose.setTitle = (value: string) => {
    heading.title = value;
  };
  dispose.setReadOnly = (value: boolean) => {
    readOnly = value;

    for (const input of inputs.values()) input.disabled = value;

    for (const collection of collections.values())
      collection.setReadOnly(value);

    review.disabled = value;
    render();
  };

  return dispose;
}
