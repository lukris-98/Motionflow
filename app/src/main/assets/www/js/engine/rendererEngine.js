import { KeyframeEngine } from './keyframeEngine.js';
import { TimelineEngine } from './timelineEngine.js';
import { getStabilizerAtFrame } from './stabilizerEngine.js';
import { MASK_PRESETS, VIDEO_EFFECT_PRESETS } from './capcutCatalog.js';
import {
  pickChromaSampleFromRgba,
  computeAutoBgMask,
  applyChromaKeyToRgba,
  hexToRgb255
} from './bgRemovalEngine.js';
import { decodeAnimatedGif } from '../utils/gifDecoder.js';
import { Mat4 } from '../utils/mat4.js';

export class RendererEngine {
  constructor(previewCanvas, overlayCanvas) {
    this.canvas = previewCanvas;
    this.overlay = overlayCanvas;
    this.octx = overlayCanvas.getContext('2d');

    this.imageCache = new Map();       // mediaId -> HTMLImageElement
    this.previewImageCache = new Map(); // mediaId -> { url, canvas, origW, origH }
    this.gifCache = new Map();         // mediaId -> { frames, totalMs } | 'loading'
    this.videoCache = new Map();       // mediaId -> HTMLVideoElement
    this.videoLastFrameCache = new Map(); // mediaId -> { canvas, width, height }
    this.videoThumbFallbackCache = new Map(); // mediaId -> HTMLImageElement
    this.rasterCache = new Map();      // layerId -> { key, canvas }
    this.autoBgCache = new Map();      // layerId -> { key, outCanvas, maskCanvas, scratchCanvas, version, dominantBgHex }
    this.bgGradientCache = { key: '', canvas: null };
    this._videoHostEl = null;
    this._safeTexCanvas = null;
    this._videoScratchCanvas = null;
    this._samplePatchCanvas = null;
    this._chroma2dCanvas = null;
    this.onMediaFrameReady = null;
    this.maxPreviewSide = 854;
    this.maxPreviewImageSide = 1280;
    this.maxVideoDecoders = 3;

    this.glPreview = this.createWebGLCompositor(this.canvas, false);
    this.ctx2dFallback = this.glPreview ? null : this.canvas.getContext('2d', { alpha: false });
    this.exportCompositors = new WeakMap();
    this.lastOverlayBox = null;
    this.lastTrackerBox = null;
    this.lastGizmoHandles = null;
    this.lastTriadHandles = null;
    this.renderedLayerQuads = [];
    this.trackerOverlay = null;
    this.chromaPickerOverlay = null;
    this.viewport3D = { enabled: false, tool: 'move', viewMode: 'camera', axisLock: 'free', sceneCam: null };
    this.pending3DLayerPose = null;
    this.pending3DCamPose = null;
  }

  setChromaPickerOverlay(state) {
    this.chromaPickerOverlay = state;
  }

  setTrackerOverlay(state) {
    this.trackerOverlay = state;
  }

  setViewport3DState(state) {
    this.viewport3D = state || { enabled: false, tool: 'move', viewMode: 'camera', axisLock: 'free', sceneCam: null };
  }

  setPending3DPose(layerPose = null, camPose = null) {
    this.pending3DLayerPose = layerPose;
    this.pending3DCamPose = camPose;
  }

  resolveRenderCameraPose(project, frame, allowPending = false) {
    const cam = KeyframeEngine.getCameraAtFrame(project.camera, frame);
    if (allowPending && this.pending3DCamPose && Math.round(frame) === Math.round(this.pending3DCamPose.frame)) {
      return { enabled: true, ...cam, ...this.pending3DCamPose.props };
    }
    return { enabled: Boolean(project.camera?.enabled), ...cam };
  }

  resolveEffectiveCamera(project, frame, flat2D = false, allowPending = false) {
    const camEnabled = !flat2D && (Boolean(project.camera?.enabled) || (allowPending && Boolean(this.viewport3D?.enabled)));
    if (!camEnabled) {
      return { enabled: false, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, zoom: 1 };
    }
    if (allowPending && this.viewport3D?.enabled && this.viewport3D?.viewMode === 'scene' && this.viewport3D?.sceneCam) {
      const sc = this.viewport3D.sceneCam;
      return {
        enabled: true,
        x: Number(sc.x) || 0,
        y: Number(sc.y) || 0,
        z: Number(sc.z) || 0,
        rotX: Number(sc.rotX) || 0,
        rotY: Number(sc.rotY) || 0,
        rotZ: Number(sc.rotZ) || 0,
        zoom: Math.max(0.2, Number(sc.zoom) || 1)
      };
    }
    const pose = this.resolveRenderCameraPose(project, frame, allowPending);
    return { ...pose, enabled: true };
  }

  resolveEffectiveTransform(layer, frame, allowPending = false) {
    const tf = KeyframeEngine.getTransformAtFrame(layer, frame);
    if (
      allowPending &&
      this.viewport3D?.enabled &&
      this.pending3DLayerPose &&
      this.pending3DLayerPose.layerId === layer.id &&
      Math.round(frame) === Math.round(this.pending3DLayerPose.frame)
    ) {
      return { ...tf, ...this.pending3DLayerPose.props };
    }
    return tf;
  }

  getAdjustmentIntensityScale(layer, frame) {
    if (!layer || layer.type !== 'adjustment' || !(layer.keyframes?.intensity?.length > 0)) {
      return 1;
    }
    const base = Math.max(0.05, Number(KeyframeEngine.getDefaultPropValue(layer, 'intensity')) || 1);
    const val = Math.max(0, Number(KeyframeEngine.getValueAtFrame(layer, 'intensity', frame, base)) || 0);
    return val / base;
  }

  purgeMediaCache(mediaId) {
    if (!mediaId) return;
    this.imageCache.delete(mediaId);
    this.previewImageCache.delete(mediaId);
    this.gifCache.delete(mediaId);
    this.videoLastFrameCache.delete(mediaId);
    this.videoThumbFallbackCache.delete(mediaId);
    const vid = this.videoCache.get(mediaId);
    if (vid) {
      try {
        vid._wantsPlay = false;
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
        vid.remove();
      } catch {}
      this.videoCache.delete(mediaId);
    }
    if (this.glPreview?.textures?.has(mediaId)) {
      this.glPreview.gl.deleteTexture(this.glPreview.textures.get(mediaId));
      this.glPreview.textures.delete(mediaId);
    }
    this.glPreview?.textureMeta?.delete(mediaId);
  }

  _releaseVideoDecoder(mediaId, captureFallback = true) {
    const vid = this.videoCache.get(mediaId);
    if (!vid) return;
    if (captureFallback && vid.readyState >= 2 && vid.videoWidth > 0) {
      this.captureVideoFallbackFrame(mediaId, vid);
    }
    try {
      vid._wantsPlay = false;
      vid._wantsPlaySinceMs = 0;
      vid._pendingPlayTargetTime = null;
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
      vid.remove();
    } catch {}
    this.videoCache.delete(mediaId);
  }

  _touchVideoLru(mediaId) {
    if (!mediaId || !this.videoCache.has(mediaId)) return;
    const vid = this.videoCache.get(mediaId);
    this.videoCache.delete(mediaId);
    this.videoCache.set(mediaId, vid);
  }

  _enforceVideoDecoderBudget(project, frame, protectedIds = null) {
    const budget = Math.max(1, this.maxVideoDecoders || 3);
    if (this.videoCache.size <= budget) return;

    const keep = new Set(protectedIds || []);
    const fps = Math.max(1, project?.fps || 30);
    const lookahead = Math.round(fps * 2.0);
    if (project && Array.isArray(project.layers)) {
      for (const l of project.layers) {
        if (!l || l.type !== 'video' || !l.visible || !l.mediaId) continue;
        if (frame >= l.startFrame - 2 && frame <= l.endFrame + lookahead) {
          keep.add(l.mediaId);
        }
      }
    }

    for (const mid of [...this.videoCache.keys()]) {
      if (this.videoCache.size <= budget) break;
      if (keep.has(mid)) continue;
      this._releaseVideoDecoder(mid, true);
    }
  }

  pruneUnusedCaches(project) {
    if (!project || !Array.isArray(project.layers)) return;
    const activeMediaIds = new Set();
    const activeLayerIds = new Set();
    for (const l of project.layers) {
      activeLayerIds.add(l.id);
      if (l.mediaId) activeMediaIds.add(l.mediaId);
    }
    for (const lid of [...this.rasterCache.keys()]) {
      if (!activeLayerIds.has(lid)) {
        this.rasterCache.delete(lid);
        this.autoBgCache.delete(lid);
        if (this.glPreview?.textures?.has(lid)) {
          this.glPreview.gl.deleteTexture(this.glPreview.textures.get(lid));
          this.glPreview.textures.delete(lid);
        }
        if (this.glPreview?.textures?.has(`${lid}__autobg`)) {
          this.glPreview.gl.deleteTexture(this.glPreview.textures.get(`${lid}__autobg`));
          this.glPreview.textures.delete(`${lid}__autobg`);
        }
        this.glPreview?.textureMeta?.delete(lid);
        this.glPreview?.textureMeta?.delete(`${lid}__autobg`);
      }
    }
    for (const lid of [...this.autoBgCache.keys()]) {
      if (!activeLayerIds.has(lid)) {
        this.autoBgCache.delete(lid);
      }
    }
    for (const mid of [...this.videoCache.keys()]) {
      if (!activeMediaIds.has(mid)) {
        this.purgeMediaCache(mid);
      }
    }
    for (const mid of [...this.imageCache.keys()]) {
      if (!activeMediaIds.has(mid)) {
        this.imageCache.delete(mid);
      }
    }
    for (const mid of [...this.previewImageCache.keys()]) {
      if (!activeMediaIds.has(mid)) {
        this.previewImageCache.delete(mid);
      }
    }
    for (const mid of [...this.videoLastFrameCache.keys()]) {
      if (!activeMediaIds.has(mid)) this.videoLastFrameCache.delete(mid);
    }
    for (const mid of [...this.videoThumbFallbackCache.keys()]) {
      if (!activeMediaIds.has(mid)) this.videoThumbFallbackCache.delete(mid);
    }
    for (const mid of [...this.gifCache.keys()]) {
      if (!activeMediaIds.has(mid)) this.gifCache.delete(mid);
    }
    if (this.glPreview?.textures) {
      for (const texKey of [...this.glPreview.textures.keys()]) {
        if (texKey === '__bg_grad') continue;
        const baseLayerId = texKey.endsWith('__autobg') ? texKey.slice(0, -8) : null;
        const isAlive = baseLayerId
          ? activeLayerIds.has(baseLayerId)
          : (activeMediaIds.has(texKey) || activeLayerIds.has(texKey));
        if (!isAlive) {
          this.glPreview.gl.deleteTexture(this.glPreview.textures.get(texKey));
          this.glPreview.textures.delete(texKey);
          this.glPreview.textureMeta?.delete(texKey);
        }
      }
    }
  }

  createWebGLCompositor(canvas, antialias = true) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      preserveDrawingBuffer: true,
      antialias: Boolean(antialias),
      powerPreference: 'default'
    });
    if (!gl) return null;

    const vsSrc = `
      attribute vec2 aPos;
      attribute vec2 aUv;
      uniform mat4 uMvp;
      varying vec2 vUv;
      void main() {
        gl_Position = uMvp * vec4(aPos, 0.0, 1.0);
        vUv = aUv;
      }
    `;
    const fsSrc = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform float uAlpha;
      uniform float uPremul;
      uniform float uBright;
      uniform float uContrast;
      uniform float uSat;
      uniform float uTemp;
      uniform float uTint;
      uniform float uExposure;
      uniform float uHighlights;
      uniform float uShadows;
      uniform float uFade;
      uniform float uSharpen;
      uniform float uBlur;
      uniform float uVignette;
      uniform float uGrain;
      uniform vec2 uTexel;
      uniform float uChromaOn;
      uniform vec3 uChromaKey;
      uniform float uChromaSim;
      uniform float uChromaSmooth;
      uniform float uChromaSpill;
      uniform float uOutlineW;
      uniform vec3 uOutlineCol;
      uniform float uMaskType;
      uniform vec4 uMaskRect;
      uniform float uMaskRot;
      uniform float uMaskFeather;
      uniform float uMaskInvert;
      uniform vec4 uCropRect;
      uniform vec4 uStab;
      uniform vec3 uVfx;
      uniform vec2 uWipe;
      uniform vec3 uHsl[8];
      uniform vec4 uColorTint;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 rgb2hsl(vec3 c) {
        float cmax = max(c.r, max(c.g, c.b));
        float cmin = min(c.r, min(c.g, c.b));
        float delta = cmax - cmin;
        float l = 0.5 * (cmax + cmin);
        float s = 0.0;
        if (delta > 0.0001) {
          s = delta / (1.0 - abs(2.0 * l - 1.0) + 0.0001);
        }
        float h = 0.0;
        if (delta > 0.0001) {
          if (cmax == c.r) h = mod((c.g - c.b) / delta, 6.0);
          else if (cmax == c.g) h = (c.b - c.r) / delta + 2.0;
          else h = (c.r - c.g) / delta + 4.0;
          h /= 6.0;
          if (h < 0.0) h += 1.0;
        }
        return vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
      }

      float hue2rgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
        if (t < 0.5) return q;
        if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        return p;
      }

      vec3 hsl2rgb(vec3 hsl) {
        if (hsl.y <= 0.0001) return vec3(hsl.z);
        float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
        float p = 2.0 * hsl.z - q;
        return vec3(
          hue2rgb(p, q, hsl.x + 1.0 / 3.0),
          hue2rgb(p, q, hsl.x),
          hue2rgb(p, q, hsl.x - 1.0 / 3.0)
        );
      }

      float hueDist(float h, float center) {
        float d = abs(h - center);
        return min(d, 1.0 - d);
      }

      float evalChromaAlpha(vec4 col) {
        if (uChromaOn < 0.5) return col.a;
        float y = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
        float cb = -0.168736 * col.r - 0.331264 * col.g + 0.5 * col.b;
        float cr = 0.5 * col.r - 0.418688 * col.g - 0.081312 * col.b;
        float ky = 0.299 * uChromaKey.r + 0.587 * uChromaKey.g + 0.114 * uChromaKey.b;
        float kcb = -0.168736 * uChromaKey.r - 0.331264 * uChromaKey.g + 0.5 * uChromaKey.b;
        float kcr = 0.5 * uChromaKey.r - 0.418688 * uChromaKey.g - 0.081312 * uChromaKey.b;
        float dist = length(vec2(cb - kcb, cr - kcr)) + 0.15 * abs(y - ky);
        return col.a * smoothstep(uChromaSim, uChromaSim + max(0.005, uChromaSmooth), dist);
      }

      void main() {
        vec2 uv = vUv;
        if (uStab.w > 1.0005 || abs(uStab.x) > 0.0001 || abs(uStab.y) > 0.0001 || abs(uStab.z) > 0.0001) {
          float stabAsp = uTexel.y / max(1e-6, uTexel.x);
          float cs = cos(uStab.z);
          float sn = sin(uStab.z);
          vec2 p = (uv - 0.5) / max(1.0, uStab.w);
          p.x *= stabAsp;
          vec2 rp = vec2(p.x * cs + p.y * sn, -p.x * sn + p.y * cs);
          rp.x /= max(0.1, stabAsp);
          uv = clamp(rp - uStab.xy + 0.5, 0.0, 1.0);
        }
        float vfxType = uVfx.x;
        float vfxInt = uVfx.y;
        float vfxTime = uVfx.z;

        // Shake Cam UV jitter (4)
        if (vfxType > 3.5 && vfxType < 4.5 && vfxInt > 0.01) {
          float zoomComp = 1.0 - 0.06 * vfxInt;
          vec2 shakeOff = vec2(
            sin(vfxTime * 29.0) * 0.022,
            cos(vfxTime * 37.0) * 0.022
          ) * vfxInt;
          uv = (uv - 0.5) * zoomComp + 0.5 + shakeOff;
        }

        // Glitch horizontal block shift (1)
        if (vfxType > 0.5 && vfxType < 1.5 && vfxInt > 0.01) {
          float band = floor(uv.y * 20.0);
          float trigger = step(0.68, hash12(vec2(band, floor(vfxTime * 14.0))));
          float shift = (hash12(vec2(band + 7.0, floor(vfxTime * 18.0))) - 0.5) * 0.14 * vfxInt * trigger;
          uv.x = clamp(uv.x + shift, 0.0, 1.0);
        }

        // VHS horizontal tape wobble (3)
        if (vfxType > 2.5 && vfxType < 3.5 && vfxInt > 0.01) {
          float wob = sin(uv.y * 18.0 + vfxTime * 9.0) * 0.008 * vfxInt;
          uv.x = clamp(uv.x + wob, 0.0, 1.0);
        }

        // Pixelate / Mosaic (9)
        if (vfxType > 8.5 && vfxType < 9.5 && vfxInt > 0.01) {
          float cells = mix(140.0, 18.0, vfxInt);
          uv = (floor(uv * cells) + 0.5) / cells;
        }

        // 2x2 Mirror Grid Clone (10)
        if (vfxType > 9.5 && vfxType < 10.5 && vfxInt > 0.01) {
          vec2 scaled = uv * 2.0;
          vec2 tile = floor(scaled);
          vec2 fuv = fract(scaled);
          if (mod(tile.x, 2.0) > 0.5) fuv.x = 1.0 - fuv.x;
          if (mod(tile.y, 2.0) > 0.5) fuv.y = 1.0 - fuv.y;
          uv = mix(uv, fuv, clamp(vfxInt * 1.4, 0.0, 1.0));
        }

        // Fisheye 180 (12)
        if (vfxType > 11.5 && vfxType < 12.5 && vfxInt > 0.01) {
          vec2 d = uv - 0.5;
          float r = length(d);
          float bind = 0.707;
          float power = mix(0.0, 1.6, vfxInt);
          if (r > 0.001) {
            uv = 0.5 + normalize(d) * tan(r * power) * bind / max(0.01, tan(bind * power));
          }
        }

        // CRT Barrel Curve (14)
        if (vfxType > 13.5 && vfxType < 14.5 && vfxInt > 0.01) {
          vec2 dc = uv - 0.5;
          float d2 = dot(dc, dc);
          uv = uv + dc * (d2 * 0.35 * vfxInt);
        }

        vec4 c = texture2D(uTex, clamp(uv, 0.0, 1.0));

        // Zoom Blur (13)
        if (vfxType > 12.5 && vfxType < 13.5 && vfxInt > 0.01) {
          vec2 dir = (0.5 - uv) * 0.035 * vfxInt;
          vec4 zb = c * 0.28;
          zb += texture2D(uTex, clamp(uv + dir * 0.5, 0.0, 1.0)) * 0.22;
          zb += texture2D(uTex, clamp(uv + dir * 1.0, 0.0, 1.0)) * 0.20;
          zb += texture2D(uTex, clamp(uv + dir * 1.6, 0.0, 1.0)) * 0.16;
          zb += texture2D(uTex, clamp(uv + dir * 2.2, 0.0, 1.0)) * 0.14;
          c = zb;
        }

        // RGB Split / Glitch Chromatic Shift (1, 2)
        if ((vfxType > 0.5 && vfxType < 2.5) && vfxInt > 0.01) {
          float rgbOff = (vfxType < 1.5 ? 0.014 : 0.022) * vfxInt;
          float rCh = texture2D(uTex, clamp(uv + vec2(rgbOff, 0.0), 0.0, 1.0)).r;
          float bCh = texture2D(uTex, clamp(uv - vec2(rgbOff, 0.0), 0.0, 1.0)).b;
          c.r = rCh;
          c.b = bCh;
        }

        if (uBlur > 0.01) {
          vec2 off = uTexel * uBlur;
          vec4 acc = c * 0.25;
          acc += texture2D(uTex, clamp(uv + vec2(off.x, 0.0), 0.0, 1.0)) * 0.125;
          acc += texture2D(uTex, clamp(uv - vec2(off.x, 0.0), 0.0, 1.0)) * 0.125;
          acc += texture2D(uTex, clamp(uv + vec2(0.0, off.y), 0.0, 1.0)) * 0.125;
          acc += texture2D(uTex, clamp(uv - vec2(0.0, off.y), 0.0, 1.0)) * 0.125;
          acc += texture2D(uTex, clamp(uv + vec2(off.x, off.y), 0.0, 1.0)) * 0.0625;
          acc += texture2D(uTex, clamp(uv + vec2(-off.x, off.y), 0.0, 1.0)) * 0.0625;
          acc += texture2D(uTex, clamp(uv + vec2(off.x, -off.y), 0.0, 1.0)) * 0.0625;
          acc += texture2D(uTex, clamp(uv + vec2(-off.x, -off.y), 0.0, 1.0)) * 0.0625;
          c = acc;
        }

        // Sharpen
        if (uSharpen > 0.01) {
          vec3 n0 = texture2D(uTex, clamp(uv + vec2(uTexel.x, 0.0), 0.0, 1.0)).rgb;
          vec3 n1 = texture2D(uTex, clamp(uv - vec2(uTexel.x, 0.0), 0.0, 1.0)).rgb;
          vec3 n2 = texture2D(uTex, clamp(uv + vec2(0.0, uTexel.y), 0.0, 1.0)).rgb;
          vec3 n3 = texture2D(uTex, clamp(uv - vec2(0.0, uTexel.y), 0.0, 1.0)).rgb;
          vec3 sharpRgb = c.rgb * (1.0 + 2.4 * uSharpen) - (n0 + n1 + n2 + n3) * (0.6 * uSharpen);
          c.rgb = clamp(sharpRgb, 0.0, 1.0);
        }

        // Dream Glow bloom (8)
        if (vfxType > 7.5 && vfxType < 8.5 && vfxInt > 0.01) {
          vec2 boff = uTexel * (4.0 + 6.0 * vfxInt);
          vec3 bloom = (
            texture2D(uTex, clamp(uv + vec2(boff.x, 0.0), 0.0, 1.0)).rgb +
            texture2D(uTex, clamp(uv - vec2(boff.x, 0.0), 0.0, 1.0)).rgb +
            texture2D(uTex, clamp(uv + vec2(0.0, boff.y), 0.0, 1.0)).rgb +
            texture2D(uTex, clamp(uv - vec2(0.0, boff.y), 0.0, 1.0)).rgb
          ) * 0.25;
          c.rgb = mix(c.rgb, max(c.rgb, bloom * 1.18), 0.55 * vfxInt);
        }

        // Neon Edge Glow (11)
        if (vfxType > 10.5 && vfxType < 11.5 && vfxInt > 0.01) {
          vec2 eo = uTexel * 2.0;
          float lL = dot(texture2D(uTex, clamp(uv - vec2(eo.x, 0.0), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float lR = dot(texture2D(uTex, clamp(uv + vec2(eo.x, 0.0), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float lU = dot(texture2D(uTex, clamp(uv - vec2(0.0, eo.y), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float lD = dot(texture2D(uTex, clamp(uv + vec2(0.0, eo.y), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float edge = clamp(length(vec2(lR - lL, lD - lU)) * 3.8, 0.0, 1.0);
          vec3 neon = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.25, 0.55), sin(vfxTime * 3.0 + uv.x * 4.0) * 0.5 + 0.5) * edge;
          c.rgb = mix(c.rgb, max(c.rgb * 0.35, neon), vfxInt);
        }

        if (uChromaOn > 0.5) {
          c.a = evalChromaAlpha(c);
          if (uChromaSpill > 0.005) {
            float cy = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
            float ccb = -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
            float ccr = 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
            float kcb = -0.168736 * uChromaKey.r - 0.331264 * uChromaKey.g + 0.5 * uChromaKey.b;
            float kcr = 0.5 * uChromaKey.r - 0.418688 * uChromaKey.g - 0.081312 * uChromaKey.b;
            float kMagSq = kcb * kcb + kcr * kcr;
            if (kMagSq > 0.0002) {
              float proj = (ccb * kcb + ccr * kcr) / kMagSq;
              if (proj > 0.0) {
                float spillAmt = uChromaSpill * clamp(1.15 - c.a, 0.12, 1.0);
                float ncb = ccb - kcb * proj * spillAmt;
                float ncr = ccr - kcr * proj * spillAmt;
                c.r = clamp(cy + 1.402 * ncr, 0.0, 1.0);
                c.g = clamp(cy - 0.344136 * ncb - 0.714136 * ncr, 0.0, 1.0);
                c.b = clamp(cy + 1.772 * ncb, 0.0, 1.0);
              }
            }
          }
        }

        // Subject / Cutout Outline Stroke
        if (uOutlineW > 0.005) {
          vec2 oo = uTexel * (uOutlineW * 12.0);
          float maxA = 0.0;
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(oo.x, 0.0), 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv - vec2(oo.x, 0.0), 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(0.0, oo.y), 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv - vec2(0.0, oo.y), 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(oo.x, oo.y) * 0.7, 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(-oo.x, oo.y) * 0.7, 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(oo.x, -oo.y) * 0.7, 0.0, 1.0))));
          maxA = max(maxA, evalChromaAlpha(texture2D(uTex, clamp(uv + vec2(-oo.x, -oo.y) * 0.7, 0.0, 1.0))));
          float ring = smoothstep(0.15, 0.75, maxA) * (1.0 - smoothstep(0.2, 0.75, c.a));
          c.rgb = mix(c.rgb, uOutlineCol, ring);
          c.a = max(c.a, ring * maxA);
        }

        // Color Adjust
        c.rgb *= exp2(uExposure * 1.4);
        c.r += uTemp * 0.14 + uTint * 0.06;
        c.g += uTemp * 0.02 - uTint * 0.10;
        c.b -= uTemp * 0.14 - uTint * 0.06;
        c.rgb += uBright * 0.45;
        float lumAdj = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        float shadowW = pow(clamp(1.0 - lumAdj, 0.0, 1.0), 1.6);
        float highW = pow(clamp(lumAdj, 0.0, 1.0), 1.6);
        c.rgb += uShadows * 0.35 * shadowW + uHighlights * 0.35 * highW;
        c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(vec3(lum), c.rgb, uSat);

        // 8-Channel Selective HSL (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta)
        vec3 hsl = rgb2hsl(clamp(c.rgb, 0.0, 1.0));
        if (hsl.y > 0.04) {
          float w0 = max(0.0, 1.0 - hueDist(hsl.x, 0.0) / 0.09);
          float w1 = max(0.0, 1.0 - hueDist(hsl.x, 0.083) / 0.08);
          float w2 = max(0.0, 1.0 - hueDist(hsl.x, 0.166) / 0.08);
          float w3 = max(0.0, 1.0 - hueDist(hsl.x, 0.333) / 0.12);
          float w4 = max(0.0, 1.0 - hueDist(hsl.x, 0.500) / 0.10);
          float w5 = max(0.0, 1.0 - hueDist(hsl.x, 0.666) / 0.11);
          float w6 = max(0.0, 1.0 - hueDist(hsl.x, 0.777) / 0.09);
          float w7 = max(0.0, 1.0 - hueDist(hsl.x, 0.900) / 0.09);
          vec3 adj = w0 * uHsl[0] + w1 * uHsl[1] + w2 * uHsl[2] + w3 * uHsl[3] + w4 * uHsl[4] + w5 * uHsl[5] + w6 * uHsl[6] + w7 * uHsl[7];
          if (abs(adj.x) + abs(adj.y) + abs(adj.z) > 0.001) {
            hsl.x = fract(hsl.x + adj.x * 0.18 + 1.0);
            hsl.y = clamp(hsl.y + adj.y * 0.85, 0.0, 1.0);
            hsl.z = clamp(hsl.z + adj.z * 0.35, 0.0, 1.0);
            c.rgb = hsl2rgb(hsl);
          }
        }

        if (uFade > 0.005) {
          c.rgb = mix(c.rgb, max(c.rgb, vec3(0.16)), uFade);
        }

        // Independent Film Grain
        if (uGrain > 0.005) {
          float gVal = (hash12(uv * 540.0 + fract(vfxTime * 19.0 + 0.37) * 77.0) - 0.5) * 0.28 * uGrain;
          c.rgb += vec3(gVal);
        }

        // VHS Retro tint + scanlines (3)
        if (vfxType > 2.5 && vfxType < 3.5 && vfxInt > 0.01) {
          float scan = 0.88 + 0.12 * sin(uv.y * 420.0);
          float gr = (hash12(uv * 320.0 + fract(vfxTime) * 53.0) - 0.5) * 0.14 * vfxInt;
          c.rgb = c.rgb * scan + vec3(gr);
          c.r += 0.04 * vfxInt;
        }
        // Flash Pulse (5)
        if (vfxType > 4.5 && vfxType < 5.5 && vfxInt > 0.01) {
          float pulse = pow(max(0.0, sin(vfxTime * 8.0)), 4.0);
          c.rgb += vec3(pulse * 0.55 * vfxInt);
        }
        // Film Grain VFX (6)
        if (vfxType > 5.5 && vfxType < 6.5 && vfxInt > 0.01) {
          float gr = (hash12(uv * 512.0 + fract(vfxTime * 24.0) * 91.0) - 0.5) * 0.24 * vfxInt;
          c.rgb += vec3(gr);
        }
        // Night Vision (7)
        if (vfxType > 6.5 && vfxType < 7.5 && vfxInt > 0.01) {
          float nl = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          float scan = 0.84 + 0.16 * sin(uv.y * 360.0);
          vec3 nvg = vec3(nl * 0.25, nl * 1.35 + 0.08, nl * 0.35) * scan;
          c.rgb = mix(c.rgb, nvg, vfxInt);
        }
        // CRT Scanline Phosphor (14)
        if (vfxType > 13.5 && vfxType < 14.5 && vfxInt > 0.01) {
          float sc = 0.78 + 0.22 * sin(uv.y * 380.0);
          float ph = 0.90 + 0.10 * cos(uv.x * 460.0);
          c.rgb *= mix(1.0, sc * ph, vfxInt);
        }
        // Comic Halftone Dots (15)
        if (vfxType > 14.5 && vfxType < 15.5 && vfxInt > 0.01) {
          vec2 cell = fract(uv * 72.0) - 0.5;
          float htLum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          float dotMask = smoothstep(htLum * 0.55 + 0.06, htLum * 0.55 - 0.06, length(cell));
          c.rgb = mix(c.rgb, c.rgb * (0.55 + 0.75 * dotMask), vfxInt);
        }
        // Black Strobe Beat (16)
        if (vfxType > 15.5 && vfxType < 16.5 && vfxInt > 0.01) {
          float blk = step(0.45, sin(vfxTime * 18.0));
          c.rgb *= mix(1.0, 1.0 - blk * 0.88, vfxInt);
        }

        if (uVignette > 0.005) {
          float vd = distance(vUv, vec2(0.5)) * 1.414;
          float vig = smoothstep(0.35, 1.05, vd);
          c.rgb *= (1.0 - vig * uVignette * 0.85);
        }
        if (uColorTint.a > 0.005) {
          c.rgb = mix(c.rgb, clamp(c.rgb * uColorTint.rgb * 1.15 + uColorTint.rgb * 0.25, 0.0, 1.0), uColorTint.a);
        }
        c.rgb = clamp(c.rgb, 0.0, 1.0);

        // Crop bounds (left, top, right, bottom)
        if (vUv.x < uCropRect.x || vUv.x > (1.0 - uCropRect.z) || vUv.y < uCropRect.y || vUv.y > (1.0 - uCropRect.w)) {
          c.a = 0.0;
        }

        // 7 Mask Shapes + Mask Rotation
        if (uMaskType > 0.5) {
          vec2 centered = vUv - vec2(0.5 + uMaskRect.x, 0.5 + uMaskRect.y);
          float cs = cos(-uMaskRot);
          float sn = sin(-uMaskRot);
          vec2 rCent = vec2(centered.x * cs - centered.y * sn, centered.x * sn + centered.y * cs);
          vec2 mp = rCent / max(vec2(0.02), uMaskRect.zw * 0.5);
          float sd = 0.0;
          if (uMaskType < 1.5) {
            // 1: Rectangle
            vec2 mq = abs(mp) - vec2(1.0);
            sd = max(mq.x, mq.y);
          } else if (uMaskType < 2.5) {
            // 2: Circle / Ellipse
            sd = length(mp) - 1.0;
          } else if (uMaskType < 3.5) {
            // 3: Split linear half-plane
            sd = mp.y;
          } else if (uMaskType < 4.5) {
            // 4: Filmstrip horizontal mirror band
            sd = abs(mp.y) - 1.0;
          } else if (uMaskType < 5.5) {
            // 5: Heart SDF
            vec2 hp = vec2(abs(mp.x), -mp.y) * 0.85 + vec2(0.0, 0.5);
            if (hp.y + hp.x > 1.0) sd = length(hp - vec2(0.25, 0.75)) - 0.3535;
            else sd = min(length(hp - vec2(0.0, 1.0)), length(hp - vec2(0.5 * max(hp.x + hp.y, 0.0)))) * sign(hp.x - hp.y);
            sd *= 1.4;
          } else {
            // 6: 5-Point Star polar SDF (top point upward)
            float ang = atan(mp.y, mp.x);
            float rStar = 0.68 + 0.30 * cos(5.0 * ang + 1.5708);
            sd = length(mp) - rStar;
          }
          float fth = max(0.004, uMaskFeather * 2.0);
          float mAlpha = 1.0 - smoothstep(-fth, fth, sd);
          if (uMaskInvert > 0.5) mAlpha = 1.0 - mAlpha;
          c.a *= mAlpha;
        }

        if (uWipe.x > 0.5) {
          float p = clamp(uWipe.y, 0.0, 1.0);
          float soft = 0.03;
          if (uWipe.x < 1.5) {
            float e = mix(-soft, 1.0 + soft, p);
            c.a *= 1.0 - smoothstep(e - soft, e + soft, vUv.x);
          } else if (uWipe.x < 2.5) {
            float e = mix(1.0 + soft, -soft, p);
            c.a *= smoothstep(e - soft, e + soft, vUv.x);
          } else if (uWipe.x < 3.5) {
            float e = mix(1.0 + soft, -soft, p);
            c.a *= smoothstep(e - soft, e + soft, vUv.y);
          } else if (uWipe.x < 4.5) {
            float e = mix(-soft, 1.0 + soft, p);
            c.a *= 1.0 - smoothstep(e - soft, e + soft, vUv.y);
          } else {
            float e = mix(-soft, 0.72 + soft, p);
            c.a *= 1.0 - smoothstep(e - soft, e + soft, distance(vUv, vec2(0.5)));
          }
        }

        float outAlpha = c.a * uAlpha;
        if (uPremul > 0.5) {
          c.rgb *= outAlpha;
        }
        gl_FragColor = vec4(c.rgb, outAlpha);
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('WebGL shader compile failed:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('WebGL program link failed:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5,  0, 1,
       0.5, -0.5,  1, 1,
      -0.5,  0.5,  0, 0,
       0.5,  0.5,  1, 0
    ]), gl.STATIC_DRAW);

    const fboPosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fboPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5,  0, 0,
       0.5, -0.5,  1, 0,
      -0.5,  0.5,  0, 1,
       0.5,  0.5,  1, 1
    ]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUv = gl.getAttribLocation(prog, 'aUv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const uTex = gl.getUniformLocation(prog, 'uTex');
    gl.uniform1i(uTex, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return {
      gl,
      prog,
      posBuf,
      fboPosBuf,
      aPos,
      aUv,
      adjTex: null,
      uMvp: gl.getUniformLocation(prog, 'uMvp'),
      uAlpha: gl.getUniformLocation(prog, 'uAlpha'),
      uPremul: gl.getUniformLocation(prog, 'uPremul'),
      uBright: gl.getUniformLocation(prog, 'uBright'),
      uContrast: gl.getUniformLocation(prog, 'uContrast'),
      uSat: gl.getUniformLocation(prog, 'uSat'),
      uTemp: gl.getUniformLocation(prog, 'uTemp'),
      uTint: gl.getUniformLocation(prog, 'uTint'),
      uExposure: gl.getUniformLocation(prog, 'uExposure'),
      uHighlights: gl.getUniformLocation(prog, 'uHighlights'),
      uShadows: gl.getUniformLocation(prog, 'uShadows'),
      uFade: gl.getUniformLocation(prog, 'uFade'),
      uSharpen: gl.getUniformLocation(prog, 'uSharpen'),
      uBlur: gl.getUniformLocation(prog, 'uBlur'),
      uVignette: gl.getUniformLocation(prog, 'uVignette'),
      uGrain: gl.getUniformLocation(prog, 'uGrain'),
      uTexel: gl.getUniformLocation(prog, 'uTexel'),
      uChromaOn: gl.getUniformLocation(prog, 'uChromaOn'),
      uChromaKey: gl.getUniformLocation(prog, 'uChromaKey'),
      uChromaSim: gl.getUniformLocation(prog, 'uChromaSim'),
      uChromaSmooth: gl.getUniformLocation(prog, 'uChromaSmooth'),
      uChromaSpill: gl.getUniformLocation(prog, 'uChromaSpill'),
      uOutlineW: gl.getUniformLocation(prog, 'uOutlineW'),
      uOutlineCol: gl.getUniformLocation(prog, 'uOutlineCol'),
      uMaskType: gl.getUniformLocation(prog, 'uMaskType'),
      uMaskRect: gl.getUniformLocation(prog, 'uMaskRect'),
      uMaskRot: gl.getUniformLocation(prog, 'uMaskRot'),
      uMaskFeather: gl.getUniformLocation(prog, 'uMaskFeather'),
      uMaskInvert: gl.getUniformLocation(prog, 'uMaskInvert'),
      uCropRect: gl.getUniformLocation(prog, 'uCropRect'),
      uStab: gl.getUniformLocation(prog, 'uStab'),
      uVfx: gl.getUniformLocation(prog, 'uVfx'),
      uWipe: gl.getUniformLocation(prog, 'uWipe'),
      uHsl: gl.getUniformLocation(prog, 'uHsl[0]'),
      uColorTint: gl.getUniformLocation(prog, 'uColorTint'),
      zeroHsl: new Float32Array(24),
      fxFboA: null,
      fxFboB: null,
      fxTexA: null,
      fxTexB: null,
      fxW: 0,
      fxH: 0,
      textures: new Map(),
      textureMeta: new Map()
    };
  }

  bindCompositorQuadBuffer(compositor, buf) {
    const { gl, aPos, aUv } = compositor;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  }

  ensureFxPingPong(compositor, w, h) {
    const { gl } = compositor;
    const fw = Math.max(2, Math.min(1920, Math.round(w)));
    const fh = Math.max(2, Math.min(1920, Math.round(h)));
    const createTarget = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    if (!compositor.fxFboA || !compositor.fxFboB) {
      const a = createTarget();
      const b = createTarget();
      compositor.fxTexA = a.tex;
      compositor.fxFboA = a.fbo;
      compositor.fxTexB = b.tex;
      compositor.fxFboB = b.fbo;
      compositor.fxW = fw;
      compositor.fxH = fh;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    if (compositor.fxW !== fw || compositor.fxH !== fh) {
      gl.bindTexture(gl.TEXTURE_2D, compositor.fxTexA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, compositor.fxTexB);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      compositor.fxW = fw;
      compositor.fxH = fh;
    }
  }

  copyFramebufferToAdjustmentTex(compositor, w, h) {
    const { gl } = compositor;
    if (!compositor.adjTex) {
      compositor.adjTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, compositor.adjTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, compositor.adjTex);
    }
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, Math.max(1, w), Math.max(1, h), 0);
    return compositor.adjTex;
  }

  getOrCreateTexture(compositor, key, sourceEl, cacheToken = null) {
    const { gl, textures, textureMeta } = compositor;
    const isVideo = Boolean(
      sourceEl && (sourceEl.tagName === 'VIDEO' || (typeof HTMLVideoElement !== 'undefined' && sourceEl instanceof HTMLVideoElement))
    );
    const sw = sourceEl?.videoWidth || sourceEl?.naturalWidth || sourceEl?.width || 0;
    const sh = sourceEl?.videoHeight || sourceEl?.naturalHeight || sourceEl?.height || 0;
    const srcId = sourceEl?.dataset?.srcUrl || sourceEl?.currentSrc || sourceEl?.src || '';

    let tex = textures.get(key);
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.set(key, tex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (sw > 0 && sh > 0 && textureMeta) {
        const meta = textureMeta.get(key);
        if (!isVideo) {
          if (meta && meta.el === sourceEl && meta.src === srcId && meta.w === sw && meta.h === sh && meta.token === cacheToken) {
            return tex;
          }
        } else if (
          meta &&
          meta.isVideo &&
          meta.el === sourceEl &&
          meta.src === srcId &&
          meta.w === sw &&
          meta.h === sh &&
          sourceEl.paused &&
          !sourceEl.seeking &&
          !sourceEl._wantsPlay &&
          Math.abs((meta.videoTime ?? -1) - (sourceEl.currentTime || 0)) < 0.001
        ) {
          return tex;
        }
      }
    }

    try {
      const maxTex = Math.min(2048, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048);
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const vfcStalled = Boolean(
        isVideo &&
        sourceEl._vfcSupported &&
        sourceEl._wantsPlay &&
        !sourceEl.paused &&
        (sourceEl._vfcCount || 0) === 0 &&
        (nowMs - (sourceEl._wantsPlaySinceMs || nowMs)) > 320
      );
      const useVideoScratch = Boolean(
        isVideo &&
        typeof document !== 'undefined' &&
        sw > 0 &&
        sh > 0 &&
        (sourceEl._forceScratchCopy || (sourceEl._stallCount || 0) >= 2 || vfcStalled)
      );
      if (sw > maxTex || sh > maxTex) {
        const scale = Math.min(maxTex / sw, maxTex / sh);
        const tw = Math.max(2, Math.round(sw * scale));
        const th = Math.max(2, Math.round(sh * scale));
        if (!this._safeTexCanvas) this._safeTexCanvas = document.createElement('canvas');
        if (this._safeTexCanvas.width !== tw || this._safeTexCanvas.height !== th) {
          this._safeTexCanvas.width = tw;
          this._safeTexCanvas.height = th;
        }
        const sctx = this._safeTexCanvas.getContext('2d');
        sctx.clearRect(0, 0, tw, th);
        sctx.drawImage(sourceEl, 0, 0, tw, th);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._safeTexCanvas);
      } else if (useVideoScratch) {
        if (!this._videoScratchCanvas) this._videoScratchCanvas = document.createElement('canvas');
        if (this._videoScratchCanvas.width !== sw || this._videoScratchCanvas.height !== sh) {
          this._videoScratchCanvas.width = sw;
          this._videoScratchCanvas.height = sh;
        }
        const vctx = this._videoScratchCanvas.getContext('2d');
        vctx.clearRect(0, 0, sw, sh);
        vctx.drawImage(sourceEl, 0, 0, sw, sh);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._videoScratchCanvas);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceEl);
      }
      if (!isVideo && sw > 0 && sh > 0 && textureMeta) {
        textureMeta.set(key, { isVideo: false, el: sourceEl, src: srcId, w: sw, h: sh, token: cacheToken });
      } else if (isVideo && sw > 0 && sh > 0 && textureMeta) {
        if (sourceEl.paused && !sourceEl.seeking && !sourceEl._wantsPlay && sourceEl.readyState >= 2) {
          textureMeta.set(key, {
            isVideo: true,
            el: sourceEl,
            src: srcId,
            w: sw,
            h: sh,
            videoTime: sourceEl.currentTime || 0
          });
        } else {
          textureMeta.delete(key);
        }
      }
    } catch {
      if (sw > 0 && sh > 0) {
        if (!this._safeTexCanvas) this._safeTexCanvas = document.createElement('canvas');
        const tw = Math.min(1920, sw);
        const th = Math.min(1920, sh);
        if (this._safeTexCanvas.width !== tw || this._safeTexCanvas.height !== th) {
          this._safeTexCanvas.width = tw;
          this._safeTexCanvas.height = th;
        }
        const sctx = this._safeTexCanvas.getContext('2d');
        sctx.clearRect(0, 0, tw, th);
        sctx.drawImage(sourceEl, 0, 0, tw, th);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._safeTexCanvas);
        } catch {}
      }
    }
    return tex;
  }

  getPreviewCanvasSize(project) {
    const pw = Math.max(2, Number(project?.width) || 1280);
    const ph = Math.max(2, Number(project?.height) || 720);
    const maxSide = Math.max(320, this.maxPreviewSide || 854);
    const longest = Math.max(pw, ph);
    if (longest <= maxSide) return { width: pw, height: ph };
    const scale = maxSide / longest;
    const w = Math.max(2, Math.round((pw * scale) / 2) * 2);
    const h = Math.max(2, Math.round((ph * scale) / 2) * 2);
    return { width: w, height: h };
  }

  syncCanvasDimensions(project) {
    const { width: prevW, height: prevH } = this.getPreviewCanvasSize(project);
    if (this.canvas.width !== prevW || this.canvas.height !== prevH) {
      this.canvas.width = prevW;
      this.canvas.height = prevH;
    }
    this.canvas.style.aspectRatio = `${project.width} / ${project.height}`;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(100, Math.round(rect.width || 360));
    const h = Math.max(100, Math.round(rect.height || 202));
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w;
      this.overlay.height = h;
      this.overlay.style.width = `${w}px`;
      this.overlay.style.height = `${h}px`;
    }
  }

  _getPreviewImageCanvas(mediaItem, img) {
    const nw = img?.naturalWidth || 0;
    const nh = img?.naturalHeight || 0;
    const cap = Math.max(640, this.maxPreviewImageSide || 1280);
    if (nw <= cap && nh <= cap) return null;
    const cached = this.previewImageCache.get(mediaItem.id);
    if (cached && cached.url === mediaItem.url && cached.origW === nw && cached.origH === nh && cached.canvas) {
      return cached.canvas;
    }
    if (typeof document === 'undefined') return null;
    const scale = Math.min(cap / nw, cap / nh);
    const tw = Math.max(2, Math.round(nw * scale));
    const th = Math.max(2, Math.round(nh * scale));
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    c.getContext('2d')?.drawImage(img, 0, 0, tw, th);
    this.previewImageCache.set(mediaItem.id, { url: mediaItem.url, canvas: c, origW: nw, origH: nh });
    return c;
  }

  getImageElement(mediaItem) {
    if (!mediaItem || !mediaItem.url) return null;
    const urlStr = String(mediaItem.url);
    if (mediaItem.isGif && !this.gifCache.has(mediaItem.id)) {
      this.gifCache.set(mediaItem.id, 'loading');
      decodeAnimatedGif(urlStr)
        .then((decoded) => {
          this.gifCache.set(mediaItem.id, decoded);
          this.onMediaFrameReady?.(mediaItem);
        })
        .catch(() => this.gifCache.delete(mediaItem.id));
    }
    if (this.imageCache.has(mediaItem.id)) {
      const existing = this.imageCache.get(mediaItem.id);
      if (existing.dataset.srcUrl === urlStr && existing.dataset.failed !== '1') {
        return existing;
      }
      this.imageCache.delete(mediaItem.id);
      this.previewImageCache.delete(mediaItem.id);
    }
    const img = new Image();
    const isExternalHttp = typeof window !== 'undefined' &&
      /^https?:\/\//i.test(urlStr) &&
      !urlStr.startsWith(window.location.origin);
    if (isExternalHttp) {
      img.crossOrigin = 'anonymous';
    }
    img.decoding = 'async';
    img.dataset.srcUrl = urlStr;
    img.dataset.failed = '0';
    img.onload = () => {
      img.dataset.failed = '0';
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(() => this.onMediaFrameReady?.(mediaItem));
      } else {
        this.onMediaFrameReady?.(mediaItem);
      }
    };
    img.onerror = () => {
      if (img.crossOrigin) {
        img.removeAttribute('crossOrigin');
        img.crossOrigin = null;
        img.src = urlStr;
        return;
      }
      img.dataset.failed = '1';
    };
    img.src = urlStr;
    this.imageCache.set(mediaItem.id, img);
    return img;
  }

  getGifFrameCanvas(mediaItem, layer, frame, fps) {
    const entry = this.gifCache.get(mediaItem.id);
    if (!entry || entry === 'loading' || !entry.frames?.length) return null;
    const speed = layer.speed || 1;
    const elapsedMs = Math.max(0, ((frame - layer.startFrame) * speed * 1000) / Math.max(1, fps));
    const loopMs = elapsedMs % entry.totalMs;
    const found = entry.frames.find((f) => loopMs >= f.startMs && loopMs < f.endMs);
    return (found || entry.frames[entry.frames.length - 1]).canvas;
  }

  _ensureHiddenVideoHost() {
    if (typeof document === 'undefined' || !document.body) return null;
    const stageParent = document.getElementById('previewStage') || document.body;
    if (this._videoHostEl && this._videoHostEl.isConnected && this._videoHostEl.parentElement === stageParent) {
      return this._videoHostEl;
    }
    let host = document.getElementById('mfHiddenVideoHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mfHiddenVideoHost';
      host.setAttribute('aria-hidden', 'true');
    }
    // Place inside previewStage at z-index:2 (above opaque previewCanvas z-index:1, below overlayCanvas z-index:3)
    // so Chromium/Android WebView compositor never treats <video> as occluded and keeps decoding live frames.
    host.style.cssText = 'position:absolute;right:0;bottom:0;width:24px;height:24px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:2;';
    if (host.parentElement !== stageParent) {
      stageParent.appendChild(host);
    }
    this._videoHostEl = host;
    return host;
  }

  captureVideoFallbackFrame(mediaId, vid) {
    if (!mediaId || !vid || vid.readyState < 2 || !vid.videoWidth || !vid.videoHeight) return null;
    let entry = this.videoLastFrameCache.get(mediaId);
    if (!entry) {
      entry = { canvas: document.createElement('canvas'), width: 0, height: 0 };
      this.videoLastFrameCache.set(mediaId, entry);
    }
    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    const scale = Math.min(1, 360 / Math.max(vw, vh));
    const cw = Math.max(2, Math.round(vw * scale));
    const ch = Math.max(2, Math.round(vh * scale));
    if (entry.canvas.width !== cw || entry.canvas.height !== ch) {
      entry.canvas.width = cw;
      entry.canvas.height = ch;
    }
    entry.width = vw;
    entry.height = vh;
    entry.canvas._mfVersion = (entry.canvas._mfVersion || 0) + 1;
    try {
      const ctx = entry.canvas.getContext('2d');
      ctx.drawImage(vid, 0, 0, cw, ch);
      return entry;
    } catch {
      return null;
    }
  }

  getVideoElement(mediaItem) {
    if (!mediaItem || !mediaItem.url) return null;
    if (this.videoCache.has(mediaItem.id)) {
      const existing = this.videoCache.get(mediaItem.id);
      if (existing.dataset.srcUrl === mediaItem.url) {
        this._touchVideoLru(mediaItem.id);
        const host = this._ensureHiddenVideoHost();
        if (host && !existing.isConnected) host.appendChild(existing);
        return existing;
      }
      this._releaseVideoDecoder(mediaItem.id, false);
    }
    const vid = document.createElement('video');
    const urlStr = String(mediaItem.url);
    const isExternalHttp = typeof window !== 'undefined' &&
      /^https?:\/\//i.test(urlStr) &&
      !urlStr.startsWith(window.location.origin);
    if (isExternalHttp) {
      vid.crossOrigin = 'anonymous';
    }
    vid.muted = true;
    vid.defaultMuted = true;
    vid.playsInline = true;
    vid.setAttribute('muted', '');
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', '');
    vid.preload = 'auto';
    vid.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;';
    vid.dataset.srcUrl = urlStr;
    vid._wantsPlay = false;
    vid._pendingPlayTargetTime = null;
    vid._lastSyncSeekMs = 0;
    vid._playInFlight = false;
    vid._stallCount = 0;
    vid._forceScratchCopy = false;
    vid._wantsPlaySinceMs = 0;
    vid._lastProgressWallMs = 0;
    vid._lastObservedMediaTime = undefined;
    vid._lastObservedTargetTime = undefined;
    vid._lastObservedVfcCount = 0;
    vid._vfcSupported = typeof vid.requestVideoFrameCallback === 'function';
    vid._vfcCount = 0;
    vid._vfcArmed = false;

    const armVfc = () => {
      if (!vid._vfcSupported || vid._vfcArmed || !vid._wantsPlay) return;
      vid._vfcArmed = true;
      try {
        vid.requestVideoFrameCallback(() => {
          vid._vfcArmed = false;
          vid._vfcCount = (vid._vfcCount || 0) + 1;
          vid._stallCount = 0;
          vid._forceScratchCopy = false;
          if (vid._wantsPlay && !vid.paused) armVfc();
        });
      } catch {
        vid._vfcArmed = false;
        vid._vfcSupported = false;
      }
    };
    vid._armVfc = armVfc;

    const safePlay = () => {
      if (vid._playInFlight || !vid._wantsPlay) return;
      vid._playInFlight = true;
      try {
        const p = vid.play?.();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            vid._playInFlight = false;
            armVfc();
          }).catch(() => {
            vid._playInFlight = false;
          });
        } else {
          vid._playInFlight = false;
          armVfc();
        }
      } catch {
        vid._playInFlight = false;
      }
    };

    const notifyReady = (captureFallback = false) => {
      if (captureFallback && vid.readyState >= 2 && vid.videoWidth > 0) {
        this.captureVideoFallbackFrame(mediaItem.id, vid);
      }
      this.onMediaFrameReady?.(mediaItem);
    };
    const maybeResumePendingPlay = () => {
      if (!vid._wantsPlay) return;
      if (vid._pendingPlayTargetTime !== null && vid._pendingPlayTargetTime !== undefined && vid.readyState >= 1) {
        const tgt = vid._pendingPlayTargetTime;
        vid._pendingPlayTargetTime = null;
        if (!vid.seeking && Math.abs(vid.currentTime - tgt) > 0.08) {
          vid._lastSyncSeekMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          try { vid.currentTime = tgt; } catch {}
        }
      }
      if (vid.paused && vid.readyState >= 1) {
        safePlay();
      } else if (!vid.paused) {
        armVfc();
      }
    };

    vid.addEventListener('loadedmetadata', () => {
      if (vid._wantsPlay) {
        maybeResumePendingPlay();
      } else if (vid._pendingSeekTime !== undefined && vid._pendingSeekTime !== null) {
        const nextT = vid._pendingSeekTime;
        vid._pendingSeekTime = null;
        try { vid.currentTime = nextT; } catch {}
      } else if (vid.readyState < 2 && vid.paused && !vid._primedFrame0) {
        vid._primedFrame0 = true;
        try { vid.currentTime = 0.001; } catch {}
      }
      notifyReady(false);
    });
    vid.addEventListener('loadeddata', () => {
      maybeResumePendingPlay();
      notifyReady(!vid._wantsPlay);
    });
    vid.addEventListener('canplay', () => {
      maybeResumePendingPlay();
      notifyReady(false);
    });
    vid.addEventListener('playing', () => {
      armVfc();
      notifyReady(false);
    });
    vid.addEventListener('seeked', () => {
      if (vid._wantsPlay) {
        vid._pendingSeekTime = null;
        if (vid.paused) safePlay();
        notifyReady(false);
        return;
      }
      if (vid._pendingSeekTime !== undefined && vid._pendingSeekTime !== null) {
        const nextT = vid._pendingSeekTime;
        vid._pendingSeekTime = null;
        if (Math.abs(vid.currentTime - nextT) > 0.025) {
          try { vid.currentTime = nextT; } catch {}
          return;
        }
      }
      notifyReady(true);
    });
    vid.addEventListener('ended', () => notifyReady(true));

    vid.src = urlStr;
    const host = this._ensureHiddenVideoHost();
    if (host) host.appendChild(vid);
    try { vid.load(); } catch {}
    this.videoCache.set(mediaItem.id, vid);
    return vid;
  }

  _computeVideoTargetTime(layer, frame, fps, vid, mediaItem) {
    const baseSec = (layer.mediaOffsetFrames || 0) / fps;
    const elapsedSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, frame - layer.startFrame) / fps;
    const spanSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, Math.max(1, layer.endFrame - layer.startFrame)) / fps;
    const knownDur = vid?.duration && isFinite(vid.duration) && vid.duration > 0
      ? vid.duration
      : (mediaItem?.durationMs ? mediaItem.durationMs / 1000 : null);
    let targetTime;
    if (layer.reversed) {
      const endWindow = knownDur ? Math.min(knownDur - 0.02, baseSec + spanSec) : baseSec + spanSec;
      targetTime = Math.max(0, endWindow - elapsedSec);
    } else {
      targetTime = Math.max(0, baseSec + elapsedSec);
    }
    return knownDur ? Math.max(0, Math.min(knownDur - 0.02, targetTime)) : Math.max(0, targetTime);
  }

  syncVideoPlayback(project, frame, mediaMap, isPlaying, shuttleRate = 1) {
    const fps = Math.max(1, project?.fps || 30);
    const activeMediaIds = new Set();
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const maxConcurrentDecoders = Math.max(1, this.maxVideoDecoders || 3);

    const triggerSafePlay = (vid) => {
      if (vid._playInFlight) return;
      vid._playInFlight = true;
      try {
        const p = vid.play?.();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            vid._playInFlight = false;
            vid._armVfc?.();
          }).catch(() => {
            vid._playInFlight = false;
          });
        } else {
          vid._playInFlight = false;
          vid._armVfc?.();
        }
      } catch {
        vid._playInFlight = false;
      }
    };

    if (isPlaying && shuttleRate > 0 && project && Array.isArray(project.layers)) {
      for (const layer of project.layers) {
        if (layer.type !== 'video' || !layer.visible || !layer.mediaId) continue;
        if (frame < layer.startFrame || frame > layer.endFrame) continue;
        const mediaItem = mediaMap.get(layer.mediaId);
        if (!mediaItem) continue;
        if (!activeMediaIds.has(mediaItem.id) && activeMediaIds.size >= maxConcurrentDecoders) continue;
        const vid = this.getVideoElement(mediaItem);
        if (!vid) continue;
        activeMediaIds.add(mediaItem.id);

        const targetTime = this._computeVideoTargetTime(layer, frame, fps, vid, mediaItem);
        if (layer.reversed) {
          vid._wantsPlay = false;
          if (!vid.paused) vid.pause();
          if (!vid.seeking && Math.abs(vid.currentTime - targetTime) > 0.03) {
            try { vid.currentTime = targetTime; } catch {}
          }
          continue;
        }

        const dur = Math.max(1, layer.endFrame - layer.startFrame);
        const normT = Math.max(0, Math.min(1, (frame - layer.startFrame) / dur));
        const rate = Math.max(
          0.25,
          Math.min(4.0, shuttleRate * (layer.speed || 1) * TimelineEngine.evaluateLayerSpeedFactor(layer, normT))
        );
        vid.muted = true;
        if (!vid._wantsPlay) {
          vid._wantsPlay = true;
          vid._wantsPlaySinceMs = nowMs;
          vid._lastProgressWallMs = nowMs;
          vid._lastObservedMediaTime = vid.currentTime;
          vid._lastObservedTargetTime = targetTime;
          vid._lastObservedVfcCount = vid._vfcCount || 0;
        }
        vid._armVfc?.();
        if (Math.abs((vid.playbackRate || 1) - rate) > 0.04) {
          try { vid.playbackRate = rate; } catch {}
        }

        if (vid.readyState === 0) {
          vid._pendingPlayTargetTime = targetTime;
          if (vid.networkState === 0) {
            try { vid.load(); } catch {}
          }
          triggerSafePlay(vid);
        } else if (vid.paused) {
          vid._pendingPlayTargetTime = null;
          if (!vid.seeking && Math.abs(vid.currentTime - targetTime) > 0.08) {
            vid._lastSyncSeekMs = nowMs;
            try { vid.currentTime = targetTime; } catch {}
          }
          triggerSafePlay(vid);
        } else if (vid.ended && targetTime < (vid.duration || targetTime) - 0.12) {
          vid._lastSyncSeekMs = nowMs;
          try { vid.currentTime = targetTime; } catch {}
          triggerSafePlay(vid);
        } else {
          // Track real frame/media progression to detect WebView SurfaceTexture/decoder stalls
          const mediaAdvanced = vid._lastObservedMediaTime === undefined ||
            Math.abs(vid.currentTime - vid._lastObservedMediaTime) > 0.004;
          const vfcAdvanced = (vid._vfcCount || 0) > (vid._lastObservedVfcCount || 0);
          if (mediaAdvanced || vfcAdvanced) {
            vid._lastObservedMediaTime = vid.currentTime;
            vid._lastObservedTargetTime = targetTime;
            vid._lastObservedVfcCount = vid._vfcCount || 0;
            vid._lastProgressWallMs = nowMs;
            if (mediaAdvanced && (!vid._vfcSupported || vfcAdvanced)) {
              vid._stallCount = 0;
              vid._forceScratchCopy = false;
            }
          } else if (
            vid.readyState >= 2 &&
            !vid.seeking &&
            (nowMs - (vid._lastProgressWallMs || nowMs)) > 170 &&
            Math.abs(targetTime - (vid._lastObservedTargetTime ?? targetTime)) > 0.08
          ) {
            vid._stallCount = (vid._stallCount || 0) + 1;
            vid._lastProgressWallMs = nowMs;
            vid._lastObservedTargetTime = targetTime;
            if (vid._stallCount >= 2) {
              vid._forceScratchCopy = true;
            }
          }

          if ((vid._stallCount || 0) >= 2) {
            // Decoder stalled: step-seek cleanly at ~24fps to guarantee live frame progression
            if (!vid.seeking && Math.abs(vid.currentTime - targetTime) > 0.04 && nowMs - (vid._lastSyncSeekMs || 0) > 40) {
              vid._lastSyncSeekMs = nowMs;
              try { vid.currentTime = targetTime; } catch {}
            }
          } else if (
            !vid.seeking &&
            Math.abs(vid.currentTime - targetTime) > 0.75 &&
            nowMs - (vid._lastSyncSeekMs || 0) > 700
          ) {
            vid._lastSyncSeekMs = nowMs;
            try { vid.currentTime = targetTime; } catch {}
          }
        }
      }

      // Pre-warm upcoming video clips starting within 1.5s ahead (so Image -> Video cuts render immediately)
      const lookaheadFrames = Math.round(fps * 1.5);
      for (const layer of project.layers) {
        if (layer.type !== 'video' || !layer.visible || !layer.mediaId) continue;
        if (layer.startFrame <= frame || layer.startFrame > frame + lookaheadFrames) continue;
        const mediaItem = mediaMap.get(layer.mediaId);
        if (!mediaItem || activeMediaIds.has(mediaItem.id)) continue;
        if (activeMediaIds.size >= maxConcurrentDecoders) break;
        const vid = this.getVideoElement(mediaItem);
        if (!vid) continue;
        activeMediaIds.add(mediaItem.id);
        vid._wantsPlay = false;
        if (!vid.paused) {
          try { vid.pause(); } catch {}
        }
        const entryTarget = this._computeVideoTargetTime(layer, layer.startFrame, fps, vid, mediaItem);
        if (vid.readyState >= 1 && !vid.seeking && Math.abs(vid.currentTime - entryTarget) > 0.05) {
          try { vid.currentTime = entryTarget; } catch {}
        }
      }
    }

    for (const [id, vid] of this.videoCache.entries()) {
      if (!activeMediaIds.has(id)) {
        const wasPlaying = vid._wantsPlay || !vid.paused;
        vid._wantsPlay = false;
        vid._wantsPlaySinceMs = 0;
        vid._pendingPlayTargetTime = null;
        vid._stallCount = 0;
        vid._forceScratchCopy = false;
        if (!vid.paused) {
          try { vid.pause(); } catch {}
        }
        if (wasPlaying && vid.readyState >= 2 && vid.videoWidth > 0) {
          this.captureVideoFallbackFrame(id, vid);
        }
      }
    }
    this._enforceVideoDecoderBudget?.(project, frame, activeMediaIds);
  }

  async seekVideosForFrame(project, frame, mediaMap, awaitSeek = false) {
    const fps = Math.max(1, project.fps || 30);
    const promises = [];
    const activeSeekIds = new Set();

    for (const layer of project.layers) {
      if (layer.type !== 'video' || !layer.visible || !layer.mediaId) continue;
      if (frame < layer.startFrame || frame > layer.endFrame) continue;
      const mediaItem = mediaMap.get(layer.mediaId);
      if (!mediaItem) continue;
      const vid = this.getVideoElement(mediaItem);
      if (!vid) continue;
      activeSeekIds.add(mediaItem.id);
      if (!awaitSeek) {
        vid._wantsPlay = false;
        vid._wantsPlaySinceMs = 0;
      }
      if (!awaitSeek && !vid.paused) {
        if (vid.readyState >= 2 && vid.videoWidth > 0) {
          this.captureVideoFallbackFrame(mediaItem.id, vid);
        }
        try { vid.pause(); } catch {}
      }

      const clampedTime = this._computeVideoTargetTime(layer, frame, fps, vid, mediaItem);
      if (!isFinite(clampedTime) || clampedTime < 0) continue;

      const seekThreshold = awaitSeek ? 0.004 : 0.022;
      const needsSeek = Math.abs(vid.currentTime - clampedTime) > seekThreshold;
      const needsDecode = awaitSeek && vid.readyState < 2;
      if (needsSeek || needsDecode) {
        if (awaitSeek) {
          vid._pendingSeekTime = null;
          promises.push(
            new Promise((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                vid.removeEventListener('seeked', done);
                vid.removeEventListener('loadeddata', done);
                vid.removeEventListener('canplay', done);
                if (vid.readyState >= 2 && vid.videoWidth > 0) {
                  this.captureVideoFallbackFrame(mediaItem.id, vid);
                }
                resolve();
              };
              vid.addEventListener('seeked', done, { once: true });
              vid.addEventListener('loadeddata', done, { once: true });
              vid.addEventListener('canplay', done, { once: true });
              if (needsSeek) {
                try { vid.currentTime = clampedTime; } catch {}
              } else if (vid.readyState < 2) {
                try { vid.currentTime = clampedTime > 0 ? clampedTime : 0.001; } catch {}
              }
              setTimeout(done, 480);
            })
          );
        } else if (vid.readyState < 1 || vid.seeking) {
          // Coalesce rapid scrub seeks or pre-metadata seeks so hardware decoder finishes frames cleanly
          vid._pendingSeekTime = clampedTime;
        } else {
          try { vid.currentTime = clampedTime; } catch {}
        }
      }
    }
    this._enforceVideoDecoderBudget?.(project, frame, activeSeekIds);
    if (awaitSeek && promises.length > 0) await Promise.all(promises);
  }

  _formatRichTextLines(tp) {
    let raw = String(tp.text || '');
    if (tp.textCase === 'upper') raw = raw.toUpperCase();
    else if (tp.textCase === 'lower') raw = raw.toLowerCase();
    return raw.split('\n');
  }

  _measureLineWithSpacing(ctx, line, letterSpacing) {
    if (!letterSpacing) return ctx.measureText(line).width;
    let total = 0;
    for (let i = 0; i < line.length; i++) {
      total += ctx.measureText(line[i]).width + (i < line.length - 1 ? letterSpacing : 0);
    }
    return total;
  }

  _drawLineWithSpacing(ctx, line, xOffset, y, align, letterSpacing, isStroke) {
    const totalW = this._measureLineWithSpacing(ctx, line, letterSpacing);
    let cursorX = align === 'center' ? xOffset - totalW / 2 : align === 'right' ? xOffset - totalW : xOffset;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (isStroke) ctx.strokeText(ch, cursorX, y);
      else ctx.fillText(ch, cursorX, y);
      cursorX += ctx.measureText(ch).width + letterSpacing;
    }
    ctx.textAlign = prevAlign;
  }

  getOrRasterizeVectorLayer(layer, frame = 0) {
    let w = Math.max(2, Math.ceil(layer.width || 300));
    let h = Math.max(2, Math.ceil(layer.height || 200));
    const animColor = layer.type === 'text' && layer.textProps
      ? KeyframeEngine.getColorAtFrame(layer, frame, layer.textProps.color || '#FFFFFF')
      : layer.type === 'shape' && layer.shapeProps
        ? KeyframeEngine.getColorAtFrame(layer, frame, layer.shapeProps.fillColor || '#7C4DFF')
        : null;
    const key = JSON.stringify({
      type: layer.type,
      w,
      h,
      animColor,
      textProps: layer.textProps,
      shapeProps: layer.shapeProps
    });
    const cached = this.rasterCache.get(layer.id);
    if (cached && cached.key === key) return cached.canvas;

    const pad = 56; // extra margin for drop shadow / stroke / curve
    const c = cached?.canvas || document.createElement('canvas');
    const ctx = c.getContext('2d');

    let lines = [];
    let fontSize = 64;
    let lineHeight = 72;
    let bgPad = 0;
    let letterSpacing = 0;
    let curveDeg = 0;
    if (layer.type === 'text' && layer.textProps) {
      const tp = layer.textProps;
      fontSize = tp.fontSize || 64;
      const fontStyle = tp.italic ? 'italic ' : '';
      ctx.font = `${fontStyle}${tp.fontWeight || '700'} ${fontSize}px "${tp.fontFamily || 'sans-serif'}", sans-serif`;
      lines = this._formatRichTextLines(tp);
      lineHeight = fontSize * (Number(tp.lineHeight) || 1.18);
      letterSpacing = Number(tp.letterSpacing) || 0;
      curveDeg = Number(tp.curve) || 0;
      const strokeExtra = (tp.strokeWidth || 0) * 2;
      bgPad = tp.bgEnabled ? Math.max(8, Number(tp.bgPadding ?? 20)) : 0;
      const maxLineW = lines.reduce((acc, ln) => Math.max(acc, this._measureLineWithSpacing(ctx, ln, letterSpacing)), 20);
      const curvePadH = Math.abs(curveDeg) > 1 ? Math.round(maxLineW * Math.min(0.45, Math.abs(curveDeg) / 220)) : 0;
      w = Math.max(w, Math.ceil(maxLineW + strokeExtra + bgPad * 2 + 12));
      h = Math.max(h, Math.ceil(lines.length * lineHeight + strokeExtra + bgPad * 1.4 + curvePadH));
    }

    const cw = w + pad * 2;
    const ch = h + pad * 2;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);

    if (layer.type === 'text' && layer.textProps) {
      const tp = layer.textProps;
      if (tp.bgEnabled) {
        ctx.save();
        ctx.globalAlpha = tp.bgOpacity ?? 0.78;
        ctx.fillStyle = tp.bgColor || '#0B0E14';
        const rad = Math.min(Number(tp.bgRadius ?? 16), w / 2, h / 2);
        this.roundRectPath(ctx, -w / 2, -h / 2, w, h, Math.max(0, rad));
        ctx.fill();
        ctx.restore();
      }
      const fontStyle = tp.italic ? 'italic ' : '';
      ctx.font = `${fontStyle}${tp.fontWeight || '700'} ${fontSize}px "${tp.fontFamily || 'sans-serif'}", sans-serif`;
      ctx.textAlign = tp.align || 'center';
      ctx.textBaseline = 'middle';
      if ((tp.shadowBlur || 0) > 0) {
        ctx.shadowColor = tp.shadowColor || 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = tp.shadowBlur;
        ctx.shadowOffsetY = tp.shadowOffsetY || 3;
      }

      const resolvedTextColor = animColor || tp.color || '#FFFFFF';
      let fillPaint = resolvedTextColor;
      if (tp.gradientEnabled) {
        const grad = ctx.createLinearGradient(-w * 0.4, -h * 0.3, w * 0.4, h * 0.3);
        grad.addColorStop(0, resolvedTextColor);
        grad.addColorStop(1, tp.gradientColor2 || '#00E5FF');
        fillPaint = grad;
      }

      const startY = -((lines.length - 1) * lineHeight) / 2;
      const xOffset = tp.align === 'left' ? (-w / 2 + bgPad) : tp.align === 'right' ? (w / 2 - bgPad) : 0;

      if (Math.abs(curveDeg) > 1) {
        const absArc = (Math.min(170, Math.abs(curveDeg)) * Math.PI) / 180;
        const sign = curveDeg >= 0 ? 1 : -1;
        lines.forEach((line, idx) => {
          const ly = startY + idx * lineHeight;
          const lineW = Math.max(20, this._measureLineWithSpacing(ctx, line, letterSpacing));
          const radius = Math.max(60, lineW / Math.max(0.08, absArc));
          let adv = -lineW / 2;
          for (let i = 0; i < line.length; i++) {
            const chStr = line[i];
            const chW = ctx.measureText(chStr).width;
            const midS = adv + chW * 0.5;
            const theta = (midS / radius) * sign;
            ctx.save();
            ctx.translate(Math.sin(theta) * radius, ly + (radius - Math.cos(theta) * radius) * sign);
            ctx.rotate(theta);
            ctx.textAlign = 'center';
            if ((tp.strokeWidth || 0) > 0) {
              ctx.lineWidth = tp.strokeWidth;
              ctx.strokeStyle = tp.strokeColor || '#00E5FF';
              ctx.strokeText(chStr, 0, 0);
            }
            ctx.fillStyle = fillPaint;
            ctx.fillText(chStr, 0, 0);
            ctx.restore();
            adv += chW + letterSpacing;
          }
        });
      } else {
        lines.forEach((line, idx) => {
          const ly = startY + idx * lineHeight;
          const lineW = this._measureLineWithSpacing(ctx, line, letterSpacing);
          if ((tp.strokeWidth || 0) > 0) {
            ctx.lineWidth = tp.strokeWidth;
            ctx.strokeStyle = tp.strokeColor || '#00E5FF';
            if (letterSpacing) this._drawLineWithSpacing(ctx, line, xOffset, ly, tp.align || 'center', letterSpacing, true);
            else ctx.strokeText(line, xOffset, ly);
          }
          ctx.fillStyle = fillPaint;
          if (letterSpacing) this._drawLineWithSpacing(ctx, line, xOffset, ly, tp.align || 'center', letterSpacing, false);
          else ctx.fillText(line, xOffset, ly);

          if (tp.underline && lineW > 2) {
            const uLeft = tp.align === 'left' ? xOffset : tp.align === 'right' ? xOffset - lineW : xOffset - lineW / 2;
            ctx.save();
            ctx.strokeStyle = animColor || tp.color || '#FFFFFF';
            ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.065));
            ctx.beginPath();
            ctx.moveTo(uLeft, ly + fontSize * 0.44);
            ctx.lineTo(uLeft + lineW, ly + fontSize * 0.44);
            ctx.stroke();
            ctx.restore();
          }
        });
      }
    } else if (layer.type === 'shape' && layer.shapeProps) {
      const sp = layer.shapeProps;
      const resolvedShapeFill = animColor || sp.fillColor || '#7C4DFF';
      ctx.fillStyle = resolvedShapeFill;
      ctx.strokeStyle = sp.strokeColor || '#00E5FF';
      ctx.lineWidth = sp.strokeWidth || 0;
      if (sp.shapeType === 'circle') {
        const r = Math.min(w, h) / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        if (sp.strokeWidth > 0) ctx.stroke();
      } else if (sp.shapeType === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (sp.strokeWidth > 0) ctx.stroke();
      } else if (sp.shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, sp.strokeWidth || 8);
        ctx.strokeStyle = layer.keyframes?.color?.length ? resolvedShapeFill : (sp.strokeColor || resolvedShapeFill || '#00E5FF');
        ctx.stroke();
      } else {
        const rad = Math.min(sp.cornerRadius || 0, w / 2, h / 2);
        this.roundRectPath(ctx, -w / 2, -h / 2, w, h, rad);
        ctx.fill();
        if (sp.strokeWidth > 0) ctx.stroke();
      }
    }

    ctx.restore();
    c._mfVersion = (c._mfVersion || 0) + 1;
    this.rasterCache.set(layer.id, { key, canvas: c, drawW: cw, drawH: ch, contentW: w, contentH: h });
    return c;
  }

  roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  resolveLayerDrawable(layer, frame, projectFps, mediaMap, isExport = false) {
    if (layer.type === 'image') {
      const item = mediaMap.get(layer.mediaId);
      if (!item) return null;
      if (item.isGif) {
        const gifCanvas = this.getGifFrameCanvas(item, layer, frame, projectFps);
        if (gifCanvas) return { el: gifCanvas, w: layer.width || gifCanvas.width, h: layer.height || gifCanvas.height, token: gifCanvas._mfVersion || frame };
      }
      const img = this.getImageElement(item);
      if (img && img.complete && img.naturalWidth > 0) {
        const scaledPreview = !isExport ? this._getPreviewImageCanvas(item, img) : null;
        return {
          el: scaledPreview || img,
          w: layer.width || img.naturalWidth,
          h: layer.height || img.naturalHeight,
          token: scaledPreview ? `${item.url}#prev` : item.url
        };
      }
      return null;
    }
    if (layer.type === 'video') {
      const item = mediaMap.get(layer.mediaId);
      if (!item) return null;
      const vid = this.getVideoElement(item);
      if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
        return { el: vid, w: layer.width || vid.videoWidth, h: layer.height || vid.videoHeight };
      }
      const cachedFrame = this.videoLastFrameCache.get(item.id);
      if (cachedFrame && cachedFrame.width > 0) {
        return { el: cachedFrame.canvas, w: layer.width || cachedFrame.width, h: layer.height || cachedFrame.height, token: cachedFrame.canvas._mfVersion || 1 };
      }
      if (item.thumbUrl) {
        let thumbImg = this.videoThumbFallbackCache.get(item.id);
        if (!thumbImg || thumbImg.dataset.srcUrl !== item.thumbUrl) {
          thumbImg = new Image();
          thumbImg.dataset.srcUrl = item.thumbUrl;
          thumbImg.onload = () => this.onMediaFrameReady?.(item);
          thumbImg.src = item.thumbUrl;
          this.videoThumbFallbackCache.set(item.id, thumbImg);
        }
        if (thumbImg.complete && thumbImg.naturalWidth > 0) {
          return { el: thumbImg, w: layer.width || item.width || thumbImg.naturalWidth, h: layer.height || item.height || thumbImg.naturalHeight, token: item.thumbUrl };
        }
      }
      return null;
    }
    if (layer.type === 'text' || layer.type === 'shape') {
      const c = this.getOrRasterizeVectorLayer(layer, frame);
      return { el: c, w: c.width, h: c.height, token: c._mfVersion || 1 };
    }
    return null;
  }

  hasAny3DContentAtFrame(project, frame, allowPending = false) {
    if (!project) return false;
    if (project.camera?.enabled) return true;
    for (let i = 0; i < (project.layers?.length || 0); i++) {
      const l = project.layers[i];
      if (!l.visible || l.type === 'audio' || l.type === 'group' || l.type === 'camera') continue;
      if (frame < l.startFrame || frame > l.endFrame) continue;
      const tf = this.resolveEffectiveTransform(l, frame, allowPending);
      if (Math.abs(tf.z || 0) > 0.5 || Math.abs(tf.rotX || 0) > 0.5 || Math.abs(tf.rotY || 0) > 0.5) {
        return true;
      }
    }
    return false;
  }

  resolveProcessedDrawable(layer, frame, projectFps, mediaMap, isExport = false) {
    const drawable = this.resolveLayerDrawable(layer, frame, projectFps, mediaMap, isExport);
    if (!drawable || !drawable.el) return null;

    const fx = layer.fx || {};
    const isAutoBg = (layer.type === 'video' || layer.type === 'image') && fx.removeBgMode === 'auto';
    if (!isAutoBg) return drawable;

    const sens = Math.round((fx.autoBgSensitivity ?? 0.48) * 100);
    const feather = Math.round((fx.autoBgFeather ?? 0.35) * 100);
    const invert = fx.autoBgInvert ? 1 : 0;
    const spill = Math.round((fx.chromaSpill ?? 0.35) * 100);
    const frameBucket = layer.type === 'video'
      ? (isExport ? Math.round(frame) : Math.floor(frame / 2))
      : (drawable.token || 0);
    const key = `${layer.mediaId || layer.id}_${frameBucket}_${sens}_${feather}_${invert}_${spill}_${isExport ? 1 : 0}`;

    let entry = this.autoBgCache.get(layer.id);
    if (entry && entry.key === key && entry.outCanvas) {
      return {
        el: entry.outCanvas,
        w: drawable.w,
        h: drawable.h,
        token: entry.version,
        cacheKey: `${layer.id}__autobg`,
        dominantBgHex: entry.dominantBgHex
      };
    }

    if (!entry) {
      entry = {
        key: '',
        outCanvas: document.createElement('canvas'),
        maskCanvas: document.createElement('canvas'),
        scratchCanvas: document.createElement('canvas'),
        version: 1,
        dominantBgHex: '#000000'
      };
      this.autoBgCache.set(layer.id, entry);
    }

    const srcW = Math.max(2, drawable.el.videoWidth || drawable.el.naturalWidth || drawable.el.width || drawable.w || 320);
    const srcH = Math.max(2, drawable.el.videoHeight || drawable.el.naturalHeight || drawable.el.height || drawable.h || 180);

    // Downsampled analysis canvas for fast low-end CPU execution
    const analysisMax = isExport ? 184 : 120;
    const aScale = Math.min(1, analysisMax / Math.max(srcW, srcH));
    const aw = Math.max(24, Math.round(srcW * aScale));
    const ah = Math.max(24, Math.round(srcH * aScale));

    if (entry.scratchCanvas.width !== aw || entry.scratchCanvas.height !== ah) {
      entry.scratchCanvas.width = aw;
      entry.scratchCanvas.height = ah;
    }
    const sctx = entry.scratchCanvas.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, aw, ah);
    sctx.drawImage(drawable.el, 0, 0, aw, ah);
    const imgData = sctx.getImageData(0, 0, aw, ah);

    const { alphaMask, dominantBgHex } = computeAutoBgMask(imgData.data, aw, ah, {
      sensitivity: fx.autoBgSensitivity ?? 0.48,
      feather: fx.autoBgFeather ?? 0.35,
      invert: Boolean(fx.autoBgInvert)
    });

    if (entry.maskCanvas.width !== aw || entry.maskCanvas.height !== ah) {
      entry.maskCanvas.width = aw;
      entry.maskCanvas.height = ah;
    }
    const mctx = entry.maskCanvas.getContext('2d');
    const mData = mctx.createImageData(aw, ah);
    for (let i = 0; i < alphaMask.length; i++) {
      const p = i * 4;
      mData.data[p] = 255;
      mData.data[p + 1] = 255;
      mData.data[p + 2] = 255;
      mData.data[p + 3] = alphaMask[i];
    }
    mctx.putImageData(mData, 0, 0);

    const outMax = isExport ? 1280 : 720;
    const oScale = Math.min(1, outMax / Math.max(srcW, srcH));
    const ow = Math.max(16, Math.round(srcW * oScale));
    const oh = Math.max(16, Math.round(srcH * oScale));
    if (entry.outCanvas.width !== ow || entry.outCanvas.height !== oh) {
      entry.outCanvas.width = ow;
      entry.outCanvas.height = oh;
    }
    const octx = entry.outCanvas.getContext('2d');
    octx.clearRect(0, 0, ow, oh);
    octx.globalCompositeOperation = 'source-over';
    octx.imageSmoothingEnabled = true;
    octx.drawImage(drawable.el, 0, 0, ow, oh);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(entry.maskCanvas, 0, 0, ow, oh);
    octx.globalCompositeOperation = 'source-over';

    entry.key = key;
    entry.version = (entry.version || 0) + 1;
    entry.dominantBgHex = dominantBgHex;

    return {
      el: entry.outCanvas,
      w: drawable.w,
      h: drawable.h,
      token: entry.version,
      cacheKey: `${layer.id}__autobg`,
      dominantBgHex
    };
  }

  sampleLayerColorAtOverlayPoint(project, frame, mediaMap, layerId, px, py) {
    const layer = project?.layers?.find((l) => l.id === layerId);
    if (!layer) return null;
    const drawable = this.resolveLayerDrawable(layer, frame, project.fps || 30, mediaMap);
    if (!drawable || !drawable.el) return null;

    const ow = Math.max(1, this.overlay.clientWidth || this.overlay.width || project.width);
    const oh = Math.max(1, this.overlay.clientHeight || this.overlay.height || project.height);
    const ox = px * (this.overlay.width / ow);
    const oy = py * (this.overlay.height / oh);

    // Map overlay pixel into layer normalized [0..1] UV
    const use3D = Boolean(this.viewport3D?.enabled) || this.hasAny3DContentAtFrame(project, frame, true);
    const mats = this.computeCameraMatrices(project, frame, !use3D, true);
    const tf = this.resolveEffectiveTransform(layer, frame, true);

    let model = Mat4.identity();
    if (layer.parentId) {
      const parent = project.layers.find((p) => p.id === layer.parentId);
      if (parent) {
        const ptf = this.resolveEffectiveTransform(parent, frame, true);
        model = Mat4.translate(model, ptf.x, -ptf.y, use3D ? (ptf.z || 0) : 0);
        model = Mat4.rotateZ(model, (-ptf.rotation * Math.PI) / 180);
        model = Mat4.scale(model, ptf.scaleX, ptf.scaleY, 1);
      }
    }
    model = Mat4.translate(model, tf.x, -tf.y, use3D ? (tf.z || 0) : 0);
    model = Mat4.rotateZ(model, (-tf.rotation * Math.PI) / 180);
    if (use3D) {
      model = Mat4.rotateX(model, ((tf.rotX || 0) * Math.PI) / 180);
      model = Mat4.rotateY(model, ((tf.rotY || 0) * Math.PI) / 180);
    }
    model = Mat4.scale(model, tf.scaleX * (layer.flipX ? -1 : 1), tf.scaleY * (layer.flipY ? -1 : 1), 1);
    model = Mat4.translate(model, -tf.anchorX, tf.anchorY, 0);

    const mvp = Mat4.multiply(mats.pvMat, model);
    const hw = drawable.w / 2;
    const hh = drawable.h / 2;
    const pTL = this.projectMatPoint(mvp, -hw, hh, 0, this.overlay.width, this.overlay.height);
    const pTR = this.projectMatPoint(mvp, hw, hh, 0, this.overlay.width, this.overlay.height);
    const pBL = this.projectMatPoint(mvp, -hw, -hh, 0, this.overlay.width, this.overlay.height);

    let normX = ox / this.overlay.width;
    let normY = oy / this.overlay.height;
    if (pTL && pTR && pBL) {
      const ux = pTR.x - pTL.x;
      const uy = pTR.y - pTL.y;
      const vx = pBL.x - pTL.x;
      const vy = pBL.y - pTL.y;
      const det = ux * vy - uy * vx;
      if (Math.abs(det) > 1e-3) {
        const dx = ox - pTL.x;
        const dy = oy - pTL.y;
        normX = (dx * vy - dy * vx) / det;
        normY = (ux * dy - uy * dx) / det;
      }
    }
    normX = Math.max(0, Math.min(1, normX));
    normY = Math.max(0, Math.min(1, normY));

    const srcW = Math.max(4, drawable.el.videoWidth || drawable.el.naturalWidth || drawable.el.width || drawable.w);
    const srcH = Math.max(4, drawable.el.videoHeight || drawable.el.naturalHeight || drawable.el.height || drawable.h);
    const patchSize = 15;
    if (!this._samplePatchCanvas) this._samplePatchCanvas = document.createElement('canvas');
    this._samplePatchCanvas.width = patchSize;
    this._samplePatchCanvas.height = patchSize;
    const sctx = this._samplePatchCanvas.getContext('2d', { willReadFrequently: true });

    const cx = Math.max(0, Math.min(srcW - 1, normX * (srcW - 1)));
    const cy = Math.max(0, Math.min(srcH - 1, normY * (srcH - 1)));
    const cropR = Math.max(4, Math.min(srcW, srcH) * 0.025);
    const sx = Math.max(0, Math.min(srcW - cropR * 2, cx - cropR));
    const sy = Math.max(0, Math.min(srcH - cropR * 2, cy - cropR));
    const sw = Math.max(2, Math.min(srcW - sx, cropR * 2));
    const sh = Math.max(2, Math.min(srcH - sy, cropR * 2));

    sctx.clearRect(0, 0, patchSize, patchSize);
    sctx.drawImage(drawable.el, sx, sy, sw, sh, 0, 0, patchSize, patchSize);
    const rgba = sctx.getImageData(0, 0, patchSize, patchSize).data;
    return pickChromaSampleFromRgba(rgba, patchSize, patchSize, 0.5, 0.5, 2);
  }

  hexToRgb01(hex) {
    const clean = (hex || '#05070B').replace('#', '');
    if (clean.length !== 6) return [0.02, 0.03, 0.04];
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255
    ];
  }

  renderFrame(project, frame, mediaMap, selectedLayerId = null, targetCanvas = null, targetW = null, targetH = null) {
    if (!targetCanvas) {
      this.syncCanvasDimensions(project);
    }

    let compositor = this.glPreview;
    if (targetCanvas) {
      compositor = this.exportCompositors.get(targetCanvas);
      if (!compositor) {
        compositor = this.createWebGLCompositor(targetCanvas, true);
        if (compositor) this.exportCompositors.set(targetCanvas, compositor);
      }
    }

    const w = targetW || (targetCanvas ? project.width : this.canvas.width) || project.width;
    const h = targetH || (targetCanvas ? project.height : this.canvas.height) || project.height;
    const has3D = this.hasAny3DContentAtFrame(project, frame, !targetCanvas);
    const isFlat2DPreview = !targetCanvas && !this.viewport3D?.enabled && !has3D;
    const allowPending = !targetCanvas;

    if (compositor) {
      this.renderWebGL(compositor, project, frame, mediaMap, w, h, isFlat2DPreview, allowPending);
    } else {
      const ctx = targetCanvas ? targetCanvas.getContext('2d', { alpha: false }) : this.ctx2dFallback;
      this.renderCanvas2DFallback(ctx, project, frame, mediaMap, w, h, isFlat2DPreview, allowPending);
    }

    if (!targetCanvas) {
      this.drawOverlay(project, frame, selectedLayerId);
    }
  }

  computeTransitionState(layer, frame, projectWidth, projectHeight) {
    const out = {
      alphaMul: 1,
      dx: 0,
      dy: 0,
      scaleMul: 1,
      rotDelta: 0,
      brightDelta: 0,
      blurDelta: 0,
      wipeType: 0,
      wipeProgress: 1
    };
    const tr = layer.transitions;
    if (!tr) return out;
    const len = Math.max(1, layer.endFrame - layer.startFrame);
    const apply = (type, eased, raw, isOut) => {
      switch (type) {
        case 'crossfade':
          out.alphaMul *= eased;
          break;
        case 'fadeBlack':
          out.alphaMul *= Math.min(1, eased * 1.15);
          out.brightDelta -= (1 - eased) * 1.1;
          break;
        case 'mixBlur':
          out.alphaMul *= eased;
          out.blurDelta += (1 - eased) * 5.0;
          break;
        case 'flashWhite':
          out.alphaMul *= Math.min(1, 0.25 + eased * 0.75);
          out.brightDelta += (1 - eased) * 1.85;
          break;
        case 'glitchCut':
          out.dx += Math.sin(raw * 34) * (1 - eased) * projectWidth * 0.08;
          out.dy += Math.cos(raw * 27) * (1 - eased) * projectHeight * 0.04;
          out.alphaMul *= Math.min(1, 0.35 + eased * 0.65);
          break;
        case 'wipeRight':
          out.wipeType = 1;
          out.wipeProgress = Math.min(out.wipeProgress, eased);
          break;
        case 'wipeLeft':
          out.wipeType = 2;
          out.wipeProgress = Math.min(out.wipeProgress, eased);
          break;
        case 'wipeUp':
          out.wipeType = 3;
          out.wipeProgress = Math.min(out.wipeProgress, eased);
          break;
        case 'wipeDown':
          out.wipeType = 4;
          out.wipeProgress = Math.min(out.wipeProgress, eased);
          break;
        case 'circleIris':
          out.wipeType = 5;
          out.wipeProgress = Math.min(out.wipeProgress, eased);
          break;
        case 'slideLeft':
          out.dx += isOut ? -(1 - eased) * projectWidth * 0.92 : (1 - eased) * projectWidth * 0.92;
          out.alphaMul *= Math.min(1, raw * 3.0);
          break;
        case 'slideRight':
          out.dx += isOut ? (1 - eased) * projectWidth * 0.92 : -(1 - eased) * projectWidth * 0.92;
          out.alphaMul *= Math.min(1, raw * 3.0);
          break;
        case 'slideUp':
          out.dy += isOut ? -(1 - eased) * projectHeight * 0.92 : (1 - eased) * projectHeight * 0.92;
          out.alphaMul *= Math.min(1, raw * 3.0);
          break;
        case 'slideDown':
          out.dy += isOut ? (1 - eased) * projectHeight * 0.92 : -(1 - eased) * projectHeight * 0.92;
          out.alphaMul *= Math.min(1, raw * 3.0);
          break;
        case 'zoomIn':
          out.scaleMul *= isOut ? (1 + (1 - eased) * 1.15) : (0.28 + 0.72 * eased);
          out.alphaMul *= eased;
          break;
        case 'zoomOut':
          out.scaleMul *= isOut ? (0.28 + 0.72 * eased) : (1 + (1 - eased) * 1.15);
          out.alphaMul *= eased;
          break;
        case 'spinIn':
          out.rotDelta += isOut ? -(1 - eased) * 180 : (1 - eased) * 180;
          out.scaleMul *= 0.42 + 0.58 * eased;
          out.alphaMul *= eased;
          break;
        default:
          break;
      }
    };

    if (tr.inType && tr.inType !== 'none') {
      const inDur = Math.max(1, Math.min(len * 0.5, Number(tr.inFrames) || 15));
      if (frame < layer.startFrame + inDur) {
        const raw = Math.max(0, Math.min(1, (frame - layer.startFrame) / inDur));
        const eased = 1 - Math.pow(1 - raw, 3);
        apply(tr.inType, eased, raw, false);
      }
    }
    if (tr.outType && tr.outType !== 'none') {
      const outDur = Math.max(1, Math.min(len * 0.5, Number(tr.outFrames) || 15));
      if (frame > layer.endFrame - outDur) {
        const raw = Math.max(0, Math.min(1, (layer.endFrame - frame) / outDur));
        const eased = 1 - Math.pow(1 - raw, 3);
        apply(tr.outType, eased, raw, true);
      }
    }
    return out;
  }

  getGradientBgCanvas(c0, c1) {
    const key = `${c0}_${c1}`;
    if (this.bgGradientCache.key === key && this.bgGradientCache.canvas) {
      return this.bgGradientCache.canvas;
    }
    const c = this.bgGradientCache.canvas || document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 16, 128);
    g.addColorStop(0, c0 || '#0F172A');
    g.addColorStop(1, c1 || '#1E1B4B');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 128);
    this.bgGradientCache = { key, canvas: c };
    return c;
  }

  _resetDefaultShaderUniforms(compositor) {
    const {
      gl, uAlpha, uPremul, uBright, uContrast, uSat, uTemp,
      uTint, uExposure, uHighlights, uShadows, uFade, uSharpen,
      uBlur, uVignette, uGrain, uChromaOn, uOutlineW, uMaskType, uMaskRot,
      uCropRect, uStab, uVfx, uWipe, uHsl, zeroHsl
    } = compositor;
    gl.uniform1f(uAlpha, 1);
    gl.uniform1f(uPremul, 0);
    gl.uniform1f(uBright, 0);
    gl.uniform1f(uContrast, 1);
    gl.uniform1f(uSat, 1);
    gl.uniform1f(uTemp, 0);
    gl.uniform1f(uTint, 0);
    gl.uniform1f(uExposure, 0);
    gl.uniform1f(uHighlights, 0);
    gl.uniform1f(uShadows, 0);
    gl.uniform1f(uFade, 0);
    gl.uniform1f(uSharpen, 0);
    gl.uniform1f(uBlur, 0);
    gl.uniform1f(uVignette, 0);
    gl.uniform1f(uGrain, 0);
    gl.uniform1f(uChromaOn, 0);
    gl.uniform1f(uOutlineW, 0);
    gl.uniform1f(uMaskType, 0);
    gl.uniform1f(uMaskRot, 0);
    gl.uniform4f(uCropRect, 0, 0, 0, 0);
    if (uStab) gl.uniform4f(uStab, 0, 0, 0, 1);
    gl.uniform3f(uVfx, 0, 0, 0);
    gl.uniform2f(uWipe, 0, 1);
    if (uHsl) gl.uniform3fv(uHsl, zeroHsl);
    if (compositor.uColorTint) gl.uniform4f(compositor.uColorTint, 1, 1, 1, 0);
  }

  hasLayerMotionVelocity(layer, frame, projectWidth, projectHeight, allowPending = false) {
    if (!layer) return false;
    const kf = layer.keyframes || {};
    const hasMotionKf =
      (kf.x?.length || 0) > 1 ||
      (kf.y?.length || 0) > 1 ||
      (kf.z?.length || 0) > 1 ||
      (kf.scaleX?.length || 0) > 1 ||
      (kf.scaleY?.length || 0) > 1 ||
      (kf.rotation?.length || 0) > 1 ||
      (kf.rotX?.length || 0) > 1 ||
      (kf.rotY?.length || 0) > 1 ||
      (kf.anchorX?.length || 0) > 1 ||
      (kf.anchorY?.length || 0) > 1;
    const tr = layer.transitions || {};
    const hasTr = (tr.inType && tr.inType !== 'none') || (tr.outType && tr.outType !== 'none');
    if (!hasMotionKf && !hasTr) return false;

    const fA = Math.max(layer.startFrame, frame - 0.5);
    const fB = Math.min(layer.endFrame, frame + 0.5);
    if (Math.abs(fB - fA) < 0.01) return false;

    const tfA = this.resolveEffectiveTransform(layer, fA, allowPending);
    const tfB = this.resolveEffectiveTransform(layer, fB, allowPending);
    if (
      Math.abs(tfB.x - tfA.x) > 0.35 ||
      Math.abs(tfB.y - tfA.y) > 0.35 ||
      Math.abs((tfB.z || 0) - (tfA.z || 0)) > 0.45 ||
      Math.abs(tfB.rotation - tfA.rotation) > 0.15 ||
      Math.abs((tfB.rotX || 0) - (tfA.rotX || 0)) > 0.15 ||
      Math.abs((tfB.rotY || 0) - (tfA.rotY || 0)) > 0.15 ||
      Math.abs(tfB.scaleX - tfA.scaleX) > 0.004 ||
      Math.abs(tfB.scaleY - tfA.scaleY) > 0.004
    ) {
      return true;
    }

    if (hasTr) {
      const trA = this.computeTransitionState(layer, fA, projectWidth, projectHeight);
      const trB = this.computeTransitionState(layer, fB, projectWidth, projectHeight);
      if (
        Math.abs(trB.dx - trA.dx) > 0.35 ||
        Math.abs(trB.dy - trA.dy) > 0.35 ||
        Math.abs((trB.rotDelta || 0) - (trA.rotDelta || 0)) > 0.15 ||
        Math.abs(trB.scaleMul - trA.scaleMul) > 0.004
      ) {
        return true;
      }
    }
    return false;
  }

  renderWebGL(compositor, project, frame, mediaMap, outW, outH, isFlat2DPreview = false, allowPending = false) {
    const {
      gl, prog, uMvp, uAlpha, uPremul,
      uBright, uContrast, uSat, uTemp,
      uTint, uExposure, uHighlights, uShadows, uFade, uSharpen,
      uBlur, uVignette, uGrain, uTexel,
      uChromaOn, uChromaKey, uChromaSim, uChromaSmooth, uChromaSpill,
      uOutlineW, uOutlineCol,
      uMaskType, uMaskRect, uMaskRot, uMaskFeather, uMaskInvert, uCropRect, uStab, uVfx, uWipe, uHsl, uColorTint, zeroHsl
    } = compositor;
    gl.useProgram(prog);
    this.bindCompositorQuadBuffer(compositor, compositor.posBuf);
    gl.viewport(0, 0, outW, outH);

    const [bgR, bgG, bgB] = this.hexToRgb01(project.backgroundColor);
    gl.clearColor(bgR, bgG, bgB, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw Canvas Gradient or Canvas Blurred Video/Image Background if active
    const bgMode = project.backgroundMode || 'color';
    if (bgMode === 'gradient') {
      const gradC = this.getGradientBgCanvas(project.backgroundGradient?.[0], project.backgroundGradient?.[1]);
      this.getOrCreateTexture(compositor, '__bg_grad', gradC, this.bgGradientCache?.key || 'grad');
      this._resetDefaultShaderUniforms(compositor);
      gl.uniformMatrix4fv(uMvp, false, Mat4.scale(Mat4.identity(), 2, 2, 1));
      gl.uniform2f(uTexel, 1 / 16, 1 / 128);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (bgMode === 'blur') {
      const bgLayer = [...project.layers].reverse().find(
        (l) => l.visible && (l.type === 'video' || l.type === 'image') && frame >= l.startFrame && frame <= l.endFrame
      );
      if (bgLayer) {
        const bgDrawable = this.resolveLayerDrawable(bgLayer, frame, project.fps || 30, mediaMap, !allowPending);
        if (bgDrawable) {
          this.getOrCreateTexture(compositor, bgLayer.mediaId || bgLayer.id, bgDrawable.el, bgDrawable.token ?? null);
          this._resetDefaultShaderUniforms(compositor);
          const scaleCover = Math.max(project.width / Math.max(1, bgDrawable.w), project.height / Math.max(1, bgDrawable.h));
          const sxCover = (bgDrawable.w * scaleCover) / project.width * 2;
          const syCover = (bgDrawable.h * scaleCover) / project.height * 2;
          gl.uniformMatrix4fv(uMvp, false, Mat4.scale(Mat4.identity(), sxCover, syCover, 1));
          gl.uniform2f(uTexel, 1 / Math.max(1, bgDrawable.w), 1 / Math.max(1, bgDrawable.h));
          gl.uniform1f(uBlur, 3.5 + (project.backgroundBlurLevel ?? 2) * 3.0);
          gl.uniform1f(uBright, -0.14);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
    }

    const camEnabled = !isFlat2DPreview && (Boolean(project.camera?.enabled) || (allowPending && Boolean(this.viewport3D?.enabled)));
    const useMotionBlur = camEnabled && this.viewport3D?.viewMode !== 'scene' && Boolean(project.camera?.motionBlur);
    const samples = useMotionBlur ? Math.max(2, Math.min(6, project.camera.motionBlurSamples || 4)) : 1;

    const layersById = new Map(project.layers.map((l) => [l.id, l]));
    const fovRad = (45 * Math.PI) / 180;
    const aspect = project.width / Math.max(1, project.height);
    const camDist = (project.height / 2) / Math.tan(fovRad / 2);
    const projMat = isFlat2DPreview
      ? Mat4.ortho(-project.width / 2, project.width / 2, -project.height / 2, project.height / 2, -5000, 5000)
      : Mat4.perspective(fovRad, aspect, 10, camDist * 20);
    const fps = Math.max(1, project.fps || 30);

    for (let s = samples - 1; s >= 0; s--) {
      const subFrame = samples === 1 ? frame : frame - (s / samples) * 0.65;
      const masterAlpha = samples === 1 ? 1.0 : (s === 0 ? 0.85 : 0.22);

      let viewMat = Mat4.identity();
      if (!isFlat2DPreview) {
        viewMat = Mat4.translate(viewMat, 0, 0, -camDist);
      }

      if (camEnabled) {
        const cam = this.resolveEffectiveCamera(project, subFrame, isFlat2DPreview, allowPending);
        viewMat = Mat4.scale(viewMat, cam.zoom, cam.zoom, 1);
        viewMat = Mat4.rotateZ(viewMat, (-cam.rotZ * Math.PI) / 180);
        viewMat = Mat4.rotateX(viewMat, (cam.rotX * Math.PI) / 180);
        viewMat = Mat4.rotateY(viewMat, (cam.rotY * Math.PI) / 180);
        viewMat = Mat4.translate(viewMat, -cam.x, cam.y, -cam.z);
      }

      for (let i = project.layers.length - 1; i >= 0; i--) {
        const layer = project.layers[i];
        if (!layer.visible || layer.type === 'audio' || layer.type === 'group' || layer.type === 'camera') continue;
        if (subFrame < layer.startFrame || subFrame > layer.endFrame) continue;

        let parentTf = null;
        if (layer.parentId) {
          const parent = layersById.get(layer.parentId);
          if (parent) {
            if (!parent.visible || subFrame < parent.startFrame || subFrame > parent.endFrame) continue;
            parentTf = this.resolveEffectiveTransform(parent, subFrame, allowPending);
          }
        }

        const isAdjustment = layer.type === 'adjustment';
        if (isAdjustment && s > 0) continue;

        const layerMb = layer.motionBlur || {};
        const mbStrength = Math.max(0.1, Math.min(1.5, Number(layerMb.strength) || 0.7));
        const layerMbActive = !isAdjustment && Boolean(layerMb.enabled) &&
          this.hasLayerMotionVelocity(layer, frame, project.width, project.height, allowPending);
        const layerSamples = (samples === 1 && layerMbActive) ? 6 : 1;
        const mbWeights = [0.64, 0.45, 0.34, 0.26, 0.20, 0.15];

        for (let ls = layerSamples - 1; ls >= 0; ls--) {
          const effFrame = layerSamples > 1
            ? Math.max(layer.startFrame, Math.min(layer.endFrame, frame - (ls / (layerSamples - 1)) * 0.9 * mbStrength))
            : (layerMbActive && samples > 1 && s > 0
                ? Math.max(layer.startFrame, Math.min(layer.endFrame, frame - (s / samples) * (0.65 + mbStrength * 0.45)))
                : subFrame);
          const layerParentTf = layerSamples > 1 && layer.parentId && layersById.get(layer.parentId)
            ? this.resolveEffectiveTransform(layersById.get(layer.parentId), effFrame, allowPending)
            : parentTf;

          const drawable = isAdjustment ? null : this.resolveProcessedDrawable(layer, effFrame, fps, mediaMap, !allowPending);
          if (!isAdjustment && !drawable) continue;

          const tf = this.resolveEffectiveTransform(layer, effFrame, allowPending);
          const trState = this.computeTransitionState(layer, effFrame, project.width, project.height);
          const lsAlpha = layerSamples > 1 ? mbWeights[ls] : 1.0;
          let alpha = (isAdjustment ? 1.0 : masterAlpha * lsAlpha) * Math.max(0, Math.min(1, tf.opacity)) * trState.alphaMul;
          if (layerParentTf) alpha *= Math.max(0, Math.min(1, layerParentTf.opacity));
          if (alpha <= 0.002) continue;

          let mvp;
          let texelW;
          let texelH;
          if (isAdjustment) {
            this.copyFramebufferToAdjustmentTex(compositor, outW, outH);
            this.bindCompositorQuadBuffer(compositor, compositor.fboPosBuf);
            mvp = Mat4.scale(Mat4.identity(), 2, 2, 1);
            texelW = Math.max(1, outW);
            texelH = Math.max(1, outH);
          } else {
            let model = Mat4.identity();
            if (layerParentTf) {
              model = Mat4.translate(model, layerParentTf.x, -layerParentTf.y, isFlat2DPreview ? 0 : (layerParentTf.z || 0));
              model = Mat4.rotateZ(model, (-layerParentTf.rotation * Math.PI) / 180);
              if (!isFlat2DPreview) {
                model = Mat4.rotateX(model, ((layerParentTf.rotX || 0) * Math.PI) / 180);
                model = Mat4.rotateY(model, ((layerParentTf.rotY || 0) * Math.PI) / 180);
              }
              model = Mat4.scale(model, layerParentTf.scaleX, layerParentTf.scaleY, 1);
            }

            const flipSX = layer.flipX ? -1 : 1;
            const flipSY = layer.flipY ? -1 : 1;
            model = Mat4.translate(model, tf.x + trState.dx, -(tf.y + trState.dy), isFlat2DPreview ? 0 : (tf.z || 0));
            model = Mat4.rotateZ(model, (-(tf.rotation + (trState.rotDelta || 0)) * Math.PI) / 180);
            if (!isFlat2DPreview) {
              model = Mat4.rotateX(model, ((tf.rotX || 0) * Math.PI) / 180);
              model = Mat4.rotateY(model, ((tf.rotY || 0) * Math.PI) / 180);
            }
            model = Mat4.scale(model, tf.scaleX * trState.scaleMul * flipSX, tf.scaleY * trState.scaleMul * flipSY, 1);
            model = Mat4.translate(model, -tf.anchorX, tf.anchorY, 0);
            model = Mat4.scale(model, drawable.w, drawable.h, 1);

            mvp = Mat4.multiply(projMat, Mat4.multiply(viewMat, model));
            this.getOrCreateTexture(compositor, drawable.cacheKey || layer.mediaId || layer.id, drawable.el, drawable.token ?? null);
            texelW = Math.max(1, drawable.w);
            texelH = Math.max(1, drawable.h);
          }

        const blend = layer.blendMode || 'normal';
        let premul = 0;
        if (blend === 'add') {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        } else if (blend === 'screen') {
          premul = 1;
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else if (blend === 'multiply') {
          premul = 1;
          gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        const fx = layer.fx || {};
        const mask = layer.mask || {};
        const crop = layer.crop || {};
        const vfxList = TimelineEngine.getActiveVfxList(layer);
        const lastVfx = vfxList.length > 0 ? vfxList[vfxList.length - 1] : { type: 'none', intensity: 0.65, speed: 1 };
        const keyRgb = this.hexToRgb01(fx.chromaColor || '#00FF00');
        const outRgb = this.hexToRgb01(fx.outlineColor || '#FFFFFF');
        const maskSpec = MASK_PRESETS.find((m) => m.id === mask.type);
        const maskShaderType = maskSpec ? maskSpec.shaderType : 0;

        const adjScale = isAdjustment ? this.getAdjustmentIntensityScale(layer, subFrame) : 1;
        // If 2+ stacked VFX are active, run pre-passes 0..N-2 through ping-pong FBOs first
        if (vfxList.length > 1) {
          const passW = isAdjustment ? outW : Math.min(outW, Math.max(64, Math.round(texelW)));
          const passH = isAdjustment ? outH : Math.min(outH, Math.max(64, Math.round(texelH)));
          this.ensureFxPingPong(compositor, passW, passH);
          const srcTex = isAdjustment
            ? compositor.adjTex
            : compositor.textures.get(drawable.cacheKey || layer.mediaId || layer.id);
          this._resetDefaultShaderUniforms(compositor);
          this.bindCompositorQuadBuffer(compositor, compositor.fboPosBuf);
          gl.disable(gl.BLEND);
          gl.viewport(0, 0, compositor.fxW, compositor.fxH);
          gl.uniformMatrix4fv(uMvp, false, Mat4.scale(Mat4.identity(), 2, 2, 1));
          gl.uniform2f(uTexel, 1 / Math.max(1, passW), 1 / Math.max(1, passH));

          let curSrcTex = srcTex;
          let targetIdx = 0;
          for (let vi = 0; vi < vfxList.length - 1; vi++) {
            const vItem = vfxList[vi];
            const spec = VIDEO_EFFECT_PRESETS.find((v) => v.id === vItem.type);
            const sId = spec ? spec.shaderId : 0;
            const vTime = ((subFrame - layer.startFrame) / fps) * (vItem.speed || 1);
            const targetFbo = targetIdx === 0 ? compositor.fxFboA : compositor.fxFboB;
            const nextTex = targetIdx === 0 ? compositor.fxTexA : compositor.fxTexB;
            gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, curSrcTex);
            gl.uniform3f(uVfx, sId, (vItem.intensity ?? 0.65) * adjScale, vTime);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            curSrcTex = nextTex;
            targetIdx = 1 - targetIdx;
          }

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, outW, outH);
          gl.enable(gl.BLEND);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curSrcTex);
          this.bindCompositorQuadBuffer(compositor, isAdjustment ? compositor.fboPosBuf : compositor.posBuf);
        }

        const vfxSpec = VIDEO_EFFECT_PRESETS.find((v) => v.id === lastVfx.type);
        const vfxShaderId = vfxSpec ? vfxSpec.shaderId : 0;
        const vfxTime = ((subFrame - layer.startFrame) / fps) * (lastVfx.speed || 1);

        gl.uniformMatrix4fv(uMvp, false, mvp);
        gl.uniform1f(uAlpha, alpha);
        gl.uniform1f(uPremul, premul);
        gl.uniform1f(uBright, ((Number(fx.brightness) || 0) * adjScale) + (trState.brightDelta || 0));
        gl.uniform1f(uContrast, 1 + ((fx.contrast ?? 1) - 1) * adjScale);
        gl.uniform1f(uSat, 1 + ((fx.saturation ?? 1) - 1) * adjScale);
        gl.uniform1f(uTemp, (Number(fx.temperature) || 0) * adjScale);
        gl.uniform1f(uTint, (Number(fx.tint) || 0) * adjScale);
        gl.uniform1f(uExposure, (Number(fx.exposure) || 0) * adjScale);
        gl.uniform1f(uHighlights, (Number(fx.highlights) || 0) * adjScale);
        gl.uniform1f(uShadows, (Number(fx.shadows) || 0) * adjScale);
        gl.uniform1f(uFade, (Number(fx.fade) || 0) * adjScale);
        gl.uniform1f(uSharpen, (Number(fx.sharpen) || 0) * adjScale);
        gl.uniform1f(uBlur, ((Number(fx.blur) || 0) * adjScale) + (trState.blurDelta || 0));
        gl.uniform1f(uVignette, (Number(fx.vignette) || 0) * adjScale);
        gl.uniform1f(uGrain, (Number(fx.grain) || 0) * adjScale);
        gl.uniform2f(uTexel, 1 / texelW, 1 / texelH);
        const chromaActive = !isAdjustment && fx.removeBgMode !== 'auto' && fx.removeBgMode !== 'none' &&
          (fx.removeBgMode === 'chroma' || Boolean(fx.chromaEnabled));
        gl.uniform1f(uChromaOn, chromaActive ? 1 : 0);
        gl.uniform3f(uChromaKey, keyRgb[0], keyRgb[1], keyRgb[2]);
        gl.uniform1f(uChromaSim, fx.chromaSimilarity ?? 0.35);
        gl.uniform1f(uChromaSmooth, fx.chromaSmoothness ?? 0.12);
        gl.uniform1f(uChromaSpill, fx.chromaSpill ?? 0.5);
        gl.uniform1f(uOutlineW, isAdjustment ? 0 : (Number(fx.outlineWidth) || 0));
        gl.uniform3f(uOutlineCol, outRgb[0], outRgb[1], outRgb[2]);
        gl.uniform1f(uMaskType, maskShaderType);
        gl.uniform4f(
          uMaskRect,
          Number(mask.offsetX) || 0,
          Number(mask.offsetY) || 0,
          mask.scaleX ?? 0.85,
          mask.scaleY ?? 0.85
        );
        gl.uniform1f(uMaskRot, ((Number(mask.rotation) || 0) * Math.PI) / 180);
        gl.uniform1f(uMaskFeather, mask.feather ?? 0.05);
        gl.uniform1f(uMaskInvert, mask.invert ? 1 : 0);
        gl.uniform4f(
          uCropRect,
          Number(crop.left) || 0,
          Number(crop.top) || 0,
          Number(crop.right) || 0,
          Number(crop.bottom) || 0
        );
        if (uStab) {
          if (isAdjustment) {
            gl.uniform4f(uStab, 0, 0, 0, 1);
          } else {
            const stab = getStabilizerAtFrame(layer, subFrame, fps);
            gl.uniform4f(
              uStab,
              stab.dx / texelW,
              stab.dy / texelH,
              stab.rot,
              stab.cropScale
            );
          }
        }
        gl.uniform3f(uVfx, vfxShaderId, (lastVfx.intensity ?? 0.65) * adjScale, vfxTime);
        gl.uniform2f(uWipe, trState.wipeType, trState.wipeProgress);
        if (uHsl) {
          if (Array.isArray(fx.hsl) && fx.hsl.length === 8) {
            const flat = new Float32Array(24);
            for (let cIdx = 0; cIdx < 8; cIdx++) {
              const ch = fx.hsl[cIdx] || [0, 0, 0];
              flat[cIdx * 3] = Number(ch[0]) || 0;
              flat[cIdx * 3 + 1] = Number(ch[1]) || 0;
              flat[cIdx * 3 + 2] = Number(ch[2]) || 0;
            }
            gl.uniform3fv(uHsl, flat);
          } else {
            gl.uniform3fv(uHsl, zeroHsl);
          }
        }
        if (uColorTint) {
          if (layer.type !== 'text' && layer.type !== 'shape' && layer.keyframes?.color?.length > 0) {
            const tintHex = KeyframeEngine.getColorAtFrame(layer, subFrame, fx.tintColor || '#FFFFFF');
            const [tr, tg, tb] = this.hexToRgb01(tintHex);
            gl.uniform4f(uColorTint, tr, tg, tb, 0.45);
          } else {
            gl.uniform4f(uColorTint, 1, 1, 1, 0);
          }
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (isAdjustment) {
          this.bindCompositorQuadBuffer(compositor, compositor.posBuf);
        }
        }
      }
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  renderCanvas2DFallback(ctx, project, frame, mediaMap, w, h, isFlat2DPreview = false, allowPending = false) {
    ctx.save();
    if (project.backgroundMode === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, project.backgroundGradient?.[0] || '#0F172A');
      g.addColorStop(1, project.backgroundGradient?.[1] || '#1E1B4B');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = project.backgroundColor || '#05070B';
    }
    ctx.fillRect(0, 0, w, h);
    ctx.scale(w / project.width, h / project.height);

    const cam = this.resolveEffectiveCamera(project, frame, isFlat2DPreview, allowPending);
    const layersById = new Map(project.layers.map((l) => [l.id, l]));
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const layer = project.layers[i];
      if (!layer.visible || layer.type === 'audio' || layer.type === 'group' || layer.type === 'camera') continue;
      if (frame < layer.startFrame || frame > layer.endFrame) continue;

      let parentTf = null;
      if (layer.parentId) {
        const parent = layersById.get(layer.parentId);
        if (parent) {
          if (!parent.visible || frame < parent.startFrame || frame > parent.endFrame) continue;
          parentTf = this.resolveEffectiveTransform(parent, frame, allowPending);
        }
      }

      if (layer.type === 'adjustment') {
        const tf = this.resolveEffectiveTransform(layer, frame, allowPending);
        const trState = this.computeTransitionState(layer, frame, project.width, project.height);
        let alpha = Math.max(0, Math.min(1, tf.opacity)) * trState.alphaMul;
        if (parentTf) alpha *= Math.max(0, Math.min(1, parentTf.opacity));
        if (alpha <= 0.002) continue;

        if (!this._adj2dCanvas) this._adj2dCanvas = document.createElement('canvas');
        if (this._adj2dCanvas.width !== w || this._adj2dCanvas.height !== h) {
          this._adj2dCanvas.width = w;
          this._adj2dCanvas.height = h;
        }
        const actx = this._adj2dCanvas.getContext('2d');
        actx.clearRect(0, 0, w, h);
        actx.drawImage(ctx.canvas, 0, 0, w, h);

        const fx = layer.fx || {};
        const vfxList = TimelineEngine.getActiveVfxList(layer);
        const adjScale = this.getAdjustmentIntensityScale(layer, frame);
        const bright = Math.max(0.1, 1 + ((Number(fx.brightness) || 0) + (Number(fx.exposure) || 0) * 0.45) * adjScale + (trState.brightDelta || 0));
        const contrast = Math.max(0.1, 1 + ((fx.contrast ?? 1) - 1) * adjScale);
        const sat = Math.max(0, 1 + ((fx.saturation ?? 1) - 1) * adjScale);
        const blurPx = Math.max(0, ((Number(fx.blur) || 0) * adjScale + (trState.blurDelta || 0)) * (w / Math.max(1, project.width)));
        const tempHue = ((Number(fx.temperature) || 0) * -22 + (Number(fx.tint) || 0) * 20) * adjScale;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const blendMap = { add: 'lighter', screen: 'screen', multiply: 'multiply' };
        ctx.globalCompositeOperation = blendMap[layer.blendMode] || 'source-over';
        ctx.globalAlpha = alpha;
        ctx.filter = `brightness(${bright.toFixed(2)}) contrast(${contrast.toFixed(2)}) saturate(${sat.toFixed(2)}) hue-rotate(${tempHue.toFixed(1)}deg) blur(${blurPx.toFixed(1)}px)`;

        const fps = Math.max(1, project.fps || 30);
        let shakeDx = 0;
        let shakeDy = 0;
        for (const vItem of vfxList) {
          const vt = ((frame - layer.startFrame) / fps) * (vItem.speed || 1);
          const vi = (vItem.intensity ?? 0.65) * adjScale;
          if (vItem.type === 'shake') {
            shakeDx += Math.sin(vt * 29) * 14 * vi;
            shakeDy += Math.cos(vt * 37) * 14 * vi;
          }
        }
        ctx.drawImage(this._adj2dCanvas, shakeDx, shakeDy, w, h);
        ctx.filter = 'none';

        for (const vItem of vfxList) {
          const vt = ((frame - layer.startFrame) / fps) * (vItem.speed || 1);
          const vi = Math.max(0, Math.min(1.5, (vItem.intensity ?? 0.65) * adjScale));
          if (vItem.type === 'nightVision') {
            ctx.fillStyle = `rgba(30, 220, 90, ${(0.24 * vi).toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
          } else if (vItem.type === 'flash') {
            const pulse = Math.pow(Math.max(0, Math.sin(vt * 8)), 4);
            ctx.fillStyle = `rgba(255, 255, 255, ${(pulse * 0.55 * vi).toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
          } else if (vItem.type === 'vhs' || vItem.type === 'crt') {
            ctx.fillStyle = `rgba(0, 0, 0, ${(0.18 * vi).toFixed(3)})`;
            for (let sy = 0; sy < h; sy += 6) ctx.fillRect(0, sy, w, 2);
          } else if (vItem.type === 'glitch' || vItem.type === 'rgbSplit') {
            ctx.fillStyle = `rgba(0, 229, 255, ${(0.16 * vi).toFixed(3)})`;
            ctx.fillRect(Math.sin(vt * 19) * 10, 0, w, h);
          } else if (vItem.type === 'strobe') {
            if (Math.sin(vt * 18) >= 0.45) {
              ctx.fillStyle = `rgba(0, 0, 0, ${(0.82 * vi).toFixed(3)})`;
              ctx.fillRect(0, 0, w, h);
            }
          }
        }
        if ((Number(fx.vignette) || 0) * adjScale > 0.01) {
          const vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.55);
          vg.addColorStop(0, 'rgba(0,0,0,0)');
          vg.addColorStop(1, `rgba(0,0,0,${Math.min(0.88, (Number(fx.vignette) || 0) * adjScale * 0.85).toFixed(3)})`);
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
        continue;
      }

      const layerMb = layer.motionBlur || {};
      const mbStrength = Math.max(0.1, Math.min(1.5, Number(layerMb.strength) || 0.7));
      const layerMbActive = Boolean(layerMb.enabled) &&
        this.hasLayerMotionVelocity(layer, frame, project.width, project.height, allowPending);
      const layerSamples = layerMbActive ? 5 : 1;
      const mbWeights = [0.66, 0.44, 0.32, 0.24, 0.18];

      for (let ls = layerSamples - 1; ls >= 0; ls--) {
        const effFrame = layerSamples > 1
          ? Math.max(layer.startFrame, Math.min(layer.endFrame, frame - (ls / (layerSamples - 1)) * 0.9 * mbStrength))
          : frame;
        const layerParentTf = layerSamples > 1 && layer.parentId && layersById.get(layer.parentId)
          ? this.resolveEffectiveTransform(layersById.get(layer.parentId), effFrame, allowPending)
          : parentTf;

        const drawable = this.resolveProcessedDrawable(layer, effFrame, project.fps || 30, mediaMap, !allowPending);
        if (!drawable) continue;
        const tf = this.resolveEffectiveTransform(layer, effFrame, allowPending);
        const trState = this.computeTransitionState(layer, effFrame, project.width, project.height);
        const lsAlpha = layerSamples > 1 ? mbWeights[ls] : 1.0;
        let alpha = lsAlpha * Math.max(0, Math.min(1, tf.opacity)) * trState.alphaMul;
        if (layerParentTf) alpha *= Math.max(0, Math.min(1, layerParentTf.opacity));
        if (alpha <= 0.002) continue;

        ctx.save();
        const blendMap = { add: 'lighter', screen: 'screen', multiply: 'multiply' };
        ctx.globalCompositeOperation = blendMap[layer.blendMode] || 'source-over';
        ctx.translate(project.width / 2, project.height / 2);
        if (cam.enabled) {
          const camZScale = Math.max(0.25, 1 / Math.max(0.25, 1 + (cam.z || 0) / 1100));
          ctx.scale(cam.zoom * camZScale, cam.zoom * camZScale);
          ctx.rotate(((cam.rotZ || 0) * Math.PI) / 180);
          ctx.translate(-(cam.x || 0), -(cam.y || 0));
        }
        if (layerParentTf) {
          ctx.translate(layerParentTf.x, layerParentTf.y);
          ctx.rotate((layerParentTf.rotation * Math.PI) / 180);
          ctx.scale(layerParentTf.scaleX, layerParentTf.scaleY);
        }
        const zPersp = !isFlat2DPreview && Math.abs(tf.z || 0) > 0.5
          ? Math.max(0.15, Math.min(8, ((project.height / 2) / Math.tan((45 * Math.PI) / 360)) / Math.max(40, ((project.height / 2) / Math.tan((45 * Math.PI) / 360)) - (tf.z || 0))))
          : 1;
        ctx.translate((tf.x + trState.dx) * zPersp, (tf.y + trState.dy) * zPersp);
        ctx.rotate(((tf.rotation + (trState.rotDelta || 0)) * Math.PI) / 180);
        ctx.scale(
          tf.scaleX * trState.scaleMul * zPersp * (layer.flipX ? -1 : 1),
          tf.scaleY * trState.scaleMul * zPersp * (layer.flipY ? -1 : 1)
        );
        ctx.translate(-tf.anchorX, -tf.anchorY);
        ctx.globalAlpha = alpha;
        if (trState.wipeType > 0) {
          const p = Math.max(0, Math.min(1, trState.wipeProgress));
          ctx.beginPath();
          if (trState.wipeType === 1) ctx.rect(-drawable.w / 2, -drawable.h / 2, drawable.w * p, drawable.h);
          else if (trState.wipeType === 2) ctx.rect(drawable.w * (0.5 - p), -drawable.h / 2, drawable.w * p, drawable.h);
          else if (trState.wipeType === 3) ctx.rect(-drawable.w / 2, drawable.h * (0.5 - p), drawable.w, drawable.h * p);
          else if (trState.wipeType === 4) ctx.rect(-drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h * p);
          else ctx.arc(0, 0, Math.hypot(drawable.w, drawable.h) * 0.52 * p, 0, Math.PI * 2);
          ctx.clip();
        }
        const crop = layer.crop;
        if (crop && ((crop.left || 0) > 0 || (crop.right || 0) > 0 || (crop.top || 0) > 0 || (crop.bottom || 0) > 0)) {
          const cL = Math.max(0, Math.min(0.49, Number(crop.left) || 0));
          const cR = Math.max(0, Math.min(0.49, Number(crop.right) || 0));
          const cT = Math.max(0, Math.min(0.49, Number(crop.top) || 0));
          const cB = Math.max(0, Math.min(0.49, Number(crop.bottom) || 0));
          const cw = Math.max(0, (1 - cL - cR) * drawable.w);
          const ch = Math.max(0, (1 - cT - cB) * drawable.h);
          ctx.beginPath();
          ctx.rect(-drawable.w / 2 + cL * drawable.w, -drawable.h / 2 + cT * drawable.h, cw, ch);
          ctx.clip();
        }
        const stab = getStabilizerAtFrame(layer, effFrame, project.fps || 30);
        if (stab.cropScale > 1.0005 || Math.abs(stab.dx) > 0.05 || Math.abs(stab.dy) > 0.05 || Math.abs(stab.rot) > 0.0001) {
          ctx.beginPath();
          ctx.rect(-drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h);
          ctx.clip();
          ctx.scale(stab.cropScale, stab.cropScale);
          ctx.rotate(stab.rot);
          ctx.translate(stab.dx, stab.dy);
        }
        const fx = layer.fx || {};
        const chroma2dOn = fx.removeBgMode !== 'auto' && fx.removeBgMode !== 'none' &&
          (fx.removeBgMode === 'chroma' || Boolean(fx.chromaEnabled));
        if (chroma2dOn && (layer.type === 'video' || layer.type === 'image')) {
          const cScale = Math.min(1, 256 / Math.max(1, drawable.w, drawable.h));
          const cw = Math.max(8, Math.round(drawable.w * cScale));
          const ch = Math.max(8, Math.round(drawable.h * cScale));
          if (!this._chroma2dCanvas) this._chroma2dCanvas = document.createElement('canvas');
          if (this._chroma2dCanvas.width !== cw || this._chroma2dCanvas.height !== ch) {
            this._chroma2dCanvas.width = cw;
            this._chroma2dCanvas.height = ch;
          }
          const cctx = this._chroma2dCanvas.getContext('2d', { willReadFrequently: true });
          cctx.clearRect(0, 0, cw, ch);
          cctx.drawImage(drawable.el, 0, 0, cw, ch);
          const idata = cctx.getImageData(0, 0, cw, ch);
          applyChromaKeyToRgba(
            idata.data,
            cw,
            ch,
            hexToRgb255(fx.chromaColor || '#00FF00'),
            fx.chromaSimilarity ?? 0.35,
            fx.chromaSmoothness ?? 0.12,
            fx.chromaSpill ?? 0.5
          );
          cctx.putImageData(idata, 0, 0);
          ctx.drawImage(this._chroma2dCanvas, -drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h);
        } else if (layer.type !== 'text' && layer.type !== 'shape' && layer.keyframes?.color?.length > 0) {
          const tintHex = KeyframeEngine.getColorAtFrame(layer, effFrame, layer.fx?.tintColor || '#FFFFFF');
          const tw = Math.max(2, Math.min(1024, Math.round(drawable.w)));
          const th = Math.max(2, Math.min(1024, Math.round(drawable.h)));
          if (!this._tint2dCanvas) this._tint2dCanvas = document.createElement('canvas');
          if (this._tint2dCanvas.width !== tw || this._tint2dCanvas.height !== th) {
            this._tint2dCanvas.width = tw;
            this._tint2dCanvas.height = th;
          }
          const tctx = this._tint2dCanvas.getContext('2d');
          tctx.clearRect(0, 0, tw, th);
          tctx.globalCompositeOperation = 'source-over';
          tctx.globalAlpha = 1;
          tctx.drawImage(drawable.el, 0, 0, tw, th);
          tctx.globalCompositeOperation = 'source-atop';
          tctx.globalAlpha = 0.42;
          tctx.fillStyle = tintHex;
          tctx.fillRect(0, 0, tw, th);
          tctx.globalCompositeOperation = 'source-over';
          tctx.globalAlpha = 1;
          ctx.drawImage(this._tint2dCanvas, -drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h);
        } else {
          ctx.drawImage(drawable.el, -drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  computeCameraMatrices(project, frame, flat2D = false, allowPending = true) {
    const fovRad = (45 * Math.PI) / 180;
    const aspect = project.width / Math.max(1, project.height);
    const camDist = (project.height / 2) / Math.tan(fovRad / 2);
    const projMat = flat2D
      ? Mat4.ortho(-project.width / 2, project.width / 2, -project.height / 2, project.height / 2, -5000, 5000)
      : Mat4.perspective(fovRad, aspect, 10, camDist * 20);
    const cam = this.resolveEffectiveCamera(project, frame, flat2D, allowPending);

    let viewMat = Mat4.identity();
    if (!flat2D) {
      viewMat = Mat4.translate(viewMat, 0, 0, -camDist);
    }
    if (cam.enabled) {
      viewMat = Mat4.scale(viewMat, cam.zoom, cam.zoom, 1);
      viewMat = Mat4.rotateZ(viewMat, (-cam.rotZ * Math.PI) / 180);
      viewMat = Mat4.rotateX(viewMat, (cam.rotX * Math.PI) / 180);
      viewMat = Mat4.rotateY(viewMat, (cam.rotY * Math.PI) / 180);
      viewMat = Mat4.translate(viewMat, -cam.x, cam.y, -cam.z);
    }
    return { fovRad, camDist, projMat, viewMat, pvMat: Mat4.multiply(projMat, viewMat), cam };
  }

  projectMatPoint(mvp, x, y, z, ow, oh) {
    const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (cw <= 1e-3) return null;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      x: (ndcX * 0.5 + 0.5) * ow,
      y: (0.5 - ndcY * 0.5) * oh,
      w: cw
    };
  }

  drawBlender3DFloorAndTriad(octx, project, mats, ow, oh, frame = 0) {
    const { pvMat, cam, camDist } = mats;
    const span = Math.max(project.width, project.height) * 0.9;
    const floorY = -project.height * 0.38; // World Y down -> negative is bottom half of frame
    const steps = 8;
    const stepSize = (span * 2) / steps;
    const isSceneView = this.viewport3D?.viewMode === 'scene';
    const axisLock = this.viewport3D?.axisLock || 'free';

    octx.save();
    for (let i = 0; i <= steps; i++) {
      const v = -span + i * stepSize;
      const isCenter = Math.abs(v) < stepSize * 0.25;

      // Lines along Z
      const pZ0 = this.projectMatPoint(pvMat, v, floorY, -span, ow, oh);
      const pZ1 = this.projectMatPoint(pvMat, v, floorY, span, ow, oh);
      if (pZ0 && pZ1) {
        octx.strokeStyle = isCenter
          ? (axisLock === 'z' ? 'rgba(64, 196, 255, 0.92)' : 'rgba(64, 156, 255, 0.55)')
          : 'rgba(139, 152, 176, 0.16)';
        octx.lineWidth = isCenter ? (axisLock === 'z' ? 2.2 : 1.4) : 1;
        octx.beginPath();
        octx.moveTo(pZ0.x, pZ0.y);
        octx.lineTo(pZ1.x, pZ1.y);
        octx.stroke();
      }

      // Lines along X
      const pX0 = this.projectMatPoint(pvMat, -span, floorY, v, ow, oh);
      const pX1 = this.projectMatPoint(pvMat, span, floorY, v, ow, oh);
      if (pX0 && pX1) {
        octx.strokeStyle = isCenter
          ? (axisLock === 'x' ? 'rgba(255, 82, 82, 0.95)' : 'rgba(255, 82, 82, 0.55)')
          : 'rgba(139, 152, 176, 0.16)';
        octx.lineWidth = isCenter ? (axisLock === 'x' ? 2.2 : 1.4) : 1;
        octx.beginPath();
        octx.moveTo(pX0.x, pX0.y);
        octx.lineTo(pX1.x, pX1.y);
        octx.stroke();
      }
    }

    // In Blender Scene Orbit mode, visualize the Active Render Camera frustum in 3D space
    if (isSceneView) {
      const rc = this.resolveRenderCameraPose(project, frame, true);
      const invZoom = 1 / Math.max(0.25, rc.zoom || 1);
      let rcWorld = Mat4.identity();
      rcWorld = Mat4.translate(rcWorld, rc.x || 0, -(rc.y || 0), rc.z || 0);
      rcWorld = Mat4.rotateY(rcWorld, (-(rc.rotY || 0) * Math.PI) / 180);
      rcWorld = Mat4.rotateX(rcWorld, (-(rc.rotX || 0) * Math.PI) / 180);
      rcWorld = Mat4.rotateZ(rcWorld, ((rc.rotZ || 0) * Math.PI) / 180);
      rcWorld = Mat4.scale(rcWorld, invZoom, invZoom, 1);

      const mvpFrustum = Mat4.multiply(pvMat, rcWorld);
      const depth = camDist * 0.34;
      const hw = (project.width * 0.5) * (depth / camDist) * 0.85;
      const hh = (project.height * 0.5) * (depth / camDist) * 0.85;
      const pEye = this.projectMatPoint(mvpFrustum, 0, 0, camDist, ow, oh);
      const cTL = this.projectMatPoint(mvpFrustum, -hw, hh, camDist - depth, ow, oh);
      const cTR = this.projectMatPoint(mvpFrustum, hw, hh, camDist - depth, ow, oh);
      const cBR = this.projectMatPoint(mvpFrustum, hw, -hh, camDist - depth, ow, oh);
      const cBL = this.projectMatPoint(mvpFrustum, -hw, -hh, camDist - depth, ow, oh);
      if (pEye && cTL && cTR && cBR && cBL) {
        octx.strokeStyle = 'rgba(255, 193, 7, 0.88)';
        octx.lineWidth = 1.6;
        octx.beginPath();
        octx.moveTo(cTL.x, cTL.y);
        octx.lineTo(cTR.x, cTR.y);
        octx.lineTo(cBR.x, cBR.y);
        octx.lineTo(cBL.x, cBL.y);
        octx.closePath();
        octx.stroke();

        octx.setLineDash([4, 3]);
        octx.strokeStyle = 'rgba(255, 193, 7, 0.6)';
        for (const corner of [cTL, cTR, cBR, cBL]) {
          octx.beginPath();
          octx.moveTo(pEye.x, pEye.y);
          octx.lineTo(corner.x, corner.y);
          octx.stroke();
        }
        octx.setLineDash([]);

        octx.fillStyle = '#FFC107';
        octx.beginPath();
        octx.arc(pEye.x, pEye.y, 4.5, 0, Math.PI * 2);
        octx.fill();
        octx.font = 'bold 9px system-ui, sans-serif';
        octx.textAlign = 'center';
        octx.fillText('RENDER CAM', pEye.x, pEye.y - 9);
      }
    } else {
      // Active Camera View: subtle Blender Passepartout viewfinder frame corners
      const pad = 7;
      const cLen = 14;
      octx.strokeStyle = 'rgba(255, 193, 7, 0.48)';
      octx.lineWidth = 1.4;
      octx.beginPath();
      octx.moveTo(pad, pad + cLen); octx.lineTo(pad, pad); octx.lineTo(pad + cLen, pad);
      octx.moveTo(ow - pad - cLen, pad); octx.lineTo(ow - pad, pad); octx.lineTo(ow - pad, pad + cLen);
      octx.moveTo(ow - pad, oh - pad - cLen); octx.lineTo(ow - pad, oh - pad); octx.lineTo(ow - pad - cLen, oh - pad);
      octx.moveTo(pad + cLen, oh - pad); octx.lineTo(pad, oh - pad); octx.lineTo(pad, oh - pad - cLen);
      octx.stroke();
    }

    // Corner 3D Blender Navigation Triad (bottom-left above 3D toolbar)
    const triadX = 34;
    const triadY = oh - 46;
    let rotOnly = Mat4.identity();
    rotOnly = Mat4.rotateZ(rotOnly, (-cam.rotZ * Math.PI) / 180);
    rotOnly = Mat4.rotateX(rotOnly, (cam.rotX * Math.PI) / 180);
    rotOnly = Mat4.rotateY(rotOnly, (cam.rotY * Math.PI) / 180);

    const axes = [
      { label: 'X', vec: [1, 0, 0], color: '#FF5252' },
      { label: 'Y', vec: [0, 1, 0], color: '#69F0AE' },
      { label: 'Z', vec: [0, 0, 1], color: '#40C4FF' }
    ];
    const axisLen = 20;
    const projectedAxes = axes.map((a) => {
      const rx = rotOnly[0] * a.vec[0] + rotOnly[4] * a.vec[1] + rotOnly[8] * a.vec[2];
      const ry = rotOnly[1] * a.vec[0] + rotOnly[5] * a.vec[1] + rotOnly[9] * a.vec[2];
      const rz = rotOnly[2] * a.vec[0] + rotOnly[6] * a.vec[1] + rotOnly[10] * a.vec[2];
      return { ...a, px: triadX + rx * axisLen, py: triadY - ry * axisLen, z: rz };
    }).sort((a, b) => a.z - b.z);

    octx.fillStyle = 'rgba(11, 14, 20, 0.72)';
    octx.beginPath();
    octx.arc(triadX, triadY, 26, 0, Math.PI * 2);
    octx.fill();
    octx.strokeStyle = isSceneView ? 'rgba(255, 193, 7, 0.45)' : 'rgba(255,255,255,0.14)';
    octx.lineWidth = 1;
    octx.stroke();

    octx.font = 'bold 9px system-ui, sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    for (const a of projectedAxes) {
      const isLocked = axisLock === a.label.toLowerCase();
      octx.strokeStyle = a.color;
      octx.lineWidth = isLocked ? 3 : 2;
      octx.beginPath();
      octx.moveTo(triadX, triadY);
      octx.lineTo(a.px, a.py);
      octx.stroke();

      octx.fillStyle = a.color;
      octx.beginPath();
      octx.arc(a.px, a.py, isLocked ? 7 : 5.5, 0, Math.PI * 2);
      octx.fill();
      if (isLocked) {
        octx.strokeStyle = '#FFFFFF';
        octx.lineWidth = 1.2;
        octx.stroke();
      }
      octx.fillStyle = '#071018';
      octx.fillText(a.label, a.px, a.py + 0.5);
    }

    this.lastTriadHandles = {
      cx: triadX,
      cy: triadY,
      r: 28,
      axes: projectedAxes.map((a) => ({ label: a.label, x: a.px, y: a.py }))
    };
    octx.restore();
  }

  drawOverlay(project, frame, selectedLayerId) {
    const octx = this.octx;
    const ow = this.overlay.width;
    const oh = this.overlay.height;
    octx.clearRect(0, 0, ow, oh);
    this.lastOverlayBox = null;
    this.lastTrackerBox = null;
    this.lastGizmoHandles = null;
    this.lastTriadHandles = null;
    this.renderedLayerQuads = [];

    if (project.settings?.showGrid) {
      octx.save();
      octx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      octx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        const gx = (ow * i) / 3;
        const gy = (oh * i) / 3;
        octx.beginPath(); octx.moveTo(gx, 0); octx.lineTo(gx, oh); octx.stroke();
        octx.beginPath(); octx.moveTo(0, gy); octx.lineTo(ow, gy); octx.stroke();
      }
      octx.restore();
    }

    const is3DMode = Boolean(this.viewport3D?.enabled);
    const usePerspectiveOverlay = is3DMode || this.hasAny3DContentAtFrame(project, frame, true);
    const mats = this.computeCameraMatrices(project, frame, !usePerspectiveOverlay, true);
    if (is3DMode) {
      this.drawBlender3DFloorAndTriad(octx, project, mats, ow, oh, frame);
    }

    if (this.trackerOverlay && this.trackerOverlay.active) {
      this.drawTrackerReticleOverlay(octx, project, frame, ow, oh);
    }

    const sx = ow / project.width;
    const sy = oh / project.height;
    let selectedBoxInfo = null;

    // Collect projected hit-test quads for all visible visual layers (front-to-back)
    for (let i = 0; i < project.layers.length; i++) {
      const l = project.layers[i];
      if (!l.visible || l.type === 'audio' || l.type === 'group' || l.type === 'adjustment' || l.type === 'camera') continue;
      if (frame < l.startFrame || frame > l.endFrame) continue;

      let parentTf = null;
      if (l.parentId) {
        const parent = project.layers.find((p) => p.id === l.parentId);
        if (parent) {
          if (!parent.visible || frame < parent.startFrame || frame > parent.endFrame) continue;
          parentTf = this.resolveEffectiveTransform(parent, frame, true);
        }
      }

      const tf = this.resolveEffectiveTransform(l, frame, true);
      const cachedRaster = this.rasterCache.get(l.id);
      const baseW = Math.max(l.width || 300, cachedRaster?.contentW || 0);
      const baseH = Math.max(l.height || 200, cachedRaster?.contentH || 0);

      let model = Mat4.identity();
      if (parentTf) {
        model = Mat4.translate(model, parentTf.x, -parentTf.y, usePerspectiveOverlay ? (parentTf.z || 0) : 0);
        model = Mat4.rotateZ(model, (-parentTf.rotation * Math.PI) / 180);
        if (usePerspectiveOverlay) {
          model = Mat4.rotateX(model, ((parentTf.rotX || 0) * Math.PI) / 180);
          model = Mat4.rotateY(model, ((parentTf.rotY || 0) * Math.PI) / 180);
        }
        model = Mat4.scale(model, parentTf.scaleX, parentTf.scaleY, 1);
      }
      model = Mat4.translate(model, tf.x, -tf.y, usePerspectiveOverlay ? (tf.z || 0) : 0);
      model = Mat4.rotateZ(model, (-tf.rotation * Math.PI) / 180);
      if (usePerspectiveOverlay) {
        model = Mat4.rotateX(model, ((tf.rotX || 0) * Math.PI) / 180);
        model = Mat4.rotateY(model, ((tf.rotY || 0) * Math.PI) / 180);
      }
      model = Mat4.scale(model, tf.scaleX, tf.scaleY, 1);
      model = Mat4.translate(model, -tf.anchorX, tf.anchorY, 0);

      const mvpBox = Mat4.multiply(mats.pvMat, model);
      const pCenter = this.projectMatPoint(mvpBox, 0, 0, 0, ow, oh);
      const hw = baseW / 2;
      const hh = baseH / 2;
      const pTL = this.projectMatPoint(mvpBox, -hw, hh, 0, ow, oh);
      const pTR = this.projectMatPoint(mvpBox, hw, hh, 0, ow, oh);
      const pBR = this.projectMatPoint(mvpBox, hw, -hh, 0, ow, oh);
      const pBL = this.projectMatPoint(mvpBox, -hw, -hh, 0, ow, oh);
      if (!pCenter || !pTL || !pTR || !pBR || !pBL) continue;

      const corners = [pTL, pTR, pBR, pBL];
      this.renderedLayerQuads.push({ layerId: l.id, corners });
      if (l.id === selectedLayerId) {
        selectedBoxInfo = { l, model, pCenter, pTL, pTR, pBR, pBL, corners };
      }
    }

    if (!selectedBoxInfo) {
      const selectedLayer = project.layers.find((l) => l.id === selectedLayerId);
      if (is3DMode && (selectedLayer?.type === 'camera' || (this.viewport3D?.autoRecord && !selectedLayerId))) {
        const cx = ow * 0.5;
        const cy = oh * 0.5;
        const half = 68;
        const corners = [
          { x: cx - half, y: cy - half },
          { x: cx + half, y: cy - half },
          { x: cx + half, y: cy + half },
          { x: cx - half, y: cy + half }
        ];
        this.lastOverlayBox = {
          cx,
          cy,
          bw: half * 2,
          bh: half * 2,
          rad: 0,
          sx,
          sy,
          layerId: selectedLayer?.id || '__camera__',
          isCameraGizmo: true,
          corners
        };
        octx.save();
        octx.strokeStyle = this.viewport3D?.autoRecord ? 'rgba(248, 113, 113, 0.85)' : 'rgba(56, 189, 248, 0.8)';
        octx.lineWidth = 1.4;
        octx.setLineDash([5, 4]);
        octx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        octx.setLineDash([]);
        const camModel = Mat4.identity();
        this.draw3DGizmo(octx, mats, camModel, { x: cx, y: cy }, ow, oh);
        const camTag = this.viewport3D?.autoRecord ? '3D CAM AUTO-REC (Geser X/Y/Z)' : '3D CAMERA RIG';
        octx.font = 'bold 10px system-ui, sans-serif';
        const tw = octx.measureText(camTag).width + 12;
        octx.fillStyle = 'rgba(11, 16, 26, 0.88)';
        octx.fillRect(cx - tw / 2, cy - half - 22, tw, 16);
        octx.fillStyle = this.viewport3D?.autoRecord ? '#fca5a5' : '#7dd3fc';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText(camTag, cx, cy - half - 14);
        octx.restore();
      }
      if (this.chromaPickerOverlay?.active) {
        this.drawChromaPickerLoupe(octx, ow, oh);
      }
      return;
    }
    const { l: layer, model, pCenter, pTL, pTR, pBR, pBL } = selectedBoxInfo;

    const bw = Math.max(16, Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y));
    const bh = Math.max(16, Math.hypot(pBL.x - pTL.x, pBL.y - pTL.y));
    const rad = Math.atan2(pTR.y - pTL.y, pTR.x - pTL.x);

    this.lastOverlayBox = {
      cx: pCenter.x,
      cy: pCenter.y,
      bw,
      bh,
      rad,
      sx,
      sy,
      layerId: layer.id,
      corners: [pTL, pTR, pBR, pBL]
    };

    const isPending3D = Boolean(
      is3DMode &&
      this.pending3DLayerPose &&
      this.pending3DLayerPose.layerId === layer.id &&
      Math.round(frame) === Math.round(this.pending3DLayerPose.frame)
    );

    octx.save();
    octx.strokeStyle = isPending3D ? '#FFAB40' : (this.viewport3D?.enabled ? '#40C4FF' : '#00E5FF');
    octx.lineWidth = isPending3D ? 2 : 1.6;
    if (isPending3D) octx.setLineDash([5, 3]);
    octx.beginPath();
    octx.moveTo(pTL.x, pTL.y);
    octx.lineTo(pTR.x, pTR.y);
    octx.lineTo(pBR.x, pBR.y);
    octx.lineTo(pBL.x, pBL.y);
    octx.closePath();
    octx.stroke();
    octx.setLineDash([]);

    // Scale corner squares
    octx.fillStyle = isPending3D ? '#FFAB40' : '#00E5FF';
    for (const c of [pTL, pTR, pBR, pBL]) {
      octx.fillRect(c.x - 4.5, c.y - 4.5, 9, 9);
    }

    if (isPending3D) {
      const badgeTxt = '3D Belum Di-Key · Klik ◆ Keyframe';
      octx.font = 'bold 10px system-ui, sans-serif';
      const tw = octx.measureText(badgeTxt).width + 12;
      const bx = Math.max(8, Math.min(ow - tw - 8, pCenter.x - tw / 2));
      const by = Math.max(8, Math.min(pTL.y, pTR.y) - 24);
      octx.fillStyle = 'rgba(20, 14, 4, 0.9)';
      octx.strokeStyle = '#FFAB40';
      octx.lineWidth = 1;
      octx.fillRect(bx, by, tw, 17);
      octx.strokeRect(bx, by, tw, 17);
      octx.fillStyle = '#FFAB40';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText(badgeTxt, bx + tw / 2, by + 8.5);
    }

    if (this.viewport3D?.enabled) {
      this.draw3DGizmo(octx, mats, model, pCenter, ow, oh);
    } else {
      // Standard 2D rotation stem
      const midTopX = (pTL.x + pTR.x) / 2;
      const midTopY = (pTL.y + pTR.y) / 2;
      const nx = Math.sin(rad) * 20;
      const ny = -Math.cos(rad) * 20;
      octx.beginPath();
      octx.moveTo(midTopX, midTopY);
      octx.lineTo(midTopX + nx, midTopY + ny);
      octx.stroke();

      octx.beginPath();
      octx.arc(midTopX + nx, midTopY + ny, 6, 0, Math.PI * 2);
      octx.fillStyle = '#7C4DFF';
      octx.fill();
      octx.strokeStyle = '#FFFFFF';
      octx.stroke();
    }
    octx.restore();

    if (this.chromaPickerOverlay?.active) {
      this.drawChromaPickerLoupe(octx, ow, oh);
    }
  }

  drawChromaPickerLoupe(octx, ow, oh) {
    const cp = this.chromaPickerOverlay;
    if (!cp?.active) return;
    const scaleX = ow / Math.max(1, this.overlay.clientWidth || ow);
    const scaleY = oh / Math.max(1, this.overlay.clientHeight || oh);
    const px = cp.pointerX != null ? cp.pointerX * scaleX : ow * 0.5;
    const py = cp.pointerY != null ? cp.pointerY * scaleY : oh * 0.5;
    const hex = cp.sampledHex || '#00FF00';

    octx.save();
    // Crosshair at exact sample point
    octx.strokeStyle = '#FFFFFF';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.arc(px, py, 10, 0, Math.PI * 2);
    octx.stroke();
    octx.strokeStyle = '#071018';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(px - 6, py); octx.lineTo(px + 6, py);
    octx.moveTo(px, py - 6); octx.lineTo(px, py + 6);
    octx.stroke();

    // Floating CapCut-style color ring loupe above finger
    const loupeY = Math.max(36, py - 46);
    const loupeX = Math.max(36, Math.min(ow - 36, px));
    octx.beginPath();
    octx.arc(loupeX, loupeY, 22, 0, Math.PI * 2);
    octx.fillStyle = hex;
    octx.fill();
    octx.lineWidth = 4;
    octx.strokeStyle = '#FFFFFF';
    octx.stroke();
    octx.lineWidth = 1.5;
    octx.strokeStyle = 'rgba(0,0,0,0.65)';
    octx.stroke();

    // Hex label pill
    const lbl = hex;
    octx.font = 'bold 10px system-ui, sans-serif';
    const tw = octx.measureText(lbl).width + 10;
    const pillY = loupeY + 26;
    octx.fillStyle = 'rgba(11, 14, 20, 0.88)';
    octx.fillRect(loupeX - tw / 2, pillY, tw, 15);
    octx.fillStyle = '#FFFFFF';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(lbl, loupeX, pillY + 7.5);
    octx.restore();
  }

  draw3DGizmo(octx, mats, model, pCenter, ow, oh) {
    const tool = this.viewport3D?.tool || 'move';
    if (tool === 'camera') return;

    const wx = model[12];
    const wyGl = model[13];
    const wz = model[14];

    if (tool === 'move') {
      const worldSpan = 110;
      const pX = this.projectMatPoint(mats.pvMat, wx + worldSpan, wyGl, wz, ow, oh);
      const pY = this.projectMatPoint(mats.pvMat, wx, wyGl + worldSpan, wz, ow, oh);
      const pZ = this.projectMatPoint(mats.pvMat, wx, wyGl, wz + worldSpan, ow, oh);

      const drawArrow = (target, color, label) => {
        if (!target) return null;
        let dx = target.x - pCenter.x;
        let dy = target.y - pCenter.y;
        const len = Math.hypot(dx, dy);
        if (len < 6) {
          // Ensure Z handle remains reachable even straight-on from front view
          if (label === 'Z') { dx = -34; dy = 28; }
          else return null;
        } else if (len > 62) {
          dx = (dx / len) * 56;
          dy = (dy / len) * 56;
        } else if (len < 36) {
          dx = (dx / len) * 40;
          dy = (dy / len) * 40;
        }
        const tx = pCenter.x + dx;
        const ty = pCenter.y + dy;
        octx.strokeStyle = color;
        octx.lineWidth = 2.6;
        octx.beginPath();
        octx.moveTo(pCenter.x, pCenter.y);
        octx.lineTo(tx, ty);
        octx.stroke();

        octx.fillStyle = color;
        octx.beginPath();
        octx.arc(tx, ty, 7, 0, Math.PI * 2);
        octx.fill();
        octx.fillStyle = '#071018';
        octx.font = 'bold 9px system-ui, sans-serif';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText(label, tx, ty + 0.5);
        return { x: tx, y: ty, dirX: dx / Math.max(1, Math.hypot(dx, dy)), dirY: dy / Math.max(1, Math.hypot(dx, dy)) };
      };

      const hX = drawArrow(pX, '#FF5252', 'X');
      const hY = drawArrow(pY, '#69F0AE', 'Y');
      const hZ = drawArrow(pZ, '#40C4FF', 'Z');

      // Center white free-move ring
      octx.strokeStyle = '#FFFFFF';
      octx.lineWidth = 1.8;
      octx.beginPath();
      octx.arc(pCenter.x, pCenter.y, 8, 0, Math.PI * 2);
      octx.stroke();

      this.lastGizmoHandles = { tool: 'move', cx: pCenter.x, cy: pCenter.y, x: hX, y: hY, z: hZ };
    } else if (tool === 'rotate') {
      const rOuter = 54;
      const rInner = 38;
      // Outer Z Roll ring
      octx.strokeStyle = 'rgba(64, 196, 255, 0.85)';
      octx.lineWidth = 2.4;
      octx.beginPath();
      octx.arc(pCenter.x, pCenter.y, rOuter, 0, Math.PI * 2);
      octx.stroke();

      // Horizontal Yaw Y ellipse
      octx.strokeStyle = 'rgba(105, 240, 174, 0.85)';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.ellipse(pCenter.x, pCenter.y, rInner, rInner * 0.36, 0, 0, Math.PI * 2);
      octx.stroke();

      // Vertical Pitch X ellipse
      octx.strokeStyle = 'rgba(255, 82, 82, 0.85)';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.ellipse(pCenter.x, pCenter.y, rInner * 0.36, rInner, 0, 0, Math.PI * 2);
      octx.stroke();

      this.lastGizmoHandles = { tool: 'rotate', cx: pCenter.x, cy: pCenter.y, rInner, rOuter };
    }
  }

  drawTrackerReticleOverlay(octx, project, frame, ow, oh) {
    const tr = this.trackerOverlay;
    const sx = ow / project.width;
    const sy = oh / project.height;

    const srcLayer = project.layers.find((l) => l.id === tr.sourceLayerId);
    const points = srcLayer?.trackData?.points || [];

    // Draw tracked motion path trail if points exist
    if (points.length > 1) {
      octx.save();
      octx.strokeStyle = 'rgba(255, 171, 64, 0.78)';
      octx.lineWidth = 2;
      octx.setLineDash([4, 4]);
      octx.beginPath();
      points.forEach((p, idx) => {
        const px = (project.width / 2 + p.x) * sx;
        const py = (project.height / 2 + p.y) * sy;
        if (idx === 0) octx.moveTo(px, py);
        else octx.lineTo(px, py);
      });
      octx.stroke();
      octx.setLineDash([]);

      for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 24))) {
        const p = points[i];
        const px = (project.width / 2 + p.x) * sx;
        const py = (project.height / 2 + p.y) * sy;
        octx.fillStyle = p.extrapolated ? '#FF5252' : p.coasting ? '#FFAB40' : '#69F0AE';
        octx.beginPath();
        octx.arc(px, py, 2.5, 0, Math.PI * 2);
        octx.fill();
      }
      octx.restore();
    }

    // Active reticle position: follow tracked point during playback/after tracking, or use manual aim target
    const matchedPt = (tr.followTrackedPoints && !tr.dragging) ? points.find((p) => p.frame === Math.round(frame)) : null;
    const tx = matchedPt ? matchedPt.x : tr.targetX;
    const ty = matchedPt ? matchedPt.y : tr.targetY;
    const rx = (project.width / 2 + tx) * sx;
    const ry = (project.height / 2 + ty) * sy;
    const boxW = Math.max(28, (tr.patchRadius || 28) * 2 * sx);
    const searchW = Math.max(boxW + 18, (tr.searchRadius || 95) * 2 * sx);

    this.lastTrackerBox = { rx, ry, sx, sy, boxW };

    const statusColor = matchedPt
      ? (matchedPt.extrapolated ? '#FF5252' : matchedPt.coasting ? '#FFAB40' : (matchedPt.score >= 0.7 ? '#69F0AE' : '#FFAB40'))
      : '#FFAB40';

    octx.save();
    octx.translate(rx, ry);

    // Outer dashed search window
    octx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    octx.lineWidth = 1;
    octx.setLineDash([4, 3]);
    octx.strokeRect(-searchW / 2, -searchW / 2, searchW, searchW);
    octx.setLineDash([]);

    // Inner template patch brackets
    const half = boxW / 2;
    const bLen = Math.min(12, half * 0.55);
    octx.strokeStyle = statusColor;
    octx.lineWidth = 2.2;
    octx.beginPath();
    // TL
    octx.moveTo(-half, -half + bLen); octx.lineTo(-half, -half); octx.lineTo(-half + bLen, -half);
    // TR
    octx.moveTo(half - bLen, -half); octx.lineTo(half, -half); octx.lineTo(half, -half + bLen);
    // BR
    octx.moveTo(half, half - bLen); octx.lineTo(half, half); octx.lineTo(half - bLen, half);
    // BL
    octx.moveTo(-half + bLen, half); octx.lineTo(-half, half); octx.lineTo(-half, half - bLen);
    octx.stroke();

    // Center crosshair +
    octx.strokeStyle = '#00E5FF';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.moveTo(-8, 0); octx.lineTo(8, 0);
    octx.moveTo(0, -8); octx.lineTo(0, 8);
    octx.stroke();

    // Label pill above reticle
    const scoreTxt = matchedPt
      ? `${matchedPt.extrapolated ? 'EXIT' : matchedPt.coasting ? 'COAST' : 'LOCK'} ${Math.round((matchedPt.score || 1) * 100)}%`
      : 'AIM TARGET';
    octx.font = 'bold 10px system-ui, sans-serif';
    const tw = octx.measureText(scoreTxt).width + 10;
    octx.fillStyle = 'rgba(11, 14, 20, 0.85)';
    octx.fillRect(-tw / 2, -half - 20, tw, 15);
    octx.fillStyle = statusColor;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(scoreTxt, 0, -half - 12.5);

    octx.restore();

    // Floating 2.6x precision Magnifier Loupe when dragging target on small mobile screens
    if (tr.dragging && this.canvas && this.canvas.width > 0 && this.canvas.height > 0) {
      const loupeR = 28;
      const loupeX = Math.max(loupeR + 8, Math.min(ow - loupeR - 8, rx));
      const loupeY = ry - 64 >= loupeR + 8 ? ry - 64 : Math.min(oh - loupeR - 8, ry + 64);
      const scaleSrcX = this.canvas.width / Math.max(1, ow);
      const scaleSrcY = this.canvas.height / Math.max(1, oh);
      const zoom = 2.6;
      const srcR = (loupeR / zoom) * scaleSrcX;
      const srcX = rx * scaleSrcX;
      const srcY = ry * scaleSrcY;

      octx.save();
      octx.beginPath();
      octx.arc(loupeX, loupeY, loupeR, 0, Math.PI * 2);
      octx.clip();
      octx.fillStyle = '#05070B';
      octx.fillRect(loupeX - loupeR, loupeY - loupeR, loupeR * 2, loupeR * 2);
      try {
        octx.drawImage(
          this.canvas,
          Math.max(0, srcX - srcR),
          Math.max(0, srcY - srcR * (scaleSrcY / Math.max(0.01, scaleSrcX))),
          Math.max(4, srcR * 2),
          Math.max(4, srcR * 2 * (scaleSrcY / Math.max(0.01, scaleSrcX))),
          loupeX - loupeR,
          loupeY - loupeR,
          loupeR * 2,
          loupeR * 2
        );
      } catch {}

      // Precision crosshair inside loupe
      octx.strokeStyle = 'rgba(0, 229, 255, 0.9)';
      octx.lineWidth = 1.2;
      octx.beginPath();
      octx.moveTo(loupeX - 10, loupeY); octx.lineTo(loupeX + 10, loupeY);
      octx.moveTo(loupeX, loupeY - 10); octx.lineTo(loupeX, loupeY + 10);
      octx.stroke();
      octx.restore();

      // Ring & Color-Lock preview swatch badge
      octx.save();
      octx.beginPath();
      octx.arc(loupeX, loupeY, loupeR, 0, Math.PI * 2);
      octx.lineWidth = 2.5;
      octx.strokeStyle = '#FFAB40';
      octx.stroke();

      if (tr.sampledColorHex) {
        const badgeY = loupeY + loupeR + 10;
        const lbl = tr.sampledColorHex;
        octx.font = 'bold 9px system-ui, sans-serif';
        const bw = octx.measureText(lbl).width + 20;
        octx.fillStyle = 'rgba(11, 14, 20, 0.9)';
        octx.fillRect(loupeX - bw / 2, badgeY - 8, bw, 15);
        octx.fillStyle = tr.sampledColorHex;
        octx.fillRect(loupeX - bw / 2 + 4, badgeY - 4.5, 8, 8);
        octx.fillStyle = '#FFFFFF';
        octx.textAlign = 'left';
        octx.textBaseline = 'middle';
        octx.fillText(lbl, loupeX - bw / 2 + 15, badgeY - 0.5);
      }
      octx.restore();
    }
  }

  hitTestOverlay(px, py) {
    if (this.trackerOverlay?.active && this.lastTrackerBox) {
      const tb = this.lastTrackerBox;
      if (Math.hypot(px - tb.rx, py - tb.ry) <= Math.max(32, tb.boxW * 0.75)) {
        return 'tracker';
      }
    }

    // Check interactive bottom-left Blender 3D Triad handles
    if (this.viewport3D?.enabled && this.lastTriadHandles) {
      const th = this.lastTriadHandles;
      for (const a of th.axes || []) {
        if (Math.hypot(px - a.x, py - a.y) <= 13) {
          return `triad_${a.label.toLowerCase()}`;
        }
      }
      if (Math.hypot(px - th.cx, py - th.cy) <= th.r) {
        return 'triad_reset';
      }
    }

    // Check 3D Gizmo handles first when Blender 3D Viewport is active
    if (this.viewport3D?.enabled && this.lastGizmoHandles) {
      const g = this.lastGizmoHandles;
      if (g.tool === 'move') {
        if (g.x && Math.hypot(px - g.x.x, py - g.x.y) <= 22) return 'gizmo_x';
        if (g.y && Math.hypot(px - g.y.x, py - g.y.y) <= 22) return 'gizmo_y';
        if (g.z && Math.hypot(px - g.z.x, py - g.z.y) <= 22) return 'gizmo_z';
        if (Math.hypot(px - g.cx, py - g.cy) <= 16) return 'move';
      } else if (g.tool === 'rotate') {
        const dist = Math.hypot(px - g.cx, py - g.cy);
        if (dist <= g.rOuter + 14) {
          return dist >= g.rInner + 4 ? 'gizmo_rot_z' : 'gizmo_rot_xy';
        }
      }
    }

    const box = this.lastOverlayBox;
    if (box && !(this.viewport3D?.enabled && this.viewport3D.tool === 'camera')) {
      if (Array.isArray(box.corners) && box.corners.length === 4) {
        for (const c of box.corners) {
          if (Math.hypot(px - c.x, py - c.y) <= 18) return 'scale';
        }
      }

      const dx = px - box.cx;
      const dy = py - box.cy;
      const cos = Math.cos(-box.rad);
      const sin = Math.sin(-box.rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;

      if (!this.viewport3D?.enabled && Math.hypot(lx - 0, ly - (-box.bh / 2 - 22)) <= 18) {
        return 'rotate';
      }

      if (Array.isArray(box.corners) && box.corners.length === 4 && this._pointInConvexQuad(px, py, box.corners, 8)) {
        return 'move';
      }
      if (Math.abs(lx) <= box.bw / 2 + 10 && Math.abs(ly) <= box.bh / 2 + 10) return 'move';
    }

    if (this.viewport3D?.enabled) {
      return 'cam_orbit';
    }
    return null;
  }

  _pointInConvexQuad(px, py, corners, pad = 0) {
    let cx = 0;
    let cy = 0;
    for (const c of corners) { cx += c.x; cy += c.y; }
    cx /= 4;
    cy /= 4;
    const pts = pad > 0 ? corners.map((c) => {
      const vx = c.x - cx;
      const vy = c.y - cy;
      const len = Math.max(1, Math.hypot(vx, vy));
      return { x: c.x + (vx / len) * pad, y: c.y + (vy / len) * pad };
    }) : corners;

    let pos = 0;
    let neg = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cross > 0) pos++;
      else if (cross < 0) neg++;
    }
    return pos === 0 || neg === 0;
  }

  hitTestAnyLayer(px, py) {
    if (!Array.isArray(this.renderedLayerQuads)) return null;
    for (const q of this.renderedLayerQuads) {
      if (this._pointInConvexQuad(px, py, q.corners, 6)) {
        return q.layerId;
      }
    }
    return null;
  }

  async captureSourceLayerPng(project, frame, mediaMap, layerId) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    await this.seekVideosForFrame(project, frame, mediaMap, true);
    const drawable = this.resolveLayerDrawable(layer, frame, project.fps || 30, mediaMap);
    if (!drawable || !drawable.el) return null;
    const w = Math.max(2, Math.round(drawable.el.videoWidth || drawable.el.naturalWidth || drawable.w || layer.width || 640));
    const h = Math.max(2, Math.round(drawable.el.videoHeight || drawable.el.naturalHeight || drawable.h || layer.height || 360));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(drawable.el, 0, 0, w, h);
    return {
      dataUrl: c.toDataURL('image/png'),
      width: w,
      height: h
    };
  }

  capturePreviewThumbnailDataUrl(maxW = 128, maxH = 96) {
    try {
      const src = this.canvas;
      if (!src || !src.width || !src.height) return null;
      const scale = Math.min(maxW / src.width, maxH / src.height, 1);
      const w = Math.max(24, Math.round(src.width * scale));
      const h = Math.max(24, Math.round(src.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }
}
