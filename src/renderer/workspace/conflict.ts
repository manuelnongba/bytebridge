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

      const legend = document.createElement('p');

      legend.className = 'disk-diff-legend';
      legend.textContent =
        'Room → Disk · − Red: removed from the room version · + Green: added on disk';

      help.textContent =
        'Keep disk version brings the reviewed file into the shared session, automatically saving the previous room version in History & checkpoints. Keep room version preserves shared edits; use Save to project when ready to write them to disk.';

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
        el.type = 'button';
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
          { code: room, language: file.language },
          { code: latest.content, language: file.language },
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
      const reload = button('Keep disk version', async () => {
        if (!review) return;

        const current = review;

        if (!mounted || !options.allowed()) return;
        await options.accept(current.token, current.content, true, room);
        options.report(
          room === current.content
            ? 'Disk and room versions already match. No recovery checkpoint was needed.'
            : 'Disk version kept. The previous room version is available in Problem → History & checkpoints.',
        );
        closeTab();
      });
      const keep = button('Keep room version', async () => {
        if (!review) return;
        if (
          !window.confirm(
            'Keep the room version? The next Save to project will replace the reviewed disk version. Export or merge first if you need to keep both.',
          )
        )
          return;
        await options.accept(review.token, review.content, false, room);
        options.report(
          'Room version kept. Use Save to project when ready to write it to disk.',
        );
        closeTab();
      });
      const close = document.createElement('button');

      close.type = 'button';
      close.className = 'button ghost';
      close.textContent = 'Close';
      close.onclick = () => closeTab();
      const tools = document.createElement('div');

      tools.className = 'workspace-actions';
      exportButton.className = refreshButton.className = 'button ghost';
      reload.title =
        'Use disk content in the shared session. The previous room version is checkpointed automatically.';
      keep.title =
        'Keep shared content. Saving to disk remains a separate action.';
      actions.replaceChildren(reload, keep);
      tools.append(exportButton, refreshButton, close);
      function refreshButtons() {
        refreshButton.disabled = busy;
        exportButton.disabled =
          reload.disabled =
          keep.disabled =
            busy || !review;
      }
      dialog.append(heading, help, legend, view, status, actions, tools);
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
