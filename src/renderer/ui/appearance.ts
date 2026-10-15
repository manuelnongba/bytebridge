import { APP_CONFIG } from '../app-config.js';
export function initializeAppearance() {
  const config = APP_CONFIG.appearance;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(config.colors))
    root.style.setProperty(`--${name}`, value);
  root.style.setProperty('--font-ui', config.fontFamily);
  root.style.setProperty('--font-size', `${config.fontSize}px`);
  root.dataset.density = config.density;
}
