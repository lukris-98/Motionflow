import { renderLibraryGrid } from '../components/library/LibraryGrid.js';

export function renderLibraryPage(container, state) {
  if (!container) return;
  container.innerHTML = `
    <div class="lk-page-stack">
      <div class="lk-page-banner d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h2 class="lk-page-title mb-1">My Assets</h2>
          <p class="lk-muted-xs mb-0">Select any category to lazy-load asset previews without slowing down your dashboard.</p>
        </div>
        <button type="button" class="btn lk-btn-primary btn-sm" data-action="quick-import">
          <i class="bi bi-cloud-arrow-up me-1"></i>Import Media
        </button>
      </div>

      ${renderLibraryGrid(state.libraryCategories, {
        activeCategory: state.activeLibraryCategory,
        previewItems: state.libraryPreviewItems,
        loadingCategory: state.loadingLibraryCategory,
        compact: false
      })}
    </div>
  `;
}
