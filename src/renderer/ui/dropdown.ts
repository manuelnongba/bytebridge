import { initializeSearchableDropdown } from './searchable-dropdown.js';

let nextId = 0;

// Adapt a native select while retaining its value and change handlers.
export function initializeDropdown(
  select: HTMLSelectElement,
  { searchable = false, name = '' } = {},
) {
  const id = `dropdown-${++nextId}`;
  const root = document.createElement('span');
  const trigger = document.createElement('button');
  const label = document.createElement('span');
  const popup = document.createElement('div');
  const input = document.createElement('input');
  const list = document.createElement('div');
  const count = document.createElement('p');
  const wasHidden = select.hidden;
  const accessibleName =
    name ||
    select.getAttribute('aria-label') ||
    [...(select.labels || [])]
      .map((item) =>
        [...item.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(' ')
          .trim(),
      )
      .join(' ') ||
    'Choose an option';

  root.className = `dropdown-control ${select.className}`;
  trigger.type = 'button';
  trigger.id = `${id}-trigger`;
  label.id = `${id}-label`;
  trigger.dataset.label = accessibleName;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-options`);
  trigger.append(label);
  popup.className = 'dropdown-floating';
  popup.popover = 'manual';
  input.type = 'search';
  input.placeholder = `Search ${accessibleName.toLowerCase()}…`;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', input.placeholder);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-options`);
  list.id = `${id}-options`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', accessibleName);
  count.setAttribute('role', 'status');
  popup.append(input, list, count);
  root.append(trigger, popup);
  select.hidden = true;
  select.after(root);

  const labels = [...(select.labels || [])].filter(
    (item) => item.htmlFor === select.id && select.id,
  );

  for (const item of labels) item.htmlFor = trigger.id;

  const picker = initializeSearchableDropdown({
    root,
    trigger,
    label,
    popup,
    input,
    list,
    select,
    count,
    searchable,
    placeholder: 'Choose an option',
    describeCount: (total) =>
      total
        ? `${total} option${total === 1 ? '' : 's'}`
        : 'No matching options.',
  });

  return {
    refresh: picker.refresh,
    close: picker.close,
    dispose() {
      picker.dispose();

      for (const item of labels) item.htmlFor = select.id;

      root.remove();
      select.hidden = wasHidden;
    },
  };
}
