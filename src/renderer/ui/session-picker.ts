import { element } from './dom.js';

// The native select remains the single selected-value source for room actions.
export function initializeSessionPicker(
  matches: (query: string) => Set<string>,
) {
  const root = element('session-picker');
  const trigger = element<HTMLButtonElement>('session-picker-trigger');
  const label = element('session-picker-label');
  const popup = element('session-picker-popup');
  const input = element<HTMLInputElement>('session-search');
  const list = element('session-options');
  const select = element<HTMLSelectElement>('saved-room');
  const count = element('session-count');
  let highlighted = -1;
  let options: HTMLOptionElement[] = [];

  function close(focus = false) {
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (focus) trigger.focus();
  }
  function highlight(index: number) {
    highlighted = index;
    [...list.children].forEach((el, i) =>
      el.classList.toggle('highlighted', i === index),
    );
    const active = list.children[index];
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || select.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change'));
    refresh();
    close(true);
  }
  function render() {
    const matching = matches(input.value);
    options = [...select.options].filter((option) =>
      matching.has(option.value),
    );
    list.replaceChildren();
    options.forEach((option, index) => {
      const row = document.createElement('div');
      row.id = `session-option-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.className = 'session-option';
      const title = document.createElement('strong');
      title.textContent = option.dataset.title || option.textContent;
      const detail = document.createElement('small');
      detail.textContent = option.dataset.detail || '';
      row.append(title, detail);
      row.onmousedown = (event) => event.preventDefault();
      row.onclick = () => choose(index);
      list.append(row);
    });
    count.textContent = options.length
      ? `${options.length} session${options.length === 1 ? '' : 's'}`
      : input.value
        ? 'No matching sessions. Try another title, error, or tag.'
        : 'No saved sessions in this view.';
    highlight(options.findIndex((option) => option.selected));
  }
  function refresh() {
    const selected = select.selectedOptions[0];
    label.textContent =
      selected?.dataset.title ||
      selected?.textContent ||
      'Choose a saved session';
    trigger.title = selected?.textContent || '';
    trigger.disabled = select.disabled;
    render();
  }
  function show() {
    if (trigger.disabled) return;
    input.value = '';
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-expanded', 'true');
    render();
    input.focus();
  }
  trigger.onclick = () => (popup.hidden ? show() : close());
  trigger.onkeydown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show();
    }
  };
  input.oninput = render;
  root.addEventListener('keydown', (event) => {
    if (popup.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (highlighted < 0) {
        highlight(
          options.length
            ? event.key === 'ArrowDown'
              ? 0
              : options.length - 1
            : -1,
        );
        return;
      }
      highlight(
        options.length
          ? (highlighted +
              (event.key === 'ArrowDown' ? 1 : -1) +
              options.length) %
              options.length
          : -1,
      );
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      choose(highlighted >= 0 ? highlighted : 0);
    }
  });
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  return { refresh, close };
}
