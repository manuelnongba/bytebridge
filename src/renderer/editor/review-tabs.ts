import type { ReviewTab } from '../../shared/contracts.js';
import { element } from '../ui/dom.js';

/** Version tabs own independent models; the live editor remains bound to its document. */
export function initializeReviewTabs(
  change: (active: boolean) => void,
  resume: () => void,
) {
  const tabs = document.createElement('div');
  tabs.id = 'review-tabs';
  tabs.setAttribute('aria-label', 'Version tabs');
  element('file-tabs').after(tabs);
  const view = document.createElement('section');
  view.id = 'version-view';
  view.hidden = true;
  element('editor').before(view);
  const entries = new Map<string, ReviewTab>();
  let active: string | null = null;
  let cleanup = () => {};
  const notify = () =>
    element('editor-panel').dispatchEvent(new Event('review-change'));
  const renderTabs = () => {
    tabs.replaceChildren();
    for (const entry of entries.values()) {
      const tab = document.createElement('div');
      tab.className = 'file-tab review-tab';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'button secondary';
      select.textContent = entry.label;
      select.title = entry.label;
      select.setAttribute('aria-pressed', String(active === entry.id));
      select.onclick = () => activate(entry.id);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button secondary';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Close ${entry.label}`);
      remove.onclick = () => close(entry.id);
      tab.append(select, remove);
      tabs.append(tab);
    }
    tabs.hidden = !entries.size;
    tabs
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const showLive = () => {
    if (active === null) return;
    cleanup();
    cleanup = () => {};
    view.replaceChildren();
    view.hidden = true;
    active = null;
    change(false);
    renderTabs();
    notify();
    element('file-tabs')
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  function close(id: string) {
    const wasActive = active === id;
    if (wasActive) showLive();
    entries.delete(id);
    renderTabs();
    if (wasActive) resume();
  }
  function activate(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    cleanup();
    cleanup = () => {};
    active = id;
    view.replaceChildren();
    view.hidden = false;
    change(true);
    renderTabs();
    element('active-file-label').textContent = entry.label;
    element('active-file-label').title = entry.label;
    cleanup = entry.render(view, () => close(id));
    notify();
  }
  return {
    showLive,
    open(entry: ReviewTab) {
      entries.set(entry.id, entry);
      activate(entry.id);
      return () => close(entry.id);
    },
    dispose() {
      cleanup();
      change(false);
      entries.clear();
      tabs.remove();
      view.remove();
    },
  };
}
