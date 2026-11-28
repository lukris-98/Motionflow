/**
 * LUKRIS Home Module Coordinator
 * Strictly loads ONLY CoreEngine, ProjectManager, AssetMetadataManager, and Home UI.
 * Secondary pages & library category previews are dynamically imported on demand.
 * Video Engine, Audio Engine, and Rendering Engine are NEVER loaded here.
 */

import { CoreEngine, debounce } from './coreEngine.js';
import { ProjectManager } from './projectManager.js';
import { AssetMetadataManager } from './assetMetadataManager.js';
import { renderSidebar, renderMobileBottomNav } from './components/sidebar/Sidebar.js';
import { renderTopHeader } from './components/header/TopHeader.js';
import { renderHomePage } from './pages/HomePage.js';
import { HomeDialogs } from './components/dialogs/Dialogs.js';

export class LukrisHomeApp {
  constructor() {
    this.core = new CoreEngine();
    this.projectManager = new ProjectManager();
    this.assetManager = new AssetMetadataManager();
    this.dialogs = new HomeDialogs(this);

    this.state = {
      activeRoute: 'home', // 'home' | 'projects' | 'templates' | 'library' | 'ai-tools' | 'favorites' | 'trash'
      searchQuery: '',
      viewMode: this._loadPref('lukris_view_mode', 'grid'),
      sortBy: this._loadPref('lukris_sort_by', 'updatedAt'),
      filterType: 'all',
      favoritesOnly: false,
      activeLibraryCategory: null,
      libraryPreviewItems: null,
      loadingLibraryCategory: null,
      activeTemplateCategory: 'All'
    };

    this._pageRenderSeq = 0;
  }

  _loadPref(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  _savePref(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  }

  async init() {
    await this.projectManager.init();
    await this.assetManager.refreshDynamicCounts();
    try {
      const reqPage = new URLSearchParams(window.location.search || '').get('page');
      if (reqPage === 'credits') this.state.activeRoute = 'credits';
    } catch {}
    this.dialogs.bindStaticModalListeners();
    this._bindDelegatedEvents();
    this._bindNativeBridge();
    this._bindKeyboardShortcuts();

    this.refreshChrome();
    await this.refreshCurrentPage();
  }

  refreshChrome() {
    const counts = this.projectManager.getCounts();
    const sidebarEl = document.getElementById('lkSidebar');
    const drawerSidebarEl = document.getElementById('lkMobileDrawerBody');
    const mobileBottomEl = document.getElementById('lkMobileBottomNav');
    const headerEl = document.getElementById('lkTopHeader');
    const collapsed = Boolean(this.core.settings.appearance.compactSidebar);

    const sidebarProps = {
      activeRoute: this.state.activeRoute,
      counts,
      profile: this.core.profile,
      collapsed
    };

    renderSidebar(sidebarEl, sidebarProps);
    if (drawerSidebarEl) renderSidebar(drawerSidebarEl, { ...sidebarProps, collapsed: false });
    renderMobileBottomNav(mobileBottomEl, { activeRoute: this.state.activeRoute });
    renderTopHeader(headerEl, {
      searchQuery: this.state.searchQuery,
      unreadCount: this.core.getUnreadNotificationsCount(),
      notifications: this.core.notifications,
      profile: this.core.profile
    });

    this._wireHeaderSearch();
  }

  _wireHeaderSearch() {
    const inp = document.getElementById('inpHeaderSearch');
    const clearBtn = document.getElementById('btnClearHeaderSearch');
    const kbdEl = document.getElementById('kbdHeaderSearch');
    if (inp) {
      const onDebouncedSearch = debounce((val) => {
        this.state.searchQuery = val;
        this.refreshCurrentPage();
      }, 200);
      inp.addEventListener('input', (e) => {
        const val = e.target.value;
        clearBtn?.classList.toggle('d-none', !val);
        kbdEl?.classList.toggle('d-lg-inline-flex', !val);
        onDebouncedSearch(val);
      });
    }
    if (clearBtn) {
      clearBtn.onclick = () => {
        this.state.searchQuery = '';
        if (inp) inp.value = '';
        this.refreshChrome();
        this.refreshCurrentPage();
      };
    }
    document.getElementById('btnMarkAllNotifsRead')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.core.markAllNotificationsRead();
      this.refreshChrome();
      this.core.showToast('All notifications marked read', 'info');
    });
    document.getElementById('btnMobileMenu')?.addEventListener('click', () => {
      const drawer = document.getElementById('lkMobileDrawer');
      if (drawer && window.bootstrap?.Offcanvas) {
        window.bootstrap.Offcanvas.getOrCreateInstance(drawer).show();
      }
    });
  }

  async navigateTo(route) {
    const valid = ['home', 'projects', 'templates', 'library', 'ai-tools', 'favorites', 'trash', 'credits'];
    const target = valid.includes(route) ? route : 'home';
    if (this.state.activeRoute === target) {
      this._hideMobileDrawer();
      return;
    }
    this.state.activeRoute = target;
    this.state.activeLibraryCategory = null;
    this.state.libraryPreviewItems = null;
    this._hideMobileDrawer();
    this.refreshChrome();
    await this.refreshCurrentPage();
    document.getElementById('lkMainScroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  _hideMobileDrawer() {
    const drawer = document.getElementById('lkMobileDrawer');
    if (drawer?.classList.contains('show') && window.bootstrap?.Offcanvas) {
      window.bootstrap.Offcanvas.getInstance(drawer)?.hide();
    }
  }

  async refreshCurrentPage() {
    const seq = ++this._pageRenderSeq;
    const mountEl = document.getElementById('lkMainContent');
    if (!mountEl) return;

    const lazyThumbnails = Boolean(this.core.settings.performance.lazyThumbnails);
    const route = this.state.activeRoute;

    if (route === 'home') {
      const allActive = this.projectManager.queryProjects({
        search: this.state.searchQuery,
        sortBy: this.state.sortBy,
        filterType: this.state.filterType,
        favoritesOnly: this.state.favoritesOnly,
        onlyTrashed: false
      });
      renderHomePage(mountEl, {
        recentProjects: allActive.slice(0, 8),
        totalRecentCount: allActive.length,
        viewMode: this.state.viewMode,
        sortBy: this.state.sortBy,
        filterType: this.state.filterType,
        favoritesOnly: this.state.favoritesOnly,
        searchQuery: this.state.searchQuery,
        lazyThumbnails,
        libraryCategories: this.assetManager.getCategoriesSummary(),
        activeLibraryCategory: this.state.activeLibraryCategory,
        libraryPreviewItems: this.state.libraryPreviewItems,
        loadingLibraryCategory: this.state.loadingLibraryCategory,
        templates: this.assetManager.getTemplatesSummary(3),
        aiTools: this.assetManager.getAiToolsSummary()
      });
      return;
    }

    if (route === 'projects' || route === 'favorites' || route === 'trash') {
      const { renderProjectsPage } = await import('./pages/ProjectsPage.js');
      if (seq !== this._pageRenderSeq) return;
      const projects = this.projectManager.queryProjects({
        search: this.state.searchQuery,
        sortBy: this.state.sortBy,
        filterType: this.state.filterType,
        favoritesOnly: route === 'favorites' ? true : this.state.favoritesOnly,
        onlyTrashed: route === 'trash'
      });
      renderProjectsPage(mountEl, {
        projects,
        viewMode: this.state.viewMode,
        sortBy: this.state.sortBy,
        filterType: this.state.filterType,
        favoritesOnly: this.state.favoritesOnly,
        searchQuery: this.state.searchQuery,
        lazyThumbnails,
        mode: route
      });
      return;
    }

    if (route === 'library') {
      const { renderLibraryPage } = await import('./pages/LibraryPage.js');
      if (seq !== this._pageRenderSeq) return;
      renderLibraryPage(mountEl, {
        libraryCategories: this.assetManager.getCategoriesSummary(),
        activeLibraryCategory: this.state.activeLibraryCategory,
        libraryPreviewItems: this.state.libraryPreviewItems,
        loadingLibraryCategory: this.state.loadingLibraryCategory
      });
      return;
    }

    if (route === 'templates') {
      const { renderTemplatesPage } = await import('./pages/TemplatesPage.js');
      if (seq !== this._pageRenderSeq) return;
      renderTemplatesPage(mountEl, {
        templates: this.assetManager.getTemplatesSummary(),
        activeTemplateCategory: this.state.activeTemplateCategory
      });
      return;
    }

    if (route === 'ai-tools') {
      const { renderAiToolsPage } = await import('./pages/AiToolsPage.js');
      if (seq !== this._pageRenderSeq) return;
      renderAiToolsPage(mountEl, {
        aiTools: this.assetManager.getAiToolsSummary()
      });
      return;
    }

    if (route === 'credits') {
      const { renderCreditsPage } = await import('./pages/CreditsPage.js');
      if (seq !== this._pageRenderSeq) return;
      renderCreditsPage(mountEl);
    }
  }

  _bindDelegatedEvents() {
    document.addEventListener('click', async (e) => {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        e.preventDefault();
        await this.navigateTo(navBtn.dataset.nav);
        return;
      }

      if (e.target.closest('#btnToggleSidebarCollapse')) {
        const cur = Boolean(this.core.settings.appearance.compactSidebar);
        this.core.updateSettings({ appearance: { compactSidebar: !cur } });
        this.refreshChrome();
        return;
      }

      const viewBtn = e.target.closest('[data-view-mode]');
      if (viewBtn) {
        this.state.viewMode = viewBtn.dataset.viewMode === 'list' ? 'list' : 'grid';
        this._savePref('lukris_view_mode', this.state.viewMode);
        await this.refreshCurrentPage();
        return;
      }

      const filterBtn = e.target.closest('[data-proj-filter]');
      if (filterBtn) {
        this.state.filterType = filterBtn.dataset.projFilter || 'all';
        await this.refreshCurrentPage();
        return;
      }

      const tplCatBtn = e.target.closest('[data-tpl-cat]');
      if (tplCatBtn) {
        this.state.activeTemplateCategory = tplCatBtn.dataset.tplCat || 'All';
        await this.refreshCurrentPage();
        return;
      }

      const projActBtn = e.target.closest('[data-proj-act]');
      if (projActBtn) {
        e.stopPropagation();
        const act = projActBtn.dataset.projAct;
        const id = projActBtn.dataset.projId;
        await this._handleProjectAction(act, id);
        return;
      }

      const actBtn = e.target.closest('[data-action]');
      if (actBtn) {
        const action = actBtn.dataset.action;
        await this._handleGlobalAction(action, actBtn);
      }
    });

    document.addEventListener('change', async (e) => {
      if (e.target?.id === 'selProjectSort') {
        this.state.sortBy = e.target.value || 'updatedAt';
        this._savePref('lukris_sort_by', this.state.sortBy);
        await this.refreshCurrentPage();
      }
    });

    document.getElementById('inpLkWebImportMedia')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      if (files.length === 0) return;
      const items = files.map((f) => ({
        id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        type: f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image',
        mimeType: f.type,
        url: URL.createObjectURL(f),
        thumbUrl: '',
        width: 1280,
        height: 720,
        durationMs: 5000,
        sizeBytes: f.size
      }));
      await this.projectManager.saveImportedMediaItems(items);
      e.target.value = '';
      this.core.showToast(`Imported ${items.length} media file(s) — launching editor`, 'success');
      window.location.href = './editor.html?importMedia=1';
    });
  }

  async _handleProjectAction(act, id) {
    const project = this.projectManager.getById(id);
    if (!project) return;

    switch (act) {
      case 'open':
        this.openProjectInEditor(id);
        break;
      case 'rename':
        this.dialogs.openRename(project);
        break;
      case 'duplicate': {
        const copy = await this.projectManager.duplicateProject(id);
        this.refreshChrome();
        await this.refreshCurrentPage();
        if (copy) this.core.showToast(`Duplicated "${copy.name}"`, 'success');
        break;
      }
      case 'favorite': {
        const updated = await this.projectManager.toggleFavorite(id);
        this.refreshChrome();
        await this.refreshCurrentPage();
        if (updated) {
          this.core.showToast(
            updated.favorite ? 'Added to Favorites' : 'Removed from Favorites',
            'info'
          );
        }
        break;
      }
      case 'folder': {
        const info = this.projectManager.getFolderLocationInfo(id);
        this.dialogs.openFolderInfo(info, project);
        break;
      }
      case 'delete':
        this.dialogs.openConfirmDelete({
          title: 'Move Project to Trash?',
          message: `"${project.name}" will be moved to Trash. You can restore it anytime.`,
          confirmLabel: 'Move to Trash',
          onConfirm: async () => {
            await this.projectManager.moveToTrash(id);
            this.refreshChrome();
            await this.refreshCurrentPage();
            this.core.showToast(`Moved "${project.name}" to Trash`, 'info');
          }
        });
        break;
      case 'restore':
        await this.projectManager.restoreFromTrash(id);
        this.refreshChrome();
        await this.refreshCurrentPage();
        this.core.showToast(`Restored "${project.name}"`, 'success');
        break;
      case 'delete-forever':
        this.dialogs.openConfirmDelete({
          title: 'Delete Permanently?',
          message: `Permanently delete "${project.name}"? This action cannot be undone.`,
          confirmLabel: 'Delete Permanently',
          onConfirm: async () => {
            await this.projectManager.deletePermanently(id);
            this.refreshChrome();
            await this.refreshCurrentPage();
            this.core.showToast('Project permanently deleted', 'danger');
          }
        });
        break;
    }
  }

  async _handleGlobalAction(action, el) {
    switch (action) {
      case 'open-new-project':
        this.dialogs.openNewProject('video');
        break;
      case 'quick-video':
        this.dialogs.openNewProject('video');
        break;
      case 'quick-image':
        this.dialogs.openNewProject('image');
        break;
      case 'quick-canvas':
        this.dialogs.openNewProject('canvas');
        break;
      case 'quick-import':
        this.triggerMediaImport();
        break;
      case 'toggle-fav-filter':
        this.state.favoritesOnly = !this.state.favoritesOnly;
        await this.refreshCurrentPage();
        break;
      case 'reset-project-filters':
        this.state.searchQuery = '';
        this.state.filterType = 'all';
        this.state.favoritesOnly = false;
        this.refreshChrome();
        await this.refreshCurrentPage();
        break;
      case 'empty-trash': {
        const trashCount = this.projectManager.getCounts().trash;
        if (trashCount === 0) return;
        this.dialogs.openConfirmDelete({
          title: 'Empty Trash?',
          message: `Permanently delete all ${trashCount} project(s) in Trash?`,
          confirmLabel: 'Empty Trash',
          onConfirm: async () => {
            await this.projectManager.emptyTrash();
            this.refreshChrome();
            await this.refreshCurrentPage();
            this.core.showToast('Trash emptied', 'info');
          }
        });
        break;
      }
      case 'preview-library-cat': {
        const catId = el.dataset.libCat;
        if (!catId) return;
        if (this.state.activeLibraryCategory === catId) {
          this.state.activeLibraryCategory = null;
          this.state.libraryPreviewItems = null;
          await this.refreshCurrentPage();
          return;
        }
        this.state.activeLibraryCategory = catId;
        this.state.loadingLibraryCategory = catId;
        this.state.libraryPreviewItems = null;
        await this.refreshCurrentPage();

        const items = await this.assetManager.loadCategoryItems(catId);
        if (this.state.activeLibraryCategory === catId) {
          this.state.loadingLibraryCategory = null;
          this.state.libraryPreviewItems = items;
          await this.refreshCurrentPage();
        }
        break;
      }
      case 'close-library-preview':
        this.state.activeLibraryCategory = null;
        this.state.libraryPreviewItems = null;
        await this.refreshCurrentPage();
        break;
      case 'use-library-item': {
        const catId = el.dataset.libCat;
        this.core.showToast(`Selected ${catId} asset — opening Studio Editor`, 'info');
        const created = await this.projectManager.createProject({
          name: 'Asset Studio Project',
          projectType: 'video',
          width: 1920,
          height: 1080,
          fps: this.core.settings.general.defaultFps || 30,
          durationSec: 12
        });
        this.openProjectInEditor(created.id);
        break;
      }
      case 'use-template': {
        const tplId = el.dataset.templateId;
        const tpl = this.assetManager.getTemplatesSummary().find((t) => t.id === tplId);
        if (!tpl) return;
        const [w, h] = tpl.resolution.split('×').map(Number);
        const created = await this.projectManager.createProject({
          name: tpl.name,
          projectType: 'video',
          width: w || 1920,
          height: h || 1080,
          fps: this.core.settings.general.defaultFps || 30,
          durationSec: 15,
          folder: 'Templates'
        });
        window.location.href = `./editor.html?projectId=${encodeURIComponent(created.id)}&template=${encodeURIComponent(tpl.engineTemplateId || 'flashBeat')}`;
        break;
      }
      case 'launch-ai-tool': {
        const aiId = el.dataset.aiId;
        const tool = this.assetManager.getAiToolsSummary().find((t) => t.id === aiId);
        this.dialogs.openAiTool(tool);
        break;
      }
      case 'open-settings':
        this._hideMobileDrawer();
        this.dialogs.openSettings('general');
        break;
      case 'open-profile':
        this._hideMobileDrawer();
        this.dialogs.openProfile();
        break;
      case 'open-help':
        this._hideMobileDrawer();
        this.dialogs.openHelp();
        break;
    }
  }

  openProjectInEditor(projectId) {
    if (!projectId) return;
    window.location.href = `./editor.html?projectId=${encodeURIComponent(projectId)}`;
  }

  launchEditorWithAiTool(editorTool) {
    window.location.href = `./editor.html?aiTool=${encodeURIComponent(editorTool || 'effects')}`;
  }

  triggerMediaImport() {
    if (window.AndroidBridge?.pickVisualMedia) {
      window.AndroidBridge.pickVisualMedia('all');
      return;
    }
    const inp = document.getElementById('inpLkWebImportMedia');
    if (inp) {
      inp.value = '';
      inp.click();
    }
  }

  _bindNativeBridge() {
    window.__mfNative = {
      handleBack: () => {
        const openModal = document.querySelector('.modal.show');
        if (openModal && window.bootstrap?.Modal) {
          window.bootstrap.Modal.getInstance(openModal)?.hide();
          return true;
        }
        const openDrawer = document.querySelector('.offcanvas.show');
        if (openDrawer && window.bootstrap?.Offcanvas) {
          window.bootstrap.Offcanvas.getInstance(openDrawer)?.hide();
          return true;
        }
        if (this.state.activeRoute !== 'home') {
          this.navigateTo('home');
          return true;
        }
        return false;
      },
      onMediaImportStarted: (count) => {
        this.core.showToast(`Importing ${count} file(s)...`, 'info');
      },
      onMediaImported: async (items) => {
        if (!Array.isArray(items) || items.length === 0) return;
        await this.projectManager.saveImportedMediaItems(items);
        this.core.showToast(`Imported ${items.length} media file(s)`, 'success');
        window.location.href = './editor.html?importMedia=1';
      },
      onTtsState: (state, msg) => {
        if (state === 'done') this.core.showToast(msg || 'Voiceover saved to Media Library', 'success');
        else if (state === 'error') this.core.showToast(msg || 'TTS error', 'danger');
      }
    };
  }

  _bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        document.getElementById('inpHeaderSearch')?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.dialogs.openNewProject('video');
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new LukrisHomeApp();
  app.init();
});
