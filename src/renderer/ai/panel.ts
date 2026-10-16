import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type * as Y from 'yjs';
import type {
  Room,
  RoomProvider,
  WorkspaceEditor,
} from '../../shared/contracts.js';
import { ANALYSIS_SECTIONS, validateAnalysis } from '../../shared/ai.js';
import type {
  EvidenceItem,
  AIStatus,
  AIResult,
  AnalysisSection,
} from '../../shared/ai.js';
import { button, errorMessage, setButtonVariant } from '../ui/dom.js';
import { collectEvidence, selectEvidence } from './context.js';
import { aiRequest } from './client.js';

export function initializeAI(
  doc: Y.Doc,
  provider: RoomProvider,
  room: Room,
  parent: HTMLElement,
  getEditor: () => WorkspaceEditor | null,
) {
  const launch = button('Catch me up', 'ai-catch-up', () => show());

  launch.classList.add('ai-launch');

  const disclosure = document.createElement('p');

  disclosure.className = 'panel-help';
  disclosure.id = 'ai-disclosure';
  disclosure.textContent =
    'Uses shared Problem details, history, snippets, and loaded code via OpenRouter.';
  launch.setAttribute('aria-describedby', disclosure.id);
  parent.append(launch, disclosure);

  const dialog = document.createElement('dialog');

  dialog.className = 'ai-dialog';
  dialog.setAttribute('aria-labelledby', 'ai-heading');

  const heading = document.createElement('h2');

  heading.id = 'ai-heading';
  heading.textContent = 'Catch me up';

  const destination = document.createElement('p');

  destination.className = 'panel-help';

  const status = document.createElement('p');

  status.setAttribute('role', 'status');

  const output = document.createElement('section');

  output.className = 'ai-result';
  output.setAttribute('aria-label', 'AI catch-up result');

  const sources = document.createElement('details');

  sources.className = 'ai-sources';
  sources.hidden = true;

  const sourcesTitle = document.createElement('summary');
  const sourceList = document.createElement('div');

  sourceList.className = 'ai-references';
  sources.append(sourcesTitle, sourceList);

  const refresh = button('Refresh catch-up', 'ai-refresh', () => {
    void run();
  });
  const close = button('Close', 'ai-close', () => dialog.close());
  const cancel = button('Cancel request', 'ai-cancel', () => {
    controller?.abort();
    status.textContent =
      'Request canceled. Provider usage may already have been incurred.';
  });
  const actions = document.createElement('div');

  actions.className = 'workspace-actions';
  setButtonVariant(launch, 'primary');
  setButtonVariant(refresh, 'primary');
  setButtonVariant(cancel, 'ghost');
  setButtonVariant(close, 'ghost');
  actions.append(refresh, cancel, close);
  dialog.append(heading, destination, status, actions, output, sources);
  document.body.append(dialog);

  let alive = true,
    denied = false,
    busy = false,
    stale = false,
    hasResult = false;
  let controller: AbortController | null = null;
  let sourceSignature = '';
  let previous: HTMLElement | null = null;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  const allowed = () => alive && !denied && provider.synced;

  function controls() {
    launch.disabled = !allowed();
    refresh.hidden = busy;
    refresh.disabled = !allowed() || busy;
    refresh.textContent = hasResult ? 'Refresh catch-up' : 'Try again';
    cancel.hidden = !busy;
  }

  function show() {
    if (!allowed()) return;

    previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!dialog.open) dialog.showModal();

    // Returning from a citation reuses the result. Changes are captured on refresh.
    if (!busy && !hasResult) void run();
  }

  function openEvidence(item: EvidenceItem, stamp: number) {
    dialog.close();
    getEditor()?.openReview({
      id: `ai:${stamp}:${item.id}`,
      label: `${item.label} · AI evidence · Read-only`,
      render(container) {
        const caption = document.createElement('p');

        caption.className = 'version-caption';
        caption.textContent = `${item.label} · Exact context sent at ${new Date(stamp).toLocaleString()}. Any omitted sections are marked in the text.`;

        const view = document.createElement('div');

        view.className = 'version-content';
        container.append(caption, view);

        const model = monaco.editor.createModel(item.content, 'plaintext');
        const editor = monaco.editor.create(view, {
          model,
          readOnly: true,
          domReadOnly: true,
          automaticLayout: true,
          theme: 'vs-dark',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        });

        return () => {
          editor.dispose();
          model.dispose();
        };
      },
    });
  }

  async function run() {
    if (!allowed() || busy) return;

    const requestController = new AbortController();

    controller = requestController;
    busy = true;
    hasResult = false;
    stale = false;
    sourceSignature = '';
    output.replaceChildren();
    sourceList.replaceChildren();
    sources.hidden = true;
    sources.open = false;
    destination.textContent =
      'Uses shared session context via OpenRouter and its serving provider.';
    status.textContent = 'Preparing your catch-up…';
    controls();

    try {
      const configuration = await aiRequest<AIStatus>(
        room,
        requestController.signal,
      );

      if (!allowed() || requestController.signal.aborted) return;

      if (!configuration.enabled)
        throw new Error(
          'AI is disabled on this server. Ask the administrator to configure OpenRouter.',
        );

      const all = collectEvidence(doc);

      if (!all.length)
        throw new Error(
          'Add a Problem, logs, or code before requesting a catch-up.',
        );

      const { evidence, omitted, excerpted } = selectEvidence(all);

      sourceSignature = JSON.stringify(all);

      const stamp = Date.now();

      destination.textContent = `OpenRouter · ${configuration.model} · Private to this window.`;
      sourcesTitle.textContent = `Context used · ${evidence.length} items${excerpted ? ` · ${excerpted} excerpted` : ''}${omitted ? ` · ${omitted} omitted for size` : ''}`;

      for (const item of evidence)
        sourceList.append(
          button(item.label, '', () => openEvidence(item, stamp)),
        );

      const result = await aiRequest<AIResult>(room, requestController.signal, {
        // Clicking Catch me up initiates the disclosed provider request.
        consent: true,
        model: configuration.model,
        evidence,
      });

      if (!allowed() || requestController.signal.aborted) return;

      const analysis = validateAnalysis(result.analysis, evidence);
      const renderSection = (key: AnalysisSection, target: HTMLElement) => {
        if (!analysis[key].length) return;

        const section = document.createElement('section');

        section.className = 'ai-summary-section';

        const heading = document.createElement('h3');

        heading.textContent = ANALYSIS_SECTIONS[key];

        const list = document.createElement(
          key === 'nextExperiments' ? 'ol' : 'ul',
        );

        for (const point of analysis[key]) {
          const item = document.createElement('li');
          const text = document.createElement('p');

          text.textContent = point.text;

          const citations = document.createElement('details');

          citations.className = 'ai-citations';

          const label = document.createElement('summary');

          label.textContent =
            point.evidenceIds.length === 1
              ? 'Source'
              : `Sources (${point.evidenceIds.length})`;

          const refs = document.createElement('div');

          refs.className = 'ai-references';

          for (const id of point.evidenceIds) {
            const evidenceItem = evidence.find((entry) => entry.id === id)!;

            refs.append(
              button(evidenceItem.label, '', () =>
                openEvidence(evidenceItem, stamp),
              ),
            );
          }

          citations.append(label, refs);
          item.append(text, citations);
          list.append(item);
        }

        section.append(heading, list);
        target.append(section);
      };

      renderSection('knownFacts', output);
      renderSection('nextExperiments', output);

      if (!analysis.knownFacts.length && !analysis.nextExperiments.length) {
        const empty = document.createElement('p');

        empty.textContent =
          'There isn’t enough evidence for a clear summary or next step yet.';
        output.append(empty);
      }

      const detailKeys: AnalysisSection[] = [
        'previousAttempts',
        'openQuestions',
        'hypotheses',
      ];

      if (detailKeys.some((key) => analysis[key].length)) {
        const details = document.createElement('details');

        details.className = 'ai-more-details';

        const label = document.createElement('summary');

        label.textContent = 'More details';
        details.append(label);

        for (const key of detailKeys) renderSection(key, details);

        output.append(details);
      }

      const meta = document.createElement('p');

      meta.className = 'panel-help';
      meta.textContent =
        'AI summary · Suggested causes and next steps need verification.';
      output.append(meta);
      stale = JSON.stringify(collectEvidence(doc)) !== sourceSignature;
      hasResult = true;
      sources.hidden = false;
      status.textContent = stale
        ? 'New session activity is available. Refresh catch-up for the latest context.'
        : '';
    } catch (error) {
      if (alive && !requestController.signal.aborted)
        status.textContent = errorMessage(error);
    } finally {
      if (controller === requestController) controller = null;

      busy = false;

      if (alive) controls();
    }
  }

  const onUpdate = () => {
    if (!sourceSignature) return;

    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      if (!alive) return;

      try {
        stale = JSON.stringify(collectEvidence(doc)) !== sourceSignature;
      } catch {
        stale = true;
      }

      if (stale && hasResult)
        status.textContent =
          'New session activity is available. Refresh catch-up for the latest context.';
    }, 250);
  };
  const onSync = () => {
    if (!provider.synced) {
      controller?.abort();

      if (busy)
        status.textContent =
          'Request canceled because the room disconnected. Reconnect and try again.';
    }

    controls();
  };

  dialog.addEventListener('close', () => {
    controller?.abort();

    if (busy) status.textContent = 'Request canceled.';

    previous?.focus();
  });
  doc.on('update', onUpdate);
  provider.on('sync', onSync);
  controls();

  const dispose = () => {
    alive = false;
    clearTimeout(updateTimer);
    controller?.abort();
    doc.off('update', onUpdate);
    provider.off('sync', onSync);

    if (dialog.open) dialog.close();

    dialog.remove();
    launch.remove();
    disclosure.remove();
  };

  dispose.show = show;
  dispose.setReadOnly = (value: boolean) => {
    denied = value;

    if (value) {
      controller?.abort();
      dialog.close();
      output.replaceChildren();
      sourceList.replaceChildren();
    }

    controls();
  };

  return dispose;
}
