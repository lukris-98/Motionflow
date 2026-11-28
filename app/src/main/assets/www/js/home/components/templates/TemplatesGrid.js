import { escapeHtml } from '../../coreEngine.js';

function buildTemplateThumbSvg(tpl) {
  const safeName = escapeHtml(tpl.name).slice(0, 20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 158">
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${tpl.accentA}"/>
        <stop offset="100%" stop-color="#090B10"/>
      </linearGradient>
    </defs>
    <rect width="280" height="158" fill="url(#tg)"/>
    <circle cx="220" cy="42" r="56" fill="${tpl.accentB}" fill-opacity="0.16"/>
    <rect x="22" y="22" width="110" height="72" rx="10" fill="rgba(255,255,255,0.04)" stroke="${tpl.accentB}" stroke-opacity="0.45" stroke-width="1.2"/>
    <path d="M24 114 C 90 80, 175 130, 256 64" fill="none" stroke="${tpl.accentB}" stroke-width="2" stroke-linecap="round"/>
    <text x="22" y="138" fill="#F8FAFC" font-family="system-ui,sans-serif" font-size="13" font-weight="700">${safeName}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function renderTemplatesSection(templates, { showExploreAll = true, title = 'Explore Templates', activeCategory = 'All' } = {}) {
  const categories = ['All', ...new Set(templates.map((t) => t.category))];
  const visible = activeCategory === 'All'
    ? templates
    : templates.filter((t) => t.category === activeCategory);

  return `
    <section class="lk-section" aria-label="Explore Templates">
      <div class="lk-section-head d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h3 class="lk-section-title mb-0">${escapeHtml(title)}</h3>
          <span class="lk-section-hint">Pro motion templates ready to customize</span>
        </div>

        <div class="d-flex flex-wrap align-items-center gap-2 ms-auto">
          ${!showExploreAll ? `
            <div class="lk-filter-pills d-flex flex-wrap gap-1">
              ${categories.map((cat) => `
                <button type="button" class="lk-chip-btn ${activeCategory === cat ? 'active' : ''}" data-tpl-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
              `).join('')}
            </div>
          ` : `
            <button type="button" class="lk-link-btn" data-nav="templates">
              Explore All <i class="bi bi-chevron-right ms-1"></i>
            </button>
          `}
        </div>
      </div>

      <div class="row g-3">
        ${visible.map((tpl) => `
          <div class="col-12 col-sm-6 col-lg-4">
            <article class="lk-template-card">
              <div class="lk-template-thumb-wrap" data-action="use-template" data-template-id="${escapeHtml(tpl.id)}" role="button" tabindex="0">
                <img class="lk-template-thumb" src="${buildTemplateThumbSvg(tpl)}" alt="${escapeHtml(tpl.name)}" loading="lazy" />
                <span class="lk-tpl-badge">${escapeHtml(tpl.badge)}</span>
                <span class="lk-tpl-ratio">${escapeHtml(tpl.aspectRatio)}</span>
                <span class="lk-tpl-use-overlay">
                  <span class="lk-tpl-use-pill"><i class="bi bi-play-fill me-1"></i>Use Template</span>
                </span>
              </div>
              <div class="lk-template-body d-flex align-items-center justify-content-between gap-2">
                <div class="min-w-0">
                  <div class="lk-project-title text-truncate">${escapeHtml(tpl.name)}</div>
                  <div class="lk-project-meta">
                    <span>${escapeHtml(tpl.category)}</span>
                    <span class="lk-meta-sep">·</span>
                    <span>${escapeHtml(tpl.duration)}</span>
                    <span class="lk-meta-sep">·</span>
                    <span>${escapeHtml(tpl.aspectRatio)}</span>
                  </div>
                </div>
                <button type="button"
                  class="btn btn-sm lk-btn-secondary flex-shrink-0"
                  data-action="use-template"
                  data-template-id="${escapeHtml(tpl.id)}">
                  Use
                </button>
              </div>
            </article>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
