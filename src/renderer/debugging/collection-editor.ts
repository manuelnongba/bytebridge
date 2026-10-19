import { initializeDropdown } from '../ui/dropdown.js';
import type {
  CollectionSchema,
  DebugConfig,
  ContextEntry,
} from '../../shared/contracts.js';
import { errorMessage } from '../ui/dom.js';
import { readAttachment } from './data.js';
import { detectLanguage } from './languages.js';

// Draft-only controls: no Yjs writes or filesystem access beyond selected File objects.
export function collectionEditor(
  schema: CollectionSchema,
  config: DebugConfig,
  changed: () => void,
  report: (message: string) => void,
) {
  const root = document.createElement('fieldset');

  root.dataset.collection = schema.key;

  const legend = document.createElement('legend');

  legend.textContent = schema.label;

  const rows = document.createElement('div');
  const dropdowns = new Map<
    HTMLElement,
    ReturnType<typeof initializeDropdown>[]
  >();
  let epoch = 0;
  let disabled = false;
  let pending = false;

  const read = () =>
    [...rows.children].map((row) =>
      Object.fromEntries(
        schema.fields.map((field) => [
          field.key,
          row.querySelector<HTMLInputElement>(`[data-field="${field.key}"]`)!
            .value,
        ]),
      ),
    );

  const append = (entry: ContextEntry = {}) => {
    if (rows.children.length >= schema.maxItems)
      throw new Error(
        `Maximum ${schema.maxItems} ${schema.label.toLowerCase()} entries.`,
      );

    const row = document.createElement('fieldset');

    row.className = 'context-entry';

    const pickers: ReturnType<typeof initializeDropdown>[] = [];

    dropdowns.set(row, pickers);

    for (const field of schema.fields) {
      const label = document.createElement('label');

      label.textContent = field.label;

      const input = document.createElement(
        field.options ? 'select' : field.multiline ? 'textarea' : 'input',
      );

      input.dataset.field = field.key;

      if (field.options)
        for (const option of field.options)
          input.append(new Option(option, option));
      else {
        (input as HTMLInputElement | HTMLTextAreaElement).maxLength =
          field.maxLength || 100;
        input.required = field.key !== 'notes' && !field.optional;
      }

      input.value = entry[field.key] || field.options?.[0] || '';
      label.append(input);
      row.append(label);

      if (input instanceof HTMLSelectElement) {
        if (field.key === 'language') {
          for (const option of input.options) {
            const definition = config.languages.find(
              (item) => item.id === option.value,
            );

            option.dataset.search = [
              option.value,
              ...(definition?.extensions || []),
            ].join(' ');
          }
        }

        pickers.push(
          initializeDropdown(input, {
            searchable: field.key === 'language',
            name: field.label,
          }),
        );
      }
    }

    if (schema.fileImport) {
      const filename = row.querySelector<HTMLInputElement>(
        '[data-field="filename"]',
      )!;
      const language = row.querySelector<HTMLSelectElement>(
        '[data-field="language"]',
      )!;
      let manualLanguage = Boolean(
        entry.language &&
        entry.language !==
          detectLanguage(entry.filename || '', config.languages),
      );

      language.onchange = () => {
        manualLanguage = true;
        changed();
      };
      filename.addEventListener('input', () => {
        if (!manualLanguage)
          language.value = detectLanguage(filename.value, config.languages);

        for (const picker of pickers) picker.refresh();
      });
    }

    const remove = document.createElement('button');

    remove.type = 'button';
    remove.className = 'button danger';
    remove.textContent = 'Remove entry';
    remove.onclick = () => {
      for (const picker of pickers) picker.dispose();

      dropdowns.delete(row);
      row.remove();
      changed();
    };
    row.append(remove);
    rows.append(row);
  };

  const add = document.createElement('button');

  add.type = 'button';
  add.className = 'button secondary';
  add.id = `add-${schema.key}`;
  add.textContent = schema.addLabel;
  add.onclick = () => {
    try {
      append();
      changed();
      rows.lastElementChild
        ?.querySelector<HTMLElement>('input, textarea')
        ?.focus();
    } catch (error) {
      report(errorMessage(error));
    }
  };
  root.append(legend, rows, add);

  if (schema.fileImport) {
    const label = document.createElement('label');

    label.textContent = `Select a UTF-8 text file (maximum ${config.maxFileBytes} bytes)`;

    const file = document.createElement('input');

    file.type = 'file';
    file.id = 'context-file';
    file.onchange = async () => {
      const selected = file.files?.[0];

      file.value = '';

      if (!selected || disabled) return;

      const version = ++epoch;

      pending = true;
      changed();

      try {
        const entry = await readAttachment(selected, config);

        if (version !== epoch || disabled) return;

        append(entry);
        changed();
      } catch (error) {
        if (version === epoch) report(errorMessage(error));
      } finally {
        if (version === epoch) pending = false;
      }
    };
    label.append(file);
    root.append(label);
  }

  return {
    root,
    append,
    read,
    get pending() {
      return pending;
    },
    load(entries: ContextEntry[]) {
      epoch++;
      pending = false;
      for (const pickers of dropdowns.values())
        for (const picker of pickers) picker.dispose();

      dropdowns.clear();
      rows.replaceChildren();

      for (const entry of entries) append(entry);
    },
    setReadOnly(value: boolean) {
      disabled = value;
      root.disabled = value;

      for (const pickers of dropdowns.values())
        for (const picker of pickers) picker.refresh();

      if (value) {
        epoch++;
        pending = false;
      }
    },
    dispose() {
      for (const pickers of dropdowns.values())
        for (const picker of pickers) picker.dispose();

      dropdowns.clear();
      epoch++;
      pending = false;
    },
  };
}
