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
  { key: 'rotZ', label: 'Camera Roll Z (°)', step: 1 },
  { key: 'zoom', label: 'Camera Zoom', step: 0.05 },
  { key: 'opacity', label: 'Opacity', step: 0.05 },
  { key: 'anchorX', label: 'Anchor X', step: 1 },
  { key: 'anchorY', label: 'Anchor Y', step: 1 },
  { key: 'volume', label: 'Audio Volume', step: 0.05 },
  { key: 'intensity', label: 'Effect / Filter Intensity', step: 0.05 },
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

export const INTENSITY_LANE_GROUP = {
  key: 'intensity',
  label: 'Intensitas',
  icon: 'bi-sliders',
  color: '#fbbf24',
  props: ['intensity'],
  defaultProps: ['intensity'],
  primaryProp: 'intensity'
};

export const CAMERA_LANE_GROUPS = [
  {
    key: 'position',
    label: 'Posisi 3D (X/Y/Z)',
    icon: 'bi-arrows-move',
    color: '#38bdf8',
    props: ['x', 'y', 'z'],
    defaultProps: ['x', 'y', 'z'],
    primaryProp: 'x'
  },
  {
    key: 'rotation',
    label: 'Rotasi 3D',
    icon: 'bi-arrow-repeat',
    color: '#f472b6',
    props: ['rotX', 'rotY', 'rotZ'],
    defaultProps: ['rotX', 'rotY', 'rotZ'],
    primaryProp: 'rotY'
  },
  {
    key: 'zoom',
    label: 'Zoom Kamera',
    icon: 'bi-zoom-in',
    color: '#a78bfa',
    props: ['zoom'],
    defaultProps: ['zoom'],
    primaryProp: 'zoom'
  }
];

export const EASING_TYPES = [
  { key: 'linear', label: 'Linear' },
  { key: 'easeIn', label: 'Ease In' },
  { key: 'easeOut', label: 'Ease Out' },
  { key: 'easeInOut', label: 'Ease In-Out' },
  { key: 'smooth', label: 'Smooth Spline' },
  { key: 'easeOutBack', label: 'Overshoot' },
  { key: 'spring', label: 'Spring Bounce' },
  { key: 'anticipate', label: 'Anticipate' },
  { key: 'hold', label: 'Hold (Tetap)' },
  { key: 'cubicBezier', label: 'Cubic Bezier' }
];

export const CUBIC_BEZIER_PRESETS = [
  { id: 'smooth', label: 'CapCut Smooth', bezier: [0.25, 0.1, 0.25, 1.0] },
  { id: 'snappy', label: 'Snappy Out', bezier: [0.16, 1.0, 0.3, 1.0] },
  { id: 'fastCut', label: 'Fast Cut', bezier: [0.7, 0.0, 0.2, 1.0] },
  { id: 'overshoot', label: 'Pop Overshoot', bezier: [0.34, 1.45, 0.64, 1.0] },
  { id: 'anticipate', label: 'Anticipate', bezier: [0.36, -0.35, 0.65, 1.0] }
];

export const ANIMATION_PRESETS = [
  { id: 'textPopBounce', cat: 'in', target: 'text', label: 'Pop Teks', icon: 'bi-type' },
  { id: 'textSlideUpFade', cat: 'in', target: 'text', label: 'Muncul Bawah', icon: 'bi-arrow-up-short' },
  { id: 'textZoomFocus', cat: 'in', target: 'text', label: 'Fokus Teks', icon: 'bi-zoom-in' },
  { id: 'textTypeReveal', cat: 'in', target: 'text', label: 'Kilap Masuk', icon: 'bi-stars' },
  { id: 'textFadeDown', cat: 'out', target: 'text', label: 'Turun Pudar', icon: 'bi-arrow-down-short' },
  { id: 'textZoomFadeOut', cat: 'out', target: 'text', label: 'Kecil Pudar', icon: 'bi-zoom-out' },
  { id: 'textPulseGlow', cat: 'combo', target: 'text', label: 'Denyut Teks', icon: 'bi-heart-pulse' },
  { id: 'textWaveFloat', cat: 'combo', target: 'text', label: 'Ayun Teks', icon: 'bi-stopwatch' },
  { id: 'textWiggle', cat: 'combo', target: 'text', label: 'Getar Teks', icon: 'bi-vibrate' },
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
    if (prop === 'intensity') {
      if (layer.adjustmentKind === 'effect') {
        const firstActive = Array.isArray(layer.vfxStack) ? layer.vfxStack.find((v) => v && v.enabled !== false && v.type !== 'none') : null;
        return firstActive?.intensity ?? layer.vfx?.intensity ?? 0.75;
      }
      return layer.filterIntensity ?? 1;
    }
    if (prop === 'zoom') return layer.type === 'camera' ? 1 : (layer.transform?.zoom ?? 1);
    const base = layer.transform || {};
    if (prop === 'scaleX' || prop === 'scaleY' || prop === 'opacity') return base[prop] ?? 1;
    return base[prop] ?? 0;
  },

  getLaneGroupByKey(laneKey, layer = null) {
    if (layer?.type === 'camera') {
      const camGroup = CAMERA_LANE_GROUPS.find((g) => g.key === laneKey);
      if (camGroup) return camGroup;
    }
    if (laneKey === 'zoom') return CAMERA_LANE_GROUPS[2];
    if (laneKey === 'intensity') return INTENSITY_LANE_GROUP;
    return KEYFRAME_LANE_GROUPS.find((g) => g.key === laneKey) || null;
  },

  getVisibleKeyframeLanes(layer) {
    if (!layer) return [];
    if (layer.type === 'camera') {
      return CAMERA_LANE_GROUPS.map((g) => ({ ...g, props: [...g.props], defaultProps: [...g.defaultProps] }));
    }
    const hasProps = (props) => props.some((p) => (layer.keyframes?.[p]?.length || 0) > 0);
    const base = KEYFRAME_LANE_GROUPS.filter((g) => {
      if (hasProps(g.props)) return true;
      if (layer.type === 'audio') return g.key === 'volume';
      if (layer.type === 'adjustment') return g.key === 'opacity' || g.key === 'color';
      if (g.key === 'volume') return layer.type === 'video' || Boolean(layer.audioProps);
      return true;
    });
    if (
      layer.type === 'adjustment' &&
      (layer.adjustmentKind === 'filter' || layer.adjustmentKind === 'effect' || hasProps(['intensity']))
    ) {
      base.push(INTENSITY_LANE_GROUP);
    } else if (layer.type !== 'adjustment' && hasProps(['intensity'])) {
      base.push(INTENSITY_LANE_GROUP);
    }
    return base;
  },

  setKeyframe(target, prop, frame, value, easing = 'easeInOut', bezier = [0.42, 0, 0.58, 1], opts = null) {
    const f = Math.round(frame);
    if (!Number.isFinite(f)) return null;
    const storedVal = prop === 'color'
      ? normalizeHexColor(String(value || '#ffffff'), '#ffffff')
      : Number(value);
    if (prop !== 'color' && !Number.isFinite(storedVal)) return null;
    const list = this.ensurePropTrack(target, prop);
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

  getAllCameraKeyframeFrames(camera) {
    const set = new Set();
    if (!camera?.keyframes) return [];
    for (const arr of Object.values(camera.keyframes)) {
      if (!Array.isArray(arr)) continue;
      for (const k of arr) set.add(k.frame);
    }
    return Array.from(set).sort((a, b) => a - b);
  },

  hasAnyCameraKeyframeAtFrame(camera, frame) {
    const f = Math.round(frame);
    if (!camera?.keyframes) return false;
    return Object.values(camera.keyframes).some((arr) => Array.isArray(arr) && arr.some((k) => k.frame === f));
  },

  getPrevKeyframeFrame(targetOrFrames, currentFrame) {
    const f = Math.round(currentFrame);
    const frames = Array.isArray(targetOrFrames)
      ? [...targetOrFrames].sort((a, b) => a - b)
      : this.getAllKeyframeFrames(targetOrFrames);
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i] < f) return frames[i];
    }
    return null;
  },

  getNextKeyframeFrame(targetOrFrames, currentFrame) {
    const f = Math.round(currentFrame);
    const frames = Array.isArray(targetOrFrames)
      ? [...targetOrFrames].sort((a, b) => a - b)
      : this.getAllKeyframeFrames(targetOrFrames);
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] > f) return frames[i];
    }
    return null;
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

  togglePropLaneKeyframeAtFrame(layer, laneKey, frame, easing = 'easeInOut', opts = {}) {
    const group = this.getLaneGroupByKey(laneKey, layer);
    if (!layer || !group) return { added: false, laneKey };
    const f = Math.max(layer.startFrame || 0, Math.min(layer.endFrame ?? frame, Math.round(frame)));
    const exists = group.props.some((p) => Boolean(this.getKeyframeAtFrame(layer, p, f)));
    if (exists) {
      this.removePropGroupKeyframe(layer, group.props, f);
      return { added: false, laneKey, frame: f };
    }
    const tf = this.getTransformAtFrame(layer, f);
    let targetProps = [...group.defaultProps];
    if (layer.type !== 'camera') {
      if (laneKey === 'position') {
        const has3DPos = Boolean(opts?.is3D) || Math.abs(tf.z || 0) > 1e-4 || (layer.keyframes?.z?.length || 0) > 0;
        if (has3DPos && !targetProps.includes('z')) targetProps.push('z');
      } else if (laneKey === 'rotation') {
        const has3DRot = Boolean(opts?.is3D) || Math.abs(tf.rotX || 0) > 1e-4 || Math.abs(tf.rotY || 0) > 1e-4 ||
          (layer.keyframes?.rotX?.length || 0) > 0 || (layer.keyframes?.rotY?.length || 0) > 0;
        if (has3DRot) {
          if (!targetProps.includes('rotX')) targetProps.push('rotX');
          if (!targetProps.includes('rotY')) targetProps.push('rotY');
        }
      }
    }
    for (const p of targetProps) {
      let val;
      if (p === 'color') {
        val = this.getColorAtFrame(layer, f, this.getDefaultPropValue(layer, 'color'));
      } else if (p === 'volume' || p === 'intensity' || p === 'zoom' || p === 'rotZ' || layer.type === 'camera') {
        val = this.getValueAtFrame(layer, p, f, this.getDefaultPropValue(layer, p));
      } else {
        val = tf[p] ?? this.getDefaultPropValue(layer, p);
      }
      this.setKeyframe(layer, p, f, val, easing);
    }
    return { added: true, laneKey, frame: f };
  },

  getSegmentEasingAtFrame(target, prop, frame) {
    const f = Math.round(frame);
    const list = target?.keyframes?.[prop];
    if (!Array.isArray(list) || list.length === 0) {
      return { easing: 'easeInOut', bezier: [0.42, 0, 0.58, 1] };
    }
    const sorted = [...list].sort((a, b) => a.frame - b.frame);
    if (f <= sorted[0].frame) {
      return {
        easing: sorted[0].easing || 'easeInOut',
        bezier: [...(sorted[0].bezier || [0.42, 0, 0.58, 1])]
      };
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (f >= a.frame && f <= b.frame) {
        return {
          easing: a.easing || 'linear',
          bezier: [...(a.bezier || [0.42, 0, 0.58, 1])]
        };
      }
    }
    const last = sorted[sorted.length - 1];
    return {
      easing: last.easing || 'easeInOut',
      bezier: [...(last.bezier || [0.42, 0, 0.58, 1])]
    };
  },

  partitionKeyframesAtSplit(orig, right, splitFrame) {
    const f = Math.round(splitFrame);
    if (!orig?.keyframes) return;
    if (!right.keyframes) right.keyframes = {};
    for (const prop of Object.keys(orig.keyframes)) {
      const list = orig.keyframes[prop];
      if (!Array.isArray(list) || list.length === 0) continue;
      const fallback = this.getDefaultPropValue(orig, prop);
      const valAtSplit = this.getValueAtFrame(orig, prop, f, fallback);
      const seg = this.getSegmentEasingAtFrame(orig, prop, f);
      const hasBoundary = list.some((k) => k.frame === f);
      const firstF = list[0]?.frame ?? f;
      const lastF = list[list.length - 1]?.frame ?? f;
      orig.keyframes[prop] = list.filter((k) => k.frame <= f).map((k) => ({ ...k, bezier: [...(k.bezier || [0.42, 0, 0.58, 1])] }));
      right.keyframes[prop] = (right.keyframes[prop] || []).filter((k) => k.frame >= f).map((k) => ({ ...k, bezier: [...(k.bezier || [0.42, 0, 0.58, 1])] }));
      if (!hasBoundary && f > firstF && f < lastF) {
        this.setKeyframe(orig, prop, f, valAtSplit, seg.easing, seg.bezier);
        this.setKeyframe(right, prop, f, valAtSplit, seg.easing, seg.bezier);
      } else if (!hasBoundary && orig.keyframes[prop].length > 0 && right.keyframes[prop].length > 0) {
        this.setKeyframe(orig, prop, f, valAtSplit, seg.easing, seg.bezier);
        this.setKeyframe(right, prop, f, valAtSplit, seg.easing, seg.bezier);
      }
    }
  },

  trimKeyframesAtBoundary(layer, keepSide, splitFrame) {
    const f = Math.round(splitFrame);
    if (!layer?.keyframes) return;
    for (const prop of Object.keys(layer.keyframes)) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list) || list.length === 0) continue;
      const fallback = this.getDefaultPropValue(layer, prop);
      const valAtSplit = this.getValueAtFrame(layer, prop, f, fallback);
      const seg = this.getSegmentEasingAtFrame(layer, prop, f);
      const hasBoundary = list.some((k) => k.frame === f);
      const hadBefore = list.some((k) => k.frame < f);
      const hadAfter = list.some((k) => k.frame > f);
      layer.keyframes[prop] = keepSide === 'right'
        ? list.filter((k) => k.frame >= f)
        : list.filter((k) => k.frame <= f);
      if (!hasBoundary && hadBefore && hadAfter) {
        this.setKeyframe(layer, prop, f, valAtSplit, seg.easing, seg.bezier);
      }
    }
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
        if (span <= 0 || frame === b.frame) return b.value;
        const easingMode = a.easing || 'linear';
        if (easingMode === 'hold') {
          return a.value;
        }
        const rawT = (frame - a.frame) / span;
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
        if (span <= 0 || frame === b.frame) return normalizeHexColor(String(b.value), safeFallback);
        if (a.easing === 'hold') return normalizeHexColor(String(a.value), safeFallback);
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
        const offsets = [0, -18, 18, -12, 12, -5, 0];
        const span = Math.max(6, end - start);
        let prevF = -1;
        offsets.forEach((dx, i) => {
          let f = Math.min(layer.endFrame, start + Math.round((i / (offsets.length - 1)) * span));
          if (f <= prevF) f = Math.min(layer.endFrame, prevF + 1);
          if (f > prevF) {
            sk('x', f, base.x + dx, 'linear');
            prevF = f;
          }
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
      case 'textPopBounce': {
        const mid1 = start + Math.round((end - start) * 0.55);
        const mid2 = start + Math.round((end - start) * 0.8);
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + Math.max(4, Math.round((end - start) * 0.35))), base.opacity ?? 1, 'linear');
        sk('scaleX', start, 0.25, 'easeOut');
        sk('scaleY', start, 0.25, 'easeOut');
        sk('scaleX', mid1, base.scaleX * 1.18, 'easeInOut');
        sk('scaleY', mid1, base.scaleY * 1.18, 'easeInOut');
        sk('scaleX', mid2, base.scaleX * 0.95, 'easeInOut');
        sk('scaleY', mid2, base.scaleY * 0.95, 'easeInOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        break;
      }
      case 'textSlideUpFade':
        sk('y', start, base.y + Math.round(projectHeight * 0.14), 'easeOut');
        sk('y', end, base.y, 'linear');
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + Math.max(6, Math.round((end - start) * 0.65))), base.opacity ?? 1, 'linear');
        break;
      case 'textZoomFocus':
        sk('scaleX', start, base.scaleX * 1.45, 'easeOut');
        sk('scaleY', start, base.scaleY * 1.45, 'easeOut');
        sk('scaleX', end, base.scaleX, 'linear');
        sk('scaleY', end, base.scaleY, 'linear');
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', Math.min(end, start + Math.max(6, Math.round((end - start) * 0.6))), base.opacity ?? 1, 'linear');
        break;
      case 'textTypeReveal':
        sk('opacity', start, 0, 'easeOut');
        sk('opacity', end, base.opacity ?? 1, 'linear');
        sk('x', start, base.x - Math.round(projectWidth * 0.06), 'easeOut');
        sk('x', end, base.x, 'linear');
        break;
      case 'textFadeDown':
        sk('y', outStart, base.y, 'easeIn');
        sk('y', outEnd, base.y + Math.round(projectHeight * 0.14), 'linear');
        sk('opacity', outStart, base.opacity ?? 1, 'easeIn');
        sk('opacity', outEnd, 0, 'linear');
        break;
      case 'textZoomFadeOut':
        sk('scaleX', outStart, base.scaleX, 'easeIn');
        sk('scaleY', outStart, base.scaleY, 'easeIn');
        sk('scaleX', outEnd, Math.max(0.1, base.scaleX * 0.55), 'linear');
        sk('scaleY', outEnd, Math.max(0.1, base.scaleY * 0.55), 'linear');
        sk('opacity', outStart, base.opacity ?? 1, 'easeIn');
        sk('opacity', outEnd, 0, 'linear');
        break;
      case 'textPulseGlow': {
        const half = Math.max(4, Math.round((fullEnd - start) / 2));
        const q1 = start + Math.round(half / 2);
        sk('scaleX', start, base.scaleX, 'easeInOut');
        sk('scaleY', start, base.scaleY, 'easeInOut');
        sk('scaleX', q1, base.scaleX * 1.1, 'easeInOut');
        sk('scaleY', q1, base.scaleY * 1.1, 'easeInOut');
        sk('scaleX', start + half, base.scaleX, 'easeInOut');
        sk('scaleY', start + half, base.scaleY, 'easeInOut');
        sk('scaleX', fullEnd, base.scaleX, 'linear');
        sk('scaleY', fullEnd, base.scaleY, 'linear');
        break;
      }
      case 'textWaveFloat': {
        const t1 = start + Math.round((fullEnd - start) * 0.25);
        const t2 = start + Math.round((fullEnd - start) * 0.5);
        const t3 = start + Math.round((fullEnd - start) * 0.75);
        sk('rotation', start, base.rotation - 6, 'easeInOut');
        sk('rotation', t1, base.rotation + 6, 'easeInOut');
        sk('rotation', t2, base.rotation - 5, 'easeInOut');
        sk('rotation', t3, base.rotation + 5, 'easeInOut');
        sk('rotation', fullEnd, base.rotation, 'linear');
        break;
      }
      case 'textWiggle': {
        const offsets = [0, -10, 10, -8, 8, -3, 0];
        const span = Math.max(6, end - start);
        let prevF = -1;
        offsets.forEach((dx, i) => {
          let f = Math.min(layer.endFrame, start + Math.round((i / (offsets.length - 1)) * span));
          if (f <= prevF) f = Math.min(layer.endFrame, prevF + 1);
          if (f > prevF) {
            sk('x', f, base.x + dx, 'linear');
            prevF = f;
          }
        });
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
  },

  /**
   * Commits a staged 3D Layer pose explicitly after the user moves in 3D and clicks Add Keyframe.
   * Implements CapCut's Rule of Two: if a 3D/position/rotation prop has no keyframes yet and
   * frame > layer.startFrame, anchors the previous saved value at layer.startFrame first.
   */
  commitStaged3DLayerPose(layer, frame, stagedProps, easing = 'easeInOut') {
    if (!layer || !stagedProps) return 0;
    const f = Math.max(layer.startFrame || 0, Math.min(layer.endFrame ?? frame, Math.round(frame)));
    const anchorF = Math.max(0, Math.round(layer.startFrame || 0));
    const props = ['x', 'y', 'z', 'scaleX', 'scaleY', 'rotation', 'rotX', 'rotY'];
    const priorTf = this.getTransformAtFrame(layer, f);
    let committed = 0;

    for (const prop of props) {
      if (!Object.prototype.hasOwnProperty.call(stagedProps, prop)) continue;
      const nextVal = Number(stagedProps[prop]);
      if (!Number.isFinite(nextVal)) continue;
      const prevVal = Number(priorTf[prop] ?? this.getDefaultPropValue(layer, prop));
      const trackLen = layer.keyframes?.[prop]?.length || 0;
      const is3DAxis = prop === 'z' || prop === 'rotX' || prop === 'rotY';
      const changed = Math.abs(nextVal - prevVal) > 1e-4;
      if (!changed && trackLen === 0 && !is3DAxis) continue;
      if (trackLen === 0 && f > anchorF && changed) {
        const baseStartVal = Number(layer.transform?.[prop] ?? this.getDefaultPropValue(layer, prop));
        this.setKeyframe(layer, prop, anchorF, baseStartVal, easing);
      } else if (trackLen === 0 && f === anchorF && layer.transform) {
        layer.transform[prop] = nextVal;
      }
      this.setKeyframe(layer, prop, f, nextVal, easing);
      committed++;
    }
    return committed;
  },

  /**
   * Commits a staged 3D Camera pose explicitly after the user moves the 3D camera and clicks Add Keyframe.
   * Anchors F0 with the previous camera value if no keyframes exist yet and frame > 0.
   */
  commitStaged3DCameraPose(camera, frame, stagedCam, easing = 'smooth') {
    if (!camera || !stagedCam) return 0;
    const f = Math.max(0, Math.round(frame));
    camera.enabled = true;
    const priorCam = this.getCameraAtFrame(camera, f);
    const props = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'zoom'];
    let committed = 0;

    for (const prop of props) {
      if (!Object.prototype.hasOwnProperty.call(stagedCam, prop)) continue;
      const nextVal = Number(stagedCam[prop]);
      if (!Number.isFinite(nextVal)) continue;
      const prevVal = Number(priorCam[prop] ?? (prop === 'zoom' ? 1 : 0));
      const trackLen = camera.keyframes?.[prop]?.length || 0;
      const changed = Math.abs(nextVal - prevVal) > 1e-4;
      if (trackLen === 0 && f > 0 && changed) {
        const baseVal = Number(camera[prop] ?? (prop === 'zoom' ? 1 : 0));
        this.setKeyframe(camera, prop, 0, baseVal, easing);
      } else if (trackLen === 0 && f === 0) {
        camera[prop] = nextVal;
      }
      this.setKeyframe(camera, prop, f, nextVal, easing);
      committed++;
    }
    return committed;
  },

  /**
   * Batch-shifts multiple selected keyframes by deltaFrames cleanly (avoiding frame collisions inside the batch).
   * items: Array<{ layerId, laneKey?, props?, frame }>
   */
  moveSelectedKeyframes(project, items, deltaFrames) {
    const df = Math.round(Number(deltaFrames) || 0);
    if (!project?.layers || !Array.isArray(items) || items.length === 0 || df === 0) return 0;
    const minFrame = Math.min(...items.map((it) => Math.round(Number(it.frame) || 0)));
    const safeDelta = Math.max(-minFrame, df);
    if (safeDelta === 0) return 0;

    const extracted = [];
    for (const it of items) {
      const layer = project.layers.find((l) => l.id === it.layerId);
      if (!layer?.keyframes) continue;
      const group = it.props?.length ? { props: it.props } : this.getLaneGroupByKey(it.laneKey, layer);
      const props = group?.props || [];
      const f = Math.round(it.frame);
      for (const prop of props) {
        const list = layer.keyframes[prop];
        if (!Array.isArray(list)) continue;
        const idx = list.findIndex((k) => k.frame === f);
        if (idx >= 0) {
          const [kf] = list.splice(idx, 1);
          extracted.push({ layer, prop, kf, newFrame: Math.max(0, f + safeDelta) });
        }
      }
    }

    for (const ex of extracted) {
      const list = this.ensurePropTrack(ex.layer, ex.prop);
      const colIdx = list.findIndex((k) => k.frame === ex.newFrame);
      if (colIdx >= 0) list.splice(colIdx, 1);
      ex.kf.frame = ex.newFrame;
      list.push(ex.kf);
      list.sort((a, b) => a.frame - b.frame);
    }
    return extracted.length;
  },

  setSelectedKeyframesEasing(project, items, easing, bezier = null) {
    if (!project?.layers || !Array.isArray(items) || items.length === 0) return 0;
    let updated = 0;
    for (const it of items) {
      const layer = project.layers.find((l) => l.id === it.layerId);
      if (!layer) continue;
      const group = it.props?.length ? { props: it.props } : this.getLaneGroupByKey(it.laneKey, layer);
      if (!group) continue;
      if (this.setPropGroupEasing(layer, group.props, it.frame, easing, bezier)) {
        updated++;
      }
    }
    return updated;
  },

  removeSelectedKeyframes(project, items) {
    if (!project?.layers || !Array.isArray(items) || items.length === 0) return 0;
    let removed = 0;
    for (const it of items) {
      const layer = project.layers.find((l) => l.id === it.layerId);
      if (!layer) continue;
      const group = it.props?.length ? { props: it.props } : this.getLaneGroupByKey(it.laneKey, layer);
      if (!group) continue;
      if (this.removePropGroupKeyframe(layer, group.props, it.frame)) {
        removed++;
      }
    }
    return removed;
  },

  cloneKeyframesForClipboard(project, items) {
    if (!project?.layers || !Array.isArray(items) || items.length === 0) return null;
    const minFrame = Math.min(...items.map((it) => Math.round(Number(it.frame) || 0)));
    const copied = [];
    for (const it of items) {
      const layer = project.layers.find((l) => l.id === it.layerId);
      if (!layer?.keyframes) continue;
      const group = it.props?.length ? { props: it.props, key: it.laneKey } : this.getLaneGroupByKey(it.laneKey, layer);
      if (!group) continue;
      const f = Math.round(it.frame);
      for (const prop of group.props) {
        const kf = this.getKeyframeAtFrame(layer, prop, f);
        if (!kf) continue;
        copied.push({
          layerId: layer.id,
          laneKey: it.laneKey || group.key,
          prop,
          offset: f - minFrame,
          value: kf.value,
          easing: kf.easing || 'easeInOut',
          bezier: [...(kf.bezier || [0.42, 0, 0.58, 1])]
        });
      }
    }
    return copied.length > 0 ? { minFrame, items: copied } : null;
  },

  pasteKeyframesAtFrame(project, clipboard, targetFrame, fallbackLayerId = null) {
    if (!project?.layers || !clipboard?.items?.length) return [];
    const baseFrame = Math.max(0, Math.round(targetFrame));
    const pastedRefs = [];
    const seenKeys = new Set();
    for (const item of clipboard.items) {
      const layer = project.layers.find((l) => l.id === item.layerId)
        || (fallbackLayerId ? project.layers.find((l) => l.id === fallbackLayerId) : null);
      if (!layer) continue;
      const f = Math.max(0, baseFrame + Math.round(item.offset || 0));
      this.setKeyframe(layer, item.prop, f, item.value, item.easing, item.bezier);
      const refKey = `${layer.id}|${item.laneKey}|${f}`;
      if (!seenKeys.has(refKey)) {
        seenKeys.add(refKey);
        pastedRefs.push({ layerId: layer.id, laneKey: item.laneKey, frame: f });
      }
    }
    return pastedRefs;
  }
};
