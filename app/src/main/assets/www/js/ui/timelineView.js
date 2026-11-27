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
  adjustment: 'bi-sliders2-vertical text-warning'
};

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

export class TimelineView {
  constructor(callbacks) {
    this.cb = callbacks;
    this.pxPerFrame = 0.72; // Default overview (~21.6 px/s @ 30fps): 0s, 5s, 10s...; pinch zoom smoothly opens 1s, 2s, 3s...10s then frames
    this.scrollEl = document.getElementById('timelineScroll');
    this.contentEl = document.getElementById('timelineContent');
    this.rulerCanvas = document.getElementById('rulerCanvas');
    this.headersList = document.getElementById('trackHeadersList');
    this.lanesList = document.getElementById('trackLanesList');
    this.playheadEl = document.getElementById('playheadLine');
    this.snapGuideEl = document.getElementById('timelineSnapGuide');
    this.snapGuideTagEl = this.snapGuideEl?.querySelector('.mf-snap-guide-tag') || null;
    this.layerCountEl = document.getElementById('lblLayerCount');
    this.btnGroupChecked = document.getElementById('btnGroupChecked');
    this.dragTooltipEl = document.getElementById('timelineDragTooltip');
    this.kfBarEl = document.getElementById('timelineKfBar');
    this.wrapperEl = this.dragTooltipEl?.parentElement || document.querySelector('.mf-timeline-wrapper');

    this.checkedLayerIds = new Set();
    this.selectedLayerIds = new Set();
    this.selectedKf = null; // { layerId, laneKey, frame }
    this.activePointers = new Map();
    this.pinchStartDist = null;
    this.pinchStartPx = this.pxPerFrame;
    this.pinchTargetPx = this.pxPerFrame;
    this.pinchPivotFrame = 0;
    this.pinchPivotScreenX = 0;
    this._suppressBgTapUntil = 0;
    this._pendingScrollLeft = null;
    this._lastRulerParams = null;
    this._lastTimelineMarkers = [];
    this._lastBeatMarkers = [];
    this._lastDrawnScrollLeft = -1;
    this.isScrubbing = false;
    this.filmstripCache = new Map(); // mediaId -> HTMLCanvasElement strip | 'loading'
    this._waveEntries = [];
    this._filmstripEntries = [];
    this._lastRenderContext = null;
    this._isPinching = false;
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
    this.snapGuideEl.style.left = `${snapInfo.guideFrame * this.pxPerFrame}px`;
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
        this.cb.onPinchZoom?.(); // gentle timeline redraw
      };
      img.onerror = () => this.filmstripCache.delete(mediaItem.id);
      img.src = imgUrl;
      return null;
    }

    if (mediaItem.type === 'video') {
      this.filmstripCache.set(mediaItem.id, 'loading');
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      vid.onloadeddata = async () => {
        try {
          const rawDur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 2;
          const dur = Math.max(0.2, Math.min(3600, rawDur));
          const samples = 4;
          const tiles = [];
          for (let i = 0; i < samples; i++) {
            const t = Math.max(0, Math.min(Math.max(0, dur - 0.05), (dur * (i + 0.15)) / samples));
            await new Promise((res) => {
              const done = () => { vid.removeEventListener('seeked', done); res(); };
              vid.addEventListener('seeked', done, { once: true });
              try { vid.currentTime = t; } catch { res(); }
              setTimeout(done, 160);
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
          try { vid.removeAttribute('src'); vid.load(); } catch {}
        }
      };
      vid.onerror = () => this.filmstripCache.delete(mediaItem.id);
      vid.src = mediaItem.url;
    }
    return null;
  }

  _setZoomAnchored(nextPx, anchorFrame = null, explicitScreenX = null) {
    const oldPx = Math.max(MIN_PX_PER_FRAME, this.pxPerFrame);
    const clamped = Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, Number(nextPx.toFixed(3))));
    const vw = Math.max(200, this.scrollEl?.clientWidth || 360);
    const curScroll = this.scrollEl?.scrollLeft || 0;

    let pivotFrame;
    let pivotScreenX;
    if (explicitScreenX !== null && anchorFrame !== null) {
      pivotFrame = anchorFrame;
      pivotScreenX = explicitScreenX;
    } else {
      const playheadX = (anchorFrame ?? 0) * oldPx;
      const inView = anchorFrame !== null && playheadX >= curScroll && playheadX <= curScroll + vw;
      pivotScreenX = inView ? (playheadX - curScroll) : vw * 0.5;
      pivotFrame = inView ? anchorFrame : (curScroll + pivotScreenX) / oldPx;
    }

    this.pxPerFrame = clamped;
    this._pendingScrollLeft = Math.max(0, pivotFrame * clamped - pivotScreenX);
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
    const vw = Math.max(240, (this.scrollEl?.clientWidth || 360) - 44);
    const fitPx = Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, vw / contentEnd));
    this.pxPerFrame = Number(fitPx.toFixed(3));
    this.pinchTargetPx = this.pxPerFrame;
    this._pendingScrollLeft = 0;
    this._applyFastZoomLayout();
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
        this._applyFastZoomLayout();
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

  _applyFastZoomLayout() {
    const ctx = this._lastRenderContext;
    const project = ctx?.project;
    if (!project) return;
    const fps = Math.max(1, project.fps || 30);
    const totalFrames = Math.max(project.durationFrames, fps * 5);
    const totalWidth = Math.max(this.scrollEl.clientWidth || 360, Math.ceil(totalFrames * this.pxPerFrame) + 120);

    this.contentEl.style.width = `${totalWidth}px`;
    if (this._pendingScrollLeft !== null) {
      const maxScroll = Math.max(0, totalWidth - (this.scrollEl.clientWidth || 0));
      this.scrollEl.scrollLeft = Math.min(maxScroll, Math.max(0, this._pendingScrollLeft));
      this._pendingScrollLeft = null;
    }

    const px = this.pxPerFrame;
    this.drawRuler(totalWidth, fps, totalFrames);
    this.updatePlayhead(this.cb.getPlayheadFrame?.() ?? 0);

    for (const ref of this._zoomRefs.clips) {
      const l = ref.layer;
      const leftPx = l.startFrame * px;
      const widthPx = Math.max(24, (l.endFrame - l.startFrame) * px);
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
      s.el.style.left = `${s.frame * px}px`;
    }
    for (const ts of (this._zoomRefs.transSpans || [])) {
      ts.el.style.left = `${ts.frame * px}px`;
      ts.el.style.width = `${Math.max(8, ts.durationFrames * px)}px`;
    }
    for (const g of this._zoomRefs.gaps) {
      g.el.style.left = `${g.frame * px}px`;
    }
    for (const b of this._zoomRefs.addBtns) {
      b.el.style.left = `${b.frame * px + 8}px`;
    }
    for (const sp of this._zoomRefs.kfSpans) {
      sp.el.style.left = `${sp.layer.startFrame * px}px`;
      sp.el.style.width = `${Math.max(16, (sp.layer.endFrame - sp.layer.startFrame) * px)}px`;
    }
    for (const cn of this._zoomRefs.kfConnectors) {
      const x1 = cn.fromFrame * px;
      const x2 = cn.toFrame * px;
      cn.el.style.left = `${x1}px`;
      cn.el.style.width = `${Math.max(0, x2 - x1)}px`;
    }
    for (const kd of this._zoomRefs.kfDiamonds) {
      kd.el.style.left = `${kd.frame * px}px`;
    }
  }

  _scheduleCrispRedraw(delayMs = 90) {
    clearTimeout(this._pinchEndTimer);
    this._pinchEndTimer = setTimeout(() => {
      if (this._isPinching) return;
      for (const entry of this._waveEntries) {
        entry.leftPx = entry.layer.startFrame * this.pxPerFrame;
        entry.widthPx = Math.max(24, (entry.layer.endFrame - entry.layer.startFrame) * this.pxPerFrame);
        entry.renderedStart = -1;
        entry.renderedEnd = -1;
      }
      for (const entry of this._filmstripEntries) {
        if (entry.layer) {
          entry.leftPx = entry.layer.startFrame * this.pxPerFrame;
          entry.widthPx = Math.max(24, (entry.layer.endFrame - entry.layer.startFrame) * this.pxPerFrame);
        }
        entry.renderedStart = -1;
        entry.renderedEnd = -1;
      }
      this.redrawVisibleClipCanvases();
    }, delayMs);
  }

  _beginPinchSession(x1, y1, x2, y2) {
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
    const midScreenX = Math.max(0, ((x1 + x2) * 0.5) - rect.left);
    this.pinchPivotScreenX = midScreenX;
    this.pinchPivotFrame = (this.scrollEl.scrollLeft + midScreenX) / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame);
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
        this._applyFastZoomLayout();
      }
      this._scheduleCrispRedraw(70);
    }
  }

  bindPinchZoom() {
    // Primary multi-touch handler on Android WebView (prevents scroll/pan steal when 2nd finger lands)
    this.scrollEl.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length >= 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        this._beginPinchSession(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
      }
    }, { passive: false, capture: true });

    this.scrollEl.addEventListener('touchmove', (e) => {
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
      if (this._isPinching && (!e.touches || e.touches.length < 2)) {
        this._endPinchSession();
      }
    };
    this.scrollEl.addEventListener('touchend', onTouchEnd, { capture: true });
    this.scrollEl.addEventListener('touchcancel', onTouchEnd, { capture: true });

    // Secondary multi-pointer fallback (desktop/trackpad/stylus)
    this.scrollEl.addEventListener('pointerdown', (e) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size >= 2 && !this._isPinching) {
        const pts = [...this.activePointers.values()];
        this._beginPinchSession(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      }
    }, { capture: true });

    this.scrollEl.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size >= 2 && this._isPinching && e.pointerType !== 'touch') {
        const pts = [...this.activePointers.values()];
        this._updatePinchSession(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      }
    }, { capture: true });

    const endPtr = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2 && this._isPinching && e.pointerType !== 'touch') {
        this._endPinchSession();
      }
    };
    this.scrollEl.addEventListener('pointerup', endPtr, { capture: true });
    this.scrollEl.addEventListener('pointercancel', endPtr, { capture: true });
  }

  bindRulerAndScroll() {
    this.scrollEl.addEventListener('scroll', () => {
      this._cancelHoverTooltip();
      this.headersList.scrollTop = this.scrollEl.scrollTop;
      if (this._lastRulerParams && Math.abs(this.scrollEl.scrollLeft - this._lastDrawnScrollLeft) >= 1) {
        this.redrawRulerOnly();
        this.redrawVisibleClipCanvases();
      }
    });
    this.headersList.addEventListener('scroll', () => {
      this.scrollEl.scrollTop = this.headersList.scrollTop;
    });
    if (typeof ResizeObserver !== 'undefined' && this.scrollEl) {
      this._rulerResizeObs = new ResizeObserver(() => {
        if (this._lastRulerParams) {
          this.redrawRulerOnly();
          this.redrawVisibleClipCanvases();
        }
      });
      this._rulerResizeObs.observe(this.scrollEl);
    }

    let scrubbing = false;
    let lastScrubX = 0;
    let lastScrubShowTip = false;
    const seekFromPointer = (clientX, showTip = false) => {
      const rect = this.scrollEl.getBoundingClientRect();
      const x = Math.max(0, (clientX - rect.left) + this.scrollEl.scrollLeft);
      const maxFrame = this._lastRulerParams?.totalFrames ?? 99999;
      const frame = Math.max(0, Math.min(maxFrame, Math.round(x / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame))));
      if (showTip && this.dragTooltipEl) {
        const fps = Math.max(1, this._lastRulerParams?.fps || 30);
        const sec = (frame / fps).toFixed(2);
        this.dragTooltipEl.textContent = `Playhead · ${sec}s (F${frame})`;
        this.dragTooltipEl.classList.remove('d-none');
      }
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
      this.redrawRulerOnly();
      this.redrawVisibleClipCanvases();
      seekFromPointer(lastScrubX, lastScrubShowTip);
    };

    const startScrub = (targetEl, e, showTip) => {
      if (this._isPinching || this.activePointers.size >= 2) return;
      e.stopPropagation();
      e.preventDefault();
      scrubbing = true;
      lastScrubX = e.clientX;
      lastScrubShowTip = showTip;
      this.isScrubbing = true;
      this.playheadEl?.classList.add('dragging');
      this._activeScrubAbort = () => endScrub();
      try { targetEl.setPointerCapture(e.pointerId); } catch {}
      this.cb.onScrubStart?.();
      seekFromPointer(e.clientX, showTip);
      this._startEdgeAutoScroll(scrubAutoScrollTick);
    };

    const moveScrub = (e, showTip) => {
      if (!scrubbing) return;
      if (this._isPinching) {
        endScrub();
        return;
      }
      lastScrubX = e.clientX;
      lastScrubShowTip = showTip;
      seekFromPointer(e.clientX, showTip);
    };

    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing = false;
      this._activeScrubAbort = null;
      this._stopEdgeAutoScroll();
      this.isScrubbing = false;
      this.playheadEl?.classList.remove('dragging');
      this.dragTooltipEl?.classList.add('d-none');
      this.cb.onScrubEnd?.();
    };

    let rulerDownX = 0;
    let rulerDownMarker = null;
    this.rulerCanvas.addEventListener('pointerdown', (e) => {
      rulerDownX = e.clientX;
      const rect = this.scrollEl.getBoundingClientRect();
      const x = (e.clientX - rect.left) + this.scrollEl.scrollLeft;
      rulerDownMarker = null;
      for (const m of (this._lastTimelineMarkers || [])) {
        const mf = typeof m === 'number' ? m : Number(m?.frame);
        if (!Number.isFinite(mf)) continue;
        if (Math.abs(mf * this.pxPerFrame - x) <= 10) {
          rulerDownMarker = m;
          break;
        }
      }
      startScrub(this.rulerCanvas, e, false);
    });
    this.rulerCanvas.addEventListener('pointermove', (e) => moveScrub(e, false));
    this.rulerCanvas.addEventListener('pointerup', (e) => {
      const clickedMarker = rulerDownMarker && Math.abs(e.clientX - rulerDownX) <= 5 ? rulerDownMarker : null;
      rulerDownMarker = null;
      endScrub();
      if (clickedMarker && typeof clickedMarker === 'object') {
        this.cb.onClickMarker?.(clickedMarker, e.clientX, e.clientY);
      }
    });
    this.rulerCanvas.addEventListener('pointercancel', () => {
      rulerDownMarker = null;
      endScrub();
    });

    if (this.playheadEl) {
      this.playheadEl.addEventListener('pointerdown', (e) => startScrub(this.playheadEl, e, true));
      this.playheadEl.addEventListener('pointermove', (e) => moveScrub(e, true));
      this.playheadEl.addEventListener('pointerup', endScrub);
      this.playheadEl.addEventListener('pointercancel', endScrub);
    }

    // Ctrl/Cmd + Wheel zoom anchored under cursor
    this.scrollEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = this.scrollEl.getBoundingClientRect();
      const cursorX = Math.max(0, e.clientX - rect.left);
      const cursorFrame = (this.scrollEl.scrollLeft + cursorX) / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame);
      const factor = Math.exp(-e.deltaY * 0.0026);
      this._setZoomAnchored(this.pxPerFrame * factor, cursorFrame, cursorX);
      this.pinchTargetPx = this.pxPerFrame;
      this._applyFastZoomLayout();
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
    const fps = Math.max(1, project.fps || 30);
    const totalFrames = Math.max(project.durationFrames, fps * 5);
    const totalWidth = Math.max(this.scrollEl.clientWidth || 360, Math.ceil(totalFrames * this.pxPerFrame) + 120);

    this.contentEl.style.width = `${totalWidth}px`;
    if (this._pendingScrollLeft !== null) {
      const maxScroll = Math.max(0, totalWidth - (this.scrollEl.clientWidth || 0));
      this.scrollEl.scrollLeft = Math.min(maxScroll, Math.max(0, this._pendingScrollLeft));
      this._pendingScrollLeft = null;
    }

    this.layerCountEl.textContent = String(project.layers.length);

    // Prune checked ids no longer in project
    const validIds = new Set(project.layers.map((l) => l.id));
    for (const id of [...this.checkedLayerIds]) {
      if (!validIds.has(id)) this.checkedLayerIds.delete(id);
    }
    this.btnGroupChecked?.classList.toggle('d-none', this.checkedLayerIds.size < 2);
    this._lastTimelineMarkers = Array.isArray(project.markers) ? project.markers : [];
    this._lastBeatMarkers = Array.isArray(project.beatMarkers) ? project.beatMarkers : [];

    this.drawRuler(totalWidth, fps, totalFrames);
    this.updatePlayhead(currentFrame);
    this.renderHeadersAndLanes(project, selectedLayerId, audioEngine, mediaMap);
    this._renderKfFloatingBar(project);
  }

  redrawRulerOnly() {
    if (!this._lastRulerParams) return;
    const { totalWidth, fps, totalFrames } = this._lastRulerParams;
    this.drawRuler(totalWidth, fps, totalFrames);
  }

  drawRuler(totalWidth, fps, totalFrames) {
    const safeFps = Math.max(1, Math.round(fps || 30));
    this._lastRulerParams = { totalWidth, fps: safeFps, totalFrames };

    const canvas = this.rulerCanvas;
    const viewportW = Math.max(300, Math.ceil(this.scrollEl?.clientWidth || totalWidth || 360));
    const scrollLeft = Math.max(0, this.scrollEl?.scrollLeft || 0);
    this._lastDrawnScrollLeft = scrollLeft;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetPxW = Math.round(viewportW * dpr);
    const targetPxH = Math.round(28 * dpr);

    if (canvas.width !== targetPxW || canvas.height !== targetPxH) {
      canvas.width = targetPxW;
      canvas.height = targetPxH;
    }
    canvas.style.width = `${viewportW}px`;
    canvas.style.height = '28px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportW, 28);
    ctx.fillStyle = '#131822';
    ctx.fillRect(0, 0, viewportW, 28);

    const spec = computeDynamicRulerTicks(this.pxPerFrame, safeFps);
    const minorStep = Math.max(1, spec.minorFrames);
    const startFrame = Math.max(0, Math.floor(Math.max(0, scrollLeft - 90) / this.pxPerFrame / minorStep) * minorStep);
    const endFrame = Math.ceil((scrollLeft + viewportW + 90) / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame));

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    let lastLabelRight = -100;

    for (let f = startFrame; f <= endFrame; f += minorStep) {
      const localX = f * this.pxPerFrame - scrollLeft;
      if (localX < -80 || localX > viewportW + 80) continue;
      const x = Math.round(localX) + 0.5;

      const beyondEnd = f > totalFrames;
      const isMajor = f % spec.majorFrames === 0;
      const isSecond = f % safeFps === 0;
      const isLabelTick = f % spec.labelFrames === 0 || f === 0;

      ctx.strokeStyle = beyondEnd
        ? (isMajor || isLabelTick ? '#33415c' : '#1d2536')
        : (isMajor ? '#587099' : isSecond ? '#435370' : '#263147');
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 10 : isSecond ? 13 : isLabelTick ? 15 : 21);
      ctx.lineTo(x, 28);
      ctx.stroke();

      if (isLabelTick && x >= -12 && x <= viewportW - 6 && x > lastLabelRight + 6) {
        const label = formatRulerLabel(f, safeFps);
        const tw = ctx.measureText(label).width;
        const isMinute = isSecond && ((f / safeFps) % 60 === 0) && f > 0;
        ctx.fillStyle = beyondEnd
          ? '#6f7e99'
          : (isMinute ? '#00e5ff' : isMajor || isSecond ? '#d3dceb' : '#96a6c0');
        ctx.fillText(label, x + 3, 2);
        lastLabelRight = x + 3 + tw;
      }
    }

    // Subtle marker showing project content duration boundary along the continuous ruler
    const durX = Math.round(totalFrames * this.pxPerFrame - scrollLeft) + 0.5;
    if (durX >= 0 && durX <= viewportW) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(durX, 0);
      ctx.lineTo(durX, 28);
      ctx.stroke();
      ctx.restore();
    }

    // Draw Timeline Markers along upper/mid ruler (emerald bookmark pins)
    if (this._lastTimelineMarkers.length > 0) {
      ctx.save();
      for (const m of this._lastTimelineMarkers) {
        const mf = typeof m === 'number' ? m : Number(m?.frame);
        if (!Number.isFinite(mf)) continue;
        const mx = mf * this.pxPerFrame - scrollLeft;
        if (mx < -12 || mx > viewportW + 12) continue;
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
        const bx = bf * this.pxPerFrame - scrollLeft;
        if (bx < -10 || bx > viewportW + 10) continue;
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
    const x = Math.max(0, currentFrame * this.pxPerFrame);
    this.playheadEl.style.transform = `translateX(${x}px)`;
  }

  _buildClipElement(project, layer, isSelected, audioEngine, mediaMap) {
    const leftPx = layer.startFrame * this.pxPerFrame;
    const widthPx = Math.max(24, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
    const isMulti = !isSelected && this.selectedLayerIds.has(layer.id);

    const clip = document.createElement('div');
    clip.className = `mf-clip mf-clip-${layer.type} ${isSelected ? 'selected' : ''} ${isMulti ? 'multi-selected' : ''} ${layer.locked ? 'locked' : ''}`.trim();
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
        diamond.title = `Keyframe @ F${kfFrame} (Drag to move)`;
        this.bindDiamondGesture(diamond, layer, kfFrame);
        clip.appendChild(diamond);
        diamonds.push({ el: diamond, frame: kfFrame });
      }
    });
    clip._mfDiamonds = diamonds;

    const leftTrim = document.createElement('div');
    leftTrim.className = 'mf-trim-handle left';
    leftTrim.title = 'Drag to Trim / Extend Start';
    const rightTrim = document.createElement('div');
    rightTrim.className = 'mf-trim-handle right';
    rightTrim.title = 'Drag to Trim / Extend End';
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
    const radius = actions.length <= 4 ? 66 : 72;
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

  _appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId) {
    const layerIndex = project.layers.findIndex((l) => l.id === layer.id);
    const isSelected = layer.id === selectedLayerId;
    const isChecked = this.checkedLayerIds.has(layer.id);
    const isCompact = Boolean(layer.trackCompact);
    const isSticker = Boolean(layer.mediaId?.startsWith('stk_'));
    const hasMuteControl = layer.type === 'audio' || layer.type === 'video';
    const isMuted = Boolean(layer.audioProps?.muted);
    const zone = layer.type === 'audio' ? 'audio' : 'overlay';

    const hdr = document.createElement('div');
    hdr.className = `mf-track-header-item zone-${zone} d-flex align-items-center justify-content-between ${isSelected ? 'selected' : ''} ${layer.parentId ? 'child-layer' : ''} ${isCompact ? 'compact' : ''}`.trim();
    hdr.dataset.index = String(layerIndex);
    hdr.dataset.layerId = layer.id;
    hdr.dataset.zone = zone;
    const roleHint = layer.type === 'adjustment'
      ? 'FX · '
      : isSticker
        ? 'STK · '
        : layer.type === 'video' || layer.type === 'image'
          ? 'PIP · '
          : layer.type === 'text'
            ? 'TXT · '
            : layer.type === 'shape'
              ? 'SHP · '
              : '';
    const iconCls = isSticker ? 'bi-emoji-smile text-warning' : (LAYER_ICONS[layer.type] || 'bi-layers');

    const hasKfs = KeyframeEngine.getAllKeyframeFrames(layer).length > 0;
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
      <div class="d-flex align-items-center gap-1 min-w-0 flex-grow-1 overflow-hidden">
        <span class="mf-drag-handle flex-shrink-0" title="Drag to Reorder Z-Stack"><i class="bi bi-grip-vertical"></i></span>
        ${layer.type !== 'group' ? `<input type="checkbox" class="form-check-input m-0 flex-shrink-0" style="width:11px;height:11px;" ${isChecked ? 'checked' : ''} aria-label="Select for Group" />` : ''}
        <i class="bi ${iconCls} small flex-shrink-0"></i>
        <span class="mf-track-title min-w-0">${roleHint}${this.escapeHtml(layer.name)}</span>
      </div>
      <div class="d-flex align-items-center flex-shrink-0">
        <button type="button" class="mf-track-wheel-btn ${hasTrackStatusAlert ? 'has-alert' : ''}" data-act="open-wheel" title="Buka Kontrol Track" aria-label="Buka Roda Kontrol Track ${this.escapeHtml(layer.name)}">
          <i class="bi bi-sliders"></i>
          ${wheelDotClass ? `<span class="mf-wheel-status-dot ${wheelDotClass}"></span>` : ''}
        </button>
      </div>
    `;

    const cbEl = hdr.querySelector('input[type="checkbox"]');
    if (cbEl) {
      cbEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cbEl.checked) this.checkedLayerIds.add(layer.id);
        else this.checkedLayerIds.delete(layer.id);
        this.btnGroupChecked?.classList.toggle('d-none', this.checkedLayerIds.size < 2);
      });
    }

    const dragHandle = hdr.querySelector('.mf-drag-handle');
    let draggingRow = false;
    let zoneRows = [];
    let currentTargetIdx = layerIndex;
    const resolveTargetRowIdx = (clientY) => {
      if (zoneRows.length === 0) return layerIndex;
      let best = zoneRows[0];
      let bestDist = Infinity;
      for (const r of zoneRows) {
        const d = Math.abs(clientY - r.midY);
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best.layerIndex;
    };
    dragHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      draggingRow = true;
      currentTargetIdx = layerIndex;
      zoneRows = [...this.headersList.querySelectorAll(`.mf-track-header-item[data-layer-id][data-zone="${zone}"]`)].map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, layerIndex: Number(el.dataset.index), midY: rect.top + rect.height * 0.5 };
      });
      dragHandle.setPointerCapture(e.pointerId);
    });
    dragHandle.addEventListener('pointermove', (e) => {
      if (!draggingRow) return;
      currentTargetIdx = resolveTargetRowIdx(e.clientY);
      this.headersList.querySelectorAll('.mf-track-header-item[data-layer-id]').forEach((el) => {
        const elIdx = Number(el.dataset.index);
        el.classList.toggle('drag-over', elIdx === currentTargetIdx && elIdx !== layerIndex);
      });
    });
    const finishReorder = (e) => {
      if (!draggingRow) return;
      draggingRow = false;
      const targetIdx = resolveTargetRowIdx(e.clientY);
      this.headersList.querySelectorAll('.mf-track-header-item').forEach((el) => el.classList.remove('drag-over'));
      if (targetIdx !== layerIndex) {
        this.cb.onReorderLayerToIndex(layer.id, targetIdx);
      }
    };
    dragHandle.addEventListener('pointerup', finishReorder);
    dragHandle.addEventListener('pointercancel', finishReorder);

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
    const hasTr = junc.type && junc.type !== 'none';
    let spanEl = null;
    if (hasTr) {
      spanEl = document.createElement('div');
      spanEl.className = 'mf-trans-span';
      spanEl.style.left = `${junc.seamFrame * this.pxPerFrame}px`;
      spanEl.style.width = `${Math.max(8, junc.durationFrames * this.pxPerFrame)}px`;
      lane.appendChild(spanEl);
      this._zoomRefs.transSpans.push({ el: spanEl, frame: junc.seamFrame, durationFrames: junc.durationFrames });
    }

    const seamBtn = document.createElement('button');
    seamBtn.type = 'button';
    seamBtn.className = `mf-trans-seam-btn ${hasTr ? 'has-trans' : ''}`;
    seamBtn.dataset.leftId = junc.leftId;
    seamBtn.dataset.rightId = junc.rightId;
    seamBtn.style.left = `${junc.seamFrame * this.pxPerFrame}px`;
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
      <div class="d-flex align-items-center gap-1 min-w-0 flex-grow-1 overflow-hidden">
        <i class="bi bi-film text-info small flex-shrink-0"></i>
        <span class="mf-track-title text-info min-w-0">Main</span>
        <span class="badge bg-info bg-opacity-25 text-info px-1 flex-shrink-0" style="font-size:0.54rem;">${mainClips.length}</span>
      </div>
      <div class="d-flex align-items-center flex-shrink-0">
        <button type="button" class="mf-track-wheel-btn ${mainDotClass ? 'has-alert' : ''}" data-act="open-wheel" title="Buka Kontrol Main Track" aria-label="Buka Roda Kontrol Main Track">
          <i class="bi bi-sliders"></i>
          ${mainDotClass ? `<span class="mf-wheel-status-dot ${mainDotClass}"></span>` : ''}
        </button>
      </div>
    `;

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

          return [
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
    addBtn.style.left = `${mainEndFrame * this.pxPerFrame + 8}px`;
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
      hint.textContent = 'Track Utama · Khusus Video & Gambar';
      lane.appendChild(hint);
    }

    this.lanesList.appendChild(lane);
    if (isMainKfExpanded && activeMainClip) {
      this._appendKeyframeSubLanes(project, activeMainClip);
    }
  }

  _appendGapClosePill(lane, centerFrame) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mf-gap-pill';
    pill.style.left = `${centerFrame * this.pxPerFrame}px`;
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

    // Zone 1 (Top): Non-audio overlays (Text, Shape, Adjustment, Overlay Video/Image, Group)
    for (const layer of nonMainOverlays) {
      this._appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);
    }

    // Zone 2 (Center): Single Main Track (ONLY Video & Image) - always visible in the middle
    this._appendMainTrackRow(project, mainClips, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);

    // Zone 3 (Bottom): Audio tracks ONLY
    for (const layer of audioLayers) {
      this._appendSingleLayerRow(project, layer, selectedLayerId, audioEngine, mediaMap, junctionByLeftId);
    }

    if (this._activeWheel) {
      this._renderActiveWheelNodes();
    }
  }

  _appendKeyframeSubLanes(project, layer) {
    const groups = KeyframeEngine.getVisibleKeyframeLanes(layer);
    const playFrame = Math.round(this.cb.getPlayheadFrame?.() ?? 0);
    const px = this.pxPerFrame;

    for (const group of groups) {
      const entries = KeyframeEngine.getLaneKeyframes(layer, group.props);
      const hasAtPlayhead = entries.some((k) => k.frame === playFrame);

      const subHdr = document.createElement('div');
      subHdr.className = 'mf-kf-lane-header';
      subHdr.dataset.layerId = layer.id;
      subHdr.dataset.laneKey = group.key;
      subHdr.innerHTML = `
        <div class="d-flex align-items-center gap-1 min-w-0 flex-grow-1 overflow-hidden">
          <i class="bi ${group.icon}" style="color:${group.color};font-size:0.65rem;flex-shrink:0;"></i>
          <span class="mf-kf-lane-label">${group.label}</span>
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
      subLane.className = 'mf-kf-lane';
      subLane.dataset.layerId = layer.id;
      subLane.dataset.laneKey = group.key;

      const spanEl = document.createElement('div');
      spanEl.className = 'mf-kf-lane-span';
      spanEl.style.left = `${layer.startFrame * px}px`;
      spanEl.style.width = `${Math.max(16, (layer.endFrame - layer.startFrame) * px)}px`;
      subLane.appendChild(spanEl);
      this._zoomRefs.kfSpans.push({ el: spanEl, layer });

      for (let i = 0; i < entries.length - 1; i++) {
        const a = entries[i];
        const b = entries[i + 1];
        const conn = document.createElement('div');
        const isLinear = a.easing === 'linear';
        conn.className = `mf-kf-connector ${isLinear ? 'is-linear' : 'is-ease'}`;
        conn.style.color = group.color;
        if (isLinear) conn.style.backgroundColor = group.color;
        conn.style.left = `${a.frame * px}px`;
        conn.style.width = `${Math.max(0, (b.frame - a.frame) * px)}px`;
        subLane.appendChild(conn);
        this._zoomRefs.kfConnectors.push({ el: conn, fromFrame: a.frame, toFrame: b.frame });
      }

      for (const entry of entries) {
        const dEl = document.createElement('div');
        const isSelected = Boolean(
          this.selectedKf &&
          this.selectedKf.layerId === layer.id &&
          this.selectedKf.laneKey === group.key &&
          this.selectedKf.frame === entry.frame
        );
        dEl.className = `mf-kf-lane-diamond ${entry.easing === 'linear' ? 'is-linear' : 'is-ease'} ${isSelected ? 'selected' : ''}`.trim();
        dEl.style.left = `${entry.frame * px}px`;
        dEl.style.backgroundColor = group.isColor && entry.colorVal ? entry.colorVal : group.color;
        dEl.title = `${group.label} @ F${entry.frame} (${entry.easing}) · Geser atau klik untuk ubah/hapus`;
        dEl.setAttribute('role', 'button');
        dEl.setAttribute('aria-label', `${group.label} Keyframe Frame ${entry.frame}`);
        this.bindLaneDiamondGesture(dEl, project, layer, group, entry);
        subLane.appendChild(dEl);
        this._zoomRefs.kfDiamonds.push({ el: dEl, frame: entry.frame });
      }

      this.lanesList.appendChild(subLane);
    }
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
    let pushedUndo = false;

    const applyMoveStep = (clientX) => {
      if (!dragging) return;
      const scrollDx = (this.scrollEl?.scrollLeft || 0) - startScrollLeft;
      const dx = (clientX - startX) + scrollDx;
      if (Math.abs(dx) < 3 && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
        this._startEdgeAutoScroll(edgeTick);
      }
      const rawNext = origFrame + Math.round(dx / this.pxPerFrame);
      const snapMeta = this._snapSingleKeyframeFrame(project, layer, group.props, rawNext);
      curFrame = snapMeta.frame;
      diamond.style.left = `${curFrame * this.pxPerFrame}px`;
      this._showSnapGuide(snapMeta.snapped ? { snapped: true, snapTargetFrame: snapMeta.frame, kind: snapMeta.kind, label: snapMeta.label } : null);
      const snapTxt = snapMeta.snapped ? ` · Snap ${snapMeta.label}` : '';
      this._showTooltip(`${group.label} · F${curFrame}${snapTxt}`, diamond, 'drag');
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
      pushedUndo = false;
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
      if (pushedUndo && curFrame !== origFrame) {
        this.selectedKf = { layerId: layer.id, laneKey: group.key, frame: curFrame };
        this.cb.onMovePropKeyframe?.(layer.id, group.props, origFrame, curFrame);
      } else {
        this.selectedKf = { layerId: layer.id, laneKey: group.key, frame: origFrame };
        this.lanesList.querySelectorAll('.mf-kf-lane-diamond.selected').forEach((el) => el.classList.remove('selected'));
        diamond.classList.add('selected');
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true });
        this.cb.onSeekFrame(origFrame);
        this._renderKfFloatingBar(project);
      }
    };
    diamond.addEventListener('pointerup', endDrag);
    diamond.addEventListener('pointercancel', endDrag);
  }

  _renderKfFloatingBar(project) {
    if (!this.kfBarEl) return;
    const sel = this.selectedKf;
    if (!sel || !project) {
      this.kfBarEl.classList.add('d-none');
      this.kfBarEl.innerHTML = '';
      return;
    }
    const layer = project.layers.find((l) => l.id === sel.layerId);
    const group = layer
      ? KeyframeEngine.getVisibleKeyframeLanes(layer).find((g) => g.key === sel.laneKey)
      : null;
    const entry = (layer && group)
      ? KeyframeEngine.getLaneKeyframes(layer, group.props).find((k) => k.frame === sel.frame)
      : null;
    if (!layer || !group || !entry) {
      this.selectedKf = null;
      this.kfBarEl.classList.add('d-none');
      this.kfBarEl.innerHTML = '';
      return;
    }

    const easingModes = [
      { id: 'linear', label: 'Linear' },
      { id: 'easeIn', label: 'Ease In' },
      { id: 'easeOut', label: 'Ease Out' },
      { id: 'easeInOut', label: 'Ease' }
    ];

    this.kfBarEl.classList.remove('d-none');
    this.kfBarEl.innerHTML = `
      <span class="mf-kf-meta"><i class="bi bi-diamond-fill me-1" style="color:${group.color};"></i>${group.label} · F${entry.frame}</span>
      ${group.isColor ? `<input type="color" id="kfBarColorPick" value="${entry.colorVal || '#ffffff'}" style="width:22px;height:20px;padding:0;border:1px solid #475569;border-radius:4px;background:transparent;" title="Ubah Warna Keyframe" />` : ''}
      ${easingModes.map((m) => `
        <button type="button" class="btn ${entry.easing === m.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle text-light'}" data-kf-ease="${m.id}">${m.label}</button>
      `).join('')}
      <button type="button" class="btn btn-dark border-secondary-subtle text-info" data-kf-open-curve="1" title="Buka Pengaturan Kurva & Nilai"><i class="bi bi-bezier2"></i></button>
      <button type="button" class="btn btn-outline-danger" data-kf-del-one="1" title="Hapus Keyframe Ini"><i class="bi bi-trash3"></i></button>
      <button type="button" class="btn btn-dark border-secondary-subtle text-secondary" data-kf-close="1" aria-label="Tutup"><i class="bi bi-x-lg"></i></button>
    `;

    this.kfBarEl.querySelectorAll('[data-kf-ease]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.cb.onSetPropKeyframeEasing?.(layer.id, group.props, entry.frame, btn.dataset.kfEase);
      };
    });
    const colorPick = this.kfBarEl.querySelector('#kfBarColorPick');
    if (colorPick) {
      colorPick.onchange = (e) => {
        this.cb.onSetPropKeyframeColor?.(layer.id, entry.frame, e.target.value, entry.easing);
      };
    }
    this.kfBarEl.querySelector('[data-kf-open-curve]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onFocusKeyframeProp?.(layer.id, group.primaryProp);
    });
    this.kfBarEl.querySelector('[data-kf-del-one]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedKf = null;
      this.cb.onDeletePropKeyframe?.(layer.id, group.props, entry.frame);
    });
    this.kfBarEl.querySelector('[data-kf-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedKf = null;
      this.lanesList.querySelectorAll('.mf-kf-lane-diamond.selected').forEach((el) => el.classList.remove('selected'));
      this._renderKfFloatingBar(project);
    });
  }

  bindDiamondGesture(diamond, layer, origFrame) {
    let dragging = false;
    let startX = 0;
    let curFrame = origFrame;
    let pushedUndo = false;

    diamond.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (layer.locked) return;
      dragging = true;
      startX = e.clientX;
      curFrame = origFrame;
      pushedUndo = false;
      diamond.setPointerCapture(e.pointerId);
    });

    diamond.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) < 4 && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
      }
      const nextFrame = Math.max(layer.startFrame, Math.min(layer.endFrame, origFrame + Math.round(dx / this.pxPerFrame)));
      curFrame = nextFrame;
      diamond.style.left = `${(nextFrame - layer.startFrame) * this.pxPerFrame}px`;
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (pushedUndo && curFrame !== origFrame) {
        this.cb.onMoveKeyframeFrame(layer.id, origFrame, curFrame);
      } else {
        this.cb.onSelectLayer(layer.id);
        this.cb.onSeekFrame(origFrame);
      }
    };
    diamond.addEventListener('pointerup', endDrag);
    diamond.addEventListener('pointercancel', endDrag);
  }

  bindClipGestures(clip, leftTrim, rightTrim, project, layer, waveEntry = null, filmEntry = null, laneEl = null, mainCtx = null) {
    let mode = null;
    let startX = 0;
    let startY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let startScrollLeft = 0;
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
    let longPressTimer = null;
    let longPressTriggered = false;
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

    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const detectEdgeHover = (e) => {
      if (layer.locked) return null;
      if (e.target === leftTrim || e.target.closest?.('.mf-trim-handle.left')) return 'left';
      if (e.target === rightTrim || e.target.closest?.('.mf-trim-handle.right')) return 'right';
      const rect = clip.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const maxEdge = e.pointerType === 'touch' ? 20 : 14;
      const edgeZone = Math.min(maxEdge, Math.max(8, rect.width * 0.26));
      const relX = e.clientX - rect.left;
      if (relX <= edgeZone) return 'left';
      if (rect.width - relX <= edgeZone) return 'right';
      return null;
    };

    const scheduleHoverTooltip = (edgeHover) => {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        if (mode || this._isPinching) return;
        const fps = Math.max(1, project.fps || 30);
        const durF = Math.max(0, layer.endFrame - layer.startFrame);
        const durText = formatDurationShort(durF, fps);
        const prefix = edgeHover ? 'Trim · ' : '';
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
      this.lanesList.querySelectorAll('.mf-track-lane').forEach((ln) => {
        ln.classList.remove('drop-target', 'main-drop-target');
      });
      this.lanesList.querySelector('.mf-track-lane.main-track .mf-reorder-indicator')?.classList.add('d-none');
      clip.style.transform = '';
      if (origMainSnapshot) {
        for (const snap of origMainSnapshot) {
          if (snap.clipEl !== clip) {
            snap.clipEl.style.left = `${snap.layer.startFrame * this.pxPerFrame}px`;
          }
        }
      }
    };

    const syncDiamondsForClip = () => {
      const list = clip._mfDiamonds;
      if (!Array.isArray(list) || list.length === 0) return;
      const widthPx = Math.max(24, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
      for (const d of list) {
        const relPx = (d.frame - layer.startFrame) * this.pxPerFrame;
        d.el.style.left = `${relPx}px`;
        d.el.style.display = relPx >= 0 && relPx <= widthPx ? '' : 'none';
      }
    };

    const stopActiveGestureLoops = () => {
      cancelLongPress();
      this._stopEdgeAutoScroll();
      if (this._activeDragReapply === reapplyCurrentDrag) {
        this._activeDragReapply = null;
      }
      clip.classList.remove('is-fine-slide');
      this._hideSnapGuide();
    };

    const restoreOrigState = () => {
      stopActiveGestureLoops();
      if (multiGroupSnapshot && multiGroupSnapshot.length > 1) {
        for (const g of multiGroupSnapshot) {
          g.layer.startFrame = g.startFrame;
          g.layer.endFrame = g.endFrame;
          g.layer.keyframes = JSON.parse(JSON.stringify(g.keyframes));
          if (g.clipEl) {
            g.clipEl.style.left = `${g.startFrame * this.pxPerFrame}px`;
          }
        }
      } else if (origMainSnapshot) {
        for (const snap of origMainSnapshot) {
          snap.layer.startFrame = snap.startFrame;
          snap.layer.endFrame = snap.endFrame;
          snap.layer.mediaOffsetFrames = snap.mediaOffsetFrames;
          snap.layer.keyframes = JSON.parse(JSON.stringify(snap.keyframes));
          snap.clipEl.style.left = `${snap.startFrame * this.pxPerFrame}px`;
          snap.clipEl.style.width = `${Math.max(24, (snap.endFrame - snap.startFrame) * this.pxPerFrame)}px`;
        }
      } else {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.mediaOffsetFrames = origMediaOffset;
        layer.keyframes = JSON.parse(JSON.stringify(origKeyframes || {}));
        clip.style.left = `${origStart * this.pxPerFrame}px`;
        clip.style.width = `${Math.max(24, (origEnd - origStart) * this.pxPerFrame)}px`;
      }
      syncDiamondsForClip();
      clip.classList.remove('mf-clip-dragging-reorder', 'is-fine-slide');
      this._hideTooltip('drag');
      clearDropHighlights();
      mode = null;
    };

    const applyDragStep = (clientX, clientY, fromAutoScroll = false) => {
      if (!mode) return;
      const scrollDx = this.scrollEl.scrollLeft - startScrollLeft;
      const rawDx = (clientX - startX) + scrollDx;
      const dy = clientY - startY;
      if (Math.hypot(rawDx, dy) >= 7) {
        cancelLongPress();
      }
      if (Math.hypot(rawDx, dy) < 4 && !pushedUndo) return;
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
          g.layer.keyframes = JSON.parse(JSON.stringify(g.keyframes));
          TimelineEngine.shiftLayerKeyframes(g.layer, effectiveDelta);
          TimelineEngine.ensureProjectDuration(project, g.layer.endFrame);
          if (g.clipEl) {
            g.clipEl.style.left = `${g.layer.startFrame * this.pxPerFrame}px`;
          }
        }
        syncDiamondsForClip();
        const snapTag = snapMeta.snapped && snapActive ? ` · Snap: ${snapMeta.label}` : bypassSuffix;
        this._showTooltip(`${finePrefix}${multiGroupSnapshot.length} Clip (${formatSignedDurationDelta(effectiveDelta, fps)})${snapTag}`, clip, 'drag');
        this.cb.onPreviewRefresh();
        return;
      }

      // 2D Drag & Drop target detection across lanes when moving vertically >= 24px
      let hoveredLane = null;
      if (mode === 'move' && Math.abs(dy) >= 24) {
        const lanes = [...this.lanesList.querySelectorAll('.mf-track-lane')];
        for (const ln of lanes) {
          const r = ln.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            hoveredLane = ln;
            break;
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
          mainDropMarker.style.left = `${seamFrame * this.pxPerFrame}px`;
          mainDropMarker.classList.remove('d-none');
        }
        clip.classList.add('mf-clip-dragging-reorder');
        clip.style.left = `${dragStart * this.pxPerFrame}px`;
        clip.style.transform = `translateY(${dy}px) scale(1.03)`;
        pendingDrop = { targetRole: 'main', targetStartFrame: dragStart, dragCenterFrame: centerFrame };
        this._showTooltip(`${finePrefix}Main Track #${targetSlot + 1} · ${formatDurationShort(len, fps)}`, clip, 'drag');
        return;
      }

      // Case 2: Main Track clip dragged vertically off Main Track into Top Overlay zone ONLY (never Audio zone)
      if (mode === 'move' && layer.trackRole === 'main' && Math.abs(dy) >= 26 && (!hoveredLane || (hoveredLane.dataset.laneType !== 'main' && hoveredLane.dataset.zone !== 'audio'))) {
        const mainRect = laneEl?.getBoundingClientRect();
        if (mainRect && clientY < mainRect.top - 10) {
          clearDropHighlights();
          if (hoveredLane && hoveredLane.dataset.zone === 'overlay') hoveredLane.classList.add('drop-target');
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
          clip.style.left = `${dragStart * this.pxPerFrame}px`;
          clip.style.transform = `translateY(${dy}px) scale(1.03)`;
          const tgtIdx = hoveredLane?.dataset?.layerIndex ? Number(hoveredLane.dataset.layerIndex) : null;
          pendingDrop = { targetRole: 'overlay', targetLayerIndex: Number.isInteger(tgtIdx) ? tgtIdx : null, targetStartFrame: dragStart };
          const snapTag = snapMeta.snapped && snapActive ? ` · Snap: ${snapMeta.label}` : bypassSuffix;
          this._showTooltip(`${finePrefix}Overlay @ ${formatDurationShort(dragStart, fps)}${snapTag}`, clip, 'drag');
          return;
        }
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
        clip.classList.add('mf-clip-dragging-reorder');
        clip.style.left = `${dragStart * this.pxPerFrame}px`;

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
            if (sibRec) sibRec.clipEl.style.left = `${cursorF * this.pxPerFrame}px`;
            cursorF += Math.max(5, sib.endFrame - sib.startFrame);
          }
        }
        if (mainCtx?.dropMarker) {
          mainCtx.dropMarker.style.left = `${seamFrame * this.pxPerFrame}px`;
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
        layer.keyframes = JSON.parse(JSON.stringify(origKeyframes));
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
            snap.layer.keyframes = JSON.parse(JSON.stringify(snap.keyframes));
          }
        } else {
          layer.startFrame = origStart;
          layer.endFrame = origEnd;
          layer.mediaOffsetFrames = origMediaOffset;
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
            const sLeft = snap.layer.startFrame * this.pxPerFrame;
            const sWidth = Math.max(24, (snap.layer.endFrame - snap.layer.startFrame) * this.pxPerFrame);
            snap.clipEl.style.left = `${sLeft}px`;
            snap.clipEl.style.width = `${sWidth}px`;
          }
        }
      }

      const nextLeftPx = layer.startFrame * this.pxPerFrame;
      const nextWidthPx = Math.max(24, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
      const curContentW = parseFloat(this.contentEl.style.width || '0') || 0;
      if (nextLeftPx + nextWidthPx + 140 > curContentW) {
        this.contentEl.style.width = `${Math.ceil(nextLeftPx + nextWidthPx + 180)}px`;
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
      if (!mode || !pushedUndo) return;
      applyDragStep(lastClientX, lastClientY, true);
    };

    const edgeAutoScrollTick = () => {
      if (!mode || !pushedUndo || this._isPinching || this.activePointers.size >= 2) return;
      const sRect = this.scrollEl.getBoundingClientRect();
      const step = computeEdgeAutoScrollDelta(lastClientX, sRect.left, sRect.right, this.scrollEl.scrollLeft, 36, 16);
      if (step === 0) return;
      if (step > 0) {
        const curW = parseFloat(this.contentEl.style.width || '0') || this.contentEl.clientWidth;
        const neededW = this.scrollEl.scrollLeft + sRect.width + step + 180;
        if (neededW > curW) {
          this.contentEl.style.width = `${Math.ceil(neededW)}px`;
        }
      }
      const nextScroll = Math.max(0, this.scrollEl.scrollLeft + step);
      if (nextScroll === this.scrollEl.scrollLeft) return;
      this.scrollEl.scrollLeft = nextScroll;
      this.redrawRulerOnly();
      this.redrawVisibleClipCanvases();
      applyDragStep(lastClientX, lastClientY, true);
    };

    const onDown = (e, hitMode) => {
      if (e.target.classList.contains('mf-kf-diamond')) return;
      if (this._isPinching || this.activePointers.size >= 2) return;
      e.stopPropagation();
      this._cancelHoverTooltip();
      longPressTriggered = false;
      cancelLongPress();

      const isToggleMulti = Boolean(e.ctrlKey || e.metaKey);
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey), true);

      if (isToggleMulti) {
        this.cb.onToggleMultiSelectLayer?.(layer.id);
        return;
      }

      if (this.selectedLayerIds.has(layer.id) && this.selectedLayerIds.size > 1) {
        this.setSelectionInPlace(layer.id, this.selectedLayerIds);
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true, keepMulti: true });
      } else {
        this.setSelectionInPlace(layer.id, [layer.id]);
        this.cb.onSelectLayer(layer.id, { skipTimelineRender: true });
      }

      if (hitMode === 'move') {
        const lpX = e.clientX;
        const lpY = e.clientY;
        longPressTimer = setTimeout(() => {
          if (mode !== 'move' || pushedUndo || this._isPinching || this.activePointers.size >= 2) return;
          longPressTriggered = true;
          mode = null;
          stopActiveGestureLoops();
          try { navigator.vibrate?.(18); } catch {}
          this.cb.onOpenClipContextMenu?.(layer.id, lpX, lpY);
        }, 420);
      }

      if (layer.locked) return;
      const effectiveMode = hitMode === 'move' ? (detectEdgeHover(e) || 'move') : hitMode;
      mode = effectiveMode;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      startScrollLeft = this.scrollEl.scrollLeft;
      origStart = layer.startFrame;
      origEnd = layer.endFrame;
      origMediaOffset = layer.mediaOffsetFrames || 0;
      origKeyframes = JSON.parse(JSON.stringify(layer.keyframes || {}));
      pendingCenterFrame = null;
      pendingDrop = null;
      slowAccumMs = 0;
      fineSlideActive = false;
      effectiveScaledDx = 0;
      prevStepX = 0;
      prevStepMs = performance.now();

      if (effectiveMode === 'move' && this.selectedLayerIds.size > 1 && this.selectedLayerIds.has(layer.id)) {
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
            keyframes: JSON.parse(JSON.stringify(l.keyframes || {}))
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
          keyframes: JSON.parse(JSON.stringify(r.layer.keyframes || {}))
        }));
      } else {
        origMainSnapshot = null;
      }
      pushedUndo = false;
      this._activeDragReapply = reapplyCurrentDrag;
      this._activeClipAbort = () => {
        stopActiveGestureLoops();
        if (!pushedUndo && mode) {
          restoreOrigState();
        } else if (mode) {
          mode = null;
          clearDropHighlights();
          this._hideTooltip('drag');
        }
      };
      try { clip.setPointerCapture(e.pointerId); } catch {}
    };

    leftTrim.addEventListener('pointerdown', (e) => onDown(e, 'left'));
    rightTrim.addEventListener('pointerdown', (e) => onDown(e, 'right'));
    clip.addEventListener('pointerdown', (e) => {
      if (e.target === leftTrim || e.target === rightTrim) return;
      onDown(e, 'move');
    });

    clip.addEventListener('pointerenter', (e) => {
      if (mode || this._isPinching || e.pointerType === 'touch') return;
      lastHoverX = e.clientX;
      lastHoverY = e.clientY;
      const edge = detectEdgeHover(e);
      clip.classList.toggle('hover-trim-left', edge === 'left');
      clip.classList.toggle('hover-trim-right', edge === 'right');
      clip.style.cursor = layer.locked ? 'not-allowed' : (edge ? 'ew-resize' : 'grab');
      scheduleHoverTooltip(edge);
    });

    clip.addEventListener('pointerleave', () => {
      if (!mode) clearHoverState();
    });

    clip.addEventListener('pointermove', (e) => {
      if (!mode) {
        if (this._isPinching || e.pointerType === 'touch') return;
        const edge = detectEdgeHover(e);
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
        return;
      }

      if (this._isPinching || this.activePointers.size >= 2) return;
      this._cancelHoverTooltip();
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      this._updateModifierHeld(Boolean(e.altKey || e.shiftKey), true);
      applyDragStep(lastClientX, lastClientY, false);
    });

    const onEnd = (e) => {
      cancelLongPress();
      this._activeClipAbort = null;
      stopActiveGestureLoops();
      this._hideTooltip('drag');
      clip.classList.remove('mf-clip-dragging-reorder', 'is-fine-slide');
      clearDropHighlights();
      if (e?.pointerId !== undefined) {
        try {
          if (clip.hasPointerCapture?.(e.pointerId)) clip.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (longPressTriggered) {
        longPressTriggered = false;
        mode = null;
        return;
      }

      if (mode === 'move' && pendingDrop && pushedUndo) {
        const d = pendingDrop;
        pendingDrop = null;
        mode = null;
        if (origMainSnapshot) {
          for (const snap of origMainSnapshot) {
            snap.layer.startFrame = snap.startFrame;
            snap.layer.endFrame = snap.endFrame;
            snap.layer.mediaOffsetFrames = snap.mediaOffsetFrames;
            snap.layer.keyframes = JSON.parse(JSON.stringify(snap.keyframes));
          }
        }
        this.cb.onDropClipInTimeline?.(layer.id, d);
        return;
      }

      if (mode === 'move' && isMainMagnetic && pushedUndo && (!multiGroupSnapshot || multiGroupSnapshot.length <= 1)) {
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

      if (mode && pushedUndo) {
        this.cb.onCommitTimelineChange();
      }
      mode = null;
    };
    clip.addEventListener('pointerup', onEnd);
    clip.addEventListener('pointercancel', onEnd);
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
