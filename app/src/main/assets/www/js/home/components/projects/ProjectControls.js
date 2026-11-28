export function renderProjectControls({
  title = 'Recent Projects',
  totalCount = 0,
  viewMode = 'grid',
  sortBy = 'updatedAt',
  filterType = 'all',
  favoritesOnly = false,
  showViewAll = true,
  isTrash = false
}) {
  return `
    <div class="lk-section-head d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div class="d-flex align-items-center gap-2">
        <h3 class="lk-section-title mb-0">${title}</h3>
        <span class="lk-count-pill">${totalCount}</span>
      </div>

      <div class="d-flex flex-wrap align-items-center gap-2 ms-auto">
        ${!isTrash ? `
          <div class="lk-filter-pills d-flex align-items-center gap-1" role="group" aria-label="Filter by Project Type">
            ${[
              { id: 'all', label: 'All' },
              { id: 'video', label: 'Video' },
              { id: 'image', label: 'Image' },
              { id: 'canvas', label: 'Canvas' }
            ].map((t) => `
              <button type="button" class="lk-chip-btn ${filterType === t.id ? 'active' : ''}" data-proj-filter="${t.id}">
                ${t.label}
              </button>
            `).join('')}
          </div>

          <button type="button"
            class="lk-chip-btn ${favoritesOnly ? 'active is-fav' : ''}"
            data-action="toggle-fav-filter"
            title="Filter by Favorites"
            aria-pressed="${favoritesOnly ? 'true' : 'false'}">
            <i class="bi ${favoritesOnly ? 'bi-star-fill' : 'bi-star'} me-1"></i>Favorites
          </button>
        ` : `
          ${totalCount > 0 ? `
            <button type="button" class="btn btn-sm btn-outline-danger lk-btn-xs" data-action="empty-trash">
              <i class="bi bi-trash3 me-1"></i>Empty Trash
            </button>
          ` : ''}
        `}

        <select id="selProjectSort" class="lk-select-sm" aria-label="Sort projects">
          <option value="updatedAt" ${sortBy === 'updatedAt' ? 'selected' : ''}>Last Modified</option>
          <option value="createdAt" ${sortBy === 'createdAt' ? 'selected' : ''}>Created Date</option>
          <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name</option>
        </select>

        <div class="lk-view-switch" role="group" aria-label="Switch Grid or List View">
          <button type="button" class="lk-view-btn ${viewMode === 'grid' ? 'active' : ''}" data-view-mode="grid" title="Grid View" aria-label="Grid View">
            <i class="bi bi-grid-fill"></i>
          </button>
          <button type="button" class="lk-view-btn ${viewMode === 'list' ? 'active' : ''}" data-view-mode="list" title="List View" aria-label="List View">
            <i class="bi bi-list-ul"></i>
          </button>
        </div>

        ${showViewAll ? `
          <button type="button" class="lk-link-btn" data-nav="projects">
            View All Projects <i class="bi bi-chevron-right ms-1"></i>
          </button>
        ` : ''}
      </div>
    </div>
  `;
}
