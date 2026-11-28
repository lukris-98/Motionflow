import { renderProjectGridCard, renderProjectListRow } from './ProjectCard.js';

const VIRTUAL_BATCH_SIZE = 24;

export function renderProjectEmptyState({ isTrash = false, favoritesOnly = false, hasSearch = false } = {}) {
  const icon = isTrash
    ? 'bi-trash3'
    : favoritesOnly
      ? 'bi-star'
      : hasSearch
        ? 'bi-search'
        : 'bi-film';
  const title = isTrash
    ? 'Trash is empty'
    : favoritesOnly
      ? 'No favorite projects yet'
      : hasSearch
        ? 'No matching projects found'
        : 'No projects yet';
  const desc = isTrash
    ? 'Deleted projects will appear here so you can restore or remove them permanently.'
    : favoritesOnly
      ? 'Star any project from Recent Projects to pin it here for instant access.'
      : hasSearch
        ? 'Try a different keyword or clear the active filter.'
        : 'Start your first video, image design, or motion canvas in seconds.';

  return `
    <div class="lk-empty-state text-center">
      <div class="lk-empty-icon mx-auto mb-3"><i class="bi ${icon}"></i></div>
      <h4 class="lk-empty-title mb-1">${title}</h4>
      <p class="lk-empty-desc mb-3">${desc}</p>
      ${!isTrash && !hasSearch ? `
        <button type="button" class="btn lk-btn-primary btn-sm" data-action="open-new-project">
          <i class="bi bi-plus-lg me-1"></i>New Project
        </button>
      ` : hasSearch ? `
        <button type="button" class="btn lk-btn-secondary btn-sm" data-action="reset-project-filters">
          <i class="bi bi-arrow-counterclockwise me-1"></i>Reset Filters
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * Mounts projects with IntersectionObserver-backed lazy thumbnail loading
 * and incremental virtualized batch appending for large lists (> 24 items).
 */
export function mountProjectsList(container, projects, {
  viewMode = 'grid',
  isTrash = false,
  lazyThumb = true,
  favoritesOnly = false,
  hasSearch = false
} = {}) {
  if (!container) return;

  if (container._lkBatchObserver) {
    container._lkBatchObserver.disconnect();
    container._lkBatchObserver = null;
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    container.innerHTML = renderProjectEmptyState({ isTrash, favoritesOnly, hasSearch });
    return;
  }

  let renderedCount = Math.min(projects.length, VIRTUAL_BATCH_SIZE);
  const renderSlice = (slice) => {
    return slice.map((p) => (
      viewMode === 'list'
        ? renderProjectListRow(p, { isTrash, lazyThumb })
        : renderProjectGridCard(p, { isTrash, lazyThumb })
    )).join('');
  };

  const wrapperClass = viewMode === 'list' ? 'lk-projects-list-stack' : 'row g-3';
  container.innerHTML = `
    <div id="lkProjectsMountInner" class="${wrapperClass}">
      ${renderSlice(projects.slice(0, renderedCount))}
    </div>
    ${projects.length > renderedCount ? `
      <div id="lkProjectsSentinel" class="text-center py-3">
        <button type="button" class="btn lk-btn-secondary btn-sm" id="btnLoadMoreProjects">
          Load More (${projects.length - renderedCount} remaining)
        </button>
      </div>
    ` : ''}
  `;

  observeLazyThumbnails(container);

  const inner = container.querySelector('#lkProjectsMountInner');
  const sentinel = container.querySelector('#lkProjectsSentinel');

  const appendNextBatch = () => {
    if (!inner || renderedCount >= projects.length) return;
    const nextEnd = Math.min(projects.length, renderedCount + VIRTUAL_BATCH_SIZE);
    const fragHtml = renderSlice(projects.slice(renderedCount, nextEnd));
    inner.insertAdjacentHTML('beforeend', fragHtml);
    renderedCount = nextEnd;
    observeLazyThumbnails(inner);
    if (renderedCount >= projects.length && sentinel) {
      sentinel.remove();
    } else if (sentinel) {
      const btn = sentinel.querySelector('#btnLoadMoreProjects');
      if (btn) btn.textContent = `Load More (${projects.length - renderedCount} remaining)`;
    }
  };

  if (sentinel) {
    sentinel.querySelector('#btnLoadMoreProjects')?.addEventListener('click', appendNextBatch);
    if (typeof IntersectionObserver !== 'undefined') {
      const batchObs = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          appendNextBatch();
          if (renderedCount >= projects.length) {
            batchObs.disconnect();
            if (container._lkBatchObserver === batchObs) container._lkBatchObserver = null;
          }
        }
      }, { rootMargin: '160px' });
      container._lkBatchObserver = batchObs;
      batchObs.observe(sentinel);
    }
  }
}

let _thumbObserver = null;

export function observeLazyThumbnails(rootEl) {
  if (!rootEl) return;
  const imgs = rootEl.querySelectorAll('img[data-lazy-src]');
  if (imgs.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    imgs.forEach((img) => {
      img.src = img.dataset.lazySrc;
      img.removeAttribute('data-lazy-src');
      img.classList.remove('is-lazy');
    });
    return;
  }

  if (!_thumbObserver) {
    _thumbObserver = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        const src = img.dataset.lazySrc;
        if (src) {
          img.src = src;
          img.removeAttribute('data-lazy-src');
          img.classList.remove('is-lazy');
        }
        obs.unobserve(img);
      }
    }, { rootMargin: '120px' });
  }

  imgs.forEach((img) => _thumbObserver.observe(img));
}
