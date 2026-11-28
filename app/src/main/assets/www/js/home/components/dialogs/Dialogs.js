import { escapeHtml, formatBytesShort } from '../../coreEngine.js';

function showModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap?.Modal) {
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap?.Modal) {
    window.bootstrap.Modal.getInstance(el)?.hide();
  }
}

export class HomeDialogs {
  constructor(app) {
    this.app = app;
    this._pendingDeleteAction = null;
    this._pendingRenameId = null;
    this._activeSettingsTab = 'general';
  }

  openNewProject(presetType = 'video') {
    const defRes = this.app.core.settings.general.defaultResolution || '1920x1080';
    const defFps = String(this.app.core.settings.general.defaultFps || 30);
    const titleEl = document.getElementById('inpLkNewName');
    const typeEl = document.getElementById('selLkNewType');
    const resEl = document.getElementById('selLkNewRes');
    const fpsEl = document.getElementById('selLkNewFps');
    const durEl = document.getElementById('inpLkNewDur');
    const folderEl = document.getElementById('inpLkNewFolder');

    if (titleEl) {
      titleEl.value = presetType === 'image'
        ? 'Untitled Image Design'
        : presetType === 'canvas'
          ? 'Untitled Motion Canvas'
          : 'Untitled Video Project';
    }
    if (typeEl) typeEl.value = presetType;
    if (resEl) {
      const target = presetType === 'image' ? '1080x1350' : defRes;
      if ([...resEl.options].some((o) => o.value === target)) resEl.value = target;
    }
    if (fpsEl) fpsEl.value = defFps;
    if (durEl) durEl.value = presetType === 'image' ? '6' : '15';
    if (folderEl) folderEl.value = 'My Projects';

    showModal('modalLkNewProject');
    setTimeout(() => titleEl?.select(), 120);
  }

  openRename(project) {
    if (!project) return;
    this._pendingRenameId = project.id;
    const inp = document.getElementById('inpLkRenameName');
    if (inp) inp.value = project.name || '';
    showModal('modalLkRename');
    setTimeout(() => inp?.select(), 120);
  }

  openConfirmDelete({ title, message, confirmLabel = 'Delete', onConfirm }) {
    this._pendingDeleteAction = onConfirm;
    const tEl = document.getElementById('lblLkConfirmTitle');
    const mEl = document.getElementById('lblLkConfirmMsg');
    const bEl = document.getElementById('btnLkConfirmDelete');
    if (tEl) tEl.textContent = title || 'Confirm Delete';
    if (mEl) mEl.textContent = message || 'Are you sure you want to continue?';
    if (bEl) bEl.textContent = confirmLabel;
    showModal('modalLkConfirmDelete');
  }

  openFolderInfo(info, project) {
    if (!info || !project) return;
    const body = document.getElementById('lkFolderModalBody');
    if (!body) return;
    body.innerHTML = `
      <div class="lk-info-box mb-3">
        <div class="lk-muted-2xs text-uppercase mb-1">Project</div>
        <div class="fw-semibold">${escapeHtml(project.name)}</div>
      </div>
      <div class="lk-info-box mb-3">
        <div class="lk-muted-2xs text-uppercase mb-1">Workspace Folder</div>
        <div class="small fw-semibold text-info"><i class="bi bi-folder2-open me-2"></i>${escapeHtml(info.folderName)}</div>
        <div class="lk-muted-xs font-monospace mt-1 text-break">${escapeHtml(info.virtualPath)}</div>
      </div>
      <div class="lk-info-box">
        <div class="lk-muted-2xs text-uppercase mb-1">Persistence Engine</div>
        <div class="lk-muted-xs">${escapeHtml(info.storageBackend)}</div>
      </div>
    `;
    const btnCopy = document.getElementById('btnLkCopyFolderPath');
    if (btnCopy) {
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard?.writeText(info.virtualPath);
          this.app.core.showToast('Path copied to clipboard', 'success');
        } catch {
          this.app.core.showToast(info.virtualPath, 'info');
        }
      };
    }
    const btnOpen = document.getElementById('btnLkOpenFromFolder');
    if (btnOpen) {
      btnOpen.onclick = () => {
        hideModal('modalLkFolder');
        this.app.openProjectInEditor(project.id);
      };
    }
    showModal('modalLkFolder');
  }

  openSettings(initialTab = 'general') {
    this._activeSettingsTab = initialTab;
    this._renderSettingsBody();
    showModal('modalLkSettings');
  }

  _renderSettingsBody() {
    const body = document.getElementById('lkSettingsModalBody');
    if (!body) return;
    const s = this.app.core.settings;
    const p = this.app.core.profile;
    const downloads = this.app.core.downloads;
    const tabs = [
      { id: 'general', label: 'General', icon: 'bi-sliders' },
      { id: 'appearance', label: 'Appearance', icon: 'bi-palette' },
      { id: 'performance', label: 'Performance', icon: 'bi-speedometer2' },
      { id: 'storage', label: 'Storage', icon: 'bi-hdd' },
      { id: 'cache', label: 'Cache Management', icon: 'bi-arrow-repeat' },
      { id: 'downloads', label: 'Download Manager', icon: 'bi-cloud-download' },
      { id: 'account', label: 'Account', icon: 'bi-person-badge' }
    ];

    let nativeStats = null;
    try {
      if (window.AndroidBridge?.getStorageStatsJson) {
        nativeStats = JSON.parse(window.AndroidBridge.getStorageStatsJson() || '{}');
      }
    } catch {}

    const activeTab = this._activeSettingsTab;
    let paneHtml = '';

    if (activeTab === 'general') {
      paneHtml = `
        <h6 class="fw-semibold mb-3">General Preferences</h6>
        <div class="row g-3">
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Default Resolution</label>
            <select class="form-select form-select-sm lk-input" data-setting="general.defaultResolution">
              ${['1920x1080', '1080x1920', '1280x720', '1080x1080', '1080x1350'].map((r) =>
                `<option value="${r}" ${s.general.defaultResolution === r ? 'selected' : ''}>${r}</option>`
              ).join('')}
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Default Frame Rate</label>
            <select class="form-select form-select-sm lk-input" data-setting="general.defaultFps" data-type="number">
              ${[24, 30, 60, 120].map((f) =>
                `<option value="${f}" ${Number(s.general.defaultFps) === f ? 'selected' : ''}>${f} FPS</option>`
              ).join('')}
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Autosave Interval (Seconds)</label>
            <select class="form-select form-select-sm lk-input" data-setting="general.autosaveSec" data-type="number">
              ${[5, 10, 30, 60].map((sec) =>
                `<option value="${sec}" ${Number(s.general.autosaveSec) === sec ? 'selected' : ''}>Every ${sec}s</option>`
              ).join('')}
            </select>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Interface Language</label>
            <select class="form-select form-select-sm lk-input" data-setting="general.language">
              <option value="en" ${s.general.language === 'en' ? 'selected' : ''}>English (Studio)</option>
              <option value="id" ${s.general.language === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
            </select>
          </div>
        </div>
      `;
    } else if (activeTab === 'appearance') {
      paneHtml = `
        <h6 class="fw-semibold mb-3">Appearance</h6>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Theme Mode</div>
            <div class="lk-muted-xs">Switch between Obsidian Dark and Studio Light</div>
          </div>
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn ${s.appearance.theme === 'dark' ? 'lk-btn-primary' : 'lk-btn-secondary'}" data-set-theme="dark">Dark</button>
            <button type="button" class="btn ${s.appearance.theme === 'light' ? 'lk-btn-primary' : 'lk-btn-secondary'}" data-set-theme="light">Light</button>
          </div>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Accent Color</div>
            <div class="lk-muted-xs">Primary highlight across buttons and active states</div>
          </div>
          <div class="d-flex gap-2">
            ${[
              { id: 'cyan', hex: '#00d4e5' },
              { id: 'indigo', hex: '#6366f1' },
              { id: 'emerald', hex: '#10b981' }
            ].map((a) => `
              <button type="button" class="lk-accent-dot ${s.appearance.accentColor === a.id ? 'active' : ''}" style="background:${a.hex};" data-set-accent="${a.id}" aria-label="${a.id} accent"></button>
            `).join('')}
          </div>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Compact Sidebar</div>
            <div class="lk-muted-xs">Use icon-only rail on desktop viewports</div>
          </div>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" data-setting="appearance.compactSidebar" ${s.appearance.compactSidebar ? 'checked' : ''} />
          </div>
        </div>
      `;
    } else if (activeTab === 'performance') {
      paneHtml = `
        <h6 class="fw-semibold mb-3">Performance &amp; Engine Isolation</h6>
        <div class="lk-info-box mb-3">
          <div class="small fw-semibold text-info"><i class="bi bi-shield-check me-2"></i>Home Engine Guard Active</div>
          <div class="lk-muted-xs mt-1">Video Engine, Audio Engine, and Rendering Engine are unloaded on the Home screen and load dynamically only when opening a project.</div>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Hardware Acceleration (WebGL / MediaCodec)</div>
            <div class="lk-muted-xs">Use GPU compositing during editor playback &amp; export</div>
          </div>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" data-setting="performance.hardwareAccel" ${s.performance.hardwareAccel ? 'checked' : ''} />
          </div>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Lazy Thumbnail Loading</div>
            <div class="lk-muted-xs">Decode project covers only as they enter the viewport</div>
          </div>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" data-setting="performance.lazyThumbnails" ${s.performance.lazyThumbnails ? 'checked' : ''} />
          </div>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Proxy Playback Quality</div>
            <div class="lk-muted-xs">Lower preview scale on mobile devices</div>
          </div>
          <select class="form-select form-select-sm lk-input w-auto" data-setting="performance.proxyMode">
            <option value="auto" ${s.performance.proxyMode === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="half" ${s.performance.proxyMode === 'half' ? 'selected' : ''}>1/2 Proxy</option>
            <option value="full" ${s.performance.proxyMode === 'full' ? 'selected' : ''}>Full Native</option>
          </select>
        </div>
      `;
    } else if (activeTab === 'storage') {
      const counts = this.app.projectManager.getCounts();
      const totalNative = nativeStats?.totalBytes ? formatBytesShort(nativeStats.totalBytes) : 'IndexedDB Local';
      paneHtml = `
        <h6 class="fw-semibold mb-3">Storage Overview</h6>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <div class="lk-info-box">
              <div class="lk-muted-2xs">ACTIVE PROJECTS</div>
              <div class="fs-5 fw-bold">${counts.all}</div>
            </div>
          </div>
          <div class="col-6">
            <div class="lk-info-box">
              <div class="lk-muted-2xs">MEDIA &amp; EXPORTS</div>
              <div class="fs-5 fw-bold">${escapeHtml(totalNative)}</div>
            </div>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label lk-muted-xs">Workspace Directory</label>
          <input type="text" class="form-control form-control-sm lk-input" data-setting="storage.workspacePath" value="${escapeHtml(s.storage.workspacePath)}" />
        </div>
        <button type="button" id="btnSettingsCleanupMedia" class="btn btn-sm lk-btn-secondary">
          <i class="bi bi-stars me-1 text-warning"></i>Cleanup Unused Native Files
        </button>
      `;
    } else if (activeTab === 'cache') {
      const metaBytes = (() => {
        try { return new Blob([localStorage.getItem('lukris_projects_meta_v1') || '']).size; } catch { return 0; }
      })();
      paneHtml = `
        <h6 class="fw-semibold mb-3">Cache Management</h6>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Asset Metadata Cache</div>
            <div class="lk-muted-xs">Cached category indices &amp; project cards (${formatBytesShort(metaBytes)})</div>
          </div>
          <button type="button" id="btnClearAssetCache" class="btn btn-sm lk-btn-secondary">Clear Cache</button>
        </div>
        <div class="lk-setting-row">
          <div>
            <div class="small fw-semibold">Render &amp; Thumbnail Buffers</div>
            <div class="lk-muted-xs">Max allocation limit: ${s.performance.maxCacheMb} MB</div>
          </div>
          <select class="form-select form-select-sm lk-input w-auto" data-setting="performance.maxCacheMb" data-type="number">
            ${[256, 512, 1024, 2048].map((mb) =>
              `<option value="${mb}" ${Number(s.performance.maxCacheMb) === mb ? 'selected' : ''}>${mb} MB</option>`
            ).join('')}
          </select>
        </div>
      `;
    } else if (activeTab === 'downloads') {
      paneHtml = `
        <h6 class="fw-semibold mb-3">Download Manager</h6>
        <div class="d-flex flex-column gap-2">
          ${Array.isArray(downloads) && downloads.length > 0 ? downloads.map((d) => `
            <div class="lk-info-box d-flex align-items-center justify-content-between gap-2">
              <div class="min-w-0">
                <div class="small fw-semibold text-truncate">${escapeHtml(d.name)}</div>
                <div class="lk-muted-xs">${escapeHtml(d.size)} · ${d.status === 'installed' ? 'Ready offline' : 'Available'}</div>
              </div>
              <button type="button" class="btn btn-sm ${d.status === 'installed' ? 'lk-btn-secondary' : 'lk-btn-primary'}" data-dl-toggle="${escapeHtml(d.id)}">
                ${d.status === 'installed' ? 'Installed' : 'Download'}
              </button>
            </div>
          `).join('') : `
            <div class="lk-info-box text-center py-4">
              <div class="small fw-semibold mb-1">No downloads yet</div>
              <div class="lk-muted-xs">Imported fonts and offline asset downloads will appear here.</div>
            </div>
          `}
        </div>
      `;
    } else if (activeTab === 'account') {
      paneHtml = `
        <h6 class="fw-semibold mb-3">Account &amp; Workspace Profile</h6>
        <div class="d-flex align-items-center gap-3 mb-3">
          <span class="lk-avatar-lg" style="--lk-avatar-bg:${escapeHtml(p.avatarColor)};">${escapeHtml(p.initials)}</span>
          <div>
            <div class="fw-semibold">${escapeHtml(p.name)}</div>
            <div class="lk-muted-xs">${escapeHtml(p.email)} · <span class="text-info">${escapeHtml(p.plan)}</span></div>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Display Name</label>
            <input type="text" id="inpSettingsProfileName" class="form-control form-control-sm lk-input" value="${escapeHtml(p.name)}" />
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label lk-muted-xs">Role / Studio Title</label>
            <input type="text" id="inpSettingsProfileRole" class="form-control form-control-sm lk-input" value="${escapeHtml(p.role)}" />
          </div>
        </div>
        <button type="button" id="btnSaveAccountProfile" class="btn btn-sm lk-btn-primary mt-3">Save Profile</button>
      `;
    }

    body.innerHTML = `
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <div class="lk-settings-nav d-flex flex-md-column gap-1 overflow-x-auto pb-1">
            ${tabs.map((t) => `
              <button type="button" class="lk-settings-tab ${activeTab === t.id ? 'active' : ''}" data-settings-tab="${t.id}">
                <i class="bi ${t.icon} me-2"></i><span>${t.label}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="col-12 col-md-8">
          <div class="lk-settings-pane">${paneHtml}</div>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.onclick = () => {
        this._activeSettingsTab = btn.dataset.settingsTab;
        this._renderSettingsBody();
      };
    });

    body.querySelectorAll('[data-setting]').forEach((el) => {
      el.onchange = () => {
        const path = el.dataset.setting.split('.');
        let val = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.type === 'number') val = Number(val);
        const patch = { [path[0]]: { [path[1]]: val } };
        this.app.core.updateSettings(patch);
        if (path[1] === 'compactSidebar') {
          this.app.refreshChrome();
        }
        this.app.core.showToast('Settings saved', 'success');
      };
    });

    body.querySelectorAll('[data-set-theme]').forEach((btn) => {
      btn.onclick = () => {
        this.app.core.updateSettings({ appearance: { theme: btn.dataset.setTheme } });
        this._renderSettingsBody();
      };
    });

    body.querySelectorAll('[data-set-accent]').forEach((btn) => {
      btn.onclick = () => {
        this.app.core.updateSettings({ appearance: { accentColor: btn.dataset.setAccent } });
        this._renderSettingsBody();
      };
    });

    body.querySelectorAll('[data-dl-toggle]').forEach((btn) => {
      btn.onclick = () => {
        this.app.core.toggleDownloadInstall(btn.dataset.dlToggle);
        this._renderSettingsBody();
        this.app.core.showToast('Download queue updated', 'info');
      };
    });

    body.querySelector('#btnSaveAccountProfile')?.addEventListener('click', () => {
      const name = body.querySelector('#inpSettingsProfileName')?.value?.trim();
      const role = body.querySelector('#inpSettingsProfileRole')?.value?.trim();
      if (name) {
        this.app.core.updateProfile({ name, role: role || p.role });
        this.app.refreshChrome();
        this._renderSettingsBody();
        this.app.core.showToast('Profile updated', 'success');
      }
    });

    body.querySelector('#btnClearAssetCache')?.addEventListener('click', () => {
      this.app.assetManager._catalogCache.clear();
      this.app.core.showToast('Asset & preview cache cleared', 'success');
    });

    body.querySelector('#btnSettingsCleanupMedia')?.addEventListener('click', () => {
      if (window.AndroidBridge?.cleanupUnusedNativeFiles) {
        try {
          const res = JSON.parse(window.AndroidBridge.cleanupUnusedNativeFiles('[]') || '{}');
          this.app.core.showToast(`Cleaned ${res.deletedCount || 0} unused files`, 'success');
          this._renderSettingsBody();
          return;
        } catch {}
      }
      this.app.core.showToast('Storage verified — no orphaned cache found', 'info');
    });
  }

  openProfile() {
    this.openSettings('account');
  }

  openHelp() {
    showModal('modalLkHelp');
  }

  openAiTool(tool) {
    if (!tool) return;
    const titleEl = document.getElementById('lblLkAiToolTitle');
    const bodyEl = document.getElementById('lkAiToolModalBody');
    if (!titleEl || !bodyEl) return;

    titleEl.innerHTML = `<i class="bi ${escapeHtml(tool.icon)} me-2" style="color:${escapeHtml(tool.accent)};"></i>${escapeHtml(tool.name)}`;
    const isTts = tool.id === 'tts';
    const isPromptTool = tool.id === 'ai_image' || tool.id === 'ai_video';

    bodyEl.innerHTML = `
      <p class="lk-muted-xs mb-3">${escapeHtml(tool.desc)}</p>
      <div class="lk-info-box mb-3">
        <div class="d-flex align-items-center justify-content-between mb-1">
          <span class="small fw-semibold">Modular Execution</span>
          <span class="badge bg-info bg-opacity-10 text-info border border-info-subtle">Lazy Loaded</span>
        </div>
        <div class="lk-muted-xs">This AI module initializes only on launch to keep the LUKRIS Home screen instantaneous.</div>
      </div>

      ${isTts ? `
        <div class="mb-3">
          <label class="form-label lk-muted-xs">Voice Script</label>
          <textarea id="txtLkAiTtsInput" rows="3" class="form-control form-control-sm lk-input" placeholder="Type voiceover script for LUKRIS..."></textarea>
        </div>
        <div class="mb-3">
          <label class="form-label lk-muted-xs">Voice Style</label>
          <select id="selLkAiTtsStyle" class="form-select form-select-sm lk-input">
            <option value="neutral">Studio Natural</option>
            <option value="deep">Deep Cinema</option>
            <option value="calm">Warm Calm</option>
            <option value="fast">Energetic Reel</option>
          </select>
        </div>
      ` : isPromptTool ? `
        <div class="mb-3">
          <label class="form-label lk-muted-xs">Creative Prompt</label>
          <textarea id="txtLkAiPrompt" rows="3" class="form-control form-control-sm lk-input" placeholder="Describe the scene, lighting, and camera motion..."></textarea>
        </div>
      ` : ''}

      <div class="d-flex justify-content-end gap-2">
        <button type="button" class="btn btn-sm lk-btn-secondary" data-bs-dismiss="modal">Close</button>
        ${isTts && window.AndroidBridge?.synthesizeTts ? `
          <button type="button" id="btnLkRunNativeTts" class="btn btn-sm lk-btn-secondary">
            <i class="bi bi-soundwave me-1 text-info"></i>Synthesize Audio
          </button>
        ` : ''}
        <button type="button" id="btnLkLaunchAiInStudio" class="btn btn-sm lk-btn-primary">
          <i class="bi bi-box-arrow-up-right me-1"></i>Open in Studio
        </button>
      </div>
    `;

    bodyEl.querySelector('#btnLkRunNativeTts')?.addEventListener('click', () => {
      const txt = bodyEl.querySelector('#txtLkAiTtsInput')?.value?.trim();
      const style = bodyEl.querySelector('#selLkAiTtsStyle')?.value || 'neutral';
      if (!txt) {
        this.app.core.showToast('Please enter a script first', 'danger');
        return;
      }
      window.AndroidBridge.synthesizeTts(txt, style);
      this.app.core.showToast('Synthesizing studio voiceover...', 'info');
    });

    bodyEl.querySelector('#btnLkLaunchAiInStudio')?.addEventListener('click', () => {
      hideModal('modalLkAiTool');
      this.app.launchEditorWithAiTool(tool.editorTool);
    });

    showModal('modalLkAiTool');
  }

  bindStaticModalListeners() {
    document.getElementById('btnLkCreateAndOpen')?.addEventListener('click', async () => {
      const name = document.getElementById('inpLkNewName')?.value?.trim() || 'Untitled Project';
      const projectType = document.getElementById('selLkNewType')?.value || 'video';
      const [width, height] = (document.getElementById('selLkNewRes')?.value || '1920x1080').split('x').map(Number);
      const fps = Number(document.getElementById('selLkNewFps')?.value) || 30;
      const durationSec = Math.max(2, Number(document.getElementById('inpLkNewDur')?.value) || 15);
      const folder = document.getElementById('inpLkNewFolder')?.value?.trim() || 'My Projects';

      hideModal('modalLkNewProject');
      const created = await this.app.projectManager.createProject({ name, projectType, width, height, fps, durationSec, folder });
      this.app.openProjectInEditor(created.id);
    });

    document.getElementById('btnLkCreateOnly')?.addEventListener('click', async () => {
      const name = document.getElementById('inpLkNewName')?.value?.trim() || 'Untitled Project';
      const projectType = document.getElementById('selLkNewType')?.value || 'video';
      const [width, height] = (document.getElementById('selLkNewRes')?.value || '1920x1080').split('x').map(Number);
      const fps = Number(document.getElementById('selLkNewFps')?.value) || 30;
      const durationSec = Math.max(2, Number(document.getElementById('inpLkNewDur')?.value) || 15);
      const folder = document.getElementById('inpLkNewFolder')?.value?.trim() || 'My Projects';

      hideModal('modalLkNewProject');
      await this.app.projectManager.createProject({ name, projectType, width, height, fps, durationSec, folder });
      this.app.core.showToast(`Created "${name}"`, 'success');
      this.app.refreshCurrentPage();
    });

    document.getElementById('btnLkSaveRename')?.addEventListener('click', async () => {
      const nextName = document.getElementById('inpLkRenameName')?.value?.trim();
      if (!nextName || !this._pendingRenameId) return;
      await this.app.projectManager.renameProject(this._pendingRenameId, nextName);
      this._pendingRenameId = null;
      hideModal('modalLkRename');
      this.app.core.showToast(`Renamed to "${nextName}"`, 'success');
      this.app.refreshCurrentPage();
    });

    document.getElementById('btnLkConfirmDelete')?.addEventListener('click', async () => {
      const fn = this._pendingDeleteAction;
      this._pendingDeleteAction = null;
      hideModal('modalLkConfirmDelete');
      if (typeof fn === 'function') await fn();
    });
  }
}
