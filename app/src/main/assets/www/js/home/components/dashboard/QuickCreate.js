const QUICK_CREATE_CARDS = [
  {
    id: 'video',
    title: 'New Video',
    desc: 'Multi-track 4K & 120fps video edit',
    icon: 'bi-camera-reels',
    accent: '#00d4e5',
    action: 'quick-video'
  },
  {
    id: 'image',
    title: 'New Image Project',
    desc: 'Color grading, layers & motion stills',
    icon: 'bi-image',
    accent: '#818cf8',
    action: 'quick-image'
  },
  {
    id: 'canvas',
    title: 'New Canvas',
    desc: 'Blank spatial 3D & motion stage',
    icon: 'bi-aspect-ratio',
    accent: '#34d399',
    action: 'quick-canvas'
  },
  {
    id: 'import',
    title: 'Import Media',
    desc: 'Videos, photos, GIFs & audio stems',
    icon: 'bi-cloud-arrow-up',
    accent: '#fbbf24',
    action: 'quick-import'
  }
];

export function renderQuickCreate() {
  return `
    <section class="lk-section" aria-label="Quick Create">
      <div class="lk-section-head d-flex align-items-center justify-content-between mb-3">
        <h3 class="lk-section-title mb-0">Quick Create</h3>
        <span class="lk-section-hint">Instant workspace launch</span>
      </div>
      <div class="row g-3">
        ${QUICK_CREATE_CARDS.map((c) => `
          <div class="col-6 col-xl-3">
            <button type="button"
              class="lk-quick-card w-100 text-start"
              data-action="${c.action}"
              style="--lk-card-accent:${c.accent};">
              <div class="lk-quick-icon-wrap">
                <i class="bi ${c.icon}"></i>
              </div>
              <div class="lk-quick-title">${c.title}</div>
              <div class="lk-quick-desc">${c.desc}</div>
              <span class="lk-quick-arrow" aria-hidden="true"><i class="bi bi-arrow-up-right"></i></span>
            </button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
