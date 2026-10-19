import { element } from './dom.js';
import { initializeSearchableDropdown } from './searchable-dropdown.js';

export function initializeSessionPicker(
  matches: (query: string) => Set<string>,
) {
  return initializeSearchableDropdown({
    root: element('session-picker'),
    trigger: element<HTMLButtonElement>('session-picker-trigger'),
    label: element('session-picker-label'),
    popup: element('session-picker-popup'),
    input: element<HTMLInputElement>('session-search'),
    list: element('session-options'),
    select: element<HTMLSelectElement>('saved-room'),
    count: element('session-count'),
    placeholder: 'Choose a saved session',
    matches,
    describeCount: (count, query) =>
      count
        ? `${count} session${count === 1 ? '' : 's'}`
        : query
          ? 'No matching sessions. Try another title, error, or tag.'
          : 'No saved sessions in this view.',
  });
}
