const panels = {
  'debug-context': 'open-context',
  'investigation-panel': 'open-timeline',
  'resolution-panel': 'open-resolution',
  'access-panel': 'manage-invites',
};
export function closePanel(id) {
  const panel = document.getElementById(id);
  panel.hidden = true;
  panel.dispatchEvent(new Event('panel-closed'));
  document.getElementById(panels[id])?.setAttribute('aria-expanded', 'false');
}
export function openPanel(id) {
  for (const other of Object.keys(panels)) if (other !== id) closePanel(other);
  document.getElementById(id).hidden = false;
  document.getElementById(panels[id])?.setAttribute('aria-expanded', 'true');
}
export function togglePanel(id) {
  const show = document.getElementById(id).hidden;
  if (show) openPanel(id);
  else closePanel(id);
  return show;
}
