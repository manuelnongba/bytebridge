export const PANEL_SIZE_KEY = 'bytebridge-panel-sizes';

export function readPanelSizes(storage) {
  try {
    const value = JSON.parse(storage.getItem(PANEL_SIZE_KEY));
    return Object.fromEntries(
      ['width', 'height']
        .filter((key) => Number.isFinite(value?.[key]) && value[key] > 0)
        .map((key) => [key, value[key]]),
    );
  } catch {
    return {};
  }
}

export function panelBounds(total, panelMinimum, editorMinimum) {
  const available = Math.max(0, total);
  // Share a very small workspace proportionally instead of overflowing it.
  const scale = Math.min(1, available / (panelMinimum + editorMinimum));
  return { min: panelMinimum * scale, max: available - editorMinimum * scale };
}

export function initializePanelResize(config) {
  if (!config.resizable) return;
  const body = document.getElementById('workspace-body');
  const inspector = document.getElementById('inspector');
  const handle = document.getElementById('panel-resizer');
  let sizes;
  try {
    sizes = readPanelSizes(localStorage);
  } catch {
    sizes = {};
  }
  let vertical = false,
    bounds = { min: 0, max: 0 },
    current = 0,
    drag = null;
  const save = () => {
    try {
      localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(sizes));
    } catch {
      /* Resizing still works when storage is unavailable. */
    }
  };
  const setSize = (size) => {
    current = Math.max(bounds.min, Math.min(bounds.max, size));
    body.style.setProperty('--panel-size', `${current}px`);
    handle.setAttribute('aria-valuenow', String(Math.round(current)));
    handle.setAttribute(
      'aria-valuetext',
      `${Math.round(current)} pixels ${vertical ? 'high' : 'wide'}`,
    );
  };
  const stopDrag = (cancel = false) => {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (cancel) setSize(previous.size);
    else {
      sizes[vertical ? 'height' : 'width'] = current;
      save();
    }
    body.classList.remove('panel-dragging');
    if (handle.hasPointerCapture(previous.id))
      handle.releasePointerCapture(previous.id);
  };
  const refresh = () => {
    const visible =
      body.dataset.stage === 'editing' &&
      [...inspector.children].some((panel) => !panel.hidden);
    const nextVertical = getComputedStyle(body).flexDirection === 'column';
    if (!visible || vertical !== nextVertical) stopDrag(true);
    vertical = nextVertical;
    handle.hidden = !visible;
    body.classList.toggle('has-resizable-panel', visible);
    body.classList.toggle('stacked-panels', vertical);
    if (!visible) return;
    const rect = body.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const total = vertical
      ? rect.height - handleRect.height
      : rect.width - handleRect.width;
    bounds = panelBounds(
      total,
      vertical ? config.minHeight : config.minWidth,
      vertical ? config.minEditorHeight : config.minEditorWidth,
    );
    handle.setAttribute(
      'aria-orientation',
      vertical ? 'horizontal' : 'vertical',
    );
    handle.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
    handle.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
    setSize(
      drag
        ? current
        : (sizes[vertical ? 'height' : 'width'] ??
            (vertical
              ? total * config.defaultHeightRatio
              : config.defaultWidth)),
    );
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    refresh();
    event.preventDefault();
    handle.focus();
    drag = {
      id: event.pointerId,
      coordinate: vertical ? event.clientY : event.clientX,
      size: current,
    };
    handle.setPointerCapture(event.pointerId);
    body.classList.add('panel-dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    setSize(
      drag.size + (vertical ? event.clientY : event.clientX) - drag.coordinate,
    );
  });
  handle.addEventListener('pointerup', () => stopDrag());
  handle.addEventListener('pointercancel', () => stopDrag(true));
  handle.addEventListener('lostpointercapture', () => stopDrag(true));
  handle.addEventListener('dblclick', () => {
    delete sizes[vertical ? 'height' : 'width'];
    save();
    refresh();
  });
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      stopDrag(true);
      return;
    }
    const decrease = vertical ? 'ArrowUp' : 'ArrowLeft';
    const increase = vertical ? 'ArrowDown' : 'ArrowRight';
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setSize(
      event.key === 'Home'
        ? bounds.min
        : event.key === 'End'
          ? bounds.max
          : current +
            (event.key === decrease ? -1 : 1) *
              config.keyboardStep *
              (event.shiftKey ? 3 : 1),
    );
    sizes[vertical ? 'height' : 'width'] = current;
    save();
  });
  new ResizeObserver(refresh).observe(body);
  const observer = new MutationObserver(refresh);
  observer.observe(inspector, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  observer.observe(body, { attributes: true, attributeFilter: ['data-stage'] });
  refresh();
}
