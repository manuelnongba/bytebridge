import { APP_CONFIG } from '../app-config.js';

export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  available(): boolean;
  run(): void;
}
export interface SearchItem {
  id: string;
  label: string;
  detail?: string;
  run(): void;
}

// Subsequence matching favors contiguous matches and path/word boundaries.
export function fuzzyScore(query: string, value: string): number {
  const needle = query.toLowerCase().trim();
  const haystack = value.toLowerCase();
  let position = 0,
    score = 0,
    previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, position);
    if (index < 0) return -1;
    score +=
      10 +
      (index === previous + 1 ? 8 : 0) +
      (index === 0 || '/ ._-'.includes(haystack[index - 1]!) ? 6 : 0);
    previous = index;
    position = index + 1;
  }
  return score + 1 / (haystack.length + 1);
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.toLowerCase().split('+');
  const mac = /Mac/.test(navigator.platform);
  return (
    event.key.toLowerCase() === parts.at(-1) &&
    event.shiftKey === parts.includes('shift') &&
    event.altKey === parts.includes('alt') &&
    event.metaKey === (parts.includes('mod') && mac) &&
    event.ctrlKey === (parts.includes('mod') && !mac)
  );
}

export function initializeNavigation(
  commands: Command[],
  files: () => SearchItem[],
  report: (message: string) => void,
) {
  const config = APP_CONFIG.navigation;
  const dialog = document.createElement('dialog');
  dialog.className = 'navigation-dialog';
  dialog.setAttribute('aria-labelledby', 'navigation-heading');
  const heading = document.createElement('h2');
  heading.id = 'navigation-heading';
  const input = document.createElement('input');
  input.type = 'search';
  input.setAttribute('aria-label', 'Search');
  const results = document.createElement('div');
  results.className = 'navigation-results';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const close = document.createElement('button');
  close.className = 'button secondary';
  close.textContent = 'Close';
  close.onclick = () => dialog.close();
  dialog.append(heading, input, results, status, close);
  document.body.append(dialog);
  let mode: 'commands' | 'files' = 'commands';
  let selected = 0;
  let choices: SearchItem[] = [];
  let previous: HTMLElement | null = null;
  const enabled = () =>
    commands.filter(
      (c) => !config.hiddenCommands.includes(c.id) && c.available(),
    );
  const invoke = (item?: SearchItem) => {
    if (!item) return;
    dialog.close();
    try {
      item.run();
    } catch (error) {
      report(error instanceof Error ? error.message : 'Action failed.');
    }
  };
  const highlight = () => {
    [...results.children].forEach((child, i) =>
      child.setAttribute('aria-current', String(i === selected)),
    );
    results.children[selected]?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    const all =
      mode === 'files'
        ? files()
        : enabled().map((c) => ({
            id: c.id,
            label: c.label,
            detail: `${c.group}${c.shortcut ? ' · ' + c.shortcut.replace('Mod', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl') : ''}`,
            run: () => {
              if (c.available()) c.run();
            },
          }));
    choices = all
      .map((item) => ({ item, score: fuzzyScore(input.value, item.label) }))
      .filter((item) => item.score >= 0)
      .sort(
        (a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label),
      )
      .slice(0, Math.max(1, config.resultLimit))
      .map((item) => item.item);
    selected = 0;
    results.replaceChildren();
    choices.forEach((item, index) => {
      const button = document.createElement('button');
      button.className = 'navigation-result';
      button.textContent = item.label;
      if (item.detail) {
        const detail = document.createElement('small');
        detail.textContent = item.detail;
        button.append(detail);
      }
      button.onclick = () => invoke(item);
      button.onfocus = () => {
        selected = index;
        highlight();
      };
      results.append(button);
    });
    status.textContent = choices.length
      ? `${choices.length} results. Use arrow keys and Enter, or Tab to a result.`
      : 'No matching results.';
    highlight();
  };
  input.oninput = render;
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selected =
        (selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) %
        (choices.length || 1);
      (results.children[selected] as HTMLElement | undefined)?.focus();
      highlight();
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      invoke(choices[selected]);
    }
  });
  dialog.addEventListener('close', () => {
    if (
      !dialog.open &&
      document.activeElement === document.body &&
      previous?.isConnected
    )
      previous.focus();
  });
  const show = (kind: typeof mode) => {
    if (!config.enabled || (kind === 'files' && !config.quickOpen)) return;
    mode = kind;
    previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    heading.textContent = kind === 'files' ? 'Open file' : 'Commands';
    input.value = '';
    dialog.showModal();
    render();
    input.focus();
  };
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        !config.enabled ||
        event.isComposing ||
        event.repeat ||
        dialog.open ||
        document.querySelector('dialog[open]') ||
        document.getElementById('workspace')?.inert
      )
        return;
      const command = enabled().find(
        (c) => c.shortcut && matchesShortcut(event, c.shortcut),
      );
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        command.run();
      } catch (error) {
        report(error instanceof Error ? error.message : 'Action failed.');
      }
    },
    true,
  );
  return { show };
}
