import { applyEasing, lerp, uid } from '../utils/math.js';

export const ANIMATABLE_PROPS = [
  { key: 'x', label: 'Position X', step: 1 },
  { key: 'y', label: 'Position Y', step: 1 },
  { key: 'z', label: 'Depth Z (3D)', step: 5 },
  { key: 'scaleX', label: 'Scale X', step: 0.05 },
  { key: 'scaleY', label: 'Scale Y', step: 0.05 },
  { key: 'rotation', label: 'Rotation Z (°)', step: 1 },
  { key: 'rotX', label: '3D Tilt X (°)', step: 1 },
  { key: 'rotY', label: '3D Tilt Y (°)', step: 1 },
  { key: 'opacity', label: 'Opacity', step: 0.05 },
  { key: 'anchorX', label: 'Anchor X', step: 1 },
  { key: 'anchorY', label: 'Anchor Y', step: 1 },
  { key: 'volume', label: 'Audio Volume', step: 0.05 }
];

export const EASING_TYPES = [
  { key: 'linear', label: 'Linear' },
  { key: 'easeIn', label: 'Ease In' },
  { key: 'easeOut', label: 'Ease Out' },
  { key: 'easeInOut', label: 'Ease In-Out' },
  { key: 'smooth', label: 'Smooth Spline (Camera)' },
  { key: 'cubicBezier', label: 'Cubic Bezier' }
];

export const ANIMATION_PRESETS = [
  { id: 'fadeIn', label: 'Fade In', icon: 'bi-brightness-high' },
  { id: 'fadeOut', label: 'Fade Out', icon: 'bi-brightness-low' },
  { id: 'slideInLeft', label: 'Slide In Left', icon: 'bi-box-arrow-in-right' },
  { id: 'slideInRight', label: 'Slide In Right', icon: 'bi-box-arrow-in-left' },
  { id: 'slideInUp', label: 'Slide Up', icon: 'bi-arrow-up-square' },
  { id: 'slideInDown', label: 'Slide Down', icon: 'bi-arrow-down-square' },
  { id: 'slideOutLeft', label: 'Slide Out Left', icon: 'bi-box-arrow-left' },
  { id: 'slideOutRight', label: 'Slide Out Right', icon: 'bi-box-arrow-right' },
  { id: 'slideOutDown', label: 'Drop Out', icon: 'bi-box-arrow-down' },
  { id: 'zoomIn', label: 'Zoom In', icon: 'bi-zoom-in' },
  { id: 'zoomOut', label: 'Zoom Out', icon: 'bi-zoom-out' },
  { id: 'bounceIn', label: 'Bounce In', icon: 'bi-activity' },
  { id: 'spinIn', label: 'Spin In', icon: 'bi-arrow-clockwise' },
  { id: 'spinOut', label: 'Spin Out', icon: 'bi-arrow-counterclockwise' },
  { id: 'popUp', label: 'Pop Up', icon: 'bi-stars' },
  { id: 'rotate360', label: 'Rotate 360°', icon: 'bi-arrow-repeat' },
  { id: 'bounce', label: 'Bounce Pop', icon: 'bi-activity' },
  { id: 'shake', label: 'Shake', icon: 'bi-vibrate' },
  { id: 'pulseLoop', label: 'Heartbeat', icon: 'bi-heart-pulse' },
  { id: 'swing', label: 'Pendulum', icon: 'bi-stopwatch' },
  { id: 'float3D', label: '3D Float', icon: 'bi-badge-3d' }
];

export const KeyframeEngine = {
  ensurePropTrack(target, prop) {
    if (!target.keyframes) target.keyframes = {};
    if (!Array.isArray(target.keyframes[prop])) target.keyframes[prop] = [];
    return target.keyframes[prop];
  },

  setKeyframe(target, prop, frame, value, easing = 'easeInOut', bezier = [0.42, 0, 0.58, 1]) {
    const f = Math.round(frame);
    const list = this.ensurePropTrack(target, prop);
    const existing = list.find((k) => k.frame === f);
    if (existing) {
      existing.value = Number(value);
      existing.easing = easing;
      existing.bezier = [...bezier];
      return existing;
    }
    const kf = {
      id: uid('kf'),
      frame: f,
      value: Number(value),
      easing,
      bezier: [...bezier]
    };
    list.push(kf);
    list.sort((a, b) => a.frame - b.frame);
    return kf;
  },

  removeKeyframe(target, prop, frameOrId) {
    const list = this.ensurePropTrack(target, prop);
    const idx = list.findIndex((k) => k.id === frameOrId || k.frame === Math.round(frameOrId));
    if (idx >= 0) {
      list.splice(idx, 1);
      return true;
    }
    return false;
  },

  moveKeyframe(target, prop, kfId, newFrame) {
    const list = this.ensurePropTrack(target, prop);
    const kf = list.find((k) => k.id === kfId);
    if (!kf) return false;
    const f = Math.max(0, Math.round(newFrame));
    // Remove collision at destination frame if different keyframe
    const collisionIdx = list.findIndex((k) => k.frame === f && k.id !== kfId);
    if (collisionIdx >= 0) list.splice(collisionIdx, 1);
    kf.frame = f;
    list.sort((a, b) => a.frame - b.frame);
    return true;
  },

  getKeyframeAtFrame(target, prop, frame) {
    const f = Math.round(frame);
    const list = target?.keyframes?.[prop];
    if (!list) return null;
    return list.find((k) => k.frame === f) || null;
  },

  hasAnyKeyframeAtFrame(layer, frame) {
    const f = Math.round(frame);
    if (!layer?.keyframes) return false;
    return Object.values(layer.keyframes).some((arr) => Array.isArray(arr) && arr.some((k) => k.frame === f));
  },

  getAllKeyframeFrames(layer) {
    const set = new Set();
    if (!layer?.keyframes) return [];
    for (const arr of Object.values(layer.keyframes)) {
      if (!Array.isArray(arr)) continue;
      for (const k of arr) set.add(k.frame);
    }
    return Array.from(set).sort((a, b) => a - b);
  },

  getValueAtFrame(target, prop, frame, fallbackValue = 0) {
    const list = target?.keyframes?.[prop];
    if (!list || list.length === 0) {
      return fallbackValue;
    }
    if (list.length === 1 || frame <= list[0].frame) {
      return list[0].value;
    }
    const last = list[list.length - 1];
    if (frame >= last.frame) {
      return last.value;
    }
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const span = b.frame - a.frame;
        if (span <= 0) return b.value;
        const rawT = (frame - a.frame) / span;
        const easingMode = a.easing || 'linear';
        if (easingMode === 'smooth') {
          if (list.length === 2) {
            return lerp(a.value, b.value, applyEasing(rawT, 'easeInOut'));
          }
          const km1 = i > 0 ? list[i - 1] : a;
          const kp1 = i + 2 < list.length ? list[i + 2] : b;
          const slope0 = i > 0
            ? (b.value - km1.value) / Math.max(1e-4, b.frame - km1.frame)
            : (b.value - a.value) / span;
          const slope1 = i + 2 < list.length
            ? (kp1.value - a.value) / Math.max(1e-4, kp1.frame - a.frame)
            : (b.value - a.value) / span;
          const m0 = slope0 * span;
          const m1 = slope1 * span;
          const u = rawT;
          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;
          return h00 * a.value + h10 * m0 + h01 * b.value + h11 * m1;
        }
        const easedT = applyEasing(rawT, easingMode, a.bezier || [0.42, 0, 0.58, 1]);
        return lerp(a.value, b.value, easedT);
      }
    }
    return fallbackValue;
  },

  moveAllKeyframesAtFrame(layer, oldFrame, newFrame) {
    const fOld = Math.round(oldFrame);
    const fNew = Math.max(0, Math.round(newFrame));
    if (fOld === fNew || !layer?.keyframes) return;
    for (const prop of Object.keys(layer.keyframes)) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list)) continue;
      const kf = list.find((k) => k.frame === fOld);
      if (kf) {
        this.moveKeyframe(layer, prop, kf.id, fNew);
      }
    }
  },

  getTransformAtFrame(layer, frame) {
    const base = layer.transform || {};
    return {
      x: this.getValueAtFrame(layer, 'x', frame, base.x ?? 0),
      y: this.getValueAtFrame(layer, 'y', frame, base.y ?? 0),
      z: this.getValueAtFrame(layer, 'z', frame, base.z ?? 0),
      scaleX: this.getValueAtFrame(layer, 'scaleX', frame, base.scaleX ?? 1),
      scaleY: this.getValueAtFrame(layer, 'scaleY', frame, base.scaleY ?? 1),
      rotation: this.getValueAtFrame(layer, 'rotation', frame, base.rotation ?? 0),
      rotX: this.getValueAtFrame(layer, 'rotX', frame, base.rotX ?? 0),
      rotY: this.getValueAtFrame(layer, 'rotY', frame, base.rotY ?? 0),
      opacity: this.getValueAtFrame(layer, 'opacity', frame, base.opacity ?? 1),
      anchorX: this.getValueAtFrame(layer, 'anchorX', frame, base.anchorX ?? 0),
      anchorY: this.getValueAtFrame(layer, 'anchorY', frame, base.anchorY ?? 0)
    };
  },

  getCameraAtFrame(camera, frame) {
    return {
      x: this.getValueAtFrame(camera, 'x', frame, camera.x ?? 0),
      y: this.getValueAtFrame(camera, 'y', frame, camera.y ?? 0),
      z: this.getValueAtFrame(camera, 'z', frame, camera.z ?? 0),
      rotX: this.getValueAtFrame(camera, 'rotX', frame, camera.rotX ?? 0),
      rotY: this.getValueAtFrame(camera, 'rotY', frame, camera.rotY ?? 0),
      rotZ: this.getValueAtFrame(camera, 'rotZ', frame, camera.rotZ ?? 0),
      zoom: this.getValueAtFrame(camera, 'zoom', frame, camera.zoom ?? 1)
    };
  },

  applyPreset(layer, presetId, projectWidth, projectHeight, durationFrames = 24) {
    const start = layer.startFrame;
    const dur = Math.max(6, Math.round(durationFrames));
    const end = Math.min(layer.endFrame, start + dur);
    const outStart = Math.max(layer.startFrame, layer.endFrame - dur);
    const outEnd = layer.endFrame;
    const base = layer.transform;
    const fullEnd = layer.endFrame;

    switch (presetId) {
      case 'fadeIn':
        this.setKeyframe(layer, 'opacity', start, 0, 'easeOut');
        this.setKeyframe(layer, 'opacity', end, base.opacity ?? 1, 'linear');
        break;
      case 'fadeOut':
        this.setKeyframe(layer, 'opacity', outStart, base.opacity ?? 1, 'easeIn');
        this.setKeyframe(layer, 'opacity', outEnd, 0, 'linear');
        break;
      case 'slideInLeft':
        this.setKeyframe(layer, 'x', start, -projectWidth * 0.65, 'easeOut');
        this.setKeyframe(layer, 'x', end, base.x, 'linear');
        this.setKeyframe(layer, 'opacity', start, 0, 'easeOut');
        this.setKeyframe(layer, 'opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideInRight':
        this.setKeyframe(layer, 'x', start, projectWidth * 0.65, 'easeOut');
        this.setKeyframe(layer, 'x', end, base.x, 'linear');
        break;
      case 'slideInUp':
        this.setKeyframe(layer, 'y', start, projectHeight * 0.55, 'easeOut');
        this.setKeyframe(layer, 'y', end, base.y, 'linear');
        this.setKeyframe(layer, 'opacity', start, 0, 'easeOut');
        this.setKeyframe(layer, 'opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideInDown':
        this.setKeyframe(layer, 'y', start, -projectHeight * 0.55, 'easeOut');
        this.setKeyframe(layer, 'y', end, base.y, 'linear');
        this.setKeyframe(layer, 'opacity', start, 0, 'easeOut');
        this.setKeyframe(layer, 'opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideOutLeft':
        this.setKeyframe(layer, 'x', outStart, base.x, 'easeIn');
        this.setKeyframe(layer, 'x', outEnd, -projectWidth * 0.65, 'linear');
        break;
      case 'slideOutRight':
        this.setKeyframe(layer, 'x', outStart, base.x, 'easeIn');
        this.setKeyframe(layer, 'x', outEnd, projectWidth * 0.65, 'linear');
        break;
      case 'slideOutDown':
        this.setKeyframe(layer, 'y', outStart, base.y, 'easeIn');
        this.setKeyframe(layer, 'y', outEnd, projectHeight * 0.6, 'linear');
        this.setKeyframe(layer, 'opacity', outStart, base.opacity ?? 1, 'easeIn');
        this.setKeyframe(layer, 'opacity', outEnd, 0, 'linear');
        break;
      case 'zoomIn':
        this.setKeyframe(layer, 'scaleX', start, 0.1, 'easeOut');
        this.setKeyframe(layer, 'scaleY', start, 0.1, 'easeOut');
        this.setKeyframe(layer, 'scaleX', end, base.scaleX, 'linear');
        this.setKeyframe(layer, 'scaleY', end, base.scaleY, 'linear');
        break;
      case 'zoomOut':
        this.setKeyframe(layer, 'scaleX', outStart, base.scaleX, 'easeIn');
        this.setKeyframe(layer, 'scaleY', outStart, base.scaleY, 'easeIn');
        this.setKeyframe(layer, 'scaleX', outEnd, 0.05, 'linear');
        this.setKeyframe(layer, 'scaleY', outEnd, 0.05, 'linear');
        break;
      case 'spinIn':
        this.setKeyframe(layer, 'rotation', start, base.rotation - 180, 'easeOut');
        this.setKeyframe(layer, 'rotation', end, base.rotation, 'linear');
        this.setKeyframe(layer, 'scaleX', start, 0.2, 'easeOut');
        this.setKeyframe(layer, 'scaleY', start, 0.2, 'easeOut');
        this.setKeyframe(layer, 'scaleX', end, base.scaleX, 'linear');
        this.setKeyframe(layer, 'scaleY', end, base.scaleY, 'linear');
        break;
      case 'spinOut':
        this.setKeyframe(layer, 'rotation', outStart, base.rotation, 'easeIn');
        this.setKeyframe(layer, 'rotation', outEnd, base.rotation + 180, 'linear');
        this.setKeyframe(layer, 'scaleX', outStart, base.scaleX, 'easeIn');
        this.setKeyframe(layer, 'scaleY', outStart, base.scaleY, 'easeIn');
        this.setKeyframe(layer, 'scaleX', outEnd, 0.05, 'linear');
        this.setKeyframe(layer, 'scaleY', outEnd, 0.05, 'linear');
        break;
      case 'popUp':
      case 'bounceIn': {
        const mid1 = start + Math.round((end - start) * 0.55);
        const mid2 = start + Math.round((end - start) * 0.8);
        this.setKeyframe(layer, 'scaleX', start, 0.15, 'easeOut');
        this.setKeyframe(layer, 'scaleY', start, 0.15, 'easeOut');
        this.setKeyframe(layer, 'scaleX', mid1, base.scaleX * 1.18, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', mid1, base.scaleY * 1.18, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', mid2, base.scaleX * 0.94, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', mid2, base.scaleY * 0.94, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', end, base.scaleX, 'linear');
        this.setKeyframe(layer, 'scaleY', end, base.scaleY, 'linear');
        break;
      }
      case 'rotate360':
        this.setKeyframe(layer, 'rotation', start, base.rotation, 'easeInOut');
        this.setKeyframe(layer, 'rotation', end, base.rotation + 360, 'linear');
        break;
      case 'bounce': {
        const mid1 = start + Math.round((end - start) * 0.45);
        const mid2 = start + Math.round((end - start) * 0.72);
        this.setKeyframe(layer, 'scaleX', start, 0.2, 'easeOut');
        this.setKeyframe(layer, 'scaleY', start, 0.2, 'easeOut');
        this.setKeyframe(layer, 'scaleX', mid1, base.scaleX * 1.18, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', mid1, base.scaleY * 1.18, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', mid2, base.scaleX * 0.94, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', mid2, base.scaleY * 0.94, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', end, base.scaleX, 'linear');
        this.setKeyframe(layer, 'scaleY', end, base.scaleY, 'linear');
        break;
      }
      case 'shake': {
        const step = Math.max(2, Math.round((end - start) / 6));
        const offsets = [0, -18, 18, -12, 12, -5, 0];
        offsets.forEach((dx, i) => {
          const f = Math.min(layer.endFrame, start + i * step);
          this.setKeyframe(layer, 'x', f, base.x + dx, 'linear');
        });
        break;
      }
      case 'pulseLoop': {
        const half = Math.max(4, Math.round((fullEnd - start) / 2));
        const q1 = start + Math.round(half / 2);
        this.setKeyframe(layer, 'scaleX', start, base.scaleX, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', start, base.scaleY, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', q1, base.scaleX * 1.12, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', q1, base.scaleY * 1.12, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', start + half, base.scaleX, 'easeInOut');
        this.setKeyframe(layer, 'scaleY', start + half, base.scaleY, 'easeInOut');
        this.setKeyframe(layer, 'scaleX', fullEnd, base.scaleX, 'linear');
        this.setKeyframe(layer, 'scaleY', fullEnd, base.scaleY, 'linear');
        break;
      }
      case 'swing': {
        const t1 = start + Math.round((fullEnd - start) * 0.25);
        const t2 = start + Math.round((fullEnd - start) * 0.5);
        const t3 = start + Math.round((fullEnd - start) * 0.75);
        this.setKeyframe(layer, 'rotation', start, base.rotation - 10, 'easeInOut');
        this.setKeyframe(layer, 'rotation', t1, base.rotation + 10, 'easeInOut');
        this.setKeyframe(layer, 'rotation', t2, base.rotation - 8, 'easeInOut');
        this.setKeyframe(layer, 'rotation', t3, base.rotation + 8, 'easeInOut');
        this.setKeyframe(layer, 'rotation', fullEnd, base.rotation, 'linear');
        break;
      }
      case 'float3D': {
        const mid = start + Math.round((fullEnd - start) * 0.5);
        this.setKeyframe(layer, 'rotY', start, -12, 'easeInOut');
        this.setKeyframe(layer, 'rotY', mid, 12, 'easeInOut');
        this.setKeyframe(layer, 'rotY', fullEnd, -12, 'linear');
        this.setKeyframe(layer, 'y', start, base.y - 12, 'easeInOut');
        this.setKeyframe(layer, 'y', mid, base.y + 12, 'easeInOut');
        this.setKeyframe(layer, 'y', fullEnd, base.y - 12, 'linear');
        break;
      }
    }
  },

  applyCameraPreset(camera, presetId, totalFrames = 150) {
    if (!camera) return;
    const end = Math.max(30, Math.round(totalFrames));
    const mid = Math.round(end * 0.5);
    camera.enabled = true;
    camera.keyframes = { x: [], y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: [] };
    switch (presetId) {
      case 'dollyIn':
        this.setKeyframe(camera, 'z', 0, 0, 'easeInOut');
        this.setKeyframe(camera, 'z', end, -260, 'easeOut');
        this.setKeyframe(camera, 'zoom', 0, 1.0, 'easeInOut');
        this.setKeyframe(camera, 'zoom', end, 1.28, 'easeOut');
        break;
      case 'kenBurns':
        this.setKeyframe(camera, 'x', 0, -90, 'easeInOut');
        this.setKeyframe(camera, 'x', end, 90, 'easeInOut');
        this.setKeyframe(camera, 'y', 0, 35, 'easeInOut');
        this.setKeyframe(camera, 'y', end, -35, 'easeInOut');
        this.setKeyframe(camera, 'zoom', 0, 1.05, 'easeInOut');
        this.setKeyframe(camera, 'zoom', end, 1.25, 'easeInOut');
        break;
      case 'orbit360':
        this.setKeyframe(camera, 'rotY', 0, -28, 'smooth');
        this.setKeyframe(camera, 'rotY', mid, 0, 'smooth');
        this.setKeyframe(camera, 'rotY', end, 28, 'smooth');
        this.setKeyframe(camera, 'rotX', 0, 10, 'smooth');
        this.setKeyframe(camera, 'rotX', mid, -6, 'smooth');
        this.setKeyframe(camera, 'rotX', end, 10, 'smooth');
        this.setKeyframe(camera, 'z', 0, -90, 'smooth');
        this.setKeyframe(camera, 'z', end, -90, 'smooth');
        break;
      case 'handheld': {
        const steps = 6;
        const offsetsX = [0, 16, -14, 18, -10, 8, 0];
        const offsetsY = [0, -10, 14, -8, 12, -6, 0];
        const rolls = [0, 1.8, -1.5, 1.2, -1.4, 0.8, 0];
        for (let i = 0; i <= steps; i++) {
          const f = Math.round((end * i) / steps);
          this.setKeyframe(camera, 'x', f, offsetsX[i], 'smooth');
          this.setKeyframe(camera, 'y', f, offsetsY[i], 'smooth');
          this.setKeyframe(camera, 'rotZ', f, rolls[i], 'smooth');
        }
        break;
      }
      case 'flip3D':
        this.setKeyframe(camera, 'rotY', 0, 0, 'smooth');
        this.setKeyframe(camera, 'rotY', Math.round(end * 0.35), 36, 'smooth');
        this.setKeyframe(camera, 'rotY', Math.round(end * 0.7), -36, 'smooth');
        this.setKeyframe(camera, 'rotY', end, 0, 'easeOut');
        this.setKeyframe(camera, 'zoom', 0, 1, 'smooth');
        this.setKeyframe(camera, 'zoom', mid, 0.85, 'smooth');
        this.setKeyframe(camera, 'zoom', end, 1, 'easeOut');
        break;
    }
  },

  smoothCameraKeyframes(camera, blendFactor = 0.35) {
    if (!camera?.keyframes) return 0;
    let touched = 0;
    const w = Math.max(0, Math.min(0.6, blendFactor));
    for (const prop of ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'zoom']) {
      const list = camera.keyframes[prop];
      if (!Array.isArray(list) || list.length === 0) continue;
      list.sort((a, b) => a.frame - b.frame);
      const nextVals = list.map((k, idx) => {
        if (idx === 0 || idx === list.length - 1 || list.length < 3) return k.value;
        const avg = (list[idx - 1].value + 2 * k.value + list[idx + 1].value) * 0.25;
        return Number((k.value + (avg - k.value) * w).toFixed(prop === 'zoom' ? 3 : 2));
      });
      list.forEach((k, idx) => {
        k.value = nextVals[idx];
        k.easing = 'smooth';
        touched++;
      });
    }
    return touched;
  }
};
