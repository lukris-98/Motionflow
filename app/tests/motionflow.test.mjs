import test from 'node:test';
import assert from 'node:assert/strict';

import { KeyframeEngine, EASING_TYPES } from '../src/main/assets/www/js/engine/keyframeEngine.js';
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
import { createEmptyProject, deserializeProject } from '../src/main/assets/www/js/storage/projectStorage.js';
import { extractGrayscale, extractTemplatePatch, matchTemplateCoarseToFine } from '../src/main/assets/www/js/engine/trackerEngine.js';

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

import { computeRulerLodSpec, formatRulerLabel } from '../src/main/assets/www/js/ui/timelineView.js';

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


