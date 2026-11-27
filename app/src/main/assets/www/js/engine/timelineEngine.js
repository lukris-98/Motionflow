import { deepClone, uid } from '../utils/math.js';
import { KeyframeEngine } from './keyframeEngine.js';
import { WasmBridge } from './wasmBridge.js';

export const SPEED_CURVE_PRESETS = {
  none: { label: 'Normal (Constant)', pts: [[0, 1], [1, 1]] },
  montage: { label: 'Montage', pts: [[0, 0.5], [0.25, 2.2], [0.6, 0.55], [0.85, 2.4], [1, 1.0]] },
  hero: { label: 'Hero Time', pts: [[0, 1.8], [0.35, 0.35], [0.65, 0.35], [1, 1.8]] },
  bullet: { label: 'Bullet Slow', pts: [[0, 2.5], [0.3, 0.3], [0.7, 0.3], [1, 2.5]] },
  jumpCut: { label: 'Jump Cut', pts: [[0, 0.7], [0.45, 2.8], [0.55, 2.8], [1, 0.7]] },
  flashIn: { label: 'Flash In', pts: [[0, 2.8], [0.35, 1.0], [1, 1.0]] },
  flashOut: { label: 'Flash Out', pts: [[0, 1.0], [0.65, 1.0], [1, 2.8]] }
};

export function createBaseLayer(type, name, project, overrides = {}) {
  const fps = project.fps || 30;
  const defaultLen = Math.min(project.durationFrames, fps * 4);
  return {
    id: uid('layer'),
    type,
    name,
    adjustmentKind: overrides.adjustmentKind || null, // 'filter' | 'effect' | 'adjust' | null
    trackRole: overrides.trackRole ?? null, // 'main' | 'overlay' | null
    colorMatch: overrides.colorMatch || null,
    parentId: null,
    startFrame: overrides.startFrame ?? 0,
    endFrame: overrides.endFrame ?? defaultLen,
    mediaOffsetFrames: 0,
    speed: 1.0,
    speedCurve: overrides.speedCurve || 'none',
    customSpeedCurve: Array.isArray(overrides.customSpeedCurve) ? deepClone(overrides.customSpeedCurve) : null,
    visible: true,
    locked: false,
    trackCompact: Boolean(overrides.trackCompact),
    transform: {
      x: 0,
      y: 0,
      z: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      rotX: 0,
      rotY: 0,
      opacity: 1,
      anchorX: 0,
      anchorY: 0,
      ...(overrides.transform || {})
    },
    keyframes: {},
    mediaId: overrides.mediaId || null,
    width: overrides.width || 400,
    height: overrides.height || 300,
    blendMode: overrides.blendMode || 'normal',
    reversed: Boolean(overrides.reversed),
    flipX: Boolean(overrides.flipX),
    flipY: Boolean(overrides.flipY),
    filterId: overrides.filterId || 'normal',
    filterIntensity: overrides.filterIntensity ?? 1.0,
    crop: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      ...(overrides.crop || {})
    },
    vfx: {
      type: 'none',
      intensity: 0.65,
      speed: 1.0,
      ...(overrides.vfx || {})
    },
    vfxStack: Array.isArray(overrides.vfxStack)
      ? deepClone(overrides.vfxStack)
      : (overrides.vfx && overrides.vfx.type && overrides.vfx.type !== 'none'
          ? [{
              id: uid('vfx'),
              type: overrides.vfx.type,
              intensity: overrides.vfx.intensity ?? 0.65,
              speed: overrides.vfx.speed ?? 1.0,
              enabled: true
            }]
          : []),
    fx: {
      brightness: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      fade: 0,
      sharpen: 0,
      blur: 0,
      vignette: 0,
      grain: 0,
      outlineWidth: 0,
      outlineColor: '#FFFFFF',
      hsl: Array.from({ length: 8 }, () => [0, 0, 0]),
      chromaEnabled: false,
      chromaColor: '#00FF00',
      chromaSimilarity: 0.35,
      chromaSmoothness: 0.12,
      chromaSpill: 0.5,
      ...(overrides.fx || {})
    },
    mask: {
      type: 'none',
      scaleX: 0.85,
      scaleY: 0.85,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      feather: 0.05,
      invert: false,
      ...(overrides.mask || {})
    },
    transitions: {
      inType: 'none',
      inFrames: 15,
      outType: 'none',
      outFrames: 15,
      ...(overrides.transitions || {})
    },
    motionBlur: {
      enabled: Boolean(overrides.motionBlur?.enabled),
      strength: Number.isFinite(Number(overrides.motionBlur?.strength))
        ? Math.max(0.1, Math.min(1.5, Number(overrides.motionBlur.strength)))
        : 0.7
    },
    textProps: overrides.textProps || null,
    shapeProps: overrides.shapeProps || null,
    audioProps: overrides.audioProps || null,
    trackData: overrides.trackData || null,
    pinnedSourceLayerId: overrides.pinnedSourceLayerId || null
  };
}

export const TimelineEngine = {
  createTextLayer(project, startFrame = 0) {
    const len = Math.min(project.durationFrames - startFrame, project.fps * 4);
    return createBaseLayer('text', 'Title Text', project, {
      startFrame,
      endFrame: startFrame + Math.max(15, len),
      width: 600,
      height: 140,
      textProps: {
        text: 'MOTIONFLOW',
        fontFamily: 'sans-serif',
        fontSize: 72,
        fontWeight: '800',
        italic: false,
        underline: false,
        textCase: 'normal',
        letterSpacing: 0,
        lineHeight: 1.18,
        curve: 0,
        color: '#FFFFFF',
        gradientEnabled: false,
        gradientColor2: '#00E5FF',
        align: 'center',
        strokeColor: '#00E5FF',
        strokeWidth: 0,
        shadowColor: 'rgba(0,0,0,0.65)',
        shadowBlur: 12,
        shadowOffsetY: 4,
        bgEnabled: false,
        bgColor: '#0B0E14',
        bgOpacity: 0.78,
        bgRadius: 16,
        bgPadding: 20
      }
    });
  },

  createShapeLayer(project, shapeType = 'rectangle', startFrame = 0) {
    const len = Math.min(project.durationFrames - startFrame, project.fps * 4);
    const labelMap = {
      rectangle: 'Rectangle',
      circle: 'Circle',
      ellipse: 'Ellipse',
      line: 'Line'
    };
    return createBaseLayer('shape', labelMap[shapeType] || 'Shape', project, {
      startFrame,
      endFrame: startFrame + Math.max(15, len),
      width: shapeType === 'ellipse' ? 320 : 240,
      height: shapeType === 'line' ? 12 : shapeType === 'ellipse' ? 180 : 240,
      shapeProps: {
        shapeType,
        fillColor: '#7C4DFF',
        strokeColor: '#00E5FF',
        strokeWidth: shapeType === 'line' ? 8 : 3,
        cornerRadius: shapeType === 'rectangle' ? 20 : 0
      }
    });
  },

  createGroupLayer(project, startFrame = 0) {
    const len = Math.min(project.durationFrames - startFrame, project.fps * 5);
    return createBaseLayer('group', 'Motion Group', project, {
      startFrame,
      endFrame: startFrame + Math.max(30, len),
      width: 300,
      height: 300
    });
  },

  createAdjustmentLayer(project, startFrame = 0, options = {}) {
    const fps = project.fps || 30;
    const avail = Math.max(30, (project.durationFrames || fps * 4) - startFrame);
    const requestedLen = Number(options.durationFrames);
    const len = Number.isFinite(requestedLen) && requestedLen >= 15
      ? Math.round(requestedLen)
      : Math.min(avail, fps * 4);
    const safeStart = Math.max(0, Math.round(startFrame || 0));
    const adjKind = options.adjustmentKind || (options.vfx || options.vfxStack ? 'effect' : options.filterId ? 'filter' : 'adjust');
    const defaultName = adjKind === 'filter'
      ? 'Filter'
      : adjKind === 'effect'
        ? 'Effect FX'
        : 'Adjustment FX';
    const layer = createBaseLayer('adjustment', options.name || defaultName, project, {
      adjustmentKind: adjKind,
      trackRole: 'overlay',
      startFrame: safeStart,
      endFrame: safeStart + Math.max(15, len),
      width: project.width || 1280,
      height: project.height || 720,
      filterId: options.filterId || 'normal',
      filterIntensity: options.filterIntensity ?? 1.0,
      fx: options.fx || undefined,
      vfx: options.vfx || undefined,
      vfxStack: options.vfxStack || undefined
    });
    if (options.vfxStack && options.vfxStack.length > 0) {
      layer._vfxStackExplicit = true;
      this.normalizeLayerVfxStack(layer);
    }
    return layer;
  },

  createMediaLayer(project, mediaItem, startFrame = 0, overrides = {}) {
    const fps = project.fps || 30;
    const rawDurFrames = Math.max(15, Math.round(((mediaItem.durationMs || 4000) / 1000) * fps));
    const endFrame = startFrame + rawDurFrames;

    // Fit nicely into canvas while preserving aspect ratio
    const maxW = project.width * 0.85;
    const maxH = project.height * 0.85;
    const mw = mediaItem.width || 640;
    const mh = mediaItem.height || 360;
    const fitScale = mediaItem.type === 'audio' ? 1 : Math.min(maxW / mw, maxH / mh, 1);

    const role = mediaItem.type === 'audio'
      ? null
      : (overrides.trackRole === 'main' ? 'main' : (overrides.trackRole ?? null));

    return createBaseLayer(mediaItem.type, mediaItem.name || 'Media Clip', project, {
      trackRole: role,
      startFrame,
      endFrame: Math.max(startFrame + 15, endFrame),
      mediaId: mediaItem.id,
      width: Math.round(mw * fitScale),
      height: Math.round(mh * fitScale),
      audioProps: mediaItem.type === 'audio' || mediaItem.type === 'video'
        ? {
            volume: 1.0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            muted: false,
            voiceEffect: 'none',
            reduceNoise: false,
            normalize: false
          }
        : null
    });
  },

  CAMERA_PROPS: ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'zoom'],

  getCameraLayer(project) {
    return project?.layers?.find((l) => l && l.type === 'camera') || null;
  },

  createCameraLayer(project, options = {}) {
    const fps = Math.max(1, project?.fps || 30);
    const maxCamKf = Math.max(0, ...KeyframeEngine.getAllCameraKeyframeFrames(project?.camera));
    const endF = Math.max(project?.durationFrames || fps * 5, maxCamKf, fps * 5);
    return createBaseLayer('camera', options.name || '3D Camera Rec', project, {
      trackRole: 'overlay',
      startFrame: options.startFrame ?? 0,
      endFrame: options.endFrame ?? endF,
      ...options
    });
  },

  syncCameraToLayer(project, camLayer = null) {
    const layer = camLayer || this.getCameraLayer(project);
    if (!layer || !project?.camera) return null;
    if (!layer.keyframes) layer.keyframes = {};
    let maxFrame = 0;
    for (const prop of this.CAMERA_PROPS) {
      const list = project.camera.keyframes?.[prop];
      if (Array.isArray(list) && list.length > 0) {
        layer.keyframes[prop] = deepClone(list).sort((a, b) => a.frame - b.frame);
        maxFrame = Math.max(maxFrame, layer.keyframes[prop][layer.keyframes[prop].length - 1].frame);
      } else {
        layer.keyframes[prop] = [];
      }
    }
    if (maxFrame > (layer.endFrame || 0)) {
      layer.endFrame = maxFrame;
      this.ensureProjectDuration(project, maxFrame);
    }
    return layer;
  },

  syncLayerToCamera(project, camLayer = null) {
    const layer = camLayer || this.getCameraLayer(project);
    if (!layer || !project?.camera) return false;
    if (!project.camera.keyframes) {
      project.camera.keyframes = { x: [], y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: [] };
    }
    let hasAny = false;
    for (const prop of this.CAMERA_PROPS) {
      const list = layer.keyframes?.[prop];
      if (Array.isArray(list) && list.length > 0) {
        project.camera.keyframes[prop] = deepClone(list).sort((a, b) => a.frame - b.frame);
        hasAny = true;
      } else {
        project.camera.keyframes[prop] = [];
      }
    }
    if (hasAny) project.camera.enabled = true;
    return true;
  },

  getOrCreateCameraLayer(project, options = {}) {
    if (!project) return null;
    let camLayer = this.getCameraLayer(project);
    if (!camLayer) {
      camLayer = this.createCameraLayer(project, options);
      camLayer.kfExpanded = options.kfExpanded !== undefined ? Boolean(options.kfExpanded) : true;
      project.layers.unshift(camLayer);
      this.normalizeTrackZOrder(project);
    } else if (options.kfExpanded !== undefined) {
      camLayer.kfExpanded = Boolean(options.kfExpanded);
    }
    this.syncCameraToLayer(project, camLayer);
    return camLayer;
  },

  addLayer(project, layer) {
    project.layers.unshift(layer);
    this.ensureProjectDuration(project, layer.endFrame);
    return layer;
  },

  deleteLayer(project, layerId) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return false;
    const removed = project.layers[idx];
    // Ungroup any children and detach tracking pins first
    project.layers.forEach((l) => {
      if (l.parentId === layerId) l.parentId = null;
      if (l.pinnedSourceLayerId === layerId) l.pinnedSourceLayerId = null;
    });
    project.layers.splice(idx, 1);
    if (removed?.type === 'camera' && project.camera) {
      project.camera.keyframes = { x: [], y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: [] };
    }
    return true;
  },

  duplicateLayer(project, layerId) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return null;
    const copy = deepClone(project.layers[idx]);
    copy.id = uid('layer');
    copy.name = `${copy.name} Copy`;
    if (copy.type !== 'adjustment' && copy.type !== 'audio' && copy.type !== 'camera') {
      copy.transform.x += 24;
      copy.transform.y += 24;
    }
    project.layers.splice(idx, 0, copy);
    return copy;
  },

  reorderLayer(project, layerId, direction) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return false;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= project.layers.length) return false;
    const [item] = project.layers.splice(idx, 1);
    project.layers.splice(targetIdx, 0, item);
    return true;
  },

  moveLayerToIndex(project, layerId, targetIdx) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return false;
    const clamped = Math.max(0, Math.min(project.layers.length - 1, targetIdx));
    if (idx === clamped) return false;
    const [item] = project.layers.splice(idx, 1);
    project.layers.splice(clamped, 0, item);
    return true;
  },

  assignToGroup(project, layerId, groupId) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer || layer.id === groupId) return false;
    if (layer.type === 'group') return false;
    layer.parentId = groupId || null;
    return true;
  },

  groupSelectedLayers(project, layerIds) {
    const valid = project.layers.filter((l) => layerIds.includes(l.id) && l.type !== 'group');
    if (valid.length === 0) return null;
    const minStart = Math.min(...valid.map((l) => l.startFrame));
    const maxEnd = Math.max(...valid.map((l) => l.endFrame));
    const group = this.createGroupLayer(project, minStart);
    group.endFrame = maxEnd;
    project.layers.unshift(group);
    valid.forEach((l) => { l.parentId = group.id; });
    return group;
  },

  ungroupChildren(project, groupId) {
    project.layers.forEach((l) => {
      if (l.parentId === groupId) l.parentId = null;
    });
  },

  detachAudioFromVideo(project, videoLayerId) {
    const vidLayer = project.layers.find((l) => l.id === videoLayerId);
    if (!vidLayer || vidLayer.type !== 'video' || !vidLayer.mediaId) return null;
    const ap = vidLayer.audioProps || {};
    const audioLayer = createBaseLayer('audio', `${vidLayer.name} (Audio)`, project, {
      trackRole: null,
      startFrame: vidLayer.startFrame,
      endFrame: vidLayer.endFrame,
      mediaId: vidLayer.mediaId,
      speedCurve: vidLayer.speedCurve || 'none',
      customSpeedCurve: Array.isArray(vidLayer.customSpeedCurve) ? deepClone(vidLayer.customSpeedCurve) : null,
      reversed: Boolean(vidLayer.reversed),
      audioProps: {
        volume: ap.volume ?? 1.0,
        fadeInFrames: ap.fadeInFrames ?? 0,
        fadeOutFrames: ap.fadeOutFrames ?? 0,
        muted: false,
        voiceEffect: ap.voiceEffect || 'none',
        reduceNoise: Boolean(ap.reduceNoise),
        normalize: Boolean(ap.normalize)
      }
    });
    audioLayer.mediaOffsetFrames = vidLayer.mediaOffsetFrames || 0;
    audioLayer.speed = vidLayer.speed || 1;
    audioLayer.detachedFromLayerId = vidLayer.id;
    if (Array.isArray(vidLayer.keyframes?.volume) && vidLayer.keyframes.volume.length > 0) {
      audioLayer.keyframes.volume = deepClone(vidLayer.keyframes.volume);
    }
    if (!vidLayer.audioProps) {
      vidLayer.audioProps = {
        volume: 1,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        muted: true,
        voiceEffect: 'none',
        reduceNoise: false,
        normalize: false
      };
    }
    vidLayer.audioProps.muted = true;
    vidLayer.audioDetached = true;
    project.layers.push(audioLayer);
    this.normalizeTrackZOrder(project);
    return audioLayer;
  },

  splitClipAtFrame(project, layerId, frame) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return null;
    const orig = project.layers[idx];
    const f = Math.round(frame);
    if (f <= orig.startFrame + 2 || f >= orig.endFrame - 2) return null;

    const origStart = orig.startFrame;
    const origEnd = orig.endFrame;
    const origOffset = orig.mediaOffsetFrames || 0;
    const spd = orig.speed || 1;
    const reversed = Boolean(orig.reversed);

    const wasmOffsets = WasmBridge.splitOffsets(origStart, origEnd, f, origOffset, spd, reversed);
    const leftOffset = wasmOffsets
      ? wasmOffsets.leftOffset
      : reversed
        ? origOffset + Math.round((origEnd - f) * spd)
        : origOffset;
    const rightOffset = wasmOffsets
      ? wasmOffsets.rightOffset
      : reversed
        ? origOffset
        : origOffset + Math.round((f - origStart) * spd);

    const right = deepClone(orig);
    right.id = uid('layer');
    right.name = `${orig.name} (2)`;
    right.startFrame = f;
    right.mediaOffsetFrames = rightOffset;
    orig.mediaOffsetFrames = leftOffset;

    // Reset inner seam transitions on split (keep outer In on left half, outer Out on right half)
    if (!orig.transitions) orig.transitions = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };
    if (!right.transitions) right.transitions = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };
    orig.transitions.outType = 'none';
    right.transitions.inType = 'none';

    // Partition keyframes cleanly while preserving default values, easing curves, and continuity at the split frame
    KeyframeEngine.partitionKeyframesAtSplit(orig, right, f);
    orig.endFrame = f;
    project.layers.splice(idx, 0, right);
    return right;
  },

  moveClip(project, layerId, newStartFrame, snapEnabled = true, playheadFrame = 0, threshold = 4) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return { startFrame: 0, endFrame: 0, snapInfo: { snapped: false, guideFrame: null, kind: null, label: null } };
    const oldStart = layer.startFrame;
    const len = layer.endFrame - oldStart;
    const rawStart = Math.max(0, Math.round(newStartFrame));

    const snapInfo = this.snapFrameWithMeta(project, layerId, rawStart, len, playheadFrame, threshold, snapEnabled);
    let targetStart = snapInfo.startFrame;
    if (layer.trackRole === 'main' && project.settings?.rippleMode === false) {
      targetStart = this.resolveNonOverlappingMainStart(project, layerId, len, targetStart);
    }
    const delta = targetStart - oldStart;
    layer.startFrame = targetStart;
    layer.endFrame = targetStart + len;
    if (delta !== 0 && layer.keyframes) {
      for (const prop of Object.keys(layer.keyframes)) {
        const list = layer.keyframes[prop];
        if (!Array.isArray(list)) continue;
        for (const kf of list) {
          kf.frame = Math.max(0, kf.frame + delta);
        }
      }
    }
    this.ensureProjectDuration(project, layer.endFrame);
    return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo };
  },

  trimClip(project, layerId, edge, newFrame, snapEnabled = true, playheadFrame = 0, threshold = 4) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return { startFrame: 0, endFrame: 0, snapInfo: { snapped: false, guideFrame: null, kind: null, label: null } };
    const isRight = edge === 'right';
    const minLen = 5;
    const rawTarget = Math.max(0, Math.round(newFrame));
    const bounds = isRight
      ? { minFrame: layer.startFrame + minLen }
      : { maxFrame: layer.endFrame - minLen };
    const edgeSnap = this.snapEdgeFrameWithMeta(project, layerId, rawTarget, playheadFrame, snapEnabled, threshold, bounds);
    const snappedTarget = edgeSnap.frame;

    const wasmRes = WasmBridge.trimBounds(
      isRight,
      layer.startFrame,
      layer.endFrame,
      layer.mediaOffsetFrames || 0,
      snappedTarget,
      layer.speed || 1,
      false,
      playheadFrame
    );
    if (wasmRes) {
      layer.startFrame = wasmRes.startFrame;
      layer.endFrame = wasmRes.endFrame;
      layer.mediaOffsetFrames = wasmRes.mediaOffsetFrames;
      if (isRight) this.ensureProjectDuration(project, layer.endFrame);
      return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo: edgeSnap };
    }

    if (!isRight) {
      const maxStart = layer.endFrame - minLen;
      const clamped = Math.max(0, Math.min(snappedTarget, maxStart));
      const diff = clamped - layer.startFrame;
      layer.startFrame = clamped;
      layer.mediaOffsetFrames = Math.max(0, (layer.mediaOffsetFrames || 0) + Math.round(diff * (layer.speed || 1)));
    } else {
      layer.endFrame = Math.max(layer.startFrame + minLen, snappedTarget);
      this.ensureProjectDuration(project, layer.endFrame);
    }
    return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo: edgeSnap };
  },

  setClipSpeed(project, layerId, newSpeed) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const clampedSpeed = Math.max(0.25, Math.min(4.0, Number(newSpeed) || 1));
    const oldSpeed = layer.speed || 1;
    const ratio = oldSpeed / clampedSpeed;
    const oldLen = Math.max(5, layer.endFrame - layer.startFrame);
    const newLen = Math.max(5, Math.round(oldLen * ratio));
    layer.speed = clampedSpeed;
    layer.endFrame = layer.startFrame + newLen;
    if (layer.keyframes && Math.abs(ratio - 1) > 1e-4) {
      for (const prop of Object.keys(layer.keyframes)) {
        const list = layer.keyframes[prop];
        if (!Array.isArray(list)) continue;
        for (const kf of list) {
          kf.frame = Math.max(0, Math.round(layer.startFrame + (kf.frame - layer.startFrame) * ratio));
        }
        list.sort((a, b) => a.frame - b.frame);
      }
    }
    this.ensureProjectDuration(project, layer.endFrame);
  },

  collectSnapPoints(project, excludeLayerId = null, playheadFrame = 0) {
    const points = [];
    const safePlayhead = Math.max(0, Math.round(Number(playheadFrame) || 0));
    points.push({ frame: safePlayhead, kind: 'playhead', label: 'Playhead', priority: 0 });

    if (Array.isArray(project?.layers)) {
      for (const l of project.layers) {
        if (!l || l.id === excludeLayerId) continue;
        const sf = Math.max(0, Math.round(Number(l.startFrame) || 0));
        const ef = Math.max(0, Math.round(Number(l.endFrame) || 0));
        points.push({ frame: sf, kind: 'clip', label: 'Clip', priority: 1 });
        points.push({ frame: ef, kind: 'clip', label: 'Clip', priority: 1 });
      }
    }

    if (Array.isArray(project?.markers)) {
      for (const m of project.markers) {
        const f = typeof m === 'number' ? m : Number(m?.frame);
        if (!Number.isFinite(f)) continue;
        const lbl = typeof m === 'object' && m?.label ? String(m.label) : 'Marker';
        points.push({ frame: Math.max(0, Math.round(f)), kind: 'marker', label: lbl, priority: 2 });
      }
    }

    if (Array.isArray(project?.beatMarkers)) {
      for (const bf of project.beatMarkers) {
        const f = Number(bf);
        if (!Number.isFinite(f)) continue;
        points.push({ frame: Math.max(0, Math.round(f)), kind: 'beat', label: 'Beat', priority: 3 });
      }
    }

    points.push({ frame: 0, kind: 'zero', label: '0s', priority: 4 });
    return points;
  },

  snapEdgeFrameWithMeta(project, excludeLayerId, candidateFrame, playheadFrame = 0, snapEnabled = true, threshold = 4, bounds = null) {
    const raw = Math.round(Number(candidateFrame) || 0);
    if (!snapEnabled) {
      return { frame: raw, snapped: false, guideFrame: null, kind: null, label: null };
    }
    const maxDist = Math.max(1, Math.round(Number(threshold) || 4));
    const points = this.collectSnapPoints(project, excludeLayerId, playheadFrame);
    let best = null;
    for (const sp of points) {
      if (bounds?.minFrame !== undefined && sp.frame < bounds.minFrame) continue;
      if (bounds?.maxFrame !== undefined && sp.frame > bounds.maxFrame) continue;
      const dist = Math.abs(raw - sp.frame);
      if (dist > maxDist) continue;
      if (
        !best ||
        dist < best.dist ||
        (dist === best.dist && sp.priority < best.priority)
      ) {
        best = { ...sp, dist };
      }
    }
    if (!best) {
      return { frame: raw, snapped: false, guideFrame: null, kind: null, label: null };
    }
    return { frame: best.frame, snapped: true, guideFrame: best.frame, kind: best.kind, label: best.label };
  },

  snapFrameWithMeta(project, movingLayerId, candidateStart, clipLen, playheadFrame = 0, threshold = 4, snapEnabled = true) {
    const baseStart = Math.max(0, Math.round(Number(candidateStart) || 0));
    const len = Math.max(1, Math.round(Number(clipLen) || 0));
    if (!snapEnabled) {
      return { startFrame: baseStart, snapped: false, guideFrame: null, edge: null, kind: null, label: null };
    }
    const maxDist = Math.max(1, Math.round(Number(threshold) || 4));
    const points = this.collectSnapPoints(project, movingLayerId, playheadFrame);
    const candidateEnd = baseStart + len;

    let best = null;
    for (const sp of points) {
      const distStart = Math.abs(baseStart - sp.frame);
      if (distStart <= maxDist) {
        const score = { dist: distStart, edgeRank: 0, priority: sp.priority, startFrame: Math.max(0, sp.frame), guideFrame: sp.frame, edge: 'start', kind: sp.kind, label: sp.label };
        if (
          !best ||
          score.dist < best.dist ||
          (score.dist === best.dist && (score.priority < best.priority || (score.priority === best.priority && score.edgeRank < best.edgeRank)))
        ) {
          best = score;
        }
      }

      if (sp.frame - len >= 0) {
        const distEnd = Math.abs(candidateEnd - sp.frame);
        if (distEnd <= maxDist) {
          const score = { dist: distEnd, edgeRank: 1, priority: sp.priority, startFrame: sp.frame - len, guideFrame: sp.frame, edge: 'end', kind: sp.kind, label: sp.label };
          if (
            !best ||
            score.dist < best.dist ||
            (score.dist === best.dist && (score.priority < best.priority || (score.priority === best.priority && score.edgeRank < best.edgeRank)))
          ) {
            best = score;
          }
        }
      }
    }

    if (!best) {
      return { startFrame: baseStart, snapped: false, guideFrame: null, edge: null, kind: null, label: null };
    }
    return {
      startFrame: best.startFrame,
      snapped: true,
      guideFrame: best.guideFrame,
      edge: best.edge,
      kind: best.kind,
      label: best.label
    };
  },

  snapFrame(project, movingLayerId, candidateStart, clipLen, playheadFrame, threshold = 4) {
    return this.snapFrameWithMeta(project, movingLayerId, candidateStart, clipLen, playheadFrame, threshold, true).startFrame;
  },

  ensureProjectDuration(project, endFrame) {
    if (endFrame > project.durationFrames) {
      project.durationFrames = endFrame + (project.fps || 30) * 2;
    }
  },

  evaluateCurveArrayFactor(pts, normT) {
    if (!Array.isArray(pts) || pts.length === 0) return 1.0;
    const t = Math.max(0, Math.min(1, Number(normT) || 0));
    const normPts = pts
      .map((p) => Array.isArray(p)
        ? [Math.max(0, Math.min(1, Number(p[0]) || 0)), Math.max(0.15, Math.min(5.0, Number(p[1]) || 1))]
        : [Math.max(0, Math.min(1, Number(p?.t) || 0)), Math.max(0.15, Math.min(5.0, Number(p?.v) || 1))])
      .sort((a, b) => a[0] - b[0]);
    if (normPts.length === 1) return normPts[0][1];
    if (t <= normPts[0][0]) return normPts[0][1];
    if (t >= normPts[normPts.length - 1][0]) return normPts[normPts.length - 1][1];

    for (let i = 0; i < normPts.length - 1; i++) {
      const [t0, v0] = normPts[i];
      const [t1, v1] = normPts[i + 1];
      if (t >= t0 && t <= t1) {
        const h = Math.max(1e-4, t1 - t0);
        const u = (t - t0) / h;
        if (normPts.length === 2) {
          return v0 + (v1 - v0) * u;
        }
        // Smooth Catmull-Rom / cubic Hermite interpolation clamped gently inside [0.15, 5.0]
        const pPrev = normPts[Math.max(0, i - 1)];
        const pNext = normPts[Math.min(normPts.length - 1, i + 2)];
        const m0 = i === 0 ? (v1 - v0) / h : (v1 - pPrev[1]) / Math.max(1e-4, t1 - pPrev[0]);
        const m1 = i === normPts.length - 2 ? (v1 - v0) / h : (pNext[1] - v0) / Math.max(1e-4, pNext[0] - t0);
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        const val = h00 * v0 + h10 * h * m0 + h01 * v1 + h11 * h * m1;
        const minNeighbor = Math.min(v0, v1) * 0.85;
        const maxNeighbor = Math.max(v0, v1) * 1.15;
        return Math.max(0.15, Math.min(5.0, Math.max(minNeighbor, Math.min(maxNeighbor, val))));
      }
    }
    return normPts[normPts.length - 1][1] ?? 1.0;
  },

  getLayerSpeedCurvePoints(layer) {
    if (Array.isArray(layer?.customSpeedCurve) && layer.customSpeedCurve.length >= 2) {
      return layer.customSpeedCurve
        .map((p) => Array.isArray(p)
          ? [Math.max(0, Math.min(1, Number(p[0]) || 0)), Math.max(0.15, Math.min(5.0, Number(p[1]) || 1))]
          : [Math.max(0, Math.min(1, Number(p?.t) || 0)), Math.max(0.15, Math.min(5.0, Number(p?.v) || 1))])
        .sort((a, b) => a[0] - b[0]);
    }
    const curve = SPEED_CURVE_PRESETS[layer?.speedCurve || 'none'];
    if (curve && Array.isArray(curve.pts)) {
      return curve.pts.map(([t, v]) => [t, v]);
    }
    return [[0, 1], [1, 1]];
  },

  evaluateLayerSpeedFactor(layer, normT) {
    if (!layer) return 1.0;
    const hasCustom = Array.isArray(layer.customSpeedCurve) && layer.customSpeedCurve.length >= 2;
    if (!hasCustom && (!layer.speedCurve || layer.speedCurve === 'none')) return 1.0;
    return this.evaluateCurveArrayFactor(this.getLayerSpeedCurvePoints(layer), normT);
  },

  evaluateSpeedCurveFactor(curveIdOrPts, normT) {
    if (Array.isArray(curveIdOrPts)) {
      return this.evaluateCurveArrayFactor(curveIdOrPts, normT);
    }
    const curve = SPEED_CURVE_PRESETS[curveIdOrPts];
    if (!curve || curveIdOrPts === 'none') return 1.0;
    return this.evaluateCurveArrayFactor(curve.pts, normT);
  },

  integrateSpeedCurveSourceFrames(layer, localTimelineFrames) {
    const dur = Math.max(1, layer.endFrame - layer.startFrame);
    const clampedLocal = Math.max(0, Math.min(dur, localTimelineFrames));
    const baseSpeed = Math.max(0.25, Math.min(4.0, layer.speed || 1));
    const hasCustom = Array.isArray(layer?.customSpeedCurve) && layer.customSpeedCurve.length >= 2;
    if (!hasCustom && (!layer.speedCurve || layer.speedCurve === 'none')) {
      return clampedLocal * baseSpeed;
    }
    const pts = this.getLayerSpeedCurvePoints(layer);
    const steps = Math.max(8, Math.min(64, Math.ceil(clampedLocal)));
    const dt = clampedLocal / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const midT = ((i + 0.5) * dt) / dur;
      sum += this.evaluateCurveArrayFactor(pts, midT) * baseSpeed * dt;
    }
    return sum;
  },

  rippleDeleteLayer(project, layerId) {
    const idx = project.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return false;
    const target = project.layers[idx];
    const delStart = target.startFrame;
    const delEnd = target.endFrame;
    const gapLen = Math.max(0, delEnd - delStart);

    this.deleteLayer(project, layerId);
    if (gapLen > 0) {
      for (const l of project.layers) {
        if (l.startFrame >= delEnd) {
          l.startFrame = Math.max(delStart, l.startFrame - gapLen);
          l.endFrame = Math.max(l.startFrame + 5, l.endFrame - gapLen);
          if (l.keyframes) {
            for (const prop of Object.keys(l.keyframes)) {
              const list = l.keyframes[prop];
              if (!Array.isArray(list)) continue;
              for (const kf of list) {
                kf.frame = Math.max(0, kf.frame - gapLen);
              }
            }
          }
        }
      }
    }
    return true;
  },

  replaceLayerMedia(project, layerId, mediaItem) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer || !mediaItem) return false;
    layer.mediaId = mediaItem.id;
    layer.name = mediaItem.name || layer.name;
    layer.mediaOffsetFrames = 0;
    layer.trackData = null;
    layer.stabilizer = null;
    if (mediaItem.type === 'video' || mediaItem.type === 'image') {
      if (layer.type === 'video' || layer.type === 'image') {
        layer.type = mediaItem.type;
      }
      if (mediaItem.type === 'image') {
        layer.reversed = false;
      }
      const maxW = project.width * 0.85;
      const maxH = project.height * 0.85;
      const mw = mediaItem.width || 640;
      const mh = mediaItem.height || 360;
      const fitScale = Math.min(maxW / mw, maxH / mh, 1);
      layer.width = Math.round(mw * fitScale);
      layer.height = Math.round(mh * fitScale);
      if (mediaItem.type === 'video' && !layer.audioProps) {
        layer.audioProps = {
          volume: 1.0,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          muted: false,
          voiceEffect: 'none',
          reduceNoise: false,
          normalize: false
        };
      }
    }
    return true;
  },

  insertFreezeFrame(project, sourceLayerId, atFrame, frozenMediaItem, durationFrames = null) {
    const src = project.layers.find((l) => l.id === sourceLayerId);
    if (!src || !frozenMediaItem) return null;
    const fps = project.fps || 30;
    const freezeLen = Math.max(15, Math.round(durationFrames || fps * 3));
    const f = Math.max(src.startFrame, Math.min(src.endFrame, Math.round(atFrame)));

    let insertAt = f;
    let rightSeg = null;
    if (f > src.startFrame + 2 && f < src.endFrame - 2) {
      rightSeg = this.splitClipAtFrame(project, src.id, f);
    } else if (f >= src.endFrame - 2) {
      insertAt = src.endFrame;
    } else {
      insertAt = src.startFrame;
    }

    // Shift right segment and any layers starting at or after insertAt so frozen frame plays in place
    for (const l of project.layers) {
      if (l.id === src.id) continue;
      if (l === rightSeg || l.startFrame >= insertAt) {
        l.startFrame += freezeLen;
        l.endFrame += freezeLen;
        if (l.keyframes) {
          for (const prop of Object.keys(l.keyframes)) {
            const list = l.keyframes[prop];
            if (!Array.isArray(list)) continue;
            for (const kf of list) kf.frame += freezeLen;
          }
        }
        this.ensureProjectDuration(project, l.endFrame);
      }
    }

    const tf = KeyframeEngine.getTransformAtFrame(src, f);
    const freezeLayer = createBaseLayer('image', `${src.name} (Freeze)`, project, {
      startFrame: insertAt,
      endFrame: insertAt + freezeLen,
      mediaId: frozenMediaItem.id,
      width: src.width,
      height: src.height,
      blendMode: src.blendMode,
      fx: deepClone(src.fx),
      mask: deepClone(src.mask),
      transform: { ...tf }
    });
    freezeLayer.isFreezeFrame = true;
    const srcIdx = project.layers.findIndex((l) => l.id === src.id);
    project.layers.splice(Math.max(0, srcIdx), 0, freezeLayer);
    this.ensureProjectDuration(project, freezeLayer.endFrame);
    return freezeLayer;
  },

  toggleTimelineMarker(project, frame, label = '') {
    if (!Array.isArray(project.markers)) project.markers = [];
    const f = Math.max(0, Math.round(frame));
    const existingIdx = project.markers.findIndex((m) => {
      const mf = typeof m === 'number' ? m : Number(m?.frame);
      return Number.isFinite(mf) && Math.abs(mf - f) <= 2;
    });
    if (existingIdx >= 0) {
      project.markers.splice(existingIdx, 1);
      return false;
    }
    project.markers.push({
      id: uid('mkr'),
      frame: f,
      label: label ? String(label) : `M${project.markers.length + 1}`,
      color: '#34d399'
    });
    project.markers.sort((a, b) => (typeof a === 'number' ? a : a.frame) - (typeof b === 'number' ? b : b.frame));
    return true;
  },

  toggleBeatMarker(project, frame) {
    if (!Array.isArray(project.beatMarkers)) project.beatMarkers = [];
    const f = Math.max(0, Math.round(frame));
    const existingIdx = project.beatMarkers.findIndex((m) => Math.abs(m - f) <= 2);
    if (existingIdx >= 0) {
      project.beatMarkers.splice(existingIdx, 1);
      return false;
    }
    project.beatMarkers.push(f);
    project.beatMarkers.sort((a, b) => a - b);
    return true;
  },

  applyFilterWithIntensity(layer, filterId, filterFx, intensity = 1) {
    if (!layer || !filterFx) return;
    const t = Math.max(0, Math.min(1, Number(intensity)));
    layer.filterId = filterId;
    layer.filterIntensity = t;
    if (!layer.fx) layer.fx = {};
    const baseFx = {
      brightness: 0, contrast: 1, saturation: 1, temperature: 0,
      tint: 0, exposure: 0, highlights: 0, shadows: 0, fade: 0, vignette: 0
    };
    for (const k of Object.keys(baseFx)) {
      const target = filterFx[k] ?? baseFx[k];
      layer.fx[k] = Number((baseFx[k] + (target - baseFx[k]) * t).toFixed(3));
    }
  },

  getActiveVfxList(layer) {
    if (!layer) return [];
    const stack = Array.isArray(layer.vfxStack) ? layer.vfxStack : [];
    if (stack.length > 0) {
      // Preserve direct mutations to layer.vfx when only 1 stack item exists
      if (stack.length === 1 && !layer._vfxStackExplicit && layer.vfx) {
        if (!layer.vfx.type || layer.vfx.type === 'none') {
          return [];
        }
        if (stack[0].type !== layer.vfx.type) {
          return [{
            id: stack[0].id || 'primary',
            type: layer.vfx.type,
            intensity: layer.vfx.intensity ?? 0.65,
            speed: layer.vfx.speed ?? 1.0,
            enabled: true
          }];
        }
      }
      const enabled = stack.filter((v) => v && v.enabled !== false && v.type && v.type !== 'none');
      if (enabled.length > 0) return enabled;
    }
    if (layer.vfx && layer.vfx.type && layer.vfx.type !== 'none') {
      return [{
        id: 'primary',
        type: layer.vfx.type,
        intensity: layer.vfx.intensity ?? 0.65,
        speed: layer.vfx.speed ?? 1.0,
        enabled: true
      }];
    }
    return [];
  },

  normalizeLayerVfxStack(layer) {
    if (!layer) return [];
    if (!Array.isArray(layer.vfxStack)) layer.vfxStack = [];
    if (layer.vfxStack.length === 0 && layer.vfx && layer.vfx.type && layer.vfx.type !== 'none') {
      layer.vfxStack.push({
        id: uid('vfx'),
        type: layer.vfx.type,
        intensity: layer.vfx.intensity ?? 0.65,
        speed: layer.vfx.speed ?? 1.0,
        enabled: true
      });
    }
    layer.vfxStack = layer.vfxStack
      .filter((v) => v && v.type && v.type !== 'none')
      .map((v) => ({
        id: v.id || uid('vfx'),
        type: v.type,
        intensity: Math.max(0.05, Math.min(1.5, Number(v.intensity ?? 0.65))),
        speed: Math.max(0.2, Math.min(3.0, Number(v.speed ?? 1.0))),
        enabled: v.enabled !== false
      }));
    const firstActive = layer.vfxStack.find((v) => v.enabled !== false);
    if (!layer.vfx) layer.vfx = { type: 'none', intensity: 0.65, speed: 1.0 };
    if (firstActive) {
      layer.vfx.type = firstActive.type;
      layer.vfx.intensity = firstActive.intensity;
      layer.vfx.speed = firstActive.speed;
    } else {
      layer.vfx.type = 'none';
    }
    return layer.vfxStack;
  },

  setPrimaryLayerVfx(layer, typeId, intensity = null, speed = null) {
    if (!layer) return [];
    layer._vfxStackExplicit = true;
    this.normalizeLayerVfxStack(layer);
    if (!typeId || typeId === 'none') {
      layer.vfxStack = [];
      layer.vfx = { type: 'none', intensity: 0.65, speed: 1.0 };
      return [];
    }
    const existing = layer.vfxStack[0];
    if (existing) {
      existing.type = typeId;
      existing.enabled = true;
      if (intensity !== null) existing.intensity = Number(intensity);
      if (speed !== null) existing.speed = Number(speed);
    } else {
      layer.vfxStack.push({
        id: uid('vfx'),
        type: typeId,
        intensity: intensity ?? layer.vfx?.intensity ?? 0.65,
        speed: speed ?? layer.vfx?.speed ?? 1.0,
        enabled: true
      });
    }
    return this.normalizeLayerVfxStack(layer);
  },

  addLayerVfx(layer, typeId, intensity = 0.65, speed = 1.0) {
    if (!layer || !typeId || typeId === 'none') return null;
    layer._vfxStackExplicit = true;
    this.normalizeLayerVfxStack(layer);
    const entry = {
      id: uid('vfx'),
      type: typeId,
      intensity: Math.max(0.05, Math.min(1.5, Number(intensity) || 0.65)),
      speed: Math.max(0.2, Math.min(3.0, Number(speed) || 1.0)),
      enabled: true
    };
    layer.vfxStack.push(entry);
    this.normalizeLayerVfxStack(layer);
    return entry;
  },

  removeLayerVfx(layer, vfxId) {
    if (!layer) return false;
    layer._vfxStackExplicit = true;
    this.normalizeLayerVfxStack(layer);
    const prevLen = layer.vfxStack.length;
    layer.vfxStack = layer.vfxStack.filter((v) => v.id !== vfxId);
    this.normalizeLayerVfxStack(layer);
    return layer.vfxStack.length !== prevLen;
  },

  toggleLayerVfx(layer, vfxId) {
    if (!layer) return false;
    layer._vfxStackExplicit = true;
    this.normalizeLayerVfxStack(layer);
    const item = layer.vfxStack.find((v) => v.id === vfxId);
    if (!item) return false;
    item.enabled = item.enabled === false;
    this.normalizeLayerVfxStack(layer);
    return true;
  },

  updateLayerVfx(layer, vfxId, patch = {}) {
    if (!layer) return false;
    layer._vfxStackExplicit = true;
    this.normalizeLayerVfxStack(layer);
    const item = layer.vfxStack.find((v) => v.id === vfxId);
    if (!item) return false;
    if (patch.intensity !== undefined) item.intensity = Math.max(0.05, Math.min(1.5, Number(patch.intensity)));
    if (patch.speed !== undefined) item.speed = Math.max(0.2, Math.min(3.0, Number(patch.speed)));
    if (patch.enabled !== undefined) item.enabled = Boolean(patch.enabled);
    if (patch.type !== undefined) item.type = patch.type;
    this.normalizeLayerVfxStack(layer);
    return true;
  },

  countActiveEffects(layer) {
    if (!layer) return 0;
    let count = this.getActiveVfxList(layer).length;
    if (layer.filterId && layer.filterId !== 'normal') count++;
    const fx = layer.fx || {};
    const hasAdj =
      Math.abs(fx.brightness || 0) > 0.01 ||
      Math.abs((fx.contrast ?? 1) - 1) > 0.01 ||
      Math.abs((fx.saturation ?? 1) - 1) > 0.01 ||
      Math.abs(fx.temperature || 0) > 0.01 ||
      Math.abs(fx.tint || 0) > 0.01 ||
      Math.abs(fx.exposure || 0) > 0.01 ||
      Math.abs(fx.blur || 0) > 0.05 ||
      Math.abs(fx.vignette || 0) > 0.01 ||
      Math.abs(fx.grain || 0) > 0.01 ||
      Math.abs(fx.sharpen || 0) > 0.01;
    if (hasAdj && (!layer.filterId || layer.filterId === 'normal')) count++;
    if (layer.mask?.type && layer.mask.type !== 'none') count++;
    if (fx.chromaEnabled) count++;
    if (layer.colorMatch?.enabled) count++;
    return count;
  },

  setMarkerColor(project, markerId, color) {
    if (!Array.isArray(project?.markers)) return false;
    const m = project.markers.find((item) => item && typeof item === 'object' && item.id === markerId);
    if (!m) return false;
    m.color = String(color || '#34d399');
    return true;
  },

  removeMarkerById(project, markerId) {
    if (!Array.isArray(project?.markers)) return false;
    const prev = project.markers.length;
    project.markers = project.markers.filter((item, idx) => {
      const id = typeof item === 'object' ? item?.id : `mkr_${idx}`;
      return id !== markerId;
    });
    return project.markers.length !== prev;
  },

  getCutPointFrames(project) {
    const set = new Set([0]);
    if (!project) return [0];
    if (Number.isFinite(project.durationFrames)) {
      set.add(Math.max(0, Math.round(project.durationFrames)));
    }
    if (Array.isArray(project.layers)) {
      for (const l of project.layers) {
        if (Number.isFinite(l.startFrame)) set.add(Math.max(0, Math.round(l.startFrame)));
        if (Number.isFinite(l.endFrame)) set.add(Math.max(0, Math.round(l.endFrame)));
      }
    }
    if (Array.isArray(project.markers)) {
      for (const m of project.markers) {
        const f = typeof m === 'number' ? m : Number(m?.frame);
        if (Number.isFinite(f)) set.add(Math.max(0, Math.round(f)));
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  },

  cloneLayersForClipboard(project, layerIds) {
    if (!project || !Array.isArray(layerIds) || layerIds.length === 0) return [];
    const idSet = new Set(layerIds);
    return project.layers
      .filter((l) => idSet.has(l.id))
      .map((l) => deepClone(l));
  },

  pasteLayersAtFrame(project, clipboardLayers, targetFrame = 0) {
    if (!project || !Array.isArray(clipboardLayers) || clipboardLayers.length === 0) return [];
    const minStart = Math.min(...clipboardLayers.map((l) => Number(l.startFrame) || 0));
    const anchor = Math.max(0, Math.round(targetFrame));
    const idMap = new Map();
    const pasted = clipboardLayers.map((orig) => {
      const copy = deepClone(orig);
      const oldId = copy.id;
      copy.id = uid('layer');
      idMap.set(oldId, copy.id);
      copy.name = `${copy.name} Copy`;
      if (copy.trackRole === 'main') {
        copy.trackRole = 'overlay';
      }
      const offset = (Number(copy.startFrame) || 0) - minStart;
      const len = Math.max(5, (Number(copy.endFrame) || 0) - (Number(copy.startFrame) || 0));
      const nextStart = anchor + offset;
      const delta = nextStart - (Number(copy.startFrame) || 0);
      copy.startFrame = nextStart;
      copy.endFrame = nextStart + len;
      if (delta !== 0) {
        this.shiftLayerKeyframes(copy, delta);
      }
      if (copy.type !== 'adjustment' && copy.type !== 'audio' && copy.type !== 'camera') {
        copy.transform.x = (copy.transform?.x || 0) + 18;
        copy.transform.y = (copy.transform?.y || 0) + 18;
      }
      return copy;
    });
    for (const copy of pasted) {
      if (copy.parentId && idMap.has(copy.parentId)) {
        copy.parentId = idMap.get(copy.parentId);
      } else if (copy.parentId && !project.layers.some((l) => l.id === copy.parentId)) {
        copy.parentId = null;
      }
      project.layers.unshift(copy);
      this.ensureProjectDuration(project, copy.endFrame);
    }
    this.normalizeTrackZOrder(project);
    return pasted;
  },

  applyAutoReframe(project, layer, mode = 'smart') {
    if (!project || !layer || layer.type === 'audio' || layer.type === 'group' || layer.type === 'adjustment') {
      return false;
    }
    const projW = Math.max(1, project.width || 1080);
    const projH = Math.max(1, project.height || 1920);
    const clipW = Math.max(1, layer.width || projW);
    const clipH = Math.max(1, layer.height || projH);

    // Cover ratio guarantees frame fills the target aspect without black bars
    const coverScale = Math.max(projW / clipW, projH / clipH);
    const safeScale = Number((coverScale * (mode === 'dynamic' ? 1.12 : 1.03)).toFixed(3));
    const maxPanX = Math.max(0, (clipW * safeScale - projW) * 0.48);
    const maxPanY = Math.max(0, (clipH * safeScale - projH) * 0.48);

    layer.transform.scaleX = safeScale;
    layer.transform.scaleY = safeScale;
    layer.transform.anchorX = 0;
    layer.transform.anchorY = 0;

    if (layer.trackData && Array.isArray(layer.trackData.points) && layer.trackData.points.length >= 2) {
      const pts = layer.trackData.points;
      const step = Math.max(1, Math.floor(pts.length / 8));
      layer.keyframes.x = [];
      layer.keyframes.y = [];
      layer.keyframes.scaleX = [];
      layer.keyframes.scaleY = [];
      for (let i = 0; i < pts.length; i += step) {
        const pt = pts[i];
        const px = Math.max(-maxPanX, Math.min(maxPanX, -(Number(pt.x) || 0) * 0.75));
        const py = Math.max(-maxPanY, Math.min(maxPanY, -(Number(pt.y) || 0) * 0.75));
        KeyframeEngine.setKeyframe(layer, 'x', pt.frame, Number(px.toFixed(1)), 'smooth');
        KeyframeEngine.setKeyframe(layer, 'y', pt.frame, Number(py.toFixed(1)), 'smooth');
        KeyframeEngine.setKeyframe(layer, 'scaleX', pt.frame, safeScale, 'linear');
        KeyframeEngine.setKeyframe(layer, 'scaleY', pt.frame, safeScale, 'linear');
      }
    } else if (mode === 'dynamic' && maxPanX > 12) {
      const s = layer.startFrame;
      const e = layer.endFrame;
      const m = Math.round((s + e) * 0.5);
      KeyframeEngine.setKeyframe(layer, 'x', s, Number((-maxPanX * 0.65).toFixed(1)), 'smooth');
      KeyframeEngine.setKeyframe(layer, 'x', m, 0, 'smooth');
      KeyframeEngine.setKeyframe(layer, 'x', e, Number((maxPanX * 0.65).toFixed(1)), 'smooth');
      KeyframeEngine.setKeyframe(layer, 'y', s, 0, 'linear');
      KeyframeEngine.setKeyframe(layer, 'scaleX', s, safeScale, 'linear');
      KeyframeEngine.setKeyframe(layer, 'scaleY', s, safeScale, 'linear');
    } else {
      layer.transform.x = 0;
      layer.transform.y = 0;
      if (layer.keyframes) {
        delete layer.keyframes.x;
        delete layer.keyframes.y;
      }
    }
    return true;
  },

  copyAttributesFromLayer(layer) {
    if (!layer) return null;
    this.normalizeLayerVfxStack(layer);
    return {
      filterId: layer.filterId || 'normal',
      filterIntensity: layer.filterIntensity ?? 1,
      blendMode: layer.blendMode || 'normal',
      fx: deepClone(layer.fx || {}),
      vfx: deepClone(layer.vfx || { type: 'none', intensity: 0.65, speed: 1 }),
      vfxStack: deepClone(layer.vfxStack || []),
      mask: deepClone(layer.mask || { type: 'none', scaleX: 0.85, scaleY: 0.85, offsetX: 0, offsetY: 0, rotation: 0, feather: 0.05, invert: false }),
      transitions: deepClone(layer.transitions || { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 })
    };
  },

  pasteAttributesToLayer(layer, attrs) {
    if (!layer || !attrs || layer.type === 'audio' || layer.type === 'group') return false;
    layer.filterId = attrs.filterId || 'normal';
    layer.filterIntensity = attrs.filterIntensity ?? 1;
    layer.blendMode = attrs.blendMode || 'normal';
    layer.fx = deepClone(attrs.fx || {});
    layer.vfx = deepClone(attrs.vfx || { type: 'none', intensity: 0.65, speed: 1 });
    layer.vfxStack = deepClone(attrs.vfxStack || []);
    layer._vfxStackExplicit = Boolean(attrs.vfxStack && attrs.vfxStack.length);
    this.normalizeLayerVfxStack(layer);
    layer.mask = deepClone(attrs.mask || layer.mask);
    layer.transitions = deepClone(attrs.transitions || layer.transitions);
    return true;
  },

  applyFilterAndAdjustToAll(project, sourceLayer) {
    if (!project || !sourceLayer) return 0;
    this.normalizeLayerVfxStack(sourceLayer);
    let count = 0;
    for (const l of project.layers) {
      if (l.id === sourceLayer.id || l.type === 'audio' || l.type === 'group' || l.type === 'adjustment') continue;
      l.filterId = sourceLayer.filterId || 'normal';
      l.filterIntensity = sourceLayer.filterIntensity ?? 1;
      l.fx = deepClone(sourceLayer.fx || {});
      l.vfx = deepClone(sourceLayer.vfx || l.vfx);
      l.vfxStack = deepClone(sourceLayer.vfxStack || []);
      l._vfxStackExplicit = Boolean(sourceLayer.vfxStack && sourceLayer.vfxStack.length);
      this.normalizeLayerVfxStack(l);
      count++;
    }
    return count;
  },

  autoEditArrangeClips(project, mediaItems, templateId) {
    const visuals = (mediaItems || []).filter((m) => m.type === 'video' || m.type === 'image');
    if (visuals.length === 0) return 0;
    const fps = Math.max(1, project.fps || 30);
    const created = [];
    let cursor = 0;
    const clipSec = templateId === 'flashBeat' ? 1.4 : templateId === 'carousel3D' ? 2.5 : 2.8;
    const clipFrames = Math.max(20, Math.round(clipSec * fps));
    const beats = [];

    const maxClips = Math.min(8, visuals.length);
    for (let i = 0; i < maxClips; i++) {
      const m = visuals[i];
      const layer = this.createMediaLayer(project, m, cursor);
      layer.endFrame = cursor + clipFrames;
      if (templateId === 'flashBeat') {
        layer.vfx = { type: i % 2 === 0 ? 'flashPulse' : 'zoomBlur', intensity: 0.72, speed: 1.2 };
        layer.transitions = { inType: 'zoomIn', inFrames: 8, outType: 'crossfade', outFrames: 6 };
        layer.speedCurve = 'montage';
        KeyframeEngine.applyPreset(layer, 'zoomIn', project.width, project.height, 14);
      } else if (templateId === 'carousel3D') {
        layer.filterId = 'cinema';
        layer.transitions = { inType: 'crossfade', inFrames: 15, outType: 'crossfade', outFrames: 15 };
        KeyframeEngine.applyPreset(layer, 'float3D', project.width, project.height, 24);
      } else {
        layer.filterId = 'warm';
        layer.transitions = { inType: i % 2 === 0 ? 'wipeRight' : 'slideLeft', inFrames: 12, outType: 'crossfade', outFrames: 10 };
        layer.speedCurve = 'hero';
      }
      beats.push(cursor);
      created.push(layer);
      cursor += clipFrames;
    }

    if (templateId === 'carousel3D') {
      KeyframeEngine.applyCameraPreset(project.camera, 'orbit360', cursor);
    } else if (templateId === 'flashBeat') {
      KeyframeEngine.applyCameraPreset(project.camera, 'dollyIn', cursor);
    } else {
      KeyframeEngine.applyCameraPreset(project.camera, 'kenBurns', cursor);
    }

    // Assign all generated clips onto Main Track sequentially
    created.forEach((l) => { l.trackRole = 'main'; });
    project.layers = [...created.reverse(), ...project.layers.filter((l) => l.type === 'audio')];
    this.normalizeTrackZOrder(project);
    project.beatMarkers = [...new Set([...(project.beatMarkers || []), ...beats])].sort((a, b) => a - b);
    this.ensureProjectDuration(project, cursor + fps);
    return created.length;
  },

  isMainTrackLayer(layer) {
    return Boolean(layer && layer.trackRole === 'main');
  },

  getMainTrackClips(project) {
    if (!project || !Array.isArray(project.layers)) return [];
    return project.layers
      .filter((l) => l.trackRole === 'main')
      .sort((a, b) => (a.startFrame - b.startFrame) || (a.endFrame - b.endFrame));
  },

  getMainTrackEndFrame(project) {
    const mainClips = this.getMainTrackClips(project);
    if (mainClips.length === 0) return 0;
    return Math.max(0, ...mainClips.map((c) => Number(c.endFrame) || 0));
  },

  shiftLayerKeyframes(layer, deltaFrames) {
    if (!layer || !deltaFrames || !layer.keyframes) return;
    for (const prop of Object.keys(layer.keyframes)) {
      const list = layer.keyframes[prop];
      if (!Array.isArray(list)) continue;
      for (const kf of list) {
        kf.frame = Math.max(0, Math.round(kf.frame + deltaFrames));
      }
      list.sort((a, b) => a.frame - b.frame);
    }
  },

  /**
   * Ensures 3-zone structure & Z-order:
   * - Top (overlays): non-audio layers (text, shape, adjustment, overlay image/video, group)
   * - Middle (mainTrack): ONLY video & image with trackRole === 'main'
   * - Bottom (audios): ONLY audio layers
   */
  normalizeTrackZOrder(project) {
    if (!project || !Array.isArray(project.layers)) return;
    const overlays = [];
    const mainTrack = [];
    const audios = [];
    for (const l of project.layers) {
      if (!l) continue;
      if (l.type === 'audio') {
        l.trackRole = null;
        audios.push(l);
      } else if (l.trackRole === 'main' && (l.type === 'video' || l.type === 'image')) {
        mainTrack.push(l);
      } else {
        if (l.trackRole === 'main') l.trackRole = 'overlay';
        overlays.push(l);
      }
    }
    mainTrack.sort((a, b) => (b.startFrame - a.startFrame) || (b.endFrame - a.endFrame));
    project.layers = [...overlays, ...mainTrack, ...audios];
  },

  /**
   * Packs Main Track clips contiguously starting from anchorFrame (default 0).
   * If orderedIds is provided, clips are arranged in that exact sequence.
   */
  reflowMainTrack(project, anchorFrame = 0, orderedIds = null) {
    if (!project || !Array.isArray(project.layers)) return [];
    const currentClips = this.getMainTrackClips(project);
    if (currentClips.length === 0) return [];

    let sequence = currentClips;
    if (Array.isArray(orderedIds) && orderedIds.length > 0) {
      const byId = new Map(currentClips.map((c) => [c.id, c]));
      const reordered = [];
      for (const id of orderedIds) {
        const c = byId.get(id);
        if (c) {
          reordered.push(c);
          byId.delete(id);
        }
      }
      for (const rem of byId.values()) reordered.push(rem);
      sequence = reordered;
    }

    const oldNeighbors = new Map();
    for (let i = 0; i < currentClips.length; i++) {
      oldNeighbors.set(currentClips[i].id, {
        prevId: i > 0 ? currentClips[i - 1].id : null,
        nextId: i < currentClips.length - 1 ? currentClips[i + 1].id : null
      });
    }

    let cursor = Math.max(0, Math.round(anchorFrame));
    for (let i = 0; i < sequence.length; i++) {
      const clip = sequence[i];
      const len = Math.max(5, (clip.endFrame || 0) - (clip.startFrame || 0));
      const delta = cursor - clip.startFrame;
      clip.startFrame = cursor;
      clip.endFrame = cursor + len;
      if (delta !== 0) {
        this.shiftLayerKeyframes(clip, delta);
      }
      // If neighbor sequence changed due to reorder, clear broken edge transitions
      if (Array.isArray(orderedIds)) {
        const prevOld = oldNeighbors.get(clip.id);
        const newPrevId = i > 0 ? sequence[i - 1].id : null;
        const newNextId = i < sequence.length - 1 ? sequence[i + 1].id : null;
        if (clip.transitions) {
          if (prevOld && prevOld.prevId !== newPrevId && clip.transitions.inType !== 'none') {
            clip.transitions.inType = 'none';
          }
          if (prevOld && prevOld.nextId !== newNextId && clip.transitions.outType !== 'none') {
            clip.transitions.outType = 'none';
          }
        }
      }
      cursor += len;
    }

    this.normalizeTrackZOrder(project);
    this.ensureProjectDuration(project, cursor);
    return sequence;
  },

  addToMainTrack(project, layer, options = {}) {
    if (!project || !layer) return null;
    // Strict Main Track rule: ONLY video and image items allowed on Main Track
    if (layer.type !== 'video' && layer.type !== 'image') {
      layer.trackRole = layer.type === 'audio' ? null : 'overlay';
      this.addLayer(project, layer);
      this.normalizeTrackZOrder(project);
      return layer;
    }
    layer.trackRole = 'main';
    const len = Math.max(15, (layer.endFrame || 0) - (layer.startFrame || 0));
    const currentEnd = this.getMainTrackEndFrame(project);
    const startF = options.insertFrame !== undefined && options.insertFrame !== null
      ? Math.max(0, Math.round(options.insertFrame))
      : currentEnd;

    layer.startFrame = startF;
    layer.endFrame = startF + len;
    project.layers.push(layer);

    if (options.insertFrame !== undefined && options.insertFrame !== null && project.settings?.rippleMode !== false) {
      const ordered = this.getMainTrackClips(project);
      const existingOthers = ordered.filter((c) => c.id !== layer.id);
      const insertIdx = existingOthers.findIndex((c) => (c.startFrame + c.endFrame) * 0.5 >= startF);
      const nextSeq = insertIdx >= 0
        ? [...existingOthers.slice(0, insertIdx), layer, ...existingOthers.slice(insertIdx)]
        : [...existingOthers, layer];
      this.reflowMainTrack(project, 0, nextSeq.map((c) => c.id));
    } else if (project.settings?.rippleMode !== false) {
      this.reflowMainTrack(project, 0);
    } else {
      this.normalizeTrackZOrder(project);
      this.ensureProjectDuration(project, layer.endFrame);
    }
    return layer;
  },

  deleteMainOrLayer(project, layerId) {
    const target = project?.layers?.find((l) => l.id === layerId);
    if (!target) return false;
    const wasMain = target.trackRole === 'main';
    const deleted = this.deleteLayer(project, layerId);
    if (!deleted) return false;
    if (wasMain && project.settings?.rippleMode !== false) {
      this.reflowMainTrack(project, 0);
    }
    return true;
  },

  resolveNonOverlappingMainStart(project, movingLayerId, len, desiredStart) {
    const safeLen = Math.max(5, Math.round(len || 5));
    const raw = Math.max(0, Math.round(desiredStart || 0));
    const others = this.getMainTrackClips(project).filter((c) => c.id !== movingLayerId);
    if (others.length === 0) return raw;

    const slots = [];
    let cursor = 0;
    for (const c of others) {
      if (c.startFrame - cursor >= safeLen) {
        slots.push([cursor, c.startFrame - safeLen]);
      }
      cursor = Math.max(cursor, c.endFrame);
    }
    slots.push([cursor, Infinity]);

    let bestStart = cursor;
    let bestDist = Infinity;
    for (const [minS, maxS] of slots) {
      const clamped = Math.max(minS, Math.min(maxS, raw));
      const dist = Math.abs(clamped - raw);
      if (dist < bestDist) {
        bestDist = dist;
        bestStart = clamped;
      }
    }
    return bestStart;
  },

  trimMainOrClip(project, layerId, edge, newFrame, snapEnabled = true, playheadFrame = 0, threshold = 4) {
    const layer = project?.layers?.find((l) => l.id === layerId);
    if (!layer || layer.locked) return { startFrame: 0, endFrame: 0, snapInfo: { snapped: false, guideFrame: null, kind: null, label: null } };
    if (layer.trackRole !== 'main') {
      return this.trimClip(project, layerId, edge, newFrame, snapEnabled, playheadFrame, threshold);
    }
    if (project.settings?.rippleMode === false) {
      const others = this.getMainTrackClips(project).filter((c) => c.id !== layerId);
      const prevClip = [...others].reverse().find((c) => c.endFrame <= layer.startFrame);
      const nextClip = others.find((c) => c.startFrame >= layer.endFrame);
      const res = this.trimClip(project, layerId, edge, newFrame, snapEnabled, playheadFrame, threshold);
      const minLen = 5;
      if (edge === 'left' && prevClip && layer.startFrame < prevClip.endFrame) {
        const clampedStart = Math.min(layer.endFrame - minLen, prevClip.endFrame);
        const diff = clampedStart - layer.startFrame;
        layer.startFrame = clampedStart;
        layer.mediaOffsetFrames = Math.max(0, (layer.mediaOffsetFrames || 0) + Math.round(diff * (layer.speed || 1)));
      }
      if (edge === 'right' && nextClip && layer.endFrame > nextClip.startFrame) {
        layer.endFrame = Math.max(layer.startFrame + minLen, nextClip.startFrame);
      }
      return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo: res.snapInfo };
    }

    const mainSeq = this.getMainTrackClips(project);
    const idx = mainSeq.findIndex((c) => c.id === layerId);
    const oldStart = layer.startFrame;
    const oldEnd = layer.endFrame;
    const minLen = 5;

    if (edge === 'right') {
      const rawEnd = Math.max(oldStart + minLen, Math.round(newFrame));
      const snapInfo = this.snapEdgeFrameWithMeta(project, layerId, rawEnd, playheadFrame, snapEnabled, threshold, { minFrame: oldStart + minLen });
      layer.endFrame = Math.max(oldStart + minLen, snapInfo.frame);
      const delta = layer.endFrame - oldEnd;
      if (delta !== 0 && idx >= 0) {
        for (let i = idx + 1; i < mainSeq.length; i++) {
          const sib = mainSeq[i];
          sib.startFrame = Math.max(0, sib.startFrame + delta);
          sib.endFrame = Math.max(sib.startFrame + minLen, sib.endFrame + delta);
          this.shiftLayerKeyframes(sib, delta);
        }
      }
      this.ensureProjectDuration(project, this.getMainTrackEndFrame(project));
      return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo };
    } else {
      const maxStart = oldEnd - minLen;
      let f = Math.min(maxStart, Math.round(newFrame));
      let snapInfo = { frame: f, snapped: false, guideFrame: null, kind: null, label: null };
      if (snapEnabled && f >= -threshold) {
        const edgeRes = this.snapEdgeFrameWithMeta(project, layerId, f, playheadFrame, true, threshold, { minFrame: 0, maxFrame: maxStart });
        if (edgeRes.snapped) {
          f = edgeRes.frame;
          snapInfo = edgeRes;
        }
      }
      const trimDelta = f - oldStart;
      layer.startFrame = f;
      layer.mediaOffsetFrames = Math.max(0, (layer.mediaOffsetFrames || 0) + Math.round(trimDelta * (layer.speed || 1)));
      // Re-pack Main Track flush so trimming/extending head keeps Main Track contiguous from 0
      this.reflowMainTrack(project, 0, mainSeq.map((c) => c.id));
      return { startFrame: layer.startFrame, endFrame: layer.endFrame, snapInfo };
    }
  },

  reorderMainTrackClip(project, layerId, targetSlotIdx) {
    const seq = this.getMainTrackClips(project);
    const curIdx = seq.findIndex((c) => c.id === layerId);
    if (curIdx < 0) return false;
    const clamped = Math.max(0, Math.min(seq.length - 1, Math.round(targetSlotIdx)));
    if (clamped === curIdx) return false;
    const next = [...seq];
    const [moved] = next.splice(curIdx, 1);
    next.splice(clamped, 0, moved);
    this.reflowMainTrack(project, 0, next.map((c) => c.id));
    return true;
  },

  moveMainTrackClipStep(project, layerId, delta) {
    const seq = this.getMainTrackClips(project);
    const curIdx = seq.findIndex((c) => c.id === layerId);
    if (curIdx < 0) return false;
    return this.reorderMainTrackClip(project, layerId, curIdx + delta);
  },

  computeMainTrackTargetSlot(project, movingLayerId, dragCenterFrame) {
    const others = this.getMainTrackClips(project).filter((c) => c.id !== movingLayerId);
    for (let i = 0; i < others.length; i++) {
      const mid = (others[i].startFrame + others[i].endFrame) * 0.5;
      if (dragCenterFrame < mid) return i;
    }
    return others.length;
  },

  reorderMainTrackClipByFrame(project, layerId, dragCenterFrame) {
    const seq = this.getMainTrackClips(project);
    if (seq.length <= 1 || !seq.some((c) => c.id === layerId)) return false;
    const targetSlot = this.computeMainTrackTargetSlot(project, layerId, dragCenterFrame);
    return this.reorderMainTrackClip(project, layerId, targetSlot);
  },

  switchLayerTrackRole(project, layerId, targetRole, playheadFrame = 0) {
    const layer = project?.layers?.find((l) => l.id === layerId);
    if (!layer) return false;
    if (layer.type !== 'video' && layer.type !== 'image') return false;
    const nextRole = targetRole === 'main' ? 'main' : 'overlay';
    if (layer.trackRole === nextRole) return false;

    if (nextRole === 'overlay') {
      layer.trackRole = 'overlay';
      if (project.settings?.rippleMode !== false) {
        this.reflowMainTrack(project, 0);
      } else {
        this.normalizeTrackZOrder(project);
      }
      return true;
    }

    // Moving overlay -> main track
    const len = Math.max(5, (layer.endFrame || 0) - (layer.startFrame || 0));
    layer.trackRole = 'main';
    const mainOthers = this.getMainTrackClips(project).filter((c) => c.id !== layer.id);
    if (project.settings?.rippleMode !== false) {
      const appendStart = mainOthers.length > 0 ? Math.max(...mainOthers.map((c) => c.endFrame)) : 0;
      const oldStart = layer.startFrame;
      layer.startFrame = appendStart;
      layer.endFrame = appendStart + len;
      this.shiftLayerKeyframes(layer, appendStart - oldStart);
      this.reflowMainTrack(project, 0);
    } else {
      const targetStart = Math.max(0, Math.round(playheadFrame));
      const oldStart = layer.startFrame;
      layer.startFrame = targetStart;
      layer.endFrame = targetStart + len;
      this.shiftLayerKeyframes(layer, targetStart - oldStart);
      this.normalizeTrackZOrder(project);
      this.ensureProjectDuration(project, layer.endFrame);
    }
    return true;
  },

  /**
   * CapCut-style Delete Left / Delete Right at playhead:
   * - When playhead is inside the clip: trims/removes the left or right portion of the clip cleanly
   *   (updating mediaOffsetFrames, partitioning keyframes, and rippling Main Track if magnetic).
   * - When playhead is at/on a split seam or edge: deletes the adjacent left/right split piece on that track.
   */
  trimDeleteSideAtPlayhead(project, layerId, side, playheadFrame = 0) {
    if (!project || !Array.isArray(project.layers)) return null;
    const isLeft = side === 'left';
    const f = Math.max(0, Math.round(playheadFrame));
    let layer = project.layers.find((l) => l.id === layerId) || null;
    if (!layer) {
      const mainSeq = this.getMainTrackClips(project);
      layer = mainSeq.find((c) => f >= c.startFrame && f <= c.endFrame) || null;
    }
    if (!layer || layer.locked) return null;

    const minLen = 5;
    const wasMain = layer.trackRole === 'main';
    const rippleOn = project.settings?.rippleMode !== false;

    // Case 1: Playhead is strictly inside the target clip (at least minLen remains on kept side)
    if (isLeft && f > layer.startFrame + 1 && f <= layer.endFrame - minLen) {
      const origStart = layer.startFrame;
      const origEnd = layer.endFrame;
      const origOffset = layer.mediaOffsetFrames || 0;
      const spd = layer.speed || 1;
      const reversed = Boolean(layer.reversed);

      const wasmOffsets = WasmBridge.splitOffsets(origStart, origEnd, f, origOffset, spd, reversed);
      const rightOffset = wasmOffsets
        ? wasmOffsets.rightOffset
        : reversed
          ? origOffset
          : origOffset + Math.round((f - origStart) * spd);

      KeyframeEngine.trimKeyframesAtBoundary(layer, 'right', f);
      layer.startFrame = f;
      layer.mediaOffsetFrames = Math.max(0, rightOffset);
      if (layer.transitions) layer.transitions.inType = 'none';

      if (wasMain && rippleOn) {
        this.reflowMainTrack(project, 0);
      }
      return {
        action: 'trimmed_left',
        selectedId: layer.id,
        playheadFrame: wasMain && rippleOn ? layer.startFrame : f
      };
    }

    if (!isLeft && f >= layer.startFrame + minLen && f < layer.endFrame - 1) {
      const origStart = layer.startFrame;
      const origEnd = layer.endFrame;
      const origOffset = layer.mediaOffsetFrames || 0;
      const spd = layer.speed || 1;
      const reversed = Boolean(layer.reversed);

      if (reversed) {
        const wasmOffsets = WasmBridge.splitOffsets(origStart, origEnd, f, origOffset, spd, true);
        layer.mediaOffsetFrames = Math.max(
          0,
          wasmOffsets ? wasmOffsets.leftOffset : origOffset + Math.round((origEnd - f) * spd)
        );
      }

      KeyframeEngine.trimKeyframesAtBoundary(layer, 'left', f);
      layer.endFrame = f;
      if (layer.transitions) layer.transitions.outType = 'none';

      if (wasMain && rippleOn) {
        this.reflowMainTrack(project, 0);
      }
      return {
        action: 'trimmed_right',
        selectedId: layer.id,
        playheadFrame: Math.min(f, layer.endFrame)
      };
    }

    // Case 2: Playhead sits on/near a split seam — remove the adjacent split clip on the requested side
    const pool = wasMain
      ? this.getMainTrackClips(project)
      : project.layers
          .filter((l) => l.trackRole !== 'main' && l.type === layer.type && !l.locked)
          .sort((a, b) => (a.startFrame - b.startFrame) || (a.endFrame - b.endFrame));

    let victim = null;
    if (isLeft) {
      if (layer.endFrame <= f + 2) {
        victim = layer;
      } else {
        const leftCands = pool
          .filter((c) => c.id !== layer.id && c.endFrame <= f + 2 && !c.locked)
          .sort((a, b) => (a.endFrame - b.endFrame) || (a.startFrame - b.startFrame));
        if (leftCands.length > 0) {
          victim = leftCands[leftCands.length - 1];
        }
      }
    } else {
      if (layer.startFrame >= f - 2) {
        victim = layer;
      } else {
        const rightCands = pool
          .filter((c) => c.id !== layer.id && c.startFrame >= f - 2 && !c.locked)
          .sort((a, b) => (a.startFrame - b.startFrame) || (a.endFrame - b.endFrame));
        if (rightCands.length > 0) {
          victim = rightCands[0];
        }
      }
    }
    if (!victim) return null;

    const victimStart = victim.startFrame;
    const victimWasMain = victim.trackRole === 'main';
    const survivorHint = pool.find((c) => c.id !== victim.id && (isLeft ? c.startFrame >= victim.endFrame - 2 : c.endFrame <= victim.startFrame + 2))
      || pool.find((c) => c.id !== victim.id)
      || null;

    this.deleteMainOrLayer(project, victim.id);
    const nextSelectedId = (layer.id !== victim.id && project.layers.some((l) => l.id === layer.id))
      ? layer.id
      : (survivorHint && project.layers.some((l) => l.id === survivorHint.id) ? survivorHint.id : (project.layers[0]?.id || null));

    return {
      action: isLeft ? 'deleted_left' : 'deleted_right',
      selectedId: nextSelectedId,
      playheadFrame: victimWasMain && rippleOn ? victimStart : f
    };
  },

  /**
   * 2D Drag & Drop placement inside the timeline:
   * - Drop visual overlay clip onto Main Track at dragCenterFrame slot
   * - Drop Main Track clip into Overlay track at targetStartFrame
   * - Reorder Overlay / Text / Shape / Audio lane vertically while updating time position
   */
  dropLayerInTimeline(project, layerId, {
    targetRole = null,
    targetLayerIndex = null,
    targetStartFrame = null,
    dragCenterFrame = null
  } = {}) {
    const layer = project?.layers?.find((l) => l.id === layerId);
    if (!layer || layer.locked) return false;

    const oldStart = layer.startFrame;
    const len = Math.max(5, (layer.endFrame || 0) - oldStart);
    let changed = false;

    if (targetRole === 'main') {
      if (layer.type !== 'video' && layer.type !== 'image') return false;
      layer.trackRole = 'main';
      if (!project.layers.some((l) => l.id === layer.id)) {
        project.layers.push(layer);
      }
      const centerF = Number.isFinite(dragCenterFrame) ? dragCenterFrame : (oldStart + len * 0.5);
      const slot = this.computeMainTrackTargetSlot(project, layer.id, centerF);
      const others = this.getMainTrackClips(project).filter((c) => c.id !== layer.id);
      const clampedSlot = Math.max(0, Math.min(others.length, slot));
      const nextSeq = [...others.slice(0, clampedSlot), layer, ...others.slice(clampedSlot)];
      if (project.settings?.rippleMode !== false) {
        this.reflowMainTrack(project, 0, nextSeq.map((c) => c.id));
      } else {
        const nextS = this.resolveNonOverlappingMainStart(project, layer.id, len, targetStartFrame ?? oldStart);
        layer.startFrame = nextS;
        layer.endFrame = nextS + len;
        this.shiftLayerKeyframes(layer, nextS - oldStart);
        this.normalizeTrackZOrder(project);
        this.ensureProjectDuration(project, layer.endFrame);
      }
      return true;
    }

    if (targetRole === 'overlay' && layer.trackRole === 'main') {
      layer.trackRole = 'overlay';
      const nextS = Math.max(0, Math.round(targetStartFrame ?? oldStart));
      layer.startFrame = nextS;
      layer.endFrame = nextS + len;
      this.shiftLayerKeyframes(layer, nextS - oldStart);
      if (project.settings?.rippleMode !== false) {
        this.reflowMainTrack(project, 0);
      }
      if (Number.isInteger(targetLayerIndex)) {
        this.moveLayerToIndex(project, layer.id, targetLayerIndex);
      }
      this.normalizeTrackZOrder(project);
      this.ensureProjectDuration(project, layer.endFrame);
      return true;
    }

    if (Number.isFinite(targetStartFrame)) {
      const nextS = Math.max(0, Math.round(targetStartFrame));
      if (nextS !== oldStart) {
        layer.startFrame = nextS;
        layer.endFrame = nextS + len;
        this.shiftLayerKeyframes(layer, nextS - oldStart);
        this.ensureProjectDuration(project, layer.endFrame);
        changed = true;
      }
    }

    if (Number.isInteger(targetLayerIndex)) {
      const targetLayer = project.layers[targetLayerIndex];
      const sameZone = targetLayer && ((layer.type === 'audio') === (targetLayer.type === 'audio'));
      if (sameZone && this.moveLayerToIndex(project, layer.id, targetLayerIndex)) {
        this.normalizeTrackZOrder(project);
        changed = true;
      }
    }

    return changed;
  },

  findTransitionJunctions(project) {
    if (!project || !Array.isArray(project.layers)) return [];
    const hasExplicitMain = project.layers.some((l) => l.trackRole === 'main');
    const groups = hasExplicitMain
      ? [
          project.layers.filter((l) => l.trackRole === 'main'),
          project.layers.filter((l) => l.trackRole !== 'main' && (l.type === 'video' || l.type === 'image')),
          project.layers.filter((l) => l.type === 'text'),
          project.layers.filter((l) => l.type === 'shape'),
          project.layers.filter((l) => l.type === 'adjustment')
        ]
      : [
          project.layers.filter((l) => l.type === 'video' || l.type === 'image'),
          project.layers.filter((l) => l.type === 'text'),
          project.layers.filter((l) => l.type === 'shape'),
          project.layers.filter((l) => l.type === 'adjustment')
        ];
    const junctions = [];
    const fps = Math.max(1, project.fps || 30);

    for (const group of groups) {
      const sorted = [...group].sort((a, b) => (a.startFrame - b.startFrame) || (a.endFrame - b.endFrame));
      const usedRightIds = new Set();
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i];
        let bestRight = null;
        let bestAbsGap = Infinity;

        for (let j = i + 1; j < sorted.length; j++) {
          const cand = sorted[j];
          if (usedRightIds.has(cand.id)) continue;
          const gap = cand.startFrame - left.endFrame;
          if (gap > 2) break; // sorted ascending by startFrame
          if (gap >= -15 && cand.startFrame >= left.startFrame + 6 && cand.endFrame > left.endFrame) {
            const absGap = Math.abs(gap);
            if (absGap < bestAbsGap) {
              bestAbsGap = absGap;
              bestRight = cand;
            }
          }
        }

        if (bestRight) {
          usedRightIds.add(bestRight.id);
          const outT = left.transitions?.outType && left.transitions.outType !== 'none' ? left.transitions.outType : 'none';
          const inT = bestRight.transitions?.inType && bestRight.transitions.inType !== 'none' ? bestRight.transitions.inType : 'none';
          const activeType = outT !== 'none' ? outT : inT;
          const dur = activeType !== 'none'
            ? ((outT !== 'none' ? (left.transitions?.outFrames || 12) : 0) + (inT !== 'none' ? (bestRight.transitions?.inFrames || 12) : 0))
            : Math.round(fps * 0.8);
          junctions.push({
            id: `${left.id}__${bestRight.id}`,
            leftId: left.id,
            rightId: bestRight.id,
            left,
            right: bestRight,
            seamFrame: Math.round((left.endFrame + bestRight.startFrame) / 2),
            type: activeType,
            durationFrames: Math.max(4, Math.min(120, dur))
          });
        }
      }
    }
    return junctions.sort((a, b) => a.seamFrame - b.seamFrame);
  },

  applyTransitionBetweenClips(project, leftId, rightId, typeId, totalDurationFrames = 24) {
    if (!project || !Array.isArray(project.layers)) return false;
    const left = project.layers.find((l) => l.id === leftId);
    const right = project.layers.find((l) => l.id === rightId);
    if (!left || !right) return false;
    if (!left.transitions) left.transitions = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };
    if (!right.transitions) right.transitions = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };

    if (!typeId || typeId === 'none') {
      left.transitions.outType = 'none';
      right.transitions.inType = 'none';
      return true;
    }

    // Center-pulled symmetric duration: split half into left outFrames and half into right inFrames
    const lenL = Math.max(4, (left.endFrame || 0) - (left.startFrame || 0));
    const lenR = Math.max(4, (right.endFrame || 0) - (right.startFrame || 0));
    const maxPerSide = Math.max(2, Math.min(Math.floor(lenL * 0.45), Math.floor(lenR * 0.45)));
    const total = Math.max(4, Math.min(maxPerSide * 2, Math.min(120, Math.round(Number(totalDurationFrames) || 24))));
    const halfLeft = Math.floor(total / 2);
    const halfRight = total - halfLeft;
    left.transitions.outType = typeId;
    left.transitions.outFrames = Math.max(2, Math.min(maxPerSide, halfLeft));
    right.transitions.inType = typeId;
    right.transitions.inFrames = Math.max(2, Math.min(maxPerSide, halfRight));
    return true;
  },

  resizeTransitionJunction(project, leftId, rightId, totalDurationFrames) {
    if (!project || !Array.isArray(project.layers)) return false;
    const left = project.layers.find((l) => l.id === leftId);
    const right = project.layers.find((l) => l.id === rightId);
    if (!left || !right) return false;
    const activeType = (left.transitions?.outType && left.transitions.outType !== 'none')
      ? left.transitions.outType
      : (right.transitions?.inType && right.transitions.inType !== 'none' ? right.transitions.inType : 'crossfade');
    return this.applyTransitionBetweenClips(project, leftId, rightId, activeType, totalDurationFrames);
  },

  applyTransitionToAllJunctions(project, typeId, totalDurationFrames = 24) {
    const junctions = this.findTransitionJunctions(project);
    let count = 0;
    for (const j of junctions) {
      if (this.applyTransitionBetweenClips(project, j.leftId, j.rightId, typeId, totalDurationFrames)) {
        count++;
      }
    }
    return count;
  },

  getProjectContentEndFrame(project) {
    if (!project || !Array.isArray(project.layers) || project.layers.length === 0) {
      return project?.durationFrames || 150;
    }
    const maxEnd = Math.max(0, ...project.layers.map((l) => Number(l.endFrame) || 0));
    return maxEnd > 0 ? maxEnd : (project.durationFrames || 150);
  }
};
