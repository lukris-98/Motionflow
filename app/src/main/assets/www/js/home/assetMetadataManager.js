/**
 * LUKRIS Asset Metadata Manager
 * Stores ONLY lightweight metadata counts and descriptors for initial Home render.
 * Heavy asset lists & catalog definitions are lazy-loaded via dynamic import()
 * ONLY when a user explicitly opens a category preview or Templates/AI Tools page.
 */

import { ProjectStorage } from '../storage/projectStorage.js';

export const LIBRARY_CATEGORIES_META = [
  { id: 'fonts', name: 'Fonts', count: 4, icon: 'bi-fonts', accent: '#38bdf8', desc: 'System typefaces & imported custom fonts' },
  { id: 'textAnimations', name: 'Text Animations', count: 35, icon: 'bi-type-bold', accent: '#a78bfa', desc: 'Kinetic titles, reveals & bounce presets' },
  { id: 'videoEffects', name: 'Video Effects', count: 16, icon: 'bi-stars', accent: '#00d4e5', desc: 'Glitch, film grain, bloom & lens shaders' },
  { id: 'transitions', name: 'Transitions', count: 17, icon: 'bi-intersect', accent: '#34d399', desc: 'Dissolve, iris, wipe & camera whip cuts' },
  { id: 'stickers', name: 'Stickers', count: 12, icon: 'bi-emoji-smile', accent: '#fbbf24', desc: 'Badges, REC overlays & vector tags' },
  { id: 'shapes', name: 'Shapes', count: 4, icon: 'bi-pentagon', accent: '#f472b6', desc: 'Rectangle, circle, ellipse & line primitives' },
  { id: 'music', name: 'Music', count: 0, icon: 'bi-music-note-beamed', accent: '#fb7185', desc: 'Imported audio tracks from your device' },
  { id: 'soundEffects', name: 'Sound Effects', count: 16, icon: 'bi-soundwave', accent: '#60a5fa', desc: 'Whooshes, risers, impacts & UI clicks' }
];

export const TEMPLATES_METADATA = [
  {
    id: 'flashBeat',
    name: 'Flash Beat Reels',
    category: 'Social Reels',
    duration: '00:15',
    aspectRatio: '9:16',
    resolution: '1080×1920',
    accentA: '#0a192f',
    accentB: '#00d4e5',
    badge: 'REELS',
    engineTemplateId: 'flashBeat'
  },
  {
    id: 'carousel3D',
    name: '3D Photo Carousel',
    category: '3D Motion',
    duration: '00:12',
    aspectRatio: '16:9',
    resolution: '1920×1080',
    accentA: '#17153b',
    accentB: '#7c4dff',
    badge: '3D CAM',
    engineTemplateId: 'carousel3D'
  },
  {
    id: 'vlogSplit',
    name: 'Vlog Travel Cut',
    category: 'Vlog & Travel',
    duration: '00:24',
    aspectRatio: '16:9',
    resolution: '1920×1080',
    accentA: '#1c1917',
    accentB: '#f59e0b',
    badge: 'VLOG',
    engineTemplateId: 'vlogSplit'
  }
];

export const AI_TOOLS_METADATA = [
  {
    id: 'bg_remover',
    name: 'AI Background Remover',
    desc: 'Isolate subjects with clean alpha edges and chroma despill.',
    icon: 'bi-person-bounding-box',
    tag: 'Vision',
    accent: '#00d4e5',
    editorTool: 'bg_remover'
  },
  {
    id: 'auto_captions',
    name: 'Auto Captions',
    desc: 'Generate beat-synced subtitles or import .SRT lyrics fast.',
    icon: 'bi-badge-cc',
    tag: 'Speech',
    accent: '#38bdf8',
    editorTool: 'auto_captions'
  },
  {
    id: 'tts',
    name: 'Text to Speech',
    desc: 'Convert scripts into studio-grade voiceovers with style control.',
    icon: 'bi-megaphone',
    tag: 'Voice',
    accent: '#a78bfa',
    editorTool: 'tts'
  },
  {
    id: 'ai_image',
    name: 'AI Image Generator',
    desc: 'Create custom stylized backdrops, overlays, and concept art.',
    icon: 'bi-image-alt',
    tag: 'Generative',
    accent: '#f472b6',
    editorTool: 'effects'
  },
  {
    id: 'ai_video',
    name: 'AI Video Generator',
    desc: 'Turn prompts and keyframes into kinetic motion sequences.',
    icon: 'bi-film',
    tag: 'Motion',
    accent: '#fbbf24',
    editorTool: 'effects'
  },
  {
    id: 'voice_enhance',
    name: 'Voice Enhancement',
    desc: 'Clean room noise, balance vocal EQ, and level loudness.',
    icon: 'bi-mic',
    tag: 'Audio',
    accent: '#34d399',
    editorTool: 'voice_enhance'
  }
];

const BUILTIN_FONTS = [
  { id: 'sans-serif', label: 'Sans Serif', tag: 'System · Clean', sample: 'Aa' },
  { id: 'serif', label: 'Serif', tag: 'System · Classic', sample: 'Aa' },
  { id: 'monospace', label: 'Monospace', tag: 'System · Code', sample: '00:10' },
  { id: 'cursive', label: 'Display / Script', tag: 'System · Script', sample: 'Script' }
];

const REAL_SHAPES = [
  { id: 'rectangle', label: 'Rectangle', tag: 'Primitive', sample: '▭' },
  { id: 'circle', label: 'Circle', tag: 'Primitive', sample: '◯' },
  { id: 'ellipse', label: 'Ellipse', tag: 'Primitive', sample: '⬭' },
  { id: 'line', label: 'Line', tag: 'Primitive', sample: '―' }
];

export class AssetMetadataManager {
  constructor() {
    this._catalogCache = new Map();
    this._categories = LIBRARY_CATEGORIES_META.map((c) => ({ ...c }));
  }

  async refreshDynamicCounts() {
    if (typeof indexedDB === 'undefined') return this._categories;
    try {
      const [customFonts, mediaItems] = await Promise.all([
        ProjectStorage.listFontItems(),
        ProjectStorage.listMediaItems()
      ]);
      const audioCount = (mediaItems || []).filter((m) => m.type === 'audio').length;
      const fontsCount = BUILTIN_FONTS.length + (customFonts || []).length;
      this._categories = this._categories.map((c) => {
        if (c.id === 'fonts') return { ...c, count: fontsCount };
        if (c.id === 'music') return { ...c, count: audioCount };
        return c;
      });
      this._catalogCache.delete('fonts');
      this._catalogCache.delete('music');
    } catch {}
    return this._categories;
  }

  getCategoriesSummary() {
    return this._categories;
  }

  getTemplatesSummary(limit = null) {
    return typeof limit === 'number' ? TEMPLATES_METADATA.slice(0, limit) : TEMPLATES_METADATA;
  }

  getAiToolsSummary() {
    return AI_TOOLS_METADATA;
  }

  /**
   * Lazy-loads detailed items for a single category on user click.
   * Dynamically imports capcutCatalog.js only when needed.
   */
  async loadCategoryItems(categoryId) {
    if (this._catalogCache.has(categoryId)) {
      return this._catalogCache.get(categoryId);
    }

    if (categoryId === 'fonts') {
      let custom = [];
      if (typeof indexedDB !== 'undefined') {
        try {
          const stored = await ProjectStorage.listFontItems();
          custom = (stored || []).map((f) => ({
            id: f.id,
            label: f.name,
            tag: 'Imported Font',
            sample: 'Aa'
          }));
        } catch {}
      }
      const items = [...BUILTIN_FONTS, ...custom];
      this._catalogCache.set(categoryId, items);
      return items;
    }

    if (categoryId === 'shapes') {
      this._catalogCache.set(categoryId, REAL_SHAPES);
      return REAL_SHAPES;
    }

    if (categoryId === 'music') {
      let items = [];
      if (typeof indexedDB !== 'undefined') {
        try {
          const media = await ProjectStorage.listMediaItems();
          items = (media || [])
            .filter((m) => m.type === 'audio')
            .map((m) => ({
              id: m.id,
              label: m.name || 'Imported Audio',
              tag: 'Imported Audio',
              icon: 'bi-music-note-beamed'
            }));
        } catch {}
      }
      this._catalogCache.set(categoryId, items);
      return items;
    }

    const catalog = await import('../engine/capcutCatalog.js');
    let items = [];
    switch (categoryId) {
      case 'textAnimations':
        items = catalog.ANIMATION_CATALOG
          .filter((a) => a.target === 'text' || a.target === 'all')
          .map((a) => ({ id: a.id, label: a.label, tag: a.cat.toUpperCase(), color: a.color }));
        break;
      case 'videoEffects':
        items = catalog.VIDEO_EFFECT_PRESETS
          .filter((v) => v.id !== 'none')
          .map((v) => ({ id: v.id, label: v.label, tag: v.badge || v.cat, color: v.accent }));
        break;
      case 'transitions':
        items = catalog.TRANSITION_PRESETS
          .filter((t) => t.id !== 'none')
          .map((t) => ({ id: t.id, label: t.label, tag: t.badge || t.cat, icon: t.icon }));
        break;
      case 'stickers':
        items = catalog.STICKER_PACK.map((s) => ({
          id: s.id,
          label: s.label,
          tag: s.sub,
          sample: s.emoji,
          color: s.color
        }));
        break;
      case 'soundEffects':
        items = catalog.SFX_PACK.map((s) => ({
          id: s.id,
          label: s.label,
          tag: `${s.durMs}ms · ${s.cat}`,
          icon: s.icon,
          color: s.color
        }));
        break;
      default:
        items = [];
    }

    this._catalogCache.set(categoryId, items);
    return items;
  }
}
