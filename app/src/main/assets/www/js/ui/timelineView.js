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
  group: 'bi-collection text-light'
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

export class TimelineView {
  constructor(callbacks) {
    this.cb = callbacks;
    this.pxPerFrame = 1.15; // Default overview (~34.5 px/s @ 30fps): 0s, 5s, 10s...; zoom reveals 1s..10s then frames
    this.scrollEl = document.getElementById('timelineScroll');
    this.contentEl = document.getElementById('timelineContent');
    this.rulerCanvas = document.getElementById('rulerCanvas');
    this.headersList = document.getElementById('trackHeadersList');
    this.lanesList = document.getElementById('trackLanesList');
    this.playheadEl = document.getElementById('playheadLine');
    this.layerCountEl = document.getElementById('lblLayerCount');
    this.btnGroupChecked = document.getElementById('btnGroupChecked');
    this.dragTooltipEl = document.getElementById('timelineDragTooltip');

    this.checkedLayerIds = new Set();
    this.activePointers = new Map();
    this.pinchStartDist = null;
    this.pinchStartPx = this.pxPerFrame;
    this.pinchPivotFrame = 0;
    this.pinchPivotScreenX = 0;
    this._pendingScrollLeft = null;
    this._lastRulerParams = null;
    this._lastBeatMarkers = [];
    this._lastDrawnScrollLeft = -1;
    this.isScrubbing = false;
    this.filmstripCache = new Map(); // mediaId -> HTMLCanvasElement strip | 'loading'
    this._waveEntries = [];
    this._filmstripEntries = [];
    this._lastRenderContext = null;

    this.bindRulerAndScroll();
    this.bindPinchZoom();
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
    this._setZoomAnchored(this.pxPerFrame * 1.55, anchorFrame);
  }

  zoomOut(anchorFrame = null) {
    this._setZoomAnchored(this.pxPerFrame / 1.55, anchorFrame);
  }

  bindPinchZoom() {
    this.scrollEl.addEventListener('pointerdown', (e) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchStartPx = this.pxPerFrame;
        const rect = this.scrollEl.getBoundingClientRect();
        const midScreenX = Math.max(0, ((pts[0].x + pts[1].x) * 0.5) - rect.left);
        this.pinchPivotScreenX = midScreenX;
        this.pinchPivotFrame = (this.scrollEl.scrollLeft + midScreenX) / Math.max(MIN_PX_PER_FRAME, this.pxPerFrame);
      }
    });
    this.scrollEl.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size === 2 && this.pinchStartDist > 10) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const ratio = dist / this.pinchStartDist;
        this._setZoomAnchored(this.pinchStartPx * ratio, this.pinchPivotFrame, this.pinchPivotScreenX);
        this.cb.onPinchZoom();
      }
    });
    const endPtr = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) this.pinchStartDist = null;
    };
    this.scrollEl.addEventListener('pointerup', endPtr);
    this.scrollEl.addEventListener('pointercancel', endPtr);
  }

  bindRulerAndScroll() {
    this.scrollEl.addEventListener('scroll', () => {
      this.headersList.scrollTop = this.scrollEl.scrollTop;
      if (this._lastRulerParams && Math.abs(this.scrollEl.scrollLeft - this._lastDrawnScrollLeft) >= 1) {
        this.redrawRulerOnly();
        this.redrawVisibleClipCanvases();
      }
    });
    this.headersList.addEventListener('scroll', () => {
      this.scrollEl.scrollTop = this.headersList.scrollTop;
    });

    let scrubbing = false;
    const seekFromPointer = (clientX, showTip = false) => {
      const rect = this.scrollEl.getBoundingClientRect();
      // Gentle horizontal auto-scroll if finger drags near left/right edges
      if (showTip) {
        if (clientX > rect.right - 26) {
          this.scrollEl.scrollLeft += Math.min(24, (clientX - (rect.right - 26)) * 0.5);
        } else if (clientX < rect.left + 26 && this.scrollEl.scrollLeft > 0) {
          this.scrollEl.scrollLeft = Math.max(0, this.scrollEl.scrollLeft - Math.min(24, ((rect.left + 26) - clientX) * 0.5));
        }
      }
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

    const startScrub = (targetEl, e, showTip) => {
      e.stopPropagation();
      e.preventDefault();
      scrubbing = true;
      this.isScrubbing = true;
      this.playheadEl?.classList.add('dragging');
      targetEl.setPointerCapture(e.pointerId);
      this.cb.onScrubStart?.();
      seekFromPointer(e.clientX, showTip);
    };

    const moveScrub = (e, showTip) => {
      if (!scrubbing) return;
      seekFromPointer(e.clientX, showTip);
    };

    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing = false;
      this.isScrubbing = false;
      this.playheadEl?.classList.remove('dragging');
      this.dragTooltipEl?.classList.add('d-none');
      this.cb.onScrubEnd?.();
    };

    this.rulerCanvas.addEventListener('pointerdown', (e) => startScrub(this.rulerCanvas, e, false));
    this.rulerCanvas.addEventListener('pointermove', (e) => moveScrub(e, false));
    this.rulerCanvas.addEventListener('pointerup', endScrub);
    this.rulerCanvas.addEventListener('pointercancel', endScrub);

    if (this.playheadEl) {
      this.playheadEl.addEventListener('pointerdown', (e) => startScrub(this.playheadEl, e, true));
      this.playheadEl.addEventListener('pointermove', (e) => moveScrub(e, true));
      this.playheadEl.addEventListener('pointerup', endScrub);
      this.playheadEl.addEventListener('pointercancel', endScrub);
    }

    // CapCut behavior: tapping empty timeline space deselects active clip -> returns to Root Toolbar
    let bgDownX = 0;
    let bgDownY = 0;
    let bgTracking = false;
    this.scrollEl.addEventListener('pointerdown', (e) => {
      if (
        e.target.closest('.mf-clip') ||
        e.target.closest('.mf-kf-diamond') ||
        e.target.closest('#playheadLine') ||
        e.target === this.rulerCanvas
      ) {
        bgTracking = false;
        return;
      }
      bgTracking = true;
      bgDownX = e.clientX;
      bgDownY = e.clientY;
    });
    this.scrollEl.addEventListener('pointerup', (e) => {
      if (!bgTracking) return;
      bgTracking = false;
      if (this.activePointers.size > 1) return;
      if (Math.hypot(e.clientX - bgDownX, e.clientY - bgDownY) <= 8) {
        this.cb.onSelectLayer(null);
      }
    });
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
    this._lastBeatMarkers = Array.isArray(project.beatMarkers) ? project.beatMarkers : [];

    this.drawRuler(totalWidth, fps, totalFrames);
    this.updatePlayhead(currentFrame);
    this.renderHeadersAndLanes(project, selectedLayerId, audioEngine, mediaMap);
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

    const spec = computeRulerLodSpec(this.pxPerFrame, safeFps);
    const minorStep = Math.max(1, spec.minorFrames);
    const startFrame = Math.max(0, Math.floor((scrollLeft - 90) / this.pxPerFrame / minorStep) * minorStep);
    const endFrame = Math.min(totalFrames, Math.ceil((scrollLeft + viewportW + 90) / this.pxPerFrame));

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    let lastLabelRight = -100;

    for (let f = startFrame; f <= endFrame; f += minorStep) {
      const localX = f * this.pxPerFrame - scrollLeft;
      if (localX < -80 || localX > viewportW + 80) continue;
      const x = Math.round(localX) + 0.5;

      const isMajor = f % spec.majorFrames === 0;
      const isSecond = f % safeFps === 0;
      const isLabelTick = f % spec.labelFrames === 0;

      ctx.strokeStyle = isMajor ? '#587099' : isSecond ? '#435370' : '#263147';
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 10 : isSecond ? 13 : isLabelTick ? 16 : 21);
      ctx.lineTo(x, 28);
      ctx.stroke();

      if (isLabelTick && x > lastLabelRight + 6) {
        const label = formatRulerLabel(f, safeFps);
        const tw = ctx.measureText(label).width;
        const isMinute = isSecond && ((f / safeFps) % 60 === 0) && f > 0;
        ctx.fillStyle = isMinute ? '#00e5ff' : isMajor || isSecond ? '#d3dceb' : '#7f8da6';
        ctx.fillText(label, x + 3, 2);
        lastLabelRight = x + 3 + tw;
      }
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

  renderHeadersAndLanes(project, selectedLayerId, audioEngine, mediaMap = null) {
    this.headersList.innerHTML = '';
    this.lanesList.innerHTML = '';

    if (project.layers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-secondary small p-3';
      empty.textContent = 'Tap Media or Add below to insert clips or motion layers.';
      this.lanesList.appendChild(empty);
      return;
    }

    this._waveEntries = [];
    this._filmstripEntries = [];
    this._lastRenderContext = { project, audioEngine, mediaMap };

    const junctions = TimelineEngine.findTransitionJunctions(project);
    const junctionByLeftId = new Map(junctions.map((j) => [j.leftId, j]));

    project.layers.forEach((layer, layerIndex) => {
      const isSelected = layer.id === selectedLayerId;
      const isChecked = this.checkedLayerIds.has(layer.id);

      // Left Header Item
      const hdr = document.createElement('div');
      hdr.className = `mf-track-header-item d-flex align-items-center justify-content-between ${isSelected ? 'selected' : ''} ${layer.parentId ? 'child-layer' : ''}`;
      hdr.dataset.index = String(layerIndex);
      hdr.innerHTML = `
        <div class="d-flex align-items-center gap-1 min-w-0 flex-grow-1">
          <span class="mf-drag-handle" title="Drag to Reorder"><i class="bi bi-grip-vertical"></i></span>
          ${layer.type !== 'group' ? `<input type="checkbox" class="form-check-input m-0 flex-shrink-0" style="width:12px;height:12px;" ${isChecked ? 'checked' : ''} aria-label="Select for Group" />` : ''}
          <i class="bi ${LAYER_ICONS[layer.type] || 'bi-layers'} small flex-shrink-0"></i>
          <span class="mf-track-title">${this.escapeHtml(layer.name)}</span>
        </div>
        <div class="d-flex align-items-center flex-shrink-0">
          <button class="mf-mini-btn ${layer.visible ? 'on' : ''}" data-act="vis" title="Visibility">
            <i class="bi ${layer.visible ? 'bi-eye-fill' : 'bi-eye-slash'}"></i>
          </button>
          <button class="mf-mini-btn ${layer.locked ? 'locked' : ''}" data-act="lock" title="Lock">
            <i class="bi ${layer.locked ? 'bi-lock-fill' : 'bi-unlock'}"></i>
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

      // Drag handle reorder vertically
      const dragHandle = hdr.querySelector('.mf-drag-handle');
      let draggingRow = false;
      let startY = 0;
      dragHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        draggingRow = true;
        startY = e.clientY;
        dragHandle.setPointerCapture(e.pointerId);
      });
      dragHandle.addEventListener('pointermove', (e) => {
        if (!draggingRow) return;
        const deltaRows = Math.round((e.clientY - startY) / 44);
        const targetIdx = Math.max(0, Math.min(project.layers.length - 1, layerIndex + deltaRows));
        this.headersList.querySelectorAll('.mf-track-header-item').forEach((el, idx) => {
          el.classList.toggle('drag-over', idx === targetIdx && idx !== layerIndex);
        });
      });
      const finishReorder = (e) => {
        if (!draggingRow) return;
        draggingRow = false;
        const deltaRows = Math.round((e.clientY - startY) / 44);
        this.headersList.querySelectorAll('.mf-track-header-item').forEach((el) => el.classList.remove('drag-over'));
        if (deltaRows !== 0) {
          const targetIdx = Math.max(0, Math.min(project.layers.length - 1, layerIndex + deltaRows));
          this.cb.onReorderLayerToIndex(layer.id, targetIdx);
        }
      };
      dragHandle.addEventListener('pointerup', finishReorder);
      dragHandle.addEventListener('pointercancel', finishReorder);

      hdr.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'vis') this.cb.onToggleVisibility(layer.id);
          if (act === 'lock') this.cb.onToggleLock(layer.id);
          return;
        }
        this.cb.onSelectLayer(layer.id);
      });
      this.headersList.appendChild(hdr);

      // Right Lane (empty lane tap bubbles to scrollEl to deselect active clip)
      const lane = document.createElement('div');
      lane.className = `mf-track-lane ${isSelected ? 'selected' : ''}`;

      const leftPx = layer.startFrame * this.pxPerFrame;
      const widthPx = Math.max(24, (layer.endFrame - layer.startFrame) * this.pxPerFrame);

      const clip = document.createElement('div');
      clip.className = `mf-clip mf-clip-${layer.type} ${isSelected ? 'selected' : ''}`;
      clip.style.left = `${leftPx}px`;
      clip.style.width = `${widthPx}px`;

      let filmEntry = null;
      if ((layer.type === 'video' || layer.type === 'image') && layer.mediaId && mediaMap) {
        const mItem = mediaMap.get(layer.mediaId);
        const tiles = mItem ? this._ensureFilmstripTile(mItem) : null;
        if (tiles && tiles.length > 0) {
          const fCanvas = document.createElement('canvas');
          fCanvas.className = 'mf-clip-filmstrip';
          clip.appendChild(fCanvas);
          filmEntry = { canvas: fCanvas, tiles, leftPx, widthPx, renderedStart: -1, renderedEnd: -1 };
          this._filmstripEntries.push(filmEntry);
          this._paintFilmstripEntry(filmEntry, true);
        }
      }

      let waveEntry = null;
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
          const wCanvas = document.createElement('canvas');
          wCanvas.className = 'mf-clip-wave';
          clip.appendChild(wCanvas);
          waveEntry = {
            canvas: wCanvas,
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

      const label = document.createElement('span');
      label.className = 'mf-clip-label';
      const tags = [];
      if (layer.speed && layer.speed !== 1) tags.push(`${layer.speed.toFixed(2)}x`);
      if (layer.speedCurve && layer.speedCurve !== 'none') tags.push('⚡');
      if (layer.reversed) tags.push('⇄');
      if (layer.isFreezeFrame) tags.push('❄');
      if (layer.trackData?.points?.length) tags.push('⊕');
      const suffix = tags.length > 0 ? ` (${tags.join(' ')})` : '';
      label.textContent = `${layer.name}${suffix}`;
      clip.appendChild(label);

      // Draggable Keyframe diamonds inside clip
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
        }
      });

      const leftTrim = document.createElement('div');
      leftTrim.className = 'mf-trim-handle left';
      const rightTrim = document.createElement('div');
      rightTrim.className = 'mf-trim-handle right';
      clip.appendChild(leftTrim);
      clip.appendChild(rightTrim);

      this.bindClipGestures(clip, leftTrim, rightTrim, project, layer, waveEntry, filmEntry);
      lane.appendChild(clip);

      const junc = junctionByLeftId.get(layer.id);
      if (junc) {
        const seamBtn = document.createElement('button');
        seamBtn.type = 'button';
        const hasTr = junc.type && junc.type !== 'none';
        seamBtn.className = `mf-trans-seam-btn ${hasTr ? 'has-trans' : ''}`;
        seamBtn.style.left = `${junc.seamFrame * this.pxPerFrame}px`;
        seamBtn.title = hasTr
          ? `Transition (${junc.type}) between ${junc.left.name} & ${junc.right.name}`
          : `Add transition between ${junc.left.name} & ${junc.right.name}`;
        seamBtn.setAttribute('aria-label', seamBtn.title);
        seamBtn.innerHTML = hasTr ? `<i class="bi bi-intersect"></i>` : `<i class="bi bi-plus-slash-minus"></i>`;
        seamBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        seamBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.onOpenTransitionJunction?.(junc.leftId, junc.rightId);
        });
        lane.appendChild(seamBtn);
      }

      this.lanesList.appendChild(lane);
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

  bindClipGestures(clip, leftTrim, rightTrim, project, layer, waveEntry = null, filmEntry = null) {
    let mode = null;
    let startX = 0;
    let origStart = 0;
    let origEnd = 0;
    let origMediaOffset = 0;
    let origKeyframes = null;
    let pushedUndo = false;

    const onDown = (e, hitMode) => {
      if (e.target.classList.contains('mf-kf-diamond')) return;
      e.stopPropagation();
      this.cb.onSelectLayer(layer.id);
      if (layer.locked) return;
      mode = hitMode;
      startX = e.clientX;
      origStart = layer.startFrame;
      origEnd = layer.endFrame;
      origMediaOffset = layer.mediaOffsetFrames || 0;
      origKeyframes = JSON.parse(JSON.stringify(layer.keyframes || {}));
      pushedUndo = false;
      clip.setPointerCapture(e.pointerId);
    };

    leftTrim.addEventListener('pointerdown', (e) => onDown(e, 'left'));
    rightTrim.addEventListener('pointerdown', (e) => onDown(e, 'right'));
    clip.addEventListener('pointerdown', (e) => {
      if (e.target === leftTrim || e.target === rightTrim) return;
      onDown(e, 'move');
    });

    clip.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) < 3 && !pushedUndo) return;
      if (!pushedUndo) {
        this.cb.onPushUndo();
        pushedUndo = true;
      }
      const deltaFrames = Math.round(dx / this.pxPerFrame);

      if (mode === 'move') {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.keyframes = JSON.parse(JSON.stringify(origKeyframes));
        TimelineEngine.moveClip(
          project,
          layer.id,
          origStart + deltaFrames,
          Boolean(project.settings?.snapToTimeline),
          this.cb.getPlayheadFrame()
        );
      } else if (mode === 'left') {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.mediaOffsetFrames = origMediaOffset;
        TimelineEngine.trimClip(
          project,
          layer.id,
          'left',
          origStart + deltaFrames,
          Boolean(project.settings?.snapToTimeline),
          this.cb.getPlayheadFrame()
        );
      } else if (mode === 'right') {
        layer.startFrame = origStart;
        layer.endFrame = origEnd;
        layer.mediaOffsetFrames = origMediaOffset;
        TimelineEngine.trimClip(
          project,
          layer.id,
          'right',
          origEnd + deltaFrames,
          Boolean(project.settings?.snapToTimeline),
          this.cb.getPlayheadFrame()
        );
      }

      const nextLeftPx = layer.startFrame * this.pxPerFrame;
      const nextWidthPx = Math.max(24, (layer.endFrame - layer.startFrame) * this.pxPerFrame);
      clip.style.left = `${nextLeftPx}px`;
      clip.style.width = `${nextWidthPx}px`;

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

      if (this.dragTooltipEl) {
        const fps = Math.max(1, project.fps || 30);
        const durF = Math.max(0, layer.endFrame - layer.startFrame);
        const startS = (layer.startFrame / fps).toFixed(2);
        const durS = (durF / fps).toFixed(2);
        const offsetInfo = mode === 'left'
          ? ` · Offset ${((layer.mediaOffsetFrames || 0) / fps).toFixed(2)}s`
          : '';
        this.dragTooltipEl.textContent = `${startS}s → ${(layer.endFrame / fps).toFixed(2)}s · Dur ${durS}s (${durF}f)${offsetInfo}`;
        this.dragTooltipEl.classList.remove('d-none');
      }
      this.cb.onPreviewRefresh();
    });

    const onEnd = () => {
      this.dragTooltipEl?.classList.add('d-none');
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
