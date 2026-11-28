import { renderHeroSection } from '../components/dashboard/HeroSection.js';
import { renderQuickCreate } from '../components/dashboard/QuickCreate.js';
import { renderProjectControls } from '../components/projects/ProjectControls.js';
import { mountProjectsList } from '../components/projects/ProjectList.js';
import { renderLibraryGrid } from '../components/library/LibraryGrid.js';
import { renderTemplatesSection } from '../components/templates/TemplatesGrid.js';
import { renderAiToolsSection } from '../components/ai-tools/AiToolsGrid.js';

export function renderHomePage(container, state) {
  if (!container) return;
  const {
    recentProjects,
    totalRecentCount,
    viewMode,
    sortBy,
    filterType,
    favoritesOnly,
    searchQuery,
    lazyThumbnails,
    libraryCategories,
    activeLibraryCategory,
    libraryPreviewItems,
    loadingLibraryCategory,
    templates,
    aiTools
  } = state;

  container.innerHTML = `
    <div class="lk-page-stack">
      ${renderHeroSection()}
      ${renderQuickCreate()}

      <section class="lk-section" aria-label="Recent Projects">
        ${renderProjectControls({
          title: 'Recent Projects',
          totalCount: totalRecentCount,
          viewMode,
          sortBy,
          filterType,
          favoritesOnly,
          showViewAll: true
        })}
        <div id="lkRecentProjectsContainer"></div>
      </section>

      ${renderLibraryGrid(libraryCategories, {
        activeCategory: activeLibraryCategory,
        previewItems: libraryPreviewItems,
        loadingCategory: loadingLibraryCategory,
        compact: true
      })}

      ${renderTemplatesSection(templates, {
        showExploreAll: true,
        title: 'Explore Templates'
      })}

      ${renderAiToolsSection(aiTools, { compact: true })}

      <footer class="lk-home-footer d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div class="lk-muted-xs">
          &copy; 2026 <strong>Lukris</strong> · LUKRIS Studio Video &amp; Motion Editor
        </div>
        <button type="button" id="btnHomeOpenCredits" class="btn btn-sm lk-btn-secondary" data-nav="credits">
          <i class="bi bi-c-circle me-1 text-info"></i>Hak Cipta &amp; Credit
        </button>
      </footer>
    </div>
  `;

  mountProjectsList(container.querySelector('#lkRecentProjectsContainer'), recentProjects, {
    viewMode,
    isTrash: false,
    lazyThumb: lazyThumbnails,
    favoritesOnly,
    hasSearch: Boolean(searchQuery || filterType !== 'all' || favoritesOnly)
  });
}
