export function renderHeroSection() {
  return `
    <section class="lk-hero-card" aria-label="Create New Project">
      <div class="lk-hero-glow" aria-hidden="true"></div>
      <div class="row align-items-center g-3 position-relative">
        <div class="col-12 col-lg-7">
          <div class="lk-hero-eyebrow mb-2">
            <span class="lk-eyebrow-dot"></span>
            <span>LUKRIS CREATIVE SUITE</span>
          </div>
          <h2 class="lk-hero-title mb-2">Bring Your Ideas to Life.</h2>
          <p class="lk-hero-subtitle mb-4">Create something extraordinary with Lukris.</p>
          <div class="d-flex flex-wrap align-items-center gap-2">
            <button type="button" id="btnHeroNewProject" class="btn lk-btn-primary" data-action="open-new-project">
              <i class="bi bi-plus-lg me-2"></i>New Project
            </button>
            <button type="button" id="btnHeroExploreTemplates" class="btn lk-btn-secondary" data-nav="templates">
              <i class="bi bi-grid-1x2 me-2"></i>Explore Templates
            </button>
          </div>
        </div>
        <div class="col-12 col-lg-5 d-none d-sm-flex justify-content-lg-end justify-content-center">
          <div class="lk-hero-illustration" aria-hidden="true">
            <svg viewBox="0 0 340 190" fill="none" xmlns="http://www.w3.org/2000/svg" class="lk-hero-svg">
              <defs>
                <linearGradient id="lkHeroFrameA" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#00D4E5" stop-opacity="0.32"/>
                  <stop offset="100%" stop-color="#6366F1" stop-opacity="0.06"/>
                </linearGradient>
                <linearGradient id="lkHeroWave" x1="0" y1="0" x2="340" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#00D4E5"/>
                  <stop offset="55%" stop-color="#38BDF8"/>
                  <stop offset="100%" stop-color="#818CF8"/>
                </linearGradient>
              </defs>
              <!-- Minimalist abstract overlapping motion frames -->
              <rect x="44" y="24" width="186" height="112" rx="14" fill="rgba(16,19,28,0.75)" stroke="rgba(255,255,255,0.12)" stroke-width="1.2"/>
              <rect x="92" y="42" width="198" height="120" rx="14" fill="url(#lkHeroFrameA)" stroke="rgba(0,212,229,0.38)" stroke-width="1.4"/>
              <!-- Precision aperture rings -->
              <circle cx="238" cy="86" r="28" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" stroke-dasharray="4 4"/>
              <circle cx="238" cy="86" r="14" fill="rgba(0,212,229,0.18)" stroke="#00D4E5" stroke-width="1.4"/>
              <!-- Bezier motion curve -->
              <path d="M22 146 C 95 146, 126 52, 198 86 C 242 106, 272 48, 318 44" stroke="url(#lkHeroWave)" stroke-width="2.2" stroke-linecap="round"/>
              <circle cx="122" cy="100" r="4.5" fill="#090B10" stroke="#00D4E5" stroke-width="2"/>
              <circle cx="198" cy="86" r="4.5" fill="#090B10" stroke="#818CF8" stroke-width="2"/>
              <circle cx="294" cy="48" r="3.5" fill="#00D4E5"/>
              <!-- Subtle keyframe diamond -->
              <rect x="155" y="138" width="9" height="9" rx="1.5" transform="rotate(45 159.5 142.5)" fill="#00D4E5" fill-opacity="0.85"/>
            </svg>
          </div>
        </div>
      </div>
    </section>
  `;
}
