import { renderAiToolsSection } from '../components/ai-tools/AiToolsGrid.js';

export function renderAiToolsPage(container, state) {
  if (!container) return;
  container.innerHTML = `
    <div class="lk-page-stack">
      <div class="lk-page-banner d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h2 class="lk-page-title mb-1">AI Studio Tools</h2>
          <p class="lk-muted-xs mb-0">Independent, modular AI workflows. Each tool initializes strictly on demand.</p>
        </div>
      </div>

      ${renderAiToolsSection(state.aiTools, { compact: false })}
    </div>
  `;
}
