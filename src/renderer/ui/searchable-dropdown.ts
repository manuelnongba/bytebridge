interface SearchableDropdownOptions {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  label: HTMLElement;
  popup: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  select: HTMLSelectElement;
  count: HTMLElement;
  placeholder: string;
  describeCount: (count: number, query: string) => string;
  searchable?: boolean;
  matches?: (query: string) => Set<string>;
}

// Keep the native select as the source of truth for both consumers.
export function initializeSearchableDropdown({
  root,
  trigger,
  label,
  popup,
  input,
  list,
  select,
  count,
  placeholder,
  describeCount,
  matches,
  searchable = true,
}: SearchableDropdownOptions) {
  trigger.classList.add('dropdown-trigger');
  label.classList.add('dropdown-label');
  popup.classList.add('dropdown-popup');
  input.classList.add('dropdown-search');
  list.classList.add('dropdown-options');
  count.classList.add('dropdown-count');

  input.hidden = !searchable;
  count.hidden = !searchable;

  const keyboardTarget = searchable ? input : list;

  if (!searchable) list.tabIndex = -1;

  const popover = popup.hasAttribute('popover');
  const isOpen = () =>
    popover ? popup.matches(':popover-open') : !popup.hidden;

  function position() {
    if (!popover || !isOpen()) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(280, rect.width), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upward = below < 180 && above > below;
    const height = Math.max(80, Math.min(320, upward ? above : below));

    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${height}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    popup.style.top = upward ? 'auto' : `${rect.bottom + 6}px`;
    popup.style.bottom = upward
      ? `${window.innerHeight - rect.top + 6}px`
      : 'auto';
  }

  let typed = '';
  let typedAt = 0;
  let highlighted = -1;
  let options: HTMLOptionElement[] = [];

  function close(focus = false) {
    if (popover && isOpen()) popup.hidePopover();
    else if (!popover) popup.hidden = true;

    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false');
    keyboardTarget.removeAttribute('aria-activedescendant');

    if (focus) trigger.focus();
  }

  function highlight(index: number) {
    highlighted = index;

    [...list.children].forEach((el, i) =>
      el.classList.toggle('highlighted', i === index),
    );

    const active = list.children[index];

    if (active) {
      keyboardTarget.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else keyboardTarget.removeAttribute('aria-activedescendant');
  }

  function choose(index: number) {
    const option = options[index];

    if (!option || option.disabled || select.matches(':disabled')) return;

    select.value = option.value;
    select.dispatchEvent(new Event('change'));
    refresh();
    close(true);
  }

  function render() {
    const matching = matches?.(input.value);
    const query = input.value.trim().toLowerCase();

    options = [...select.options].filter((option) =>
      matching
        ? matching.has(option.value)
        : (option.dataset.search || option.textContent || '')
            .toLowerCase()
            .includes(query),
    );
    list.replaceChildren();

    options.forEach((option, index) => {
      const row = document.createElement('div');

      row.id = `${list.id}-option-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.setAttribute('aria-disabled', String(option.disabled));
      row.className = 'searchable-option';

      const title = document.createElement('strong');

      title.textContent = option.dataset.title || option.textContent;

      const detail = document.createElement('small');

      detail.textContent = option.dataset.detail || '';
      row.append(title);
      if (detail.textContent) row.append(detail);
      row.onmousedown = (event) => event.preventDefault();
      row.onclick = () => choose(index);
      list.append(row);
    });
    count.textContent = describeCount(options.length, input.value);
    highlight(options.findIndex((option) => option.selected));
  }

  function refresh() {
    const selected = select.selectedOptions[0];

    label.textContent =
      selected?.dataset.title || selected?.textContent || placeholder;
    trigger.title = selected?.textContent || '';

    if (trigger.dataset.label)
      trigger.setAttribute(
        'aria-label',
        `${trigger.dataset.label}: ${label.textContent}`,
      );

    trigger.disabled = select.matches(':disabled');

    if (trigger.disabled) close();
    else if (isOpen()) render();
  }

  function show() {
    if (select.matches(':disabled')) return;

    input.value = '';
    if (popover) popup.showPopover();
    else popup.hidden = false;

    position();
    trigger.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-expanded', 'true');
    render();
    keyboardTarget.focus();
  }

  const controller = new AbortController();
  const { signal } = controller;

  trigger.addEventListener('click', () => (isOpen() ? close() : show()), {
    signal,
  });
  trigger.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        show();
      }
    },
    { signal },
  );
  input.addEventListener('input', render, { signal });
  root.addEventListener(
    'keydown',
    (event) => {
      if (!isOpen()) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (!searchable && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault();
        highlight(event.key === 'Home' ? 0 : options.length - 1);
      } else if (
        !searchable &&
        event.key.length === 1 &&
        event.key !== ' ' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();

        const now = Date.now();

        typed = (now - typedAt < 700 ? typed : '') + event.key.toLowerCase();
        typedAt = now;

        const index = options.findIndex(
          (option) =>
            !option.disabled &&
            (option.textContent || '').toLowerCase().startsWith(typed),
        );

        if (index >= 0) highlight(index);
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
      } else if (
        (event.key === 'Enter' || (!searchable && event.key === ' ')) &&
        event.target === keyboardTarget
      ) {
        event.preventDefault();
        choose(highlighted >= 0 ? highlighted : 0);
      }
    },
    { signal },
  );
  root.addEventListener(
    'focusout',
    (event) => {
      if (!root.contains(event.relatedTarget as Node | null)) close();
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!root.contains(event.target as Node)) close();
    },
    { signal },
  );

  select.addEventListener('change', refresh, { signal });
  window.addEventListener('resize', position, { signal });
  document.addEventListener('scroll', position, { capture: true, signal });

  const observer = new MutationObserver(refresh);

  observer.observe(select, {
    attributes: true,
    attributeFilter: ['disabled', 'label', 'selected'],
    childList: true,
    characterData: true,
    subtree: true,
  });
  refresh();

  return {
    refresh,
    close,
    dispose() {
      close();
      controller.abort();
      observer.disconnect();
    },
  };
}
