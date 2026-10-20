import { element } from './dom.js';

const panels: Record<string, string> = {
  'files-panel': 'open-files',
  'terminal-panel': 'open-terminal',
  'debug-context': 'open-context',
  'access-panel': 'manage-invites',
};

export function closePanel(id: string) {
  const panel = element(id);

  const wasOpen = !panel.hidden;

  panel.hidden = true;
  if (wasOpen) panel.dispatchEvent(new Event('panel-closed'));
  document
    .getElementById(panels[id] || '')
    ?.setAttribute('aria-expanded', 'false');
}

export function openPanel(id: string) {
  if (id !== 'terminal-panel')
    for (const other of Object.keys(panels))
      if (other !== id && other !== 'terminal-panel') closePanel(other);

  element(id).hidden = false;
  document
    .getElementById(panels[id] || '')
    ?.setAttribute('aria-expanded', 'true');
}

export function togglePanel(id: string) {
  const show = element(id).hidden;

  if (show) openPanel(id);
  else closePanel(id);

  return show;
}
