import { clamp } from '../utils/math.js';
import { KeyframeEngine } from './keyframeEngine.js';

/**
 * Extracts grayscale luminance [0..255] from RGBA pixel buffer.
 */
export function extractGrayscale(rgba, width, height) {
  const len = width * height;
  const gray = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const p = i * 4;
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return gray;
}

/**
 * Converts RGB [0..255] to HSV where h in [0, 360), s in [0, 1], v in [0, 1].
 */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const cmax = Math.max(rn, gn, bn);
  const cmin = Math.min(rn, gn, bn);
  const delta = cmax - cmin;
  let h = 0;
  if (delta > 1e-5) {
    if (cmax === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (cmax === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  const s = cmax > 1e-5 ? delta / cmax : 0;
  return { h, s, v: cmax };
}

function rgbToHex255(r, g, b) {
  const toH = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase();
}

function hueDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Extracts a center-weighted chromatic color signature from an RGBA patch around (cx, cy).
 * Used to distinguish a uniquely colored detail (e.g. a yellow mark) on repetitive backgrounds (white fence slats).
 */
export function extractColorSignature(rgba, width, height, cx, cy, radius = 10) {
  if (!rgba || width < 2 || height < 2) {
    return { valid: false, hue: 0, sat: 0, val: 0, chromaRatio: 0, hueTol: 36, satMin: 0.15, hex: '#FFFFFF', chromaContrast: 0 };
  }
  const r = Math.max(2, Math.round(radius));
  let sumSin = 0;
  let sumCos = 0;
  let chromaW = 0;
  let totalW = 0;
  let sumS = 0;
  let sumV = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let cSumR = 0;
  let cSumG = 0;
  let cSumB = 0;

  for (let dy = -r; dy <= r; dy++) {
    const py = clamp(Math.round(cy + dy), 0, height - 1);
    for (let dx = -r; dx <= r; dx++) {
      const px = clamp(Math.round(cx + dx), 0, width - 1);
      const dist = Math.hypot(dx, dy) / Math.max(1, r);
      if (dist > 1.08) continue;
      const spatialW = Math.max(0.15, 1.0 - dist * 0.65);
      const i = (py * width + px) * 4;
      const pr = rgba[i];
      const pg = rgba[i + 1];
      const pb = rgba[i + 2];
      const hsv = rgbToHsv(pr, pg, pb);
      totalW += spatialW;
      sumR += pr * spatialW;
      sumG += pg * spatialW;
      sumB += pb * spatialW;

      if (hsv.s >= 0.22 && hsv.v >= 0.20) {
        const cw = spatialW * hsv.s * hsv.s * (0.2 + 0.8 * hsv.v);
        const radH = (hsv.h * Math.PI) / 180;
        sumSin += Math.sin(radH) * cw;
        sumCos += Math.cos(radH) * cw;
        sumS += hsv.s * cw;
        sumV += hsv.v * cw;
        cSumR += pr * cw;
        cSumG += pg * cw;
        cSumB += pb * cw;
        chromaW += cw;
      }
    }
  }

  const chromaRatio = totalW > 0 ? chromaW / totalW : 0;
  if (chromaW <= 1e-4 || chromaRatio < 0.03) {
    const hex = totalW > 0 ? rgbToHex255(sumR / totalW, sumG / totalW, sumB / totalW) : '#FFFFFF';
    return { valid: false, hue: 0, sat: 0, val: 0, chromaRatio, hueTol: 36, satMin: 0.18, hex, chromaContrast: 0 };
  }

  let meanHue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  if (meanHue < 0) meanHue += 360;
  const meanSat = sumS / chromaW;
  const meanVal = sumV / chromaW;
  const hex = rgbToHex255(cSumR / chromaW, cSumG / chromaW, cSumB / chromaW);

  // Measure how concentrated the distinctive chroma is relative to neutral/dark pixels in patch
  const chromaContrast = clamp(chromaRatio * meanSat * 3.8, 0, 1);

  return {
    valid: chromaRatio >= 0.03 && meanSat >= 0.28 && meanVal >= 0.22,
    hue: Number(meanHue.toFixed(1)),
    sat: Number(meanSat.toFixed(3)),
    val: Number(meanVal.toFixed(3)),
    chromaRatio: Number(chromaRatio.toFixed(3)),
    hueTol: clamp(32 + (1 - meanSat) * 16, 26, 46),
    satMin: Math.max(0.18, meanSat * 0.45),
    hex,
    chromaContrast: Number(chromaContrast.toFixed(3))
  };
}

/**
 * Evaluates how well a candidate RGBA patch at (candX, candY) matches a target color signature [0..1].
 * Center pixels receive higher weight so background surrounding the mark cannot drown out small distinctive marks.
 */
export function evalColorAffinityAt(sig, rgba, fw, fh, candX, candY, radius = 8, relScale = 1.0) {
  if (!sig?.valid || !rgba) return 0;
  const r = Math.max(2, Math.round(radius));
  const step = r >= 10 ? 2 : 1;
  let matchSum = 0;
  let weightSum = 0;
  let peakMatch = 0;

  for (let dy = -r; dy <= r; dy += step) {
    const py = Math.round(candY + dy * relScale);
    if (py < 0 || py >= fh) continue;
    for (let dx = -r; dx <= r; dx += step) {
      const px = Math.round(candX + dx * relScale);
      if (px < 0 || px >= fw) continue;
      const dist = Math.hypot(dx, dy) / Math.max(1, r);
      if (dist > 1.1) continue;
      const w = Math.max(0.2, 1.0 - dist * 0.65);
      const i = (py * fw + px) * 4;
      const hsv = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
      let pixAffinity = 0;
      if (hsv.s >= sig.satMin && hsv.v >= 0.08) {
        const hd = hueDiffDeg(hsv.h, sig.hue);
        if (hd <= sig.hueTol) {
          const hScore = 1 - hd / sig.hueTol;
          const sScore = clamp(hsv.s / Math.max(0.2, sig.sat), 0.35, 1.0);
          pixAffinity = hScore * sScore;
        }
      }
      matchSum += pixAffinity * w;
      weightSum += w;
      if (pixAffinity > peakMatch) peakMatch = pixAffinity;
    }
  }

  if (weightSum <= 1e-5) return 0;
  const meanAffinity = matchSum / weightSum;
  // Compare against expected chromaRatio so small marks (e.g. 15% of patch) still score ~1.0 when present
  const expectedFill = clamp(sig.chromaRatio * 0.85, 0.06, 0.75);
  const coverageScore = clamp(meanAffinity / expectedFill, 0, 1);
  return clamp(coverageScore * 0.78 + peakMatch * 0.22, 0, 1);
}

/**
 * Bilinear grayscale sample at floating-point pixel coordinates.
 */
export function sampleGrayBilinear(gray, width, height, x, y) {
  const cx = clamp(x, 0, width - 1.001);
  const cy = clamp(y, 0, height - 1.001);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const v00 = gray[y0 * width + x0];
  const v10 = gray[y0 * width + x1];
  const v01 = gray[y1 * width + x0];
  const v11 = gray[y1 * width + x1];

  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/**
 * Captures a square grayscale template patch centered at (cx, cy) with given half-size radius.
 */
export function extractTemplatePatch(gray, width, height, cx, cy, radius) {
  const size = radius * 2 + 1;
  const patch = new Float32Array(size * size);
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const val = sampleGrayBilinear(gray, width, height, cx + dx, cy + dy);
      const idx = (dy + radius) * size + (dx + radius);
      patch[idx] = val;
      sum += val;
    }
  }
  const mean = sum / patch.length;
  let normSq = 0;
  for (let i = 0; i < patch.length; i++) {
    const d = patch[i] - mean;
    patch[i] = d; // store zero-mean directly
    normSq += d * d;
  }
  return {
    patch,
    size,
    radius,
    stdNorm: Math.sqrt(normSq)
  };
}

/**
 * Computes Zero-Mean Normalized Cross-Correlation (ZNCC) in [-1, 1] at (candX, candY) & optional scale.
 */
export function evalZNCCAt(tpl, frameGray, fw, fh, candX, candY, relScale = 1.0) {
  if (tpl.stdNorm < 1e-3) return 0;
  const r = tpl.radius;
  const size = tpl.size;
  const n = size * size;

  if (candX < 1 || candX > fw - 2 || candY < 1 || candY > fh - 2) {
    return -1;
  }

  let sumF = 0;
  let sumFF = 0;
  let sumTF = 0;

  if (Math.abs(relScale - 1.0) < 1e-4) {
    const xInt = Math.round(candX);
    const yInt = Math.round(candY);
    if (xInt - r >= 0 && xInt + r < fw && yInt - r >= 0 && yInt + r < fh) {
      let idx = 0;
      for (let dy = -r; dy <= r; dy++) {
        const rowOff = (yInt + dy) * fw + (xInt - r);
        for (let dx = 0; dx < size; dx++) {
          const fv = frameGray[rowOff + dx];
          const tv = tpl.patch[idx++];
          sumF += fv;
          sumFF += fv * fv;
          sumTF += tv * fv;
        }
      }
    } else {
      let idx = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const fv = sampleGrayBilinear(frameGray, fw, fh, candX + dx, candY + dy);
          const tv = tpl.patch[idx++];
          sumF += fv;
          sumFF += fv * fv;
          sumTF += tv * fv;
        }
      }
    }
  } else {
    let idx = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const fv = sampleGrayBilinear(frameGray, fw, fh, candX + dx * relScale, candY + dy * relScale);
        const tv = tpl.patch[idx++];
        sumF += fv;
        sumFF += fv * fv;
        sumTF += tv * fv;
      }
    }
  }

  const varF = Math.max(0, sumFF - (sumF * sumF) / n);
  const denom = tpl.stdNorm * Math.sqrt(varF);
  if (denom < 1e-3) return 0;
  return clamp(sumTF / denom, -1, 1);
}

/**
 * Coarse-to-fine ZNCC + optional Color-Lock Hybrid matcher with parabolic sub-pixel refinement & scale search.
 */
export function matchTemplateCoarseToFine(
  tpl,
  frameGray,
  fw,
  fh,
  predX,
  predY,
  searchRadius = 22,
  trackScale = false,
  colorOpts = null
) {
  const useColor = Boolean(colorOpts?.rgba && colorOpts?.chromaProfile?.valid);
  const cw = useColor ? clamp(colorOpts.colorWeight ?? 0.45, 0.1, 0.85) : 0;

  const evalCombined = (x, y, sc = 1.0) => {
    const z = evalZNCCAt(tpl, frameGray, fw, fh, x, y, sc);
    if (!useColor) return { total: z, zncc: z, color: 0 };
    const col = evalColorAffinityAt(colorOpts.chromaProfile, colorOpts.rgba, fw, fh, x, y, tpl.radius, sc);
    const colSigned = col * 2 - 1;
    // If luminance template is weak (isoluminant color mark), lean harder on color signature
    const effW = tpl.stdNorm < 5 ? Math.max(cw, 0.72) : cw;
    const total = z * (1 - effW) + colSigned * effW;
    return { total, zncc: z, color: col };
  };

  let bestX = predX;
  let bestY = predY;
  let bestEval = { total: -2, zncc: -1, color: 0 };

  const minX = Math.max(2, Math.floor(predX - searchRadius));
  const maxX = Math.min(fw - 3, Math.ceil(predX + searchRadius));
  const minY = Math.max(2, Math.floor(predY - searchRadius));
  const maxY = Math.min(fh - 3, Math.ceil(predY + searchRadius));

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const ev = evalCombined(x, y, 1.0);
      if (ev.total > bestEval.total) {
        bestEval = ev;
        bestX = x;
        bestY = y;
      }
    }
  }

  const fMinX = Math.max(2, Math.floor(bestX - 3));
  const fMaxX = Math.min(fw - 3, Math.ceil(bestX + 3));
  const fMinY = Math.max(2, Math.floor(bestY - 3));
  const fMaxY = Math.min(fh - 3, Math.ceil(bestY + 3));

  let fineX = Math.round(bestX);
  let fineY = Math.round(bestY);
  let fineEval = bestEval;

  for (let y = fMinY; y <= fMaxY; y++) {
    for (let x = fMinX; x <= fMaxX; x++) {
      const ev = evalCombined(x, y, 1.0);
      if (ev.total > fineEval.total) {
        fineEval = ev;
        fineX = x;
        fineY = y;
      }
    }
  }

  const sL = evalCombined(fineX - 1, fineY, 1.0).total;
  const sR = evalCombined(fineX + 1, fineY, 1.0).total;
  const sU = evalCombined(fineX, fineY - 1, 1.0).total;
  const sD = evalCombined(fineX, fineY + 1, 1.0).total;

  const denomX = 2 * (sL - 2 * fineEval.total + sR);
  const denomY = 2 * (sU - 2 * fineEval.total + sD);
  const subX = Math.abs(denomX) > 1e-4 ? clamp((sL - sR) / denomX, -0.5, 0.5) : 0;
  const subY = Math.abs(denomY) > 1e-4 ? clamp((sU - sD) / denomY, -0.5, 0.5) : 0;
  const finalX = fineX + subX;
  const finalY = fineY + subY;

  let bestScale = 1.0;
  let finalScore = useColor
    ? clamp(fineEval.zncc * (1 - cw * 0.65) + fineEval.color * (cw * 0.65), -1, 1)
    : fineEval.zncc;

  if (trackScale && finalScore >= 0.42) {
    let bestScaleEval = fineEval;
    const scaleCandidates = [0.94, 0.965, 0.985, 1.0, 1.015, 1.035, 1.06, 1.09];
    for (const sc of scaleCandidates) {
      const ev = evalCombined(finalX, finalY, sc);
      if (ev.total > bestScaleEval.total + 0.0015) {
        bestScaleEval = ev;
        bestScale = sc;
      }
    }
    const sMinus = evalCombined(finalX, finalY, bestScale - 0.01).total;
    const sPlus = evalCombined(finalX, finalY, bestScale + 0.01).total;
    const sDenom = 2 * (sMinus - 2 * bestScaleEval.total + sPlus);
    if (Math.abs(sDenom) > 1e-4) {
      const subSc = clamp((sMinus - sPlus) / sDenom, -0.5, 0.5) * 0.01;
      bestScale = clamp(bestScale + subSc, 0.92, 1.12);
    }
    const scaledScore = useColor
      ? clamp(bestScaleEval.zncc * (1 - cw * 0.65) + bestScaleEval.color * (cw * 0.65), -1, 1)
      : bestScaleEval.zncc;
    finalScore = Math.max(finalScore, scaledScore);
    fineEval = bestScaleEval;
  }

  return {
    x: finalX,
    y: finalY,
    score: finalScore,
    znccScore: fineEval.zncc,
    colorScore: fineEval.color,
    relScale: bestScale
  };
}

/**
 * Temporal Gaussian smoothing for tracked motion paths to suppress walking footstep jitter
 * while keeping the anchor frame locked exactly at the marked spot.
 */
export function smoothTrackedPoints(points, anchorFrame = null, strength = 0.55) {
  if (!Array.isArray(points) || points.length < 4) return points || [];
  const s = clamp(Number(strength) || 0.55, 0, 0.95);
  if (s <= 0.01) return points;

  const weights = [0.12, 0.22, 0.32, 0.22, 0.12];
  const smoothed = points.map((pt, idx) => {
    if (idx === 0 || idx === points.length - 1 || (anchorFrame !== null && pt.frame === anchorFrame)) {
      return { ...pt };
    }
    let wx = 0, wy = 0, wz = 0, wsc = 0, wrot = 0, wrx = 0, wry = 0, wSum = 0;
    for (let k = -2; k <= 2; k++) {
      const ni = clamp(idx + k, 0, points.length - 1);
      const np = points[ni];
      const w = weights[k + 2] * (0.5 + 0.5 * (np.score ?? 1));
      wx += np.x * w;
      wy += np.y * w;
      wz += (np.z || 0) * w;
      wsc += (np.scale || 1) * w;
      wrot += (np.rotation || 0) * w;
      wrx += (np.rotX || 0) * w;
      wry += (np.rotY || 0) * w;
      wSum += w;
    }
    if (wSum <= 1e-5) return { ...pt };
    const mix = (orig, avg) => orig * (1 - s) + avg * s;
    return {
      ...pt,
      x: Number(mix(pt.x, wx / wSum).toFixed(1)),
      y: Number(mix(pt.y, wy / wSum).toFixed(1)),
      z: Number(mix(pt.z || 0, wz / wSum).toFixed(1)),
      scale: Number(mix(pt.scale || 1, wsc / wSum).toFixed(3)),
      rotation: Number(mix(pt.rotation || 0, wrot / wSum).toFixed(2)),
      rotX: Number(mix(pt.rotX || 0, wrx / wSum).toFixed(2)),
      rotY: Number(mix(pt.rotY || 0, wry / wSum).toFixed(2))
    };
  });
  return smoothed;
}

/**
 * Estimates 3D planar Roll (Z), Pitch (X), Yaw (Y) from two orthogonal satellite vectors
 * relative to baseline offset d0.
 */
export function solvePlanar3DOrientation(dxVec, dyVec, d0, prevState = { rotation: 0, rotX: 0, rotY: 0 }) {
  const lenX = Math.hypot(dxVec.x, dxVec.y);
  const lenY = Math.hypot(dyVec.x, dyVec.y);
  if (lenX < 2 || lenY < 2 || d0 < 2) return prevState;

  const rollDeg = clamp((Math.atan2(dxVec.y, dxVec.x) * 180) / Math.PI, -65, 65);
  const aspectRatio = clamp(lenX / Math.max(1e-3, lenY), 0.55, 1.8);
  // Perspective foreshortening indicates 3D yaw/pitch relative to camera
  const yawRaw = aspectRatio < 1 ? Math.acos(clamp(aspectRatio, 0.5, 1)) * (180 / Math.PI) * 0.65 : 0;
  const pitchRaw = aspectRatio > 1 ? Math.acos(clamp(1 / aspectRatio, 0.5, 1)) * (180 / Math.PI) * 0.65 : 0;
  const signY = (dyVec.x >= 0 ? 1 : -1);
  const signX = (dxVec.y >= 0 ? -1 : 1);

  return {
    rotation: Number((prevState.rotation * 0.4 + rollDeg * 0.6).toFixed(2)),
    rotY: Number((prevState.rotY * 0.55 + clamp(yawRaw * signY, -40, 40) * 0.45).toFixed(2)),
    rotX: Number((prevState.rotX * 0.55 + clamp(pitchRaw * signX, -40, 40) * 0.45).toFixed(2))
  };
}

export class TrackerEngine {
  constructor(renderer) {
    this.renderer = renderer;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Tracks a target point in 3D space (X left/right, Y up/down, Depth Z forward/backward + optional planar tilt/roll)
   * across frames on a source video/visual layer. Coordinates targetX/targetY are in Project Space (center = 0,0).
   */
  async trackLayer({
    project,
    videoLayer,
    mediaMap,
    anchorFrame,
    targetX,
    targetY,
    direction = 'forward', // 'forward' | 'backward' | 'both'
    patchRadiusProj = 28,
    searchRadiusProj = 95,
    trackScale = true,
    trackTilt3D = true,
    colorLock = 'auto', // 'auto' | 'on' | 'off'
    minConfidence = 0.50,
    maxCoastFrames = 8,
    onFrameTracked
  }) {
    const analysisScale = Math.min(0.45, 320 / Math.max(project.width, project.height));
    const aw = Math.max(120, Math.round(project.width * analysisScale));
    const ah = Math.max(90, Math.round(project.height * analysisScale));
    const canvas = document.createElement('canvas');
    canvas.width = aw;
    canvas.height = ah;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const captureFrame = async (f) => {
      await this.renderer.seekVideosForFrame(project, f, mediaMap, true);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, aw, ah);

      const drawable = this.renderer.resolveLayerDrawable(videoLayer, f, project.fps || 30, mediaMap);
      if (!drawable) return null;

      const tf = KeyframeEngine.getTransformAtFrame(videoLayer, f);
      ctx.save();
      ctx.scale(analysisScale, analysisScale);
      ctx.translate(project.width / 2 + tf.x, project.height / 2 + tf.y);
      ctx.rotate((tf.rotation * Math.PI) / 180);
      ctx.scale(tf.scaleX, tf.scaleY);
      ctx.translate(-tf.anchorX, -tf.anchorY);
      ctx.drawImage(drawable.el, -drawable.w / 2, -drawable.h / 2, drawable.w, drawable.h);
      ctx.restore();

      const img = ctx.getImageData(0, 0, aw, ah);
      return {
        rgba: img.data,
        gray: extractGrayscale(img.data, aw, ah)
      };
    };

    const startF = clamp(Math.round(anchorFrame), videoLayer.startFrame, videoLayer.endFrame);
    return this.trackFrameSequence({
      sourceLayerId: videoLayer.id,
      width: aw,
      height: ah,
      projWidth: project.width,
      projHeight: project.height,
      analysisScale,
      startFrame: startF,
      minFrame: videoLayer.startFrame,
      maxFrame: videoLayer.endFrame,
      direction,
      targetX,
      targetY,
      patchRadius: clamp(Math.round(patchRadiusProj * analysisScale), 6, 20),
      searchRadius: clamp(Math.round(searchRadiusProj * analysisScale), 12, 48),
      trackScale,
      trackTilt3D,
      colorLock,
      minConfidence,
      maxCoastFrames,
      captureFrame,
      onFrameTracked,
      yieldEvery: 2
    });
  }

  /**
   * Core frame-buffer 3D + HSV Color-Lock + Occlusion-Coasting tracker.
   * Separated from DOM Canvas rasterization so both UI playback and headless tests share exact tracker logic.
   */
  async trackFrameSequence({
    sourceLayerId = null,
    width,
    height,
    projWidth = width,
    projHeight = height,
    analysisScale = 1,
    startFrame,
    minFrame,
    maxFrame,
    direction = 'forward',
    targetX = 0,
    targetY = 0,
    patchRadius = 10,
    searchRadius = 24,
    trackScale = true,
    trackTilt3D = true,
    colorLock = 'auto',
    minConfidence = 0.50,
    maxCoastFrames = 8,
    captureFrame,
    onFrameTracked,
    yieldEvery = 0
  }) {
    this.cancelled = false;

    const aw = width;
    const ah = height;
    const fovRad = (45 * Math.PI) / 180;
    const camDist = (projHeight / 2) / Math.tan(fovRad / 2);

    const toAnalysisX = (px) => (projWidth / 2 + px) * analysisScale;
    const toAnalysisY = (py) => (projHeight / 2 + py) * analysisScale;
    const toProjX = (ax) => ax / analysisScale - projWidth / 2;
    const toProjY = (ay) => ay / analysisScale - projHeight / 2;

    const patchR = clamp(Math.round(patchRadius), 4, 24);
    const searchR = clamp(Math.round(searchRadius), 8, 64);
    const satOffset = Math.max(8, Math.round(patchR * 0.8));
    const satPatchR = Math.max(5, Math.round(patchR * 0.65));

    const startF = clamp(Math.round(startFrame), minFrame, maxFrame);
    const anchorBuf = await captureFrame(startF);
    if (!anchorBuf?.gray) {
      throw new Error('Video frame not ready for tracking. Wait for video preview to load.');
    }

    const ax0 = toAnalysisX(targetX);
    const ay0 = toAnalysisY(targetY);
    const anchorTpl = extractTemplatePatch(anchorBuf.gray, aw, ah, ax0, ay0, patchR);
    const anchorColorSig = anchorBuf.rgba
      ? extractColorSignature(anchorBuf.rgba, aw, ah, ax0, ay0, patchR)
      : { valid: false, hex: '#FFFFFF', chromaContrast: 0 };

    const useColorLock =
      colorLock === 'on'
        ? Boolean(anchorColorSig.valid)
        : colorLock === 'off'
          ? false
          : Boolean(anchorColorSig.valid);

    if (anchorTpl.stdNorm < 5 && !(useColorLock && anchorColorSig.valid)) {
      throw new Error('Target area lacks contrast/detail. Aim at a distinct landmark (sign, line, corner, or colored mark).');
    }

    const baseColorWeight = useColorLock
      ? (colorLock === 'on'
        ? clamp(0.42 + anchorColorSig.chromaContrast * 0.30, 0.42, 0.72)
        : clamp(0.32 + anchorColorSig.chromaContrast * 0.30, 0.32, 0.62))
      : 0;

    const anchorSatR = trackTilt3D && ax0 + satOffset < aw - 4
      ? extractTemplatePatch(anchorBuf.gray, aw, ah, ax0 + satOffset, ay0, satPatchR)
      : null;
    const anchorSatB = trackTilt3D && ay0 + satOffset < ah - 4
      ? extractTemplatePatch(anchorBuf.gray, aw, ah, ax0, ay0 + satOffset, satPatchR)
      : null;

    const pointMap = new Map();
    pointMap.set(startF, {
      frame: startF,
      x: Number(targetX.toFixed(1)),
      y: Number(targetY.toFixed(1)),
      z: 0,
      scale: 1.0,
      rotation: 0,
      rotX: 0,
      rotY: 0,
      score: 1.0,
      colorScore: useColorLock ? 1.0 : 0,
      coasting: false
    });

    const totalSteps =
      direction === 'forward'
        ? Math.max(1, maxFrame - startF)
        : direction === 'backward'
          ? Math.max(1, startF - minFrame)
          : Math.max(1, maxFrame - minFrame);
    let completedSteps = 0;
    let coastedFrames = 0;

    const runSweep = async (stepDir) => {
      let curTpl = anchorTpl;
      let curSatR = anchorSatR && anchorSatR.stdNorm >= 4 ? anchorSatR : null;
      let curSatB = anchorSatB && anchorSatB.stdNorm >= 4 ? anchorSatB : null;
      let satVecR = { x: satOffset, y: 0 };
      let satVecB = { x: 0, y: satOffset };
      let orientState = { rotation: 0, rotX: 0, rotY: 0 };

      let curAx = ax0;
      let curAy = ay0;
      let curScale = 1.0;
      let prevStepScale = 1.0;
      let vx = 0;
      let vy = 0;
      let coastStreak = 0;
      let framesSinceRefresh = 0;

      const limitFrame = stepDir > 0 ? maxFrame : minFrame;
      for (let f = startF + stepDir; stepDir > 0 ? f <= limitFrame : f >= limitFrame; f += stepDir) {
        if (this.cancelled) break;

        const frameBuf = await captureFrame(f);
        if (!frameBuf?.gray) break;
        const { gray, rgba } = frameBuf;

        // Expansion-aware prediction for approaching/receding walking camera footage
        const radialBoost = prevStepScale > 1.004 ? 1.08 : 1.0;
        const predAx = clamp(curAx + vx * radialBoost, 2, aw - 3);
        const predAy = clamp(curAy + vy * radialBoost, 2, ah - 3);
        const effSearchR = clamp(
          Math.round(searchR + Math.hypot(vx, vy) * (1.45 + coastStreak * 0.28) + coastStreak * 2),
          searchR,
          Math.max(searchR, Math.round(aw * 0.34))
        );
        const colorOpts = useColorLock && rgba
          ? { rgba, chromaProfile: anchorColorSig, colorWeight: baseColorWeight }
          : null;
        const match = matchTemplateCoarseToFine(curTpl, gray, aw, ah, predAx, predAy, effSearchR, trackScale, colorOpts);

        const edgeMargin = 4;
        const hitEdge =
          match.x <= edgeMargin ||
          match.x >= aw - edgeMargin ||
          match.y <= edgeMargin ||
          match.y >= ah - edgeMargin;
        const nearEdge =
          predAx <= aw * 0.08 || predAx >= aw * 0.92 || predAy <= ah * 0.08 || predAy >= ah * 0.92;

        const isLowConf = match.score < minConfidence || (useColorLock && anchorColorSig.chromaContrast >= 0.25 && (match.colorScore || 0) < 0.12 && match.znccScore < 0.85);

        if (isLowConf) {
          // Occlusion Coast Mode: predict position/depth briefly without corrupting frozen template & color lock
          const canCoast = !nearEdge && coastStreak < maxCoastFrames && (pointMap.size >= 2 || maxCoastFrames > 0);
          if (canCoast) {
            coastStreak++;
            coastedFrames++;
            curAx = predAx;
            curAy = predAy;
            curScale = clamp(curScale * prevStepScale, 0.35, 4.5);
            const depthZ = camDist * (1 - 1 / curScale);
            const coastPt = {
              frame: f,
              x: Number(toProjX(curAx).toFixed(1)),
              y: Number(toProjY(curAy).toFixed(1)),
              z: Number(depthZ.toFixed(1)),
              scale: Number(curScale.toFixed(3)),
              rotation: orientState.rotation,
              rotX: orientState.rotX,
              rotY: orientState.rotY,
              score: Number(Math.max(0, match.score).toFixed(2)),
              colorScore: Number((match.colorScore || 0).toFixed(2)),
              coasting: true
            };
            pointMap.set(f, coastPt);
            completedSteps++;
            if (onFrameTracked) {
              const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
              onFrameTracked(pct, coastPt, pointMap.size);
            }
            if (yieldEvery > 0 && completedSteps % yieldEvery === 0) {
              await new Promise((r) => setTimeout(r, 0));
            }
            continue;
          }

          // Permanent loss or edge exit -> extrapolate brief pass-by exit if moving toward frame border
          const speed = Math.hypot(vx, vy);
          if (speed >= 1.0 && (hitEdge || nearEdge || predAx < aw * 0.16 || predAx > aw * 0.84 || predAy < ah * 0.16 || predAy > ah * 0.84)) {
            for (let ex = 0; ex < 2; ex++) {
              const exFrame = f + ex * stepDir;
              if (exFrame > maxFrame || exFrame < minFrame) break;
              const accel = 1 + 0.08 * (ex + 1);
              const exAx = curAx + vx * (ex + 1) * accel;
              const exAy = curAy + vy * (ex + 1) * accel;
              const exScale = clamp(curScale * Math.pow(prevStepScale || 1, ex + 1), 0.35, 4.5);
              const exZ = camDist * (1 - 1 / exScale);
              pointMap.set(exFrame, {
                frame: exFrame,
                x: Number(toProjX(exAx).toFixed(1)),
                y: Number(toProjY(exAy).toFixed(1)),
                z: Number(exZ.toFixed(1)),
                scale: Number(exScale.toFixed(3)),
                rotation: orientState.rotation,
                rotX: orientState.rotX,
                rotY: orientState.rotY,
                score: Number(Math.max(0, match.score).toFixed(2)),
                extrapolated: true
              });
            }
          }
          break;
        }

        const wasCoasting = coastStreak > 0;
        coastStreak = 0;

        // Re-acquiring after coasting uses faster velocity blend; steady lock smooths footstep jitter
        const velBlend = wasCoasting ? 0.85 : 0.65;
        vx = vx * (1 - velBlend) + (match.x - curAx) * velBlend;
        vy = vy * (1 - velBlend) + (match.y - curAy) * velBlend;
        curAx = match.x;
        curAy = match.y;
        const rawStepScale = clamp(match.relScale || 1.0, 0.93, 1.09);
        const stepScale = prevStepScale * 0.25 + rawStepScale * 0.75;
        prevStepScale = stepScale;

        // Track satellite patches to measure 3D planar roll/tilt & reinforce depth expansion
        if (trackTilt3D && curSatR && curSatB) {
          const predRx = clamp(curAx + satVecR.x * stepScale, 2, aw - 3);
          const predRy = clamp(curAy + satVecR.y * stepScale, 2, ah - 3);
          const predBx = clamp(curAx + satVecB.x * stepScale, 2, aw - 3);
          const predBy = clamp(curAy + satVecB.y * stepScale, 2, ah - 3);
          const mR = matchTemplateCoarseToFine(curSatR, gray, aw, ah, predRx, predRy, 8, false);
          const mB = matchTemplateCoarseToFine(curSatB, gray, aw, ah, predBx, predBy, 8, false);

          if (mR.score >= 0.65 && mB.score >= 0.65) {
            satVecR = { x: mR.x - curAx, y: mR.y - curAy };
            satVecB = { x: mB.x - curAx, y: mB.y - curAy };
            orientState = solvePlanar3DOrientation(satVecR, satVecB, satOffset, orientState);
            if (mR.score >= 0.80) {
              const refR = extractTemplatePatch(gray, aw, ah, mR.x, mR.y, satPatchR);
              if (refR.stdNorm >= 4) curSatR = refR;
            }
            if (mB.score >= 0.80) {
              const refB = extractTemplatePatch(gray, aw, ah, mB.x, mB.y, satPatchR);
              if (refB.stdNorm >= 4) curSatB = refB;
            }
          }
        }

        curScale = clamp(curScale * stepScale, 0.35, 4.5);
        const depthZ = camDist * (1 - 1 / curScale);

        framesSinceRefresh++;
        const colorConsistent = !useColorLock || (match.colorScore || 0) >= 0.45;
        if (match.score >= 0.80 && colorConsistent && framesSinceRefresh >= 2) {
          const refreshed = extractTemplatePatch(gray, aw, ah, curAx, curAy, patchR);
          if (refreshed.stdNorm >= 5) {
            curTpl = refreshed;
            framesSinceRefresh = 0;
          }
        }

        const pt = {
          frame: f,
          x: Number(toProjX(curAx).toFixed(1)),
          y: Number(toProjY(curAy).toFixed(1)),
          z: Number(depthZ.toFixed(1)),
          scale: Number(curScale.toFixed(3)),
          rotation: orientState.rotation,
          rotX: orientState.rotX,
          rotY: orientState.rotY,
          score: Number(match.score.toFixed(2)),
          colorScore: Number((match.colorScore || 0).toFixed(2)),
          coasting: false
        };
        pointMap.set(f, pt);

        completedSteps++;
        if (onFrameTracked) {
          const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
          onFrameTracked(pct, pt, pointMap.size);
        }

        if (hitEdge) break;

        if (yieldEvery > 0 && completedSteps % yieldEvery === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    };

    if (direction === 'forward' || direction === 'both') {
      await runSweep(1);
    }
    if (!this.cancelled && (direction === 'backward' || direction === 'both')) {
      await runSweep(-1);
    }

    const rawPoints = Array.from(pointMap.values()).sort((a, b) => a.frame - b.frame);
    const points = smoothTrackedPoints(rawPoints, startF, 0.55);
    const avgScore =
      points.length > 0
        ? points.reduce((acc, p) => acc + (p.score || 0), 0) / points.length
        : 0;

    return {
      sourceLayerId,
      anchorFrame: startF,
      startFrame: points[0]?.frame ?? startF,
      endFrame: points[points.length - 1]?.frame ?? startF,
      avgConfidence: Number(avgScore.toFixed(2)),
      colorLockUsed: useColorLock,
      colorSignature: anchorColorSig.valid ? { hex: anchorColorSig.hex, hue: anchorColorSig.hue, sat: anchorColorSig.sat } : null,
      coastedFrames,
      points
    };
  }

  /**
   * Converts tracked 3D motion points into real editable keyframes on targetLayer,
   * supporting X/Y panning, approach Scale or true WebGL Depth Z, 3D planar tilt/roll, and auto-exit trim/fade.
   */
  static applyTrackToLayer(targetLayer, trackResult, options = {}) {
    if (!targetLayer || !trackResult?.points?.length) return false;
    const {
      offsetX = 0,
      offsetY = 0,
      applyScale = true,
      use3DDepth = false,
      applyTilt3D = false,
      autoTrim = true,
      maxEndFrame = null,
      exitMode = 'passBy' // 'passBy' | 'fadeTrim' | 'slideTrim' | 'none'
    } = options;

    const pts = trackResult.points;
    const firstF = pts[0].frame;
    const lastF = pts[pts.length - 1].frame;

    targetLayer.keyframes = {
      ...(targetLayer.keyframes || {}),
      x: [],
      y: [],
      ...(use3DDepth ? { z: [] } : {}),
      ...(applyScale && !use3DDepth ? { scaleX: [], scaleY: [] } : {}),
      ...(applyTilt3D ? { rotation: [], rotX: [], rotY: [] } : {})
    };

    const baseSX = targetLayer.transform?.scaleX ?? 1;
    const baseSY = targetLayer.transform?.scaleY ?? 1;
    const baseZ = targetLayer.transform?.z ?? 0;
    const baseRot = targetLayer.transform?.rotation ?? 0;
    const baseRotX = targetLayer.transform?.rotX ?? 0;
    const baseRotY = targetLayer.transform?.rotY ?? 0;

    for (const pt of pts) {
      const sc = pt.scale || 1;
      if (use3DDepth) {
        // Place at true 3D depth Z so perspective scales automatically and camera orbit produces 3D parallax
        const wx = (pt.x + offsetX * sc) / sc;
        const wy = (pt.y + offsetY * sc) / sc;
        KeyframeEngine.setKeyframe(targetLayer, 'x', pt.frame, Number(wx.toFixed(1)), 'linear');
        KeyframeEngine.setKeyframe(targetLayer, 'y', pt.frame, Number(wy.toFixed(1)), 'linear');
        KeyframeEngine.setKeyframe(targetLayer, 'z', pt.frame, Number((baseZ + (pt.z || 0)).toFixed(1)), 'linear');
      } else {
        const effScale = applyScale ? sc : 1;
        KeyframeEngine.setKeyframe(targetLayer, 'x', pt.frame, Number((pt.x + offsetX * effScale).toFixed(1)), 'linear');
        KeyframeEngine.setKeyframe(targetLayer, 'y', pt.frame, Number((pt.y + offsetY * effScale).toFixed(1)), 'linear');
        if (applyScale) {
          KeyframeEngine.setKeyframe(targetLayer, 'scaleX', pt.frame, Number((baseSX * sc).toFixed(3)), 'linear');
          KeyframeEngine.setKeyframe(targetLayer, 'scaleY', pt.frame, Number((baseSY * sc).toFixed(3)), 'linear');
        }
      }

      if (applyTilt3D) {
        KeyframeEngine.setKeyframe(targetLayer, 'rotation', pt.frame, Number((baseRot + (pt.rotation || 0)).toFixed(1)), 'linear');
        KeyframeEngine.setKeyframe(targetLayer, 'rotX', pt.frame, Number((baseRotX + (pt.rotX || 0)).toFixed(1)), 'linear');
        KeyframeEngine.setKeyframe(targetLayer, 'rotY', pt.frame, Number((baseRotY + (pt.rotY || 0)).toFixed(1)), 'linear');
      }
    }

    let finalEndF = lastF;
    if (autoTrim && lastF > firstF) {
      targetLayer.startFrame = firstF;
      targetLayer.endFrame = lastF;
    }

    const span = Math.max(1, lastF - firstF);
    const applySmoothFadeOut = (fadeStartF, fadeEndF) => {
      targetLayer.keyframes.opacity = [];
      const baseOp = targetLayer.transform?.opacity ?? 1;
      const clampedStart = Math.max(firstF, Math.round(fadeStartF));
      const clampedEnd = Math.max(clampedStart + 2, Math.round(fadeEndF));
      const midF = Math.round(clampedStart + (clampedEnd - clampedStart) * 0.58);
      KeyframeEngine.setKeyframe(targetLayer, 'opacity', clampedStart, baseOp, 'smooth');
      if (midF > clampedStart && midF < clampedEnd) {
        KeyframeEngine.setKeyframe(targetLayer, 'opacity', midF, Number((baseOp * 0.48).toFixed(3)), 'smooth');
      }
      KeyframeEngine.setKeyframe(targetLayer, 'opacity', clampedEnd, 0, 'linear');
    };

    if (exitMode === 'passBy' && pts.length >= 2 && span >= 4) {
      // Natural roadside/world pass-by: continue perspective motion + expansion past exit while fading smoothly
      const lookbackIdx = Math.max(0, pts.length - Math.min(6, pts.length));
      const pPrev = pts[lookbackIdx];
      const pLast = pts[pts.length - 1];
      const df = Math.max(1, pLast.frame - pPrev.frame);
      const vx = (pLast.x - pPrev.x) / df;
      const vy = (pLast.y - pPrev.y) / df;
      const prevSc = Math.max(0.2, pPrev.scale || 1);
      const lastSc = Math.max(0.2, pLast.scale || 1);
      const scaleRate = clamp(Math.pow(lastSc / prevSc, 1 / df), 0.985, 1.045);

      const rawTail = clamp(Math.round(span * 0.25), 10, 22);
      const availTail = maxEndFrame != null ? Math.max(0, Math.round(maxEndFrame) - lastF) : rawTail;
      const tailFrames = Math.min(rawTail, availTail);
      finalEndF = lastF + tailFrames;

      if (tailFrames >= 2) {
        const lastX = KeyframeEngine.getValueAtFrame(targetLayer, 'x', lastF, pLast.x);
        const lastY = KeyframeEngine.getValueAtFrame(targetLayer, 'y', lastF, pLast.y);
        const lastZ = use3DDepth ? KeyframeEngine.getValueAtFrame(targetLayer, 'z', lastF, baseZ + (pLast.z || 0)) : 0;
        const speed = Math.hypot(vx, vy);
        // If object was nearly stationary at clip end, gently sweep outward toward its quadrant
        const fallbackDirX = Math.abs(pLast.x) > 10 ? Math.sign(pLast.x) : 1;
        const effVx = speed >= 0.35 ? vx : fallbackDirX * 1.4;
        const effVy = speed >= 0.35 ? vy : 0.35;
        const passScaleRate = scaleRate > 1.002 ? scaleRate : 1.012;

        // Add pass-by tail keyframes (two checkpoints for smooth perspective curve)
        const midT = Math.max(1, Math.round(tailFrames * 0.5));
        for (const t of [midT, tailFrames]) {
          const kfFrame = lastF + t;
          const accel = 1 + 0.045 * t;
          const endSc = clamp(lastSc * Math.pow(passScaleRate, t), 0.35, 5.0);
          if (use3DDepth) {
            const pScreenX = pLast.x + effVx * t * accel;
            const pScreenY = pLast.y + effVy * t * accel;
            const wx = (pScreenX + offsetX * endSc) / endSc;
            const wy = (pScreenY + offsetY * endSc) / endSc;
            const zDelta = (endSc - lastSc) * 140;
            KeyframeEngine.setKeyframe(targetLayer, 'x', kfFrame, Number(wx.toFixed(1)), 'smooth');
            KeyframeEngine.setKeyframe(targetLayer, 'y', kfFrame, Number(wy.toFixed(1)), 'smooth');
            KeyframeEngine.setKeyframe(targetLayer, 'z', kfFrame, Number((lastZ + zDelta).toFixed(1)), 'smooth');
          } else {
            KeyframeEngine.setKeyframe(targetLayer, 'x', kfFrame, Number((lastX + effVx * t * accel).toFixed(1)), 'smooth');
            KeyframeEngine.setKeyframe(targetLayer, 'y', kfFrame, Number((lastY + effVy * t * accel).toFixed(1)), 'smooth');
            if (applyScale) {
              KeyframeEngine.setKeyframe(targetLayer, 'scaleX', kfFrame, Number((baseSX * endSc).toFixed(3)), 'smooth');
              KeyframeEngine.setKeyframe(targetLayer, 'scaleY', kfFrame, Number((baseSY * endSc).toFixed(3)), 'smooth');
            }
          }
        }
        if (autoTrim) targetLayer.endFrame = finalEndF;
      }

      const totalSpan = Math.max(4, finalEndF - firstF);
      const fadeFrames = clamp(Math.round(totalSpan * 0.42), Math.min(12, totalSpan - 1), 40);
      applySmoothFadeOut(finalEndF - fadeFrames, finalEndF);
    } else if (exitMode === 'fadeTrim' && span >= 6) {
      const fadeFrames = clamp(Math.round(span * 0.35), Math.min(10, span - 1), 32);
      applySmoothFadeOut(lastF - fadeFrames, lastF);
    } else if (exitMode === 'slideTrim' && pts.length >= 2 && span >= 6) {
      const pPrev = pts[Math.max(0, pts.length - 4)];
      const pLast = pts[pts.length - 1];
      const df = Math.max(1, pLast.frame - pPrev.frame);
      const vx = (pLast.x - pPrev.x) / df;
      const vy = (pLast.y - pPrev.y) / df;
      const rawTail = clamp(Math.round(span * 0.25), 6, 18);
      const availTail = maxEndFrame != null ? Math.max(0, Math.round(maxEndFrame) - lastF) : rawTail;
      const exitSpan = Math.min(rawTail, availTail);
      const slideEndF = lastF + exitSpan;
      const mag = Math.hypot(vx, vy);
      const dirX = mag > 0.4 ? vx / mag : 1;
      const dirY = mag > 0.4 ? vy / mag : 0;
      const extraDist = Math.max(160, mag * exitSpan * 2.1);
      const lastX = KeyframeEngine.getValueAtFrame(targetLayer, 'x', lastF, pLast.x);
      const lastY = KeyframeEngine.getValueAtFrame(targetLayer, 'y', lastF, pLast.y);
      if (exitSpan >= 2) {
        KeyframeEngine.setKeyframe(targetLayer, 'x', slideEndF, Number((lastX + dirX * extraDist).toFixed(1)), 'easeIn');
        KeyframeEngine.setKeyframe(targetLayer, 'y', slideEndF, Number((lastY + dirY * extraDist).toFixed(1)), 'easeIn');
      }
      const fadeSpan = Math.max(exitSpan, Math.min(16, Math.round(span * 0.3)));
      applySmoothFadeOut(slideEndF - fadeSpan, slideEndF);
      if (autoTrim) targetLayer.endFrame = slideEndF;
    }

    targetLayer.pinnedSourceLayerId = trackResult.sourceLayerId;
    return true;
  }
}
