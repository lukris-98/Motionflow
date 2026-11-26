import { deepClone, uid } from '../utils/math.js';

const DB_NAME = 'MotionFlowDB';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'media';
const STORE_FONTS = 'fonts';

function openDB() {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
      autoColorMatch: true
    },
    coverDataUrl: options.coverDataUrl || null,
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
      autoColorMatch: raw.settings?.autoColorMatch ?? true
    },
    exportPrefs: { ...base.exportPrefs, ...(raw.exportPrefs || {}) },
    backgroundMode: raw.backgroundMode || base.backgroundMode,
    backgroundGradient: Array.isArray(raw.backgroundGradient) ? raw.backgroundGradient : base.backgroundGradient,
    backgroundBlurLevel: raw.backgroundBlurLevel ?? base.backgroundBlurLevel,
    beatMarkers: Array.isArray(raw.beatMarkers) ? raw.beatMarkers : [],
    mediaRefs: Array.isArray(raw.mediaRefs) ? raw.mediaRefs : [],
    layers: raw.layers,
    updatedAt: Date.now()
  };
}

export const ProjectStorage = {
  async saveProject(project) {
    const db = await openDB();
    project.updatedAt = Date.now();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(deepClone(project));
      tx.oncomplete = () => resolve(project);
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
      tx.oncomplete = () => resolve();
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
  }
};

export class HistoryManager {
  constructor(limit = 40) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  pushSnapshot(project) {
    this.undoStack.push(JSON.stringify(project));
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
    this.redoStack.push(JSON.stringify(currentProject));
    return JSON.parse(this.undoStack.pop());
  }

  redo(currentProject) {
    if (!this.canRedo()) return null;
    this.undoStack.push(JSON.stringify(currentProject));
    return JSON.parse(this.redoStack.pop());
  }
}
