import { clamp } from '../utils/math.js';

export function rgbToHex(r, g, b) {
  const toH = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}

export function hexToRgb255(hex) {
  const clean = String(hex || '#00FF00').replace('#', '').trim();
  if (clean.length !== 6) return [0, 255, 0];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0
  ];
}

export function rgbToYCbCr(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const y = 0.299 * rn + 0.587 * gn + 0.114 * bn;
  const cb = -0.168736 * rn - 0.331264 * gn + 0.5 * bn;
  const cr = 0.5 * rn - 0.418688 * gn - 0.081312 * bn;
  return [y, cb, cr];
}

/**
 * Samples a trimmed-mean color patch around normalized coordinates (normX, normY) in [0..1].
 * Resistant to single-pixel compression noise on video/image frames.
 */
export function pickChromaSampleFromRgba(rgba, width, height, normX, normY, radius = 2) {
  if (!rgba || width <= 0 || height <= 0) {
    return { r: 0, g: 255, b: 0, hex: '#00FF00' };
  }
  const cx = clamp(Math.round(normX * (width - 1)), 0, width - 1);
  const cy = clamp(Math.round(normY * (height - 1)), 0, height - 1);
  const samples = [];

  for (let dy = -radius; dy <= radius; dy++) {
    const py = clamp(cy + dy, 0, height - 1);
    for (let dx = -radius; dx <= radius; dx++) {
      const px = clamp(cx + dx, 0, width - 1);
      const idx = (py * width + px) * 4;
      const a = rgba[idx + 3];
      if (a < 10) continue;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      samples.push({ r, g, b, luma });
    }
  }

  if (samples.length === 0) {
    const idx = (cy * width + cx) * 4;
    const r = rgba[idx] || 0;
    const g = rgba[idx + 1] || 255;
    const b = rgba[idx + 2] || 0;
    return { r, g, b, hex: rgbToHex(r, g, b) };
  }

  samples.sort((a, b) => a.luma - b.luma);
  const trim = samples.length >= 9 ? Math.floor(samples.length * 0.2) : 0;
  const slice = samples.slice(trim, samples.length - trim);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const s of slice) {
    sr += s.r;
    sg += s.g;
    sb += s.b;
  }
  const n = Math.max(1, slice.length);
  const r = Math.round(sr / n);
  const g = Math.round(sg / n);
  const b = Math.round(sb / n);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

/**
 * Extracts dominant background color clusters from the frame perimeter (top, left, right, upper corners),
 * avoiding bottom-center where standing subjects frequently touch the frame edge.
 */
export function extractBorderBgClusters(rgba, width, height, maxClusters = 4) {
  const bins = new Map();
  const addPixel = (x, y, weight = 1) => {
    const idx = (y * width + x) * 4;
    if (rgba[idx + 3] < 32) return;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    // 5-bit color quantization (32 levels per channel)
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let entry = bins.get(key);
    if (!entry) {
      entry = { sr: 0, sg: 0, sb: 0, w: 0 };
      bins.set(key, entry);
    }
    entry.sr += r * weight;
    entry.sg += g * weight;
    entry.sb += b * weight;
    entry.w += weight;
  };

  const marginX = Math.max(1, Math.min(4, Math.floor(width * 0.04)));
  const marginY = Math.max(1, Math.min(4, Math.floor(height * 0.04)));

  // Top edge (stronger weight)
  for (let y = 0; y < marginY; y++) {
    for (let x = 0; x < width; x++) {
      addPixel(x, y, 2);
    }
  }
  // Left and Right edges (full height)
  for (let y = marginY; y < height; y++) {
    for (let x = 0; x < marginX; x++) addPixel(x, y, 1.5);
    for (let x = Math.max(0, width - marginX); x < width; x++) addPixel(x, y, 1.5);
  }
  // Outer bottom corners (20% left and right)
  const cornerW = Math.max(2, Math.floor(width * 0.22));
  for (let y = Math.max(0, height - marginY); y < height; y++) {
    for (let x = 0; x < cornerW; x++) addPixel(x, y, 1);
    for (let x = Math.max(0, width - cornerW); x < width; x++) addPixel(x, y, 1);
  }

  const rawClusters = [];
  for (const e of bins.values()) {
    const r = e.sr / e.w;
    const g = e.sg / e.w;
    const b = e.sb / e.w;
    const [y, cb, cr] = rgbToYCbCr(r, g, b);
    rawClusters.push({ r, g, b, y, cb, cr, w: e.w });
  }
  rawClusters.sort((a, b) => b.w - a.w);

  // Merge nearby color clusters so gradients/shadows collapse cleanly into distinct palette clusters
  const merged = [];
  for (const c of rawClusters) {
    let matched = null;
    for (const m of merged) {
      const d = Math.hypot(c.cb - m.cb, c.cr - m.cr) + 0.35 * Math.abs(c.y - m.y);
      if (d < 0.095) {
        matched = m;
        break;
      }
    }
    if (matched) {
      const totalW = matched.w + c.w;
      matched.r = (matched.r * matched.w + c.r * c.w) / totalW;
      matched.g = (matched.g * matched.w + c.g * c.w) / totalW;
      matched.b = (matched.b * matched.w + c.b * c.w) / totalW;
      [matched.y, matched.cb, matched.cr] = rgbToYCbCr(matched.r, matched.g, matched.b);
      matched.w = totalW;
    } else if (merged.length < maxClusters) {
      merged.push({ ...c });
    }
  }

  return merged;
}

/**
 * Computes a smooth foreground alpha matte (0 = background, 255 = subject) using:
 * 1. Perimeter background color clustering
 * 2. Local gradient edge barrier computation
 * 3. Border-seeded edge-aware BFS flood separation + center foreground prior
 * 4. Soft distance ramp & 3x3 matte feathering
 */
export function computeAutoBgMask(rgba, width, height, options = {}) {
  const len = width * height;
  const alphaMask = new Uint8Array(len);
  if (!rgba || len <= 0) {
    return { alphaMask, width, height, dominantBgHex: '#000000', dominantBgRgb: [0, 0, 0] };
  }

  const sensitivity = clamp(Number(options.sensitivity ?? 0.48), 0.08, 0.92);
  const feather = clamp(Number(options.feather ?? 0.35), 0, 0.95);
  const invert = Boolean(options.invert);

  const clusters = extractBorderBgClusters(rgba, width, height, 4);
  if (clusters.length === 0) {
    alphaMask.fill(invert ? 0 : 255);
    return { alphaMask, width, height, dominantBgHex: '#000000', dominantBgRgb: [0, 0, 0] };
  }

  const dominantBg = clusters[0];
  const dominantBgRgb = [Math.round(dominantBg.r), Math.round(dominantBg.g), Math.round(dominantBg.b)];
  const dominantBgHex = rgbToHex(dominantBgRgb[0], dominantBgRgb[1], dominantBgRgb[2]);

  // Precompute YCbCr & minimum distance to perimeter background clusters
  const pyArr = new Float32Array(len);
  const pcbArr = new Float32Array(len);
  const pcrArr = new Float32Array(len);
  const bgDist = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const p = i * 4;
    const [y, cb, cr] = rgbToYCbCr(rgba[p], rgba[p + 1], rgba[p + 2]);
    pyArr[i] = y;
    pcbArr[i] = cb;
    pcrArr[i] = cr;

    let minD = 99;
    for (let k = 0; k < clusters.length; k++) {
      const c = clusters[k];
      const d = Math.hypot(cb - c.cb, cr - c.cr) + 0.32 * Math.abs(y - c.y);
      if (d < minD) minD = d;
    }
    bgDist[i] = minD;
  }

  // Sobel-like gradient magnitude for edge barriers
  const edgeMag = new Float32Array(len);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        Math.abs(pyArr[i + 1] - pyArr[i - 1]) +
        Math.abs(pcbArr[i + 1] - pcbArr[i - 1]) * 1.4 +
        Math.abs(pcrArr[i + 1] - pcrArr[i - 1]) * 1.4;
      const gy =
        Math.abs(pyArr[i + width] - pyArr[i - width]) +
        Math.abs(pcbArr[i + width] - pcbArr[i - width]) * 1.4 +
        Math.abs(pcrArr[i + width] - pcrArr[i - width]) * 1.4;
      edgeMag[i] = Math.hypot(gx, gy);
    }
  }

  // Threshold tuned from sensitivity [0.08..0.92] -> [0.05..0.34]
  const baseThresh = 0.045 + sensitivity * 0.27;
  const edgeStop = 0.14 + sensitivity * 0.24;

  // Perimeter-seeded BFS flood fill
  const isBg = new Uint8Array(len);
  const visited = new Uint8Array(len);
  const queue = new Int32Array(len);
  let qHead = 0;
  let qTail = 0;

  const trySeed = (idx) => {
    if (visited[idx]) return;
    visited[idx] = 1;
    if (bgDist[idx] <= baseThresh * 1.12) {
      isBg[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x);
    // Bottom corners seeded (leave middle 45% bottom unseeded unless clearly matching bg)
    if (x < width * 0.26 || x > width * 0.74 || bgDist[(height - 1) * width + x] <= baseThresh * 0.72) {
      trySeed((height - 1) * width + x);
    }
  }
  for (let y = 1; y < height - 1; y++) {
    trySeed(y * width);
    trySeed(y * width + (width - 1));
  }

  const dirs = [-1, 1, -width, width];
  while (qHead < qTail) {
    const cur = queue[qHead++];
    const cx = cur % width;
    const cy = (cur - cx) / width;

    for (let d = 0; d < 4; d++) {
      if (d === 0 && cx === 0) continue;
      if (d === 1 && cx === width - 1) continue;
      if (d === 2 && cy === 0) continue;
      if (d === 3 && cy === height - 1) continue;

      const nxt = cur + dirs[d];
      if (visited[nxt]) continue;
      visited[nxt] = 1;

      const nx = nxt % width;
      const ny = (nxt - nx) / width;
      // Gentle center foreground protection so center subjects resist over-erosion
      const dxN = (nx / Math.max(1, width - 1) - 0.5) * 2;
      const dyN = (ny / Math.max(1, height - 1) - 0.5) * 2;
      const centerFactor = Math.max(0, 1 - (dxN * dxN * 0.8 + dyN * dyN * 0.65));
      const localThresh = baseThresh * (1.06 - centerFactor * 0.24) - edgeMag[nxt] * 0.16;

      const stepDiff =
        Math.hypot(pcbArr[nxt] - pcbArr[cur], pcrArr[nxt] - pcrArr[cur]) +
        0.3 * Math.abs(pyArr[nxt] - pyArr[cur]);

      if (bgDist[nxt] <= localThresh && stepDiff <= edgeStop) {
        isBg[nxt] = 1;
        queue[qTail++] = nxt;
      }
    }
  }

  // Also clean enclosed high-confidence background holes (e.g. gap between arms and torso)
  // while protecting inner subject pixels via tighter threshold + low edge energy
  const holeThresh = baseThresh * 0.54;
  for (let i = 0; i < len; i++) {
    if (isBg[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    const dxN = (x / Math.max(1, width - 1) - 0.5) * 2;
    const dyN = (y / Math.max(1, height - 1) - 0.5) * 2;
    const centerFactor = Math.max(0, 1 - (dxN * dxN + dyN * dyN) * 0.6);
    if (bgDist[i] < holeThresh * (1 - centerFactor * 0.35) && edgeMag[i] < 0.08) {
      isBg[i] = 1;
    }
  }

  // Build soft alpha ramp along bg/fg boundary
  const softBand = Math.max(0.015, 0.03 + feather * 0.11);
  const rawAlpha = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (isBg[i]) {
      const t = clamp((bgDist[i] - baseThresh * 0.65) / softBand, 0, 1);
      // Keep core flood-filled bg at 0, only slight soft halo at immediate fringe
      rawAlpha[i] = t * 0.25;
    } else {
      const t = clamp((bgDist[i] - baseThresh * 0.55) / softBand, 0, 1);
      rawAlpha[i] = Math.max(0.35, t);
      if (bgDist[i] >= baseThresh + softBand * 0.5) rawAlpha[i] = 1;
    }
  }

  // Fast 3x3 matte feather pass on boundary pixels
  const smoothPass = feather > 0.05;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let a = rawAlpha[i];
      if (smoothPass && x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const bgNeighbors =
          isBg[i - 1] + isBg[i + 1] + isBg[i - width] + isBg[i + width];
        if (bgNeighbors > 0 && bgNeighbors < 4) {
          const avg =
            (rawAlpha[i] * 2 +
              rawAlpha[i - 1] +
              rawAlpha[i + 1] +
              rawAlpha[i - width] +
              rawAlpha[i + width] +
              rawAlpha[i - width - 1] * 0.5 +
              rawAlpha[i - width + 1] * 0.5 +
              rawAlpha[i + width - 1] * 0.5 +
              rawAlpha[i + width + 1] * 0.5) /
            8;
          a = a * (1 - feather * 0.7) + avg * (feather * 0.7);
        }
      }
      const finalA = invert ? 1 - a : a;
      alphaMask[i] = clamp(Math.round(finalA * 255), 0, 255);
    }
  }

  return { alphaMask, width, height, dominantBgHex, dominantBgRgb };
}

/**
 * Applies a precomputed alphaMask onto an RGBA pixel array with optional edge despill.
 */
export function applyAlphaMaskToRgba(rgba, alphaMask, width, height, dominantBgRgb = null, despill = 0.35) {
  const len = width * height;
  const sp = clamp(Number(despill) || 0, 0, 1);
  const bg = dominantBgRgb;
  const [, kcb, kcr] = bg ? rgbToYCbCr(bg[0], bg[1], bg[2]) : [0, 0, 0];
  const kMagSq = kcb * kcb + kcr * kcr;

  for (let i = 0; i < len; i++) {
    const p = i * 4;
    const ma = alphaMask[i] / 255;
    rgba[p + 3] = Math.round(rgba[p + 3] * ma);

    // Universal chroma projection despill on semi-transparent boundary pixels
    if (sp > 0.01 && ma > 0.02 && ma < 0.96 && kMagSq > 1e-4) {
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      const [y, cb, cr] = rgbToYCbCr(r, g, b);
      const proj = (cb * kcb + cr * kcr) / kMagSq;
      if (proj > 0) {
        const edgeMix = sp * (1 - ma) * 0.9;
        const ncb = cb - kcb * proj * edgeMix;
        const ncr = cr - kcr * proj * edgeMix;
        rgba[p] = clamp(Math.round((y + 1.402 * ncr) * 255), 0, 255);
        rgba[p + 1] = clamp(Math.round((y - 0.344136 * ncb - 0.714136 * ncr) * 255), 0, 255);
        rgba[p + 2] = clamp(Math.round((y + 1.772 * ncb) * 255), 0, 255);
      }
    }
  }
  return rgba;
}

/**
 * CPU Chroma Key + universal vector despill for Canvas 2D fallback parity.
 */
export function applyChromaKeyToRgba(rgba, width, height, keyRgb, similarity = 0.35, smoothness = 0.12, despill = 0.5) {
  const len = width * height;
  const [ky, kcb, kcr] = rgbToYCbCr(keyRgb[0], keyRgb[1], keyRgb[2]);
  const sim = clamp(Number(similarity) || 0.35, 0.02, 0.95);
  const sm = Math.max(0.005, Number(smoothness) || 0.12);
  const sp = clamp(Number(despill) || 0, 0, 1);
  const kMagSq = kcb * kcb + kcr * kcr;

  for (let i = 0; i < len; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const [y, cb, cr] = rgbToYCbCr(r, g, b);
    const dist = Math.hypot(cb - kcb, cr - kcr) + 0.15 * Math.abs(y - ky);
    const t = clamp((dist - sim) / sm, 0, 1);
    const alphaMul = t * t * (3 - 2 * t);
    rgba[p + 3] = Math.round(rgba[p + 3] * alphaMul);

    if (sp > 0.005 && alphaMul > 0.01 && alphaMul < 0.99 && kMagSq > 1e-4) {
      const proj = (cb * kcb + cr * kcr) / kMagSq;
      if (proj > 0) {
        const edgeStr = sp * clamp(1.15 - alphaMul, 0.15, 1.0);
        const ncb = cb - kcb * proj * edgeStr;
        const ncr = cr - kcr * proj * edgeStr;
        rgba[p] = clamp(Math.round((y + 1.402 * ncr) * 255), 0, 255);
        rgba[p + 1] = clamp(Math.round((y - 0.344136 * ncb - 0.714136 * ncr) * 255), 0, 255);
        rgba[p + 2] = clamp(Math.round((y + 1.772 * ncb) * 255), 0, 255);
      }
    }
  }
  return rgba;
}
