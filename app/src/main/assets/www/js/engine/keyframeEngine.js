import { applyEasing, lerp, lerpColorHex, normalizeHexColor, uid } from '../utils/math.js';

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
  { key: 'volume', label: 'Audio Volume', step: 0.05 },
  { key: 'color', label: 'Color / Tint', isColor: true }
];

export const KEYFRAME_LANE_GROUPS = [
  {
    key: 'position',
    label: 'Posisi',
    icon: 'bi-arrows-move',
    color: '#38bdf8',
    props: ['x', 'y', 'z'],
    defaultProps: ['x', 'y'],
    primaryProp: 'x'
  },
  {
    key: 'scale',
    label: 'Scale',
    icon: 'bi-arrows-angle-expand',
    color: '#a78bfa',
    props: ['scaleX', 'scaleY'],
    defaultProps: ['scaleX', 'scaleY'],
    primaryProp: 'scaleX'
  },
  {
    key: 'rotation',
    label: 'Rotasi',
    icon: 'bi-arrow-clockwise',
    color: '#f472b6',
    props: ['rotation', 'rotX', 'rotY'],
    defaultProps: ['rotation'],
    primaryProp: 'rotation'
  },
  {
    key: 'opacity',
    label: 'Opacity',
    icon: 'bi-brightness-half',
    color: '#34d399',
    props: ['opacity'],
    defaultProps: ['opacity'],
    primaryProp: 'opacity'
  },
  {
    key: 'volume',
    label: 'Volume',
    icon: 'bi-volume-up-fill',
    color: '#ffab40',
    props: ['volume'],
    defaultProps: ['volume'],
    primaryProp: 'volume'
  },
  {
    key: 'color',
    label: 'Warna',
    icon: 'bi-palette-fill',
    color: '#fb7185',
    props: ['color'],
    defaultProps: ['color'],
    primaryProp: 'color',
    isColor: true
  }
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
  { id: 'fadeIn', cat: 'in', label: 'Fade In', icon: 'bi-brightness-high' },
  { id: 'fadeOut', cat: 'out', label: 'Fade Out', icon: 'bi-brightness-low' },
  { id: 'slideInLeft', cat: 'in', label: 'Slide In Left', icon: 'bi-box-arrow-in-right' },
  { id: 'slideInRight', cat: 'in', label: 'Slide In Right', icon: 'bi-box-arrow-in-left' },
  { id: 'slideInUp', cat: 'in', label: 'Slide Up', icon: 'bi-arrow-up-square' },
  { id: 'slideInDown', cat: 'in', label: 'Slide Down', icon: 'bi-arrow-down-square' },
  { id: 'slideOutLeft', cat: 'out', label: 'Slide Out Left', icon: 'bi-box-arrow-left' },
  { id: 'slideOutRight', cat: 'out', label: 'Slide Out Right', icon: 'bi-box-arrow-right' },
  { id: 'slideOutDown', cat: 'out', label: 'Drop Out', icon: 'bi-box-arrow-down' },
  { id: 'zoomIn', cat: 'in', label: 'Zoom In', icon: 'bi-zoom-in' },
  { id: 'zoomOut', cat: 'out', label: 'Zoom Out', icon: 'bi-zoom-out' },
  { id: 'bounceIn', cat: 'in', label: 'Bounce In', icon: 'bi-activity' },
  { id: 'spinIn', cat: 'in', label: 'Spin In', icon: 'bi-arrow-clockwise' },
  { id: 'spinOut', cat: 'out', label: 'Spin Out', icon: 'bi-arrow-counterclockwise' },
  { id: 'popUp', cat: 'in', label: 'Pop Up', icon: 'bi-stars' },
  { id: 'rotate360', cat: 'combo', label: 'Rotate 360°', icon: 'bi-arrow-repeat' },
  { id: 'bounce', cat: 'combo', label: 'Bounce Pop', icon: 'bi-activity' },
  { id: 'shake', cat: 'combo', label: 'Shake', icon: 'bi-vibrate' },
  { id: 'pulseLoop', cat: 'combo', label: 'Heartbeat', icon: 'bi-heart-pulse' },
  { id: 'swing', cat: 'combo', label: 'Pendulum', icon: 'bi-stopwatch' },
  { id: 'float3D', cat: 'combo', label: '3D Float', icon: 'bi-badge-3d' }
];

export const KeyframeEngine = {
  ensurePropTrack(target, prop) {
    if (!target.keyframes) target.keyframes = {};
    if (!Array.isArray(target.keyframes[prop])) target.keyframes[prop] = [];
    return target.keyframes[prop];
  },

  getDefaultPropValue(layer, prop) {
    if (!layer) return prop === 'color' ? '#ffffff' : 0;
    if (prop === 'color') {
      if (layer.type === 'text' && layer.textProps?.color) {
        return normalizeHexColor(layer.textProps.color, '#ffffff');
      }
      if (layer.type === 'shape' && layer.shapeProps?.fillColor) {
        return normalizeHexColor(layer.shapeProps.fillColor, '#7c4dff');
      }
      return normalizeHexColor(layer.fx?.tintColor || '#ffffff', '#ffffff');
    }
    if (prop === 'volume') return layer.audioProps?.volume ?? 1;
    const base = layer.transform || {};
    if (prop === 'scaleX' || prop === 'scaleY' || prop === 'opacity') return base[prop] ?? 1;
    return base[prop] ?? 0;
  },

  getVisibleKeyframeLanes(layer) {
    if (!layer) return [];
    const hasProps = (props) => props.some((p) => (layer.keyframes?.[p]?.length || 0) > 0);
    return KEYFRAME_LANE_GROUPS.filter((g) => {
      if (hasProps(g.props)) return true;
      if (layer.type === 'audio') return g.key === 'volume';
      if (layer.type === 'adjustment') return g.key === 'opacity' || g.key === 'color';
      if (g.key === 'volume') return layer.type === 'video' || Boolean(layer.audioProps);
      return true;
    });
  },

  setKeyframe(target, prop, frame, value, easing = 'easeInOut', bezier = [0.42, 0, 0.58, 1], opts = null) {
    const f = Math.round(frame);
    const list = this.ensurePropTrack(target, prop);
    const storedVal = prop === 'color'
      ? normalizeHexColor(String(value || '#ffffff'), '#ffffff')
      : Number(value);
    const existing = list.find((k) => k.frame === f);
    if (existing) {
      existing.value = storedVal;
      existing.easing = easing;
      existing.bezier = [...bezier];
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'presetTag')) {
        if (opts.presetTag) existing.presetTag = opts.presetTag;
        else delete existing.presetTag;
      }
      return existing;
    }
    const kf = {
      id: uid('kf'),
      frame: f,
      value: storedVal,
      easing,
      bezier: [...bezier]
    };
    if (opts?.presetTag) kf.presetTag = opts.presetTag;
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

  getLaneKeyframes(layer, propKeys) {
    if (!layer?.keyframes || !Array.isArray(propKeys)) return [];
    const byFrame = new Map();
    for (const p of propKeys) {
      const arr = layer.keyframes[p];
      if (!Array.isArray(arr)) continue;
      for (const k of arr) {
        let entry = byFrame.get(k.frame);
        if (!entry) {
          entry = {
            frame: k.frame,
            easing: k.easing || 'linear',
            bezier: k.bezier ? [...k.bezier] : [0.42, 0, 0.58, 1],
            colorVal: p === 'color' ? normalizeHexColor(String(k.value), '#ffffff') : null,
            presetTag: k.presetTag || null,
            props: [p],
            summary: `${p}:${p === 'color' ? k.value : Number(Number(k.value).toFixed(2))}`
          };
          byFrame.set(k.frame, entry);
        } else {
          entry.props.push(p);
          entry.summary += ` ${p}:${p === 'color' ? k.value : Number(Number(k.value).toFixed(2))}`;
          if (!entry.presetTag && k.presetTag) entry.presetTag = k.presetTag;
        }
      }
    }
    return Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
  },

  movePropGroupKeyframe(layer, propKeys, oldFrame, newFrame) {
    const fOld = Math.round(oldFrame);
    const fNew = Math.max(0, Math.round(newFrame));
    if (fOld === fNew || !layer?.keyframes || !Array.isArray(propKeys)) return false;
    let moved = false;
    for (const prop of propKeys) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list)) continue;
      const kf = list.find((k) => k.frame === fOld);
      if (kf) {
        if (this.moveKeyframe(layer, prop, kf.id, fNew)) {
          moved = true;
        }
      }
    }
    return moved;
  },

  removePropGroupKeyframe(layer, propKeys, frame) {
    const f = Math.round(frame);
    if (!layer?.keyframes || !Array.isArray(propKeys)) return false;
    let removed = false;
    for (const prop of propKeys) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((k) => k.frame === f);
      if (idx >= 0) {
        list.splice(idx, 1);
        removed = true;
      }
    }
    return removed;
  },

  setPropGroupEasing(layer, propKeys, frame, easing, bezier = null) {
    const f = Math.round(frame);
    if (!layer?.keyframes || !Array.isArray(propKeys)) return false;
    let updated = false;
    for (const prop of propKeys) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list)) continue;
      const kf = list.find((k) => k.frame === f);
      if (kf) {
        kf.easing = easing;
        if (Array.isArray(bezier) && bezier.length === 4) {
          kf.bezier = [...bezier];
        }
        updated = true;
      }
    }
    return updated;
  },

  togglePropLaneKeyframeAtFrame(layer, laneKey, frame, easing = 'easeInOut') {
    const group = KEYFRAME_LANE_GROUPS.find((g) => g.key === laneKey);
    if (!layer || !group) return { added: false, laneKey };
    const f = Math.max(layer.startFrame || 0, Math.min(layer.endFrame ?? frame, Math.round(frame)));
    const exists = group.props.some((p) => Boolean(this.getKeyframeAtFrame(layer, p, f)));
    if (exists) {
      this.removePropGroupKeyframe(layer, group.props, f);
      return { added: false, laneKey, frame: f };
    }
    const tf = this.getTransformAtFrame(layer, f);
    for (const p of group.defaultProps) {
      let val;
      if (p === 'color') {
        val = this.getColorAtFrame(layer, f, this.getDefaultPropValue(layer, 'color'));
      } else if (p === 'volume') {
        val = this.getValueAtFrame(layer, 'volume', f, this.getDefaultPropValue(layer, 'volume'));
      } else {
        val = tf[p] ?? this.getDefaultPropValue(layer, p);
      }
      this.setKeyframe(layer, p, f, val, easing);
    }
    return { added: true, laneKey, frame: f };
  },

  getValueAtFrame(target, prop, frame, fallbackValue = 0) {
    if (prop === 'color') {
      return this.getColorAtFrame(target, frame, typeof fallbackValue === 'string' ? fallbackValue : '#ffffff');
    }
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

  getColorAtFrame(target, frame, fallbackHex = '#ffffff') {
    const safeFallback = normalizeHexColor(fallbackHex, '#ffffff');
    const list = target?.keyframes?.color;
    if (!list || list.length === 0) return safeFallback;
    if (list.length === 1 || frame <= list[0].frame) {
      return normalizeHexColor(String(list[0].value), safeFallback);
    }
    const last = list[list.length - 1];
    if (frame >= last.frame) {
      return normalizeHexColor(String(last.value), safeFallback);
    }
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const span = b.frame - a.frame;
        if (span <= 0) return normalizeHexColor(String(b.value), safeFallback);
        const rawT = (frame - a.frame) / span;
        const mode = a.easing === 'smooth' ? 'easeInOut' : (a.easing || 'linear');
        const easedT = applyEasing(rawT, mode, a.bezier || [0.42, 0, 0.58, 1]);
        return lerpColorHex(String(a.value), String(b.value), easedT);
      }
    }
    return safeFallback;
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

  getPresetCategory(presetId) {
    const spec = ANIMATION_PRESETS.find((p) => p.id === presetId);
    return spec?.cat || 'combo';
  },

  clearPresetCategory(layer, category) {
    if (!layer) return 0;
    let removed = 0;
    if (layer.keyframes) {
      for (const prop of Object.keys(layer.keyframes)) {
        const arr = layer.keyframes[prop];
        if (!Array.isArray(arr)) continue;
        const next = arr.filter((k) => k.presetTag !== category);
        removed += arr.length - next.length;
        layer.keyframes[prop] = next;
      }
    }
    if (category === 'in') layer.presetInId = null;
    else if (category === 'out') layer.presetOutId = null;
    else if (category === 'combo') layer.presetComboId = null;
    return removed;
  },

  applyPreset(layer, presetId, projectWidth, projectHeight, durationFrames = 24) {
    const cat = this.getPresetCategory(presetId);
    this.clearPresetCategory(layer, cat);

    if (cat === 'in') layer.presetInId = presetId;
    else if (cat === 'out') layer.presetOutId = presetId;
    else layer.presetComboId = presetId;

    const start = layer.startFrame;
    const dur = Math.max(6, Math.round(durationFrames));
    const end = Math.min(layer.endFrame, start + dur);
    const outStart = Math.max(layer.startFrame, layer.endFrame - dur);
    const outEnd = layer.endFrame;
    const base = layer.transform;
    const fullEnd = layer.endFrame;
    const tagOpts = { presetTag: cat };
    const sk = (prop, f, val, easing = 'easeInOut') =>
      this.setKeyframe(layer, prop, f, val, easing, [0.42, 0, 0.58, 1], tagOpts);

    switch (presetId) {
      case 'fadeIn':
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', end, base.opacity ?? 1, 'linear');
        break;
      case 'fadeOut':
        sk('opacity', outStart, base.opacity ?? 1, 'easeIn');
        sk('opacity', outEnd, 0, 'linear');
        break;
      case 'slideInLeft':
        sk('x', start, -projectWidth * 0.65, 'easeOut');
        sk('x', end, base.x, 'linear');
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideInRight':
        sk('x', start, projectWidth * 0.65, 'easeOut');
        sk('x', end, base.x, 'linear');
        break;
      case 'slideInUp':
        sk('y', start, projectHeight * 0.55, 'easeOut');
        sk('y', end, base.y, 'linear');
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideInDown':
        sk('y', start, -projectHeight * 0.55, 'easeOut');
        sk('y', end, base.y, 'linear');
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + 8), base.opacity ?? 1, 'linear');
        break;
      case 'slideOutLeft':
        sk('x', outStart, base.x, 'easeIn');
        sk('x', outEnd, -projectWidth * 0.65, 'linear');
        break;
      case 'slideOutRight':
        sk('x', outStart, base.x, 'easeIn');
        sk('x', outEnd, projectWidth * 0.65, 'linear');
        break;
      case 'slideOutDown':
        sk('y', outStart, base.y, 'easeIn');
        sk('y', outEnd, projectHeight * 0.6, 'linear');
        sk('opacity', outStart, base.opacity ?? 1, 'easeIn');
        sk('opacity', outEnd, 0, 'linear');
        break;
      case 'zoomIn':
        sk('scaleX', start, 0.1, 'easeOut');
        sk('scaleY', start, 0.1, 'easeOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        break;
      case 'zoomOut':
        sk('scaleX', outStart, base.scaleX, 'easeIn');
        sk('scaleY', outStart, base.scaleY, 'easeIn');
        sk('scaleX', outEnd, 0.05, 'linear');
        sk('scaleY', outEnd, 0.05, 'linear');
        break;
      case 'spinIn':
        sk('rotation', start, base.rotation - 180, 'easeOut');
        sk('rotation', end, base.rotation, 'linear');
        sk('scaleX', start, 0.2, 'easeOut');
        sk('scaleY', start, 0.2, 'easeOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        break;
      case 'spinOut':
        sk('rotation', outStart, base.rotation, 'easeIn');
        sk('rotation', outEnd, base.rotation + 180, 'linear');
        sk('scaleX', outStart, base.scaleX, 'easeIn');
        sk('scaleY', outStart, base.scaleY, 'easeIn');
        sk('scaleX', outEnd, 0.05, 'linear');
        sk('scaleY', outEnd, 0.05, 'linear');
        break;
      case 'popUp':
      case 'bounceIn': {
        const mid1 = start + Math.round((end - start) * 0.55);
        const mid2 = start + Math.round((end - start) * 0.8);
        sk('scaleX', start, 0.15, 'easeOut');
        sk('scaleY', start, 0.15, 'easeOut');
        sk('scaleX', mid1, base.scaleX * 1.18, 'easeInOut');
        sk('scaleY', mid1, base.scaleY * 1.18, 'easeInOut');
        sk('scaleX', mid2, base.scaleX * 0.94, 'easeInOut');
        sk('scaleY', mid2, base.scaleY * 0.94, 'easeInOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        break;
      }
      case 'rotate360':
        sk('rotation', start, base.rotation, 'easeInOut');
        sk('rotation', end, base.rotation + 360, 'linear');
        break;
      case 'bounce': {
        const mid1 = start + Math.round((end - start) * 0.45);
        const mid2 = start + Math.round((end - start) * 0.72);
        sk('scaleX', start, 0.2, 'easeOut');
        sk('scaleY', start, 0.2, 'easeOut');
        sk('scaleX', mid1, base.scaleX * 1.18, 'easeInOut');
        sk('scaleY', mid1, base.scaleY * 1.18, 'easeInOut');
        sk('scaleX', mid2, base.scaleX * 0.94, 'easeInOut');
        sk('scaleY', mid2, base.scaleY * 0.94, 'easeInOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        break;
      }
      case 'shake': {
        const step = Math.max(2, Math.round((end - start) / 6));
        const offsets = [0, -18, 18, -12, 12, -5, 0];
        offsets.forEach((dx, i) => {
          const f = Math.min(layer.endFrame, start + i * step);
          sk('x', f, base.x + dx, 'linear');
        });
        break;
      }
      case 'pulseLoop': {
        const half = Math.max(4, Math.round((fullEnd - start) / 2));
        const q1 = start + Math.round(half / 2);
        sk('scaleX', start, base.scaleX, 'easeInOut');
        sk('scaleY', start, base.scaleY, 'easeInOut');
        sk('scaleX', q1, base.scaleX * 1.12, 'easeInOut');
        sk('scaleY', q1, base.scaleY * 1.12, 'easeInOut');
        sk('scaleX', start + half, base.scaleX, 'easeInOut');
        sk('scaleY', start + half, base.scaleY, 'easeInOut');
        sk('scaleX', fullEnd, base.scaleX, 'linear');
        sk('scaleY', fullEnd, base.scaleY, 'linear');
        break;
      }
      case 'swing': {
        const t1 = start + Math.round((fullEnd - start) * 0.25);
        const t2 = start + Math.round((fullEnd - start) * 0.5);
        const t3 = start + Math.round((fullEnd - start) * 0.75);
        sk('rotation', start, base.rotation - 10, 'easeInOut');
        sk('rotation', t1, base.rotation + 10, 'easeInOut');
        sk('rotation', t2, base.rotation - 8, 'easeInOut');
        sk('rotation', t3, base.rotation + 8, 'easeInOut');
        sk('rotation', fullEnd, base.rotation, 'linear');
        break;
      }
      case 'float3D': {
        const mid = start + Math.round((fullEnd - start) * 0.5);
        sk('rotY', start, -12, 'easeInOut');
        sk('rotY', mid, 12, 'easeInOut');
        sk('rotY', fullEnd, -12, 'linear');
        sk('y', start, base.y - 12, 'easeInOut');
        sk('y', mid, base.y + 12, 'easeInOut');
        sk('y', fullEnd, base.y - 12, 'linear');
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
