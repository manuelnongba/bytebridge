import { initializeTerminalResize } from './resize.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { button, element, errorMessage } from '../ui/dom.js';
import { initializeDropdown } from '../ui/dropdown.js';
import { closePanel, openPanel } from '../ui/panels.js';

export function initializeTerminalPanel(options: {
  projects(): Array<{ id: string; name: string }>;
  blocked(projectId: string): string;
  checkDisk(): Promise<void>;
}) {
  const panel = element('terminal-panel');
  const toggle = element<HTMLButtonElement>('open-terminal');
  const heading = document.createElement('h2');
  const toolbar = document.createElement('div');
  const handle = document.createElement('div');
  const help = document.createElement('p');
  const label = document.createElement('label');
  const project = document.createElement('select');
  const actions = document.createElement('div');
  const status = document.createElement('p');
  const gate = document.createElement('p');
  const surface = document.createElement('div');
  let alive = true;
  let id = '';
  let projectId = '';
  let starting = false;
  let requested = false;
  let generation = 0;
  let signature = '';
  let terminal: Terminal | undefined;
  let fit: FitAddon | undefined;

  const close = button('×', 'close-terminal', () => {
    closePanel(panel.id);
    toggle.focus();
  });
  const review = button('Review changes', 'terminal-review', () => {
    void options
      .checkDisk()
      .then(() => {
        if (alive) openPanel('files-panel');
      })
      .catch(report);
  });

  close.className = 'close-control';
  close.setAttribute('aria-label', 'Close and end terminal');
  heading.textContent = 'Terminal';
  help.className = gate.className = 'panel-help';
  project.id = 'terminal-project';
  label.htmlFor = project.id;
  label.textContent = 'Hosted project';
  actions.className = 'workspace-actions';
  surface.className = 'terminal-surface';
  status.setAttribute('role', 'status');
  actions.append(review);
  toolbar.className = 'terminal-toolbar';
  toolbar.append(heading, label, project, actions, close);
  panel.replaceChildren(handle, toolbar, help, status, gate, surface);

  const disposeResize = initializeTerminalResize(panel, handle);
  toggle.hidden = false;

  const picker = initializeDropdown(project);

  function report(error: unknown) {
    if (alive) status.textContent = errorMessage(error);
  }

  function resize() {
    if (
      !alive ||
      panel.hidden ||
      !terminal ||
      !surface.clientWidth ||
      !surface.clientHeight
    )
      return;

    fit?.fit();
    if (id)
      void window.api
        .resizeTerminal(id, terminal.cols, terminal.rows)
        .catch(report);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(surface);

  const unsubscribe = window.api.onTerminalEvent((event) => {
    if (!alive || event.id !== id) return;

    if (event.type === 'data') {
      terminal?.write(event.data, () => {
        if (alive)
          void window.api
            .acknowledgeTerminal(event.id, event.data.length)
            .catch(report);
      });
    } else {
      id = '';
      status.textContent = `Shell exited (${event.code}). Disk changes are available for review.`;
      terminal?.write('\r\n[Terminal closed]\r\n');
      refresh();
      void options.checkDisk().catch(report);
    }
  });

  async function end() {
    const previous = id;

    generation++;
    requested = false;
    id = '';
    starting = false;
    terminal?.dispose();
    terminal = undefined;
    fit = undefined;
    status.textContent =
      'Terminal ended. Disk changes are available for review.';
    refresh();

    try {
      if (previous) await window.api.stopTerminal(previous);
      if (alive) await options.checkDisk();
    } catch (error) {
      report(error);
    }
  }

  async function launch() {
    if (id || starting) return;

    requested = false;
    const attempt = ++generation;
    starting = true;
    refresh();

    try {
      await options.checkDisk();
      if (!alive || attempt !== generation) return;

      const reason = options.blocked(project.value);
      if (reason) {
        status.textContent = reason;
        return;
      }

      terminal?.dispose();
      terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        scrollback: 3000,
        theme: { background: '#1e1e1e', foreground: '#e4e9f0' },
        allowProposedApi: false,
      });
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(surface);
      fit.fit();
      projectId = project.value;
      id = crypto.randomUUID();
      const startedId = id;

      terminal.attachCustomKeyEventHandler((event) => {
        // Keep shell shortcuts (including Ctrl+C) out of app command handlers.
        event.stopPropagation();
        return true;
      });
      terminal.onData((data) => {
        if (!id) return;
        // Split large pastes without exceeding the IPC input limit.
        for (let offset = 0; offset < data.length; offset += 16384)
          void window.api
            .writeTerminal(id, data.slice(offset, offset + 16384))
            .catch(report);
      });
      await window.api.startTerminal({
        id,
        projectId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (!alive || attempt !== generation) {
        await window.api.stopTerminal(startedId);
        return;
      }

      status.textContent = '';
      terminal.focus();
    } catch (error) {
      if (alive && attempt === generation) {
        id = '';
        report(error);
      }
    } finally {
      if (alive && attempt === generation) {
        starting = false;
        refresh();
      }
    }
  }

  function refresh() {
    if (!alive) return;

    const projects = options.projects();
    const next = JSON.stringify(projects);
    if (signature !== next) {
      signature = next;
      const previous = project.value;
      project.replaceChildren(
        ...projects.map((entry) => new Option(entry.name, entry.id)),
      );
      if (projects.some((entry) => entry.id === previous))
        project.value = previous;
      if (id && !projects.some((entry) => entry.id === projectId)) void end();
    }

    const reason = options.blocked(project.value);
    project.disabled = !!id || starting || !projects.length;

    gate.textContent = reason;
    gate.hidden = !reason;
    picker.refresh();

    if (requested && !panel.hidden && !id && !starting && !reason)
      void launch();
  }

  const show = () => {
    openPanel(panel.id);
    requested = !id;
    refresh();
    requestAnimationFrame(() => {
      resize();
      terminal?.focus();
    });
  };
  const closed = () => {
    void end();
  };

  project.onchange = () => {
    requested = true;
    refresh();
  };
  toggle.onclick = () => {
    if (panel.hidden) show();
    else closePanel(panel.id);
  };
  panel.addEventListener('panel-closed', closed);
  toggle.addEventListener('terminal-open', show);
  refresh();

  return {
    refresh,
    dispose() {
      alive = false;
      generation++;
      unsubscribe();
      panel.removeEventListener('panel-closed', closed);
      toggle.removeEventListener('terminal-open', show);
      observer.disconnect();
      disposeResize();
      if (id) void window.api.stopTerminal(id).catch(() => {});
      terminal?.dispose();
      picker.dispose();
      panel.replaceChildren();
      closePanel(panel.id);
      toggle.hidden = true;
      toggle.onclick = null;
    },
  };
}
