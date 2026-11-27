import { KeyframeEngine } from '../engine/keyframeEngine.js';
import { TimelineEngine } from '../engine/timelineEngine.js';
import { WasmBridge } from '../engine/wasmBridge.js';

const MIN_PX_PER_FRAME = 0.15;
const MAX_PX_PER_FRAME = 36;

const LAYER_ICONS = {
  video: 'bi-film text-info',
  image: 'bi-image text-success',
  text: 'bi-fonts text-primary',
  shape: 'bi-pentagon text-warning',
  audio: 'bi-music-note-beamed text-danger',
  group: 'bi-collection text-light',
  adjustment: 'bi-sliders2-vertical text-warning',
  camera: 'bi-camera-video-fill text-info'
};

export const TIMELINE_LEFT_PAD = 12;

export function computeCenterPadLeft(viewportWidth = TIMELINE_LEFT_PAD) {
  const w = Number(viewportWidth);
  if (!Number.isFinite(w) || w <= 0) return TIMELINE_LEFT_PAD;
  return Math.min(TIMELINE_LEFT_PAD, Math.max(0, Math.round(w)));
}

export function frameToTimelineX(frame, pxPerFrame, padLeft = 0) {
  return (Number(padLeft) || 0) + (Number(frame) || 0) * (Number(pxPerFrame) || 0);
}

export function timelineXToFrame(x, pxPerFrame, padLeft = 0) {
  return ((Number(x) || 0) - (Number(padLeft) || 0)) / Math.max(MIN_PX_PER_FRAME, Number(pxPerFrame) || MIN_PX_PER_FRAME);
}

export function frameToCenterScrollLeft(frame, pxPerFrame, maxScrollLeft = Infinity) {
  const raw = Math.max(0, (Number(frame) || 0) * (Number(pxPerFrame) || 0));
  return Number.isFinite(maxScrollLeft) ? Math.max(0, Math.min(maxScrollLeft, raw)) : raw;
}

export function scrollLeftToCenterFrame(scrollLeft, pxPerFrame, totalFrames = Infinity) {
  const raw = Math.round(Math.max(0, Number(scrollLeft) || 0) / Math.max(MIN_PX_PER_FRAME, Number(pxPerFrame) || MIN_PX_PER_FRAME));
  return Number.isFinite(totalFrames) ? Math.max(0, Math.min(totalFrames, raw)) : Math.max(0, raw);
}

export function computeRulerLodSpec(pxPerFrame, fps = 30) {
  const safeFps = Math.max(1, Math.round(fps || 30));
  const wasmTier = WasmBridge.getRulerLodTier(pxPerFrame, safeFps);
  const pxPerSec = pxPerFrame * safeFps;
  let tier;
  if (wasmTier !== null && Number.isInteger(wasmTier)) {
    tier = wasmTier;
  } else if (pxPerSec < 10) {
    tier = 0;
  } else if (pxPerSec < 24) {
    tier = 1;
  } else if (pxPerSec < 50) {
    tier = 2;
  } else if (pxPerSec < 120) {
    tier = 3;
  } else if (pxPerSec < 260) {
    tier = 4;
  } else if (pxPerSec < 520) {
    tier = 5;
  } else if (pxPerSec < 900) {
    tier = 6;
  } else {
    tier = 7;
  }

  switch (tier) {
    case 0:
      return { tier, majorFrames: safeFps * 30, labelFrames: safeFps * 30, minorFrames: safeFps * 5, showSubFrames: false };
    case 1:
      return { tier, majorFrames: safeFps * 10, labelFrames: safeFps * 10, minorFrames: safeFps * 2, showSubFrames: false };
    case 2:
      return { tier, majorFrames: safeFps * 5, labelFrames: safeFps * 5, minorFrames: safeFps, showSubFrames: false };
    case 3:
      return { tier, majorFrames: safeFps, labelFrames: safeFps, minorFrames: Math.max(1, Math.round(safeFps / 2)), showSubFrames: false };
    case 4:
      return { tier, majorFrames: safeFps, labelFrames: Math.max(1, Math.round(safeFps / 2)), minorFrames: Math.max(1, Math.round(safeFps / 6)), showSubFrames: true };
    case 5:
      return { tier, majorFrames: safeFps, labelFrames: Math.max(1, Math.round(safeFps / 3)), minorFrames: Math.max(1, Math.round(safeFps / 6)), showSubFrames: true };
    case 6:
      return { tier, majorFrames: safeFps, labelFrames: Math.max(1, Math.round(safeFps / 6)), minorFrames: 1, showSubFrames: true };
    case 7:
    default:
      return { tier: 7, majorFrames: safeFps, labelFrames: 1, minorFrames: 1, showSubFrames: true };
  }
}

export function computeDynamicRulerTicks(pxPerFrame, fps = 30) {
  const safeFps = Math.max(1, Math.round(fps || 30));
  const px = Math.max(MIN_PX_PER_FRAME, Number(pxPerFrame) || 1);
  const baseSpec = computeRulerLodSpec(px, safeFps);

  const subSec = [
    1,
    2,
    5,
    Math.max(1, Math.round(safeFps / 6)),
    Math.max(1, Math.round(safeFps / 3)),
    Math.max(1, Math.round(safeFps / 2))
  ];
  const secSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * safeFps);
  const candidates = [...new Set([...subSec, ...secSteps])].sort((a, b) => a - b);

  let labelFrames = candidates[candidates.length - 1];
  for (const cand of candidates) {
    const minPx = cand < safeFps ? 42 : 48;
    if (cand * px >= minPx) {
      labelFrames = cand;
      break;
    }
  }

  let minorFrames = labelFrames;
  for (const div of [10, 5, 4, 3, 2]) {
    if (labelFrames % div === 0) {
      const sub = labelFrames / div;
      if (sub * px >= 8) {
        minorFrames = sub;
        break;
      }
    }
  }
  if (minorFrames === labelFrames && labelFrames > 1) {
    const fallbackSub = Math.max(1, Math.round(labelFrames / 4));
    if (fallbackSub * px >= 8) minorFrames = fallbackSub;
  }

  const majorFrames = labelFrames < safeFps ? safeFps : labelFrames;
  return {
    tier: baseSpec.tier,
    majorFrames,
    labelFrames,
    minorFrames: Math.max(1, Math.round(minorFrames)),
    showSubFrames: labelFrames < safeFps
  };
}

export function formatRulerLabel(frame, fps = 30) {
  const safeFps = Math.max(1, Math.round(fps || 30));
  const f = Math.max(0, Math.round(frame));
  const wholeSec = Math.floor(f / safeFps);
  const sub = f % safeFps;
  if (sub === 0) {
    if (wholeSec >= 60) {
      const m = Math.floor(wholeSec / 60);
      const s = wholeSec % 60;
      return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}s`;
    }
    return `${wholeSec}s`;
  }
  return `+${sub}f`;
}

export function formatDurationShort(frames, fps = 30) {
  const safeFps = Math.max(1, Number(fps) || 30);
  const totalTenths = Math.max(0, Math.round((Math.abs(Number(frames) || 0) / safeFps) * 10));
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const secs = totalSec % 60;
  const mins = Math.floor(totalSec / 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatSignedDurationDelta(deltaFrames, fps = 30) {
  const d = Number(deltaFrames) || 0;
  const sign = d >= 0 ? '+' : '-';
  return `${sign}${formatDurationShort(Math.abs(d), fps)}`;
}

export function getClipStatusBadges(layer) {
  if (!layer) return [];
  const badges = [];
  const spd = Number(layer.speed);
  if (Number.isFinite(spd) && Math.abs(spd - 1) > 0.01) {
    const cleanSpd = Number(spd.toFixed(2));
    badges.push({ kind: 'speed', text: `×${cleanSpd}`, title: `Speed ${cleanSpd}x` });
  }
  if ((layer.speedCurve && layer.speedCurve !== 'none') || (Array.isArray(layer.customSpeedCurve) && layer.customSpeedCurve.length >= 2)) {
    badges.push({ kind: 'curve', icon: 'bi-lightning-fill', title: `Speed Curve (${layer.speedCurve || 'custom'})` });
  }
  if (layer.type === 'adjustment' && ((layer.filterId && layer.filterId !== 'normal') || layer.adjustmentKind === 'filter')) {
    badges.push({
      kind: 'filter',
      icon: 'bi-palette-fill',
      text: 'FLT',
      title: `Filter: ${layer.filterId || 'Filter'}`
    });
  }
  const fxCount = TimelineEngine.countActiveEffects(layer);
  if (fxCount > 0) {
    badges.push({
      kind: 'fx',
      icon: 'bi-stars',
      text: fxCount > 1 ? String(fxCount) : undefined,
      stacked: fxCount > 1,
      title: `${fxCount} Efek Aktif`
    });
  }
  const kfCount = KeyframeEngine.getAllKeyframeFrames(layer).length;
  if (kfCount > 0) {
    badges.push({ kind: 'keyframe', icon: 'bi-diamond-fill', title: `${kfCount} Keyframe${kfCount > 1 ? 's' : ''}` });
  }
  const isMuted = Boolean(layer.audioProps?.muted) || (layer.audioProps && Number(layer.audioProps.volume) === 0);
  if (isMuted) {
    badges.push({ kind: 'mute', icon: 'bi-volume-mute-fill', title: 'Muted' });
  }
  if (layer.reversed) {
    badges.push({ kind: 'reverse', icon: 'bi-arrow-left-right', title: 'Reversed' });
  }
  if (layer.isFreezeFrame) {
    badges.push({ kind: 'freeze', icon: 'bi-snow', title: 'Freeze Frame' });
  }
  if (layer.trackData?.points?.length) {
    badges.push({ kind: 'track', icon: 'bi-crosshair', title: 'Motion Tracked' });
  }
  return badges;
}

export function isSnapActive(project, modifierHeld = false) {
  return Boolean(project?.settings?.snapToTimeline) && !Boolean(modifierHeld);
}

export function resolveMainTrackThumbSrc(project, mediaMap) {
  if (typeof project?.coverDataUrl === 'string' && project.coverDataUrl.length > 0) {
    return project.coverDataUrl;
  }
  const layers = Array.isArray(project?.layers) ? project.layers : [];
  const lookupMedia = (mediaId) => {
    if (!mediaId || !mediaMap) return null;
    if (typeof mediaMap.get === 'function') return mediaMap.get(mediaId) || null;
    return mediaMap[mediaId] || null;
  };
  const mainLayers = layers
    .filter((l) => l && l.trackRole === 'main')
    .sort((a, b) => (a.startFrame || 0) - (b.startFrame || 0));
  for (const layer of mainLayers) {
    const mItem = lookupMedia(layer.mediaId);
    if (!mItem) continue;
    if (typeof mItem.thumbUrl === 'string' && mItem.thumbUrl.length > 0) return mItem.thumbUrl;
    if (mItem.type === 'image' && typeof mItem.url === 'string' && mItem.url.length > 0) return mItem.url;
  }
  return null;
}

export function cloneKeyframesMap(kf) {
  if (!kf || typeof kf !== 'object') return {};
  const out = {};
  for (const [prop, list] of Object.entries(kf)) {
    if (!Array.isArray(list)) continue;
    out[prop] = list.map((item) => {
      if (!item || typeof item !== 'object') return item;
      return item.bezier ? { ...item, bezier: item.bezier.slice() } : { ...item };
    });
  }
  return out;
}

export function computeEdgeAutoScrollDelta(
  clientX,
  scrollRectLeft,
  scrollRectRight,
  scrollLeft,
  edgeZonePx = 36,
  maxStepPx = 18
) {
  if (!Number.isFinite(clientX) || !Number.isFinite(scrollRectLeft) || !Number.isFinite(scrollRectRight)) return 0;
  if (scrollRectRight <= scrollRectLeft) return 0;
  const zone = Math.max(8, Number(edgeZonePx) || 36);
  const maxStep = Math.max(2, Number(maxStepPx) || 18);
  const rightEdgeStart = scrollRectRight - zone;
  const leftEdgeEnd = scrollRectLeft + zone;

  if (clientX >= rightEdgeStart) {
    const depth = clientX - rightEdgeStart;
    const ratio = Math.min(1.5, Math.max(0.12, depth / zone));
    return Math.max(2, Math.round(ratio * maxStep));
  }
  if (clientX <= leftEdgeEnd && scrollLeft > 0) {
    const depth = leftEdgeEnd - clientX;
    const ratio = Math.min(1.5, Math.max(0.12, depth / zone));
    return -Math.min(scrollLeft, Math.max(2, Math.round(ratio * maxStep)));
  }
  return 0;
}

export function shouldActivateClipHold({
  mode = 'move',
  pointerType = 'touch',
  wasSelected = false,
  distPx = 0,
  dx = 0,
  elapsedMs = 0
} = {}) {
  if (mode === 'left' || mode === 'right') {
    return elapsedMs >= 110 || Math.abs(dx) >= 4;
  }
  if (mode === 'move') {
    if (pointerType !== 'touch') {
      return elapsedMs >= 110 || distPx >= 4;
    }
    if (wasSelected) {
      return elapsedMs >= 110 || distPx >= 6;
    }
    return elapsedMs >= 140 || distPx >= 10;
  }
  return false;
}

export function computeRulerWindow({
  totalWidth = 360,
  viewportW = 360,
  scrollLeft = 0,
  dpr = 1,
  currentStart = 0,
  currentWidth = 0
} = {}) {
  const safeDpr = Math.max(1, Math.min(2, Number(dpr) || 1));
  const safeViewportW = Math.max(200, Math.ceil(Number(viewportW) || 360));
  const safeTotalW = Math.max(safeViewportW, Math.ceil(Number(totalWidth) || safeViewportW));
  const safeScroll = Math.max(0, Number(scrollLeft) || 0);
  const maxCssW = Math.max(safeViewportW + 320, Math.floor(3840 / safeDpr));

  if (safeTotalW <= maxCssW) {
    return {
      windowStart: 0,
      windowWidth: safeTotalW,
      needsRedraw: currentStart !== 0 || currentWidth !== safeTotalW
    };
  }

  const windowWidth = Math.min(safeTotalW, maxCssW);
  const curEnd = currentStart + currentWidth;
  if (currentWidth === windowWidth && currentStart >= 0 && curEnd <= safeTotalW) {
    const margin = Math.min(240, Math.round(safeViewportW * 0.4));
    const leftOk = currentStart === 0 || safeScroll >= currentStart + margin;
    const rightOk = curEnd >= safeTotalW || (safeScroll + safeViewportW) <= (curEnd - margin);
    if (leftOk && rightOk) {
      return {
        windowStart: currentStart,
        windowWidth,
        needsRedraw: false
      };
    }
  }

  const idealStart = Math.round((safeScroll + safeViewportW * 0.5) - windowWidth * 0.5);
  const windowStart = Math.max(0, Math.min(safeTotalW - windowWidth, idealStart));
  return {
    windowStart,
    windowWidth,
    needsRedraw: true
  };
}

export class TimelineView {
  constructor(callbacks) {
    this.cb = callbacks;
    this.pxPerFrame = 0.72; // Default overview (~21.6 px/s @ 30fps): 0s, 5s, 10s...; pinch zoom smoothly opens 1s, 2s, 3s...10s then frames
    this.scrollEl = document.getElementById('timelineScroll');
    this.viewportEl = document.getElementById('timelineViewport');
    this.contentEl = document.getElementById('timelineContent');
    this.rulerTrackEl = document.getElementById('rulerTrack');
    this.rulerCanvas = document.getElementById('rulerCanvas');
    this.headersList = document.getElementById('trackHeadersList');
    this.lanesList = document.getElementById('trackLanesList');
    this.playheadEl = document.getElementById('playheadLine');
    this.playheadHeadEl = this.playheadEl?.querySelector('.mf-playhead-head') || this.playheadEl;
    this.snapGuideEl = document.getElementById('timelineSnapGuide');
    this.snapGuideTagEl = this.snapGuideEl?.querySelector('.mf-snap-guide-tag') || null;
    this.layerCountEl = document.getElementById('lblLayerCount');
    this.btnGroupChecked = document.getElementById('btnGroupChecked');
    this.dragTooltipEl = document.getElementById('timelineDragTooltip');
    this.kfBarEl = document.getElementById('timelineKfBar');
    this.wrapperEl = this.dragTooltipEl?.parentElement || document.querySelector('.mf-timeline-wrapper');

    this.checkedLayerIds = new Set();
    this.selectedLayerIds = new Set();
    this.selectedKfs = []; // Array<{ layerId, laneKey, frame }>
    this.kfMultiMode = false;
    this.copiedKfGroup = null;
    this.activePointers = new Map();
    this.pinchStartDist = null;
    this.pinchStartPx = this.pxPerFrame;
    this.pinchTargetPx = this.pxPerFrame;
    this.pinchPivotFrame = 0;
    this.pinchPivotScreenX = 0;
    this._currentFrame = 0;
    this._suppressBgTapUntil = 0;
    this._suppressScrollSeekUntil = 0;
    this._pendingScrollLeft = null;
    this._padLeft = TIMELINE_LEFT_PAD;
    this._lastRulerParams = null;
    this._lastTimelineMarkers = [];
    this._lastBeatMarkers = [];
    this._lastDrawnScrollLeft = -1;
    this._rulerWindowStart = 0;
    this._rulerWindowWidth = 0;
    this._rulerContentWidth = 0;
    this._lastClipSliceScrollLeft = -9999;
    this.isScrubbing = false;
    this.filmstripCache = new Map(); // mediaId -> HTMLCanvasElement[] | 'loading'
    this._filmstripQueue = [];
    this._filmstripBusy = false;
    this._waveEntries = [];
    this._filmstripEntries = [];
    this._lastRenderContext = null;
    this._isPinching = false;
    this._isClipGestureActive = false;
    this._isClipHoldLocked = false;
    this._deferredRenderArgs = null;
    this._zoomRafId = null;
    this._pinchEndTimer = null;
    this._activeClipAbort = null;
    this._activeScrubAbort = null;
    this._hoverTimer = null;
    this._tooltipVariant = null;
    this._modifierHeld = false;
    this._autoScrollRafId = null;
    this._autoScrollStepFn = null;
    this._activeDragReapply = null;
    this._activeWheel = null;
    this._zoomRefs = { clips: [], seams: [], transSpans: [], gaps: [], addBtns: [], kfSpans: [], kfConnectors: [], kfDiamonds: [] };

    this._bindModifierListeners();
    this.bindRulerAndScroll();
    this.bindPinchZoom();
  }

  _getPadLeft() {
    this._padLeft = computeCenterPadLeft(this.scrollEl?.clientWidth || this.viewportEl?.clientWidth || TIMELINE_LEFT_PAD);
    return this._padLeft;
  }

  _syncPlayheadOverlayPosition(frame = this._currentFrame) {
    const padLeft = this._getPadLeft();
    const f = Number.isFinite(Number(frame)) ? Number(frame) : (this._currentFrame || 0);
    const phX = frameToTimelineX(f, this.pxPerFrame, padLeft);
    if (this.playheadEl) {
      this.playheadEl.style.left = `${phX}px`;
      this.playheadEl.style.visibility = 'visible';
    }
    return padLeft;
  }

  _computeTimelineContentWidth(totalFrames, pxPerFrame, viewportW, padLeft) {
    const trailPad = Math.max(160, Math.round(viewportW * 0.4));
    return Math.max(viewportW, Math.ceil(padLeft + totalFrames * pxPerFrame + trailPad));
  }

  _bindModifierListeners() {
    if (typeof window === 'undefined') return;
    const onModEvent = (e) => {
      const held = Boolean(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey);
      this._updateModifierHeld(held, false);
    };
    window.addEventListener('keydown', onModEvent);
    window.addEventListener('keyup', onModEvent);
    window.addEventListener('blur', () => {
      this._updateModifierHeld(false, false);
      this._stopEdgeAutoScroll();
    });
  }

  _updateModifierHeld(nextHeld, fromPointer = false) {
    const normalized = Boolean(nextHeld);
    if (this._modifierHeld === normalized) return;
    this._modifierHeld = normalized;
    this.cb.onSnapBypassChange?.(normalized);
    if (!fromPointer && typeof this._activeDragReapply === 'function') {
      this._activeDragReapply();
    }
  }

  _getSnapThresholdFrames() {
    return Math.max(2, Math.min(20, Math.round(10 / Math.max(0.2, this.pxPerFrame))));
  }

  _showSnapGuide(snapInfo) {
    if (!this.snapGuideEl) return;
    if (!snapInfo || !snapInfo.snapped || snapInfo.guideFrame === null || snapInfo.guideFrame === undefined) {
      this._hideSnapGuide();
      return;
    }
    const padLeft = this._getPadLeft();
    this.snapGuideEl.style.left = `${frameToTimelineX(snapInfo.guideFrame, this.pxPerFrame, padLeft)}px`;
    this.snapGuideEl.classList.remove('d-none', 'kind-clip', 'kind-playhead', 'kind-marker', 'kind-beat', 'kind-zero');
    const kind = snapInfo.kind || 'playhead';
    this.snapGuideEl.classList.add(`kind-${kind}`);
    if (this.snapGuideTagEl) {
      this.snapGuideTagEl.textContent = snapInfo.label || 'Snap';
    }
  }

  _hideSnapGuide() {
    this.snapGuideEl?.classList.add('d-none');
  }

  _startEdgeAutoScroll(stepFn) {
    this._autoScrollStepFn = stepFn;
    if (this._autoScrollRafId !== null) return;
    const loop = () => {
      if (!this._autoScrollStepFn) {
        this._autoScrollRafId = null;
        return;
      }
      this._autoScrollStepFn();
      if (this._autoScrollStepFn) {
        this._autoScrollRafId = requestAnimationFrame(loop);
      } else {
        this._autoScrollRafId = null;
      }
    };
    this._autoScrollRafId = requestAnimationFrame(loop);
  }

  _stopEdgeAutoScroll() {
    this._autoScrollStepFn = null;
    if (this._autoScrollRafId !== null) {
      cancelAnimationFrame(this._autoScrollRafId);
      this._autoScrollRafId = null;
    }
  }

  _showTooltip(text, anchorEl = null, variant = 'drag') {
    if (!this.dragTooltipEl) return;
    this._tooltipVariant = variant;
    this.dragTooltipEl.textContent = text;
    this.dragTooltipEl.classList.remove('d-none', 'is-hover', 'is-drag');
    this.dragTooltipEl.classList.add(variant === 'hover' ? 'is-hover' : 'is-drag');

    const wrapRect = this.wrapperEl?.getBoundingClientRect();
    if (anchorEl && wrapRect && wrapRect.width > 0) {
      const aRect = anchorEl.getBoundingClientRect();
      const centerX = Math.max(54, Math.min(wrapRect.width - 54, (aRect.left + aRect.width * 0.5) - wrapRect.left));
      const topPx = Math.max(4, (aRect.top - wrapRect.top) - 25);
      this.dragTooltipEl.style.left = `${Math.round(centerX)}px`;
      this.dragTooltipEl.style.top = `${Math.round(topPx)}px`;
    } else {
      this.dragTooltipEl.style.left = '50%';
      this.dragTooltipEl.style.top = '32px';
    }
  }

  _hideTooltip(variant = null) {
    if (variant && this._tooltipVariant && this._tooltipVariant !== variant) return;
    this._tooltipVariant = null;
    this.dragTooltipEl?.classList.add('d-none');
    this.dragTooltipEl?.classList.remove('is-hover', 'is-drag');
  }

  _cancelHoverTooltip() {
    clearTimeout(this._hoverTimer);
    this._hoverTimer = null;
    this._hideTooltip('hover');
  }

  setSelectionInPlace(layerId, multiIds = null) {
    if (multiIds) {
      this.selectedLayerIds = new Set(multiIds);
    } else if (layerId && !this.selectedLayerIds.has(layerId)) {
      this.selectedLayerIds = new Set([layerId]);
    } else if (!layerId && !multiIds) {
      this.selectedLayerIds.clear();
    }
    this.lanesList?.querySelectorAll('.mf-clip[data-layer-id]').forEach((el) => {
      const id = el.dataset.layerId;
      el.classList.toggle('selected', id === layerId);
      el.classList.toggle('multi-selected', id !== layerId && this.selectedLayerIds.has(id));
    });
    this.headersList?.querySelectorAll('.mf-track-header-item[data-layer-id]').forEach((el) => {
      const id = el.dataset.layerId;
      el.classList.toggle('selected', id === layerId || this.selectedLayerIds.has(id));
    });
    this.lanesList?.querySelectorAll('.mf-track-lane[data-lane-type="single"]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.layerId === layerId);
    });
    const mainLane = this.lanesList?.querySelector('.mf-track-lane.main-track');
    const mainHdr = this.headersList?.querySelector('.mf-track-header-item.main-track');
    if (mainLane) {
      const mainHasSelected = Boolean(mainLane.querySelector('.mf-clip.selected, .mf-clip.multi-selected'));
      mainLane.classList.toggle('selected', mainHasSelected);
      mainHdr?.classList.toggle('selected', mainHasSelected);
    }
  }

  _ensureFilmstripTile(mediaItem) {
    if (!mediaItem || !mediaItem.url) return null;
    const cached = this.filmstripCache.get(mediaItem.id);
    if (cached && cached !== 'loading') return cached;
    if (cached === 'loading') return null;

    if (mediaItem.type === 'image' || mediaItem.thumbUrl) {
      const imgUrl = mediaItem.type === 'image' ? mediaItem.url : mediaItem.thumbUrl;
      this.filmstripCache.set(mediaItem.id, 'loading');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tile = document.createElement('canvas');
        tile.width = 56;
        tile.height = 34;
        const ctx = tile.getContext('2d');
        ctx.drawImage(img, 0, 0, tile.width, tile.height);
        this.filmstripCache.set(mediaItem.id, [tile]);
        this.cb.onPinchZoom?.();
      };
      img.onerror = () => this.filmstripCache.delete(mediaItem.id);
      img.src = imgUrl;
      return null;
    }

    if (mediaItem.type === 'video') {
      this.filmstripCache.set(mediaItem.id, 'loading');
      this._filmstripQueue.push(mediaItem);
      this._pumpFilmstripQueue();
    }
    return null;
  }

  _pumpFilmstripQueue() {
    if (this._filmstripBusy || this._filmstripQueue.length === 0) return;
    if (this.cb.isPlaying?.()) {
      setTimeout(() => this._pumpFilmstripQueue(), 350);
      return;
    }
    const mediaItem = this._filmstripQueue.shift();
    if (!mediaItem || !mediaItem.url) {
      this._pumpFilmstripQueue();
      return;
    }
    if (this.filmstripCache.get(mediaItem.id) !== 'loading') {
      this._pumpFilmstripQueue();
      return;
    }

    this._filmstripBusy = true;
    const finishItem = () => {
      this._filmstripBusy = false;
      setTimeout(() => this._pumpFilmstripQueue(), 60);
    };

    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    let settled = false;
    const cleanup = () => {
      try { vid.removeAttribute('src'); vid.load(); } catch {}
    };
    vid.onloadeddata = async () => {
      if (settled) return;
      settled = true;
      try {
        const rawDur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 2;
        const dur = Math.max(0.2, Math.min(3600, rawDur));
        const samples = 3;
        const tiles = [];
        for (let i = 0; i < samples; i++) {
          const t = Math.max(0, Math.min(Math.max(0, dur - 0.05), (dur * (i + 0.15)) / samples));
          await new Promise((res) => {
            const done = () => { vid.removeEventListener('seeked', done); res(); };
            vid.addEventListener('seeked', done, { once: true });
            try { vid.currentTime = t; } catch { res(); }
            setTimeout(done, 120);
          });
          const tile = document.createElement('canvas');
          tile.width = 56;
          tile.height = 34;
          tile.getContext('2d').drawImage(vid, 0, 0, tile.width, tile.height);
          tiles.push(tile);
        }
        this.filmstripCache.set(mediaItem.id, tiles);
        this.cb.onPinchZoom?.();
      } catch {
        this.filmstripCache.delete(mediaItem.id);
      } finally {
        cleanup();
        finishItem();
      }
    };
    vid.onerror = () => {
      if (settled) return;
      settled = true;
      this.filmstripCache.delete(mediaItem.id);
      cleanup();
      finishItem();
    };
    setTimeout(() => {
      if (settled) return;
      settled = true;
      this.filmstripCache.delete(mediaItem.id);
      cleanup();
      finishItem();
    }, 3500);
    vid.src = mediaItem.url;
  }

  _setZoomAnchored(nextPx, anchorFrame = null, explicitScreenX = null) {
    const oldPx = Math.max(MIN_PX_PER_FRAME, this.pxPerFrame);
    const clamped = Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, Number(nextPx.toFixed(3))));
    const vw = Math.max(200, this.scrollEl?.clientWidth || 360);
    const padLeft = this._getPadLeft();
    const curScroll = this.scrollEl?.scrollLeft || 0;

    let pivotFrame;
    let pivotScreenX;
    if (explicitScreenX !== null && anchorFrame !== null) {
      pivotFrame = anchorFrame;
      pivotScreenX = explicitScreenX;
    } else {
      const refFrame = anchorFrame ?? this._currentFrame ?? 0;
      const playheadX = frameToTimelineX(refFrame, oldPx, padLeft);
      const inView = playheadX >= curScroll && playheadX <= curScroll + vw;
      pivotScreenX = inView ? (playheadX - curScroll) : Math.min(vw * 0.35, padLeft + 48);
      pivotFrame = inView ? refFrame : Math.max(0, timelineXToFrame(curScroll + pivotScreenX, oldPx, padLeft));
    }

    this.pxPerFrame = clamped;
    this._pendingScrollLeft = Math.max(0, frameToTimelineX(pivotFrame, clamped, padLeft) - pivotScreenX);
  }

  zoomIn(anchorFrame = null) {
    this._setZoomAnchored(this.pxPerFrame * 1.38, anchorFrame);
    this.pinchTargetPx = this.pxPerFrame;
    this._applyFastZoomLayout();
    this._scheduleCrispRedraw(40);
  }

  zoomOut(anchorFrame = null) {
    this._setZoomAnchored(this.pxPerFrame / 1.38, anchorFrame);
    this.pinchTargetPx = this.pxPerFrame;
    this._applyFastZoomLayout();
    this._scheduleCrispRedraw(40);
  }

  zoomToFit(project = null) {
    const proj = project || this._lastRenderContext?.project;
    if (!proj) return;
    const fps = Math.max(1, proj.fps || 30);
    const contentEnd = Math.max(fps * 2, TimelineEngine.getProjectContentEndFrame(proj));
    const vw = Math.max(240, this.scrollEl?.clientWidth || 360);
    const padLeft = computeCenterPadLeft(vw);
    const fitSpan = Math.max(120, vw - padLeft - 24);
    const fitPx = Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, fitSpan / contentEnd));
    this.pxPerFrame = Number(fitPx.toFixed(3));
    this.pinchTargetPx = this.pxPerFrame;
    this._pendingScrollLeft = 0;
    this._applyFastZoomLayout({ preservePendingScroll: true });
    this._scheduleCrispRedraw(40);
  }

  _scheduleFastZoomUpdate() {
    if (this._zoomRafId !== null) return;
    const step = () => {
      if (this._isPinching) {
        const diff = this.pinchTargetPx - this.pxPerFrame;
        const nextPx = Math.abs(diff) < 0.0025
          ? this.pinchTargetPx
          : this.pxPerFrame + diff * 0.42;
        this._setZoomAnchored(nextPx, this.pinchPivotFrame, this.pinchPivotScreenX);
        this._applyFastZoomLayout({ preservePendingScroll: true });
        if (Math.abs(this.pinchTargetPx - this.pxPerFrame) >= 0.0025) {
          this._zoomRafId = requestAnimationFrame(step);
          return;
        }
      } else {
        this._applyFastZoomLayout();
      }
      this._zoomRafId = null;
    };
    this._zoomRafId = requestAnimationFrame(step);
  }

  _applyFastZoomLayout(opts = {}) {
    const ctx = this._lastRenderContext;
    const project = ctx?.project;
    if (!project) return;
    const fps = Math.max(1, project.fps || 30);
    const maxPlayheadFrame = TimelineEngine.getPlayheadMaxFrame(project);
    const totalFrames = Math.max(project.durationFrames, maxPlayheadFrame, fps * 5);
    const vw = Math.max(200, this.scrollEl?.clientWidth || 360);
    const padLeft = this._syncPlayheadOverlayPosition();
    const totalWidth = this._computeTimelineContentWidth(totalFrames, this.pxPerFrame, vw, padLeft);

    this.contentEl.style.width = `${totalWidth}px`;
    const appliedPendingScroll = this._pendingScrollLeft !== null;
    if (appliedPendingScroll) {
      const maxScroll = Math.max(0, totalWidth - vw);
      this._suppressScrollSeekUntil = performance.now() + 100;
      this.scrollEl.scrollLeft = Math.min(maxScroll, Math.max(0, this._pendingScrollLeft));
      this._pendingScrollLeft = null;
    }

    const px = this.pxPerFrame;
    const rawCur = this.cb.getPlayheadFrame?.() ?? this._currentFrame ?? 0;
    this._syncPlayheadOverlayPosition(Math.max(0, Math.min(maxPlayheadFrame, rawCur)));
    this.drawRuler(totalWidth, fps, totalFrames, maxPlayheadFrame);
    this._syncOverlayLineHeights();

    for (const ref of this._zoomRefs.clips) {
      const l = ref.layer;
      const leftPx = frameToTimelineX(l.startFrame, px, padLeft);
      const widthPx = Math.max(4, (l.endFrame - l.startFrame) * px);
      ref.clip.style.left = `${leftPx}px`;
      ref.clip.style.width = `${widthPx}px`;

      // Smoothly CSS-stretch cached filmstrip/waveform bitmaps during active pinch without resampling pixels
      if (ref.filmCanvas) {
        ref.filmCanvas.style.left = '0px';
        ref.filmCanvas.style.width = '100%';
      }
      if (ref.waveCanvas) {
        ref.waveCanvas.style.left = '0px';
        ref.waveCanvas.style.width = '100%';
      }
      for (const d of ref.diamonds) {
        const relPx = (d.frame - l.startFrame) * px;
        d.el.style.left = `${relPx}px`;
        d.el.style.display = relPx >= 0 && relPx <= widthPx ? '' : 'none';
      }
    }

    for (const s of this._zoomRefs.seams) {
      s.el.style.left = `${frameToTimelineX(s.frame, px, padLeft)}px`;
    }
    for (const ts of (this._zoomRefs.transSpans || [])) {
      ts.el.style.left = `${frameToTimelineX(ts.frame, px, padLeft)}px`;
      ts.el.style.width = `${Math.max(8, ts.durationFrames * px)}px`;
    }
    for (const g of this._zoomRefs.gaps) {
      g.el.style.left = `${frameToTimelineX(g.frame, px, padLeft)}px`;
    }
    for (const b of this._zoomRefs.addBtns) {
      b.el.style.left = `${frameToTimelineX(b.frame, px, padLeft) + 8}px`;
    }
    for (const sp of this._zoomRefs.kfSpans) {
      sp.el.style.left = `${frameToTimelineX(sp.layer.startFrame, px, padLeft)}px`;
      sp.el.style.width = `${Math.max(4, (sp.layer.endFrame - sp.layer.startFrame) * px)}px`;
    }
    for (const cn of this._zoomRefs.kfConnectors) {
      const x1 = frameToTimelineX(cn.fromFrame, px, padLeft);
      const x2 = frameToTimelineX(cn.toFrame, px, padLeft);
      cn.el.style.left = `${x1}px`;
      cn.el.style.width = `${Math.max(0, x2 - x1)}px`;
    }
    for (const kd of this._zoomRefs.kfDiamonds) {
      kd.el.style.left = `${frameToTimelineX(kd.frame, px, padLeft)}px`;
    }
  }

  _scheduleCrispRedraw(delayMs = 90) {
    clearTimeout(this._pinchEndTimer);
    this._pinchEndTimer = setTimeout(() => {
      if (this._isPinching) return;
      const padLeft = this._getPadLeft();
      for (const entry of this._waveEntries) {
        entry.leftPx = frameToTimelineX(entry.layer.startFrame, this.pxPerFrame, padLeft);
        entry.widthPx = Math.max(4, (entry.layer.endFrame - entry.layer.startFrame) * this.pxPerFrame);
        entry.renderedStart = -1;
        entry.renderedEnd = -1;
      }
      for (const entry of this._filmstripEntries) {
        if (entry.layer) {
          entry.leftPx = frameToTimelineX(entry.layer.startFrame, this.pxPerFrame, padLeft);
          entry.widthPx = Math.max(4, (entry.layer.endFrame - entry.layer.startFrame) * this.pxPerFrame);
        }
        entry.renderedStart = -1;
        entry.renderedEnd = -1;
      }
      this.redrawVisibleClipCanvases();
    }, delayMs);
  }

  _beginPinchSession(x1, y1, x2, y2) {
    if (this._isClipHoldLocked) return;
    this._isPinching = true;
    clearTimeout(this._pinchEndTimer);
    if (this._activeClipAbort) {
      this._activeClipAbort();
      this._activeClipAbort = null;
    }
    if (this._activeScrubAbort) {
      this._activeScrubAbort();
      this._activeScrubAbort = null;
    }
    this.pinchStartDist = Math.max(20, Math.hypot(x1 - x2, y1 - y2));
    this.pinchStartPx = this.pxPerFrame;
    this.pinchTargetPx = this.pxPerFrame;
    const rect = this.scrollEl.getBoundingClientRect();
    const padLeft = this._getPadLeft();
    const midScreenX = Math.max(0, ((x1 + x2) * 0.5) - rect.left);
    this.pinchPivotScreenX = midScreenX;
    this.pinchPivotFrame = Math.max(0, timelineXToFrame(this.scrollEl.scrollLeft + midScreenX, this.pxPerFrame, padLeft));
  }

  _updatePinchSession(x1, y1, x2, y2) {
    if (!this._isPinching || !this.pinchStartDist) return;
    const dist = Math.hypot(x1 - x2, y1 - y2);
    const deltaPx = dist - this.pinchStartDist;
    // Initial-finger-spacing invariant exponential scale: moderate, smooth expansion/contraction
    const rawTarget = this.pinchStartPx * Math.exp(deltaPx / 135);
    this.pinchTargetPx = Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, rawTarget));
    const rect = this.scrollEl.getBoundingClientRect();
    this.pinchPivotScreenX = Math.max(0, ((x1 + x2) * 0.5) - rect.left);
    this._scheduleFastZoomUpdate();
  }

  _endPinchSession() {
    this.pinchStartDist = null;
    if (this._isPinching) {
      this._isPinching = false;
      this._suppressBgTapUntil = performance.now() + 280;
      if (Math.abs(this.pinchTargetPx - this.pxPerFrame) >= 0.002) {
        this._setZoomAnchored(this.pinchTargetPx, this.pinchPivotFrame, this.pinchPivotScreenX);
        this._applyFastZoomLayout({ preservePendingScroll: true });
      }
      this._syncPlayheadOverlayPosition(this._currentFrame);
      this._scheduleCrispRedraw(70);
    }
  }

  bindPinchZoom() {
    // Primary multi-touch handler on Android WebView (prevents scroll/pan steal when 2nd finger lands)
    this.scrollEl.addEventListener('touchstart', (e) => {
      if (this._isClipHoldLocked) return;
      if (e.touches && e.touches.length >= 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        this._beginPinchSession(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
      }
    }, { passive: false, capture: true });

    this.scrollEl.addEventListener('touchmove', (e) => {
      if (this._isClipHoldLocked) return;
      if (e.touches && e.touches.length >= 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (!this._isPinching) {
          this._beginPinchSession(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
        } else {
          this._updatePinchSession(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
        }
      }
    }, { passive: false, capture: true });

    const onTouchEnd = (e) => {
      if (!e.touches || e.touches.length === 0) {
        for (const [pid, info] of this.activePointers.entries()) {
          if (info?.pointerType === 'touch') this.activePointers.delete(pid);
        }
      }
      if (this._isPinching && (!e.touches || e.touches.length < 2)) {
        this._endPinchSession();
      }
    };
    this.scrollEl.addEventListener('touchend', onTouchEnd, { capture: true });
    this.scrollEl.addEventListener('touchcancel', onTouchEnd, { capture: true });

    // Secondary multi-pointer fallback (desktop/trackpad/stylus)
    this.scrollEl.addEventListener('pointerdown', (e) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType || 'touch' });
      if (!this._isClipHoldLocked && this.activePointers.size >= 2 && !this._isPinching) {
        const pts = [...this.activePointers.values()];
        this._beginPinchSession(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      }
    }, { capture: true });

    const onWinPinchPtrMove = (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType || 'touch' });
      if (!this._isClipHoldLocked && this.activePointers.size >= 2 && this._isPinching && e.pointerType !== 'touch') {
        const pts = [...this.activePointers.values()];
        this._updatePinchSession(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      }
    };

    const endPtr = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2 && this._isPinching && e.pointerType !== 'touch') {
        this._endPinchSession();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onWinPinchPtrMove, { capture: true });
      window.addEventListener('pointerup', endPtr, { capture: true });
      window.addEventListener('pointercancel', endPtr, { capture: true });
      window.addEventListener('touchend', onTouchEnd, { capture: true });
      window.addEventListener('touchcancel', onTouchEnd, { capture: true });
      window.addEventListener('blur', () => {
        this.activePointers.clear();
        if (this._isPinching) this._endPinchSession();
      });
    } else {
      this.scrollEl.addEventListener('pointermove', onWinPinchPtrMove, { capture: true });
      this.scrollEl.addEventListener('pointerup', endPtr, { capture: true });
      this.scrollEl.addEventListener('pointercancel', endPtr, { capture: true });
    }
  }

  bindRulerAndScroll() {
    const clearProgrammaticLock = () => { this._suppressScrollSeekUntil = 0; };
    this.scrollEl.addEventListener('pointerdown', clearProgrammaticLock, { passive: true });
    this.scrollEl.addEventListener('touchstart', clearProgrammaticLock, { passive: true });
    this.scrollEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) clearProgrammaticLock();
    }, { passive: true });

    this.scrollEl.addEventListener('scroll', () => {
      this._cancelHoverTooltip();
      this.headersList.scrollTop = this.scrollEl.scrollTop;
      const curScrollLeft = Math.max(0, this.scrollEl.scrollLeft || 0);
      this._ensureRulerCoversViewport();
      if (Math.abs(curScrollLeft - this._lastClipSliceScrollLeft) >= 12) {
        this._lastClipSliceScrollLeft = curScrollLeft;
        this.redrawVisibleClipCanvases();
      }
    });
    this.headersList.addEventListener('scroll', () => {
      this.scrollEl.scrollTop = this.headersList.scrollTop;
    });
    if (typeof ResizeObserver !== 'undefined' && this.scrollEl) {
      let lastObservedW = this.scrollEl.clientWidth || 0;
      this._rulerResizeObs = new ResizeObserver(() => {
        const curW = this.scrollEl?.clientWidth || 0;
        const widthChanged = Math.abs(curW - lastObservedW) >= 1;
        lastObservedW = curW;
        this._syncPlayheadOverlayPosition();
        this._syncOverlayLineHeights();
        if (widthChanged && this._lastRenderContext?.project) {
          this._applyFastZoomLayout();
          this.redrawVisibleClipCanvases();
        } else if (this._lastRulerParams) {
          this._ensureRulerCoversViewport();
          this.redrawVisibleClipCanvases();
        }
      });
      this._rulerResizeObs.observe(this.scrollEl);
      if (this.lanesList) this._rulerResizeObs.observe(this.lanesList);
    }

    let scrubbing = false;
    let scrubPointerId = null;
    let scrubTargetEl = null;
    let lastScrubX = 0;
    let lastScrubShowTip = false;
    let scrubDownX = 0;
    let scrubDownMarker = null;

    const seekFromPointer = (clientX, showTip = false) => {
      const rect = this.scrollEl.getBoundingClientRect();
      const padLeft = this._getPadLeft();
      const x = (clientX - rect.left) + this.scrollEl.scrollLeft;
      const maxFrame = Number.isFinite(this._lastRulerParams?.maxPlayheadFrame)
        ? this._lastRulerParams.maxPlayheadFrame
        : TimelineEngine.getPlayheadMaxFrame(this._lastRenderContext?.project);
      const frame = Math.max(0, Math.min(maxFrame, Math.round(timelineXToFrame(x, this.pxPerFrame, padLeft))));
      if (showTip && this.dragTooltipEl) {
        const fps = Math.max(1, this._lastRulerParams?.fps || 30);
        const sec = (frame / fps).toFixed(2);
        this.dragTooltipEl.textContent = `Playhead · ${sec}s (F${frame})`;
        this.dragTooltipEl.classList.remove('d-none');
      }
      this._currentFrame = frame;
      this._syncPlayheadOverlayPosition(frame);
      this.cb.onSeekFrame(frame);
    };

    const scrubAutoScrollTick = () => {
      if (!scrubbing) return;
      const rect = this.scrollEl.getBoundingClientRect();
      const step = computeEdgeAutoScrollDelta(lastScrubX, rect.left, rect.right, this.scrollEl.scrollLeft, 34, 16);
      if (step === 0) return;
      const maxScroll = Math.max(0, this.scrollEl.scrollWidth - this.scrollEl.clientWidth);
      const nextScroll = Math.max(0, Math.min(maxScroll, this.scrollEl.scrollLeft + step));
      if (nextScroll === this.scrollEl.scrollLeft) return;
      this.scrollEl.scrollLeft = nextScroll;
      this._ensureRulerCoversViewport();
      this.redrawVisibleClipCanvases();
      seekFromPointer(lastScrubX, lastScrubShowTip);
    };

    const onWinScrubMove = (e) => {
      if (!scrubbing || (scrubPointerId !== null && e.pointerId !== scrubPointerId)) return;
      if (this._isPinching || this.activePointers.size >= 2) {
        endScrub(e);
        return;
      }
      lastScrubX = e.clientX;
      seekFromPointer(e.clientX, lastScrubShowTip);
    };

    const onWinScrubEnd = (e) => {
      if (!scrubbing || (scrubPointerId !== null && e.pointerId !== scrubPointerId)) return;
      endScrub(e);
    };

    const detachScrubWin = () => {
      if (typeof window === 'undefined') return;
      window.removeEventListener('pointermove', onWinScrubMove, true);
      window.removeEventListener('pointerup', onWinScrubEnd, true);
      window.removeEventListener('pointercancel', onWinScrubEnd, true);
    };

    const startScrub = (targetEl, e, showTip) => {
      if (this._isPinching || this.activePointers.size >= 2) return;
      e.stopPropagation();
      e.preventDefault();
      scrubbing = true;
      scrubPointerId = e.pointerId;
      scrubTargetEl = targetEl;
      lastScrubX = e.clientX;
      lastScrubShowTip = showTip;
      this.isScrubbing = true;
      this.playheadEl?.classList.add('dragging');
      this._activeScrubAbort = () => endScrub();
      try { targetEl.setPointerCapture(e.pointerId); } catch {}
      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', onWinScrubMove, true);
        window.addEventListener('pointerup', onWinScrubEnd, true);
        window.addEventListener('pointercancel', onWinScrubEnd, true);
      }
      this.cb.onScrubStart?.();
      seekFromPointer(e.clientX, showTip);
      this._startEdgeAutoScroll(scrubAutoScrollTick);
    };

    const endScrub = (e = null) => {
      if (!scrubbing) return;
      const wasRuler = scrubTargetEl === this.rulerCanvas;
      const clickedMarker = (
        wasRuler &&
        scrubDownMarker &&
        e?.type === 'pointerup' &&
        Math.abs((e.clientX ?? scrubDownX) - scrubDownX) <= 5
      ) ? scrubDownMarker : null;
      scrubDownMarker = null;
      scrubbing = false;
      detachScrubWin();
      if (scrubTargetEl && scrubPointerId !== null) {
        try {
          if (scrubTargetEl.hasPointerCapture?.(scrubPointerId)) {
            scrubTargetEl.releasePointerCapture(scrubPointerId);
          }
        } catch {}
      }
      scrubPointerId = null;
      scrubTargetEl = null;
      this._activeScrubAbort = null;
      this._stopEdgeAutoScroll();
      this.isScrubbing = false;
      this.playheadEl?.classList.remove('dragging');
      this.dragTooltipEl?.classList.add('d-none');
      this.cb.onScrubEnd?.();
      if (clickedMarker && typeof clickedMarker === 'object') {
        this.cb.onClickMarker?.(clickedMarker, e.clientX, e.clientY);
      }
    };

    this.rulerCanvas.addEventListener('pointerdown', (e) => {
      scrubDownX = e.clientX;
      const rect = this.scrollEl.getBoundingClientRect();
      const padLeft = this._getPadLeft();
      const x = (e.clientX - rect.left) + this.scrollEl.scrollLeft;
      scrubDownMarker = null;
      for (const m of (this._lastTimelineMarkers || [])) {
        const mf = typeof m === 'number' ? m : Number(m?.frame);
        if (!Number.isFinite(mf)) continue;
        if (Math.abs(frameToTimelineX(mf, this.pxPerFrame, padLeft) - x) <= 10) {
          scrubDownMarker = m;
          break;
        }
      }
      startScrub(this.rulerCanvas, e, false);
    });

    const phDragTarget = this.playheadHeadEl || this.playheadEl;
    if (phDragTarget) {
      phDragTarget.addEventListener('pointerdown', (e) => {
        scrubDownMarker = null;
        startScrub(phDragTarget, e, true);
      });
    }

    // Ctrl/Cmd + Wheel zoom anchored under cursor
    this.scrollEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = this.scrollEl.getBoundingClientRect();
      const padLeft = this._getPadLeft();
      const cursorX = Math.max(0, e.clientX - rect.left);
      const cursorFrame = Math.max(0, timelineXToFrame(this.scrollEl.scrollLeft + cursorX, this.pxPerFrame, padLeft));
      const factor = Math.exp(-e.deltaY * 0.0026);
      this._setZoomAnchored(this.pxPerFrame * factor, cursorFrame, cursorX);
      this.pinchTargetPx = this.pxPerFrame;
      this._applyFastZoomLayout({ preservePendingScroll: true });
      this._syncPlayheadOverlayPosition(this._currentFrame);
      this._scheduleCrispRedraw(70);
    }, { passive: false });

    // Empty timeline drag = Marquee multi-select; short tap = deselect all
    let bgDownX = 0;
    let bgDownY = 0;
    let bgTracking = false;
    let marqueeEl = null;
    let marqueeActive = false;
    const clearMarqueeEl = () => {
      if (marqueeEl) {
        marqueeEl.remove();
        marqueeEl = null;
      }
      marqueeActive = false;
    };
    this.scrollEl.addEventListener('pointerdown', (e) => {
      if (
        this._isPinching ||
        this.activePointers.size >= 2 ||
        e.target.closest('.mf-clip') ||
        e.target.closest('.mf-kf-diamond') ||
        e.target.closest('.mf-kf-lane-diamond') ||
        e.target.closest('.mf-kf-lane') ||
        e.target.closest('.mf-trans-seam-btn') ||
        e.target.closest('#timelineKfBar') ||
        e.target.closest('#playheadLine') ||
        e.target === this.rulerCanvas
      ) {
        bgTracking = false;
        return;
      }
      bgTracking = true;
      marqueeActive = false;
      bgDownX = e.clientX;
      bgDownY = e.clientY;
    });
    this.scrollEl.addEventListener('pointermove', (e) => {
      if (!bgTracking) return;
      if (this._isPinching || this.activePointers.size >= 2) {
        bgTracking = false;
        clearMarqueeEl();
        return;
      }
      const dist = Math.hypot(e.clientX - bgDownX, e.clientY - bgDownY);
      if (!marqueeActive && dist >= 10) {
        marqueeActive = true;
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'mf-marquee-box';
        this.lanesList.appendChild(marqueeEl);
      }
      if (!marqueeActive || !marqueeEl) return;
      const lanesRect = this.lanesList.getBoundingClientRect();
      const leftPx = Math.min(bgDownX, e.clientX) - lanesRect.left;
      const topPx = Math.min(bgDownY, e.clientY) - lanesRect.top + this.lanesList.scrollTop;
      const widthPx = Math.abs(e.clientX - bgDownX);
      const heightPx = Math.abs(e.clientY - bgDownY);
      marqueeEl.style.left = `${Math.max(0, leftPx)}px`;
      marqueeEl.style.top = `${Math.max(0, topPx)}px`;
      marqueeEl.style.width = `${widthPx}px`;
      marqueeEl.style.height = `${heightPx}px`;

      const selLeft = Math.min(bgDownX, e.clientX);
      const selRight = Math.max(bgDownX, e.clientX);
      const selTop = Math.min(bgDownY, e.clientY);
      const selBottom = Math.max(bgDownY, e.clientY);
      const hitIds = [];
      this.lanesList.querySelectorAll('.mf-clip[data-layer-id]').forEach((clipEl) => {
        const r = clipEl.getBoundingClientRect();
        const intersects = !(r.right < selLeft || r.left > selRight || r.bottom < selTop || r.top > selBottom);
        if (intersects) hitIds.push(clipEl.dataset.layerId);
      });
      this.setSelectionInPlace(hitIds[0] || null, hitIds);
    });
    const finishBg = (e) => {
      if (!bgTracking) return;
      bgTracking = false;
      const wasMarquee = marqueeActive;
      const selectedSnapshot = [...this.selectedLayerIds];
      clearMarqueeEl();
      if (this._isPinching || this.activePointers.size > 1 || performance.now() < this._suppressBgTapUntil) return;
      if (wasMarquee) {
        this.cb.onMarqueeSelect?.(selectedSnapshot);
        return;
      }
      if (Math.hypot(e.clientX - bgDownX, e.clientY - bgDownY) <= 8) {
        this.selectedKf = null;
        this.selectedLayerIds.clear();
        this._renderKfFloatingBar(this._lastRenderContext?.project);
        this.cb.onMarqueeSelect?.([]);
        this.cb.onSelectLayer(null);
      }
    };
    this.scrollEl.addEventListener('pointerup', finishBg);
    this.scrollEl.addEventListener('pointercancel', finishBg);
  }

  render(project, currentFrame, selectedLayerId, audioEngine, mediaMap = null) {
    if (this._isClipGestureActive) {
      this._deferredRenderArgs = { project, currentFrame, selectedLayerId, audioEngine, mediaMap };
      return;
    }
    this._deferredRenderArgs = null;
    const maxPlayheadFrame = TimelineEngine.getPlayheadMaxFrame(project);
    const rawCur = Number.isFinite(Number(currentFrame)) ? Number(currentFrame) : 0;
    this._currentFrame = Math.max(0, Math.min(maxPlayheadFrame, rawCur));

    const fps = Math.max(1, project.fps || 30);
    const totalFrames = Math.max(project.durationFrames, maxPlayheadFrame, fps * 5);
    const vw = Math.max(200, this.scrollEl.clientWidth || 360);
    const padLeft = this._getPadLeft();
    const totalWidth = this._computeTimelineContentWidth(totalFrames, this.pxPerFrame, vw, padLeft);

    this.contentEl.style.width = `${totalWidth}px`;
    const hasPendingScroll = this._pendingScrollLeft !== null;
    if (hasPendingScroll) {
      const maxScroll = Math.max(0, totalWidth - vw);
      this._suppressScrollSeekUntil = performance.now() + 90;
      this.scrollEl.scrollLeft = Math.min(maxScroll, Math.max(0, this._pendingScrollLeft));
      this._pendingScrollLeft = null;
    }

    if (this.layerCountEl) {
      this.layerCountEl.textContent = String(project.layers.length);
    }

    // Prune checked ids no longer in project
    const validIds = new Set(project.layers.map((l) => l.id));
    for (const id of [...this.checkedLayerIds]) {
      if (!validIds.has(id)) this.checkedLayerIds.delete(id);
    }
    this.btnGroupChecked?.classList.toggle('d-none', this.checkedLayerIds.size < 2);
    this._lastTimelineMarkers = Array.isArray(project.markers) ? project.markers : [];
    this._lastBeatMarkers = Array.isArray(project.beatMarkers) ? project.beatMarkers : [];

    if (hasPendingScroll) {
      this._syncPlayheadOverlayPosition(this._currentFrame);
    } else {
      this.updatePlayhead(this._currentFrame);
    }
    this.drawRuler(totalWidth, fps, totalFrames, maxPlayheadFrame);
    this.renderHeadersAndLanes(project, selectedLayerId, audioEngine, mediaMap);
    this._syncOverlayLineHeights();
    this._renderKfFloatingBar(project);
  }

  _syncOverlayLineHeights() {
    const viewportH = this.scrollEl?.clientHeight || 0;
    const rulerH = this.rulerTrackEl?.offsetHeight || this.rulerCanvas?.offsetHeight || 28;
    const lanesH = Math.max(this.lanesList?.scrollHeight || 0, this.lanesList?.offsetHeight || 0);
    const targetH = Math.max(viewportH, rulerH + lanesH);
    if (targetH > 0) {
      if (this.contentEl) this.contentEl.style.height = `${targetH}px`;
      if (this.snapGuideEl) this.snapGuideEl.style.height = `${targetH}px`;
    }
  }

  _ensureRulerCoversViewport(expandedWidth = null) {
    if (!this._lastRulerParams) return;
    const viewportW = Math.max(200, Math.ceil(this.scrollEl?.clientWidth || 360));
    const scrollLeft = Math.max(0, this.scrollEl?.scrollLeft || 0);
    const domW = parseFloat(this.contentEl?.style.width || '0') || 0;
    const effectiveTotalW = Math.max(
      this._lastRulerParams.totalWidth || 0,
      Number(expandedWidth) || 0,
      domW,
      viewportW
    );
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const win = computeRulerWindow({
      totalWidth: effectiveTotalW,
      viewportW,
      scrollLeft,
      dpr,
      currentStart: this._rulerWindowStart,
      currentWidth: this._rulerWindowWidth
    });
    if (win.needsRedraw || effectiveTotalW > this._rulerContentWidth + 1) {
      this._lastRulerParams.totalWidth = effectiveTotalW;
      this.drawRuler(
        effectiveTotalW,
        this._lastRulerParams.fps,
        this._lastRulerParams.totalFrames,
        this._lastRulerParams.maxPlayheadFrame
      );
    }
  }

  redrawRulerOnly() {
    if (!this._lastRulerParams) return;
    const { totalWidth, fps, totalFrames, maxPlayheadFrame } = this._lastRulerParams;
    this.drawRuler(totalWidth, fps, totalFrames, maxPlayheadFrame);
  }

  drawRuler(totalWidth, fps, totalFrames, maxPlayheadFrame = null) {
    const safeFps = Math.max(1, Math.round(fps || 30));
    const safeMaxPh = Number.isFinite(Number(maxPlayheadFrame))
      ? Math.max(0, Math.round(Number(maxPlayheadFrame)))
      : TimelineEngine.getPlayheadMaxFrame(this._lastRenderContext?.project);
    const viewportW = Math.max(200, Math.ceil(this.scrollEl?.clientWidth || totalWidth || 360));
    const domW = parseFloat(this.contentEl?.style.width || '0') || 0;
    const effectiveTotalW = Math.max(totalWidth || 0, domW, viewportW);
    this._lastRulerParams = { totalWidth: effectiveTotalW, fps: safeFps, totalFrames, maxPlayheadFrame: safeMaxPh };

    const canvas = this.rulerCanvas;
    const padLeft = this._getPadLeft();
    const scrollLeft = Math.max(0, this.scrollEl?.scrollLeft || 0);
    this._lastDrawnScrollLeft = scrollLeft;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const win = computeRulerWindow({
      totalWidth: effectiveTotalW,
      viewportW,
      scrollLeft,
      dpr,
      currentStart: 0,
      currentWidth: 0
    });
    const windowStart = win.windowStart;
    const windowW = win.windowWidth;
    this._rulerWindowStart = windowStart;
    this._rulerWindowWidth = windowW;
    this._rulerContentWidth = effectiveTotalW;

    const targetPxW = Math.round(windowW * dpr);
    const targetPxH = Math.round(28 * dpr);

    if (canvas.width !== targetPxW || canvas.height !== targetPxH) {
      canvas.width = targetPxW;
      canvas.height = targetPxH;
    }
    canvas.style.left = `${windowStart}px`;
    canvas.style.width = `${windowW}px`;
    canvas.style.height = '28px';

    const ctx = canvas.getContext('2d');
    const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('mf-theme-light');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, windowW, 28);
    ctx.fillStyle = isLight ? '#f8fafc' : '#131822';
    ctx.fillRect(0, 0, windowW, 28);

    // Subtle pre-0s lead-in area to the left of frame 0 in content coordinates
    const zeroLocalX = frameToTimelineX(0, this.pxPerFrame, padLeft) - windowStart;
    if (zeroLocalX > 0) {
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(4, 7, 13, 0.45)';
      ctx.fillRect(0, 0, Math.min(windowW, zeroLocalX), 28);
    }

    const spec = computeDynamicRulerTicks(this.pxPerFrame, safeFps);
    const minorStep = Math.max(1, spec.minorFrames);
    const startFrame = Math.max(0, Math.floor(Math.max(0, (windowStart - padLeft - 90) / this.pxPerFrame) / minorStep) * minorStep);
    const endFrame = Math.max(0, Math.ceil((windowStart - padLeft + windowW + 90) / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame)));

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    let lastLabelRight = -100;

    for (let f = startFrame; f <= endFrame; f += minorStep) {
      const localX = frameToTimelineX(f, this.pxPerFrame, padLeft) - windowStart;
      if (localX < -80 || localX > windowW + 80) continue;
      const x = Math.round(localX) + 0.5;

      const beyondEnd = f > safeMaxPh;
      const isMajor = f % spec.majorFrames === 0;
      const isSecond = f % safeFps === 0;
      const isLabelTick = f % spec.labelFrames === 0 || f === 0;

      if (isLight) {
        ctx.strokeStyle = beyondEnd
          ? (isMajor || isLabelTick ? '#cbd5e1' : '#e2e8f0')
          : (isMajor ? '#475569' : isSecond ? '#64748b' : '#cbd5e1');
      } else {
        ctx.strokeStyle = beyondEnd
          ? (isMajor || isLabelTick ? '#33415c' : '#1d2536')
          : (isMajor ? '#587099' : isSecond ? '#435370' : '#263147');
      }
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 10 : isSecond ? 13 : isLabelTick ? 15 : 21);
      ctx.lineTo(x, 28);
      ctx.stroke();

      if (isLabelTick && x >= -12 && x <= windowW - 6 && x > lastLabelRight + 6) {
        const label = formatRulerLabel(f, safeFps);
        const tw = ctx.measureText(label).width;
        const isMinute = isSecond && ((f / safeFps) % 60 === 0) && f > 0;
        if (isLight) {
          ctx.fillStyle = beyondEnd
            ? '#94a3b8'
            : (isMinute ? '#0284c7' : isMajor || isSecond ? '#0f172a' : '#475569');
        } else {
          ctx.fillStyle = beyondEnd
            ? '#6f7e99'
            : (isMinute ? '#00e5ff' : isMajor || isSecond ? '#d3dceb' : '#96a6c0');
        }
        ctx.fillText(label, x + 3, 2);
        lastLabelRight = x + 3 + tw;
      }
    }

    // Marker showing the exact end of the last item (playhead max limit) along the continuous ruler
    if (safeMaxPh > 0) {
      const durX = Math.round(frameToTimelineX(safeMaxPh, this.pxPerFrame, padLeft) - windowStart) + 0.5;
      if (durX >= 0 && durX <= windowW) {
        ctx.save();
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(0, 229, 255, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(durX, 0);
        ctx.lineTo(durX, 28);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw Timeline Markers along upper/mid ruler (emerald bookmark pins)
    if (this._lastTimelineMarkers.length > 0) {
      ctx.save();
      for (const m of this._lastTimelineMarkers) {
        const mf = typeof m === 'number' ? m : Number(m?.frame);
        if (!Number.isFinite(mf)) continue;
        const mx = frameToTimelineX(mf, this.pxPerFrame, padLeft) - windowStart;
        if (mx < -12 || mx > windowW + 12) continue;
        const color = (typeof m === 'object' && m?.color) ? m.color : '#34d399';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx, 10);
        ctx.lineTo(mx, 28);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(mx - 4, 2);
        ctx.lineTo(mx + 4, 2);
        ctx.lineTo(mx + 4, 9);
        ctx.lineTo(mx, 13);
        ctx.lineTo(mx - 4, 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw Beat Markers along bottom of ruler
    if (this._lastBeatMarkers.length > 0) {
      ctx.save();
      for (const bf of this._lastBeatMarkers) {
        const bx = frameToTimelineX(bf, this.pxPerFrame, padLeft) - windowStart;
        if (bx < -10 || bx > windowW + 10) continue;
        ctx.fillStyle = '#ffab40';
        ctx.strokeStyle = '#071018';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, 18);
        ctx.lineTo(bx + 4.5, 22.5);
        ctx.lineTo(bx, 27);
        ctx.lineTo(bx - 4.5, 22.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  updatePlayhead(currentFrame) {
    const rawF = Number.isFinite(Number(currentFrame)) ? Number(currentFrame) : 0;
    const maxF = this._lastRenderContext?.project
      ? TimelineEngine.getPlayheadMaxFrame(this._lastRenderContext.project)
      : (Number.isFinite(this._lastRulerParams?.maxPlayheadFrame) ? this._lastRulerParams.maxPlayheadFrame : rawF);
    const f = Math.max(0, Math.min(maxF, rawF));
    this._currentFrame = f;
    const padLeft = this._getPadLeft();
    if (this.scrollEl && !this.isScrubbing && !this._isPinching && !this._isClipGestureActive) {
      const vw = Math.max(200, this.scrollEl.clientWidth || 360);
      const targetX = frameToTimelineX(f, this.pxPerFrame, padLeft);
      const curScroll = this.scrollEl.scrollLeft || 0;
      const maxScroll = Math.max(0, this.scrollEl.scrollWidth - vw);
      let nextScroll = null;
      if (targetX > curScroll + vw - 24) {
        nextScroll = Math.min(maxScroll, Math.max(0, targetX - Math.round(vw * 0.25)));
      } else if (targetX < curScroll + (f === 0 ? 0 : 12)) {
        nextScroll = Math.max(0, targetX - 24);
      }
      if (nextScroll !== null && Math.abs(nextScroll - curScroll) >= 0.5) {
        this.scrollEl.scrollLeft = nextScroll;
        this._ensureRulerCoversViewport();
        this.redrawVisibleClipCanvases();
      }
    }
    this._syncPlayheadOverlayPosition(f);
  }

  _buildClipElement(project, layer, isSelected, audioEngine, mediaMap) {
    const padLeft = this._getPadLeft();
    const leftPx = frameToTimelineX(layer.startFrame, this.pxPerFrame, padLeft);
    const widthPx = Math.max(4, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
    const isMulti = !isSelected && this.selectedLayerIds.has(layer.id);

    let adjClass = '';
    if (layer.type === 'adjustment') {
      const hasVfx = TimelineEngine.getActiveVfxList(layer).length > 0;
      const isFilterAdj = layer.adjustmentKind === 'filter' || (layer.filterId && layer.filterId !== 'normal' && !hasVfx);
      const isEffectAdj = layer.adjustmentKind === 'effect' || hasVfx;
      if (isFilterAdj && !isEffectAdj) adjClass = 'mf-adj-filter';
      else if (isEffectAdj) adjClass = 'mf-adj-effect';
    }

    const clip = document.createElement('div');
    clip.className = `mf-clip mf-clip-${layer.type} ${adjClass} ${isSelected ? 'selected' : ''} ${isMulti ? 'multi-selected' : ''} ${layer.locked ? 'locked' : ''}`.trim().replace(/\s+/g, ' ');
    clip.dataset.layerId = layer.id;
    clip.style.left = `${leftPx}px`;
    clip.style.width = `${widthPx}px`;

    const mediaBg = document.createElement('div');
    mediaBg.className = 'mf-clip-media-bg';
    clip.appendChild(mediaBg);

    let filmEntry = null;
    let filmCanvas = null;
    if ((layer.type === 'video' || layer.type === 'image') && layer.mediaId && mediaMap) {
      const mItem = mediaMap.get(layer.mediaId);
      const tiles = mItem ? this._ensureFilmstripTile(mItem) : null;
      if (tiles && tiles.length > 0) {
        filmCanvas = document.createElement('canvas');
        filmCanvas.className = 'mf-clip-filmstrip';
        mediaBg.appendChild(filmCanvas);
        filmEntry = { canvas: filmCanvas, layer, tiles, leftPx, widthPx, renderedStart: -1, renderedEnd: -1 };
        this._filmstripEntries.push(filmEntry);
        this._paintFilmstripEntry(filmEntry, true);
      }
    }

    let waveEntry = null;
    let waveCanvas = null;
    if ((layer.type === 'audio' || layer.type === 'video') && layer.mediaId) {
      const mItem = mediaMap?.get(layer.mediaId);
      if (mItem && !audioEngine.hasBuffer?.(layer.mediaId) && !audioEngine.failedIds?.has(layer.mediaId)) {
        audioEngine.loadBuffer(mItem).then((buf) => {
          if (buf) this.cb.onPinchZoom?.();
        });
      }
      const hasAudioOrVol = Boolean(
        audioEngine.hasBuffer?.(layer.mediaId) ||
        audioEngine.getPeaks(layer.mediaId)?.length ||
        layer.keyframes?.volume?.length
      );
      if (hasAudioOrVol) {
        waveCanvas = document.createElement('canvas');
        waveCanvas.className = 'mf-clip-wave';
        mediaBg.appendChild(waveCanvas);
        waveEntry = {
          canvas: waveCanvas,
          layer,
          project,
          audioEngine,
          leftPx,
          widthPx,
          renderedStart: -1,
          renderedEnd: -1
        };
        this._waveEntries.push(waveEntry);
        this._paintWaveEntry(waveEntry, true);
      }
    }

    const contentRow = document.createElement('div');
    contentRow.className = 'mf-clip-content';

    const label = document.createElement('span');
    label.className = 'mf-clip-label';
    label.textContent = layer.name || 'Clip';
    contentRow.appendChild(label);

    const badges = getClipStatusBadges(layer);
    if (badges.length > 0) {
      const badgeStrip = document.createElement('div');
      badgeStrip.className = 'mf-clip-badges';
      for (const b of badges) {
        const badgeEl = document.createElement('span');
        badgeEl.className = `mf-clip-badge mf-badge-${b.kind} ${b.stacked ? 'badge-fx is-stacked' : ''}`.trim();
        badgeEl.title = b.title;
        if (b.icon) {
          const ic = document.createElement('i');
          ic.className = `bi ${b.icon}`;
          badgeEl.appendChild(ic);
        }
        if (b.text) {
          const txt = document.createElement('span');
          txt.textContent = b.text;
          badgeEl.appendChild(txt);
        }
        badgeStrip.appendChild(badgeEl);
      }
      contentRow.appendChild(badgeStrip);
    }
    clip.appendChild(contentRow);

    const diamonds = [];
    const kfFrames = KeyframeEngine.getAllKeyframeFrames(layer);
    kfFrames.forEach((kfFrame) => {
      const relPx = (kfFrame - layer.startFrame) * this.pxPerFrame;
      if (relPx >= 0 && relPx <= widthPx) {
        const diamond = document.createElement('div');
        diamond.className = 'mf-kf-diamond';
        diamond.style.left = `${relPx}px`;
        diamond.title = `Keyframe @ F${kfFrame} (Drag untuk geser)`;
        this.bindDiamondGesture(diamond, project, layer, kfFrame);
        clip.appendChild(diamond);
        diamonds.push({ el: diamond, frame: kfFrame });
      }
    });
    clip._mfDiamonds = diamonds;

    const leftTrim = document.createElement('div');
    leftTrim.className = 'mf-trim-handle left';
    leftTrim.title = 'Tahan pojok kiri atas lalu geser untuk memperpanjang/memotong awal';
    const rightTrim = document.createElement('div');
    rightTrim.className = 'mf-trim-handle right';
    rightTrim.title = 'Tahan pojok kanan atas lalu geser untuk memperpanjang/memotong akhir';
    clip.appendChild(leftTrim);
    clip.appendChild(rightTrim);

    this._zoomRefs.clips.push({ clip, layer, filmCanvas, waveCanvas, diamonds });

    return { clip, leftTrim, rightTrim, waveEntry, filmEntry };
  }

  closeTrackWheelMenu() {
    if (this._activeWheel?.backdrop) {
      this._activeWheel.backdrop.remove();
    }
    document.querySelectorAll('.mf-track-wheel-backdrop').forEach((el) => el.remove());
    if (this._wheelKeyHandler) {
      window.removeEventListener('keydown', this._wheelKeyHandler);
      this._wheelKeyHandler = null;
    }
    this._activeWheel = null;
  }

  _renderActiveWheelNodes() {
    const state = this._activeWheel;
    if (!state || !state.wheelEl) return;
    const actions = state.buildActions() || [];
    state.wheelEl.querySelectorAll('.mf-track-wheel-node').forEach((el) => el.remove());

    const cx = 108;
    const cy = 108;
    const radius = actions.length >= 7 ? 76 : actions.length <= 4 ? 66 : 72;
    actions.forEach((act, idx) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * idx) / Math.max(1, actions.length);
      const nx = cx + Math.cos(angle) * radius;
      const ny = cy + Math.sin(angle) * radius;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mf-track-wheel-node ${act.stateClass || ''}`.trim();
      btn.style.left = `${Math.round(nx)}px`;
      btn.style.top = `${Math.round(ny)}px`;
      btn.disabled = Boolean(act.disabled);
      btn.title = act.title || act.label;
      btn.setAttribute('aria-label', act.title || act.label);
      btn.innerHTML = `<i class="bi ${act.icon}"></i><span>${this.escapeHtml(act.label)}</span>`;
      btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        act.onClick?.();
        this._renderActiveWheelNodes();
      });
      state.wheelEl.appendChild(btn);
    });
  }

  openTrackWheelMenu(anchorEl, wheelKey, title, buildActionsFn) {
    const sameOpen = this._activeWheel && this._activeWheel.key === wheelKey;
    this.closeTrackWheelMenu();
    if (sameOpen) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'mf-track-wheel-backdrop';

    const wheel = document.createElement('div');
    wheel.className = 'mf-track-wheel';
    wheel.setAttribute('role', 'dialog');
    wheel.setAttribute('aria-label', `${title} Track Controls`);

    const titlePill = document.createElement('div');
    titlePill.className = 'mf-track-wheel-title';
    titlePill.textContent = title;
    wheel.appendChild(titlePill);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mf-track-wheel-close';
    closeBtn.title = 'Tutup Menu Track';
    closeBtn.setAttribute('aria-label', 'Tutup Roda Tombol Track');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M6.2 6.2L17.8 17.8M17.8 6.2L6.2 17.8" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
      </svg>
    `;
    closeBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.closeTrackWheelMenu();
    });
    wheel.appendChild(closeBtn);

    const rect = anchorEl?.getBoundingClientRect?.() || { left: 80, top: 240, width: 32, height: 32 };
    const wheelSize = 216;
    const half = wheelSize / 2;
    const rawCx = rect.left + rect.width * 0.5 + 48;
    const rawCy = rect.top + rect.height * 0.5;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const cx = Math.max(half + 10, Math.min(vw - half - 10, rawCx));
    const cy = Math.max(half + 24, Math.min(vh - half - 14, rawCy));
    wheel.style.left = `${Math.round(cx - half)}px`;
    wheel.style.top = `${Math.round(cy - half)}px`;

    backdrop.addEventListener('pointerdown', (ev) => {
      if (ev.target === backdrop) {
        ev.stopPropagation();
        this.closeTrackWheelMenu();
      }
    });
    wheel.addEventListener('pointerdown', (ev) => ev.stopPropagation());

    backdrop.appendChild(wheel);
    document.body.appendChild(backdrop);

    this._wheelKeyHandler = (ev) => {
      if (ev.key === 'Escape') this.closeTrackWheelMenu();
    };
    window.addEventListener('keydown', this._wheelKeyHandler);

    this._activeWheel = {
      key: wheelKey,
      title,
      backdrop,
      wheelEl: wheel,
      buildActions: buildActionsFn
    };
    this._renderActiveWheelNodes();
  }

  _resolveZoneOrder(project) {
    const saved = Array.isArray(project?.settings?.zoneOrder) ? project.settings.zoneOrder : null;
    const def = ['overlay', 'main', 'audio'];
    if (!saved) return def;
    const filtered = saved.filter((z) => def.includes(z));
    for (const z of def) {
      if (!filtered.includes(z)) filtered.push(z);
    }
    return filtered;
  }

  _bindTrackHeaderDrag(dragHandle, sourceZone, layerIndex = null, layerId = null) {
    let draggingRow = false;
    let allRows = [];
    let activeTarget = null;

    const resolveTarget = (clientY) => {
      if (allRows.length === 0) return null;
      let best = allRows[0];
      let bestDist = Infinity;
      for (const r of allRows) {
        const d = Math.abs(clientY - r.midY);
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best;
    };

    dragHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      draggingRow = true;
      allRows = [...this.headersList.querySelectorAll('.mf-track-header-item[data-zone]')].map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          zone: el.dataset.zone,
          layerId: el.dataset.layerId || null,
          layerIndex: el.dataset.index !== undefined ? Number(el.dataset.index) : null,
          midY: rect.top + rect.height * 0.5
        };
      });
      activeTarget = null;
      try { dragHandle.setPointerCapture(e.pointerId); } catch {}
    });

    dragHandle.addEventListener('pointermove', (e) => {
      if (!draggingRow) return;
      activeTarget = resolveTarget(e.clientY);
      this.headersList.querySelectorAll('.mf-track-header-item').forEach((el) => {
        const isSelf = layerId ? el.dataset.layerId === layerId : (el.dataset.zone === 'main' && sourceZone === 'main');
        const isMatch = activeTarget && el === activeTarget.el && !isSelf;
        el.classList.toggle('drag-over', Boolean(isMatch));
      });
    });

    const finishReorder = (e) => {
      if (!draggingRow) return;
      draggingRow = false;
      const tgt = resolveTarget(e.clientY) || activeTarget;
      this.headersList.querySelectorAll('.mf-track-header-item').forEach((el) => el.classList.remove('drag-over'));
      if (!tgt) return;

      if (sourceZone !== 'main' && tgt.zone === sourceZone && layerId && tgt.layerIndex !== null && tgt.layerIndex !== layerIndex) {
        this.cb.onReorderLayerToIndex?.(layerId, tgt.layerIndex);
      } else if (tgt.zone && tgt.zone !== sourceZone) {
        const curZones = this._resolveZoneOrder(this._lastRenderContext?.project);
        const srcPos = curZones.indexOf(sourceZone);
        const tgtPos = curZones.indexOf(tgt.zone);
        const insertBefore = e.clientY <= tgt.midY;
        if (srcPos !== -1 && tgtPos !== -1) {
          this.cb.onReorderTrackZone?.(sourceZone, tgt.zone, insertBefore);
        }
      }
    };
    dragHandle.addEventListener('pointerup', finishReorder);
    dragHandle.addEventListener('pointercancel', finishReorder);
  }

  _appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId) {
    const layerIndex = project.layers.findIndex((l) => l.id === layer.id);
    const isSelected = layer.id === selectedLayerId;
    const isCompact = Boolean(layer.trackCompact);
    const isMuted = Boolean(layer.audioProps?.muted);
    const zone = layer.type === 'audio' ? 'audio' : 'overlay';

    const hdr = document.createElement('div');
    hdr.className = `mf-track-header-item zone-${zone} d-flex align-items-center justify-content-between ${isSelected ? 'selected' : ''} ${layer.parentId ? 'child-layer' : ''} ${isCompact ? 'compact' : ''}`.trim();
    hdr.dataset.index = String(layerIndex);
    hdr.dataset.layerId = layer.id;
    hdr.dataset.layerType = layer.type;
    hdr.dataset.zone = zone;

    const isKfExpanded = Boolean(layer.kfExpanded);
    const hasTrackStatusAlert = isMuted || !layer.visible || layer.locked || isKfExpanded;
    const wheelDotClass = layer.locked
      ? 'is-locked'
      : isMuted
        ? 'is-muted'
        : !layer.visible
          ? 'is-hidden'
          : isKfExpanded
            ? 'is-kf'
            : '';

    hdr.innerHTML = `
      <button type="button" class="mf-drag-handle flex-shrink-0" title="Geser naik/turun urutan track (${this.escapeHtml(layer.name)})" aria-label="Geser urutan track ${this.escapeHtml(layer.name)}">
        <i class="bi bi-grip-vertical"></i>
      </button>
      <button type="button" class="mf-track-wheel-btn flex-shrink-0 ${hasTrackStatusAlert ? 'has-alert' : ''}" data-act="open-wheel" title="${this.escapeHtml(layer.name)} · Buka Roda Kontrol" aria-label="Buka Roda Kontrol Track ${this.escapeHtml(layer.name)}">
        <i class="bi bi-sliders"></i>
        ${wheelDotClass ? `<span class="mf-wheel-status-dot ${wheelDotClass}"></span>` : ''}
      </button>
    `;

    const dragHandle = hdr.querySelector('.mf-drag-handle');
    this._bindTrackHeaderDrag(dragHandle, zone, layerIndex, layer.id);

    hdr.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act="open-wheel"]');
      if (btn) {
        e.stopPropagation();
        this.openTrackWheelMenu(btn, `layer:${layer.id}`, layer.name, () => {
          const curProject = this._lastRenderContext?.project || project;
          const liveLayer = curProject.layers.find((l) => l.id === layer.id) || layer;
          const liveKfs = KeyframeEngine.getAllKeyframeFrames(liveLayer).length > 0;
          const liveKfExpanded = Boolean(liveLayer.kfExpanded);
          const liveMuted = Boolean(liveLayer.audioProps?.muted);
          const liveCompact = Boolean(liveLayer.trackCompact);
          const actions = [
            {
              icon: liveKfExpanded ? 'bi-diamond-fill' : 'bi-diamond-half',
              label: 'Keyframe',
              stateClass: liveKfExpanded ? 'is-kf-open' : (liveKfs ? 'is-active' : ''),
              title: liveKfExpanded ? 'Tutup Lane Keyframe' : 'Buka Lane Keyframe',
              onClick: () => this.cb.onToggleKfExpanded?.(liveLayer.id)
            }
          ];
          if (liveLayer.type === 'audio' || liveLayer.type === 'video') {
            actions.push({
              icon: liveMuted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill',
              label: liveMuted ? 'Unmute' : 'Mute',
              stateClass: liveMuted ? 'is-muted' : 'is-active',
              title: liveMuted ? 'Aktifkan Suara' : 'Bisukan Track',
              onClick: () => this.cb.onToggleMute?.(liveLayer.id)
            });
          }
          actions.push(
            {
              icon: liveLayer.visible ? 'bi-eye-fill' : 'bi-eye-slash',
              label: liveLayer.visible ? 'Tampil' : 'Sembunyi',
              stateClass: liveLayer.visible ? 'is-active' : 'is-muted',
              title: liveLayer.visible ? 'Sembunyikan Track' : 'Tampilkan Track',
              onClick: () => this.cb.onToggleVisibility?.(liveLayer.id)
            },
            {
              icon: liveLayer.locked ? 'bi-lock-fill' : 'bi-unlock',
              label: liveLayer.locked ? 'Terkunci' : 'Kunci',
              stateClass: liveLayer.locked ? 'is-locked' : '',
              title: liveLayer.locked ? 'Buka Kunci Track' : 'Kunci Track',
              onClick: () => this.cb.onToggleLock?.(liveLayer.id)
            },
            {
              icon: liveCompact ? 'bi-arrows-expand' : 'bi-arrows-collapse',
              label: liveCompact ? 'Lebar' : 'Ringkas',
              stateClass: liveCompact ? 'is-compact' : '',
              title: liveCompact ? 'Perbesar Tinggi Track' : 'Perkecil Tinggi Track',
              onClick: () => this.cb.onToggleTrackCompact?.(liveLayer.id)
            }
          );
          return actions;
        });
        return;
      }
      this.cb.onSelectLayer(layer.id);
    });
    this.headersList.appendChild(hdr);

    const lane = document.createElement('div');
    lane.className = `mf-track-lane zone-${zone} ${isSelected ? 'selected' : ''} ${isCompact ? 'compact' : ''}`.trim();
    lane.dataset.laneType = 'single';
    lane.dataset.zone = zone;
    lane.dataset.layerId = layer.id;
    lane.dataset.layerIndex = String(layerIndex);
    const { clip, leftTrim, rightTrim, waveEntry, filmEntry } = this._buildClipElement(
      project, layer, isSelected, audioEngine, mediaMap
    );
    this.bindClipGestures(clip, leftTrim, rightTrim, project, layer, waveEntry, filmEntry, lane, null);
    lane.appendChild(clip);

    const junc = junctionByLeftId.get(layer.id);
    if (junc) {
      this._appendSeamButton(lane, junc);
    }

    this.lanesList.appendChild(lane);

    if (isKfExpanded) {
      this._appendKeyframeSubLanes(project, layer);
    }
  }

  _appendSeamButton(lane, junc) {
    const padLeft = this._getPadLeft();
    const hasTr = junc.type && junc.type !== 'none';
    let spanEl = null;
    if (hasTr) {
      spanEl = document.createElement('div');
      spanEl.className = 'mf-trans-span';
      spanEl.style.left = `${frameToTimelineX(junc.seamFrame, this.pxPerFrame, padLeft)}px`;
      spanEl.style.width = `${Math.max(8, junc.durationFrames * this.pxPerFrame)}px`;
      lane.appendChild(spanEl);
      this._zoomRefs.transSpans.push({ el: spanEl, frame: junc.seamFrame, durationFrames: junc.durationFrames });
    }

    const seamBtn = document.createElement('button');
    seamBtn.type = 'button';
    seamBtn.className = `mf-trans-seam-btn ${hasTr ? 'has-trans' : ''}`;
    seamBtn.dataset.leftId = junc.leftId;
    seamBtn.dataset.rightId = junc.rightId;
    seamBtn.style.left = `${frameToTimelineX(junc.seamFrame, this.pxPerFrame, padLeft)}px`;
    seamBtn.title = hasTr
      ? `Transition (${junc.type} · ${junc.durationFrames}f) — Drag horizontal to resize from center`
      : `Add transition between ${junc.left.name} & ${junc.right.name}`;
    seamBtn.setAttribute('aria-label', seamBtn.title);
    seamBtn.innerHTML = hasTr ? `<i class="bi bi-intersect"></i>` : `<i class="bi bi-plus-slash-minus"></i>`;

    let seamDragging = false;
    let seamMoved = false;
    let seamStartX = 0;
    let seamOrigDur = junc.durationFrames || 24;
    let seamNextDur = seamOrigDur;
    seamBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      seamDragging = true;
      seamMoved = false;
      seamStartX = e.clientX;
      seamOrigDur = junc.durationFrames || 24;
      seamNextDur = seamOrigDur;
      try { seamBtn.setPointerCapture(e.pointerId); } catch {}
    });
    seamBtn.addEventListener('pointermove', (e) => {
      if (!seamDragging) return;
      const dx = e.clientX - seamStartX;
      if (!seamMoved && Math.abs(dx) < 5) return;
      if (!seamMoved && !hasTr) return; // only resize if transition already applied; otherwise tap opens picker
      seamMoved = true;
      const deltaFrames = Math.round((dx / Math.max(0.2, this.pxPerFrame)) * 2);
      seamNextDur = Math.max(4, Math.min(120, seamOrigDur + deltaFrames));
      if (spanEl) {
        spanEl.style.width = `${Math.max(8, seamNextDur * this.pxPerFrame)}px`;
      }
      const hL = Math.floor(seamNextDur / 2);
      const hR = seamNextDur - hL;
      this._showTooltip(`Trans ${seamNextDur}f (L:${hL}f | R:${hR}f)`, seamBtn, 'drag');
    });
    const endSeamDrag = (e) => {
      if (!seamDragging) return;
      seamDragging = false;
      this._hideTooltip('drag');
      if (seamMoved) {
        e.stopPropagation();
        this.cb.onResizeTransitionJunction?.(junc.leftId, junc.rightId, seamNextDur);
      }
    };
    seamBtn.addEventListener('pointerup', endSeamDrag);
    seamBtn.addEventListener('pointercancel', endSeamDrag);
    seamBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (seamMoved) return;
      this.cb.onOpenTransitionJunction?.(junc.leftId, junc.rightId);
    });
    lane.appendChild(seamBtn);
    this._zoomRefs.seams.push({ el: seamBtn, frame: junc.seamFrame });
  }

  _appendMainTrackRow(project, mainClips, selectedLayerId, audioEngine, mediaMap, junctionByLeftId) {
    const padLeft = this._getPadLeft();
    const anySelected = mainClips.some((c) => c.id === selectedLayerId);
    const rippleOn = project.settings?.rippleMode !== false;
    const isMainCompact = Boolean(project.settings?.mainTrackCompact);
    const allHidden = mainClips.length > 0 && mainClips.every((c) => !c.visible);
    const allLocked = mainClips.length > 0 && mainClips.every((c) => c.locked);
    const audioClips = mainClips.filter((c) => c.audioProps);
    const allMuted = audioClips.length > 0 && audioClips.every((c) => c.audioProps.muted);

    const activeMainClip = mainClips.find((c) => c.id === selectedLayerId)
      || mainClips.find((c) => {
        const pf = this.cb.getPlayheadFrame?.() ?? 0;
        return pf >= c.startFrame && pf <= c.endFrame;
      })
      || mainClips[0];
    const isMainKfExpanded = Boolean(activeMainClip?.kfExpanded);
    const mainDotClass = allLocked
      ? 'is-locked'
      : allMuted
        ? 'is-muted'
        : allHidden
          ? 'is-hidden'
          : isMainKfExpanded
            ? 'is-kf'
            : rippleOn
              ? 'is-magnet'
              : '';

    const hdr = document.createElement('div');
    hdr.className = `mf-track-header-item main-track d-flex align-items-center justify-content-between ${anySelected ? 'selected' : ''} ${isMainCompact ? 'compact' : ''}`.trim();
    hdr.dataset.zone = 'main';
    hdr.innerHTML = `
      <button type="button" class="mf-drag-handle main-handle flex-shrink-0" title="Geser naik/turun posisi Track Utama" aria-label="Geser posisi Track Utama">
        <i class="bi bi-grip-vertical"></i>
      </button>
      <button type="button" class="mf-track-wheel-btn flex-shrink-0 ${mainDotClass ? 'has-alert' : ''}" data-act="open-wheel" title="Track Utama · Buka Roda Kontrol & Cover" aria-label="Buka Roda Kontrol Track Utama">
        <i class="bi bi-sliders"></i>
        ${mainDotClass ? `<span class="mf-wheel-status-dot ${mainDotClass}"></span>` : ''}
      </button>
    `;

    const mainDragHandle = hdr.querySelector('.mf-drag-handle');
    this._bindTrackHeaderDrag(mainDragHandle, 'main', null, null);

    hdr.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act="open-wheel"]');
      if (btn) {
        e.stopPropagation();
        this.openTrackWheelMenu(btn, 'main', 'Main Track', () => {
          const curProject = this._lastRenderContext?.project || project;
          const liveMain = TimelineEngine.getMainTrackClips(curProject);
          const liveSelected = this.cb.getPlayheadFrame?.() ?? 0;
          const liveActive = liveMain.find((c) => this.selectedLayerIds?.has(c.id))
            || liveMain.find((c) => liveSelected >= c.startFrame && liveSelected <= c.endFrame)
            || liveMain[0];
          const liveRipple = curProject.settings?.rippleMode !== false;
          const liveCompact = Boolean(curProject.settings?.mainTrackCompact);
          const liveHidden = liveMain.length > 0 && liveMain.every((c) => !c.visible);
          const liveLocked = liveMain.length > 0 && liveMain.every((c) => c.locked);
          const liveAud = liveMain.filter((c) => c.audioProps);
          const liveMuted = liveAud.length > 0 && liveAud.every((c) => c.audioProps.muted);
          const liveKfs = liveMain.some((c) => KeyframeEngine.getAllKeyframeFrames(c).length > 0);
          const liveKfExp = Boolean(liveActive?.kfExpanded);
          const hasCover = Boolean(curProject?.coverDataUrl);

          return [
            {
              icon: hasCover ? 'bi-image-fill' : 'bi-image',
              label: hasCover ? 'Ganti Cover' : 'Cover',
              stateClass: hasCover ? 'is-active' : '',
              title: 'Input Gambar Cover Thumbnail Project',
              onClick: () => {
                this.closeTrackWheelMenu();
                this.cb.onMainTrackCoverClick?.();
              }
            },
            {
              icon: liveKfExp ? 'bi-diamond-fill' : 'bi-diamond-half',
              label: 'Keyframe',
              disabled: !liveActive,
              stateClass: liveKfExp ? 'is-kf-open' : (liveKfs ? 'is-active' : ''),
              title: liveKfExp ? 'Tutup Lane Keyframe' : 'Buka Lane Keyframe',
              onClick: () => { if (liveActive) this.cb.onToggleKfExpanded?.(liveActive.id); }
            },
            {
              icon: 'bi-magnet-fill',
              label: liveRipple ? 'Magnet ON' : 'Magnet OFF',
              stateClass: liveRipple ? 'is-active' : '',
              title: liveRipple ? 'Matikan Magnet (boleh jarak kosong)' : 'Aktifkan Magnet (rapatkan clip)',
              onClick: () => this.cb.onToggleRippleMode?.()
            },
            {
              icon: liveMuted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill',
              label: liveMuted ? 'Unmute' : 'Mute',
              disabled: liveMain.length === 0,
              stateClass: liveMuted ? 'is-muted' : 'is-active',
              title: liveMuted ? 'Aktifkan Audio Main Track' : 'Bisukan Audio Main Track',
              onClick: () => this.cb.onToggleMainTrackProp?.('muted')
            },
            {
              icon: !liveHidden ? 'bi-eye-fill' : 'bi-eye-slash',
              label: !liveHidden ? 'Tampil' : 'Sembunyi',
              disabled: liveMain.length === 0,
              stateClass: !liveHidden ? 'is-active' : 'is-muted',
              title: 'Toggle Visibilitas Main Track',
              onClick: () => this.cb.onToggleMainTrackProp?.('visible')
            },
            {
              icon: liveLocked ? 'bi-lock-fill' : 'bi-unlock',
              label: liveLocked ? 'Terkunci' : 'Kunci',
              disabled: liveMain.length === 0,
              stateClass: liveLocked ? 'is-locked' : '',
              title: 'Kunci / Buka Kunci Main Track',
              onClick: () => this.cb.onToggleMainTrackProp?.('locked')
            },
            {
              icon: liveCompact ? 'bi-arrows-expand' : 'bi-arrows-collapse',
              label: liveCompact ? 'Lebar' : 'Ringkas',
              stateClass: liveCompact ? 'is-compact' : '',
              title: liveCompact ? 'Perbesar Main Track' : 'Perkecil Main Track',
              onClick: () => this.cb.onToggleMainTrackProp?.('compact')
            }
          ];
        });
        return;
      }
      if (mainClips.length > 0) {
        const playF = this.cb.getPlayheadFrame();
        const activeAtPlayhead = mainClips.find((c) => playF >= c.startFrame && playF <= c.endFrame);
        this.cb.onSelectLayer((activeAtPlayhead || mainClips[0]).id);
      }
    });
    this.headersList.appendChild(hdr);

    const lane = document.createElement('div');
    lane.className = `mf-track-lane main-track ${anySelected ? 'selected' : ''} ${isMainCompact ? 'compact' : ''}`.trim();
    lane.dataset.laneType = 'main';
    lane.dataset.zone = 'main';

    const dropMarker = document.createElement('div');
    dropMarker.className = 'mf-reorder-indicator d-none';
    lane.appendChild(dropMarker);

    const clipRecords = [];
    for (const clipLayer of mainClips) {
      const isSelected = clipLayer.id === selectedLayerId;
      const built = this._buildClipElement(project, clipLayer, isSelected, audioEngine, mediaMap);
      clipRecords.push({ layer: clipLayer, ...built });
      lane.appendChild(built.clip);
    }

    for (const rec of clipRecords) {
      this.bindClipGestures(
        rec.clip,
        rec.leftTrim,
        rec.rightTrim,
        project,
        rec.layer,
        rec.waveEntry,
        rec.filmEntry,
        lane,
        { dropMarker, clipRecords }
      );
      const junc = junctionByLeftId.get(rec.layer.id);
      if (junc) {
        this._appendSeamButton(lane, junc);
      }
    }

    // Gap close pills when Magnetic Main Track is OFF and a gap >= 4f exists
    if (!rippleOn && mainClips.length > 0) {
      if (mainClips[0].startFrame >= 4) {
        this._appendGapClosePill(lane, mainClips[0].startFrame * 0.5);
      }
      for (let i = 0; i < mainClips.length - 1; i++) {
        const gap = mainClips[i + 1].startFrame - mainClips[i].endFrame;
        if (gap >= 4) {
          this._appendGapClosePill(lane, (mainClips[i].endFrame + mainClips[i + 1].startFrame) * 0.5);
        }
      }
    }

    // Trailing CapCut '+' Add Clip button at end of Main Track
    const mainEndFrame = mainClips.length > 0 ? Math.max(...mainClips.map((c) => c.endFrame)) : 0;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'mf-main-add-btn';
    addBtn.style.left = `${frameToTimelineX(mainEndFrame, this.pxPerFrame, padLeft) + 8}px`;
    addBtn.title = 'Tambah Video / Gambar ke Main Track';
    addBtn.setAttribute('aria-label', 'Tambah Video atau Gambar ke Main Track');
    addBtn.innerHTML = `<i class="bi bi-plus-lg"></i>`;
    addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onQuickAddMainClip?.();
    });
    lane.appendChild(addBtn);
    this._zoomRefs.addBtns.push({ el: addBtn, frame: mainEndFrame });

    if (mainClips.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'mf-main-empty-hint';
      hint.style.left = `${padLeft + 46}px`;
      hint.textContent = 'Track Utama · Video & Gambar';
      lane.appendChild(hint);
    }

    this.lanesList.appendChild(lane);
    if (isMainKfExpanded && activeMainClip) {
      this._appendKeyframeSubLanes(project, activeMainClip);
    }
  }

  _appendGapClosePill(lane, centerFrame) {
    const padLeft = this._getPadLeft();
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mf-gap-pill';
    pill.style.left = `${frameToTimelineX(centerFrame, this.pxPerFrame, padLeft)}px`;
    pill.textContent = 'Close Gap';
    pill.title = 'Snap all Main Track clips tightly without gaps';
    pill.addEventListener('pointerdown', (e) => e.stopPropagation());
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onCloseMainGaps?.();
    });
    lane.appendChild(pill);
    this._zoomRefs.gaps.push({ el: pill, frame: centerFrame });
  }

  renderHeadersAndLanes(project, selectedLayerId, audioEngine, mediaMap = null) {
    this.headersList.innerHTML = '';
    this.lanesList.innerHTML = '';
    this._zoomRefs = { clips: [], seams: [], transSpans: [], gaps: [], addBtns: [], kfSpans: [], kfConnectors: [], kfDiamonds: [] };

    this._waveEntries = [];
    this._filmstripEntries = [];
    this._lastRenderContext = { project, audioEngine, mediaMap };

    TimelineEngine.normalizeTrackZOrder(project);

    const junctions = TimelineEngine.findTransitionJunctions(project);
    const junctionByLeftId = new Map(junctions.map((j) => [j.leftId, j]));

    const mainClips = TimelineEngine.getMainTrackClips(project);
    const nonMainOverlays = project.layers.filter((l) => l.trackRole !== 'main' && l.type !== 'audio');
    const audioLayers = project.layers.filter((l) => l.trackRole !== 'main' && l.type === 'audio');

    const zoneOrder = this._resolveZoneOrder(project);
    for (const z of zoneOrder) {
      if (z === 'overlay') {
        for (const layer of nonMainOverlays) {
          this._appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);
        }
      } else if (z === 'main') {
        this._appendMainTrackRow(project, mainClips, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);
      } else if (z === 'audio') {
        for (const layer of audioLayers) {
          this._appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);
        }
      }
    }

    if (this._activeWheel) {
      this._renderActiveWheelNodes();
    }
  }

  _appendKeyframeSubLanes(project, layer) {
    const groups = KeyframeEngine.getVisibleKeyframeLanes(layer);
    const playFrame = Math.round(this.cb.getPlayheadFrame?.() ?? 0);
    const px = this.pxPerFrame;
    const padLeft = this._getPadLeft();

    for (const group of groups) {
      const entries = KeyframeEngine.getLaneKeyframes(layer, group.props);
      const hasAtPlayhead = entries.some((k) => k.frame === playFrame);

      const subHdr = document.createElement('div');
      subHdr.className = 'mf-kf-lane-header';
      subHdr.dataset.layerId = layer.id;
      subHdr.dataset.laneKey = group.key;
      subHdr.title = `${group.label} Keyframes`;
      subHdr.innerHTML = `
        <div class="d-flex align-items-center gap-1 min-w-0 flex-grow-1 overflow-hidden">
          <i class="bi ${group.icon}" style="color:${group.color};font-size:0.68rem;flex-shrink:0;"></i>
          ${entries.length > 0 ? `<span class="mf-kf-lane-count">${entries.length}</span>` : ''}
        </div>
        <button type="button" class="mf-kf-lane-add-btn ${hasAtPlayhead ? 'active' : ''}" data-act="kf-toggle" title="${hasAtPlayhead ? `Hapus Keyframe ${group.label} @ F${playFrame}` : `Tambah Keyframe ${group.label} @ F${playFrame}`}" aria-label="Toggle ${group.label} Keyframe">
          <i class="bi ${hasAtPlayhead ? 'bi-diamond-fill' : 'bi-diamond'}"></i>
        </button>
      `;

      subHdr.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('[data-act="kf-toggle"]');
        if (toggleBtn) {
          e.stopPropagation();
          this.cb.onTogglePropLaneKeyframe?.(layer.id, group.key, playFrame);
          return;
        }
        this.cb.onFocusKeyframeProp?.(layer.id, group.primaryProp);
      });
      this.headersList.appendChild(subHdr);

      const subLane = document.createElement('div');
      subLane.className = `mf-kf-lane ${this.kfMultiMode ? 'is-marquee-ready' : ''}`.trim();
      subLane.dataset.layerId = layer.id;
      subLane.dataset.laneKey = group.key;

      const spanEl = document.createElement('div');
      spanEl.className = 'mf-kf-lane-span';
      spanEl.style.left = `${frameToTimelineX(layer.startFrame, px, padLeft)}px`;
      spanEl.style.width = `${Math.max(4, (layer.endFrame - layer.startFrame) * px)}px`;
      subLane.appendChild(spanEl);
      this._zoomRefs.kfSpans.push({ el: spanEl, layer });

      for (let i = 0; i < entries.length - 1; i++) {
        const a = entries[i];
        const b = entries[i + 1];
        const conn = document.createElement('div');
        const isLinear = a.easing === 'linear';
        const isHold = a.easing === 'hold';
        const isSpring = a.easing === 'spring' || a.easing === 'easeOutBack' || a.easing === 'anticipate';
        const isSmooth = a.easing === 'smooth';
        conn.className = `mf-kf-connector ${isLinear ? 'is-linear' : isHold ? 'is-hold' : isSpring ? 'is-spring' : isSmooth ? 'is-smooth' : 'is-ease'}`;
        conn.style.color = group.color;
        if (isLinear) conn.style.backgroundColor = group.color;
        conn.style.left = `${frameToTimelineX(a.frame, px, padLeft)}px`;
        conn.style.width = `${Math.max(0, (b.frame - a.frame) * px)}px`;
        subLane.appendChild(conn);
        this._zoomRefs.kfConnectors.push({ el: conn, fromFrame: a.frame, toFrame: b.frame });
      }

      for (const entry of entries) {
        const dEl = document.createElement('div');
        const isSelected = this.isKfSelected(layer.id, group.key, entry.frame);
        const isOutside = entry.frame < layer.startFrame || entry.frame > layer.endFrame;
        const easeCls = entry.easing === 'linear' ? 'is-linear' : entry.easing === 'hold' ? 'is-hold' : 'is-ease';
        dEl.className = `mf-kf-lane-diamond ${easeCls} ${isSelected ? 'selected' : ''} ${isOutside ? 'is-outside-clip' : ''}`.trim();
        dEl.dataset.layerId = layer.id;
        dEl.dataset.laneKey = group.key;
        dEl.dataset.frame = String(entry.frame);
        dEl.style.left = `${frameToTimelineX(entry.frame, px, padLeft)}px`;
        dEl.style.backgroundColor = group.isColor && entry.colorVal ? entry.colorVal : group.color;
        dEl.title = `${group.label} @ F${entry.frame} (${entry.easing})${isOutside ? ' · Di luar batas clip' : ''} · Tap/Ctrl+Klik Multi · Drag untuk geser`;
        dEl.setAttribute('role', 'button');
        dEl.setAttribute('aria-label', `${group.label} Keyframe Frame ${entry.frame}`);
        this.bindLaneDiamondGesture(dEl, project, layer, group, entry);
        subLane.appendChild(dEl);
        this._zoomRefs.kfDiamonds.push({ el: dEl, frame: entry.frame });
      }

      this._bindSubLaneMarquee(subLane, project);
      this.lanesList.appendChild(subLane);
    }
  }

  get selectedKf() {
    return this.selectedKfs[this.selectedKfs.length - 1] || null;
  }

  set selectedKf(val) {
    this.selectedKfs = val ? [{ layerId: val.layerId, laneKey: val.laneKey, frame: Math.round(val.frame) }] : [];
  }

  isKfSelected(layerId, laneKey, frame) {
    const f = Math.round(frame);
    return this.selectedKfs.some((k) => k.layerId === layerId && k.laneKey === laneKey && Math.round(k.frame) === f);
  }

  toggleKfSelected(layerId, laneKey, frame) {
    const f = Math.round(frame);
    const idx = this.selectedKfs.findIndex((k) => k.layerId === layerId && k.laneKey === laneKey && Math.round(k.frame) === f);
    if (idx >= 0) {
      this.selectedKfs.splice(idx, 1);
      return false;
    }
    this.selectedKfs.push({ layerId, laneKey, frame: f });
    return true;
  }

  _syncKfSelectionDOM() {
    if (!this.lanesList) return;
    this.lanesList.querySelectorAll('.mf-kf-lane-diamond').forEach((el) => {
      const hit = this.isKfSelected(el.dataset.layerId, el.dataset.laneKey, Number(el.dataset.frame));
      el.classList.toggle('selected', hit);
    });
    this.lanesList.querySelectorAll('.mf-kf-lane').forEach((lane) => {
      lane.classList.toggle('is-marquee-ready', Boolean(this.kfMultiMode));
    });
  }

  _bindSubLaneMarquee(subLane, project) {
    let active = false;
    let startClientX = 0;
    let startClientY = 0;
    let marqueeEl = null;
    let additive = false;

    subLane.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mf-kf-lane-diamond')) return;
      const canMarquee = this.kfMultiMode || e.pointerType === 'mouse' || e.shiftKey || e.ctrlKey || e.metaKey;
      if (!canMarquee) return;
      e.stopPropagation();
      active = true;
      additive = Boolean(e.shiftKey || e.ctrlKey || e.metaKey || this.kfMultiMode);
      startClientX = e.clientX;
      startClientY = e.clientY;
      try { subLane.setPointerCapture(e.pointerId); } catch {}
    });

    subLane.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      if (!marqueeEl && Math.hypot(dx, dy) < 6) return;
      const lanesRect = this.lanesList.getBoundingClientRect();
      if (!marqueeEl) {
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'mf-kf-marquee-box';
        this.lanesList.appendChild(marqueeEl);
      }
      const x1 = Math.min(startClientX, e.clientX) - lanesRect.left;
      const y1 = Math.min(startClientY, e.clientY) - lanesRect.top;
      const x2 = Math.max(startClientX, e.clientX) - lanesRect.left;
      const y2 = Math.max(startClientY, e.clientY) - lanesRect.top;
      marqueeEl.style.left = `${x1}px`;
      marqueeEl.style.top = `${y1}px`;
      marqueeEl.style.width = `${Math.max(4, x2 - x1)}px`;
      marqueeEl.style.height = `${Math.max(4, y2 - y1)}px`;

      const boxLeft = Math.min(startClientX, e.clientX);
      const boxRight = Math.max(startClientX, e.clientX);
      const boxTop = Math.min(startClientY, e.clientY);
      const boxBottom = Math.max(startClientY, e.clientY);
      const enclosed = [];
      this.lanesList.querySelectorAll('.mf-kf-lane-diamond').forEach((d) => {
        const r = d.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.5;
        if (cx >= boxLeft && cx <= boxRight && cy >= boxTop && cy <= boxBottom) {
          enclosed.push({
            layerId: d.dataset.layerId,
            laneKey: d.dataset.laneKey,
            frame: Math.round(Number(d.dataset.frame))
          });
        }
      });
      if (additive) {
        for (const item of enclosed) {
          if (!this.isKfSelected(item.layerId, item.laneKey, item.frame)) {
            this.selectedKfs.push(item);
          }
        }
      } else {
        this.selectedKfs = enclosed;
      }
      this._syncKfSelectionDOM();
    });

    const endMarquee = (e) => {
      if (!active) return;
      active = false;
      if (e?.pointerId !== undefined) {
        try {
          if (subLane.hasPointerCapture?.(e.pointerId)) subLane.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (marqueeEl) {
        marqueeEl.remove();
        marqueeEl = null;
        this._renderKfFloatingBar(project);
      }
    };
    subLane.addEventListener('pointerup', endMarquee);
    subLane.addEventListener('pointercancel', endMarquee);
  }

  _snapSingleKeyframeFrame(project, layer, propKeys, rawFrame) {
    const clamped = Math.max(layer.startFrame, Math.min(layer.endFrame, Math.round(rawFrame)));
    if (!isSnapActive(project, this._modifierHeld)) {
      return { frame: clamped, snapped: false, kind: null, label: '' };
    }
    const threshold = this._getSnapThresholdFrames();
    const candidates = [
      { frame: this.cb.getPlayheadFrame?.() ?? 0, kind: 'playhead', label: 'Playhead' },
      { frame: layer.startFrame, kind: 'clip', label: 'Start' },
      { frame: layer.endFrame, kind: 'clip', label: 'End' }
    ];
    for (const m of (project.markers || [])) {
      const mf = typeof m === 'number' ? m : Number(m?.frame);
      if (Number.isFinite(mf)) candidates.push({ frame: Math.round(mf), kind: 'marker', label: 'Marker' });
    }
    for (const bf of (project.beatMarkers || [])) {
      if (Number.isFinite(bf)) candidates.push({ frame: Math.round(bf), kind: 'beat', label: 'Beat' });
    }
    for (const other of KeyframeEngine.getAllKeyframeFrames(layer)) {
      if (!KeyframeEngine.getLaneKeyframes(layer, propKeys).some((k) => k.frame === other)) {
        candidates.push({ frame: other, kind: 'clip', label: 'Keyframe' });
      }
    }
    let best = null;
    let bestDist = threshold + 0.001;
    for (const c of candidates) {
      if (c.frame < layer.startFrame || c.frame > layer.endFrame) continue;
      const d = Math.abs(c.frame - clamped);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (!best) return { frame: clamped, snapped: false, kind: null, label: '' };
    return { frame: best.frame, snapped: true, kind: best.kind, label: best.label };
  }

  bindLaneDiamondGesture(diamond, project, layer, group, entry) {
    const origFrame = entry.frame;
    let dragging = false;
    let startX = 0;
    let lastClientX = 0;
    let startScrollLeft = 0;
    let curFrame = origFrame;
    let curDelta = 0;
    let pushedUndo = false;
    let dragBatch = null;

    const applyMoveStep = (clientX) => {
      if (!dragging) return;
      const scrollDx = (this.scrollEl?.scrollLeft || 0) - startScrollLeft;
      const dx = (clientX - startX) + scrollDx;
      if (Math.abs(dx) < 3 && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
        this._startEdgeAutoScroll(edgeTick);
        if (this.isKfSelected(layer.id, group.key, origFrame) && this.selectedKfs.length > 1) {
          const allDom = [...this.lanesList.querySelectorAll('.mf-kf-lane-diamond')];
          dragBatch = this.selectedKfs.map((ref) => ({
            ref: { ...ref },
            origF: Math.round(ref.frame),
            el: allDom.find((el) =>
              el.dataset.layerId === ref.layerId &&
              el.dataset.laneKey === ref.laneKey &&
              Math.round(Number(el.dataset.frame)) === Math.round(ref.frame)
            ) || null
          }));
        }
      }
      const padLeft = this._getPadLeft();
      if (dragBatch && dragBatch.length > 1) {
        const minBatchF = Math.min(...dragBatch.map((b) => b.origF));
        const rawDelta = Math.round(dx / this.pxPerFrame);
        const rawAnchorNext = origFrame + rawDelta;
        const snapMeta = this._snapSingleKeyframeFrame(project, layer, group.props, rawAnchorNext);
        const desiredDelta = snapMeta.snapped ? (snapMeta.frame - origFrame) : rawDelta;
        curDelta = Math.max(-minBatchF, desiredDelta);
        curFrame = origFrame + curDelta;
        for (const b of dragBatch) {
          if (b.el) b.el.style.left = `${frameToTimelineX(b.origF + curDelta, this.pxPerFrame, padLeft)}px`;
        }
        this._showSnapGuide(snapMeta.snapped ? { snapped: true, guideFrame: curFrame, kind: snapMeta.kind, label: snapMeta.label } : null);
        this._showTooltip(`Geser ${dragBatch.length} KF · Δ${curDelta >= 0 ? '+' : ''}${curDelta}f`, diamond, 'drag');
      } else {
        const rawNext = origFrame + Math.round(dx / this.pxPerFrame);
        const snapMeta = this._snapSingleKeyframeFrame(project, layer, group.props, rawNext);
        curFrame = snapMeta.frame;
        curDelta = curFrame - origFrame;
        diamond.style.left = `${frameToTimelineX(curFrame, this.pxPerFrame, padLeft)}px`;
        this._showSnapGuide(snapMeta.snapped ? { snapped: true, guideFrame: snapMeta.frame, kind: snapMeta.kind, label: snapMeta.label } : null);
        const snapTxt = snapMeta.snapped ? ` · Snap ${snapMeta.label}` : '';
        this._showTooltip(`${group.label} · F${curFrame}${snapTxt}`, diamond, 'drag');
      }
    };

    const edgeTick = () => {
      if (!dragging || !pushedUndo) return;
      const sRect = this.scrollEl.getBoundingClientRect();
      const step = computeEdgeAutoScrollDelta(lastClientX, sRect.left, sRect.right, this.scrollEl.scrollLeft, 34, 14);
      if (step === 0) return;
      const nextScroll = Math.max(0, this.scrollEl.scrollLeft + step);
      if (nextScroll === this.scrollEl.scrollLeft) return;
      this.scrollEl.scrollLeft = nextScroll;
      this.redrawRulerOnly();
      applyMoveStep(lastClientX);
    };

    diamond.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (layer.locked) return;
      dragging = true;
      startX = e.clientX;
      lastClientX = e.clientX;
      startScrollLeft = this.scrollEl?.scrollLeft || 0;
      curFrame = origFrame;
      curDelta = 0;
      pushedUndo = false;
      dragBatch = null;
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey), true);
      try { diamond.setPointerCapture(e.pointerId); } catch {}
    });

    diamond.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      lastClientX = e.clientX;
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey), true);
      applyMoveStep(e.clientX);
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      this._stopEdgeAutoScroll();
      this._hideSnapGuide();
      this._hideTooltip('drag');
      if (e?.pointerId !== undefined) {
        try {
          if (diamond.hasPointerCapture?.(e.pointerId)) diamond.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (pushedUndo && dragBatch && dragBatch.length > 1 && curDelta !== 0) {
        const moveItems = dragBatch.map((b) => {
          const tgtLayer = project.layers.find((l) => l.id === b.ref.layerId);
          const grp = tgtLayer ? KeyframeEngine.getLaneGroupByKey(b.ref.laneKey, tgtLayer) : null;
          return {
            layerId: b.ref.layerId,
            laneKey: b.ref.laneKey,
            props: grp?.props || [],
            frame: b.origF
          };
        });
        this.selectedKfs = dragBatch.map((b) => ({
          layerId: b.ref.layerId,
          laneKey: b.ref.laneKey,
          frame: Math.max(0, b.origF + curDelta)
        }));
        this.cb.onMoveSelectedKeyframes?.(moveItems, curDelta);
      } else if (pushedUndo && curFrame !== origFrame) {
        this.selectedKf = { layerId: layer.id, laneKey: group.key, frame: curFrame };
        this.cb.onMovePropKeyframe?.(layer.id, group.props, origFrame, curFrame);
      } else {
        const isMultiTap = Boolean(e?.ctrlKey || e?.metaKey || e?.shiftKey || this.kfMultiMode);
        if (isMultiTap) {
          this.toggleKfSelected(layer.id, group.key, origFrame);
        } else {
          this.selectedKf = { layerId: layer.id, laneKey: group.key, frame: origFrame };
          this.cb.onSeekFrame(origFrame);
        }
        this._syncKfSelectionDOM();
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true });
        this._renderKfFloatingBar(project);
      }
    };
    diamond.addEventListener('pointerup', endDrag);
    diamond.addEventListener('pointercancel', endDrag);
  }

  _resolveValidSelectedKfs(project) {
    if (!project || !Array.isArray(this.selectedKfs)) return [];
    const valid = [];
    const seen = new Set();
    for (const ref of this.selectedKfs) {
      const layer = project.layers.find((l) => l.id === ref.layerId);
      const group = layer ? KeyframeEngine.getVisibleKeyframeLanes(layer).find((g) => g.key === ref.laneKey) : null;
      const entry = (layer && group)
        ? KeyframeEngine.getLaneKeyframes(layer, group.props).find((k) => k.frame === Math.round(ref.frame))
        : null;
      if (layer && group && entry) {
        const kId = `${layer.id}|${group.key}|${entry.frame}`;
        if (!seen.has(kId)) {
          seen.add(kId);
          valid.push({ ref: { layerId: layer.id, laneKey: group.key, frame: entry.frame }, layer, group, entry });
        }
      }
    }
    this.selectedKfs = valid.map((v) => v.ref);
    return valid;
  }

  _renderKfFloatingBar(project) {
    if (!this.kfBarEl) return;
    const resolved = this._resolveValidSelectedKfs(project);
    if (resolved.length === 0 || !project) {
      this.kfBarEl.classList.add('d-none');
      this.kfBarEl.innerHTML = '';
      return;
    }

    const primary = resolved[resolved.length - 1];
    const { layer, group, entry } = primary;
    const isMulti = resolved.length > 1;
    const activeEase = isMulti
      ? (resolved.every((r) => r.entry.easing === entry.easing) ? entry.easing : 'mixed')
      : entry.easing;

    const easingModes = [
      { id: 'linear', label: 'Linear' },
      { id: 'easeIn', label: 'Ease In' },
      { id: 'easeOut', label: 'Ease Out' },
      { id: 'easeInOut', label: 'Ease' },
      { id: 'smooth', label: 'Smooth' },
      { id: 'easeOutBack', label: 'Overshoot' },
      { id: 'spring', label: 'Spring' },
      { id: 'hold', label: 'Hold' }
    ];

    this.kfBarEl.classList.remove('d-none');
    this.kfBarEl.innerHTML = `
      <span class="mf-kf-meta">
        <i class="bi bi-diamond-fill me-1" style="color:${group.color};"></i>
        ${isMulti ? `${resolved.length} KF Dipilih` : `${group.label} · F${entry.frame}`}
      </span>
      <button type="button" class="btn ${this.kfMultiMode ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle text-light'}" data-kf-multi="1" title="Mode Pilih Banyak Keyframe & Box Select">
        <i class="bi bi-ui-checks me-1"></i>Multi
      </button>
      <button type="button" class="btn btn-dark border-secondary-subtle text-light" data-kf-sel-lane="1" title="Pilih Semua Keyframe di Lane Ini">
        Semua Lane
      </button>
      ${!isMulti && group.isColor ? `<input type="color" id="kfBarColorPick" value="${entry.colorVal || '#ffffff'}" style="width:22px;height:20px;padding:0;border:1px solid #475569;border-radius:4px;background:transparent;" title="Ubah Warna Keyframe" />` : ''}
      ${easingModes.map((m) => `
        <button type="button" class="btn ${activeEase === m.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle text-light'}" data-kf-ease="${m.id}">${m.label}</button>
      `).join('')}
      <button type="button" class="btn btn-dark border-secondary-subtle text-light" data-kf-copy="1" title="Copy Keyframe Terpilih"><i class="bi bi-clipboard"></i></button>
      ${this.copiedKfGroup?.items?.length ? `<button type="button" class="btn btn-dark border-info-subtle text-info" data-kf-paste="1" title="Paste ${this.copiedKfGroup.items.length} KF di Playhead"><i class="bi bi-clipboard-check me-1"></i>Paste</button>` : ''}
      <button type="button" class="btn btn-dark border-secondary-subtle text-info" data-kf-open-curve="1" title="Buka Pengaturan Kurva & Nilai"><i class="bi bi-bezier2"></i></button>
      <button type="button" class="btn btn-outline-danger" data-kf-del-one="1" title="Hapus ${isMulti ? `${resolved.length} Keyframe` : 'Keyframe Ini'}"><i class="bi bi-trash3"></i></button>
      <button type="button" class="btn btn-dark border-secondary-subtle text-secondary" data-kf-close="1" aria-label="Tutup"><i class="bi bi-x-lg"></i></button>
    `;

    this.kfBarEl.querySelector('[data-kf-multi]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.kfMultiMode = !this.kfMultiMode;
      this._syncKfSelectionDOM();
      this._renderKfFloatingBar(project);
    });

    this.kfBarEl.querySelector('[data-kf-sel-lane]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const laneKfs = KeyframeEngine.getLaneKeyframes(layer, group.props);
      this.selectedKfs = laneKfs.map((k) => ({ layerId: layer.id, laneKey: group.key, frame: k.frame }));
      this._syncKfSelectionDOM();
      this._renderKfFloatingBar(project);
    });

    this.kfBarEl.querySelectorAll('[data-kf-ease]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const easeId = btn.dataset.kfEase;
        if (resolved.length > 1) {
          const items = resolved.map((r) => ({ layerId: r.layer.id, laneKey: r.group.key, props: r.group.props, frame: r.entry.frame }));
          this.cb.onSetSelectedKeyframesEasing?.(items, easeId);
        } else {
          this.cb.onSetPropKeyframeEasing?.(layer.id, group.props, entry.frame, easeId);
        }
      };
    });

    const colorPick = this.kfBarEl.querySelector('#kfBarColorPick');
    if (colorPick) {
      colorPick.onchange = (e) => {
        this.cb.onSetPropKeyframeColor?.(layer.id, entry.frame, e.target.value, entry.easing);
      };
    }

    this.kfBarEl.querySelector('[data-kf-copy]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const items = resolved.map((r) => ({ layerId: r.layer.id, laneKey: r.group.key, props: r.group.props, frame: r.entry.frame }));
      const clip = KeyframeEngine.cloneKeyframesForClipboard(project, items);
      if (clip) {
        this.copiedKfGroup = clip;
        this.cb.onCopyKeyframes?.(clip);
        this._renderKfFloatingBar(project);
      }
    });

    this.kfBarEl.querySelector('[data-kf-paste]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.copiedKfGroup) {
        const pf = Math.round(this.cb.getPlayheadFrame?.() ?? 0);
        this.cb.onPasteKeyframes?.(this.copiedKfGroup, pf, layer.id);
      }
    });

    this.kfBarEl.querySelector('[data-kf-open-curve]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onFocusKeyframeProp?.(layer.id, group.primaryProp);
    });

    this.kfBarEl.querySelector('[data-kf-del-one]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (resolved.length > 1) {
        const items = resolved.map((r) => ({ layerId: r.layer.id, laneKey: r.group.key, props: r.group.props, frame: r.entry.frame }));
        this.selectedKfs = [];
        this.cb.onDeleteSelectedKeyframes?.(items);
      } else {
        this.selectedKfs = [];
        this.cb.onDeletePropKeyframe?.(layer.id, group.props, entry.frame);
      }
    });

    this.kfBarEl.querySelector('[data-kf-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedKfs = [];
      this.kfMultiMode = false;
      this._syncKfSelectionDOM();
      this._renderKfFloatingBar(project);
    });
  }

  bindDiamondGesture(diamond, project, layer, origFrame) {
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    let curFrame = origFrame;
    let pushedUndo = false;

    diamond.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (layer.locked) return;
      dragging = true;
      startX = e.clientX;
      startScrollLeft = this.scrollEl?.scrollLeft || 0;
      curFrame = origFrame;
      pushedUndo = false;
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey), true);
      try { diamond.setPointerCapture(e.pointerId); } catch {}
    });

    diamond.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const scrollDx = (this.scrollEl?.scrollLeft || 0) - startScrollLeft;
      const dx = (e.clientX - startX) + scrollDx;
      if (Math.abs(dx) < 4 && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
      }
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey), true);
      const rawNext = origFrame + Math.round(dx / this.pxPerFrame);
      const snapMeta = this._snapSingleKeyframeFrame(project, layer, [], rawNext);
      curFrame = snapMeta.frame;
      diamond.style.left = `${(curFrame - layer.startFrame) * this.pxPerFrame}px`;
      this._showSnapGuide(snapMeta.snapped ? { snapped: true, guideFrame: snapMeta.frame, kind: snapMeta.kind, label: snapMeta.label } : null);
      const snapTxt = snapMeta.snapped ? ` · Snap ${snapMeta.label}` : '';
      this._showTooltip(`Keyframe · F${curFrame}${snapTxt}`, diamond, 'drag');
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      this._hideSnapGuide();
      this._hideTooltip('drag');
      if (e?.pointerId !== undefined) {
        try {
          if (diamond.hasPointerCapture?.(e.pointerId)) diamond.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (pushedUndo && curFrame !== origFrame) {
        this.cb.onMoveKeyframeFrame(layer.id, origFrame, curFrame);
      } else {
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true });
        this.cb.onSeekFrame(origFrame);
      }
    };
    diamond.addEventListener('pointerup', endDrag);
    diamond.addEventListener('pointercancel', endDrag);
  }

  bindClipGestures(clip, leftTrim, rightTrim, project, layer, waveEntry = null, filmEntry = null, laneEl = null, mainCtx = null) {
    const MOVE_HOLD_DELAY_MS = 140;
    const MOVE_SELECTED_HOLD_MS = 110;
    const TRIM_HOLD_DELAY_MS = 110;
    const TAP_MOVE_TOL_PX = 10;

    let mode = null;
    let downPointerType = 'touch';
    let downTimeMs = 0;
    let wasAlreadySelected = false;
    let startX = 0;
    let startY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let origStart = 0;
    let origEnd = 0;
    let origMediaOffset = 0;
    let origKeyframes = null;
    let origMainSnapshot = null;
    let multiGroupSnapshot = null;
    let pushedUndo = false;
    let pendingCenterFrame = null;
    let pendingDrop = null;
    let lastHoverX = -9999;
    let lastHoverY = -9999;
    let holdTimer = null;
    let holdActivated = false;
    let activePointerId = null;
    let captureEl = null;
    let winBound = false;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let prevStepX = 0;
    let prevStepMs = 0;
    let slowAccumMs = 0;
    let fineSlideActive = false;
    let effectiveScaledDx = 0;

    const isMainMagnetic = Boolean(
      mainCtx &&
      layer.trackRole === 'main' &&
      project.settings?.rippleMode !== false
    );

    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      holdActivated = false;
      clip.classList.remove('is-hold-active');
      leftTrim.classList.remove('is-hold-active');
      rightTrim.classList.remove('is-hold-active');
    };

    const detectHandleHover = (e) => {
      if (layer.locked) return null;
      if (e.target === leftTrim || e.target.closest?.('.mf-trim-handle.left')) return 'left';
      if (e.target === rightTrim || e.target.closest?.('.mf-trim-handle.right')) return 'right';
      return null;
    };

    const scheduleHoverTooltip = (edgeHover) => {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        if (mode || this._isPinching) return;
        const fps = Math.max(1, project.fps || 30);
        const durF = Math.max(0, layer.endFrame - layer.startFrame);
        const durText = formatDurationShort(durF, fps);
        const prefix = edgeHover ? 'Tahan pojok utk Trim · ' : 'Tahan tengah utk Geser · ';
        this._showTooltip(`${prefix}Dur ${durText} (${durF}f)`, clip, 'hover');
      }, 340);
    };

    const clearHoverState = () => {
      clip.classList.remove('hover-trim-left', 'hover-trim-right');
      clip.style.cursor = layer.locked ? 'not-allowed' : '';
      this._cancelHoverTooltip();
      lastHoverX = -9999;
      lastHoverY = -9999;
    };

    const clearDropHighlights = () => {
      const padLeft = this._getPadLeft();
      this.lanesList.querySelectorAll('.mf-track-lane').forEach((ln) => {
        ln.classList.remove('drop-target', 'main-drop-target');
      });
      this.lanesList.querySelector('.mf-track-lane.main-track .mf-reorder-indicator')?.classList.add('d-none');
      clip.style.transform = '';
      if (origMainSnapshot) {
        for (const snap of origMainSnapshot) {
          if (snap.clipEl !== clip) {
            snap.clipEl.style.left = `${frameToTimelineX(snap.layer.startFrame, this.pxPerFrame, padLeft)}px`;
          }
        }
      }
    };

    const syncDiamondsForClip = () => {
      const list = clip._mfDiamonds;
      if (!Array.isArray(list) || list.length === 0) return;
      const widthPx = Math.max(4, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
      for (const d of list) {
        const relPx = (d.frame - layer.startFrame) * this.pxPerFrame;
        d.el.style.left = `${relPx}px`;
        d.el.style.display = relPx >= 0 && relPx <= widthPx ? '' : 'none';
      }
    };

    let pendingDragRaf = null;
    let pendingDragDirty = false;
    const cancelDragRaf = () => {
      if (pendingDragRaf !== null) {
        cancelAnimationFrame(pendingDragRaf);
        pendingDragRaf = null;
      }
      pendingDragDirty = false;
    };

    const stopActiveGestureLoops = () => {
      cancelHold();
      cancelDragRaf();
      this._stopEdgeAutoScroll();
      if (this._activeDragReapply === reapplyCurrentDrag) {
        this._activeDragReapply = null;
      }
      clip.classList.remove('is-fine-slide');
      this._hideSnapGuide();
    };

    const restoreOrigState = () => {
      stopActiveGestureLoops();
      const padLeft = this._getPadLeft();
      if (multiGroupSnapshot && multiGroupSnapshot.length > 1) {
        for (const g of multiGroupSnapshot) {
          g.layer.startFrame = g.startFrame;
          g.layer.endFrame = g.endFrame;
          g.layer.keyframes = cloneKeyframesMap(g.keyframes);
          if (g.clipEl) {
            g.clipEl.style.left = `${frameToTimelineX(g.startFrame, this.pxPerFrame, padLeft)}px`;
          }
        }
      } else if (origMainSnapshot) {
        for (const snap of origMainSnapshot) {
          snap.layer.startFrame = snap.startFrame;
          snap.layer.endFrame = snap.endFrame;
          snap.layer.mediaOffsetFrames = snap.mediaOffsetFrames;
          snap.layer.keyframes = cloneKeyframesMap(snap.keyframes);
          snap.clipEl.style.left = `${frameToTimelineX(snap.startFrame, this.pxPerFrame, padLeft)}px`;
          snap.clipEl.style.width = `${Math.max(4, (snap.endFrame - snap.startFrame) * this.pxPerFrame)}px`;
        }
      } else {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.mediaOffsetFrames = origMediaOffset;
        layer.keyframes = cloneKeyframesMap(origKeyframes || {});
        clip.style.left = `${frameToTimelineX(origStart, this.pxPerFrame, padLeft)}px`;
        clip.style.width = `${Math.max(4, (origEnd - origStart) * this.pxPerFrame)}px`;
      }
      syncDiamondsForClip();
      clip.classList.remove('mf-clip-dragging-reorder', 'is-fine-slide');
      this._hideTooltip('drag');
      clearDropHighlights();
      mode = null;
      activePointerId = null;
    };

    const applyDragStep = (clientX, clientY, fromAutoScroll = false) => {
      if (!mode || !holdActivated) return;
      const padLeft = this._getPadLeft();
      const scrollDx = (this.scrollEl?.scrollLeft || 0) - startScrollLeft;
      const scrollDy = (this.scrollEl?.scrollTop || 0) - startScrollTop;
      const rawDx = (clientX - startX) + scrollDx;
      const dy = (clientY - startY) + scrollDy;
      const undoThreshold = mode === 'move' ? 4 : 3;
      if (Math.hypot(rawDx, dy) < undoThreshold && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
        prevStepX = rawDx;
        prevStepMs = performance.now();
        effectiveScaledDx = rawDx;
        this._startEdgeAutoScroll(edgeAutoScrollTick);
      }

      if (!fromAutoScroll) {
        const nowMs = performance.now();
        const dt = Math.max(8, nowMs - prevStepMs);
        const stepDx = rawDx - prevStepX;
        const speedPxMs = Math.abs(stepDx) / dt;
        prevStepX = rawDx;
        prevStepMs = nowMs;

        if (speedPxMs > 0.002 && speedPxMs <= 0.095 && dt < 220) {
          slowAccumMs += dt;
          if (!fineSlideActive && slowAccumMs >= 260) {
            fineSlideActive = true;
            clip.classList.add('is-fine-slide');
          }
        } else if (speedPxMs > 0.36) {
          slowAccumMs = 0;
          if (fineSlideActive) {
            fineSlideActive = false;
            clip.classList.remove('is-fine-slide');
          }
        } else if (speedPxMs > 0.12) {
          slowAccumMs = Math.max(0, slowAccumMs - dt * 0.5);
        }
        effectiveScaledDx += fineSlideActive ? stepDx * 0.25 : stepDx;
      } else if (fineSlideActive) {
        fineSlideActive = false;
        slowAccumMs = 0;
        clip.classList.remove('is-fine-slide');
      }

      const activeDx = fineSlideActive ? effectiveScaledDx : rawDx;
      const deltaFrames = Math.round(activeDx / this.pxPerFrame);
      const finePrefix = fineSlideActive ? 'Geser Halus · ' : '';
      const fps = Math.max(1, project.fps || 30);
      const globalSnap = Boolean(project.settings?.snapToTimeline);
      const snapActive = isSnapActive(project, this._modifierHeld);
      const snapThreshold = this._getSnapThresholdFrames();
      const bypassSuffix = globalSnap && this._modifierHeld ? ' · Snap Off' : '';

      // Case 0: Multi-Select Group Move maintaining exact relative frame offsets
      if (mode === 'move' && multiGroupSnapshot && multiGroupSnapshot.length > 1) {
        clearDropHighlights();
        const minGroupStart = Math.min(...multiGroupSnapshot.map((g) => g.origStart));
        const maxLead = Math.max(-minGroupStart, deltaFrames);
        const leadTarget = Math.max(0, origStart + maxLead);
        const snapMeta = TimelineEngine.snapFrameWithMeta(
          project,
          layer.id,
          leadTarget,
          Math.max(1, origEnd - origStart),
          this.cb.getPlayheadFrame(),
          snapThreshold,
          snapActive
        );
        const effectiveDelta = Math.max(-minGroupStart, snapMeta.startFrame - origStart);
        this._showSnapGuide(snapActive ? snapMeta : null);

        for (const g of multiGroupSnapshot) {
          g.layer.startFrame = Math.max(0, g.origStart + effectiveDelta);
          g.layer.endFrame = g.layer.startFrame + Math.max(5, g.origEnd - g.origStart);
          g.layer.keyframes = cloneKeyframesMap(g.keyframes);
          TimelineEngine.shiftLayerKeyframes(g.layer, effectiveDelta);
          TimelineEngine.ensureProjectDuration(project, g.layer.endFrame);
          if (g.clipEl) {
            g.clipEl.style.left = `${frameToTimelineX(g.layer.startFrame, this.pxPerFrame, padLeft)}px`;
          }
        }
        syncDiamondsForClip();
        const snapTag = snapMeta.snapped && snapActive ? ` · Snap: ${snapMeta.label}` : bypassSuffix;
        this._showTooltip(`${finePrefix}${multiGroupSnapshot.length} Clip (${formatSignedDurationDelta(effectiveDelta, fps)})${snapTag}`, clip, 'drag');
        this.cb.onPreviewRefresh();
        return;
      }

      // 2D Drag & Drop target detection across lanes when moving vertically >= 24px
      const lanes = mode === 'move' ? [...this.lanesList.querySelectorAll('.mf-track-lane')] : [];
      let hoveredLane = null;
      if (mode === 'move' && Math.abs(dy) >= 24 && lanes.length > 0) {
        for (const ln of lanes) {
          const r = ln.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            hoveredLane = ln;
            break;
          }
        }
        if (!hoveredLane) {
          const firstRect = lanes[0].getBoundingClientRect();
          const lastRect = lanes[lanes.length - 1].getBoundingClientRect();
          if (clientY < firstRect.top) hoveredLane = lanes[0];
          else if (clientY > lastRect.bottom) hoveredLane = lanes[lanes.length - 1];
          else {
            let bestLn = null;
            let bestDist = Infinity;
            for (const ln of lanes) {
              const r = ln.getBoundingClientRect();
              const d = Math.abs(clientY - (r.top + r.height * 0.5));
              if (d < bestDist) {
                bestDist = d;
                bestLn = ln;
              }
            }
            hoveredLane = bestLn;
          }
        }
      }

      // Case 1: Visual Overlay dragged vertically onto Main Track
      if (mode === 'move' && layer.trackRole !== 'main' && (layer.type === 'video' || layer.type === 'image') && hoveredLane?.dataset?.laneType === 'main') {
        clearDropHighlights();
        this._hideSnapGuide();
        hoveredLane.classList.add('main-drop-target');
        const len = Math.max(5, origEnd - origStart);
        const dragStart = Math.max(0, origStart + deltaFrames);
        const centerFrame = dragStart + len * 0.5;
        const others = TimelineEngine.getMainTrackClips(project).filter((c) => c.id !== layer.id);
        const targetSlot = TimelineEngine.computeMainTrackTargetSlot(project, layer.id, centerFrame);
        let seamFrame = 0;
        if (others.length > 0) {
          if (targetSlot === 0) seamFrame = others[0].startFrame;
          else if (targetSlot >= others.length) seamFrame = others[others.length - 1].endFrame;
          else seamFrame = others[targetSlot].startFrame;
        }
        const mainDropMarker = hoveredLane.querySelector('.mf-reorder-indicator');
        if (mainDropMarker) {
          mainDropMarker.style.left = `${frameToTimelineX(seamFrame, this.pxPerFrame, padLeft)}px`;
          mainDropMarker.classList.remove('d-none');
        }
        clip.classList.add('mf-clip-dragging-reorder');
        clip.style.left = `${frameToTimelineX(dragStart, this.pxPerFrame, padLeft)}px`;
        clip.style.transform = `translateY(${dy}px) scale(1.03)`;
        pendingDrop = { targetRole: 'main', targetStartFrame: dragStart, dragCenterFrame: centerFrame };
        this._showTooltip(`${finePrefix}Main Track #${targetSlot + 1} · ${formatDurationShort(len, fps)}`, clip, 'drag');
        return;
      }

      // Case 2: Main Track clip dragged vertically off Main Track into Overlay zone ONLY (never Audio zone)
      const mainLaneEl = lanes.find((ln) => ln.dataset.laneType === 'main') || laneEl;
      const mainRect = mainLaneEl?.getBoundingClientRect();
      const overlayLanes = lanes.filter((ln) => ln.dataset.zone === 'overlay');
      const draggedAboveMain = Boolean(mainRect && clientY < mainRect.top);
      if (
        mode === 'move' &&
        layer.trackRole === 'main' &&
        Math.abs(dy) >= 26 &&
        ((hoveredLane && hoveredLane.dataset.zone === 'overlay') || (draggedAboveMain && hoveredLane?.dataset?.zone !== 'audio'))
      ) {
        clearDropHighlights();
        const targetOverlayLane = hoveredLane?.dataset?.zone === 'overlay' ? hoveredLane : (overlayLanes[0] || null);
        if (targetOverlayLane) targetOverlayLane.classList.add('drop-target');
        const len = Math.max(5, origEnd - origStart);
        const rawDragStart = Math.max(0, origStart + deltaFrames);
        const snapMeta = TimelineEngine.snapFrameWithMeta(
          project,
          layer.id,
          rawDragStart,
          len,
          this.cb.getPlayheadFrame(),
          snapThreshold,
          snapActive
        );
        const dragStart = snapMeta.startFrame;
        this._showSnapGuide(snapActive ? snapMeta : null);
        clip.classList.add('mf-clip-dragging-reorder');
        clip.style.left = `${frameToTimelineX(dragStart, this.pxPerFrame, padLeft)}px`;
        clip.style.transform = `translateY(${dy}px) scale(1.03)`;
        const tgtIdx = targetOverlayLane?.dataset?.layerIndex !== undefined ? Number(targetOverlayLane.dataset.layerIndex) : null;
        pendingDrop = { targetRole: 'overlay', targetLayerIndex: Number.isInteger(tgtIdx) ? tgtIdx : null, targetStartFrame: dragStart };
        const snapTag = snapMeta.snapped && snapActive ? ` · Snap: ${snapMeta.label}` : bypassSuffix;
        this._showTooltip(`${finePrefix}Overlay @ ${formatDurationShort(dragStart, fps)}${snapTag}`, clip, 'drag');
        return;
      }

      // Case 3: CapCut Main Track Horizontal Drag-to-Reorder with live sibling preview slide
      if (mode === 'move' && isMainMagnetic) {
        pendingDrop = null;
        this._hideSnapGuide();
        this.lanesList.querySelectorAll('.mf-track-lane').forEach((ln) => ln.classList.remove('drop-target', 'main-drop-target'));
        clip.style.transform = '';
        const len = Math.max(5, origEnd - origStart);
        const dragStart = Math.max(0, origStart + deltaFrames);
        const centerFrame = dragStart + len * 0.5;
        pendingCenterFrame = centerFrame;
        const dragLeftPx = frameToTimelineX(dragStart, this.pxPerFrame, padLeft);
        const dragWidthPx = Math.max(4, len * this.pxPerFrame);
        const curContentW = parseFloat(this.contentEl.style.width || '0') || 0;
        const trailPad = Math.max(120, ((this.scrollEl?.clientWidth || 360) - padLeft) + 24);
        if (dragLeftPx + dragWidthPx + trailPad > curContentW) {
          this.contentEl.style.width = `${Math.ceil(dragLeftPx + dragWidthPx + trailPad + 60)}px`;
        }
        clip.classList.add('mf-clip-dragging-reorder');
        clip.style.left = `${dragLeftPx}px`;

        const others = TimelineEngine.getMainTrackClips(project).filter((c) => c.id !== layer.id);
        const targetSlot = TimelineEngine.computeMainTrackTargetSlot(project, layer.id, centerFrame);
        let seamFrame = 0;
        if (others.length > 0) {
          if (targetSlot === 0) seamFrame = others[0].startFrame;
          else if (targetSlot >= others.length) seamFrame = others[others.length - 1].endFrame;
          else seamFrame = others[targetSlot].startFrame;
        }
        // Live visual preview of Main Track sibling order
        let cursorF = 0;
        for (let i = 0; i <= others.length; i++) {
          if (i === targetSlot) {
            seamFrame = cursorF;
            cursorF += len;
          }
          if (i < others.length) {
            const sib = others[i];
            const sibRec = origMainSnapshot?.find((s) => s.layer.id === sib.id);
            if (sibRec) sibRec.clipEl.style.left = `${frameToTimelineX(cursorF, this.pxPerFrame, padLeft)}px`;
            cursorF += Math.max(5, sib.endFrame - sib.startFrame);
          }
        }
        if (mainCtx?.dropMarker) {
          mainCtx.dropMarker.style.left = `${frameToTimelineX(seamFrame, this.pxPerFrame, padLeft)}px`;
          mainCtx.dropMarker.classList.remove('d-none');
        }
        this._showTooltip(`${finePrefix}Slot #${targetSlot + 1} · ${formatDurationShort(len, fps)}`, clip, 'drag');
        return;
      }

      // Case 4: Standard Move (plus optional vertical row drop within same zone) or Left/Right Trim/Extend
      clearDropHighlights();
      pendingDrop = null;
      let activeSnapInfo = null;

      if (mode === 'move') {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.keyframes = cloneKeyframesMap(origKeyframes);
        const moveRes = TimelineEngine.moveClip(
          project,
          layer.id,
          origStart + deltaFrames,
          snapActive,
          this.cb.getPlayheadFrame(),
          snapThreshold
        );
        activeSnapInfo = moveRes?.snapInfo || null;
        this._showSnapGuide(snapActive ? activeSnapInfo : null);

        const ownZone = layer.type === 'audio' ? 'audio' : 'overlay';
        if (layer.trackRole !== 'main' && hoveredLane && hoveredLane !== laneEl && hoveredLane.dataset.laneType === 'single' && hoveredLane.dataset.zone === ownZone) {
          const targetIdx = Number(hoveredLane.dataset.layerIndex);
          if (Number.isInteger(targetIdx)) {
            hoveredLane.classList.add('drop-target');
            clip.classList.add('mf-clip-dragging-reorder');
            clip.style.transform = `translateY(${dy}px) scale(1.03)`;
            pendingDrop = { targetLayerIndex: targetIdx, targetStartFrame: layer.startFrame };
          }
        }
      } else if (mode === 'left' || mode === 'right') {
        if (origMainSnapshot) {
          for (const snap of origMainSnapshot) {
            snap.layer.startFrame = snap.startFrame;
            snap.layer.endFrame = snap.endFrame;
            snap.layer.mediaOffsetFrames = snap.mediaOffsetFrames;
            snap.layer.keyframes = cloneKeyframesMap(snap.keyframes);
          }
        } else {
          layer.startFrame = origStart;
          layer.endFrame = origEnd;
          layer.mediaOffsetFrames = origMediaOffset;
          layer.keyframes = cloneKeyframesMap(origKeyframes || {});
        }
        const targetFrame = (mode === 'left' ? origStart : origEnd) + deltaFrames;
        const trimRes = TimelineEngine.trimMainOrClip(
          project,
          layer.id,
          mode,
          targetFrame,
          snapActive,
          this.cb.getPlayheadFrame(),
          snapThreshold
        );
        activeSnapInfo = trimRes?.snapInfo || null;
        this._showSnapGuide(snapActive ? activeSnapInfo : null);

        if (origMainSnapshot) {
          for (const snap of origMainSnapshot) {
            const sLeft = frameToTimelineX(snap.layer.startFrame, this.pxPerFrame, padLeft);
            const sWidth = Math.max(4, (snap.layer.endFrame - snap.layer.startFrame) * this.pxPerFrame);
            snap.clipEl.style.left = `${sLeft}px`;
            snap.clipEl.style.width = `${sWidth}px`;
          }
        }
      }

      const nextLeftPx = frameToTimelineX(layer.startFrame, this.pxPerFrame, padLeft);
      const nextWidthPx = Math.max(4, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
      const curContentW = parseFloat(this.contentEl.style.width || '0') || 0;
      const trailPad = Math.max(120, ((this.scrollEl?.clientWidth || 360) - padLeft) + 24);
      if (nextLeftPx + nextWidthPx + trailPad > curContentW) {
        const nextContentW = Math.ceil(nextLeftPx + nextWidthPx + trailPad + 60);
        this.contentEl.style.width = `${nextContentW}px`;
        this._ensureRulerCoversViewport(nextContentW);
      }
      clip.style.left = `${nextLeftPx}px`;
      clip.style.width = `${nextWidthPx}px`;
      syncDiamondsForClip();

      if (waveEntry) {
        waveEntry.leftPx = nextLeftPx;
        waveEntry.widthPx = nextWidthPx;
        this._paintWaveEntry(waveEntry, true);
      }
      if (filmEntry) {
        filmEntry.leftPx = nextLeftPx;
        filmEntry.widthPx = nextWidthPx;
        this._paintFilmstripEntry(filmEntry, true);
      }

      const snapTag = activeSnapInfo?.snapped && snapActive ? ` · Snap: ${activeSnapInfo.label}` : bypassSuffix;
      const durF = Math.max(0, layer.endFrame - layer.startFrame);
      if (mode === 'left' || mode === 'right') {
        const origDurF = Math.max(0, origEnd - origStart);
        const deltaDurF = durF - origDurF;
        const anchorEl = mode === 'left' ? leftTrim : rightTrim;
        this._showTooltip(
          `${finePrefix}${formatDurationShort(durF, fps)} (${formatSignedDurationDelta(deltaDurF, fps)})${snapTag}`,
          anchorEl,
          'drag'
        );
      } else {
        const deltaMoveF = layer.startFrame - origStart;
        const dropLabel = pendingDrop ? ' · Drop' : '';
        this._showTooltip(
          `${finePrefix}${formatSignedDurationDelta(deltaMoveF, fps)} · ${formatDurationShort(layer.startFrame, fps)}–${formatDurationShort(layer.endFrame, fps)}${dropLabel}${snapTag}`,
          clip,
          'drag'
        );
      }
      this.cb.onPreviewRefresh();
    };

    const reapplyCurrentDrag = () => {
      if (!mode || !holdActivated || !pushedUndo) return;
      applyDragStep(lastClientX, lastClientY, true);
    };

    const edgeAutoScrollTick = () => {
      if (!mode || !holdActivated) return;
      if (this._isPinching && !this._isClipHoldLocked) return;
      const sRect = this.scrollEl.getBoundingClientRect();
      const stepX = computeEdgeAutoScrollDelta(lastClientX, sRect.left, sRect.right, this.scrollEl.scrollLeft, 36, 16);
      const stepY = mode === 'move'
        ? computeEdgeAutoScrollDelta(lastClientY, sRect.top + 28, sRect.bottom, this.scrollEl.scrollTop, 28, 10)
        : 0;
      if (stepX === 0 && stepY === 0) return;

      let changed = false;
      let extendedW = null;
      if (stepX !== 0) {
        if (stepX > 0) {
          const curW = parseFloat(this.contentEl.style.width || '0') || this.contentEl.clientWidth;
          const neededW = this.scrollEl.scrollLeft + sRect.width + stepX + 240;
          if (neededW > curW) {
            extendedW = Math.ceil(neededW);
            this.contentEl.style.width = `${extendedW}px`;
          }
        }
        const nextScrollX = Math.max(0, this.scrollEl.scrollLeft + stepX);
        if (nextScrollX !== this.scrollEl.scrollLeft) {
          this.scrollEl.scrollLeft = nextScrollX;
          changed = true;
        }
      }
      if (stepY !== 0) {
        const maxScrollY = Math.max(0, this.scrollEl.scrollHeight - this.scrollEl.clientHeight);
        const nextScrollY = Math.max(0, Math.min(maxScrollY, this.scrollEl.scrollTop + stepY));
        if (nextScrollY !== this.scrollEl.scrollTop) {
          this.scrollEl.scrollTop = nextScrollY;
          if (this.headersList) this.headersList.scrollTop = nextScrollY;
          changed = true;
        }
      }
      if (!changed) return;
      this._ensureRulerCoversViewport(extendedW);
      this.redrawVisibleClipCanvases();
      applyDragStep(lastClientX, lastClientY, true);
    };

    const flushDeferredRenderIfAny = () => {
      if (this._deferredRenderArgs && !this._isClipGestureActive) {
        const args = this._deferredRenderArgs;
        this._deferredRenderArgs = null;
        this.render(args.project, args.currentFrame, args.selectedLayerId, args.audioEngine, args.mediaMap);
      }
    };

    const releaseClipPointerCapture = () => {
      if (captureEl && activePointerId !== null) {
        try {
          if (captureEl.hasPointerCapture?.(activePointerId)) {
            captureEl.releasePointerCapture(activePointerId);
          }
        } catch {}
      }
      captureEl = null;
    };

    const onWinTouchMove = (e) => {
      if (!mode || activePointerId === null) return;
      if (!e.touches || e.touches.length <= 1) {
        if (e.cancelable) e.preventDefault();
      }
    };

    const onWinBlur = () => {
      if (mode) onWinEnd({ type: 'blur', pointerId: activePointerId });
    };

    const detachWindowListeners = () => {
      if (!winBound || typeof window === 'undefined') return;
      winBound = false;
      window.removeEventListener('pointermove', onWinMove, true);
      window.removeEventListener('pointerup', onWinEnd, true);
      window.removeEventListener('pointercancel', onWinEnd, true);
      window.removeEventListener('touchmove', onWinTouchMove, true);
      window.removeEventListener('blur', onWinBlur);
    };

    const attachWindowListeners = () => {
      if (winBound || typeof window === 'undefined') return;
      winBound = true;
      window.addEventListener('pointermove', onWinMove, true);
      window.addEventListener('pointerup', onWinEnd, true);
      window.addEventListener('pointercancel', onWinEnd, true);
      window.addEventListener('touchmove', onWinTouchMove, { passive: false, capture: true });
      window.addEventListener('blur', onWinBlur);
    };

    const activateHold = () => {
      if (!mode || holdActivated || this._isPinching) return;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      holdActivated = true;
      this._isClipGestureActive = true;
      this._isClipHoldLocked = true;
      this.scrollEl?.classList.add('is-clip-dragging');
      clip.classList.add('is-hold-active');
      if (mode === 'left') leftTrim.classList.add('is-hold-active');
      else if (mode === 'right') rightTrim.classList.add('is-hold-active');
      try { navigator.vibrate?.(18); } catch {}
      this._startEdgeAutoScroll(edgeAutoScrollTick);
      const tipAnchor = mode === 'left' ? leftTrim : mode === 'right' ? rightTrim : clip;
      const tipMsg = mode === 'move'
        ? 'Tahan aktif · Geser pindah item'
        : 'Tahan aktif · Geser perpanjang/potong';
      this._showTooltip(tipMsg, tipAnchor, 'drag');
    };

    const onDown = (e, hitMode) => {
      if (e.target.classList.contains('mf-kf-diamond')) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      if (this._isPinching) return;
      if (mode && activePointerId !== null && activePointerId !== e.pointerId) return;
      e.stopPropagation();
      this._cancelHoverTooltip();
      cancelHold();
      detachWindowListeners();
      releaseClipPointerCapture();

      const isToggleMulti = Boolean(e.ctrlKey || e.metaKey);
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey), true);

      if (isToggleMulti) {
        this.cb.onToggleMultiSelectLayer?.(layer.id);
        return;
      }

      wasAlreadySelected = clip.classList.contains('selected') || this.selectedLayerIds.has(layer.id);
      if (this.selectedLayerIds.has(layer.id) && this.selectedLayerIds.size > 1) {
        this.setSelectionInPlace(layer.id, this.selectedLayerIds);
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true, keepMulti: true });
      } else {
        this.setSelectionInPlace(layer.id, [layer.id]);
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true });
      }

      if (layer.locked) return;
      // Strict zone rule: top-left/top-right corners trim/extend, clip middle moves persistently until release
      mode = hitMode;
      downPointerType = e.pointerType || 'touch';
      downTimeMs = performance.now();
      activePointerId = e.pointerId;
      captureEl = hitMode === 'left' ? leftTrim : hitMode === 'right' ? rightTrim : clip;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      startScrollLeft = this.scrollEl?.scrollLeft || 0;
      startScrollTop = this.scrollEl?.scrollTop || 0;
      origStart = layer.startFrame;
      origEnd = layer.endFrame;
      origMediaOffset = layer.mediaOffsetFrames || 0;
      origKeyframes = cloneKeyframesMap(layer.keyframes || {});
      pendingCenterFrame = null;
      pendingDrop = null;
      slowAccumMs = 0;
      fineSlideActive = false;
      effectiveScaledDx = 0;
      prevStepX = 0;
      prevStepMs = downTimeMs;

      if (hitMode === 'move' && this.selectedLayerIds.size > 1 && this.selectedLayerIds.has(layer.id)) {
        multiGroupSnapshot = [...this.selectedLayerIds]
          .map((id) => project.layers.find((l) => l.id === id))
          .filter((l) => l && !l.locked)
          .map((l) => ({
            layer: l,
            clipEl: this.lanesList.querySelector(`.mf-clip[data-layer-id="${l.id}"]`),
            origStart: l.startFrame,
            origEnd: l.endFrame,
            startFrame: l.startFrame,
            endFrame: l.endFrame,
            keyframes: cloneKeyframesMap(l.keyframes || {})
          }));
      } else {
        multiGroupSnapshot = null;
      }

      if (mainCtx?.clipRecords) {
        origMainSnapshot = mainCtx.clipRecords.map((r) => ({
          layer: r.layer,
          clipEl: r.clip,
          startFrame: r.layer.startFrame,
          endFrame: r.layer.endFrame,
          mediaOffsetFrames: r.layer.mediaOffsetFrames || 0,
          keyframes: cloneKeyframesMap(r.layer.keyframes || {})
        }));
      } else {
        origMainSnapshot = null;
      }
      pushedUndo = false;
      this._isClipGestureActive = true;
      this._isClipHoldLocked = false;
      this.scrollEl?.classList.add('is-clip-dragging');
      try { captureEl.setPointerCapture(e.pointerId); } catch {}
      this._activeDragReapply = reapplyCurrentDrag;
      this._activeClipAbort = () => {
        detachWindowListeners();
        releaseClipPointerCapture();
        stopActiveGestureLoops();
        this._isClipGestureActive = false;
        this._isClipHoldLocked = false;
        this.scrollEl?.classList.remove('is-clip-dragging');
        if (!pushedUndo && mode) {
          restoreOrigState();
        } else if (mode) {
          mode = null;
          activePointerId = null;
          clearDropHighlights();
          this._hideTooltip('drag');
        }
        flushDeferredRenderIfAny();
      };

      attachWindowListeners();

      const delayMs = hitMode === 'move'
        ? (wasAlreadySelected ? MOVE_SELECTED_HOLD_MS : MOVE_HOLD_DELAY_MS)
        : TRIM_HOLD_DELAY_MS;
      holdTimer = setTimeout(() => {
        if (mode !== hitMode || holdActivated || this._isPinching) return;
        activateHold();
      }, delayMs);
    };

    const onWinMove = (e) => {
      if (!mode || activePointerId === null || e.pointerId !== activePointerId) return;
      if (!holdActivated && (this._isPinching || (!this._isClipHoldLocked && this.activePointers.size >= 2))) {
        this._activeClipAbort?.();
        return;
      }

      if (!holdActivated) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const distPx = Math.hypot(dx, dy);
        const elapsedMs = performance.now() - downTimeMs;
        if (shouldActivateClipHold({
          mode,
          pointerType: downPointerType,
          wasSelected: wasAlreadySelected,
          distPx,
          dx,
          elapsedMs
        })) {
          activateHold();
        } else {
          return;
        }
      }

      this._cancelHoverTooltip();
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey), true);
      pendingDragDirty = true;
      if (pendingDragRaf === null) {
        pendingDragRaf = requestAnimationFrame(() => {
          pendingDragRaf = null;
          if (!mode || !holdActivated || !pendingDragDirty) return;
          pendingDragDirty = false;
          applyDragStep(lastClientX, lastClientY, false);
        });
      }
    };

    const onWinEnd = (e) => {
      if (!mode || activePointerId === null) return;
      if (e?.pointerId !== undefined && e.pointerId !== null && e.pointerId !== activePointerId) return;
      detachWindowListeners();
      releaseClipPointerCapture();

      const wasHoldActive = holdActivated;
      const prevMode = mode;
      const hadPendingMove = pendingDragDirty && wasHoldActive && Boolean(prevMode);
      cancelDragRaf();
      if (hadPendingMove) {
        applyDragStep(lastClientX, lastClientY, false);
      }
      cancelHold();
      this._activeClipAbort = null;
      stopActiveGestureLoops();
      this._hideTooltip('drag');
      this.scrollEl?.classList.remove('is-clip-dragging');
      clip.classList.remove('mf-clip-dragging-reorder', 'is-fine-slide', 'is-hold-active');
      leftTrim.classList.remove('is-hold-active');
      rightTrim.classList.remove('is-hold-active');
      clearDropHighlights();

      activePointerId = null;
      this._isClipHoldLocked = false;

      if (!wasHoldActive || !prevMode) {
        this._isClipGestureActive = false;
        // Double-tap on clip middle opens context menu without disturbing drag-and-drop hold
        if (!wasHoldActive && !pushedUndo && prevMode === 'move' && e?.type === 'pointerup') {
          const tapDist = Math.hypot((e.clientX || startX) - startX, (e.clientY || startY) - startY);
          if (tapDist < TAP_MOVE_TOL_PX) {
            const now = Date.now();
            if (now - lastTapTime < 340 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 20) {
              lastTapTime = 0;
              this.cb.onOpenClipContextMenu?.(layer.id, e.clientX, e.clientY);
            } else {
              lastTapTime = now;
              lastTapX = e.clientX;
              lastTapY = e.clientY;
            }
          }
        }
        mode = null;
        flushDeferredRenderIfAny();
        return;
      }

      this._isClipGestureActive = false;
      if (!pushedUndo) {
        mode = null;
        flushDeferredRenderIfAny();
        return;
      }
      this._deferredRenderArgs = null;

      if (prevMode === 'move' && pendingDrop) {
        const d = pendingDrop;
        pendingDrop = null;
        mode = null;
        if (origMainSnapshot) {
          for (const snap of origMainSnapshot) {
            snap.layer.startFrame = snap.startFrame;
            snap.layer.endFrame = snap.endFrame;
            snap.layer.mediaOffsetFrames = snap.mediaOffsetFrames;
            snap.layer.keyframes = cloneKeyframesMap(snap.keyframes);
          }
        }
        this.cb.onDropClipInTimeline?.(layer.id, d);
        return;
      }

      if (prevMode === 'move' && isMainMagnetic && (!multiGroupSnapshot || multiGroupSnapshot.length <= 1)) {
        if (pendingCenterFrame !== null) {
          const moved = TimelineEngine.reorderMainTrackClipByFrame(project, layer.id, pendingCenterFrame);
          if (moved) {
            this.cb.onCommitTimelineChange();
            mode = null;
            return;
          }
        }
        this.cb.onPinchZoom?.();
        mode = null;
        return;
      }

      if (prevMode) {
        this.cb.onCommitTimelineChange();
      }
      mode = null;
    };

    const preventNativeTouchOnHandle = (e) => {
      if (e.touches && e.touches.length === 1) {
        e.preventDefault();
      }
    };
    const preventNativeTouchMoveOnClip = (e) => {
      if (mode && (!e.touches || e.touches.length <= 1) && e.cancelable) {
        e.preventDefault();
      }
    };
    leftTrim.addEventListener('touchstart', preventNativeTouchOnHandle, { passive: false });
    rightTrim.addEventListener('touchstart', preventNativeTouchOnHandle, { passive: false });
    leftTrim.addEventListener('touchmove', preventNativeTouchOnHandle, { passive: false });
    rightTrim.addEventListener('touchmove', preventNativeTouchOnHandle, { passive: false });
    clip.addEventListener('touchmove', preventNativeTouchMoveOnClip, { passive: false });
    clip.addEventListener('dragstart', (e) => e.preventDefault());

    clip.addEventListener('contextmenu', (e) => e.preventDefault());
    leftTrim.addEventListener('pointerdown', (e) => onDown(e, 'left'));
    rightTrim.addEventListener('pointerdown', (e) => onDown(e, 'right'));
    clip.addEventListener('pointerdown', (e) => {
      if (e.target === leftTrim || e.target === rightTrim || e.target.closest?.('.mf-trim-handle')) return;
      onDown(e, 'move');
    });

    clip.addEventListener('pointerenter', (e) => {
      if (mode || this._isPinching || e.pointerType === 'touch') return;
      lastHoverX = e.clientX;
      lastHoverY = e.clientY;
      const edge = detectHandleHover(e);
      clip.classList.toggle('hover-trim-left', edge === 'left');
      clip.classList.toggle('hover-trim-right', edge === 'right');
      clip.style.cursor = layer.locked ? 'not-allowed' : (edge ? 'ew-resize' : 'grab');
      scheduleHoverTooltip(edge);
    });

    clip.addEventListener('pointerleave', () => {
      if (!mode) clearHoverState();
    });

    clip.addEventListener('pointermove', (e) => {
      if (mode || this._isPinching || e.pointerType === 'touch') return;
      const edge = detectHandleHover(e);
      clip.classList.toggle('hover-trim-left', edge === 'left');
      clip.classList.toggle('hover-trim-right', edge === 'right');
      clip.style.cursor = layer.locked ? 'not-allowed' : (edge ? 'ew-resize' : 'grab');
      const movedDist = Math.hypot(e.clientX - lastHoverX, e.clientY - lastHoverY);
      if (movedDist > 4) {
        lastHoverX = e.clientX;
        lastHoverY = e.clientY;
        this._hideTooltip('hover');
        scheduleHoverTooltip(edge);
      }
    });
  }

  _computeClipViewportSlice(leftPx, widthPx) {
    const scrollLeft = Math.max(0, this.scrollEl?.scrollLeft || 0);
    const viewportW = Math.max(300, Math.ceil(this.scrollEl?.clientWidth || 360));
    const pad = 160;
    const visStartPx = Math.max(0, Math.floor((scrollLeft - pad) - leftPx));
    let visEndPx = Math.min(widthPx, Math.ceil((scrollLeft + viewportW + pad) - leftPx));
    if (visEndPx <= visStartPx) {
      return { visible: false, visStartPx: 0, visEndPx: 0, sliceW: 0 };
    }
    if (visEndPx - visStartPx > 2200) {
      visEndPx = visStartPx + 2200;
    }
    return {
      visible: true,
      visStartPx,
      visEndPx,
      sliceW: Math.max(24, Math.ceil(visEndPx - visStartPx))
    };
  }

  redrawVisibleClipCanvases() {
    const scrollLeft = Math.max(0, this.scrollEl?.scrollLeft || 0);
    const viewportW = Math.max(300, Math.ceil(this.scrollEl?.clientWidth || 360));
    const needsSliceRefresh = (entry) => {
      if (entry.renderedStart < 0) {
        const clipRight = entry.leftPx + entry.widthPx;
        return clipRight >= scrollLeft - 160 && entry.leftPx <= scrollLeft + viewportW + 160;
      }
      const viewStartInClip = scrollLeft - entry.leftPx;
      const viewEndInClip = (scrollLeft + viewportW) - entry.leftPx;
      return (entry.renderedStart > 0 && viewStartInClip < entry.renderedStart + 24) ||
        (entry.renderedEnd < entry.widthPx && viewEndInClip > entry.renderedEnd - 24);
    };
    for (const entry of this._waveEntries) {
      if (needsSliceRefresh(entry)) this._paintWaveEntry(entry, true);
    }
    for (const entry of this._filmstripEntries) {
      if (needsSliceRefresh(entry)) this._paintFilmstripEntry(entry, true);
    }
  }

  _paintFilmstripEntry(entry, force = false) {
    const { canvas, tiles, leftPx, widthPx } = entry;
    const slice = this._computeClipViewportSlice(leftPx, widthPx);
    if (!slice.visible) {
      canvas.style.display = 'none';
      entry.renderedStart = -1;
      entry.renderedEnd = -1;
      return;
    }
    if (!force && entry.renderedStart === slice.visStartPx && entry.renderedEnd === slice.visEndPx) return;
    entry.renderedStart = slice.visStartPx;
    entry.renderedEnd = slice.visEndPx;

    canvas.style.display = 'block';
    canvas.style.left = `${slice.visStartPx}px`;
    canvas.style.width = `${slice.sliceW}px`;
    canvas.style.height = '100%';
    canvas.width = slice.sliceW;
    canvas.height = 34;

    const fctx = canvas.getContext('2d');
    fctx.clearRect(0, 0, slice.sliceW, 34);
    const tileW = 54;
    const firstTile = Math.floor(slice.visStartPx / tileW);
    const lastTile = Math.ceil(slice.visEndPx / tileW);
    for (let ti = firstTile; ti <= lastTile; ti++) {
      const tile = tiles[((ti % tiles.length) + tiles.length) % tiles.length];
      const drawX = ti * tileW - slice.visStartPx;
      fctx.drawImage(tile, drawX, 0, tileW, 34);
    }
    fctx.fillStyle = 'rgba(7, 10, 18, 0.34)';
    fctx.fillRect(0, 0, slice.sliceW, 34);
  }

  _paintWaveEntry(entry, force = false) {
    const { canvas, layer, project, audioEngine, leftPx, widthPx } = entry;
    const slice = this._computeClipViewportSlice(leftPx, widthPx);
    if (!slice.visible) {
      canvas.style.display = 'none';
      entry.renderedStart = -1;
      entry.renderedEnd = -1;
      return;
    }
    if (!force && entry.renderedStart === slice.visStartPx && entry.renderedEnd === slice.visEndPx) return;
    entry.renderedStart = slice.visStartPx;
    entry.renderedEnd = slice.visEndPx;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = slice.sliceW;
    const cssH = 34;
    canvas.style.display = 'block';
    canvas.style.left = `${slice.visStartPx}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = '100%';
    const pxW = Math.min(3200, Math.max(24, Math.round(cssW * dpr)));
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const startFrac = Math.max(0, Math.min(1, slice.visStartPx / Math.max(1, widthPx)));
    const endFrac = Math.max(startFrac + 1e-6, Math.min(1, slice.visEndPx / Math.max(1, widthPx)));
    const binCount = Math.max(12, Math.min(480, Math.floor(cssW / 2.2)));
    const fps = Math.max(1, project?.fps || 30);

    const waveData = typeof audioEngine?.sampleWaveformBins === 'function'
      ? audioEngine.sampleWaveformBins(layer.mediaId, layer, fps, startFrac, endFrac, binCount)
      : (audioEngine?.getPeaks(layer.mediaId) || []);

    this.drawWaveform(canvas, waveData, layer, {
      startFrac,
      endFrac,
      dpr: pxW / cssW,
      cssW,
      cssH,
      isVideo: layer.type === 'video'
    });
  }

  drawWaveform(canvas, waveData, layer = null, opts = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = opts.dpr || 1;
    const w = opts.cssW || canvas.width;
    const h = opts.cssH || canvas.height;
    const startFrac = opts.startFrac ?? 0;
    const endFrac = opts.endFrac ?? 1;
    const isVideo = Boolean(opts.isVideo ?? (layer?.type === 'video'));
    const isMuted = Boolean(layer?.audioProps?.muted);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const peaks = Array.isArray(waveData) ? waveData : waveData?.peaks;
    const rms = Array.isArray(waveData) ? null : waveData?.rms;

    if (peaks && peaks.length > 0) {
      if (isVideo) {
        ctx.fillStyle = 'rgba(5, 8, 15, 0.36)';
        ctx.fillRect(0, h * 0.48, w, h * 0.52);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(0, h * 0.5 - 0.5, w, 1);
      }

      const barCount = Math.min(peaks.length, Math.max(8, Math.floor(w / 2)));
      const barW = w / barCount;
      const bw = Math.max(1.1, barW - 0.65);

      for (let i = 0; i < barCount; i++) {
        const pIdx = Math.min(peaks.length - 1, Math.floor((i / barCount) * peaks.length));
        const peak = Math.max(0.05, Math.min(1, peaks[pIdx] || 0));
        const rmsVal = rms ? Math.max(0.03, Math.min(peak, rms[pIdx] || 0)) : peak * 0.65;
        const x = i * barW;

        if (isVideo) {
          const maxH = h * 0.46;
          const ph = Math.max(1.5, peak * maxH);
          const rh = Math.max(1, rmsVal * maxH);
          ctx.fillStyle = isMuted ? 'rgba(0, 229, 255, 0.25)' : 'rgba(0, 229, 255, 0.72)';
          ctx.fillRect(x, h - 1 - ph, bw, ph);
          ctx.fillStyle = isMuted ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.85)';
          ctx.fillRect(x, h - 1 - rh, bw, rh);
        } else {
          const maxH = h - 5;
          const ph = Math.max(2, peak * maxH);
          const rh = Math.max(1.2, rmsVal * maxH);
          ctx.fillStyle = isMuted ? 'rgba(255, 171, 64, 0.26)' : 'rgba(255, 171, 64, 0.85)';
          ctx.fillRect(x, (h - ph) * 0.5, bw, ph);
          ctx.fillStyle = isMuted ? 'rgba(255, 224, 130, 0.26)' : 'rgba(255, 229, 145, 0.92)';
          ctx.fillRect(x, (h - rh) * 0.5, bw, rh);
          if (!isMuted && peak > 0.78 && peak > rmsVal * 1.32) {
            ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
            ctx.fillRect(x, (h - ph) * 0.5, bw, 1.5);
          }
        }
      }
    }

    // Fade-in / Fade-out visual wedges (respecting slice [startFrac..endFrac])
    const totalFrames = Math.max(1, (layer?.endFrame ?? 30) - (layer?.startFrame ?? 0));
    const fadeInFrac = Math.min(0.5, (layer?.audioProps?.fadeInFrames || 0) / totalFrames);
    const fadeOutFrac = Math.min(0.5, (layer?.audioProps?.fadeOutFrames || 0) / totalFrames);
    const sliceSpan = Math.max(1e-6, endFrac - startFrac);

    if (fadeInFrac > 0 && startFrac < fadeInFrac) {
      const visEnd = Math.min(endFrac, fadeInFrac);
      const x1 = ((visEnd - startFrac) / sliceSpan) * w;
      const yAtEnd = (1 - visEnd / fadeInFrac) * h;
      const yAtStart = (1 - startFrac / fadeInFrac) * h;
      ctx.save();
      ctx.fillStyle = 'rgba(7, 10, 18, 0.52)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x1, 0);
      ctx.lineTo(x1, yAtEnd);
      ctx.lineTo(0, yAtStart);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 224, 130, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, yAtStart);
      ctx.lineTo(x1, yAtEnd);
      ctx.stroke();
      ctx.restore();
    }
    if (fadeOutFrac > 0 && endFrac > 1 - fadeOutFrac) {
      const fadeStartFrac = 1 - fadeOutFrac;
      const visStart = Math.max(startFrac, fadeStartFrac);
      const x0 = ((visStart - startFrac) / sliceSpan) * w;
      const yAtStart = ((visStart - fadeStartFrac) / fadeOutFrac) * h;
      const yAtEnd = ((endFrac - fadeStartFrac) / fadeOutFrac) * h;
      ctx.save();
      ctx.fillStyle = 'rgba(7, 10, 18, 0.52)';
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, yAtEnd);
      ctx.lineTo(x0, yAtStart);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 224, 130, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0, yAtStart);
      ctx.lineTo(w, yAtEnd);
      ctx.stroke();
      ctx.restore();
    }

    const volKfs = layer?.keyframes?.volume;
    if (Array.isArray(volKfs) && volKfs.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const steps = Math.max(8, Math.min(48, Math.floor(w / 6)));
      for (let i = 0; i <= steps; i++) {
        const t = startFrac + (i / steps) * sliceSpan;
        const f = layer.startFrame + t * totalFrames;
        const v = KeyframeEngine.getValueAtFrame(layer, 'volume', f, layer.audioProps?.volume ?? 1);
        const y = h - 3 - Math.min(2, Math.max(0, v)) * ((h - 6) / 2);
        const x = (i / steps) * w;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
}
