import type * as Y from 'yjs';
import type { RoomProvider } from '../../shared/contracts.js';
import type { MonacoBinding } from 'y-monaco';

export function typingLabel(
  states: [number, { editing?: boolean; user?: { name?: string } }][],
  localId: number,
) {
  const names = states
    .filter(([id, state]) => id !== localId && state.editing === true)
    .map(([, state]) => String(state.user?.name || 'Teammate').slice(0, 60));

  if (!names.length) return '';

  if (names.length === 1) return `${names[0]} is typing…`;

  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;

  const others = names.length - 2;

  return `${names[0]}, ${names[1]} and ${others} ${others === 1 ? 'other' : 'others'} are typing…`;
}

export function trackTyping(
  provider: RoomProvider,
  text: Y.Text,
  binding: MonacoBinding,
  config: { typingEnabled: boolean; typingIdleMs: number },
  render: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    clearTimeout(timer);
    provider.awareness.setLocalStateField('editing', false);
  };

  const changed = (event: Y.YTextEvent) => {
    if (
      !config.typingEnabled ||
      !provider.wsconnected ||
      event.transaction.origin !== binding
    )
      return;

    clearTimeout(timer);
    provider.awareness.setLocalStateField('editing', true);
    timer = setTimeout(clear, config.typingIdleMs);
  };

  const status = () => {
    if (!provider.wsconnected) clear();

    render();
  };

  text.observe(changed);
  provider.on('status', status);
  window.addEventListener('blur', clear);

  return () => {
    clear();
    text.unobserve(changed);
    provider.off('status', status);
    window.removeEventListener('blur', clear);
  };
}
