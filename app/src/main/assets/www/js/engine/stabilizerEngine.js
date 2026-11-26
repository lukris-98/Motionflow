import { clamp } from '../utils/math.js';
import { TimelineEngine } from './timelineEngine.js';
import { KeyframeEngine } from './keyframeEngine.js';
import { extractGrayscale } from './trackerEngine.js';

export const STABILIZE_PRESETS = [
  {
    id: 'minimum',
    label: 'Minimum Cut',
    smoothRadius: 5,
    maxShiftRatio: 0.055,
    maxRotDeg: 2.2,
    smoothStrength: 0.65,
    desc: 'Minimal crop (~5%), natural feel'
  },
  {
    id: 'recommended',
    label: 'Recommended',
    smoothRadius: 11,
    maxShiftRatio: 0.11,
    maxRotDeg: 4.5,
    smoothStrength: 0.85,
    desc: 'Balanced EIS & crop (CapCut default)'
  },
  {
    id: 'mostStable',
    label: 'Most Stable',
    smoothRadius: 19,
    maxShiftRatio: 0.16,
    maxRotDeg: 6.8,
    smoothStrength: 0.96,
    desc: 'Maximum gimbal lock with tighter crop'
  }
];

function computeZoneSAD(prevGray, curGray, w, h, zx, zy, halfR, dx, dy) {
  let sum = 0;
  let count = 0;
  const x0 = Math.max(1, zx - halfR);
  const x1 = Math.min(w - 2, zx + halfR);
  const y0 = Math.max(1, zy - halfR);
  const y1 = Math.min(h - 2, zy + halfR);
  for (let y = y0; y <= y1; y++) {
    const cy = clamp(y + dy, 0, h - 1);
    const pRow = y * w;
    const cRow = cy * w;
    for (let x = x0; x <= x1; x++) {
      const cx = clamp(x + dx, 0, w - 1);
      sum += Math.abs(prevGray[pRow + x] - curGray[cRow + cx]);
      count++;
    }
  }
  return count > 0 ? sum / count : 255;
}

function measureZoneContrast(gray, w, h, zx, zy, halfR) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const x0 = Math.max(0, zx - halfR);
  const x1 = Math.min(w - 1, zx + halfR);
  const y0 = Math.max(0, zy - halfR);
  const y1 = Math.min(h - 1, zy + halfR);
  for (let y = y0; y <= y1; y += 2) {
    const row = y * w;
    for (let x = x0; x <= x1; x += 2) {
      const v = gray[row + x];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) * 0.5;
}

/**
 * Multi-region coarse-to-fine SAD block matching with median outlier rejection.
 * Measures inter-frame displacement (dx, dy) and roll (dRot in radians) from prevGray -> curGray.
 */
export function estimateInterFrameMotion(prevGray, curGray, width, height, searchRadius = 18) {
  const halfR = Math.max(6, Math.round(Math.min(width, height) * 0.085));
  const zones = [
    { rx: 0.25, ry: 0.26 },
    { rx: 0.75, ry: 0.26 },
    { rx: 0.50, ry: 0.50 },
    { rx: 0.25, ry: 0.74 },
    { rx: 0.75, ry: 0.74 }
  ];

  const zoneResults = [];
  for (const z of zones) {
    const zx = Math.round(z.rx * width);
    const zy = Math.round(z.ry * height);
    if (measureZoneContrast(prevGray, width, height, zx, zy, halfR) < 4) continue;

    let bestDx = 0;
    let bestDy = 0;
    let bestSad = Infinity;
    const coarseStep = 2;
    for (let dy = -searchRadius; dy <= searchRadius; dy += coarseStep) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += coarseStep) {
        const sad = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, dx, dy);
        if (sad < bestSad) {
          bestSad = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }

    let fineDx = bestDx;
    let fineDy = bestDy;
    let fineSad = bestSad;
    for (let dy = bestDy - 2; dy <= bestDy + 2; dy++) {
      for (let dx = bestDx - 2; dx <= bestDx + 2; dx++) {
        const sad = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, dx, dy);
        if (sad < fineSad) {
          fineSad = sad;
          fineDx = dx;
          fineDy = dy;
        }
      }
    }

    const sL = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, fineDx - 1, fineDy);
    const sR = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, fineDx + 1, fineDy);
    const sU = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, fineDx, fineDy - 1);
    const sD = computeZoneSAD(prevGray, curGray, width, height, zx, zy, halfR, fineDx, fineDy + 1);
    const denomX = 2 * (sL - 2 * fineSad + sR);
    const denomY = 2 * (sU - 2 * fineSad + sD);
    const subX = denomX > 1e-3 ? clamp((sL - sR) / denomX, -0.5, 0.5) : 0;
    const subY = denomY > 1e-3 ? clamp((sU - sD) / denomY, -0.5, 0.5) : 0;

    zoneResults.push({
      zx: zx - width * 0.5,
      zy: zy - height * 0.5,
      dx: fineDx + subX,
      dy: fineDy + subY
    });
  }

  if (zoneResults.length === 0) {
    return { dx: 0, dy: 0, dRot: 0 };
  }

  const dxMed = median(zoneResults.map((r) => r.dx));
  const dyMed = median(zoneResults.map((r) => r.dy));

  // Estimate subtle camera roll from residual tangent motion around image center
  let num = 0;
  let den = 0;
  for (const r of zoneResults) {
    const r2 = r.zx * r.zx + r.zy * r.zy;
    if (r2 < 25) continue;
    const rx = r.dx - dxMed;
    const ry = r.dy - dyMed;
    // Ignore obvious outlier zones (e.g. moving foreground person)
    if (Math.hypot(rx, ry) > 6) continue;
    // Cross product (r x delta) = zx * ry - zy * rx ≈ dRot * r^2
    num += r.zx * ry - r.zy * rx;
    den += r2;
  }
  const dRot = den > 100 && zoneResults.length >= 3 ? clamp(num / den, -0.06, 0.06) : 0;

  return { dx: dxMed, dy: dyMed, dRot };
}

function gaussianSmoothSeries(values, radius) {
  const n = values.length;
  if (n <= 1 || radius <= 0) return [...values];
  const r = Math.max(1, Math.round(radius));
  const sigma = Math.max(0.8, r * 0.5);
  const twoSigmaSq = 2 * sigma * sigma;
  const kernel = [];
  let kSum = 0;
  for (let k = -r; k <= r; k++) {
    const w = Math.exp(-(k * k) / twoSigmaSq);
    kernel.push(w);
    kSum += w;
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      // Reflective boundary padding preserves entry/exit framing cleanly
      let idx = i + k;
      if (idx < 0) idx = Math.min(n - 1, -idx);
      if (idx >= n) idx = Math.max(0, 2 * (n - 1) - idx);
      acc += values[idx] * kernel[k + r];
    }
    out[i] = acc / kSum;
  }
  return out;
}

/**
 * Turns inter-frame motion deltas into smoothed compensation transforms (dx, dy, rot)
 * and a guaranteed zero-black-border adaptive auto-crop scale.
 */
export function computeStabilizedTransforms(motions, srcW, srcH, level = 'recommended') {
  const preset = STABILIZE_PRESETS.find((p) => p.id === level) || STABILIZE_PRESETS[1];
  const safeW = Math.max(1, srcW || 1280);
  const safeH = Math.max(1, srcH || 720);
  const asp = safeW / safeH;

  if (!Array.isArray(motions) || motions.length === 0) {
    return { level: preset.id, cropScale: 1.0, avgShakePx: 0, frames: [] };
  }

  const n = motions.length;
  const rawX = new Array(n).fill(0);
  const rawY = new Array(n).fill(0);
  const rawR = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    rawX[i] = rawX[i - 1] + (motions[i].dx || 0);
    rawY[i] = rawY[i - 1] + (motions[i].dy || 0);
    rawR[i] = rawR[i - 1] + (motions[i].dRot || 0);
  }

  const smoothX = gaussianSmoothSeries(rawX, preset.smoothRadius);
  const smoothY = gaussianSmoothSeries(rawY, preset.smoothRadius);
  const smoothR = gaussianSmoothSeries(rawR, Math.max(3, Math.round(preset.smoothRadius * 0.85)));

  const maxShiftX = safeW * preset.maxShiftRatio;
  const maxShiftY = safeH * preset.maxShiftRatio;
  const maxRotRad = (preset.maxRotDeg * Math.PI) / 180;

  let reqCropScale = 1.0;
  let shakeAccum = 0;

  const frames = motions.map((m, i) => {
    const diffX = smoothX[i] - rawX[i];
    const diffY = smoothY[i] - rawY[i];
    const diffR = smoothR[i] - rawR[i];
    shakeAccum += Math.hypot(diffX, diffY);

    const dx = clamp(diffX * preset.smoothStrength, -maxShiftX, maxShiftX);
    const dy = clamp(diffY * preset.smoothStrength, -maxShiftY, maxShiftY);
    const rot = clamp(diffR * preset.smoothStrength, -maxRotRad, maxRotRad);

    const dxNorm = Math.min(0.32, Math.abs(dx) / safeW);
    const dyNorm = Math.min(0.32, Math.abs(dy) / safeH);
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));

    // Exact bounding-box inverse UV constraint so all 4 corners remain inside [0, 1]^2
    const needX = (c + s / Math.max(0.2, asp)) / Math.max(0.25, 1 - 2 * dxNorm);
    const needY = (c + s * asp) / Math.max(0.25, 1 - 2 * dyNorm);
    reqCropScale = Math.max(reqCropScale, needX, needY);

    return {
      srcFrame: m.srcFrame,
      dx: Number(dx.toFixed(2)),
      dy: Number(dy.toFixed(2)),
      rot: Number(rot.toFixed(5))
    };
  });

  const cropScale = Number(clamp(reqCropScale + 0.005, 1.0, 1.55).toFixed(3));
  const avgShakePx = Number((shakeAccum / Math.max(1, n)).toFixed(2));

  return {
    level: preset.id,
    cropScale,
    avgShakePx,
    frames
  };
}

function getSourceFrameForLayer(layer, timelineFrame) {
  const localF = Math.max(0, timelineFrame - (layer.startFrame || 0));
  const baseSrc = layer.mediaOffsetFrames || 0;
  const elapsedSrc = TimelineEngine.integrateSpeedCurveSourceFrames(layer, localF);
  if (!layer.reversed) {
    return Math.max(0, baseSrc + elapsedSrc);
  }
  const spanSrc = TimelineEngine.integrateSpeedCurveSourceFrames(
    layer,
    Math.max(1, (layer.endFrame || 0) - (layer.startFrame || 0))
  );
  return Math.max(0, baseSrc + spanSrc - elapsedSrc);
}

/**
 * Evaluates stabilized compensation transform for a layer at a given timeline frame.
 * Indexed by source media frame so splitting, moving, reversing, or speeding clips works automatically.
 */
export function getStabilizerAtFrame(layer, timelineFrame, fps = 30) {
  const st = layer?.stabilizer;
  if (!st || !st.enabled || !Array.isArray(st.frames) || st.frames.length === 0) {
    return { dx: 0, dy: 0, rot: 0, cropScale: 1 };
  }

  const targetSrcFrame = getSourceFrameForLayer(layer, timelineFrame);
  const list = st.frames;
  const cropScale = st.cropScale ?? 1;

  if (targetSrcFrame <= list[0].srcFrame) {
    return { dx: list[0].dx, dy: list[0].dy, rot: list[0].rot, cropScale };
  }
  const last = list[list.length - 1];
  if (targetSrcFrame >= last.srcFrame) {
    return { dx: last.dx, dy: last.dy, rot: last.rot, cropScale };
  }

  // Binary search bracket
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].srcFrame <= targetSrcFrame) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  const span = Math.max(1e-5, b.srcFrame - a.srcFrame);
  const t = clamp((targetSrcFrame - a.srcFrame) / span, 0, 1);

  return {
    dx: a.dx + (b.dx - a.dx) * t,
    dy: a.dy + (b.dy - a.dy) * t,
    rot: a.rot + (b.rot - a.rot) * t,
    cropScale
  };
}

export class StabilizerEngine {
  constructor(renderer) {
    this.renderer = renderer;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Analyzes raw source video frames across the clip's source range and writes `layer.stabilizer`.
   */
  async analyzeAndStabilize({ project, videoLayer, mediaMap, level = 'recommended', onProgress }) {
    if (!project || !videoLayer || videoLayer.type !== 'video') {
      throw new Error('Select a video layer to stabilize.');
    }
    this.cancelled = false;

    const fps = Math.max(1, project.fps || 30);
    const startF = Math.max(0, Math.round(videoLayer.startFrame));
    const endF = Math.max(startF + 1, Math.round(videoLayer.endFrame));

    // Determine source-frame range covered by this clip
    const sfA = getSourceFrameForLayer(videoLayer, startF);
    const sfB = getSourceFrameForLayer(videoLayer, endF);
    const minSrcFrame = Math.max(0, Math.floor(Math.min(sfA, sfB)));
    const maxSrcFrame = Math.max(minSrcFrame + 2, Math.ceil(Math.max(sfA, sfB)));
    const spanSrcFrames = maxSrcFrame - minSrcFrame;

    // Sample up to ~180 frames cleanly across clip (every 1 frame for short clips, stride for long clips)
    const maxSamples = 180;
    const stepSrc = Math.max(1, Math.ceil(spanSrcFrames / maxSamples));

    const drawableInit = this.renderer.resolveLayerDrawable(videoLayer, startF, fps, mediaMap);
    const srcW = Math.max(64, drawableInit?.w || project.width || 1280);
    const srcH = Math.max(64, drawableInit?.h || project.height || 720);

    const aw = 224;
    const ah = Math.max(96, Math.round((srcH / srcW) * aw));
    const scaleToSrcX = srcW / aw;
    const scaleToSrcY = srcH / ah;

    const canvas = document.createElement('canvas');
    canvas.width = aw;
    canvas.height = ah;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const mediaItem = mediaMap.get(videoLayer.mediaId);
    const vid = this.renderer.getVideoElement(mediaItem);
    if (!vid) {
      throw new Error('Video media element unavailable for stabilization.');
    }

    const sampleFrames = [];
    for (let sf = minSrcFrame; sf <= maxSrcFrame; sf += stepSrc) {
      sampleFrames.push(sf);
    }
    if (sampleFrames[sampleFrames.length - 1] !== maxSrcFrame) {
      sampleFrames.push(maxSrcFrame);
    }

    const motions = [];
    let prevGray = null;

    for (let i = 0; i < sampleFrames.length; i++) {
      if (this.cancelled) {
        throw new Error('Stabilization cancelled');
      }
      const sf = sampleFrames[i];
      const targetSec = Math.max(0, sf / fps);
      const vidDur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : targetSec + 0.5;
      const clampedSec = Math.min(Math.max(0, vidDur - 0.02), targetSec);

      await new Promise((resolve) => {
        if (Math.abs(vid.currentTime - clampedSec) <= 0.012 && vid.readyState >= 2) {
          resolve();
          return;
        }
        const done = () => {
          vid.removeEventListener('seeked', done);
          resolve();
        };
        vid.addEventListener('seeked', done, { once: true });
        try {
          vid.currentTime = clampedSec;
        } catch {
          done();
        }
        setTimeout(done, 240);
      });

      ctx.drawImage(vid, 0, 0, aw, ah);
      const imgData = ctx.getImageData(0, 0, aw, ah);
      const gray = extractGrayscale(imgData.data, aw, ah);

      if (i === 0 || !prevGray) {
        motions.push({ srcFrame: sf, dx: 0, dy: 0, dRot: 0 });
      } else {
        const m = estimateInterFrameMotion(prevGray, gray, aw, ah, 16);
        // Scale step displacement back into native source pixel coordinates
        motions.push({
          srcFrame: sf,
          dx: m.dx * scaleToSrcX,
          dy: m.dy * scaleToSrcY,
          dRot: m.dRot
        });
      }
      prevGray = gray;

      if (onProgress) {
        const pct = Math.min(98, Math.round(((i + 1) / sampleFrames.length) * 98));
        onProgress(pct, i + 1, sampleFrames.length);
      }
      if (i % 2 === 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const result = computeStabilizedTransforms(motions, srcW, srcH, level);
    const stabPayload = {
      enabled: true,
      level: result.level,
      cropScale: result.cropScale,
      avgShakePx: result.avgShakePx,
      srcW,
      srcH,
      rawMotions: motions,
      frames: result.frames
    };
    videoLayer.stabilizer = stabPayload;
    if (onProgress) onProgress(100, sampleFrames.length, sampleFrames.length);
    return stabPayload;
  }

  static recomputePreset(stabilizerData, level) {
    if (!stabilizerData?.rawMotions?.length) return null;
    const res = computeStabilizedTransforms(
      stabilizerData.rawMotions,
      stabilizerData.srcW || 1280,
      stabilizerData.srcH || 720,
      level
    );
    return {
      ...stabilizerData,
      enabled: true,
      level: res.level,
      cropScale: res.cropScale,
      avgShakePx: res.avgShakePx,
      frames: res.frames
    };
  }
}
