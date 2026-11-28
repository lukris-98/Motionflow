import { escapeHtml } from '../../coreEngine.js';

export function renderAiToolsSection(tools, { compact = true } = {}) {
  return `
    <section class="lk-section" aria-label="AI Tools">
      <div class="lk-section-head d-flex align-items-center justify-content-between mb-3">
        <div>
          <h3 class="lk-section-title mb-0">AI Tools</h3>
          <span class="lk-section-hint">Modular intelligence · Loaded only when launched</span>
        </div>
        ${compact ? `
          <button type="button" class="lk-link-btn" data-nav="ai-tools">
            All AI Tools <i class="bi bi-chevron-right ms-1"></i>
          </button>
        ` : ''}
      </div>

      <div class="row g-3">
        ${tools.map((tool) => `
          <div class="col-12 col-sm-6 col-lg-4">
            <button type="button"
              class="lk-ai-card w-100 text-start"
              data-action="launch-ai-tool"
              data-ai-id="${escapeHtml(tool.id)}"
              style="--lk-ai-accent:${escapeHtml(tool.accent)};">
              <div class="d-flex align-items-start gap-3">
                <span class="lk-ai-icon-wrap flex-shrink-0">
                  <i class="bi ${escapeHtml(tool.icon)}"></i>
                </span>
                <div class="min-w-0 flex-grow-1">
                  <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
                    <span class="lk-ai-title text-truncate">${escapeHtml(tool.name)}</span>
                    <span class="lk-ai-tag">${escapeHtml(tool.tag)}</span>
                  </div>
                  <p class="lk-ai-desc mb-0">${escapeHtml(tool.desc)}</p>
                </div>
              </div>
            </button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
