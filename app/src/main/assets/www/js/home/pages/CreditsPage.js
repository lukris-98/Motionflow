export function renderCreditsPage(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="lk-page-stack">
      <div class="lk-page-banner d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div class="d-flex align-items-center gap-3">
          <button type="button" id="btnCreditsBackHome" class="btn lk-btn-secondary btn-sm" data-nav="home">
            <i class="bi bi-arrow-left me-1"></i>Kembali ke Home
          </button>
          <div>
            <h2 class="lk-page-title mb-0">Hak Cipta &amp; Credit</h2>
            <p class="lk-muted-xs mb-0">Informasi resmi kepemilikan cipta &amp; pengembang LUKRIS</p>
          </div>
        </div>
        <span class="lk-credits-badge"><i class="bi bi-patch-check-fill me-1"></i>Official Build</span>
      </div>

      <section class="lk-credits-hero" aria-label="Lukris Copyright Credit">
        <div class="lk-credits-glow" aria-hidden="true"></div>
        <div class="position-relative d-flex flex-column flex-md-row align-items-start align-items-md-center gap-4">
          <div class="lk-credits-emblem flex-shrink-0" aria-hidden="true">
            <img src="./assets/lukris-logo.png" alt="LUKRIS Logo" width="60" height="60" class="lk-credits-logo-img" />
          </div>

          <div class="flex-grow-1 min-w-0">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
              <span class="lk-hero-pill mb-0"><i class="bi bi-c-circle me-1"></i>Hak Cipta Terdaftar</span>
              <span class="lk-count-pill">Versi 1.0 · Up to 120 FPS</span>
            </div>
            <h3 class="lk-hero-title mb-2" style="font-size: clamp(1.35rem, 2.6vw, 1.9rem);">
              LUKRIS Studio — Dibuat oleh Lukris
            </h3>
            <p class="lk-hero-subtitle mb-3" style="max-width: 640px;">
              <strong>&copy; 2026 Lukris. All Rights Reserved.</strong><br/>
              Seluruh desain antarmuka, arsitektur aplikasi, sistem timeline, animasi keyframe &amp; kamera 3D, serta pipeline rendering &amp; ekspor merupakan karya cipta asli buatan <strong>Lukris</strong>.
            </p>
            <div class="d-flex flex-wrap gap-2">
              <button type="button" class="btn lk-btn-primary btn-sm" data-nav="home">
                <i class="bi bi-house-door me-1"></i>Beranda Home
              </button>
              <button type="button" class="btn lk-btn-secondary btn-sm" data-nav="projects">
                <i class="bi bi-folder2-open me-1"></i>Pilih Project
              </button>
              <button type="button" class="btn lk-btn-secondary btn-sm" data-action="open-new-project">
                <i class="bi bi-plus-lg me-1"></i>Buat Project Baru
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="row g-3">
        <div class="col-12 col-md-6">
          <div class="lk-credits-card h-100">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="lk-notif-ic"><i class="bi bi-person-workspace"></i></span>
              <h4 class="small fw-bold mb-0">Kredit Pencipta &amp; Pengembang</h4>
            </div>
            <div class="lk-info-box mb-2">
              <div class="lk-muted-2xs text-uppercase">Creator &amp; Lead Developer</div>
              <div class="small fw-bold mt-1">Lukris</div>
              <div class="lk-muted-xs">Konsep Produk, UI/UX Design, Engine Editing &amp; Integrasi Android</div>
            </div>
            <div class="lk-info-box">
              <div class="lk-muted-2xs text-uppercase">Pernyataan Hak Cipta</div>
              <div class="lk-muted-xs mt-1">
                Dilarang menggandakan, mendistribusikan ulang, atau mengklaim karya cipta LUKRIS tanpa izin tertulis dari pemilik hak cipta (<strong>Lukris</strong>).
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-md-6">
          <div class="lk-credits-card h-100">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="lk-notif-ic"><i class="bi bi-cpu"></i></span>
              <h4 class="small fw-bold mb-0">Teknologi &amp; Lisensi Komponen</h4>
            </div>
            <div class="d-flex flex-column gap-2">
              <div class="lk-info-box d-flex align-items-center justify-content-between gap-2">
                <div>
                  <div class="small fw-semibold">LUKRIS Core &amp; Render Engine</div>
                  <div class="lk-muted-2xs">Timeline, Keyframe, 3D Camera &amp; 120 FPS Pipeline</div>
                </div>
                <span class="lk-ai-tag">&copy; Lukris</span>
              </div>
              <div class="lk-info-box d-flex align-items-center justify-content-between gap-2">
                <div>
                  <div class="small fw-semibold">Android MediaCodec &amp; WebGL2</div>
                  <div class="lk-muted-2xs">Hardware-accelerated H.264/AAC MP4 export</div>
                </div>
                <span class="lk-ai-tag">Platform API</span>
              </div>
              <div class="lk-info-box d-flex align-items-center justify-content-between gap-2">
                <div>
                  <div class="small fw-semibold">Bootstrap 5 &amp; Bootstrap Icons</div>
                  <div class="lk-muted-2xs">Komponen UI responsif &amp; ikonografi sistem</div>
                </div>
                <span class="lk-ai-tag">MIT License</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
