export function initializeTerminalResize(
  panel: HTMLElement,
  handle: HTMLElement,
) {
  let drag: { id: number; y: number; height: number } | undefined;

  handle.className = 'terminal-resizer';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', 'Resize terminal');
  handle.setAttribute('aria-controls', panel.id);
  handle.title = 'Drag to resize the terminal. Arrow keys adjust its height.';

  const setHeight = (height: number) => {
    const maximum = Math.max(160, window.innerHeight * 0.55);
    const next = Math.max(160, Math.min(maximum, height));

    panel.style.setProperty('--terminal-height', `${next}px`);
    handle.setAttribute('aria-valuemin', '160');
    handle.setAttribute('aria-valuemax', String(Math.round(maximum)));
    handle.setAttribute('aria-valuenow', String(Math.round(next)));
  };
  const stop = () => {
    if (!drag) return;

    const id = drag.id;

    drag = undefined;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  };

  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    drag = {
      id: event.pointerId,
      y: event.clientY,
      height: panel.getBoundingClientRect().height,
    };
    handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = (event) => {
    if (drag?.id === event.pointerId)
      setHeight(drag.height + drag.y - event.clientY);
  };
  handle.onpointerup = stop;
  handle.onpointercancel = stop;
  handle.onlostpointercapture = stop;
  handle.ondblclick = () => setHeight(320);
  handle.onkeydown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    setHeight(
      event.key === 'Home'
        ? 160
        : event.key === 'End'
          ? window.innerHeight * 0.55
          : panel.getBoundingClientRect().height +
            (event.key === 'ArrowUp' ? 20 : -20),
    );
  };

  const onResize = () => {
    if (!panel.hidden) setHeight(panel.getBoundingClientRect().height);
  };

  window.addEventListener('resize', onResize);
  panel.addEventListener('panel-closed', stop);
  setHeight(320);

  return () => {
    stop();
    window.removeEventListener('resize', onResize);
    panel.removeEventListener('panel-closed', stop);
  };
}
