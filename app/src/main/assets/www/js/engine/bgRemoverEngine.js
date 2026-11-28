import { clamp } from '../utils/math.js';

/**
 * Converts RGB bytes [0..255] to uppercase #RRGGBB hex string.
 */
export function rgbToHex(r, g, b) {
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Samples a weighted average RGB/Hex color from an RGBA buffer around normalized (normX, normY) in [0, 1].
 */
export function pickChromaColorFromRgba(rgba, width, height, normX, normY, radius = 2) {
  if (!rgba || width <= 0 || height <= 0) {
    return { r: 0, g: 255, b: 0, hex: '#00FF00' };
  }
  const cx = clamp(Math.round(clamp(normX, 0, 1) * (width - 1)), 0, width - 1);
  const cy = clamp(Math.round(clamp(normY, 0, 1) * (height - 1)), 0, height - 1);
  const rad = Math.max(0, Math.min(6, Math.round(radius)));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let totalW = 0;

  for (let dy = -rad; dy <= rad; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= width) continue;
      const idx = (yy * width + xx) * 4;
      const a = rgba[idx + 3];
      if (a < 8) continue;
      const w = 1 / (1 + dx * dx + dy * dy);
      sumR += rgba[idx] * w;
      sumG += rgba[idx + 1] * w;
      sumB += rgba[idx + 2] * w;
      totalW += w;
    }
  }

  if (totalW <= 0) {
    const idx = (cy * width + cx) * 4;
    const r = rgba[idx] || 0;
    const g = rgba[idx + 1] || 0;
    const b = rgba[idx + 2] || 0;
    return { r, g, b, hex: rgbToHex(r, g, b) };
  }

  const r = Math.round(sumR / totalW);
  const g = Math.round(sumG / totalW);
  const b = Math.round(sumB / totalW);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

/**
 * Perceptual YCbCr distance between two RGB colors in [0..1] scale.
 */
function perceptualDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const dy = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const dcb = -0.168736 * dr - 0.331264 * dg + 0.5 * db;
  const dcr = 0.5 * dr - 0.418688 * dg - 0.081312 * db;
  return Math.sqrt(dy * dy * 0.45 + dcb * dcb * 2.1 + dcr * dcr * 2.1) / 255;
}

/**
 * Computes an automatic subject/foreground alpha mask using:
 * 1. Perimeter background clustering (top/left/right + bottom corners)
 * 2. Sobel edge gradient barrier map
 * 3. Bucketed geodesic flood-fill from image borders (separates connected background even if same brightness as clothing)
 * 4. Center-prior foreground weighting + despeckle + soft edge feathering
 */
export function computeAutoBgMask(rgba, width, height, options = {}) {
  const n = width * height;
  const alpha = new Uint8ClampedArray(n);
  const outRgba = new Uint8ClampedArray(n * 4);
  if (!rgba || n <= 0) {
    return { width, height, alpha, rgba: outRgba };
  }

  const sensitivity = clamp(Number(options.sensitivity ?? 0.55), 0.1, 0.95);
  const feather = clamp(Number(options.feather ?? 0.25), 0, 1);
  const invert = Boolean(options.invert);

  // 1. Grayscale & Sobel edge magnitude
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  }

  const grad = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -gray[idx - width - 1] + gray[idx - width + 1] +
        -2 * gray[idx - 1] + 2 * gray[idx + 1] +
        -gray[idx + width - 1] + gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] +
        gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
      grad[idx] = Math.min(1, Math.hypot(gx, gy) * 0.7);
    }
  }

  // 2. Collect border samples (quantized to 5-bit buckets) -> top 5 dominant background centroids
  const buckets = new Map();
  const addBorderPixel = (x, y) => {
    const p = (y * width + x) * 4;
    if (rgba[p + 3] < 20) return;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { count: 0, sr: 0, sg: 0, sb: 0 };
      buckets.set(key, entry);
    }
    entry.count++;
    entry.sr += r;
    entry.sg += g;
    entry.sb += b;
  };

  const borderBand = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  for (let y = 0; y < height; y++) {
    for (let b = 0; b < borderBand; b++) {
      addBorderPixel(b, y);
      addBorderPixel(width - 1 - b, y);
    }
  }
  for (let x = 0; x < width; x++) {
    for (let b = 0; b < borderBand; b++) {
      addBorderPixel(x, b);
    }
    // Include outer left/right corners of bottom edge (skipping bottom center where subject stands)
    if (x < width * 0.2 || x > width * 0.8) {
      addBorderPixel(x, height - 1);
    }
  }

  const sortedClusters = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((c) => ({
      r: c.sr / c.count,
      g: c.sg / c.count,
      b: c.sb / c.count
    }));

  if (sortedClusters.length === 0) {
    sortedClusters.push({ r: rgba[0] || 0, g: rgba[1] || 0, b: rgba[2] || 0 });
  }

  const minBgClusterDist = (pIdx) => {
    const p = pIdx * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    let best = 999;
    for (let k = 0; k < sortedClusters.length; k++) {
      const c = sortedClusters[k];
      const d = perceptualDist(r, g, b, c.r, c.g, c.b);
      if (d < best) best = d;
    }
    return best;
  };

  // 3. Bucketed Dial's Dijkstra geodesic distance from image perimeter
  const NUM_BUCKETS = 256;
  const SCALE_COST = 240; // ~1.0 cost maps to bucket 240
  const dist = new Float32Array(n).fill(1e6);
  const dialBuckets = Array.from({ length: NUM_BUCKETS + 1 }, () => []);
  const visited = new Uint8Array(n);

  const pushBucket = (idx, cost) => {
    const b = clamp(Math.floor(cost * SCALE_COST), 0, NUM_BUCKETS);
    dialBuckets[b].push(idx);
  };

  // Seed perimeter pixels
  for (let x = 0; x < width; x++) {
    const topIdx = x;
    const topCost = minBgClusterDist(topIdx) * 0.55;
    dist[topIdx] = topCost;
    pushBucket(topIdx, topCost);

    // Bottom edge corners seed easily; bottom center has slight foreground prior
    const botIdx = (height - 1) * width + x;
    const isBottomCorner = x < width * 0.22 || x > width * 0.78;
    const botCost = minBgClusterDist(botIdx) * (isBottomCorner ? 0.65 : 1.35);
    if (botCost < dist[botIdx]) {
      dist[botIdx] = botCost;
      pushBucket(botIdx, botCost);
    }
  }
  for (let y = 1; y < height - 1; y++) {
    const leftIdx = y * width;
    const leftCost = minBgClusterDist(leftIdx) * 0.55;
    if (leftCost < dist[leftIdx]) {
      dist[leftIdx] = leftCost;
      pushBucket(leftIdx, leftCost);
    }
    const rightIdx = y * width + (width - 1);
    const rightCost = minBgClusterDist(rightIdx) * 0.55;
    if (rightCost < dist[rightIdx]) {
      dist[rightIdx] = rightCost;
      pushBucket(rightIdx, rightCost);
    }
  }

  const dirs = [-1, 1, -width, width];
  for (let b = 0; b <= NUM_BUCKETS; b++) {
    const q = dialBuckets[b];
    while (q.length > 0) {
      const u = q.pop();
      if (visited[u]) continue;
      visited[u] = 1;
      const du = dist[u];
      if (du > 1.1) continue;

      const ux = u % width;
      const uy = (u - ux) / width;
      const up = u * 4;
      const ur = rgba[up];
      const ug = rgba[up + 1];
      const ub = rgba[up + 2];

      for (let d = 0; d < 4; d++) {
        if (d === 0 && ux === 0) continue;
        if (d === 1 && ux === width - 1) continue;
        if (d === 2 && uy === 0) continue;
        if (d === 3 && uy === height - 1) continue;
        const v = u + dirs[d];
        if (visited[v]) continue;

        const vp = v * 4;
        const stepColor = perceptualDist(ur, ug, ub, rgba[vp], rgba[vp + 1], rgba[vp + 2]);
        const edgePenalty = grad[v] * 0.42;
        const clusterPenalty = minBgClusterDist(v) * 0.28;
        const cand = du + stepColor * 0.9 + edgePenalty + clusterPenalty;
        if (cand < dist[v]) {
          dist[v] = cand;
          if (cand <= 1.08) pushBucket(v, cand);
        }
      }
    }
  }

  // 4. Score foreground confidence combining geodesic cost + global color distance + mild center prior
  const fgRaw = new Float32Array(n);
  const bgThreshold = 0.08 + (1 - sensitivity) * 0.36; // higher sensitivity => lower threshold => removes more BG
  const softWidth = 0.06 + feather * 0.16;

  for (let y = 0; y < height; y++) {
    const ny = (y / Math.max(1, height - 1)) - 0.52;
    for (let x = 0; x < width; x++) {
      const nx = (x / Math.max(1, width - 1)) - 0.5;
      const idx = y * width + x;
      const p = idx * 4;
      if (rgba[p + 3] < 8) {
        fgRaw[idx] = 0;
        continue;
      }
      const centerBonus = Math.max(0, 1 - (nx * nx * 2.2 + ny * ny * 1.4)) * 0.08;
      const geo = Math.min(1.2, dist[idx]);
      const colDist = minBgClusterDist(idx);
      const score = geo * 0.72 + colDist * 0.45 + centerBonus;
      const t = clamp((score - bgThreshold) / Math.max(0.02, softWidth), 0, 1);
      fgRaw[idx] = t * t * (3 - 2 * t);
    }
  }

  // 5. Light 3x3 morphological cleanup + feather smoothing
  const smoothed = new Float32Array(n);
  const centerWeight = 2.4 - feather * 1.4;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const idx = y * width + x;
      let sum = fgRaw[idx] * centerWeight;
      let wSum = centerWeight;
      let fgNeighbors = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (xx === x && yy === y) continue;
          const nv = fgRaw[yy * width + xx];
          if (nv > 0.5) fgNeighbors++;
          sum += nv;
          wSum += 1;
        }
      }
      let val = sum / wSum;
      // Remove isolated 1px noise speckles
      if (fgRaw[idx] > 0.7 && fgNeighbors <= 1) val *= 0.2;
      if (fgRaw[idx] < 0.2 && fgNeighbors >= 7) val = Math.max(val, 0.8);
      if (invert) val = 1 - val;
      smoothed[idx] = clamp(val, 0, 1);
    }
  }

  for (let i = 0; i < n; i++) {
    const aByte = Math.round(smoothed[i] * 255);
    alpha[i] = aByte;
    const p = i * 4;
    outRgba[p] = 255;
    outRgba[p + 1] = 255;
    outRgba[p + 2] = 255;
    outRgba[p + 3] = aByte;
  }

  return { width, height, alpha, rgba: outRgba };
}

export class BgRemoverEngine {
  constructor(renderer) {
    this.renderer = renderer;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  _maskToDataUrl(maskResult, canvasEl) {
    const c = canvasEl || document.createElement('canvas');
    if (c.width !== maskResult.width || c.height !== maskResult.height) {
      c.width = maskResult.width;
      c.height = maskResult.height;
    }
    const ctx = c.getContext('2d');
    const imgData = new ImageData(maskResult.rgba, maskResult.width, maskResult.height);
    ctx.putImageData(imgData, 0, 0);
    return c.toDataURL('image/png');
  }

  /**
   * Analyzes an Image or Video layer and computes Auto Remove BG masks
   * (single mask for image, multi-frame tracked silhouette masks for video).
   */
  async analyzeLayerAutoBg({
    project,
    layer,
    mediaMap,
    sensitivity = 0.55,
    feather = 0.25,
    invert = false,
    onProgress
  }) {
    this.cancelled = false;
    if (!layer || (layer.type !== 'video' && layer.type !== 'image')) {
      throw new Error('Select a Video or Image layer first');
    }

    const media = layer.mediaId ? mediaMap.get(layer.mediaId) : null;
    const srcW = Math.max(1, layer.width || media?.width || 640);
    const srcH = Math.max(1, layer.height || media?.height || 360);
    const maxAnalysisSide = 160;
    const scale = Math.min(1, maxAnalysisSide / Math.max(srcW, srcH));
    const aw = Math.max(48, Math.round(srcW * scale));
    const ah = Math.max(36, Math.round(srcH * scale));

    const readCanvas = document.createElement('canvas');
    readCanvas.width = aw;
    readCanvas.height = ah;
    const rctx = readCanvas.getContext('2d', { willReadFrequently: true });
    const maskCanvas = document.createElement('canvas');

    const fps = Math.max(1, project.fps || 30);

    if (layer.type === 'image') {
      const drawable = this.renderer.resolveLayerDrawable(layer, layer.startFrame, fps, mediaMap);
      if (!drawable) throw new Error('Image not loaded yet');
      rctx.clearRect(0, 0, aw, ah);
      rctx.drawImage(drawable.el, 0, 0, aw, ah);
      const imgData = rctx.getImageData(0, 0, aw, ah);
      const maskRes = computeAutoBgMask(imgData.data, aw, ah, { sensitivity, feather, invert });
      const dataUrl = this._maskToDataUrl(maskRes, maskCanvas);
      if (onProgress) onProgress(100, 1, 1);
      return {
        autoBgEnabled: true,
        autoBgSensitivity: sensitivity,
        autoBgFeather: feather,
        autoBgInvert: invert,
        autoBgDataUrl: dataUrl,
        autoBgFrames: null
      };
    }

    // Video clip: sample keyframes along clip duration at ~10 fps (capped at 72 keyframes)
    const totalTimelineFrames = Math.max(1, layer.endFrame - layer.startFrame);
    const idealSamples = Math.max(6, Math.min(72, Math.round((totalTimelineFrames / fps) * 10)));
    const frames = [];

    for (let i = 0; i < idealSamples; i++) {
      if (this.cancelled) throw new Error('Auto Remove BG cancelled');
      const t = idealSamples === 1 ? 0 : i / (idealSamples - 1);
      const tlFrame = Math.round(layer.startFrame + t * totalTimelineFrames);
      await this.renderer.seekVideosForFrame(project, tlFrame, mediaMap, true);
      const drawable = this.renderer.resolveLayerDrawable(layer, tlFrame, fps, mediaMap);
      if (!drawable) continue;

      rctx.clearRect(0, 0, aw, ah);
      rctx.drawImage(drawable.el, 0, 0, aw, ah);
      const imgData = rctx.getImageData(0, 0, aw, ah);
      const maskRes = computeAutoBgMask(imgData.data, aw, ah, { sensitivity, feather, invert });
      const dataUrl = this._maskToDataUrl(maskRes, maskCanvas);
      const srcSec = this.renderer.computeVideoSourceSeconds(layer, tlFrame, fps, drawable.el.duration);
      const srcFrame = Math.max(0, Math.round(srcSec * fps));
      frames.push({ srcFrame, tlFrame, dataUrl });

      if (onProgress) {
        onProgress(Math.round(((i + 1) / idealSamples) * 100), i + 1, idealSamples);
      }
      if (i % 2 === 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (frames.length === 0) {
      throw new Error('Could not decode video frames for Auto Remove BG');
    }

    frames.sort((a, b) => a.srcFrame - b.srcFrame);
    return {
      autoBgEnabled: true,
      autoBgSensitivity: sensitivity,
      autoBgFeather: feather,
      autoBgInvert: invert,
      autoBgDataUrl: frames[0].dataUrl,
      autoBgFrames: frames
    };
  }
}
