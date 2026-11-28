/**
 * LUKRIS Core Engine (Lightweight Home Runtime)
 * Handles state persistence (localStorage), theme, event bus, debounce,
 * notifications, settings, user profile, and formatting utilities.
 * Zero Video / Audio / Rendering Engine dependencies.
 */

const SETTINGS_KEY = 'lukris_settings_v1';
const PROFILE_KEY = 'lukris_profile_v1';
const NOTIFS_KEY = 'lukris_notifications_v1';
const DOWNLOADS_KEY = 'lukris_downloads_v1';
const THEME_KEY = 'mf_theme_mode';

export const DEFAULT_SETTINGS = {
  general: {
    defaultResolution: '1920x1080',
    defaultFps: 30,
    autosaveSec: 10,
    language: 'en'
  },
  appearance: {
    theme: 'dark',
    compactSidebar: false,
    accentColor: 'cyan'
  },
  performance: {
    hardwareAccel: true,
    proxyMode: 'auto',
    lazyThumbnails: true,
    maxCacheMb: 512
  },
  storage: {
    workspacePath: 'Internal/LUKRIS/Projects',
    autoCleanupDays: 30
  }
};

export const DEFAULT_PROFILE = {
  name: 'LUKRIS User',
  email: 'Local Workspace',
  plan: 'Local Studio',
  role: 'Creator',
  initials: 'LU',
  avatarColor: '#00d4e5'
};

const DEFAULT_NOTIFICATIONS = [];

const DEFAULT_DOWNLOADS = [];

const CORE_PURGED_KEY = 'lukris_core_purged_dummy_v1';
const LEGACY_DUMMY_NOTIF_IDS = new Set(['notif_welcome', 'notif_perf', 'notif_templates']);
const LEGACY_DUMMY_DOWNLOAD_IDS = new Set(['dl_cinema_lut', 'dl_sfx_pro', 'dl_fonts_geo', 'dl_ai_matte']);

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, delayMs = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export function formatRelativeTime(ts) {
  if (!ts) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Recently';
  }
}

export function formatDurationCompact(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatResolutionLabel(w, h) {
  const width = Number(w) || 1280;
  const height = Number(h) || 720;
  return `${width}×${height}`;
}

export function formatBytesShort(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(k)));
  return `${(b / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export class CoreEngine {
  constructor() {
    this.listeners = new Map();
    this.settings = this._loadJson(SETTINGS_KEY, DEFAULT_SETTINGS);
    this.profile = this._loadJson(PROFILE_KEY, DEFAULT_PROFILE);
    this.notifications = this._loadJson(NOTIFS_KEY, DEFAULT_NOTIFICATIONS);
    this.downloads = this._loadJson(DOWNLOADS_KEY, DEFAULT_DOWNLOADS);
    this._purgeLegacyDummyState();
    this._syncStoredTheme();
  }

  _purgeLegacyDummyState() {
    if (typeof localStorage === 'undefined') return;
    try {
      if (localStorage.getItem(CORE_PURGED_KEY) === '1') return;
      this.notifications = (this.notifications || []).filter((n) => n && !LEGACY_DUMMY_NOTIF_IDS.has(n.id));
      this._saveJson(NOTIFS_KEY, this.notifications);
      this.downloads = (this.downloads || []).filter((d) => d && !LEGACY_DUMMY_DOWNLOAD_IDS.has(d.id));
      this._saveJson(DOWNLOADS_KEY, this.downloads);
      if (this.profile?.email === 'creator@lukris.studio') {
        this.profile = structuredClone(DEFAULT_PROFILE);
        this._saveJson(PROFILE_KEY, this.profile);
      }
      localStorage.setItem(CORE_PURGED_KEY, '1');
    } catch {}
  }

  _loadJson(key, fallback) {
    if (typeof localStorage === 'undefined') return structuredClone(fallback);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return structuredClone(fallback);
      const parsed = JSON.parse(raw);
      if (Array.isArray(fallback)) {
        return Array.isArray(parsed) ? parsed : structuredClone(fallback);
      }
      return this._deepMerge(structuredClone(fallback), parsed);
    } catch {
      return structuredClone(fallback);
    }
  }

  _saveJson(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  _deepMerge(target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const k of Object.keys(src)) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k] && typeof target[k] === 'object') {
        target[k] = this._deepMerge(target[k], src[k]);
      } else {
        target[k] = src[k];
      }
    }
    return target;
  }

  _syncStoredTheme() {
    if (typeof localStorage !== 'undefined') {
      const storedTheme = localStorage.getItem(THEME_KEY);
      if (storedTheme === 'light' || storedTheme === 'dark') {
        this.settings.appearance.theme = storedTheme;
      }
    }
    this.applyAppearance();
  }

  applyAppearance() {
    if (typeof document === 'undefined') return;
    const theme = this.settings?.appearance?.theme === 'light' ? 'light' : 'dark';
    const accent = this.settings?.appearance?.accentColor || 'cyan';
    const compact = Boolean(this.settings?.appearance?.compactSidebar);
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.classList.toggle('lk-theme-light', theme === 'light');
    document.documentElement.setAttribute('data-lk-accent', accent);
    document.body?.classList.toggle('lk-sidebar-collapsed', compact);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.warn('Event listener error:', e); }
    }
  }

  updateSettings(patch) {
    this.settings = this._deepMerge(this.settings, patch);
    this._saveJson(SETTINGS_KEY, this.settings);
    this.applyAppearance();
    this.emit('settings:changed', this.settings);
    return this.settings;
  }

  updateProfile(patch) {
    this.profile = { ...this.profile, ...patch };
    const words = String(this.profile.name || 'LS').trim().split(/\s+/).filter(Boolean);
    this.profile.initials = words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : (words[0]?.slice(0, 2) || 'LK').toUpperCase();
    this._saveJson(PROFILE_KEY, this.profile);
    this.emit('profile:changed', this.profile);
    return this.profile;
  }

  getUnreadNotificationsCount() {
    return this.notifications.filter((n) => n.unread).length;
  }

  markAllNotificationsRead() {
    this.notifications = this.notifications.map((n) => ({ ...n, unread: false }));
    this._saveJson(NOTIFS_KEY, this.notifications);
    this.emit('notifications:changed', this.notifications);
  }

  toggleDownloadInstall(dlId) {
    this.downloads = this.downloads.map((d) => {
      if (d.id !== dlId) return d;
      if (d.status === 'installed') return { ...d, status: 'available', progress: 0 };
      return { ...d, status: 'installed', progress: 100 };
    });
    this._saveJson(DOWNLOADS_KEY, this.downloads);
    this.emit('downloads:changed', this.downloads);
  }

  showToast(message, tone = 'info') {
    this.emit('toast', { message, tone });
    if (typeof document === 'undefined') return;
    const toastEl = document.getElementById('lukrisToast');
    const msgEl = document.getElementById('lukrisToastMsg');
    const iconEl = document.getElementById('lukrisToastIcon');
    if (!toastEl || !msgEl) return;
    msgEl.textContent = message;
    if (iconEl) {
      iconEl.className = tone === 'danger'
        ? 'bi bi-exclamation-triangle-fill text-danger me-2'
        : tone === 'success'
          ? 'bi bi-check-circle-fill text-success me-2'
          : 'bi bi-info-circle-fill text-info me-2';
    }
    if (window.bootstrap?.Toast) {
      window.bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2400 }).show();
    }
  }
}
