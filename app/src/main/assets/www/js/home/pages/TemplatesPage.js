import { renderTemplatesSection } from '../components/templates/TemplatesGrid.js';

export function renderTemplatesPage(container, state) {
  if (!container) return;
  container.innerHTML = `
    <div class="lk-page-stack">
      <div class="lk-page-banner d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h2 class="lk-page-title mb-1">Templates</h2>
          <p class="lk-muted-xs mb-0">Start faster with curated motion presets for Reels, YouTube, Product Launches, and Cinema.</p>
        </div>
        <button type="button" class="btn lk-btn-primary btn-sm" data-action="open-new-project">
          <i class="bi bi-plus-lg me-1"></i>Blank Project
        </button>
      </div>

      ${renderTemplatesSection(state.templates, {
        showExploreAll: false,
        title: 'All Studio Templates',
        activeCategory: state.activeTemplateCategory || 'All'
      })}
    </div>
  `;
}
