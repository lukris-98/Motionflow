/**
 * LUKRIS Project Manager (Home Screen Data Layer)
 * Uses localStorage for instant zero-lag dashboard rendering and
 * ProjectStorage (IndexedDB) for full project persistence when opening editor.
 * Zero Video/Audio/Rendering engine imports.
 */

import { ProjectStorage, createEmptyProject } from '../storage/projectStorage.js';
import { deepClone, uid } from '../utils/math.js';

const META_STORAGE_KEY = 'lukris_projects_meta_v1';
const PURGED_DUMMY_KEY = 'lukris_purged_dummy_v1';
const LEGACY_DUMMY_NAMES = new Set([
  'Neon Cyber Reel 2026',
  'Product Launch Teaser',
  'Minimalist Poster Keyframe',
  'LUKRIS Motion Intro',
  'LUKRIS Demo',
  'MotionFlow Demo'
]);

function buildSvgCover(title, badge, c1, c2, aspectW = 16, aspectH = 9) {
  const safeTitle = String(title || 'LUKRIS').replace(/[<>&"']/g, '').slice(0, 22);
  const safeBadge = String(badge || 'PRO').replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="glow" cx="78%" cy="22%" r="55%">
        <stop offset="0%" stop-color="rgba(0,212,229,0.34)"/>
        <stop offset="100%" stop-color="rgba(0,212,229,0)"/>
      </radialGradient>
    </defs>
    <rect width="320" height="180" fill="url(#bg)"/>
    <rect width="320" height="180" fill="url(#glow)"/>
    <circle cx="256" cy="44" r="46" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
    <path d="M20 140 Q 95 75, 165 118 T 300 62" fill="none" stroke="rgba(0,212,229,0.55)" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="20" y="20" width="54" height="20" rx="6" fill="rgba(10,14,22,0.68)" stroke="rgba(255,255,255,0.16)"/>
    <text x="47" y="34" fill="#E2E8F0" font-family="system-ui,sans-serif" font-size="10" font-weight="700" text-anchor="middle">${safeBadge}</text>
    <text x="20" y="156" fill="#F8FAFC" font-family="system-ui,sans-serif" font-size="15" font-weight="700" letter-spacing="-0.2">${safeTitle}</text>
    <text x="300" y="156" fill="rgba(226,232,240,0.65)" font-family="system-ui,sans-serif" font-size="10" font-weight="600" text-anchor="end">${aspectW}:${aspectH}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export class ProjectManager {
  constructor() {
    this.projects = [];
    this._loaded = false;
  }

  _readLocalMeta() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(META_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeLocalMeta(list) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(META_STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  _toMeta(proj) {
    const fps = Math.max(1, Number(proj.fps) || 30);
    const durationFrames = Math.max(1, Number(proj.durationFrames) || fps * 10);
    const maxLayerEnd = Array.isArray(proj.layers)
      ? proj.layers.reduce((m, l) => Math.max(m, Number(l?.endFrame) || 0), 0)
      : 0;
    const effFrames = maxLayerEnd > 0 ? maxLayerEnd : durationFrames;
    const w = Number(proj.width) || 1280;
    const h = Number(proj.height) || 720;
    return {
      id: proj.id,
      name: proj.name || 'Untitled Project',
      projectType: proj.projectType || 'video',
      width: w,
      height: h,
      fps,
      durationFrames: effFrames,
      durationSec: Math.max(1, Number(proj.durationSec) || Math.round(effFrames / fps)),
      layerCount: Array.isArray(proj.layers) ? proj.layers.length : (proj.layerCount || 0),
      favorite: Boolean(proj.favorite),
      deletedAt: proj.deletedAt || null,
      folder: proj.folder || 'My Projects',
      coverDataUrl: proj.coverDataUrl || buildSvgCover(proj.name, proj.projectType?.toUpperCase() || 'PRO', '#111827', '#1E293B', w >= h ? 16 : 9, w >= h ? 9 : 16),
      backgroundColor: proj.backgroundColor || '#05070B',
      createdAt: proj.createdAt || Date.now(),
      updatedAt: proj.updatedAt || Date.now()
    };
  }

  loadCachedSync() {
    let localMeta = this._readLocalMeta();
    const needsDummyPurge = typeof localStorage === 'undefined' || localStorage.getItem(PURGED_DUMMY_KEY) !== '1';
    if (needsDummyPurge) {
      localMeta = localMeta.filter((m) => m && !LEGACY_DUMMY_NAMES.has(m.name));
      this._writeLocalMeta(localMeta);
    }
    this.projects = localMeta;
    this._loaded = true;
    return this.projects;
  }

  async init() {
    let localMeta = this.loadCachedSync();
    const needsDummyPurge = typeof localStorage === 'undefined' || localStorage.getItem(PURGED_DUMMY_KEY) !== '1';

    // Reconcile with IndexedDB if available (browser/WebView)
    if (typeof indexedDB !== 'undefined') {
      try {
        const dbProjects = await ProjectStorage.listProjects();
        const keptDbProjects = [];
        for (const dbp of dbProjects) {
          if (needsDummyPurge && LEGACY_DUMMY_NAMES.has(dbp.name)) {
            try { await ProjectStorage.deleteProject(dbp.id); } catch {}
            continue;
          }
          keptDbProjects.push(dbp);
        }

        if (keptDbProjects.length > 0) {
          const metaMap = new Map(localMeta.map((m) => [m.id, m]));
          for (const dbp of keptDbProjects) {
            const existing = metaMap.get(dbp.id);
            const merged = {
              ...this._toMeta(dbp),
              favorite: dbp.favorite ?? existing?.favorite ?? false,
              deletedAt: dbp.deletedAt ?? existing?.deletedAt ?? null,
              projectType: dbp.projectType || existing?.projectType || 'video',
              folder: dbp.folder || existing?.folder || 'My Projects',
              coverDataUrl: dbp.coverDataUrl || existing?.coverDataUrl || this._toMeta(dbp).coverDataUrl
            };
            metaMap.set(dbp.id, merged);
          }
          localMeta = [...metaMap.values()];
          this._writeLocalMeta(localMeta);
        }
      } catch (e) {
        console.warn('IndexedDB sync skipped:', e);
      }
    }

    if (typeof localStorage !== 'undefined' && needsDummyPurge) {
      try {
        localStorage.removeItem('lukris_seeded_v1');
        localStorage.setItem(PURGED_DUMMY_KEY, '1');
      } catch {}
    }

    this.projects = localMeta;
    this._loaded = true;
    return this.projects;
  }

  getCounts() {
    const active = this.projects.filter((p) => !p.deletedAt);
    return {
      all: active.length,
      favorites: active.filter((p) => p.favorite).length,
      trash: this.projects.filter((p) => Boolean(p.deletedAt)).length
    };
  }

  queryProjects({
    search = '',
    sortBy = 'updatedAt',
    filterType = 'all',
    favoritesOnly = false,
    onlyTrashed = false,
    limit = null
  } = {}) {
    const q = String(search || '').trim().toLowerCase();
    let list = this.projects.filter((p) => {
      const isTrashed = Boolean(p.deletedAt);
      if (onlyTrashed) return isTrashed;
      if (isTrashed) return false;
      if (favoritesOnly && !p.favorite) return false;
      if (filterType && filterType !== 'all' && (p.projectType || 'video') !== filterType) return false;
      if (q) {
        const hay = `${p.name} ${p.folder || ''} ${p.projectType || ''} ${p.width}x${p.height}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === 'name') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sortBy === 'createdAt') {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    if (typeof limit === 'number' && limit > 0) {
      return list.slice(0, limit);
    }
    return list;
  }

  getById(id) {
    return this.projects.find((p) => p.id === id) || null;
  }

  async createProject({
    name = 'Untitled Project',
    projectType = 'video',
    width = 1920,
    height = 1080,
    fps = 30,
    durationSec = 10,
    folder = 'My Projects'
  } = {}) {
    const cleanName = String(name || 'Untitled Project').trim() || 'Untitled Project';
    const badge = projectType === 'image' ? 'IMAGE' : projectType === 'canvas' ? 'CANVAS' : `${fps} FPS`;
    const cover = buildSvgCover(
      cleanName,
      badge,
      projectType === 'image' ? '#171321' : projectType === 'canvas' ? '#0F172A' : '#0B1524',
      projectType === 'image' ? '#2B1B42' : projectType === 'canvas' ? '#1D2B44' : '#12293D',
      width >= height ? 16 : 9,
      width >= height ? 9 : 16
    );

    const proj = createEmptyProject(cleanName, {
      projectType,
      width: Number(width) || 1920,
      height: Number(height) || 1080,
      fps: Number(fps) || 30,
      durationSec: Number(durationSec) || 10,
      folder,
      coverDataUrl: cover
    });

    if (typeof indexedDB !== 'undefined') {
      try { await ProjectStorage.saveProject(proj); } catch {}
    }

    const meta = this._toMeta(proj);
    this.projects = [meta, ...this.projects.filter((p) => p.id !== meta.id)];
    this._writeLocalMeta(this.projects);
    return meta;
  }

  async renameProject(id, newName) {
    const clean = String(newName || '').trim();
    if (!clean) return null;
    const now = Date.now();
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, name: clean, updatedAt: now } : p));
    this._writeLocalMeta(this.projects);

    if (typeof indexedDB !== 'undefined') {
      try {
        const full = await ProjectStorage.getProject(id);
        if (full) {
          full.name = clean;
          full.updatedAt = now;
          await ProjectStorage.saveProject(full);
        }
      } catch {}
    }
    return this.getById(id);
  }

  async duplicateProject(id) {
    const srcMeta = this.getById(id);
    if (!srcMeta) return null;
    const newId = uid('proj');
    const now = Date.now();
    const copyName = `${srcMeta.name} (Copy)`;

    if (typeof indexedDB !== 'undefined') {
      try {
        const full = await ProjectStorage.getProject(id);
        if (full) {
          const clone = deepClone(full);
          clone.id = newId;
          clone.name = copyName;
          clone.createdAt = now;
          clone.updatedAt = now;
          clone.deletedAt = null;
          await ProjectStorage.saveProject(clone);
        }
      } catch {}
    }

    const copyMeta = {
      ...srcMeta,
      id: newId,
      name: copyName,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.projects = [copyMeta, ...this.projects];
    this._writeLocalMeta(this.projects);
    return copyMeta;
  }

  async toggleFavorite(id) {
    const target = this.getById(id);
    if (!target) return null;
    const nextFav = !target.favorite;
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, favorite: nextFav } : p));
    this._writeLocalMeta(this.projects);

    if (typeof indexedDB !== 'undefined') {
      try {
        const full = await ProjectStorage.getProject(id);
        if (full) {
          full.favorite = nextFav;
          await ProjectStorage.saveProject(full);
        }
      } catch {}
    }
    return this.getById(id);
  }

  async moveToTrash(id) {
    const now = Date.now();
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, deletedAt: now } : p));
    this._writeLocalMeta(this.projects);

    if (typeof indexedDB !== 'undefined') {
      try {
        const full = await ProjectStorage.getProject(id);
        if (full) {
          full.deletedAt = now;
          await ProjectStorage.saveProject(full);
        }
      } catch {}
    }
  }

  async restoreFromTrash(id) {
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, deletedAt: null } : p));
    this._writeLocalMeta(this.projects);

    if (typeof indexedDB !== 'undefined') {
      try {
        const full = await ProjectStorage.getProject(id);
        if (full) {
          full.deletedAt = null;
          await ProjectStorage.saveProject(full);
        }
      } catch {}
    }
  }

  async deletePermanently(id) {
    this.projects = this.projects.filter((p) => p.id !== id);
    this._writeLocalMeta(this.projects);
    if (typeof indexedDB !== 'undefined') {
      try { await ProjectStorage.deleteProject(id); } catch {}
    }
  }

  async emptyTrash() {
    const trashedIds = this.projects.filter((p) => p.deletedAt).map((p) => p.id);
    this.projects = this.projects.filter((p) => !p.deletedAt);
    this._writeLocalMeta(this.projects);
    if (typeof indexedDB !== 'undefined') {
      for (const id of trashedIds) {
        try { await ProjectStorage.deleteProject(id); } catch {}
      }
    }
    return trashedIds.length;
  }

  async saveImportedMediaItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const saved = [];
    for (const raw of items) {
      const item = { ...raw, addedAt: Date.now() };
      if (typeof indexedDB !== 'undefined') {
        try { await ProjectStorage.saveMediaItem(item); } catch {}
      }
      saved.push(item);
    }
    return saved;
  }

  getFolderLocationInfo(id) {
    const p = this.getById(id);
    if (!p) return null;
    return {
      folderName: p.folder || 'My Projects',
      virtualPath: `Internal/LUKRIS/${p.folder || 'My Projects'}/${p.name}.lukris`,
      storageBackend: 'IndexedDB (MotionFlowDB) + Local Metadata Cache',
      projectId: p.id
    };
  }
}
