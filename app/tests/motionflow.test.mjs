import test from 'node:test';
import assert from 'node:assert/strict';

import { KEYFRAME_LANE_GROUPS, CAMERA_LANE_GROUPS, CUBIC_BEZIER_PRESETS, KeyframeEngine, EASING_TYPES } from '../src/main/assets/www/js/engine/keyframeEngine.js';
import { applyEasing, lerpColorHex, normalizeHexColor } from '../src/main/assets/www/js/utils/math.js';
import {
  STABILIZE_PRESETS,
  StabilizerEngine,
  computeStabilizedTransforms,
  estimateInterFrameMotion,
  getStabilizerAtFrame
} from '../src/main/assets/www/js/engine/stabilizerEngine.js';
import { TimelineEngine } from '../src/main/assets/www/js/engine/timelineEngine.js';
import { AudioEngine, detectBeatsFromPcm } from '../src/main/assets/www/js/engine/audioEngine.js';
import { parseSrtOrLyrics, FILTER_PRESETS, VIDEO_EFFECT_PRESETS, TRANSITION_PRESETS, TRANSITION_CATEGORIES } from '../src/main/assets/www/js/engine/capcutCatalog.js';
import { ExportEngine } from '../src/main/assets/www/js/export/exportEngine.js';
import { createEmptyProject, deserializeProject, serializeProject } from '../src/main/assets/www/js/storage/projectStorage.js';
import { RendererEngine } from '../src/main/assets/www/js/engine/rendererEngine.js';
import { extractGrayscale, extractTemplatePatch, matchTemplateCoarseToFine } from '../src/main/assets/www/js/engine/trackerEngine.js';
import {
  analyzeRgbaPalette,
  analyzeShapePalette,
  applyFxToPalette,
  computeTimelineAveragePalette,
  computeColorMatchFx,
  applyColorMatchToLayer,
  setLayerColorMatchIntensity,
  toggleLayerColorMatch
} from '../src/main/assets/www/js/engine/colorMatchEngine.js';

test('KeyframeEngine smooth Catmull-Rom spline & smoothCameraKeyframes', () => {
  assert.ok(EASING_TYPES.some((e) => e.key === 'smooth'));

  const cam = {
    x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, zoom: 1,
    keyframes: { x: [], y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: [] }
  };

  KeyframeEngine.setKeyframe(cam, 'rotY', 0, 0, 'smooth');
  KeyframeEngine.setKeyframe(cam, 'rotY', 20, 45, 'smooth');
  KeyframeEngine.setKeyframe(cam, 'rotY', 60, 15, 'smooth');
  KeyframeEngine.setKeyframe(cam, 'rotY', 90, 90, 'smooth');

  const mid = KeyframeEngine.getValueAtFrame(cam, 'rotY', 30, 0);
  assert.ok(Number.isFinite(mid) && mid > 15 && mid < 55, `Expected smooth midpoint in (15, 55), got ${mid}`);

  // Unequal spacing overshoot sanity check
  for (let f = 0; f <= 90; f += 3) {
    const v = KeyframeEngine.getValueAtFrame(cam, 'rotY', f, 0);
    assert.ok(Number.isFinite(v) && v >= -10 && v <= 105, `Out of bounds at F${f}: ${v}`);
  }

  // Smooth path helper reduces jagged zigzag spike while preserving endpoints
  const noisy = {
    x: [
      { frame: 0, value: 0, easing: 'linear' },
      { frame: 10, value: 100, easing: 'linear' },
      { frame: 20, value: 0, easing: 'linear' },
      { frame: 30, value: 100, easing: 'linear' }
    ],
    y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: []
  };
  KeyframeEngine.smoothCameraKeyframes({ keyframes: noisy }, 0.5);
  assert.equal(noisy.x[0].value, 0);
  assert.equal(noisy.x[3].value, 100);
  assert.ok(noisy.x[1].value < 100 && noisy.x[1].easing === 'smooth');
});

test('KeyframeEngine volume track lookup works without deprecated evaluateTrack', () => {
  const proj = createEmptyProject('Test');
  const layer = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  KeyframeEngine.setKeyframe(layer, 'volume', 0, 1, 'linear');
  KeyframeEngine.setKeyframe(layer, 'volume', 30, 0.25, 'linear');
  const v = KeyframeEngine.getValueAtFrame(layer, 'volume', 15, 1);
  assert.ok(Math.abs(v - 0.625) < 0.01);
});

test('StabilizerEngine motion estimation recovers synthetic camera shake', () => {
  const w = 160;
  const h = 90;
  const blobs = [
    { x: 40, y: 23, r: 90, a: 85 },
    { x: 120, y: 24, r: 110, a: -75 },
    { x: 80, y: 45, r: 140, a: 95 },
    { x: 40, y: 66, r: 100, a: -80 },
    { x: 120, y: 67, r: 95, a: 80 },
    { x: 64, y: 36, r: 75, a: 60 },
    { x: 98, y: 54, r: 85, a: -65 }
  ];
  const makePattern = (shiftX, shiftY) => {
    const buf = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - shiftX;
        const sy = y - shiftY;
        let val = 128 + (sx - 80) * 0.25 + (sy - 45) * 0.18;
        for (const b of blobs) {
          const dx = sx - b.x;
          const dy = sy - b.y;
          val += b.a * Math.exp(-(dx * dx + dy * dy) / b.r);
        }
        buf[y * w + x] = Math.max(0, Math.min(255, val));
      }
    }
    return buf;
  };

  const prev = makePattern(0, 0);
  const cur = makePattern(4.2, -3.1); // cur(x + 4.2, y - 3.1) == prev(x, y)
  const est = estimateInterFrameMotion(prev, cur, w, h, 12);
  assert.ok(Math.abs(est.dx - 4.2) < 0.6, `Expected dx ≈ 4.2, got ${est.dx}`);
  assert.ok(Math.abs(est.dy - (-3.1)) < 0.6, `Expected dy ≈ -3.1, got ${est.dy}`);
});

test('StabilizerEngine computes zero-black-border cropScale across all 3 CapCut levels', () => {
  const srcW = 1280;
  const srcH = 720;
  const asp = srcW / srcH;

  // Simulated handheld jitter + panning
  const motions = Array.from({ length: 60 }, (_, i) => ({
    srcFrame: i,
    dx: i === 0 ? 0 : (i % 2 === 0 ? 18 : -16) + 2, // jitter + gentle pan right
    dy: i === 0 ? 0 : (i % 3 === 0 ? 12 : -9),
    dRot: i === 0 ? 0 : (i % 2 === 0 ? 0.018 : -0.016)
  }));

  for (const preset of STABILIZE_PRESETS) {
    const res = computeStabilizedTransforms(motions, srcW, srcH, preset.id);
    assert.equal(res.frames.length, 60);
    assert.ok(res.cropScale >= 1.0 && res.cropScale <= 1.55);

    // Check WebGL inverse UV corners remain inside [0, 1] x [0, 1] on every frame
    for (const f of res.frames) {
      const dxNorm = f.dx / srcW;
      const dyNorm = f.dy / srcH;
      const cs = Math.cos(f.rot);
      const sn = Math.sin(f.rot);

      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const px = ((u - 0.5) / res.cropScale) * asp;
        const py = (v - 0.5) / res.cropScale;
        const rpx = (px * cs + py * sn) / asp;
        const rpy = -px * sn + py * cs;
        const su = rpx - dxNorm + 0.5;
        const sv = rpy - dyNorm + 0.5;
        assert.ok(su >= -1e-4 && su <= 1 + 1e-4, `${preset.id} F${f.srcFrame} U out of bounds: ${su}`);
        assert.ok(sv >= -1e-4 && sv <= 1 + 1e-4, `${preset.id} F${f.srcFrame} V out of bounds: ${sv}`);
      }
    }
  }

  // Preset recomputation works instantly without re-decoding video
  const rec = StabilizerEngine.recomputePreset({
    srcW, srcH, rawMotions: motions, enabled: true
  }, 'mostStable');
  assert.equal(rec.level, 'mostStable');
  assert.ok(rec.frames.length === 60);
});

test('getStabilizerAtFrame maps split/trimmed/offset clips via source time', () => {
  const layer = {
    startFrame: 30,
    endFrame: 90,
    mediaOffsetFrames: 60,
    speed: 1,
    speedCurve: 'none',
    stabilizer: {
      enabled: true,
      cropScale: 1.08,
      frames: [
        { srcFrame: 60, dx: 10, dy: -4, rot: 0.01 },
        { srcFrame: 90, dx: -10, dy: 4, rot: -0.01 }
      ]
    }
  };
  // Timeline frame 45 => 15 frames into clip + offset 60 = srcFrame 75 (midpoint)
  const mid = getStabilizerAtFrame(layer, 45, 30);
  assert.ok(Math.abs(mid.dx - 0) < 0.05);
  assert.ok(Math.abs(mid.dy - 0) < 0.05);
  assert.equal(mid.cropScale, 1.08);
});

test('ProjectStorage deserializeProject preserves rotZ on legacy camera imports', () => {
  const legacyJson = JSON.stringify({
    name: 'LegacyProj',
    layers: [],
    camera: {
      enabled: true,
      x: 12,
      keyframes: { x: [{ frame: 0, value: 12, easing: 'linear' }] }
    }
  });
  const proj = deserializeProject(legacyJson);
  assert.ok(Array.isArray(proj.camera.keyframes.rotZ));
  assert.equal(proj.camera.x, 12);
});

test('TimelineEngine split, move, trim & AudioEngine beat detector', () => {
  const proj = createEmptyProject('TLTest', { width: 1280, height: 720, fps: 30, durationSec: 10 });
  const clip = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clip.startFrame = 10;
  clip.endFrame = 70;
  TimelineEngine.addLayer(proj, clip);

  const right = TimelineEngine.splitClipAtFrame(proj, clip.id, 40);
  assert.ok(right);
  assert.equal(clip.endFrame, 40);
  assert.equal(right.startFrame, 40);
  assert.equal(right.endFrame, 70);

  // Beat peak detection on synthetic 120 BPM drum pulse at 16 kHz sample rate
  const sr = 16000;
  const pcm = new Float32Array(sr * 3);
  for (let sec = 0.5; sec < 3; sec += 0.5) {
    const idx = Math.floor(sec * sr);
    for (let k = 0; k < 320; k++) pcm[idx + k] = 0.95;
  }
  const beats = detectBeatsFromPcm(pcm, sr, 30, 0, 0.75);
  assert.ok(beats.length >= 4, `Expected >= 4 detected beats, got ${beats.length}`);
});

test('CapCut Catalog & ZNCC Tracker core sanity', () => {
  const cues = parseSrtOrLyrics('1\n00:00:01,000 --> 00:00:03,000\nHello MotionFlow', 30);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startFrame, 30);
  assert.equal(cues[0].endFrame, 90);
  assert.ok(FILTER_PRESETS.length >= 10 && VIDEO_EFFECT_PRESETS.length >= 10);

  const w = 64;
  const h = 64;
  const rgba1 = new Uint8ClampedArray(w * h * 4);
  const rgba2 = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v1 = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.exp(-(((x - 30) ** 2 + (y - 30) ** 2) / 36)))));
      const v2 = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.exp(-(((x - 34) ** 2 + (y - 28) ** 2) / 36)))));
      rgba1[i] = rgba1[i + 1] = rgba1[i + 2] = v1; rgba1[i + 3] = 255;
      rgba2[i] = rgba2[i + 1] = rgba2[i + 2] = v2; rgba2[i + 3] = 255;
    }
  }
  const g1 = extractGrayscale(rgba1, w, h);
  const g2 = extractGrayscale(rgba2, w, h);
  const tpl = extractTemplatePatch(g1, w, h, 30, 30, 6);
  const m = matchTemplateCoarseToFine(tpl, g2, w, h, 30, 30, 12, false);
  assert.ok(m.score > 0.9 && Math.abs(m.x - 34) < 0.7 && Math.abs(m.y - 28) < 0.7);
});

test('TimelineEngine between-clip transitions, split transition reset & Apply to All', () => {
  const proj = createEmptyProject('TransTest', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const clipA = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clipA.startFrame = 0;
  clipA.endFrame = 90;
  clipA.transitions = { inType: 'fadeBlack', inFrames: 12, outType: 'zoomIn', outFrames: 10 };
  TimelineEngine.addLayer(proj, clipA);

  // Split at F45: left keeps inType=fadeBlack and resets outType=none; right resets inType=none and keeps outType=zoomIn
  const clipB = TimelineEngine.splitClipAtFrame(proj, clipA.id, 45);
  assert.ok(clipB);
  assert.equal(clipA.transitions.inType, 'fadeBlack');
  assert.equal(clipA.transitions.outType, 'none');
  assert.equal(clipB.transitions.inType, 'none');
  assert.equal(clipB.transitions.outType, 'zoomIn');

  // Add a 3rd sequential clip C [90..150]
  const clipC = TimelineEngine.createShapeLayer(proj, 'circle', 90);
  clipC.startFrame = 90;
  clipC.endFrame = 150;
  TimelineEngine.addLayer(proj, clipC);

  const junctions = TimelineEngine.findTransitionJunctions(proj);
  assert.equal(junctions.length, 2);
  assert.equal(junctions[0].leftId, clipA.id);
  assert.equal(junctions[0].rightId, clipB.id);
  assert.equal(junctions[1].leftId, clipB.id);
  assert.equal(junctions[1].rightId, clipC.id);

  const ok = TimelineEngine.applyTransitionBetweenClips(proj, clipA.id, clipB.id, 'crossfade', 24);
  assert.equal(ok, true);
  assert.equal(clipA.transitions.outType, 'crossfade');
  assert.equal(clipB.transitions.inType, 'crossfade');
  assert.equal(clipA.transitions.outFrames, 12);
  assert.equal(clipB.transitions.inFrames, 12);

  const countAll = TimelineEngine.applyTransitionToAllJunctions(proj, 'slideLeft', 20);
  assert.equal(countAll, 2);
  assert.equal(clipB.transitions.outType, 'slideLeft');
  assert.equal(clipC.transitions.inType, 'slideLeft');

  // Catalog sanity
  assert.ok(TRANSITION_PRESETS.length >= 15);
  assert.ok(TRANSITION_CATEGORIES.length >= 4);
  const ids = new Set(TRANSITION_PRESETS.map((t) => t.id));
  assert.equal(ids.size, TRANSITION_PRESETS.length);
  assert.ok(TRANSITION_PRESETS.every((t) => Boolean(t.animClass)));
});

import {
  computeRulerLodSpec,
  computeDynamicRulerTicks,
  formatRulerLabel,
  formatDurationShort,
  formatSignedDurationDelta,
  getClipStatusBadges,
  isSnapActive,
  computeEdgeAutoScrollDelta
} from '../src/main/assets/www/js/ui/timelineView.js';

test('ExportEngine effective trimmed duration & even dimensions', () => {
  const proj = createEmptyProject('ExpTest', { width: 1080, height: 1920, fps: 30, durationSec: 12 });
  const clip = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clip.startFrame = 0;
  clip.endFrame = 120; // 4.0s content inside 12.0s timeline
  TimelineEngine.addLayer(proj, clip);

  const exporter = new ExportEngine(null, null);
  assert.equal(exporter.getEffectiveDurationFrames(proj, true), 120);
  assert.equal(exporter.getEffectiveDurationFrames(proj, false), 360);

  const dims = exporter.computeOutputDimensions(proj, '1080p');
  assert.equal(dims.width, 1080);
  assert.equal(dims.height, 1920);
  assert.equal(dims.width % 2, 0);
  assert.equal(dims.height % 2, 0);
});

test('TimelineEngine findTransitionJunctions detects main clip seams across overlapping PiP/stickers', () => {
  const proj = createEmptyProject('OverlaySeam', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const clipA = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'A', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 0);
  clipA.startFrame = 0;
  clipA.endFrame = 90;

  const stickerC = TimelineEngine.createMediaLayer(proj, { id: 'img1', name: 'Sticker', type: 'image', width: 200, height: 200, durationMs: 2000 }, 20);
  stickerC.startFrame = 20;
  stickerC.endFrame = 70;

  const pipD = TimelineEngine.createMediaLayer(proj, { id: 'img2', name: 'PiP', type: 'image', width: 300, height: 300, durationMs: 4000 }, 15);
  pipD.startFrame = 15;
  pipD.endFrame = 120;

  const clipB = TimelineEngine.createMediaLayer(proj, { id: 'v2', name: 'B', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 90);
  clipB.startFrame = 90;
  clipB.endFrame = 180;

  TimelineEngine.addLayer(proj, clipA);
  TimelineEngine.addLayer(proj, stickerC);
  TimelineEngine.addLayer(proj, pipD);
  TimelineEngine.addLayer(proj, clipB);

  const junctions = TimelineEngine.findTransitionJunctions(proj);
  assert.ok(junctions.some((j) => j.leftId === clipA.id && j.rightId === clipB.id && j.seamFrame === 90));
});

test('TimelineEngine detachAudioFromVideo preserves audio FX, speedCurve, reversed & volume keyframes', () => {
  const proj = createEmptyProject('AudioDetach', { width: 1280, height: 720, fps: 30, durationSec: 6 });
  const vid = TimelineEngine.createMediaLayer(proj, { id: 'm1', name: 'Clip1', type: 'video', width: 1280, height: 720, durationMs: 4000 }, 10);
  vid.endFrame = 130;
  vid.speed = 1.5;
  vid.speedCurve = 'montage';
  vid.reversed = true;
  vid.mediaOffsetFrames = 12;
  vid.audioProps = {
    volume: 0.75,
    fadeInFrames: 10,
    fadeOutFrames: 15,
    muted: false,
    voiceEffect: 'deep',
    reduceNoise: true,
    normalize: true
  };
  KeyframeEngine.setKeyframe(vid, 'volume', 10, 0.2, 'linear');
  KeyframeEngine.setKeyframe(vid, 'volume', 100, 0.9, 'linear');
  TimelineEngine.addLayer(proj, vid);

  const detached = TimelineEngine.detachAudioFromVideo(proj, vid.id);
  assert.ok(detached);
  assert.equal(detached.type, 'audio');
  assert.equal(vid.audioProps.muted, true);
  assert.equal(detached.audioProps.muted, false);
  assert.equal(detached.audioProps.volume, 0.75);
  assert.equal(detached.audioProps.voiceEffect, 'deep');
  assert.equal(detached.audioProps.reduceNoise, true);
  assert.equal(detached.audioProps.normalize, true);
  assert.equal(detached.speedCurve, 'montage');
  assert.equal(detached.reversed, true);
  assert.equal(detached.mediaOffsetFrames, 12);
  assert.equal(detached.keyframes.volume.length, 2);
});

test('TimelineEngine replaceLayerMedia clears stale tracking/stabilizer & deleteLayer unpins children', () => {
  const proj = createEmptyProject('ReplacePin', { width: 1280, height: 720, fps: 30, durationSec: 6 });
  const vid = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'Orig', type: 'video', width: 1280, height: 720, durationMs: 4000 }, 0);
  vid.reversed = true;
  vid.trackData = { sourceLayerId: vid.id, anchorFrame: 0, points: [{ frame: 0, x: 10, y: 20 }] };
  vid.stabilizer = { enabled: true, level: 'recommended', cropScale: 1.12, frames: [] };
  TimelineEngine.addLayer(proj, vid);

  const txt = TimelineEngine.createTextLayer(proj, 0);
  txt.pinnedSourceLayerId = vid.id;
  TimelineEngine.addLayer(proj, txt);

  const ok = TimelineEngine.replaceLayerMedia(proj, vid.id, {
    id: 'img_new',
    name: 'Photo',
    type: 'image',
    width: 800,
    height: 800,
    durationMs: 3000
  });
  assert.equal(ok, true);
  assert.equal(vid.type, 'image');
  assert.equal(vid.reversed, false);
  assert.equal(vid.trackData, null);
  assert.equal(vid.stabilizer, null);

  TimelineEngine.deleteLayer(proj, vid.id);
  assert.equal(txt.pinnedSourceLayerId, null);
});

test('TimelineEngine rippleDelete, freezeFrame, reverse split, speedCurve & copy/paste attributes', () => {
  const proj = createEmptyProject('OpsTest', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const c1 = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  c1.startFrame = 0; c1.endFrame = 60;
  c1.filterId = 'cinema';
  c1.filterIntensity = 0.8;
  c1.blendMode = 'screen';
  c1.fx.contrast = 1.25;
  c1.reversed = true;
  c1.speed = 2;
  c1.mediaOffsetFrames = 10;

  const c2 = TimelineEngine.createShapeLayer(proj, 'circle', 60);
  c2.startFrame = 60; c2.endFrame = 120;
  KeyframeEngine.setKeyframe(c2, 'x', 60, 0, 'linear');
  KeyframeEngine.setKeyframe(c2, 'x', 120, 100, 'linear');

  TimelineEngine.addLayer(proj, c2);
  TimelineEngine.addLayer(proj, c1);

  // Attribute copy & paste
  const attrs = TimelineEngine.copyAttributesFromLayer(c1);
  assert.equal(TimelineEngine.pasteAttributesToLayer(c2, attrs), true);
  assert.equal(c2.filterId, 'cinema');
  assert.equal(c2.blendMode, 'screen');
  assert.equal(c2.fx.contrast, 1.25);

  // Reversed split offset check: leftOffset gets end-side delta, rightOffset keeps origOffset
  const splitRight = TimelineEngine.splitClipAtFrame(proj, c1.id, 30);
  assert.ok(splitRight);
  assert.equal(splitRight.mediaOffsetFrames, 10);
  assert.equal(c1.mediaOffsetFrames, 10 + 30 * 2);

  // Ripple delete splitRight [30..60] shifts c2 [60..120] left by 30 frames (plus keyframes)
  assert.equal(TimelineEngine.rippleDeleteLayer(proj, splitRight.id), true);
  assert.equal(c2.startFrame, 30);
  assert.equal(c2.endFrame, 90);
  assert.equal(c2.keyframes.x[0].frame, 30);
  assert.equal(c2.keyframes.x[1].frame, 90);

  // Insert freeze frame inside c2 at frame 60 (30 frames long) shifts right half +30 frames
  const frozen = TimelineEngine.insertFreezeFrame(proj, c2.id, 60, { id: 'frz1', name: 'Frz' }, 30);
  assert.ok(frozen);
  assert.equal(frozen.startFrame, 60);
  assert.equal(frozen.endFrame, 90);
  assert.equal(c2.endFrame, 60);

  // Speed curve monotonic integral integration
  const curveClip = { startFrame: 0, endFrame: 60, speed: 1, speedCurve: 'montage' };
  const halfSrc = TimelineEngine.integrateSpeedCurveSourceFrames(curveClip, 30);
  const fullSrc = TimelineEngine.integrateSpeedCurveSourceFrames(curveClip, 60);
  assert.ok(halfSrc > 0 && fullSrc > halfSrc);
});

test('Dynamic 30fps Ruler LOD & Labels + CapCut Plain Lyrics Fallback', () => {
  // Overview (~34.5 px/s @ 30fps => tier 2: 5s major / 1s minor)
  const overview = computeRulerLodSpec(1.15, 30);
  assert.equal(overview.tier, 2);
  assert.equal(overview.majorFrames, 150);
  assert.equal(overview.minorFrames, 30);

  // Zoomed in (~90 px/s @ 30fps => tier 3: 1s major, 1s labels)
  const zoom1s = computeRulerLodSpec(3.0, 30);
  assert.equal(zoom1s.tier, 3);
  assert.equal(zoom1s.majorFrames, 30);

  // Deep frame-level zoom (~960 px/s @ 30fps => tier 7: 1f labels)
  const zoomFrame = computeRulerLodSpec(32.0, 30);
  assert.equal(zoomFrame.tier, 7);
  assert.equal(zoomFrame.labelFrames, 1);

  assert.equal(formatRulerLabel(0, 30), '0s');
  assert.equal(formatRulerLabel(150, 30), '5s');
  assert.equal(formatRulerLabel(1800, 30), '1m');
  assert.equal(formatRulerLabel(2730, 30), '1m31s');
  assert.equal(formatRulerLabel(45, 30), '+15f');

  // Plain lyric lines fallback
  const lyrics = parseSrtOrLyrics('Baris satu\n\nBaris dua', 30, 30, 2);
  assert.equal(lyrics.length, 2);
  assert.equal(lyrics[0].startFrame, 30);
  assert.equal(lyrics[0].endFrame, 90);
  assert.equal(lyrics[1].startFrame, 90);
  assert.equal(lyrics[1].endFrame, 150);
});

test('AudioEngine zero-volume silence and failed buffer cache behavior', async () => {
  const engine = new AudioEngine();
  const events = [];
  const mockGain = {
    setValueAtTime: (v, t) => events.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => events.push(['ramp', v, t])
  };
  // Zero volume with fadeOut should remain strictly 0 (not ramp up to 0.0001)
  engine._scheduleGainWithKeyframes(mockGain, { keyframes: {}, endFrame: 90 }, 0, 0, 0, 0, 30, 0.5, 0.5, 3.0, 3.0, 0, 3.0);
  assert.deepEqual(events, [['set', 0, 0]]);

  // Non-existing URL adds to failedIds and avoids repeated fetches until purged
  const missing = await engine.loadBuffer({ id: 'missing_1', url: '' });
  assert.equal(missing, null);
  engine.failedIds.add('bad_1');
  assert.equal(await engine.loadBuffer({ id: 'bad_1', url: 'https://example.invalid/bad.wav' }), null);
  engine.purgeMediaCache('bad_1');
  assert.equal(engine.failedIds.has('bad_1'), false);
});

test('AudioEngine sampleWaveformBins handles trim offset, reverse, speed & zoomed slice', () => {
  const engine = new AudioEngine();
  const sr = 1000;
  // 2.0 seconds audio: [0..1s] quiet 0.05, [1..2s] loud 0.90 pulse
  const ch0 = new Float32Array(sr * 2);
  for (let i = 0; i < sr; i++) ch0[i] = (i % 2 === 0 ? 0.05 : -0.05);
  for (let i = sr; i < sr * 2; i++) ch0[i] = (i % 2 === 0 ? 0.9 : -0.9);
  const mockBuf = {
    sampleRate: sr,
    duration: 2.0,
    numberOfChannels: 1,
    length: ch0.length,
    getChannelData: () => ch0
  };
  engine.buffers.set('aud_sync', mockBuf);

  // 1. Full 2s clip at 30fps (60 frames): first half quiet, second half loud
  const fullLayer = { startFrame: 0, endFrame: 60, mediaOffsetFrames: 0, speed: 1, speedCurve: 'none', reversed: false };
  const full = engine.sampleWaveformBins('aud_sync', fullLayer, 30, 0, 1, 20);
  assert.equal(full.hasBuffer, true);
  assert.ok(full.peaks[2] < 0.1 && full.peaks[17] > 0.8);

  // 2. Left-trimmed by 30 frames (1.0s offset): whole 1s clip is loud
  const trimmedLayer = { startFrame: 30, endFrame: 60, mediaOffsetFrames: 30, speed: 1, speedCurve: 'none', reversed: false };
  const trimmed = engine.sampleWaveformBins('aud_sync', trimmedLayer, 30, 0, 1, 20);
  assert.ok(trimmed.peaks[0] > 0.8 && trimmed.peaks[19] > 0.8);

  // 3. Reversed full 2s clip: loud part flips to the start!
  const revLayer = { startFrame: 0, endFrame: 60, mediaOffsetFrames: 0, speed: 1, speedCurve: 'none', reversed: true };
  const rev = engine.sampleWaveformBins('aud_sync', revLayer, 30, 0, 1, 20);
  assert.ok(rev.peaks[2] > 0.8 && rev.peaks[17] < 0.1);

  // 4. Zoomed slice [0.55..0.95] on full clip captures only the loud segment
  const zoomed = engine.sampleWaveformBins('aud_sync', fullLayer, 30, 0.55, 0.95, 20);
  assert.ok(zoomed.peaks.every((p) => p > 0.8));

  // 5. Speed 2x on 1s timeline clip traverses full 2s audio (first half quiet, second half loud)
  const fastLayer = { startFrame: 0, endFrame: 30, mediaOffsetFrames: 0, speed: 2, speedCurve: 'none', reversed: false };
  const fast = engine.sampleWaveformBins('aud_sync', fastLayer, 30, 0, 1, 20);
  assert.ok(fast.peaks[2] < 0.1 && fast.peaks[17] > 0.8);
});

test('ExportEngine supports 60fps bitrate scaling and file size estimation', () => {
  const proj = createEmptyProject('Exp60', { width: 1080, height: 1920, fps: 30, durationSec: 8 });
  const clip = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clip.startFrame = 0;
  clip.endFrame = 120; // 4s active content
  TimelineEngine.addLayer(proj, clip);

  const exporter = new ExportEngine(null, null);
  const mbps30 = exporter.getBitrateMbps('high', '1080p', 30);
  const mbps60 = exporter.getBitrateMbps('high', '1080p', 60);
  assert.equal(mbps30, 12);
  assert.ok(mbps60 > mbps30 && mbps60 <= 40, `Expected 60fps Mbps in (12..40], got ${mbps60}`);

  const size30 = exporter.estimateFileSizeMb(proj, '1080p', 'high', true, true, 30);
  const size60 = exporter.estimateFileSizeMb(proj, '1080p', 'high', true, true, 60);
  assert.ok(size60 > size30, `Expected 60fps estimated MB (${size60}) > 30fps (${size30})`);
});

test('ColorMatchEngine analyzes pixel palettes, computes duration-weighted timeline average & adjusts new layer fx', () => {
  const makeSolidRgba = (r, g, b, pxCount = 16) => {
    const arr = new Uint8ClampedArray(pxCount * 4);
    for (let i = 0; i < pxCount; i++) {
      arr[i * 4] = r;
      arr[i * 4 + 1] = g;
      arr[i * 4 + 2] = b;
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  // Warm bright sunset palette vs dark cool blue palette
  const warmPal = analyzeRgbaPalette(makeSolidRgba(235, 160, 75), 4, 4);
  const coolPal = analyzeRgbaPalette(makeSolidRgba(45, 70, 155), 4, 4);
  assert.ok(warmPal && coolPal);
  assert.ok(warmPal.warmth > 0.4, `Expected warm palette warmth > 0.4, got ${warmPal.warmth}`);
  assert.ok(coolPal.warmth < -0.2, `Expected cool palette warmth < -0.2, got ${coolPal.warmth}`);
  assert.ok(warmPal.meanLuma > coolPal.meanLuma);
  assert.ok(warmPal.swatches.length >= 1 && warmPal.swatches[0].hex.startsWith('#'));

  // Shape palette & grading awareness
  const shapePal = analyzeShapePalette({ fillColor: '#E07030', strokeColor: '#FFD166' });
  assert.ok(shapePal && shapePal.warmth > 0.3);
  const brightened = applyFxToPalette(coolPal, { exposure: 0.4, brightness: 0.2, contrast: 1.1 });
  assert.ok(brightened.meanLuma > coolPal.meanLuma);
  const warmed = applyFxToPalette(coolPal, { temperature: 0.5 });
  assert.ok(warmed.warmth > coolPal.warmth);

  // Project timeline with existing warm Main Track clip, ignored sticker/audio, and new cool clip
  const proj = createEmptyProject('ColorMatchProj', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const warmClip = TimelineEngine.createMediaLayer(proj, { id: 'm_warm', name: 'Sunset', type: 'image', width: 1080, height: 1920, durationMs: 4000 }, 0, { trackRole: 'main' });
  const coolNew = TimelineEngine.createMediaLayer(proj, { id: 'm_cool', name: 'BlueClip', type: 'image', width: 1080, height: 1920, durationMs: 3000 }, 120, { trackRole: 'main' });
  const stickerOverlay = TimelineEngine.createMediaLayer(proj, { id: 'stk_badge', name: 'Sticker', type: 'image', width: 200, height: 200, durationMs: 2000 }, 0, { trackRole: 'overlay' });
  const bgMusic = TimelineEngine.createMediaLayer(proj, { id: 'aud_1', name: 'BGM', type: 'audio', durationMs: 4000 }, 0);

  TimelineEngine.addToMainTrack(proj, warmClip);
  TimelineEngine.addToMainTrack(proj, coolNew);
  TimelineEngine.addLayer(proj, stickerOverlay);
  TimelineEngine.addLayer(proj, bgMusic);

  // Use a separate blue-tinted palette on sticker to confirm stk_ & target clip are excluded
  const paletteMap = new Map([
    ['m_warm', warmPal],
    ['m_cool', coolPal],
    ['stk_badge', coolPal]
  ]);

  const timelineAvg = computeTimelineAveragePalette(proj, paletteMap, { excludeLayerId: coolNew.id });
  assert.ok(timelineAvg);
  assert.equal(timelineAvg.layerCount, 1);
  assert.ok(timelineAvg.warmth > 0.4);

  const computed = computeColorMatchFx(coolPal, timelineAvg, 0.8);
  assert.ok(computed.temperature > 0.2, `Expected positive warmth temperature shift, got ${computed.temperature}`);
  assert.ok(computed.exposure > 0 || computed.brightness > 0);

  coolNew.fx.contrast = 1.1; // Pre-existing user base contrast should be preserved/multiplied
  assert.equal(applyColorMatchToLayer(coolNew, coolPal, timelineAvg, 0.8), true);
  assert.equal(coolNew.colorMatch.enabled, true);
  assert.ok(coolNew.fx.temperature > 0.2);

  // Adjusting match intensity scales adjustments smoothly
  const temp80 = coolNew.fx.temperature;
  assert.equal(setLayerColorMatchIntensity(coolNew, 0.4), true);
  assert.ok(coolNew.fx.temperature > 0 && coolNew.fx.temperature < temp80);

  // Toggling Color Match OFF restores baseFx; toggling ON re-applies
  assert.equal(toggleLayerColorMatch(coolNew, false), true);
  assert.equal(coolNew.fx.temperature, 0);
  assert.equal(coolNew.fx.contrast, 1.1);
  assert.equal(toggleLayerColorMatch(coolNew, true), true);
  assert.ok(coolNew.fx.temperature > 0);
});

test('CapCut-style Main Track magnetic timeline: append, Z-order, ripple delete/trim, reorder, split & role switch', () => {
  const proj = createEmptyProject('CapCutTL', { width: 1080, height: 1920, fps: 30, durationSec: 15 });
  assert.equal(proj.settings.rippleMode, true);
  assert.equal(proj.settings.autoColorMatch, true);

  const m1 = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'Clip 1', type: 'video', width: 1080, height: 1920, durationMs: 2000 }, 0); // 60f
  const m2 = TimelineEngine.createMediaLayer(proj, { id: 'v2', name: 'Clip 2', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 0); // 90f
  const m3 = TimelineEngine.createMediaLayer(proj, { id: 'v3', name: 'Clip 3', type: 'image', width: 1080, height: 1920, durationMs: 1000 }, 0); // 30f

  TimelineEngine.addToMainTrack(proj, m1);
  TimelineEngine.addToMainTrack(proj, m2);
  TimelineEngine.addToMainTrack(proj, m3);

  // Add independent Overlay (PiP) + Audio track
  const pip = TimelineEngine.createMediaLayer(proj, { id: 'p1', name: 'PiP', type: 'image', width: 400, height: 400, durationMs: 2000 }, 30, { trackRole: 'overlay' });
  TimelineEngine.addLayer(proj, pip);
  const audio = TimelineEngine.createMediaLayer(proj, { id: 'a1', name: 'BGM', type: 'audio', durationMs: 4000 }, 15);
  TimelineEngine.addLayer(proj, audio);
  TimelineEngine.normalizeTrackZOrder(proj);

  // Verify zero-gap contiguous placement: m1 [0..60], m2 [60..150], m3 [150..180]
  assert.equal(m1.startFrame, 0); assert.equal(m1.endFrame, 60);
  assert.equal(m2.startFrame, 60); assert.equal(m2.endFrame, 150);
  assert.equal(m3.startFrame, 150); assert.equal(m3.endFrame, 180);

  // Z-order: Overlay sits above Main Track, Audio sits below Main Track
  const pipIdx = proj.layers.indexOf(pip);
  const m1Idx = proj.layers.indexOf(m1);
  const audIdx = proj.layers.indexOf(audio);
  assert.ok(pipIdx < m1Idx && m1Idx < audIdx, `Expected overlay(${pipIdx}) < main(${m1Idx}) < audio(${audIdx})`);

  // Keyframe on m3 shifts along with m3 during magnetic trim/delete
  KeyframeEngine.setKeyframe(m3, 'x', 160, 50, 'linear');

  // Magnetic right-edge trim of m1 from 60 -> 90 ripples m2 [90..180] and m3 [180..210] (+30f)
  TimelineEngine.trimMainOrClip(proj, m1.id, 'right', 90, false, 0);
  assert.equal(m1.endFrame, 90);
  assert.equal(m2.startFrame, 90); assert.equal(m2.endFrame, 180);
  assert.equal(m3.startFrame, 180); assert.equal(m3.endFrame, 210);
  assert.equal(m3.keyframes.x[0].frame, 190);
  assert.equal(pip.startFrame, 30); // Overlay stays pinned independently!

  // Horizontal drag-to-reorder: drag m3 past m1's center toward frame 5 => order becomes [m3, m1, m2]
  assert.equal(TimelineEngine.reorderMainTrackClipByFrame(proj, m3.id, 5), true);
  assert.deepEqual(TimelineEngine.getMainTrackClips(proj).map((c) => c.id), [m3.id, m1.id, m2.id]);
  assert.equal(m3.startFrame, 0); assert.equal(m3.endFrame, 30);
  assert.equal(m1.startFrame, 30); assert.equal(m1.endFrame, 120);
  assert.equal(m2.startFrame, 120); assert.equal(m2.endFrame, 210);

  // Split m1 [30..120] at 75 => right half inherits trackRole: 'main', and Main Track stays separated from PiP seams
  const m1Right = TimelineEngine.splitClipAtFrame(proj, m1.id, 75);
  assert.ok(m1Right);
  assert.equal(m1Right.trackRole, 'main');
  const junctions = TimelineEngine.findTransitionJunctions(proj);
  assert.ok(junctions.some((j) => j.leftId === m1.id && j.rightId === m1Right.id && j.seamFrame === 75));
  assert.ok(!junctions.some((j) => j.leftId === pip.id || j.rightId === pip.id));

  // Switch m1Right from Main Track -> Overlay closes its gap magnetically without shifting PiP
  assert.equal(TimelineEngine.switchLayerTrackRole(proj, m1Right.id, 'overlay'), true);
  assert.equal(m1Right.trackRole, 'overlay');
  assert.deepEqual(TimelineEngine.getMainTrackClips(proj).map((c) => c.id), [m3.id, m1.id, m2.id]);
  assert.equal(m2.startFrame, 75); assert.equal(m2.endFrame, 165);

  // Switch m1Right back Overlay -> Main Track appends it cleanly to end [165..210]
  assert.equal(TimelineEngine.switchLayerTrackRole(proj, m1Right.id, 'main'), true);
  assert.equal(m1Right.trackRole, 'main');
  assert.equal(m1Right.startFrame, 165); assert.equal(m1Right.endFrame, 210);

  // Magnetic delete of m1 closes gap for m2 [30..120] and m1Right [120..165]
  assert.equal(TimelineEngine.deleteMainOrLayer(proj, m1.id), true);
  assert.equal(m2.startFrame, 30); assert.equal(m2.endFrame, 120);
  assert.equal(m1Right.startFrame, 120); assert.equal(m1Right.endFrame, 165);

  // Turning rippleMode OFF allows deleting m2 while leaving an intentional gap [30..120]
  proj.settings.rippleMode = false;
  assert.equal(TimelineEngine.deleteMainOrLayer(proj, m2.id), true);
  assert.equal(m1Right.startFrame, 120);
  // Closing gaps via reflowMainTrack packs remaining clips [m3: 0..30, m1Right: 30..75]
  TimelineEngine.reflowMainTrack(proj, 0);
  assert.equal(m1Right.startFrame, 30); assert.equal(m1Right.endFrame, 75);
});

test('Timeline items extend beyond duration, trim/delete split Left & Right at playhead, and 2D drag & drop across tracks', () => {
  const proj = createEmptyProject('ExtendDrop', { width: 1080, height: 1920, fps: 30, durationSec: 5 }); // 150f initial
  const v1 = TimelineEngine.createMediaLayer(proj, { id: 'vid1', name: 'V1', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 0); // 90f
  const txt = TimelineEngine.createTextLayer(proj, 15); // [15..105]
  const aud = TimelineEngine.createMediaLayer(proj, { id: 'aud1', name: 'Music', type: 'audio', durationMs: 2000 }, 0); // [0..60]
  const ovl = TimelineEngine.createMediaLayer(proj, { id: 'ovl1', name: 'PiP', type: 'image', width: 400, height: 400, durationMs: 2000 }, 20, { trackRole: 'overlay' });

  TimelineEngine.addToMainTrack(proj, v1);
  TimelineEngine.addLayer(proj, txt);
  TimelineEngine.addLayer(proj, aud);
  TimelineEngine.addLayer(proj, ovl);
  TimelineEngine.normalizeTrackZOrder(proj);

  // 1. Extending any item type past project duration expands durationFrames smoothly
  TimelineEngine.trimMainOrClip(proj, txt.id, 'right', 210, false, 0);
  assert.equal(txt.endFrame, 210);
  assert.ok(proj.durationFrames >= 210);
  TimelineEngine.trimMainOrClip(proj, aud.id, 'right', 240, false, 0);
  assert.equal(aud.endFrame, 240);
  assert.ok(proj.durationFrames >= 240);

  // 2. Delete Left inside clip trims head, preserves mediaOffsetFrames & boundary keyframe, ripples Main Track
  const v2 = TimelineEngine.createMediaLayer(proj, { id: 'vid2', name: 'V2', type: 'video', width: 1080, height: 1920, durationMs: 2000 }, 0); // 60f -> [90..150]
  TimelineEngine.addToMainTrack(proj, v2);
  KeyframeEngine.setKeyframe(v1, 'x', 0, 10, 'linear');
  KeyframeEngine.setKeyframe(v1, 'x', 90, 100, 'linear');
  const trimLeftRes = TimelineEngine.trimDeleteSideAtPlayhead(proj, v1.id, 'left', 30);
  assert.ok(trimLeftRes && trimLeftRes.action === 'trimmed_left');
  assert.equal(v1.mediaOffsetFrames, 30);
  assert.equal(v1.startFrame, 0); // Reflowed flush to 0 on Magnetic Main Track
  assert.equal(v1.endFrame, 60);
  assert.equal(v2.startFrame, 60);
  assert.equal(v1.keyframes.x[0].frame, 0);

  // 3. Delete Right inside text clip trims tail cleanly
  const trimRightRes = TimelineEngine.trimDeleteSideAtPlayhead(proj, txt.id, 'right', 120);
  assert.ok(trimRightRes && trimRightRes.action === 'trimmed_right');
  assert.equal(txt.endFrame, 120);

  // 4. Split v2 [60..120] at 90, then Del Left at seam deletes left piece (v2) and keeps right piece flush
  const v2Right = TimelineEngine.splitClipAtFrame(proj, v2.id, 90);
  assert.ok(v2Right);
  const delSeamLeft = TimelineEngine.trimDeleteSideAtPlayhead(proj, v2Right.id, 'left', 90);
  assert.ok(delSeamLeft && delSeamLeft.action === 'deleted_left');
  assert.equal(proj.layers.some((l) => l.id === v2.id), false);
  assert.equal(v2Right.startFrame, 60);
  assert.equal(v2Right.endFrame, 90);

  // 5. Split text [15..120] at 60, then Del Right at seam deletes right piece (txtRight) cleanly
  const txtRight = TimelineEngine.splitClipAtFrame(proj, txt.id, 60);
  assert.ok(txtRight);
  const delSeamRight = TimelineEngine.trimDeleteSideAtPlayhead(proj, txtRight.id, 'right', 60);
  assert.ok(delSeamRight && delSeamRight.action === 'deleted_right');
  assert.equal(proj.layers.some((l) => l.id === txtRight.id), false);
  assert.equal(txt.endFrame, 60);

  // 6. 2D Drag & Drop: drag Overlay (ovl) onto Main Track at slot 0 (before v1), then drag v2Right to Overlay
  assert.equal(
    TimelineEngine.dropLayerInTimeline(proj, ovl.id, { targetRole: 'main', targetStartFrame: 0, dragCenterFrame: 5 }),
    true
  );
  assert.equal(ovl.trackRole, 'main');
  assert.deepEqual(TimelineEngine.getMainTrackClips(proj).map((c) => c.id), [ovl.id, v1.id, v2Right.id]);
  assert.equal(
    TimelineEngine.dropLayerInTimeline(proj, v2Right.id, { targetRole: 'overlay', targetStartFrame: 45 }),
    true
  );
  assert.equal(v2Right.trackRole, 'overlay');
  assert.equal(v2Right.startFrame, 45);
});

test('Clip anatomy badges, duration delta formatting (+00:02.3), and left/right corner duration extension', () => {
  assert.equal(formatDurationShort(69, 30), '00:02.3');
  assert.equal(formatSignedDurationDelta(69, 30), '+00:02.3');
  assert.equal(formatSignedDurationDelta(-36, 30), '-00:01.2');

  const proj = createEmptyProject('BadgeTest', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const clip = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'Hero', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 30);
  clip.speed = 2.0;
  clip.vfx.type = 'glitch';
  clip.reversed = true;
  clip.audioProps.muted = true;
  KeyframeEngine.setKeyframe(clip, 'x', 45, 120, 'linear');
  TimelineEngine.addLayer(proj, clip);

  const badges = getClipStatusBadges(clip);
  const kinds = badges.map((b) => b.kind);
  assert.ok(kinds.includes('speed'));
  assert.equal(badges.find((b) => b.kind === 'speed').text, '×2');
  assert.ok(kinds.includes('fx'));
  assert.ok(kinds.includes('keyframe'));
  assert.ok(kinds.includes('mute'));
  assert.ok(kinds.includes('reverse'));

  // Left-corner drag left extends overlay clip startFrame from 30 -> 10 (+20f duration)
  TimelineEngine.trimMainOrClip(proj, clip.id, 'left', 10, false, 0);
  assert.equal(clip.startFrame, 10);
  assert.equal(clip.endFrame - clip.startFrame, 110);

  // Right-corner drag right extends endFrame from 120 -> 189 (+69f = +00:02.3)
  TimelineEngine.trimMainOrClip(proj, clip.id, 'right', 189, false, 0);
  assert.equal(clip.endFrame, 189);
  assert.equal(clip.endFrame - clip.startFrame, 179);

  // Magnetic Main Track clip at frame 0 can also extend via left-corner drag left
  const mainClip = TimelineEngine.createMediaLayer(proj, { id: 'v2', name: 'Main1', type: 'video', width: 1080, height: 1920, durationMs: 2000 }, 0);
  TimelineEngine.addToMainTrack(proj, mainClip);
  TimelineEngine.trimMainOrClip(proj, mainClip.id, 'left', -30, false, 0);
  assert.equal(mainClip.startFrame, 0);
  assert.equal(mainClip.endFrame, 90);
});

test('Adaptive dynamic ruler ticks keep clean label & minor tick spacing across zoom levels', () => {
  for (const fps of [30, 60]) {
    for (const px of [0.25, 1.15, 2.0, 5.0, 32.0]) {
      const spec = computeDynamicRulerTicks(px, fps);
      assert.ok(spec.labelFrames >= 1);
      assert.ok(spec.minorFrames >= 1 && spec.minorFrames <= spec.labelFrames);
      assert.ok(spec.majorFrames >= spec.labelFrames);
      const minExpectedPx = spec.labelFrames < fps ? 42 : 48;
      if (spec.labelFrames < fps * 600) {
        assert.ok(spec.labelFrames * px >= minExpectedPx, `Expected label spacing >= ${minExpectedPx}px at px=${px}, fps=${fps}, got ${spec.labelFrames * px}`);
      }
      if (spec.minorFrames < spec.labelFrames) {
        assert.ok(spec.minorFrames * px >= 8, `Expected minor tick spacing >= 8px, got ${spec.minorFrames * px}`);
      }
    }
  }
  const zoomedOut = computeDynamicRulerTicks(0.25, 30);
  const zoomedIn = computeDynamicRulerTicks(32.0, 30);
  assert.ok(zoomedOut.labelFrames > zoomedIn.labelFrames);
  assert.equal(zoomedIn.showSubFrames, true);
  assert.equal(zoomedOut.showSubFrames, false);
});

test('Per-track lock/hide/mute/compact state, Main Track compact persistence, and Adjustment Layer Z-order/FX rules', () => {
  const proj = createEmptyProject('StackAdjustTest', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  assert.equal(proj.settings.mainTrackCompact, false);

  const m1 = TimelineEngine.createMediaLayer(proj, { id: 'm1', name: 'MainClip', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 0);
  TimelineEngine.addToMainTrack(proj, m1);

  const aud = TimelineEngine.createMediaLayer(proj, { id: 'a1', name: 'BGM', type: 'audio', durationMs: 4000 }, 0);
  TimelineEngine.addLayer(proj, aud);

  const pip = TimelineEngine.createMediaLayer(proj, { id: 'p1', name: 'PiP', type: 'image', width: 400, height: 400, durationMs: 2000 }, 15, { trackRole: 'overlay' });
  TimelineEngine.addLayer(proj, pip);

  const adj = TimelineEngine.createAdjustmentLayer(proj, 10);
  adj.fx.filterPreset = 'vintage';
  adj.fx.contrast = 1.35;
  TimelineEngine.addLayer(proj, adj);

  TimelineEngine.normalizeTrackZOrder(proj);

  // Adjustment & overlay tracks sit above Main Track in project.layers, while audio sits below Main Track
  const adjIdx = proj.layers.findIndex((l) => l.id === adj.id);
  const pipIdx = proj.layers.findIndex((l) => l.id === pip.id);
  const mainIdx = proj.layers.findIndex((l) => l.id === m1.id);
  const audIdx = proj.layers.findIndex((l) => l.id === aud.id);
  assert.ok(adjIdx < mainIdx, 'Adjustment layer should appear above main track');
  assert.ok(pipIdx < mainIdx, 'Overlay PiP should appear above main track');
  assert.ok(mainIdx < audIdx, 'Audio track should appear below main track');

  // Toggle compact height, lock, visibility, and mute flags + serialize/deserialize roundtrip
  adj.trackCompact = true;
  pip.locked = true;
  pip.visible = false;
  aud.audioProps.muted = true;
  proj.settings.mainTrackCompact = true;

  const restored = deserializeProject(JSON.parse(JSON.stringify(proj)));
  assert.equal(restored.settings.mainTrackCompact, true);
  assert.equal(restored.layers.find((l) => l.id === adj.id).trackCompact, true);
  assert.equal(restored.layers.find((l) => l.id === pip.id).locked, true);
  assert.equal(restored.layers.find((l) => l.id === pip.id).visible, false);
  assert.equal(restored.layers.find((l) => l.id === aud.id).audioProps.muted, true);

  // Split & trim works cleanly on Adjustment Layer
  const adjRight = TimelineEngine.splitClipAtFrame(restored, adj.id, 45);
  assert.ok(adjRight);
  assert.equal(adjRight.type, 'adjustment');
  assert.equal(adjRight.startFrame, 45);
  TimelineEngine.trimMainOrClip(restored, adjRight.id, 'right', 150, false, 0);
  assert.equal(adjRight.endFrame, 150);

  // Bulk applyFilterAndAdjustToAll updates visual clips but preserves adjustment layers' independent FX
  const srcClip = restored.layers.find((l) => l.id === m1.id);
  srcClip.fx.brightness = 0.25;
  srcClip.fx.filterPreset = 'cool';
  TimelineEngine.applyFilterAndAdjustToAll(restored, srcClip);
  assert.equal(restored.layers.find((l) => l.id === pip.id).fx.brightness, 0.25);
  assert.equal(restored.layers.find((l) => l.id === adj.id).fx.filterPreset, 'vintage');
  assert.equal(restored.layers.find((l) => l.id === adj.id).fx.contrast, 1.35);
});

test('Timeline snapping (move & trim) attaches to clip edges, playhead, markers & beat markers, with magnet/modifier bypass and edge auto-scroll', () => {
  const proj = createEmptyProject('SnapAutoScroll', { width: 1080, height: 1920, fps: 30, durationSec: 12 });
  assert.equal(isSnapActive(proj, false), true);
  assert.equal(isSnapActive(proj, true), false);

  // Add reference clip [60..120], timeline marker @ 180, beat marker @ 240, moving overlay clip [0..30]
  const refClip = TimelineEngine.createShapeLayer(proj, 'rectangle', 60);
  refClip.startFrame = 60;
  refClip.endFrame = 120;
  TimelineEngine.addLayer(proj, refClip);

  const movClip = TimelineEngine.createShapeLayer(proj, 'circle', 0);
  movClip.startFrame = 0;
  movClip.endFrame = 30;
  TimelineEngine.addLayer(proj, movClip);

  assert.equal(TimelineEngine.toggleTimelineMarker(proj, 180, 'Hook'), true);
  assert.equal(TimelineEngine.toggleBeatMarker(proj, 240), true);
  assert.equal(proj.markers.length, 1);
  assert.equal(proj.markers[0].frame, 180);

  // Serialization preserves markers cleanly
  const rehydrated = deserializeProject(JSON.parse(JSON.stringify(proj)));
  assert.equal(rehydrated.markers.length, 1);
  assert.equal(rehydrated.markers[0].frame, 180);

  // 1. Move clip start snaps to another clip's endEdge (120)
  const snapClipEnd = TimelineEngine.moveClip(rehydrated, movClip.id, 118, true, 15, 4);
  assert.equal(snapClipEnd.startFrame, 120);
  assert.equal(snapClipEnd.snapInfo.kind, 'clip');

  // 2. Move clip tail snaps to another clip's startEdge (60 -> movClip becomes [30..60])
  const snapClipStartViaTail = TimelineEngine.moveClip(rehydrated, movClip.id, 32, true, 15, 4);
  assert.equal(snapClipStartViaTail.startFrame, 30);
  assert.equal(snapClipStartViaTail.endFrame, 60);
  assert.equal(snapClipStartViaTail.snapInfo.kind, 'clip');

  // 3. Move clip snaps to Playhead (F150)
  const snapPlayhead = TimelineEngine.moveClip(rehydrated, movClip.id, 148, true, 150, 4);
  assert.equal(snapPlayhead.startFrame, 150);
  assert.equal(snapPlayhead.snapInfo.kind, 'playhead');

  // 4. Move clip snaps to Timeline Marker (F180)
  const snapMarker = TimelineEngine.moveClip(rehydrated, movClip.id, 183, true, 0, 4);
  assert.equal(snapMarker.startFrame, 180);
  assert.equal(snapMarker.snapInfo.kind, 'marker');

  // 5. Move clip snaps to Beat Marker (F240)
  const snapBeat = TimelineEngine.moveClip(rehydrated, movClip.id, 237, true, 0, 4);
  assert.equal(snapBeat.startFrame, 240);
  assert.equal(snapBeat.snapInfo.kind, 'beat');

  // 6. Trimming right & left edges snap to clip edges, markers, beats, and playhead
  const mov = rehydrated.layers.find((l) => l.id === movClip.id);
  TimelineEngine.moveClip(rehydrated, mov.id, 130, false, 0, 4); // [130..160]
  const trimRightToMarker = TimelineEngine.trimMainOrClip(rehydrated, mov.id, 'right', 178, true, 0, 4);
  assert.equal(mov.endFrame, 180);
  assert.equal(trimRightToMarker.snapInfo.kind, 'marker');

  const trimRightToBeat = TimelineEngine.trimMainOrClip(rehydrated, mov.id, 'right', 243, true, 0, 4);
  assert.equal(mov.endFrame, 240);
  assert.equal(trimRightToBeat.snapInfo.kind, 'beat');

  const trimLeftToClipEdge = TimelineEngine.trimMainOrClip(rehydrated, mov.id, 'left', 122, true, 0, 4);
  assert.equal(mov.startFrame, 120);
  assert.equal(trimLeftToClipEdge.snapInfo.kind, 'clip');

  const trimLeftToPlayhead = TimelineEngine.trimMainOrClip(rehydrated, mov.id, 'left', 148, true, 150, 4);
  assert.equal(mov.startFrame, 150);
  assert.equal(trimLeftToPlayhead.snapInfo.kind, 'playhead');

  // 7. Global toggle OFF or Modifier held disables snapping temporarily
  rehydrated.settings.snapToTimeline = false;
  assert.equal(isSnapActive(rehydrated, false), false);
  TimelineEngine.moveClip(rehydrated, mov.id, 178, isSnapActive(rehydrated, false), 0, 4);
  assert.equal(mov.startFrame, 178);

  rehydrated.settings.snapToTimeline = true;
  assert.equal(isSnapActive(rehydrated, true), false);
  TimelineEngine.trimMainOrClip(rehydrated, mov.id, 'right', 238, isSnapActive(rehydrated, true), 0, 4);
  assert.equal(mov.endFrame, 238);

  // 8. Edge auto-scroll velocity calculation for left/right drag edges
  assert.equal(computeEdgeAutoScrollDelta(250, 100, 460, 0), 0); // Safe center
  assert.equal(computeEdgeAutoScrollDelta(105, 100, 460, 0), 0); // Left edge but scrollLeft is 0
  assert.ok(computeEdgeAutoScrollDelta(105, 100, 460, 80) < 0); // Left edge scrolls backward
  assert.equal(computeEdgeAutoScrollDelta(105, 100, 460, 3), -3); // Clamped to remaining scrollLeft
  assert.ok(computeEdgeAutoScrollDelta(455, 100, 460, 40) > 0); // Right edge scrolls forward
});

test('Per-property keyframe lanes (position, scale, rotation, opacity, volume, color), individual move/delete/easing, and combinable In/Out presets', () => {
  // 1. Hex normalization & RGB color interpolation
  assert.equal(normalizeHexColor('#f0a'), '#ff00aa');
  assert.equal(normalizeHexColor('invalid', '#123456'), '#123456');
  assert.equal(lerpColorHex('#000000', '#ffffff', 0.5), '#808080');

  // Verify all 6 requested property lane groups exist
  assert.deepEqual(
    KEYFRAME_LANE_GROUPS.map((g) => g.key),
    ['position', 'scale', 'rotation', 'opacity', 'volume', 'color']
  );

  const proj = createEmptyProject('KfLanes', { width: 1080, height: 1920, fps: 30, durationSec: 10 });
  const textLayer = TimelineEngine.createTextLayer(proj, 0); // [0..90]
  textLayer.endFrame = 90;
  const audioLayer = TimelineEngine.createMediaLayer(proj, { id: 'a1', name: 'Music', type: 'audio', durationMs: 3000 }, 0);
  const adjLayer = TimelineEngine.createAdjustmentLayer(proj, 0);
  const videoLayer = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'Clip', type: 'video', width: 1080, height: 1920, durationMs: 3000 }, 0);

  // 2. Visible keyframe lanes adapt by track type
  assert.deepEqual(KeyframeEngine.getVisibleKeyframeLanes(audioLayer).map((g) => g.key), ['volume']);
  assert.deepEqual(KeyframeEngine.getVisibleKeyframeLanes(adjLayer).map((g) => g.key), ['opacity', 'color']);
  assert.deepEqual(
    KeyframeEngine.getVisibleKeyframeLanes(videoLayer).map((g) => g.key),
    ['position', 'scale', 'rotation', 'opacity', 'volume', 'color']
  );

  // 3. Color keyframing linear vs easeInOut interpolation
  KeyframeEngine.setKeyframe(textLayer, 'color', 0, '#ff0000', 'linear');
  KeyframeEngine.setKeyframe(textLayer, 'color', 30, '#0000ff', 'easeInOut');
  assert.equal(KeyframeEngine.getColorAtFrame(textLayer, 15, '#ffffff'), '#800080');
  assert.equal(KeyframeEngine.getValueAtFrame(textLayer, 'color', 30, '#ffffff'), '#0000ff');

  // 4. Moving one property lane diamond ONLY shifts that property group, keeping sibling properties at same frame intact
  KeyframeEngine.setKeyframe(videoLayer, 'x', 20, 100, 'linear');
  KeyframeEngine.setKeyframe(videoLayer, 'y', 20, -40, 'linear');
  KeyframeEngine.setKeyframe(videoLayer, 'opacity', 20, 0.5, 'easeOut');
  KeyframeEngine.setKeyframe(videoLayer, 'opacity', 60, 1.0, 'linear');

  const movedPos = KeyframeEngine.movePropGroupKeyframe(videoLayer, ['x', 'y', 'z'], 20, 45);
  assert.equal(movedPos, true);
  assert.equal(videoLayer.keyframes.x[0].frame, 45);
  assert.equal(videoLayer.keyframes.y[0].frame, 45);
  assert.equal(videoLayer.keyframes.opacity[0].frame, 20); // Opacity stayed at F20!

  // 5. Easing switching & 1-by-1 deletion per property group
  assert.equal(KeyframeEngine.setPropGroupEasing(videoLayer, ['opacity'], 20, 'linear'), true);
  assert.equal(videoLayer.keyframes.opacity[0].easing, 'linear');
  assert.equal(KeyframeEngine.removePropGroupKeyframe(videoLayer, ['opacity'], 20), true);
  assert.equal(videoLayer.keyframes.opacity.length, 1);
  assert.equal(videoLayer.keyframes.opacity[0].frame, 60);

  // Toggle lane keyframe at playhead (adds then removes cleanly)
  const togAdd = KeyframeEngine.togglePropLaneKeyframeAtFrame(audioLayer, 'volume', 35, 'easeInOut');
  assert.equal(togAdd.added, true);
  assert.equal(audioLayer.keyframes.volume.length, 1);
  const togDel = KeyframeEngine.togglePropLaneKeyframeAtFrame(audioLayer, 'volume', 35, 'easeInOut');
  assert.equal(togDel.added, false);
  assert.equal(audioLayer.keyframes.volume.length, 0);

  // 6. Presets = ready-to-use keyframes: In + Out presets combine cleanly and stay individually editable/deletable
  KeyframeEngine.applyPreset(textLayer, 'fadeIn', proj.width, proj.height, 20);
  KeyframeEngine.applyPreset(textLayer, 'slideOutRight', proj.width, proj.height, 20);
  assert.equal(textLayer.presetInId, 'fadeIn');
  assert.equal(textLayer.presetOutId, 'slideOutRight');
  assert.equal(textLayer.keyframes.opacity.length, 2); // F0=0, F20=1
  assert.equal(textLayer.keyframes.x.length, 2); // F70=base, F90=+width*0.65
  assert.equal(textLayer.keyframes.opacity[0].presetTag, 'in');
  assert.equal(textLayer.keyframes.x[0].presetTag, 'out');

  // Preset keyframes can be moved/deleted individually on timeline lanes
  assert.equal(KeyframeEngine.movePropGroupKeyframe(textLayer, ['x', 'y', 'z'], 70, 65), true);
  assert.equal(textLayer.keyframes.x[0].frame, 65);
  assert.equal(KeyframeEngine.removePropGroupKeyframe(textLayer, ['opacity'], 0), true);
  assert.equal(textLayer.keyframes.opacity.length, 1);

  // Clearing In preset removes only remaining 'in' keyframes, preserving Out preset ('slideOutRight')
  KeyframeEngine.clearPresetCategory(textLayer, 'in');
  assert.equal(textLayer.presetInId, null);
  assert.equal(textLayer.keyframes.opacity.length, 0);
  assert.equal(textLayer.presetOutId, 'slideOutRight');
  assert.equal(textLayer.keyframes.x.length, 2);
});

test('Stacked VFX + Adjustment Layer badges, custom speed curves, multi-select clipboard, cut points/markers, symmetric transitions, and auto-reframe', () => {
  const proj = createEmptyProject('CapCutAudit', { width: 1080, height: 1920, fps: 30, durationSec: 12 });
  const v1 = TimelineEngine.createMediaLayer(proj, { id: 'm1', name: 'Clip 1', type: 'video', width: 1920, height: 1080, durationMs: 4000 }, 0);
  v1.trackRole = 'main';
  v1.startFrame = 0;
  v1.endFrame = 120;
  const v2 = TimelineEngine.createMediaLayer(proj, { id: 'm2', name: 'Clip 2', type: 'video', width: 1920, height: 1080, durationMs: 4000 }, 120);
  v2.trackRole = 'main';
  v2.startFrame = 120;
  v2.endFrame = 240;
  const adj = TimelineEngine.createAdjustmentLayer(proj, 30);
  adj.startFrame = 30;
  adj.endFrame = 150;
  TimelineEngine.addLayer(proj, v1);
  TimelineEngine.addLayer(proj, v2);
  TimelineEngine.addLayer(proj, adj);

  // 1. Stacked VFX & numeric status badge on clip and adjustment layer
  TimelineEngine.setPrimaryLayerVfx(v1, 'bloom', 0.8, 1.0);
  const addedFx = TimelineEngine.addLayerVfx(v1, 'chromatic', 0.6, 1.2);
  assert.ok(addedFx && addedFx.id);
  v1.filterId = 'vivid';
  assert.equal(TimelineEngine.countActiveEffects(v1), 3);

  const badgesMulti = getClipStatusBadges(v1);
  const fxBadge = badgesMulti.find((b) => b.kind === 'fx');
  assert.ok(fxBadge && fxBadge.stacked === true && fxBadge.text === '3');

  // Toggle & remove from stack
  assert.equal(TimelineEngine.toggleLayerVfx(v1, addedFx.id), true);
  assert.equal(TimelineEngine.countActiveEffects(v1), 2);
  assert.equal(TimelineEngine.removeLayerVfx(v1, addedFx.id), true);
  assert.equal(TimelineEngine.getActiveVfxList(v1).length, 1);

  // Adjustment layer supports stacked effects & filter
  TimelineEngine.setPrimaryLayerVfx(adj, 'crt', 0.5, 1.0);
  TimelineEngine.addLayerVfx(adj, 'vignettePulse', 0.7, 1.5);
  assert.equal(TimelineEngine.countActiveEffects(adj), 2);
  const adjBadge = getClipStatusBadges(adj).find((b) => b.kind === 'fx');
  assert.ok(adjBadge && adjBadge.stacked === true && adjBadge.text === '2');

  // Copy/paste attributes preserves full stacked vfxStack
  const attrs = TimelineEngine.copyAttributesFromLayer(v1);
  assert.equal(TimelineEngine.pasteAttributesToLayer(v2, attrs), true);
  assert.equal(v2.filterId, 'vivid');
  assert.equal(TimelineEngine.getActiveVfxList(v2).length, 1);

  // 2. Custom Speed Curve bezier points & monotonic integration
  v1.speedCurve = 'custom';
  v1.customSpeedCurve = [[0, 1.0], [0.25, 2.5], [0.6, 0.4], [1, 1.2]];
  const pts = TimelineEngine.getLayerSpeedCurvePoints(v1);
  assert.equal(pts.length, 4);
  const midSpeed = TimelineEngine.evaluateLayerSpeedFactor(v1, 0.25);
  assert.ok(midSpeed > 1.8 && midSpeed <= 2.6, `Expected curve peak near 2.5, got ${midSpeed}`);
  let prevSrc = -1;
  for (let f = 0; f <= 120; f += 10) {
    const src = TimelineEngine.integrateSpeedCurveSourceFrames(v1, f);
    assert.ok(src >= prevSrc, `Expected monotonic source frame at ${f}, got ${src} < ${prevSrc}`);
    prevSrc = src;
  }

  // 3. Multi-select clipboard preserves relative frame offsets across selected layers
  const txt = TimelineEngine.createTextLayer(proj, 40);
  txt.startFrame = 40;
  txt.endFrame = 100;
  TimelineEngine.addLayer(proj, txt);
  const clipboard = TimelineEngine.cloneLayersForClipboard(proj, [v1.id, txt.id]);
  assert.equal(clipboard.length, 2);
  const pasted = TimelineEngine.pasteLayersAtFrame(proj, clipboard, 200);
  assert.equal(pasted.length, 2);
  const pastedV = pasted.find((l) => l.name.startsWith('Clip 1'));
  const pastedT = pasted.find((l) => l.type === 'text');
  assert.equal(pastedV.startFrame, 200);
  assert.equal(pastedT.startFrame, 240); // Preserved +40f offset!

  // Splitting caption/text layer creates two independent contiguous text clips
  const splitRight = TimelineEngine.splitClipAtFrame(proj, txt.id, 70);
  assert.ok(splitRight);
  assert.equal(txt.endFrame, 70);
  assert.equal(splitRight.startFrame, 70);
  assert.equal(splitRight.endFrame, 100);

  // 4. Cut points & colored markers
  const mkr = { id: 'mkr_test', frame: 85, color: '#38bdf8', label: 'Beat' };
  proj.markers.push(mkr);
  assert.equal(TimelineEngine.setMarkerColor(proj, 'mkr_test', '#f43f5e'), true);
  assert.equal(mkr.color, '#f43f5e');
  const cuts = TimelineEngine.getCutPointFrames(proj);
  assert.ok(cuts.includes(0) && cuts.includes(70) && cuts.includes(85) && cuts.includes(120) && cuts.includes(240));
  assert.equal(TimelineEngine.removeMarkerById(proj, 'mkr_test'), true);

  // 5. Center-pulled symmetric transition + horizontal resize
  assert.equal(TimelineEngine.applyTransitionBetweenClips(proj, v1.id, v2.id, 'crossfade', 30), true);
  assert.equal(v1.transitions.outType, 'crossfade');
  assert.equal(v2.transitions.inType, 'crossfade');
  assert.equal(v1.transitions.outFrames, 15);
  assert.equal(v2.transitions.inFrames, 15);
  assert.equal(TimelineEngine.resizeTransitionJunction(proj, v1.id, v2.id, 40), true);
  assert.equal(v1.transitions.outFrames, 20);
  assert.equal(v2.transitions.inFrames, 20);

  // 6. Auto Reframe fits 16:9 clip inside 9:16 canvas without black bars and supports dynamic pan
  assert.equal(TimelineEngine.applyAutoReframe(proj, v1, 'dynamic'), true);
  assert.ok(v1.transform.scaleX > 1.7, `Expected vertical cover scale > 1.7, got ${v1.transform.scaleX}`);
  assert.ok(Array.isArray(v1.keyframes.x) && v1.keyframes.x.length >= 2);
});

test('3-zone track enforcement, magnetic Main Track (zero gaps when ON, free gaps when OFF), and audio detach', () => {
  const proj = createEmptyProject('Zone & Magnet Rules');

  // 1. Main Track strictly accepts ONLY video & image; text/shape/audio are routed to their respective zones
  const txt = TimelineEngine.createTextLayer(proj, 0);
  const shp = TimelineEngine.createShapeLayer(proj, 'circle', 0);
  const aud = TimelineEngine.createMediaLayer(proj, { id: 'm_aud', name: 'BGM.mp3', type: 'audio', durationMs: 4000 }, 0);
  TimelineEngine.addToMainTrack(proj, txt);
  TimelineEngine.addToMainTrack(proj, shp);
  TimelineEngine.addToMainTrack(proj, aud);
  assert.equal(TimelineEngine.getMainTrackClips(proj).length, 0);
  assert.equal(txt.trackRole, 'overlay');
  assert.equal(shp.trackRole, 'overlay');
  assert.equal(aud.trackRole, null);

  // Attempting to drop text onto Main Track is rejected
  assert.equal(TimelineEngine.dropLayerInTimeline(proj, txt.id, { targetRole: 'main', dragCenterFrame: 0 }), false);
  assert.equal(txt.trackRole, 'overlay');

  // 2. Adding 3 visual clips to Main Track with Magnet ON (default) keeps them tightly contiguous with zero gaps
  const c1 = TimelineEngine.createMediaLayer(proj, { id: 'm1', name: 'Clip 1.mp4', type: 'video', durationMs: 3000, width: 1280, height: 720 }, 0);
  const c2 = TimelineEngine.createMediaLayer(proj, { id: 'm2', name: 'Photo 2.jpg', type: 'image', durationMs: 2000, width: 1280, height: 720 }, 0);
  const c3 = TimelineEngine.createMediaLayer(proj, { id: 'm3', name: 'Clip 3.mp4', type: 'video', durationMs: 2500, width: 1280, height: 720 }, 0);
  TimelineEngine.addToMainTrack(proj, c1);
  TimelineEngine.addToMainTrack(proj, c2);
  TimelineEngine.addToMainTrack(proj, c3);

  const mainOn = TimelineEngine.getMainTrackClips(proj);
  assert.equal(mainOn.length, 3);
  assert.equal(mainOn[0].startFrame, 0);
  assert.equal(mainOn[1].startFrame, mainOn[0].endFrame);
  assert.equal(mainOn[2].startFrame, mainOn[1].endFrame);

  // 3. Z-order places overlays on top, Main Track in center, audio at bottom
  const zones = proj.layers.map((l) => (l.type === 'audio' ? 'audio' : l.trackRole === 'main' ? 'main' : 'overlay'));
  const firstMainIdx = zones.indexOf('main');
  const lastMainIdx = zones.lastIndexOf('main');
  const firstAudioIdx = zones.indexOf('audio');
  assert.ok(zones.slice(0, firstMainIdx).every((z) => z === 'overlay'));
  assert.ok(zones.slice(firstMainIdx, lastMainIdx + 1).every((z) => z === 'main'));
  assert.ok(firstAudioIdx > lastMainIdx);
  assert.ok(zones.slice(firstAudioIdx).every((z) => z === 'audio'));

  // 4. Turning Magnet OFF allows creating empty space/gaps on Main Track without overlapping neighbors
  proj.settings.rippleMode = false;
  TimelineEngine.moveClip(proj, c3.id, c2.endFrame + 45, false, 0, 0);
  assert.equal(c3.startFrame, c2.endFrame + 45);
  // Attempting to drag c3 backwards into c2 while Magnet OFF prevents overlap on the single row
  TimelineEngine.moveClip(proj, c3.id, c2.endFrame - 20, false, 0, 0);
  assert.ok(c3.startFrame >= c2.endFrame || c3.endFrame <= c2.startFrame, 'Main Track clips should not overlap when Magnet is OFF');

  // Re-enabling Magnet closes gaps immediately via reflowMainTrack
  proj.settings.rippleMode = true;
  TimelineEngine.reflowMainTrack(proj, 0);
  const snappedMain = TimelineEngine.getMainTrackClips(proj);
  assert.equal(snappedMain[0].startFrame, 0);
  assert.equal(snappedMain[1].startFrame, snappedMain[0].endFrame);
  assert.equal(snappedMain[2].startFrame, snappedMain[1].endFrame);

  // 5. Detach Audio from video moves extracted audio to bottom Audio zone, copies speed curve, and mutes video
  c1.speedCurve = 'custom';
  c1.customSpeedCurve = [[0, 1.0], [0.5, 2.0], [1, 1.0]];
  const detached = TimelineEngine.detachAudioFromVideo(proj, c1.id);
  assert.ok(detached);
  assert.equal(detached.type, 'audio');
  assert.equal(detached.trackRole, null);
  assert.equal(detached.startFrame, c1.startFrame);
  assert.equal(detached.endFrame, c1.endFrame);
  assert.equal(detached.speedCurve, 'custom');
  assert.deepEqual(detached.customSpeedCurve, [[0, 1.0], [0.5, 2.0], [1, 1.0]]);
  assert.equal(c1.audioProps.muted, true);
  assert.equal(c1.audioDetached, true);
  assert.ok(proj.layers.indexOf(detached) > proj.layers.indexOf(c1));
});

import { Mat4 } from '../src/main/assets/www/js/utils/mat4.js';

test('Mat4.ortho builds valid flat 2D orthographic projection matrix', () => {
  const m = Mat4.ortho(-640, 640, -360, 360, -1000, 1000);
  assert.equal(m.length, 16);
  // Center maps to (0, 0) and (+640, +360) maps to (+1, +1)
  assert.ok(Math.abs(m[0] * 640 - 1) < 1e-6);
  assert.ok(Math.abs(m[5] * 360 - 1) < 1e-6);
  assert.equal(m[15], 1);
});

test('TimelineEngine Filter and Effect adjustment items manage timeline visibility spans and badges', () => {
  const proj = createEmptyProject('FilterEffectTimeline', { width: 1280, height: 720, fps: 30, durationSec: 10 });
  const mainVid = TimelineEngine.createMediaLayer(proj, { id: 'v1', name: 'Clip', type: 'video', width: 1280, height: 720, durationMs: 5000 }, 0);
  TimelineEngine.addToMainTrack(proj, mainVid);

  const filterItem = TimelineEngine.createAdjustmentLayer(proj, 15, {
    adjustmentKind: 'filter',
    name: 'Filter: Cinema',
    durationFrames: 45,
    filterId: 'cinema',
    filterIntensity: 0.9
  });
  TimelineEngine.addLayer(proj, filterItem);

  const effectItem = TimelineEngine.createAdjustmentLayer(proj, 30, {
    adjustmentKind: 'effect',
    name: 'FX: Shake',
    durationFrames: 60,
    vfx: { type: 'shake', intensity: 0.8, speed: 1.2 }
  });
  TimelineEngine.setPrimaryLayerVfx(effectItem, 'shake', 0.8, 1.2);
  TimelineEngine.addLayer(proj, effectItem);
  TimelineEngine.normalizeTrackZOrder(proj);

  assert.equal(filterItem.adjustmentKind, 'filter');
  assert.equal(filterItem.startFrame, 15);
  assert.equal(filterItem.endFrame, 60);
  assert.equal(effectItem.adjustmentKind, 'effect');
  assert.equal(effectItem.startFrame, 30);
  assert.equal(effectItem.endFrame, 90);
  assert.equal(effectItem.vfxStack[0].type, 'shake');

  // Filter & Effect timeline items sit above main track in overlay zone
  assert.ok(proj.layers.indexOf(filterItem) < proj.layers.indexOf(mainVid));
  assert.ok(proj.layers.indexOf(effectItem) < proj.layers.indexOf(mainVid));

  // Trim/extend filter item start and end safely
  TimelineEngine.trimMainOrClip(proj, filterItem.id, 'left', 5, false, 0, 0);
  TimelineEngine.trimMainOrClip(proj, filterItem.id, 'right', 90, false, 0, 0);
  assert.equal(filterItem.startFrame, 5);
  assert.equal(filterItem.endFrame, 90);

  const fBadges = getClipStatusBadges(filterItem);
  assert.ok(fBadges.some((b) => b.kind === 'filter'));
  const eBadges = getClipStatusBadges(effectItem);
  assert.ok(eBadges.some((b) => b.kind === 'fx'));
});

test('KeyframeEngine supports Hold step easing for numbers & colors plus Prev/Next navigation', () => {
  assert.ok(EASING_TYPES.some((e) => e.key === 'hold'));
  const proj = createEmptyProject('HoldNav', { width: 1280, height: 720, fps: 30, durationSec: 5 });
  const textLayer = TimelineEngine.createTextLayer(proj, 0);
  TimelineEngine.addLayer(proj, textLayer);

  KeyframeEngine.setKeyframe(textLayer, 'x', 0, 0, 'hold');
  KeyframeEngine.setKeyframe(textLayer, 'x', 30, 200, 'linear');
  KeyframeEngine.setKeyframe(textLayer, 'x', 60, 400, 'easeOut');

  assert.equal(KeyframeEngine.getValueAtFrame(textLayer, 'x', 0, 0), 0);
  assert.equal(KeyframeEngine.getValueAtFrame(textLayer, 'x', 29, 0), 0);
  assert.equal(KeyframeEngine.getValueAtFrame(textLayer, 'x', 30, 0), 200);
  assert.equal(KeyframeEngine.getValueAtFrame(textLayer, 'x', 45, 0), 300);

  KeyframeEngine.setKeyframe(textLayer, 'color', 10, '#ff0000', 'hold');
  KeyframeEngine.setKeyframe(textLayer, 'color', 40, '#00ff00', 'linear');
  assert.equal(KeyframeEngine.getColorAtFrame(textLayer, 25, '#ffffff'), '#ff0000');
  assert.equal(KeyframeEngine.getColorAtFrame(textLayer, 40, '#ffffff'), '#00ff00');

  const frames = KeyframeEngine.getAllKeyframeFrames(textLayer);
  assert.deepEqual(frames, [0, 10, 30, 40, 60]);
  assert.equal(KeyframeEngine.getPrevKeyframeFrame(frames, 30), 10);
  assert.equal(KeyframeEngine.getPrevKeyframeFrame(frames, 0), null);
  assert.equal(KeyframeEngine.getNextKeyframeFrame(frames, 30), 40);
  assert.equal(KeyframeEngine.getNextKeyframeFrame(frames, 60), null);
});

test('KeyframeEngine strict 3D commitStaged3DLayerPose and commitStaged3DCameraPose (Rule of Two)', () => {
  const proj = createEmptyProject('Strict3D', { width: 1280, height: 720, fps: 30, durationSec: 5 });
  const clip = TimelineEngine.createShapeLayer(proj, 'rectangle', 10);
  clip.endFrame = 100;
  clip.transform.x = 25;
  clip.transform.z = 0;
  clip.transform.rotY = 0;
  TimelineEngine.addLayer(proj, clip);

  // Without explicit commit, clip location at any frame remains at initial 3D transform
  const beforeF50 = KeyframeEngine.getTransformAtFrame(clip, 50);
  assert.equal(beforeF50.x, 25);
  assert.equal(beforeF50.z, 0);
  assert.equal(beforeF50.rotY, 0);

  // Explicit Add Keyframe commits staged 3D pose at F50 AND anchors startFrame F10
  KeyframeEngine.commitStaged3DLayerPose(clip, 50, { z: -180, rotY: 42 }, 'easeInOut');
  assert.equal(KeyframeEngine.getTransformAtFrame(clip, 10).z, 0);
  assert.equal(KeyframeEngine.getTransformAtFrame(clip, 10).rotY, 0);
  assert.equal(KeyframeEngine.getTransformAtFrame(clip, 50).z, -180);
  assert.equal(KeyframeEngine.getTransformAtFrame(clip, 50).rotY, 42);
  assert.ok(KeyframeEngine.getTransformAtFrame(clip, 30).z < 0 && KeyframeEngine.getTransformAtFrame(clip, 30).z > -180);

  // Camera commit anchors F0 and keys target frame F40
  const cam = proj.camera;
  cam.rotY = 5;
  cam.z = 0;
  KeyframeEngine.commitStaged3DCameraPose(cam, 40, { rotY: -35, z: 220 }, 'smooth');
  assert.equal(KeyframeEngine.getCameraAtFrame(cam, 0).rotY, 5);
  assert.equal(KeyframeEngine.getCameraAtFrame(cam, 40).rotY, -35);
  assert.equal(KeyframeEngine.getCameraAtFrame(cam, 40).z, 220);
  assert.equal(KeyframeEngine.hasAnyCameraKeyframeAtFrame(cam, 0), true);
  assert.equal(KeyframeEngine.hasAnyCameraKeyframeAtFrame(cam, 40), true);
});

test('KeyframeEngine split & trim preserve scaleX/opacity defaults and segment easing, plus 3D lane toggle & intensity lane', () => {
  const proj = createEmptyProject('SplitTrimKf', { width: 1280, height: 720, fps: 30, durationSec: 6 });
  const clip = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clip.endFrame = 120;
  clip.transform.scaleX = 1.5;
  TimelineEngine.addLayer(proj, clip);

  KeyframeEngine.setKeyframe(clip, 'scaleX', 0, 1.0, 'easeIn');
  KeyframeEngine.setKeyframe(clip, 'scaleX', 100, 2.0, 'easeOut');

  // Toggle 3D position lane includes z, while 2D excludes z unless already set
  KeyframeEngine.togglePropLaneKeyframeAtFrame(clip, 'position', 20, 'linear', { is3D: true });
  assert.equal(clip.keyframes.z.length, 1);
  assert.equal(clip.keyframes.x.length, 1);

  // Split clip at F50 preserves easing on seam boundary keyframe
  const right = TimelineEngine.splitClipAtFrame(proj, clip.id, 50);
  assert.ok(right);
  assert.equal(clip.keyframes.scaleX.at(-1).frame, 50);
  assert.equal(clip.keyframes.scaleX.at(-1).easing, 'easeIn');
  assert.equal(right.keyframes.scaleX[0].frame, 50);
  assert.equal(right.keyframes.scaleX[0].easing, 'easeIn');
  assert.ok(Math.abs(right.keyframes.scaleX[0].value - KeyframeEngine.getValueAtFrame(clip, 'scaleX', 50, 1)) < 0.01);

  // Trim right side at F80 preserves midpoint scale value & easing
  TimelineEngine.trimDeleteSideAtPlayhead(proj, right.id, 'right', 80);
  const trimmedEndKf = right.keyframes.scaleX.find((k) => k.frame === 80);
  assert.ok(trimmedEndKf);
  assert.ok(trimmedEndKf.value > 1.0 && trimmedEndKf.value < 2.0);

  // Filter adjustment item exposes intensity lane & interpolates properly
  const filterItem = TimelineEngine.createAdjustmentLayer(proj, 10, {
    adjustmentKind: 'filter',
    name: 'Filter: Cinema',
    durationFrames: 60,
    filterId: 'cinema',
    filterIntensity: 0.8
  });
  const visLanes = KeyframeEngine.getVisibleKeyframeLanes(filterItem).map((g) => g.key);
  assert.ok(visLanes.includes('intensity'));
  KeyframeEngine.setKeyframe(filterItem, 'intensity', 10, 0.2, 'linear');
  KeyframeEngine.setKeyframe(filterItem, 'intensity', 50, 1.0, 'linear');
  assert.ok(Math.abs(KeyframeEngine.getValueAtFrame(filterItem, 'intensity', 30, 0.8) - 0.6) < 0.01);

  // Short-clip shake preset keeps unique monotonic keyframe frames
  const shortClip = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  shortClip.endFrame = 10;
  KeyframeEngine.applyPreset(shortClip, 'shake', 1280, 720, 24);
  const shakeFrames = shortClip.keyframes.x.map((k) => k.frame);
  assert.equal(new Set(shakeFrames).size, shakeFrames.length);
});

test('Keyframe interpolation curves (easeOutBack, spring, anticipate, bezier presets) & multiselect batch operations', () => {
  // 1. Extended easing curves behave meaningfully
  assert.ok(EASING_TYPES.some((e) => e.key === 'easeOutBack'));
  assert.ok(EASING_TYPES.some((e) => e.key === 'spring'));
  assert.ok(EASING_TYPES.some((e) => e.key === 'anticipate'));
  assert.ok(CUBIC_BEZIER_PRESETS.length >= 4);

  // Overshoot exceeds 1.0 briefly before settling at 1.0
  assert.equal(applyEasing(0, 'easeOutBack'), 0);
  assert.equal(applyEasing(1, 'easeOutBack'), 1);
  assert.ok(applyEasing(0.6, 'easeOutBack') > 1.0);

  // Anticipate pulls backward (< 0) near start
  assert.equal(applyEasing(0, 'anticipate'), 0);
  assert.equal(applyEasing(1, 'anticipate'), 1);
  assert.ok(applyEasing(0.18, 'anticipate') < 0);

  // Spring oscillates cleanly to 1.0
  assert.equal(applyEasing(0, 'spring'), 0);
  assert.equal(applyEasing(1, 'spring'), 1);
  assert.ok(applyEasing(0.32, 'spring') > 0.9);

  // 2. Multiselect move, easing, copy/paste, batch delete across multiple props/layers
  const proj = createEmptyProject('MultiSelectKF', { width: 1080, height: 1920, fps: 30, durationSec: 8 });
  const clipA = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  clipA.endFrame = 180;
  TimelineEngine.addLayer(proj, clipA);

  KeyframeEngine.setKeyframe(clipA, 'x', 10, 0, 'linear');
  KeyframeEngine.setKeyframe(clipA, 'y', 10, 0, 'linear');
  KeyframeEngine.setKeyframe(clipA, 'scaleX', 30, 1.0, 'linear');
  KeyframeEngine.setKeyframe(clipA, 'scaleY', 30, 1.0, 'linear');

  const selection = [
    { layerId: clipA.id, laneKey: 'position', props: ['x', 'y', 'z'], frame: 10 },
    { layerId: clipA.id, laneKey: 'scale', props: ['scaleX', 'scaleY'], frame: 30 }
  ];

  // Batch curve update
  const updated = KeyframeEngine.setSelectedKeyframesEasing(proj, selection, 'spring');
  assert.equal(updated, 2);
  assert.equal(clipA.keyframes.x[0].easing, 'spring');
  assert.equal(clipA.keyframes.scaleX[0].easing, 'spring');

  // Batch copy & paste at F80 preserves relative +20f offset
  const clipboard = KeyframeEngine.cloneKeyframesForClipboard(proj, selection);
  assert.ok(clipboard && clipboard.items.length === 4);
  const pasted = KeyframeEngine.pasteKeyframesAtFrame(proj, clipboard, 80, clipA.id);
  assert.equal(pasted.length, 2);
  assert.ok(clipA.keyframes.x.some((k) => k.frame === 80 && k.easing === 'spring'));
  assert.ok(clipA.keyframes.scaleX.some((k) => k.frame === 100 && k.easing === 'spring'));

  // Batch move pasted keyframes +15f -> F95 and F115
  KeyframeEngine.moveSelectedKeyframes(proj, pasted, 15);
  assert.ok(clipA.keyframes.x.some((k) => k.frame === 95));
  assert.ok(clipA.keyframes.scaleX.some((k) => k.frame === 115));

  // Batch delete removes shifted keyframes while leaving original F10/F30 intact
  const movedRefs = pasted.map((p) => ({ ...p, frame: p.frame + 15 }));
  KeyframeEngine.removeSelectedKeyframes(proj, movedRefs);
  assert.equal(clipA.keyframes.x.length, 1);
  assert.equal(clipA.keyframes.x[0].frame, 10);
});

test('Auto-Rec 3D Camera timeline item bidirectional sync, visibility lanes & delete cleanup', () => {
  const proj = createEmptyProject('AutoRecCam', { width: 1280, height: 720, fps: 30, durationSec: 6 });
  proj.camera.enabled = true;
  KeyframeEngine.setKeyframe(proj.camera, 'x', 0, 0, 'smooth');
  KeyframeEngine.setKeyframe(proj.camera, 'x', 45, 160, 'smooth');
  KeyframeEngine.setKeyframe(proj.camera, 'z', 45, -220, 'smooth');
  KeyframeEngine.setKeyframe(proj.camera, 'rotY', 45, 28, 'smooth');
  KeyframeEngine.setKeyframe(proj.camera, 'zoom', 45, 1.35, 'smooth');

  const camLayer = TimelineEngine.getOrCreateCameraLayer(proj, { kfExpanded: true });
  assert.equal(camLayer.type, 'camera');
  assert.equal(camLayer.kfExpanded, true);
  assert.equal(TimelineEngine.getOrCreateCameraLayer(proj).id, camLayer.id);

  // Synced keyframes appear inside camera timeline item with CAMERA_LANE_GROUPS
  const lanes = KeyframeEngine.getVisibleKeyframeLanes(camLayer).map((g) => g.key);
  assert.deepEqual(lanes, CAMERA_LANE_GROUPS.map((g) => g.key));
  assert.equal(camLayer.keyframes.x.length, 2);
  assert.equal(camLayer.keyframes.z[0].value, -220);

  // Editing keyframe on timeline item syncs back to project.camera
  KeyframeEngine.movePropGroupKeyframe(camLayer, ['x', 'y', 'z'], 45, 60);
  TimelineEngine.syncLayerToCamera(proj, camLayer);
  assert.equal(proj.camera.keyframes.x.find((k) => k.frame === 60)?.value, 160);
  assert.equal(proj.camera.keyframes.z.find((k) => k.frame === 60)?.value, -220);

  // Deleting camera timeline item clears camera keyframes cleanly
  TimelineEngine.deleteLayer(proj, camLayer.id);
  assert.equal(TimelineEngine.getCameraLayer(proj), null);
  assert.equal(KeyframeEngine.getAllCameraKeyframeFrames(proj.camera).length, 0);
});

test('Per-layer procedural motionBlur defaults, velocity detection & Dark/Light themeMode storage', () => {
  const proj = createEmptyProject('ThemeAndBlur', { width: 1080, height: 1920, fps: 30, durationSec: 5 });
  assert.equal(proj.settings.themeMode, 'dark');
  proj.settings.themeMode = 'light';

  const txt = TimelineEngine.createTextLayer(proj, 0);
  assert.deepEqual(txt.motionBlur, { enabled: false, strength: 0.7 });
  txt.motionBlur.enabled = true;
  txt.motionBlur.strength = 1.15;
  KeyframeEngine.setKeyframe(txt, 'x', 0, -240, 'cubicBezier', [0.22, 1, 0.36, 1]);
  KeyframeEngine.setKeyframe(txt, 'x', 30, 240, 'cubicBezier', [0.22, 1, 0.36, 1]);
  TimelineEngine.addLayer(proj, txt);

  const staticShape = TimelineEngine.createShapeLayer(proj, 'rectangle', 0);
  staticShape.motionBlur.enabled = true;
  TimelineEngine.addLayer(proj, staticShape);

  const roundtrip = deserializeProject(serializeProject(proj));
  assert.equal(roundtrip.settings.themeMode, 'light');
  const rtTxt = roundtrip.layers.find((l) => l.id === txt.id);
  assert.equal(rtTxt.motionBlur.enabled, true);
  assert.equal(rtTxt.motionBlur.strength, 1.15);

  // Verify RendererEngine motion velocity detection for 2D/3D movement vs static layer
  const proto = RendererEngine.prototype;
  const fakeRenderer = {
    resolveEffectiveTransform: (layer, frame) => ({
      x: KeyframeEngine.getValueAtFrame(layer, 'x', frame, layer.transform.x),
      y: KeyframeEngine.getValueAtFrame(layer, 'y', frame, layer.transform.y),
      z: KeyframeEngine.getValueAtFrame(layer, 'z', frame, layer.transform.z || 0),
      scaleX: KeyframeEngine.getValueAtFrame(layer, 'scaleX', frame, layer.transform.scaleX),
      scaleY: KeyframeEngine.getValueAtFrame(layer, 'scaleY', frame, layer.transform.scaleY),
      rotation: KeyframeEngine.getValueAtFrame(layer, 'rotation', frame, layer.transform.rotation),
      rotX: KeyframeEngine.getValueAtFrame(layer, 'rotX', frame, layer.transform.rotX || 0),
      rotY: KeyframeEngine.getValueAtFrame(layer, 'rotY', frame, layer.transform.rotY || 0)
    }),
    computeTransitionState: () => ({ dx: 0, dy: 0, rotDelta: 0, scaleMul: 1 })
  };

  assert.equal(proto.hasLayerMotionVelocity.call(fakeRenderer, rtTxt, 15, 1080, 1920, false), true);
  assert.equal(proto.hasLayerMotionVelocity.call(fakeRenderer, staticShape, 15, 1080, 1920, false), false);

  // Verify 3D Z/rotY keyframe movement also triggers motion blur velocity
  KeyframeEngine.setKeyframe(staticShape, 'z', 0, 0, 'smooth');
  KeyframeEngine.setKeyframe(staticShape, 'z', 30, 300, 'smooth');
  assert.equal(proto.hasLayerMotionVelocity.call(fakeRenderer, staticShape, 15, 1080, 1920, false), true);

  // Verify Ease Curve cubic-bezier presets produce valid monotonic / overshoot values
  for (const bp of CUBIC_BEZIER_PRESETS) {
    assert.equal(applyEasing(0, 'cubicBezier', bp.bezier), 0);
    assert.equal(applyEasing(1, 'cubicBezier', bp.bezier), 1);
    const midVal = applyEasing(0.5, 'cubicBezier', bp.bezier);
    assert.ok(Number.isFinite(midVal), `Preset ${bp.id} midpoint should be finite`);
  }
});



