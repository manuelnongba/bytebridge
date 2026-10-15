import type { WorkspaceFile, WorkspaceEditor } from '../../shared/contracts.js';
import { renderFileDiff } from '../investigation/checkpoint-diff.js';
import { errorMessage } from '../ui/dom.js';

export function showDiskConflict(
  file: WorkspaceFile,
  options: {
    allowed(): boolean;
    inspect(): Promise<{ content: string; token: string }>;
    accept(
      token: string,
      disk: string,
      reload: boolean,
      expected: string,
    ): Promise<void>;
    report(message: string): void;
  },
  editor: WorkspaceEditor,
) {
  return editor.openReview({
    id: `disk:${file.id}`,
    label: `${file.path} · Disk ↔ Room`,
    render(container, closeTab) {
      let mounted = true;
      const dialog = document.createElement('section');
      dialog.className = 'disk-review';
      dialog.setAttribute('aria-labelledby', 'conflict-heading');
      const heading = document.createElement('h2');
      heading.id = 'conflict-heading';
      heading.textContent = `Review disk changes: ${file.path}`;
      const help = document.createElement('p');
      help.textContent =
        'Compare current disk content (original) with the room snapshot (modified). Export the room version for a manual merge, then refresh this comparison. Reloading requires saving a recovery copy first. Accepting a disk version never writes to disk; use Save to project afterward.';
      const view = document.createElement('div');
      view.className = 'disk-diff';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const actions = document.createElement('div');
      actions.className = 'workspace-actions';
      let disposeDiff = () => {};
      let review: { content: string; token: string } | null = null;
      let room = '',
        busy = false;
      const button = (label: string, run: () => Promise<void>) => {
        const el = document.createElement('button');
        el.className = 'button secondary';
        el.textContent = label;
        el.onclick = async () => {
          if (busy || !options.allowed()) return;
          busy = true;
          refreshButtons();
          try {
            await run();
          } catch (error) {
            status.textContent = errorMessage(error);
          } finally {
            busy = false;
            if (mounted) refreshButtons();
          }
        };
        actions.append(el);
        return el;
      };
      const refresh = async () => {
        review = null;
        refreshButtons();
        const latest = await options.inspect();
        if (!mounted || !options.allowed()) return;
        review = latest;
        room = file.text!.toString();
        disposeDiff();
        disposeDiff = renderFileDiff(
          view,
          { code: latest.content, language: file.language },
          { code: room, language: file.language },
        );
        status.textContent =
          'Snapshot comparison. Refresh after editing or merging externally.';
      };
      const refreshButton = button('Refresh comparison', refresh);
      const exportButton = button('Export room version…', async () => {
        const result = await window.api.saveWorkspaceFile(
          file.path + '.room-copy',
          room,
        );
        if (mounted)
          status.textContent = result.canceled
            ? 'Export canceled.'
            : 'Room snapshot exported. Merge externally, then refresh.';
      });
      const reload = button('Export & reload disk into room…', async () => {
        if (!review) return;
        const current = review;
        if (room !== current.content) {
          const result = await window.api.saveWorkspaceFile(
            file.path + '.room-copy',
            room,
          );
          if (result.canceled) {
            status.textContent =
              'Reload canceled; both versions are unchanged.';
            return;
          }
        }
        if (!mounted || !options.allowed()) return;
        await options.accept(current.token, current.content, true, room);
        options.report(
          'Disk content loaded into the shared room. Previous room content was exported if different.',
        );
        closeTab();
      });
      const keep = button(
        'Keep room version & allow explicit save',
        async () => {
          if (!review) return;
          if (
            !window.confirm(
              'Keep the room version? The next Save to project will replace the reviewed disk version. Export or merge first if you need to keep both.',
            )
          )
            return;
          await options.accept(review.token, review.content, false, room);
          options.report(
            'Reviewed disk version accepted as the baseline. Room edits are retained. Use Save to project explicitly when ready.',
          );
          closeTab();
        },
      );
      const close = document.createElement('button');
      close.className = 'button secondary';
      close.textContent = 'Close';
      close.onclick = () => closeTab();
      actions.append(close);
      function refreshButtons() {
        refreshButton.disabled = busy;
        exportButton.disabled =
          reload.disabled =
          keep.disabled =
            busy || !review;
      }
      dialog.append(heading, help, view, status, actions);
      container.append(dialog);
      void refresh()
        .catch((error) => {
          status.textContent = errorMessage(error);
        })
        .finally(refreshButtons);
      return () => {
        mounted = false;
        disposeDiff();
        dialog.remove();
      };
    },
  });
}
