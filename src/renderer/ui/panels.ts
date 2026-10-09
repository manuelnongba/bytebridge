import { element } from './dom.js';

const panels: Record<string, string> = {
  'files-panel': 'open-files',
  'debug-context': 'open-context',
  'access-panel': 'manage-invites',
};

export function closePanel(id: string) {
  const panel = element(id);

  panel.hidden = true;
  panel.dispatchEvent(new Event('panel-closed'));
  document
    .getElementById(panels[id] || '')
    ?.setAttribute('aria-expanded', 'false');
}

export function openPanel(id: string) {
  for (const other of Object.keys(panels)) if (other !== id) closePanel(other);

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
