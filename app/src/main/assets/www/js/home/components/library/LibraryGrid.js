import { escapeHtml } from '../../coreEngine.js';

export function renderLibraryGrid(categories, { activeCategory = null, previewItems = null, loadingCategory = null, compact = false } = {}) {
  const colsClass = compact ? 'col-6 col-md-3' : 'col-6 col-sm-4 col-lg-3';
  return `
    <section class="lk-section" aria-label="My Library">
      <div class="lk-section-head d-flex align-items-center justify-content-between mb-3">
        <div>
          <h3 class="lk-section-title mb-0">My Library</h3>
          <span class="lk-section-hint">Metadata-indexed · Lazy loaded on preview</span>
        </div>
        ${compact ? `
          <button type="button" class="lk-link-btn" data-nav="library">
            Browse Assets <i class="bi bi-chevron-right ms-1"></i>
          </button>
        ` : ''}
      </div>

      <div class="row g-3">
        ${categories.map((cat) => {
          const isOpen = activeCategory === cat.id;
          return `
            <div class="${colsClass}">
              <button type="button"
                class="lk-lib-card w-100 text-start ${isOpen ? 'active' : ''}"
                data-action="preview-library-cat"
                data-lib-cat="${escapeHtml(cat.id)}"
                style="--lk-lib-accent:${escapeHtml(cat.accent)};">
                <div class="d-flex align-items-center justify-content-between mb-2">
                  <span class="lk-lib-icon"><i class="bi ${escapeHtml(cat.icon)}"></i></span>
                  <span class="lk-lib-count">${cat.count}</span>
                </div>
                <div class="lk-lib-name">${escapeHtml(cat.name)}</div>
                <div class="lk-lib-desc">${escapeHtml(cat.desc)}</div>
              </button>
            </div>
          `;
        }).join('')}
      </div>

      ${activeCategory ? `
        <div class="lk-lib-preview-drawer mt-3" id="lkLibraryPreviewDrawer">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <div class="d-flex align-items-center gap-2">
              <span class="small fw-semibold text-info">
                ${escapeHtml(categories.find((c) => c.id === activeCategory)?.name || 'Category')} Preview
              </span>
              <span class="lk-count-pill">${Array.isArray(previewItems) ? previewItems.length : '…'}</span>
            </div>
            <button type="button" class="btn btn-sm lk-btn-secondary py-1 px-2" data-action="close-library-preview">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>

          ${loadingCategory === activeCategory ? `
            <div class="text-center py-4 lk-muted-xs">
              <span class="spinner-border spinner-border-sm text-info me-2" role="status"></span>
              Lazy-loading ${escapeHtml(activeCategory)} metadata...
            </div>
          ` : Array.isArray(previewItems) && previewItems.length > 0 ? `
            <div class="row g-2">
              ${previewItems.slice(0, compact ? 8 : 24).map((item) => `
                <div class="col-6 col-sm-4 col-md-3">
                  <button type="button"
                    class="lk-lib-item-chip w-100 text-start"
                    data-action="use-library-item"
                    data-lib-cat="${escapeHtml(activeCategory)}"
                    data-lib-item="${escapeHtml(item.id)}">
                    <span class="lk-lib-item-badge" style="color:${escapeHtml(item.color || '#00d4e5')};">
                      ${item.sample ? escapeHtml(item.sample) : `<i class="bi ${escapeHtml(item.icon || 'bi-sparkles')}"></i>`}
                    </span>
                    <span class="min-w-0 flex-grow-1">
                      <span class="d-block small fw-semibold text-truncate">${escapeHtml(item.label)}</span>
                      <span class="d-block lk-muted-2xs text-truncate">${escapeHtml(item.tag || '')}</span>
                    </span>
                  </button>
                </div>
              `).join('')}
            </div>
          ` : `<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 py-2">
                <span class="small lk-muted-xs">No imported items in this category yet.</span>
                <button type="button" class="btn btn-sm lk-btn-secondary" data-action="quick-import">
                  <i class="bi bi-cloud-arrow-up me-1"></i>Import Media
                </button>
              </div>`}
        </div>
      ` : ''}
    </section>
  `;
}
