import { deepClone } from '../utils/math.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rgbToHex(r, g, b) {
  const toHex = (x) => clamp(Math.round(x * 255), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb01(hex) {
  const clean = String(hex || '#808080').replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255
    ];
  }
  if (clean.length !== 6) return [0.5, 0.5, 0.5];
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return [0.5, 0.5, 0.5];
  return [r / 255, g / 255, b / 255];
}

function rgbSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 1e-5) return 0;
  const l = (max + min) * 0.5;
  const d = max - min;
  if (d <= 1e-5) return 0;
  return l > 0.5 ? d / Math.max(1e-5, 2 - max - min) : d / Math.max(1e-5, max + min);
}

/**
 * Pure JS pixel color palette & tonal statistics analyzer.
 * Works identically in browser Canvas ImageData and headless Node.js unit tests.
 */
export function analyzeRgbaPalette(rgbaData, width = 1, height = 1, options = {}) {
  if (!rgbaData || rgbaData.length < 4) return null;
  const stride = Math.max(1, Number(options.stride) || 1);
  const alphaThreshold = options.alphaThreshold ?? 20;

  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLum = 0;
  let sumLumSq = 0;
  let sumSat = 0;

  const lums = [];
  const buckets = new Map(); // 4x4x4 quantized color histogram

  const totalPx = Math.floor(rgbaData.length / 4);
  for (let idx = 0; idx < totalPx; idx += stride) {
    const off = idx * 4;
    const a = rgbaData[off + 3];
    if (a < alphaThreshold) continue;

    const r = rgbaData[off] / 255;
    const g = rgbaData[off + 1] / 255;
    const b = rgbaData[off + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = rgbSaturation(r, g, b);

    sumR += r;
    sumG += g;
    sumB += b;
    sumLum += lum;
    sumLumSq += lum * lum;
    sumSat += sat;
    lums.push(lum);
    count++;

    const qr = Math.min(3, Math.floor(r * 4));
    const qg = Math.min(3, Math.floor(g * 4));
    const qb = Math.min(3, Math.floor(b * 4));
    const key = (qr << 4) | (qg << 2) | qb;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  }

  if (count === 0) return null;

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const meanLuma = sumLum / count;
  const variance = Math.max(0, sumLumSq / count - meanLuma * meanLuma);
  const lumaStd = Math.sqrt(variance);
  const meanSat = sumSat / count;

  lums.sort((a, b) => a - b);
  const qCount = Math.max(1, Math.floor(lums.length * 0.25));
  let shadowSum = 0;
  let highSum = 0;
  for (let i = 0; i < qCount; i++) {
    shadowSum += lums[i];
    highSum += lums[lums.length - 1 - i];
  }
  const shadowLuma = shadowSum / qCount;
  const highlightLuma = highSum / qCount;

  const sortedBuckets = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bk) => {
      const br = bk.r / bk.count;
      const bg = bk.g / bk.count;
      const bb = bk.b / bk.count;
      return {
        r: Number(br.toFixed(4)),
        g: Number(bg.toFixed(4)),
        b: Number(bb.toFixed(4)),
        hex: rgbToHex(br, bg, bb),
        weight: Number((bk.count / count).toFixed(4))
      };
    });

  return {
    sampleCount: count,
    width,
    height,
    meanR: Number(meanR.toFixed(4)),
    meanG: Number(meanG.toFixed(4)),
    meanB: Number(meanB.toFixed(4)),
    meanLuma: Number(meanLuma.toFixed(4)),
    lumaStd: Number(lumaStd.toFixed(4)),
    shadowLuma: Number(shadowLuma.toFixed(4)),
    highlightLuma: Number(highlightLuma.toFixed(4)),
    meanSat: Number(meanSat.toFixed(4)),
    warmth: Number((meanR - meanB).toFixed(4)),
    tintBias: Number((((meanR + meanB) * 0.5) - meanG).toFixed(4)),
    avgHex: rgbToHex(meanR, meanG, meanB),
    swatches: sortedBuckets
  };
}

/**
 * Generates an analytical palette for vector shape layers.
 */
export function analyzeShapePalette(shapeProps) {
  if (!shapeProps) return null;
  const [r, g, b] = hexToRgb01(shapeProps.fillColor || '#7C4DFF');
  const [sr, sg, sb] = hexToRgb01(shapeProps.strokeColor || shapeProps.fillColor || '#00E5FF');
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = rgbSaturation(r, g, b);
  return {
    sampleCount: 1,
    meanR: r,
    meanG: g,
    meanB: b,
    meanLuma: lum,
    lumaStd: 0.14,
    shadowLuma: clamp(lum - 0.12, 0, 1),
    highlightLuma: clamp(lum + 0.12, 0, 1),
    meanSat: sat,
    warmth: r - b,
    tintBias: ((r + b) * 0.5) - g,
    avgHex: rgbToHex(r, g, b),
    swatches: [
      { r, g, b, hex: rgbToHex(r, g, b), weight: 0.78 },
      { r: sr, g: sg, b: sb, hex: rgbToHex(sr, sg, sb), weight: 0.22 }
    ]
  };
}

/**
 * Applies existing layer.fx grading onto a raw palette estimate using the same
 * color math as the WebGL fragment shader so the timeline's average palette
 * reflects existing graded clips.
 */
export function applyFxToPalette(rawPalette, fx) {
  if (!rawPalette) return null;
  if (!fx) return deepClone(rawPalette);

  const transformRgb = (r0, g0, b0) => {
    const expMul = Math.pow(2, (Number(fx.exposure) || 0) * 1.4);
    const temp = Number(fx.temperature) || 0;
    const tint = Number(fx.tint) || 0;
    const bright = Number(fx.brightness) || 0;
    const shadows = Number(fx.shadows) || 0;
    const highlights = Number(fx.highlights) || 0;
    const contrast = fx.contrast ?? 1;
    const sat = fx.saturation ?? 1;
    const fade = Number(fx.fade) || 0;

    let r = r0 * expMul;
    let g = g0 * expMul;
    let b = b0 * expMul;

    r += temp * 0.14 + tint * 0.06;
    g += temp * 0.02 - tint * 0.10;
    b -= temp * 0.14 - tint * 0.06;

    r += bright * 0.45;
    g += bright * 0.45;
    b += bright * 0.45;

    const lumAdj = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadowW = Math.pow(clamp(1.0 - lumAdj, 0, 1), 1.6);
    const highW = Math.pow(clamp(lumAdj, 0, 1), 1.6);
    const toneBoost = shadows * 0.35 * shadowW + highlights * 0.35 * highW;
    r += toneBoost;
    g += toneBoost;
    b += toneBoost;

    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * sat;
    g = lum + (g - lum) * sat;
    b = lum + (b - lum) * sat;

    if (fade > 0.005) {
      r = r + (Math.max(r, 0.16) - r) * fade;
      g = g + (Math.max(g, 0.16) - g) * fade;
      b = b + (Math.max(b, 0.16) - b) * fade;
    }

    return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
  };

  const [mr, mg, mb] = transformRgb(rawPalette.meanR, rawPalette.meanG, rawPalette.meanB);
  const contrast = fx.contrast ?? 1;
  const expMul = Math.pow(2, (Number(fx.exposure) || 0) * 1.4);
  const meanLuma = clamp(0.299 * mr + 0.587 * mg + 0.114 * mb, 0, 1);
  const lumaStd = clamp((rawPalette.lumaStd ?? 0.16) * expMul * contrast, 0.02, 0.5);
  const meanSat = clamp((rawPalette.meanSat ?? 0.25) * (fx.saturation ?? 1), 0, 1);

  const shadowRgb = transformRgb(rawPalette.shadowLuma, rawPalette.shadowLuma, rawPalette.shadowLuma);
  const highRgb = transformRgb(rawPalette.highlightLuma, rawPalette.highlightLuma, rawPalette.highlightLuma);
  const shadowLuma = clamp(0.299 * shadowRgb[0] + 0.587 * shadowRgb[1] + 0.114 * shadowRgb[2], 0, 1);
  const highlightLuma = clamp(0.299 * highRgb[0] + 0.587 * highRgb[1] + 0.114 * highRgb[2], 0, 1);

  const swatches = (rawPalette.swatches || []).map((s) => {
    const [sr, sg, sb] = transformRgb(s.r, s.g, s.b);
    return { r: sr, g: sg, b: sb, hex: rgbToHex(sr, sg, sb), weight: s.weight };
  });

  return {
    ...rawPalette,
    meanR: Number(mr.toFixed(4)),
    meanG: Number(mg.toFixed(4)),
    meanB: Number(mb.toFixed(4)),
    meanLuma: Number(meanLuma.toFixed(4)),
    lumaStd: Number(lumaStd.toFixed(4)),
    shadowLuma: Number(shadowLuma.toFixed(4)),
    highlightLuma: Number(highlightLuma.toFixed(4)),
    meanSat: Number(meanSat.toFixed(4)),
    warmth: Number((mr - mb).toFixed(4)),
    tintBias: Number((((mr + mb) * 0.5) - mg).toFixed(4)),
    avgHex: rgbToHex(mr, mg, mb),
    swatches
  };
}

export function isNonSceneOverlayMediaId(mediaId) {
  if (!mediaId) return false;
  return mediaId.startsWith('stk_') || mediaId.startsWith('draw_') || mediaId.startsWith('cutout_');
}

/**
 * Computes the duration-weighted average color palette across existing visual layers
 * in the project timeline (excluding the target/new layer).
 */
export function computeTimelineAveragePalette(project, paletteResolver, options = {}) {
  if (!project || !Array.isArray(project.layers)) return null;
  const excludeLayerId = options.excludeLayerId || null;
  const excludeSet = options.excludeLayerIds ? new Set(options.excludeLayerIds) : null;
  const layersSource = Array.isArray(options.layers) ? options.layers : project.layers;

  const getRawPalette = (layer) => {
    if (typeof paletteResolver === 'function') return paletteResolver(layer);
    if (paletteResolver instanceof Map) {
      return paletteResolver.get(layer.id) || paletteResolver.get(layer.mediaId) || null;
    }
    if (paletteResolver && typeof paletteResolver === 'object') {
      return paletteResolver[layer.id] || paletteResolver[layer.mediaId] || null;
    }
    return null;
  };

  const candidates = layersSource.filter((l) => {
    if (!l || !l.visible) return false;
    if (l.id === excludeLayerId) return false;
    if (excludeSet && excludeSet.has(l.id)) return false;
    if (l.type === 'audio' || l.type === 'group' || l.type === 'text') return false;
    if (isNonSceneOverlayMediaId(l.mediaId)) return false;
    return l.type === 'video' || l.type === 'image' || l.type === 'shape';
  });

  // Prefer real media (video/image) over vector shapes if both exist
  const mediaCandidates = candidates.filter((l) => l.type === 'video' || l.type === 'image');
  const pool = mediaCandidates.length > 0 ? mediaCandidates : candidates;

  let totalWeight = 0;
  let wR = 0;
  let wG = 0;
  let wB = 0;
  let wLum = 0;
  let wStd = 0;
  let wShadow = 0;
  let wHigh = 0;
  let wSat = 0;
  let layerCount = 0;
  const swatchAccumulator = [];

  for (const layer of pool) {
    let raw = getRawPalette(layer);
    if (!raw && layer.type === 'shape' && layer.shapeProps) {
      raw = analyzeShapePalette(layer.shapeProps);
    }
    if (!raw) continue;

    const graded = applyFxToPalette(raw, layer.fx);
    const durWeight = Math.max(15, Math.min(600, (layer.endFrame || 30) - (layer.startFrame || 0)));
    const roleBoost = layer.trackRole === 'main' ? 1.35 : 1.0;
    const weight = durWeight * roleBoost;

    wR += graded.meanR * weight;
    wG += graded.meanG * weight;
    wB += graded.meanB * weight;
    wLum += graded.meanLuma * weight;
    wStd += graded.lumaStd * weight;
    wShadow += graded.shadowLuma * weight;
    wHigh += graded.highlightLuma * weight;
    wSat += graded.meanSat * weight;
    totalWeight += weight;
    layerCount++;

    for (const sw of graded.swatches || []) {
      swatchAccumulator.push({ ...sw, score: (sw.weight || 0.2) * weight });
    }
  }

  if (totalWeight <= 0 || layerCount === 0) return null;

  const meanR = clamp(wR / totalWeight, 0, 1);
  const meanG = clamp(wG / totalWeight, 0, 1);
  const meanB = clamp(wB / totalWeight, 0, 1);
  const meanLuma = clamp(wLum / totalWeight, 0, 1);
  const lumaStd = clamp(wStd / totalWeight, 0.02, 0.5);
  const shadowLuma = clamp(wShadow / totalWeight, 0, 1);
  const highlightLuma = clamp(wHigh / totalWeight, 0, 1);
  const meanSat = clamp(wSat / totalWeight, 0, 1);

  // Merge similar swatches across layers so the timeline summary shows distinct palette tones
  const mergedSwatches = [];
  swatchAccumulator.sort((a, b) => b.score - a.score);
  for (const sw of swatchAccumulator) {
    const existing = mergedSwatches.find(
      (m) => Math.hypot(m.r - sw.r, m.g - sw.g, m.b - sw.b) < 0.16
    );
    if (existing) {
      const comb = existing.score + sw.score;
      existing.r = (existing.r * existing.score + sw.r * sw.score) / comb;
      existing.g = (existing.g * existing.score + sw.g * sw.score) / comb;
      existing.b = (existing.b * existing.score + sw.b * sw.score) / comb;
      existing.hex = rgbToHex(existing.r, existing.g, existing.b);
      existing.score = comb;
    } else if (mergedSwatches.length < 5) {
      mergedSwatches.push({ ...sw });
    }
  }
  const maxSwatchScore = mergedSwatches.reduce((acc, s) => acc + s.score, 0) || 1;
  const swatches = mergedSwatches.map((s) => ({
    r: Number(s.r.toFixed(4)),
    g: Number(s.g.toFixed(4)),
    b: Number(s.b.toFixed(4)),
    hex: s.hex,
    weight: Number((s.score / maxSwatchScore).toFixed(3))
  }));

  return {
    layerCount,
    meanR: Number(meanR.toFixed(4)),
    meanG: Number(meanG.toFixed(4)),
    meanB: Number(meanB.toFixed(4)),
    meanLuma: Number(meanLuma.toFixed(4)),
    lumaStd: Number(lumaStd.toFixed(4)),
    shadowLuma: Number(shadowLuma.toFixed(4)),
    highlightLuma: Number(highlightLuma.toFixed(4)),
    meanSat: Number(meanSat.toFixed(4)),
    warmth: Number((meanR - meanB).toFixed(4)),
    tintBias: Number((((meanR + meanB) * 0.5) - meanG).toFixed(4)),
    avgHex: rgbToHex(meanR, meanG, meanB),
    swatches
  };
}

/**
 * Computes WebGL shader-compatible grading parameters that transform sourcePalette
 * toward targetPalette, scaled smoothly by intensity in [0, 1].
 */
export function computeColorMatchFx(sourcePalette, targetPalette, intensity = 0.78) {
  const neutral = {
    exposure: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0
  };
  if (!sourcePalette || !targetPalette) return neutral;

  const t = clamp(Number(intensity) || 0, 0, 1);
  if (t <= 0.001) return neutral;

  // 1. Exposure & overall luminance match
  const lumaRatio = clamp((targetPalette.meanLuma + 0.06) / (sourcePalette.meanLuma + 0.06), 0.48, 2.1);
  const fullExp = clamp((Math.log2(lumaRatio) / 1.4) * 0.58, -0.52, 0.52);
  const fullBright = clamp((targetPalette.meanLuma - sourcePalette.meanLuma) * 0.35, -0.28, 0.28);

  // 2. Contrast match (dynamic range ratio)
  const stdRatio = clamp((targetPalette.lumaStd + 0.045) / (sourcePalette.lumaStd + 0.045), 0.62, 1.65);
  const fullContrast = clamp(1 + (stdRatio - 1) * 0.65, 0.6, 1.65);

  // 3. Highlights & Shadows match (post-exposure offset)
  const expScale = Math.pow(2, fullExp * 1.4);
  const estHigh = clamp(sourcePalette.highlightLuma * expScale + fullBright * 0.45, 0, 1);
  const estShad = clamp(sourcePalette.shadowLuma * expScale + fullBright * 0.45, 0, 1);
  const fullHighlights = clamp((targetPalette.highlightLuma - estHigh) * 0.55, -0.32, 0.32);
  const fullShadows = clamp((targetPalette.shadowLuma - estShad) * 0.55, -0.32, 0.32);

  // 4. Saturation balance
  const satRatio = clamp((targetPalette.meanSat + 0.07) / (sourcePalette.meanSat + 0.07), 0.35, 1.85);
  const fullSat = clamp(1 + (satRatio - 1) * 0.78, 0.28, 1.85);

  // 5. White balance (Temperature Warm/Cool + Tint Green/Magenta)
  const deltaWarmth = (targetPalette.warmth ?? 0) - (sourcePalette.warmth ?? 0);
  const deltaTint = (targetPalette.tintBias ?? 0) - (sourcePalette.tintBias ?? 0);
  // In WebGL shader: r += temp*0.14, b -= temp*0.14 => (r - b) shifts by ~0.28*temp
  const fullTemp = clamp((deltaWarmth / 0.28) * 0.85, -0.62, 0.62);
  // In WebGL shader: r += tint*0.06, b += tint*0.06, g -= tint*0.10 => ((r+b)/2 - g) shifts by ~0.16*tint
  const fullTint = clamp((deltaTint / 0.16) * 0.78, -0.52, 0.52);

  return {
    exposure: Number((fullExp * t).toFixed(3)),
    brightness: Number((fullBright * t).toFixed(3)),
    contrast: Number((1 + (fullContrast - 1) * t).toFixed(3)),
    saturation: Number((1 + (fullSat - 1) * t).toFixed(3)),
    temperature: Number((fullTemp * t).toFixed(3)),
    tint: Number((fullTint * t).toFixed(3)),
    highlights: Number((fullHighlights * t).toFixed(3)),
    shadows: Number((fullShadows * t).toFixed(3))
  };
}

const MATCH_KEYS = [
  'exposure',
  'brightness',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows'
];

export function applyColorMatchToLayer(layer, sourcePalette, targetPalette, intensity = 0.78) {
  if (!layer || !sourcePalette || !targetPalette) return false;
  if (!layer.fx) layer.fx = {};

  const existingBase = layer.colorMatch?.baseFx
    ? layer.colorMatch.baseFx
    : Object.fromEntries(MATCH_KEYS.map((k) => [k, layer.fx[k] ?? (k === 'contrast' || k === 'saturation' ? 1 : 0)]));

  const clampedInt = clamp(Number(intensity) || 0, 0, 1);
  const matchedFx = computeColorMatchFx(sourcePalette, targetPalette, clampedInt);

  for (const k of MATCH_KEYS) {
    const baseVal = existingBase[k] ?? (k === 'contrast' || k === 'saturation' ? 1 : 0);
    if (k === 'contrast' || k === 'saturation') {
      layer.fx[k] = Number(clamp(baseVal * matchedFx[k], 0, 2.2).toFixed(3));
    } else {
      const lim = (k === 'exposure') ? 1.0 : (k === 'highlights' || k === 'shadows') ? 0.6 : 0.8;
      layer.fx[k] = Number(clamp(baseVal + matchedFx[k], -lim, lim).toFixed(3));
    }
  }

  layer.colorMatch = {
    enabled: true,
    intensity: Number(clampedInt.toFixed(2)),
    sourcePalette: deepClone(sourcePalette),
    targetPalette: deepClone(targetPalette),
    baseFx: deepClone(existingBase),
    matchedFx
  };
  return true;
}

export function setLayerColorMatchIntensity(layer, intensity) {
  const cm = layer?.colorMatch;
  if (!cm || !cm.sourcePalette || !cm.targetPalette) return false;
  return applyColorMatchToLayer(layer, cm.sourcePalette, cm.targetPalette, intensity);
}

export function toggleLayerColorMatch(layer, enabled) {
  const cm = layer?.colorMatch;
  if (!cm || !layer.fx) return false;
  cm.enabled = Boolean(enabled);
  if (!cm.enabled && cm.baseFx) {
    for (const k of MATCH_KEYS) {
      layer.fx[k] = cm.baseFx[k] ?? (k === 'contrast' || k === 'saturation' ? 1 : 0);
    }
    return true;
  }
  if (cm.enabled && cm.sourcePalette && cm.targetPalette) {
    return applyColorMatchToLayer(layer, cm.sourcePalette, cm.targetPalette, cm.intensity ?? 0.78);
  }
  return false;
}

export class ColorMatchEngine {
  constructor(renderer = null) {
    this.renderer = renderer;
    this.mediaPaletteCache = new Map(); // mediaId -> palette
  }

  purgeMediaCache(mediaId) {
    if (!mediaId) {
      this.mediaPaletteCache.clear();
      return;
    }
    const prefix = `${mediaId}:`;
    for (const key of this.mediaPaletteCache.keys()) {
      if (key === mediaId || key.startsWith(prefix)) {
        this.mediaPaletteCache.delete(key);
      }
    }
  }

  _sampleDrawableToPalette(el, widthHint = 48, heightHint = 48) {
    if (!el || typeof document === 'undefined') return null;
    try {
      const sampleW = 48;
      const sampleH = 48;
      const c = document.createElement('canvas');
      c.width = sampleW;
      c.height = sampleH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, sampleW, sampleH);
      ctx.drawImage(el, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      return analyzeRgbaPalette(data, widthHint, heightHint, { stride: 1 });
    } catch {
      return null;
    }
  }

  async _loadImageElement(url) {
    return new Promise((resolve) => {
      if (!url || typeof Image === 'undefined') return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const finish = (res) => { if (!done) { done = true; resolve(res); } };
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      setTimeout(() => finish(null), 2500);
      img.src = url;
    });
  }

  async _sampleVideoFrame(url) {
    return new Promise((resolve) => {
      if (!url || typeof document === 'undefined') return resolve(null);
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      let done = false;
      const cleanupAndResolve = (pal) => {
        if (done) return;
        done = true;
        try { vid.removeAttribute('src'); vid.load(); } catch {}
        resolve(pal);
      };
      const readNow = () => {
        const pal = this._sampleDrawableToPalette(vid, vid.videoWidth || 48, vid.videoHeight || 48);
        cleanupAndResolve(pal);
      };
      vid.onloadeddata = () => {
        const targetT = isFinite(vid.duration) && vid.duration > 0.6 ? Math.min(vid.duration * 0.2, 1.5) : 0;
        if (targetT <= 0.05) {
          readNow();
          return;
        }
        vid.addEventListener('seeked', readNow, { once: true });
        try { vid.currentTime = targetT; } catch { readNow(); }
        setTimeout(readNow, 400);
      };
      vid.onerror = () => cleanupAndResolve(null);
      setTimeout(() => cleanupAndResolve(null), 3000);
      vid.src = url;
    });
  }

  async extractPaletteForMediaItem(mediaItem) {
    if (!mediaItem) return null;
    const cacheKey = `${mediaItem.id}:${mediaItem.url || ''}`;
    if (this.mediaPaletteCache.has(cacheKey)) {
      return this.mediaPaletteCache.get(cacheKey);
    }

    let palette = null;
    if (mediaItem.type === 'image') {
      const cachedImg = this.renderer?.getImageElement?.(mediaItem);
      if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
        palette = this._sampleDrawableToPalette(cachedImg, cachedImg.naturalWidth, cachedImg.naturalHeight);
      }
      if (!palette && (mediaItem.url || mediaItem.thumbUrl)) {
        const loaded = await this._loadImageElement(mediaItem.url || mediaItem.thumbUrl);
        if (loaded) palette = this._sampleDrawableToPalette(loaded, loaded.naturalWidth, loaded.naturalHeight);
      }
    } else if (mediaItem.type === 'video') {
      const cachedVid = this.renderer?.getVideoElement?.(mediaItem);
      if (cachedVid && cachedVid.readyState >= 2 && cachedVid.videoWidth > 0) {
        palette = this._sampleDrawableToPalette(cachedVid, cachedVid.videoWidth, cachedVid.videoHeight);
      }
      if (!palette && mediaItem.thumbUrl) {
        const thumbImg = await this._loadImageElement(mediaItem.thumbUrl);
        if (thumbImg) palette = this._sampleDrawableToPalette(thumbImg, mediaItem.width || 48, mediaItem.height || 48);
      }
      if (!palette && mediaItem.url) {
        palette = await this._sampleVideoFrame(mediaItem.url);
      }
    }

    if (palette) {
      this.mediaPaletteCache.set(cacheKey, palette);
    }
    return palette;
  }

  async extractPaletteForLayer(layer, mediaMap) {
    if (!layer) return null;
    if (layer.type === 'shape' && layer.shapeProps) {
      return analyzeShapePalette(layer.shapeProps);
    }
    if ((layer.type === 'video' || layer.type === 'image') && layer.mediaId) {
      const item = mediaMap?.get?.(layer.mediaId);
      if (item) {
        return this.extractPaletteForMediaItem(item);
      }
    }
    return null;
  }

  async autoMatchLayerToTimeline(project, targetLayer, existingLayers, mediaMap, intensity = 0.78) {
    if (!project || !targetLayer) return null;
    if (targetLayer.type !== 'video' && targetLayer.type !== 'image' && targetLayer.type !== 'shape') return null;
    if (isNonSceneOverlayMediaId(targetLayer.mediaId)) return null;

    const pool = (existingLayers || []).filter(
      (l) =>
        l &&
        l.id !== targetLayer.id &&
        l.visible &&
        (l.type === 'video' || l.type === 'image' || l.type === 'shape') &&
        !isNonSceneOverlayMediaId(l.mediaId)
    );
    if (pool.length === 0) return null;

    const paletteByLayerId = new Map();
    await Promise.all(
      pool.map(async (l) => {
        const pal = await this.extractPaletteForLayer(l, mediaMap);
        if (pal) paletteByLayerId.set(l.id, pal);
      })
    );

    const targetTimelinePalette = computeTimelineAveragePalette(project, paletteByLayerId, {
      excludeLayerId: targetLayer.id,
      layers: pool
    });
    if (!targetTimelinePalette) return null;

    const sourcePalette = await this.extractPaletteForLayer(targetLayer, mediaMap);
    if (!sourcePalette) return null;

    applyColorMatchToLayer(targetLayer, sourcePalette, targetTimelinePalette, intensity);
    return targetLayer.colorMatch;
  }
}
