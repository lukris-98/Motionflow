import { deepClone, uid } from '../utils/math.js';

const DB_NAME = 'MotionFlowDB';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'media';
const STORE_FONTS = 'fonts';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB open timed out'));
      }
    }, 3000);
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_FONTS)) {
          db.createObjectStore(STORE_FONTS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try { db.close(); } catch {}
        };
        finish(resolve, db);
      };
      req.onerror = () => finish(reject, req.error || new Error('IndexedDB error'));
      req.onblocked = () => finish(reject, new Error('IndexedDB blocked'));
    } catch (err) {
      finish(reject, err);
    }
  });
}

export function createEmptyProject(name = 'Untitled Project', options = {}) {
  const fps = options.fps || 30;
  const durationSec = options.durationSec || 10;
  return {
    schemaVersion: 1,
    id: uid('proj'),
    name,
    width: options.width || 1280,
    height: options.height || 720,
    fps,
    durationFrames: fps * durationSec,
    backgroundColor: options.backgroundColor || '#05070B',
    backgroundMode: options.backgroundMode || 'color', // 'color' | 'gradient' | 'blur'
    backgroundGradient: options.backgroundGradient || ['#0F172A', '#1E1B4B'],
    backgroundBlurLevel: options.backgroundBlurLevel ?? 2,
    camera: {
      enabled: false,
      motionBlur: false,
      motionBlurSamples: 4,
      x: 0,
      y: 0,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      keyframes: {
        x: [],
        y: [],
        z: [],
        rotX: [],
        rotY: [],
        rotZ: [],
        zoom: []
      }
    },
    mediaRefs: [],
    markers: [],
    beatMarkers: [],
    layers: [],
    exportPrefs: {
      resPreset: options.resPreset || '1080p',
      fps: options.fps || fps,
      quality: options.quality || 'high',
      includeAudio: true
    },
    settings: {
      snapToTimeline: true,
      showGrid: false,
      rippleMode: true,
      autoColorMatch: true,
      mainTrackCompact: false,
      zoneOrder: ['overlay', 'main', 'audio'],
      themeMode: options.themeMode === 'light' ? 'light' : 'dark'
    },
    coverDataUrl: options.coverDataUrl || null,
    projectType: options.projectType || 'video',
    favorite: Boolean(options.favorite),
    deletedAt: options.deletedAt || null,
    folder: options.folder || 'My Projects',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(jsonString) {
  const raw = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) {
    throw new Error('Invalid MotionFlow project JSON');
  }
  const base = createEmptyProject(raw.name || 'Imported Project', {
    width: Number(raw.width) || 1280,
    height: Number(raw.height) || 720,
    fps: Number(raw.fps) || 30
  });
  return {
    ...base,
    ...raw,
    id: raw.id || uid('proj'),
    camera: {
      ...base.camera,
      ...(raw.camera || {}),
      keyframes: { ...base.camera.keyframes, ...(raw.camera?.keyframes || {}) }
    },
    settings: {
      ...base.settings,
      ...(raw.settings || {}),
      rippleMode: raw.settings?.rippleMode ?? true,
      autoColorMatch: raw.settings?.autoColorMatch ?? true,
      mainTrackCompact: Boolean(raw.settings?.mainTrackCompact),
      zoneOrder: (() => {
        const def = ['overlay', 'main', 'audio'];
        const rawZones = Array.isArray(raw.settings?.zoneOrder) ? raw.settings.zoneOrder : def;
        const next = [];
        for (const z of rawZones) {
          if (def.includes(z) && !next.includes(z)) next.push(z);
        }
        for (const z of def) {
          if (!next.includes(z)) next.push(z);
        }
        return next;
      })(),
      themeMode: raw.settings?.themeMode === 'light' ? 'light' : 'dark'
    },
    exportPrefs: { ...base.exportPrefs, ...(raw.exportPrefs || {}) },
    backgroundMode: raw.backgroundMode || base.backgroundMode,
    backgroundGradient: Array.isArray(raw.backgroundGradient) ? raw.backgroundGradient : base.backgroundGradient,
    backgroundBlurLevel: raw.backgroundBlurLevel ?? base.backgroundBlurLevel,
    markers: Array.isArray(raw.markers)
      ? raw.markers
          .map((m, idx) => {
            if (typeof m === 'number' && Number.isFinite(m)) {
              return { id: `mkr_${idx}`, frame: Math.max(0, Math.round(m)), label: 'Marker', color: '#34d399' };
            }
            if (m && typeof m === 'object' && Number.isFinite(Number(m.frame))) {
              return {
                id: m.id || `mkr_${idx}`,
                frame: Math.max(0, Math.round(Number(m.frame))),
                label: String(m.label || 'Marker'),
                color: String(m.color || '#34d399')
              };
            }
            return null;
          })
          .filter(Boolean)
          .sort((a, b) => a.frame - b.frame)
      : [],
    beatMarkers: Array.isArray(raw.beatMarkers) ? raw.beatMarkers : [],
    mediaRefs: Array.isArray(raw.mediaRefs) ? raw.mediaRefs : [],
    layers: raw.layers,
    projectType: raw.projectType || 'video',
    favorite: Boolean(raw.favorite),
    deletedAt: raw.deletedAt || null,
    folder: raw.folder || 'My Projects',
    updatedAt: Date.now()
  };
}

const META_STORAGE_KEY = 'lukris_projects_meta_v1';

function extractProjectMeta(project) {
  if (!project || !project.id) return null;
  const fps = Math.max(1, Number(project.fps) || 30);
  const durationFrames = Math.max(1, Number(project.durationFrames) || fps * 10);
  const maxLayerEnd = Array.isArray(project.layers)
    ? project.layers.reduce((m, l) => Math.max(m, Number(l?.endFrame) || 0), 0)
    : 0;
  const effectiveFrames = maxLayerEnd > 0 ? maxLayerEnd : durationFrames;
  return {
    id: project.id,
    name: project.name || 'Untitled Project',
    projectType: project.projectType || 'video',
    width: Number(project.width) || 1280,
    height: Number(project.height) || 720,
    fps,
    durationFrames: effectiveFrames,
    durationSec: Math.max(1, Math.round(effectiveFrames / fps)),
    layerCount: Array.isArray(project.layers) ? project.layers.length : 0,
    favorite: Boolean(project.favorite),
    deletedAt: project.deletedAt || null,
    folder: project.folder || 'My Projects',
    coverDataUrl: project.coverDataUrl || null,
    backgroundColor: project.backgroundColor || '#05070B',
    createdAt: project.createdAt || Date.now(),
    updatedAt: project.updatedAt || Date.now()
  };
}

function syncMetaToLocalStorage(project, deletedId = null) {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (deletedId) {
      list = list.filter((p) => p && p.id !== deletedId);
    } else if (project) {
      const meta = extractProjectMeta(project);
      if (meta) {
        const idx = list.findIndex((p) => p && p.id === meta.id);
        if (idx >= 0) list[idx] = { ...list[idx], ...meta };
        else list.unshift(meta);
      }
    }
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export const ProjectStorage = {
  async saveProject(project) {
    const db = await openDB();
    project.updatedAt = Date.now();
    const payload = typeof structuredClone === 'function' ? structuredClone(project) : deepClone(project);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(payload);
      tx.oncomplete = () => {
        syncMetaToLocalStorage(project, null);
        resolve(project);
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  async getProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async listProjects() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(id);
      tx.oncomplete = () => {
        syncMetaToLocalStorage(null, id);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveMediaItem(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      tx.objectStore(STORE_MEDIA).put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  },

  async listMediaItems() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readonly');
      const req = tx.objectStore(STORE_MEDIA).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
      req.onerror = () => reject(req.error);
    });
  },

  async deleteMediaItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      tx.objectStore(STORE_MEDIA).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveFontItem(font) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FONTS, 'readwrite');
      tx.objectStore(STORE_FONTS).put(font);
      tx.oncomplete = () => resolve(font);
      tx.onerror = () => reject(tx.error);
    });
  },

  async listFontItems() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FONTS, 'readonly');
      const req = tx.objectStore(STORE_FONTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async collectKeepFileNames(extraProject = null) {
    if (typeof indexedDB === 'undefined') {
      return null;
    }
    const keepFiles = new Set();
    const referencedMediaIds = new Set();
    const scanProject = (proj) => {
      if (!proj || typeof proj !== 'object') return;
      if (Array.isArray(proj.layers)) {
        for (const l of proj.layers) {
          if (l?.mediaId) referencedMediaIds.add(l.mediaId);
          if (l?.fileName) keepFiles.add(String(l.fileName));
        }
      }
      if (Array.isArray(proj.mediaRefs)) {
        for (const r of proj.mediaRefs) {
          if (typeof r === 'string') referencedMediaIds.add(r);
          else if (r?.id) referencedMediaIds.add(r.id);
          if (r?.fileName) keepFiles.add(String(r.fileName));
        }
      }
    };

    try {
      const projects = await this.listProjects();
      for (const p of projects) scanProject(p);
    } catch {
      return null;
    }
    if (extraProject) scanProject(extraProject);

    let mediaItems = [];
    try {
      mediaItems = await this.listMediaItems();
    } catch {
      return null;
    }

    const tempUnusedItems = [];
    const recentGraceMs = 5 * 60 * 1000;
    const now = Date.now();
    for (const item of mediaItems) {
      if (!item) continue;
      const isReferenced = referencedMediaIds.has(item.id);
      const isExplicitTemp = Boolean(item.isTemp || item.temporary);
      const isRecent = (now - (Number(item.addedAt) || 0)) < recentGraceMs;
      if (isExplicitTemp && !isReferenced && !isRecent) {
        tempUnusedItems.push(item);
      } else if (item.fileName) {
        keepFiles.add(String(item.fileName));
      }
    }

    return {
      keepFiles: Array.from(keepFiles),
      tempUnusedItems,
      referencedMediaIds
    };
  },

  async clearSafeTempCache(extraProject = null) {
    let deletedCount = 0;
    let freedBytes = 0;
    let scan = null;
    try {
      scan = await this.collectKeepFileNames(extraProject);
    } catch {
      scan = null;
    }

    if (scan && Array.isArray(scan.tempUnusedItems) && scan.tempUnusedItems.length > 0) {
      for (const item of scan.tempUnusedItems) {
        try {
          await this.deleteMediaItem(item.id);
          deletedCount++;
          freedBytes += Number(item.sizeBytes) || 0;
          if (typeof item.url === 'string' && item.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(item.url); } catch {}
          }
          if (typeof item.thumbUrl === 'string' && item.thumbUrl.startsWith('blob:') && item.thumbUrl !== item.url) {
            try { URL.revokeObjectURL(item.thumbUrl); } catch {}
          }
        } catch {}
      }
    }

    // Clear only explicitly temporary localStorage cache keys (never projects, settings, or profile)
    if (typeof localStorage !== 'undefined') {
      try {
        const allKeys = typeof localStorage.key === 'function' && Number.isFinite(localStorage.length)
          ? Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
          : Object.keys(localStorage);
        for (const k of allKeys) {
          if (k && (k.startsWith('lukris_tmp_') || k.startsWith('mf_tmp_') || k.startsWith('lukris_preview_cache_'))) {
            freedBytes += (localStorage.getItem(k) || '').length * 2;
            localStorage.removeItem(k);
            deletedCount++;
          }
        }
      } catch {}
    }

    const nativeArg = scan ? JSON.stringify(scan.keepFiles) : '__SKIP_MEDIA__';
    if (typeof window !== 'undefined' && window.AndroidBridge?.clearTempCache) {
      try {
        const res = JSON.parse(window.AndroidBridge.clearTempCache(nativeArg) || '{}');
        deletedCount += Number(res.deletedCount) || 0;
        freedBytes += Number(res.freedBytes) || 0;
      } catch {}
    } else if (scan && typeof window !== 'undefined' && window.AndroidBridge?.cleanupUnusedNativeFiles) {
      try {
        const res = JSON.parse(window.AndroidBridge.cleanupUnusedNativeFiles(JSON.stringify(scan.keepFiles)) || '{}');
        deletedCount += Number(res.deletedCount) || 0;
        freedBytes += Number(res.freedBytes) || 0;
      } catch {}
    }

    return {
      deletedCount,
      freedBytes,
      protectedCount: scan ? scan.keepFiles.length : null
    };
  }
};

export class HistoryManager {
  constructor(limit = 25) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  _serializeLightweight(project) {
    if (!project || typeof project !== 'object') return JSON.stringify(project);
    if (!project.coverDataUrl) return JSON.stringify(project);
    const { coverDataUrl: _omit, ...rest } = project;
    return JSON.stringify(rest);
  }

  _restoreSnapshot(rawJson, currentProject) {
    const restored = JSON.parse(rawJson);
    if (restored && typeof restored === 'object' && restored.coverDataUrl === undefined && currentProject?.coverDataUrl) {
      restored.coverDataUrl = currentProject.coverDataUrl;
    }
    return restored;
  }

  pushSnapshot(project) {
    this.undoStack.push(this._serializeLightweight(project));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(currentProject) {
    if (!this.canUndo()) return null;
    this.redoStack.push(this._serializeLightweight(currentProject));
    return this._restoreSnapshot(this.undoStack.pop(), currentProject);
  }

  redo(currentProject) {
    if (!this.canRedo()) return null;
    this.undoStack.push(this._serializeLightweight(currentProject));
    return this._restoreSnapshot(this.redoStack.pop(), currentProject);
  }
}
