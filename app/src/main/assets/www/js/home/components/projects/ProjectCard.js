import {
  escapeHtml,
  formatDurationCompact,
  formatRelativeTime,
  formatResolutionLabel
} from '../../coreEngine.js';

const TYPE_META = {
  video: { label: 'Video', icon: 'bi-camera-reels' },
  image: { label: 'Image', icon: 'bi-image' },
  canvas: { label: 'Canvas', icon: 'bi-aspect-ratio' }
};

function buildMenuHtml(p, isTrash) {
  const id = escapeHtml(p.id);
  if (isTrash) {
    return `
      <ul class="dropdown-menu dropdown-menu-end lk-dropdown-panel">
        <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="restore" data-proj-id="${id}"><i class="bi bi-arrow-counterclockwise me-2 text-info"></i>Restore Project</button></li>
        <li><hr class="dropdown-divider lk-border-hairline my-1"></li>
        <li><button type="button" class="dropdown-item lk-menu-item text-danger" data-proj-act="delete-forever" data-proj-id="${id}"><i class="bi bi-trash3 me-2"></i>Delete Permanently</button></li>
      </ul>
    `;
  }
  return `
    <ul class="dropdown-menu dropdown-menu-end lk-dropdown-panel">
      <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="open" data-proj-id="${id}"><i class="bi bi-play-circle me-2 text-info"></i>Open</button></li>
      <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="rename" data-proj-id="${id}"><i class="bi bi-pencil me-2"></i>Rename</button></li>
      <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="duplicate" data-proj-id="${id}"><i class="bi bi-copy me-2"></i>Duplicate</button></li>
      <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="favorite" data-proj-id="${id}"><i class="bi ${p.favorite ? 'bi-star-fill text-warning' : 'bi-star'} me-2"></i>${p.favorite ? 'Remove Favorite' : 'Add to Favorites'}</button></li>
      <li><button type="button" class="dropdown-item lk-menu-item" data-proj-act="folder" data-proj-id="${id}"><i class="bi bi-folder2 me-2"></i>Show in Folder</button></li>
      <li><hr class="dropdown-divider lk-border-hairline my-1"></li>
      <li><button type="button" class="dropdown-item lk-menu-item text-danger" data-proj-act="delete" data-proj-id="${id}"><i class="bi bi-trash3 me-2"></i>Delete</button></li>
    </ul>
  `;
}

export function renderProjectGridCard(p, { isTrash = false, lazyThumb = true } = {}) {
  const id = escapeHtml(p.id);
  const name = escapeHtml(p.name || 'Untitled Project');
  const res = formatResolutionLabel(p.width, p.height);
  const dur = formatDurationCompact(p.durationSec || 10);
  const modified = formatRelativeTime(p.updatedAt);
  const tMeta = TYPE_META[p.projectType] || TYPE_META.video;
  const thumbSrc = escapeHtml(p.coverDataUrl || '');

  return `
    <div class="col-12 col-sm-6 col-lg-4 col-xl-3">
      <article class="lk-project-card" data-proj-id="${id}">
        <div class="lk-project-thumb-wrap" data-proj-act="${isTrash ? 'restore' : 'open'}" data-proj-id="${id}" role="button" tabindex="0" aria-label="Open ${name}">
          ${thumbSrc
            ? (lazyThumb
                ? `<img class="lk-project-thumb is-lazy" data-lazy-src="${thumbSrc}" alt="${name}" loading="lazy" />`
                : `<img class="lk-project-thumb" src="${thumbSrc}" alt="${name}" loading="lazy" />`)
            : `<div class="lk-project-thumb-fallback"><i class="bi ${tMeta.icon}"></i></div>`
          }
          <span class="lk-thumb-badge-type"><i class="bi ${tMeta.icon} me-1"></i>${tMeta.label}</span>
          <span class="lk-thumb-badge-dur">${dur}</span>
          ${!isTrash ? `
            <button type="button"
              class="lk-thumb-fav-btn ${p.favorite ? 'is-fav' : ''}"
              data-proj-act="favorite"
              data-proj-id="${id}"
              title="${p.favorite ? 'Remove from Favorites' : 'Add to Favorites'}"
              aria-label="Toggle Favorite">
              <i class="bi ${p.favorite ? 'bi-star-fill' : 'bi-star'}"></i>
            </button>
          ` : ''}
        </div>

        <div class="lk-project-body d-flex align-items-start justify-content-between gap-2">
          <div class="min-w-0 flex-grow-1" data-proj-act="${isTrash ? 'restore' : 'open'}" data-proj-id="${id}" role="button">
            <div class="lk-project-title text-truncate">${name}</div>
            <div class="lk-project-meta">
              <span>${modified}</span>
              <span class="lk-meta-sep">·</span>
              <span>${res}</span>
            </div>
          </div>

          <div class="dropdown flex-shrink-0">
            <button type="button"
              class="lk-dots-btn"
              data-bs-toggle="dropdown"
              aria-expanded="false"
              aria-label="Project options for ${name}"
              title="More Options">
              <i class="bi bi-three-dots-vertical"></i>
            </button>
            ${buildMenuHtml(p, isTrash)}
          </div>
        </div>
      </article>
    </div>
  `;
}

export function renderProjectListRow(p, { isTrash = false, lazyThumb = true } = {}) {
  const id = escapeHtml(p.id);
  const name = escapeHtml(p.name || 'Untitled Project');
  const res = formatResolutionLabel(p.width, p.height);
  const dur = formatDurationCompact(p.durationSec || 10);
  const modified = formatRelativeTime(p.updatedAt);
  const tMeta = TYPE_META[p.projectType] || TYPE_META.video;
  const thumbSrc = escapeHtml(p.coverDataUrl || '');

  return `
    <article class="lk-project-row" data-proj-id="${id}">
      <div class="lk-row-thumb-wrap" data-proj-act="${isTrash ? 'restore' : 'open'}" data-proj-id="${id}" role="button">
        ${thumbSrc
          ? (lazyThumb
              ? `<img class="lk-project-thumb is-lazy" data-lazy-src="${thumbSrc}" alt="${name}" loading="lazy" />`
              : `<img class="lk-project-thumb" src="${thumbSrc}" alt="${name}" loading="lazy" />`)
          : `<div class="lk-project-thumb-fallback"><i class="bi ${tMeta.icon}"></i></div>`
        }
      </div>

      <div class="min-w-0 flex-grow-1" data-proj-act="${isTrash ? 'restore' : 'open'}" data-proj-id="${id}" role="button">
        <div class="d-flex align-items-center gap-2">
          <span class="lk-project-title text-truncate">${name}</span>
          <span class="lk-row-type-pill"><i class="bi ${tMeta.icon} me-1"></i>${tMeta.label}</span>
        </div>
        <div class="lk-project-meta mt-1">
          <span>Modified ${modified}</span>
          <span class="lk-meta-sep">·</span>
          <span>${res}</span>
          <span class="lk-meta-sep">·</span>
          <span>${dur}</span>
        </div>
      </div>

      <div class="d-flex align-items-center gap-1 flex-shrink-0">
        ${!isTrash ? `
          <button type="button"
            class="lk-dots-btn ${p.favorite ? 'text-warning' : ''}"
            data-proj-act="favorite"
            data-proj-id="${id}"
            title="${p.favorite ? 'Remove from Favorites' : 'Add to Favorites'}"
            aria-label="Toggle Favorite">
            <i class="bi ${p.favorite ? 'bi-star-fill' : 'bi-star'}"></i>
          </button>
        ` : ''}
        <div class="dropdown">
          <button type="button"
            class="lk-dots-btn"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            aria-label="Project options for ${name}"
            title="More Options">
            <i class="bi bi-three-dots-vertical"></i>
          </button>
          ${buildMenuHtml(p, isTrash)}
        </div>
      </div>
    </article>
  `;
}
