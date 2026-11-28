import { renderProjectControls } from '../components/projects/ProjectControls.js';
import { mountProjectsList } from '../components/projects/ProjectList.js';

export function renderProjectsPage(container, state) {
  if (!container) return;
  const {
    projects,
    viewMode,
    sortBy,
    filterType,
    favoritesOnly,
    searchQuery,
    lazyThumbnails,
    mode // 'projects' | 'favorites' | 'trash'
  } = state;

  const isTrash = mode === 'trash';
  const isFavPage = mode === 'favorites';
  const title = isTrash ? 'Trash' : isFavPage ? 'Favorite Projects' : 'All Projects';

  container.innerHTML = `
    <div class="lk-page-stack">
      <div class="lk-page-banner d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h2 class="lk-page-title mb-1">${title}</h2>
          <p class="lk-muted-xs mb-0">
            ${isTrash
              ? 'Restore deleted projects or remove them permanently from local storage.'
              : isFavPage
                ? 'Quick access to your starred and pinned studio projects.'
                : 'Manage, sort, filter, and organize every project in your Lukris workspace.'}
          </p>
        </div>
        ${!isTrash ? `
          <button type="button" class="btn lk-btn-primary btn-sm" data-action="open-new-project">
            <i class="bi bi-plus-lg me-1"></i>New Project
          </button>
        ` : ''}
      </div>

      <section class="lk-section">
        ${renderProjectControls({
          title,
          totalCount: projects.length,
          viewMode,
          sortBy,
          filterType,
          favoritesOnly: isFavPage ? true : favoritesOnly,
          showViewAll: false,
          isTrash
        })}
        <div id="lkAllProjectsContainer"></div>
      </section>
    </div>
  `;

  mountProjectsList(container.querySelector('#lkAllProjectsContainer'), projects, {
    viewMode,
    isTrash,
    lazyThumb: lazyThumbnails,
    favoritesOnly: isFavPage || favoritesOnly,
    hasSearch: Boolean(searchQuery || filterType !== 'all' || favoritesOnly)
  });
}
