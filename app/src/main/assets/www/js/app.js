import { AudioEngine } from './engine/audioEngine.js';
import {
  PIP_LAYOUT_PRESETS,
  SFX_PACK,
  TEXT_TEMPLATES,
  parseSrtOrLyrics,
  renderStickerPngDataUrl,
  synthesizeSfxWavDataUrl
} from './engine/capcutCatalog.js';
import { KEYFRAME_LANE_GROUPS, KeyframeEngine } from './engine/keyframeEngine.js';
import { RendererEngine } from './engine/rendererEngine.js';
import { StabilizerEngine } from './engine/stabilizerEngine.js';
import { TimelineEngine } from './engine/timelineEngine.js';
import { TrackerEngine } from './engine/trackerEngine.js';
import { ColorMatchEngine } from './engine/colorMatchEngine.js';
import { ExportEngine } from './export/exportEngine.js';
import { WasmBridge } from './engine/wasmBridge.js';
import {
  HistoryManager,
  ProjectStorage,
  createEmptyProject,
  deserializeProject,
  serializeProject
} from './storage/projectStorage.js';
import { PanelsUI } from './ui/panels.js';
import { TimelineView } from './ui/timelineView.js';
import { formatTimecode } from './utils/math.js';

class MotionFlowApp {
  constructor() {
    this.project = createEmptyProject('Untitled Project');
    this.mediaItems = [];
    this.customFonts = [];
    this.mediaMap = new Map();
    this.selectedLayerId = null;
    this.selectedLayerIds = new Set();
    this.copiedLayers = [];
    this.shuttleRate = 0;
    this.importIntent = 'library';
    this.mediaPickerContext = null;
    this.currentFrame = 0;
    this.isPlaying = false;
    this.rafId = null;
    this.playToken = 0;
    this.lastTickMs = 0;
    this.autosaveTimer = null;
    this._saveSeq = 0;
    this.copiedClipStyle = null;
    this.ttsStatusText = '';
    this._drawMode = 'doodle';
    this._cutoutTargetLayerId = null;
    this._cutoutSourceCanvas = null;
    this._templatePreview = null;

    this.history = new HistoryManager(40);
    this.audioEngine = new AudioEngine();
    this.renderer = new RendererEngine(
      document.getElementById('previewCanvas'),
      document.getElementById('overlayCanvas')
    );
    this.renderer.onMediaFrameReady = () => {
      if (!this.isPlaying) this.renderPreview();
    };
    this.exportEngine = new ExportEngine(this.renderer, this.audioEngine);
    this.trackerEngine = new TrackerEngine(this.renderer);
    this.stabilizerEngine = new StabilizerEngine(this.renderer);
    this.colorMatchEngine = new ColorMatchEngine(this.renderer);
    this.stabilizerState = {
      isStabilizing: false,
      targetLayerId: null,
      level: 'recommended',
      progressPct: 0,
      progressDetail: ''
    };
    this.viewport3D = {
      enabled: false,
      tool: 'move', // 'move' | 'rotate' | 'scale' | 'camera'
      autoRecord: true
    };
    this.renderer.setViewport3DState(this.viewport3D);
    this.trackerState = {
      active: false,
      isTracking: false,
      dragging: false,
      followTrackedPoints: false,
      sourceLayerId: null,
      targetX: 0,
      targetY: 0,
      patchRadius: 28,
      searchRadius: 95,
      trackScale: true,
      trackTilt3D: true,
      use3DDepth: true,
      exitMode: 'fadeTrim',
      progressPct: 0,
      progressDetail: ''
    };
    this.voiceoverState = {
      recording: false,
      elapsedSec: 0,
      timerId: null,
      statusText: 'Tap Mic to record voiceover at playhead',
      webRecorder: null,
      webChunks: []
    };
    this.panels = new PanelsUI(this);
    this.timelineView = new TimelineView({
      onSeekFrame: (f) => this.seekToFrame(f),
      onScrubStart: () => { if (this.isPlaying) this.pause(); },
      onScrubEnd: () => {
        this.panels.renderInspector();
        this.panels.renderKeyframesPanel();
      },
      onSelectLayer: (id, opts) => this.selectLayer(id, opts),
      onToggleMute: (id) => this.toggleMute(id),
      onToggleVisibility: (id) => this.toggleVisibility(id),
      onToggleLock: (id) => this.toggleLock(id),
      onToggleTrackCompact: (id) => this.toggleTrackCompact(id),
      onPushUndo: () => this.pushUndo(),
      onPreviewRefresh: () => this.renderPreview(),
      onCommitTimelineChange: () => this.onTimelineMutated(),
      onPinchZoom: () => this.refreshTimelineOnly(),
      onReorderLayerToIndex: (id, idx) => this.mutateProject(() => {
        TimelineEngine.moveLayerToIndex(this.project, id, idx);
        TimelineEngine.normalizeTrackZOrder(this.project);
      }),
      onMoveKeyframeFrame: (layerId, oldF, newF) => {
        const layer = this.project.layers.find((l) => l.id === layerId);
        if (!layer) return;
        KeyframeEngine.moveAllKeyframesAtFrame(layer, oldF, newF);
        this.onTimelineMutated();
        this.showToast(`Moved keyframe F${oldF} → F${newF}`);
      },
      onToggleKfExpanded: (layerId) => this.toggleKfExpanded(layerId),
      onTogglePropLaneKeyframe: (layerId, laneKey, frame) => this.togglePropLaneKeyframe(layerId, laneKey, frame),
      onMovePropKeyframe: (layerId, propKeys, oldF, newF) => {
        const layer = this.project.layers.find((l) => l.id === layerId);
        if (!layer) return;
        KeyframeEngine.movePropGroupKeyframe(layer, propKeys, oldF, newF);
        this.onTimelineMutated();
        this.showToast(`Keyframe digeser F${oldF} → F${newF}`);
      },
      onDeletePropKeyframe: (layerId, propKeys, frame) => {
        const layer = this.project.layers.find((l) => l.id === layerId);
        if (!layer) return;
        this.mutateProject(() => KeyframeEngine.removePropGroupKeyframe(layer, propKeys, frame));
        this.showToast(`Keyframe F${frame} dihapus`);
      },
      onSetPropKeyframeEasing: (layerId, propKeys, frame, easing) => {
        const layer = this.project.layers.find((l) => l.id === layerId);
        if (!layer) return;
        this.mutateProject(() => KeyframeEngine.setPropGroupEasing(layer, propKeys, frame, easing));
      },
      onSetPropKeyframeColor: (layerId, frame, hexColor, easing) => {
        const layer = this.project.layers.find((l) => l.id === layerId);
        if (!layer) return;
        this.mutateProject(() => KeyframeEngine.setKeyframe(layer, 'color', frame, hexColor, easing));
      },
      onFocusKeyframeProp: (layerId, propKey) => {
        this.selectLayer(layerId, { force: true, skipTimelineRender: true });
        if (propKey) this.panels.selectedKfProp = propKey;
        this.openSheet('sheetKeyframes');
      },
      onOpenTransitionJunction: (leftId, rightId) => {
        this.openTransitionsSheet({ mode: 'junction', leftId, rightId, layerId: leftId });
      },
      onReorderMainClipByFrame: (id, centerFrame) => {
        const moved = TimelineEngine.reorderMainTrackClipByFrame(this.project, id, centerFrame);
        if (moved) {
          this.onTimelineMutated();
          this.showToast('Reordered Main Track clip');
        } else {
          this.refreshTimelineOnly();
        }
      },
      onDropClipInTimeline: (id, dropSpec) => {
        const ok = TimelineEngine.dropLayerInTimeline(this.project, id, dropSpec);
        if (ok) {
          this.onTimelineMutated();
          const msg = dropSpec.targetRole === 'main'
            ? 'Moved clip to Main Track'
            : dropSpec.targetRole === 'overlay'
              ? 'Moved clip to Overlay track'
              : 'Moved item in timeline';
          this.showToast(msg);
        } else {
          this.refreshTimelineOnly();
        }
      },
      onToggleRippleMode: () => this.toggleRippleMode(),
      onToggleMainTrackProp: (prop) => this.toggleMainTrackProp(prop),
      onQuickAddMainClip: () => {
        this.mediaPickerContext = null;
        if (this.mediaItems.some((m) => m.type === 'video' || m.type === 'image')) {
          this.openSheet('sheetMedia');
        } else {
          this.triggerDeviceVisualPick('main_append');
        }
      },
      onCloseMainGaps: () => this.closeMainTrackGaps(),
      onSnapBypassChange: (bypassed) => this.updateSnapButtonState(bypassed),
      onToggleMultiSelectLayer: (id) => this.toggleMultiSelectLayer(id),
      onMarqueeSelect: (ids) => this.setMarqueeSelection(ids),
      onOpenClipContextMenu: (id, x, y) => this.openClipContextMenu(id, x, y),
      onResizeTransitionJunction: (leftId, rightId, totalDurFrames) => {
        this.mutateProject(() => TimelineEngine.resizeTransitionJunction(this.project, leftId, rightId, totalDurFrames));
      },
      onClickMarker: (markerObj, x, y) => this.openMarkerColorPopover(markerObj, x, y),
      getPlayheadFrame: () => this.currentFrame
    });

    this.toastInstance = new bootstrap.Toast(document.getElementById('studioToast'), { delay: 2200 });
  }

  async init() {
    WasmBridge.tryInit();
    this.mediaItems = await ProjectStorage.listMediaItems();
    this.rebuildMediaMap();

    this.customFonts = await ProjectStorage.listFontItems();
    for (const f of this.customFonts) {
      await this.registerFontFace(f);
    }

    // Decode waveforms in background for existing audio/video items
    this.mediaItems.forEach((m) => {
      if (m.type === 'audio' || m.type === 'video') {
        this.audioEngine.loadBuffer(m).then(() => this.refreshTimelineOnly());
      }
    });

    const savedProjects = await ProjectStorage.listProjects();
    if (savedProjects.length > 0) {
      this.project = deserializeProject(savedProjects[0]);
    } else {
      // Seed one real, editable starter composition in IndexedDB on first launch
      const starter = createEmptyProject('MotionFlow Demo', { width: 1280, height: 720, fps: 30, durationSec: 6 });
      const bgShape = TimelineEngine.createShapeLayer(starter, 'rectangle', 0);
      bgShape.name = 'Accent Card';
      bgShape.width = 560;
      bgShape.height = 170;
      bgShape.endFrame = 150;
      bgShape.shapeProps.fillColor = '#162038';
      bgShape.shapeProps.strokeColor = '#00E5FF';
      bgShape.shapeProps.strokeWidth = 4;
      bgShape.shapeProps.cornerRadius = 24;
      KeyframeEngine.applyPreset(bgShape, 'zoomIn', starter.width, starter.height, 24);

      const title = TimelineEngine.createTextLayer(starter, 0);
      title.name = 'MotionFlow Title';
      title.endFrame = 150;
      title.textProps.text = 'MOTIONFLOW\nSTUDIO';
      title.textProps.fontSize = 56;
      KeyframeEngine.applyPreset(title, 'fadeIn', starter.width, starter.height, 24);

      TimelineEngine.addLayer(starter, bgShape);
      TimelineEngine.addLayer(starter, title);
      this.project = starter;
      await ProjectStorage.saveProject(this.project);
    }

    if (this.project.layers.length > 0) {
      this.selectedLayerId = this.project.layers[0].id;
      this.selectedLayerIds = new Set([this.selectedLayerId]);
    }

    this.bindUIEvents();
    this.bindOverlayGestures();
    this.bindNativeBridgeCallbacks();

    this.panels.renderMediaLibrary(this.mediaItems);
    this.setSaveState(true);
    this.updateAllUI();
  }

  rebuildMediaMap() {
    this.mediaMap.clear();
    this.mediaItems.forEach((m) => this.mediaMap.set(m.id, m));
  }

  getSelectedLayer() {
    return this.project.layers.find((l) => l.id === this.selectedLayerId) || null;
  }

  showToast(msg) {
    document.getElementById('studioToastMsg').textContent = msg;
    this.toastInstance.show();
  }

  pushUndo() {
    this.history.pushSnapshot(this.project);
    this.updateUndoRedoButtons();
  }

  mutateProject(mutator) {
    this.stopTemplateLivePreview({ skipRender: true });
    this.pushUndo();
    mutator();
    this.onTimelineMutated();
  }

  commitWithoutHistory() {
    this.onTimelineMutated();
  }

  onTimelineMutated() {
    TimelineEngine.normalizeTrackZOrder(this.project);
    if (this.project?.settings?.rippleMode !== false && this.project?.layers?.some((l) => l.trackRole === 'main')) {
      TimelineEngine.reflowMainTrack(this.project, 0);
    }
    this.scheduleAutosave();
    this.updateAllUI();
  }

  setSaveState(isSaved) {
    const badge = document.getElementById('badgeSaveState');
    if (!badge) return;
    badge.classList.toggle('is-saved', Boolean(isSaved));
    badge.classList.toggle('is-unsaved', !isSaved);
    badge.title = isSaved ? 'Saved' : 'Not saved';
    badge.setAttribute('aria-label', isSaved ? 'Saved' : 'Not saved');
  }

  scheduleAutosave() {
    this._saveSeq += 1;
    const seq = this._saveSeq;
    this.setSaveState(false);
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(async () => {
      try {
        await ProjectStorage.saveProject(this.project);
        if (seq === this._saveSeq) {
          this.setSaveState(true);
        }
      } catch (err) {
        console.error('Autosave failed:', err);
        this.setSaveState(false);
      }
    }, 400);
  }

  updateUndoRedoButtons() {
    document.getElementById('btnUndo').disabled = !this.history.canUndo();
    document.getElementById('btnRedo').disabled = !this.history.canRedo();
  }

  updateSnapButtonState(modifierBypass = this.timelineView?._modifierHeld) {
    const snapBtn = document.getElementById('btnToggleSnap');
    if (!snapBtn) return;
    const enabled = Boolean(this.project?.settings?.snapToTimeline);
    const bypassed = enabled && Boolean(modifierBypass);
    snapBtn.classList.toggle('active', enabled);
    snapBtn.classList.toggle('snap-bypassed', bypassed);
    snapBtn.title = bypassed
      ? 'Snapping nonaktif sementara (Modifier ditahan)'
      : enabled
        ? 'Snap: ON (Tahan Alt/Shift/Ctrl saat drag untuk matikan sementara)'
        : 'Snap: OFF';
  }

  updateAllUI() {
    document.getElementById('lblProjectName').textContent = this.project.name;
    document.getElementById('hudResFps').textContent = `${this.project.width}×${this.project.height} · ${this.project.fps} FPS`;
    this.updateSnapButtonState();
    document.getElementById('btnToggleRipple')?.classList.toggle('active', this.project.settings?.rippleMode !== false);
    document.getElementById('btnToggleGrid').classList.toggle('active', Boolean(this.project.settings?.showGrid));
    document.getElementById('btnOpenTrackerQuick')?.classList.toggle('tracking-active', Boolean(this.trackerState.active));
    const btnCompactAll = document.getElementById('btnCompactAllTracks');
    if (btnCompactAll) {
      const hasAnyLayers = this.project.layers.length > 0;
      const singleTracks = this.project.layers.filter((l) => l.trackRole !== 'main');
      const hasMain = this.project.layers.some((l) => l.trackRole === 'main');
      const allCompact = hasAnyLayers &&
        singleTracks.every((l) => Boolean(l.trackCompact)) &&
        (!hasMain || Boolean(this.project.settings?.mainTrackCompact));
      btnCompactAll.classList.toggle('active', allCompact);
      const ic = btnCompactAll.querySelector('i');
      if (ic) ic.className = allCompact ? 'bi bi-arrows-expand' : 'bi bi-arrows-collapse';
    }
    this.syncViewport3DUI();
    this.updateExportSpecPill();

    this.updateUndoRedoButtons();
    this.updateTransportLabels();
    this.timelineView.selectedLayerIds = new Set(this.selectedLayerIds);
    this.timelineView.render(this.project, this.currentFrame, this.selectedLayerId, this.audioEngine, this.mediaMap);
    const totalGroupCount = Math.max(this.timelineView.checkedLayerIds.size, this.selectedLayerIds.size);
    document.getElementById('btnGroupChecked')?.classList.toggle('d-none', totalGroupCount < 2);
    this.renderPreview();
    this.panels.refreshAll();
    this.panels.renderRatioPanel();
    this.renderBottomToolbar();
  }

  refreshTimelineOnly() {
    this.timelineView.selectedLayerIds = new Set(this.selectedLayerIds);
    this.timelineView.render(this.project, this.currentFrame, this.selectedLayerId, this.audioEngine, this.mediaMap);
    const totalGroupCount = Math.max(this.timelineView.checkedLayerIds.size, this.selectedLayerIds.size);
    document.getElementById('btnGroupChecked')?.classList.toggle('d-none', totalGroupCount < 2);
  }

  updateTransportLabels() {
    document.getElementById('lblTimecode').textContent = formatTimecode(this.currentFrame, this.project.fps);
    document.getElementById('lblFrameCounter').textContent = `F ${this.currentFrame} / ${this.project.durationFrames}`;

    const layer = this.getSelectedLayer();
    const hasKf = layer && KeyframeEngine.hasAnyKeyframeAtFrame(layer, this.currentFrame);
    const kfBtn = document.getElementById('btnQuickKeyframe');
    kfBtn.classList.toggle('active', Boolean(hasKf));
    kfBtn.querySelector('i').className = hasKf ? 'bi bi-diamond-fill' : 'bi bi-diamond';
  }

  renderPreview() {
    if (this._templatePreview?.active && this._templatePreview.previewProject) {
      this.renderer.renderFrame(
        this._templatePreview.previewProject,
        this._templatePreview.previewFrame,
        this.mediaMap,
        this.selectedLayerId
      );
      return;
    }
    this.renderer.renderFrame(this.project, this.currentFrame, this.mediaMap, this.selectedLayerId);
  }

  stopTemplateLivePreview(opts = {}) {
    const prev = this._templatePreview;
    if (!prev) return;
    if (prev.rafId) cancelAnimationFrame(prev.rafId);
    this._templatePreview = null;
    if (!opts.skipRender && !this.isPlaying) {
      this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, false).catch(() => {});
      this.renderPreview();
    }
  }

  startTemplateLivePreview(spec) {
    this.stopTemplateLivePreview({ skipRender: true });
    if (!spec || !this.project) return false;
    if (this.isPlaying) this.pause();

    const cloneObj = (o) => (o ? JSON.parse(JSON.stringify(o)) : {});
    const cloneLayer = (l) => ({
      ...l,
      transform: { ...(l.transform || {}) },
      keyframes: cloneObj(l.keyframes || {}),
      transitions: { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15, ...(l.transitions || {}) }
    });

    const previewProject = {
      ...this.project,
      layers: this.project.layers.map((l) => l)
    };
    const fps = Math.max(1, previewProject.fps || 30);
    let winStart = this.currentFrame;
    let winEnd = this.currentFrame + 24;

    if (spec.kind === 'animation') {
      const targetId = spec.layerId || this.selectedLayerId;
      const idx = previewProject.layers.findIndex((l) => l.id === targetId);
      if (idx === -1) return false;
      const orig = previewProject.layers[idx];
      if (!orig || orig.type === 'audio' || orig.type === 'group') return false;

      const cloned = cloneLayer(orig);
      previewProject.layers[idx] = cloned;
      const durF = Math.max(6, Math.min(180, Number(spec.durationFrames) || 24));
      KeyframeEngine.applyPreset(
        cloned,
        spec.presetId,
        previewProject.width || 1280,
        previewProject.height || 720,
        durF
      );
      const cat = KeyframeEngine.getPresetCategory(spec.presetId);
      if (cat === 'in') {
        winStart = cloned.startFrame;
        winEnd = Math.min(cloned.endFrame, cloned.startFrame + durF + 4);
      } else if (cat === 'out') {
        winEnd = cloned.endFrame;
        winStart = Math.max(cloned.startFrame, cloned.endFrame - durF - 4);
      } else {
        winStart = cloned.startFrame;
        const loopCap = Math.min(90, Math.max(durF + 6, cloned.endFrame - cloned.startFrame));
        winEnd = Math.min(cloned.endFrame, cloned.startFrame + loopCap);
      }
    } else if (spec.kind === 'transition') {
      const tgt = spec.target || {};
      const typeId = spec.typeId || 'none';
      const durF = Math.max(4, Math.min(120, Number(spec.durationFrames) || 18));
      const hasJunction = tgt.mode === 'junction' && tgt.leftId && tgt.rightId;
      if (hasJunction) {
        const lIdx = previewProject.layers.findIndex((l) => l.id === tgt.leftId);
        const rIdx = previewProject.layers.findIndex((l) => l.id === tgt.rightId);
        if (lIdx === -1 || rIdx === -1) return false;
        const leftClone = cloneLayer(previewProject.layers[lIdx]);
        const rightClone = cloneLayer(previewProject.layers[rIdx]);
        previewProject.layers[lIdx] = leftClone;
        previewProject.layers[rIdx] = rightClone;
        TimelineEngine.applyTransitionBetweenClips(previewProject, tgt.leftId, tgt.rightId, typeId, durF);
        const seam = Math.round((leftClone.endFrame + rightClone.startFrame) / 2);
        const halfSpan = Math.ceil(durF * 0.7) + 4;
        winStart = Math.max(leftClone.startFrame, seam - halfSpan);
        winEnd = Math.min(rightClone.endFrame, seam + halfSpan);
      } else {
        const targetId = tgt.layerId || this.selectedLayerId;
        const idx = previewProject.layers.findIndex((l) => l.id === targetId);
        if (idx === -1) return false;
        const orig = previewProject.layers[idx];
        if (!orig || orig.type === 'audio' || orig.type === 'group') return false;
        const cloned = cloneLayer(orig);
        previewProject.layers[idx] = cloned;
        if (tgt.mode === 'out') {
          cloned.transitions.outType = typeId;
          cloned.transitions.outFrames = durF;
          winEnd = cloned.endFrame;
          winStart = Math.max(cloned.startFrame, cloned.endFrame - durF - 4);
        } else {
          cloned.transitions.inType = typeId;
          cloned.transitions.inFrames = durF;
          winStart = cloned.startFrame;
          winEnd = Math.min(cloned.endFrame, cloned.startFrame + durF + 4);
        }
      }
    } else {
      return false;
    }

    if (winEnd <= winStart) winEnd = winStart + 1;
    const span = winEnd - winStart;
    const token = (this._templatePreviewToken = (this._templatePreviewToken || 0) + 1);
    const state = {
      active: true,
      token,
      previewProject,
      previewFrame: winStart,
      rafId: null
    };
    this._templatePreview = state;

    const frameMs = 1000 / fps;
    const holdMs = 340;
    const cycleMs = span * frameMs + holdMs;
    const startMs = performance.now();
    let lastSeekFrame = -9999;

    const step = (now) => {
      if (!this._templatePreview || this._templatePreview.token !== token) return;
      const elapsedInCycle = (now - startMs) % Math.max(200, cycleMs);
      const rawStep = elapsedInCycle / frameMs;
      const curF = Math.min(winEnd, Math.round(winStart + Math.min(span, rawStep)));
      state.previewFrame = curF;
      if (Math.abs(curF - lastSeekFrame) >= 2) {
        lastSeekFrame = curF;
        this.renderer.seekVideosForFrame(previewProject, curF, this.mediaMap, false).catch(() => {});
      }
      this.renderer.renderFrame(previewProject, curF, this.mediaMap, this.selectedLayerId);
      state.rafId = requestAnimationFrame(step);
    };

    this.renderer.seekVideosForFrame(previewProject, winStart, this.mediaMap, false).catch(() => {});
    this.renderer.renderFrame(previewProject, winStart, this.mediaMap, this.selectedLayerId);
    state.rafId = requestAnimationFrame(step);
    return true;
  }

  async seekToFrame(frame) {
    this.stopTemplateLivePreview({ skipRender: true });
    const token = (this._seekVersion = (this._seekVersion || 0) + 1);
    const clamped = Math.max(0, Math.min(this.project.durationFrames, Math.round(frame)));
    this.currentFrame = clamped;
    this.timelineView.updatePlayhead(this.currentFrame);
    this.updateTransportLabels();
    if (this.isPlaying && this.shuttleRate > 0) {
      this.renderer.syncVideoPlayback(this.project, this.currentFrame, this.mediaMap, true, this.shuttleRate);
    } else {
      await this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, false);
    }
    if (token !== this._seekVersion) return;
    this.renderPreview();
    if (this.isPlaying) {
      this.audioEngine.startPlayback(this.project, this.currentFrame, this.mediaMap);
    }
    if (!this.timelineView.isScrubbing) {
      this.panels.renderInspector();
      this.panels.renderKeyframesPanel();
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play(rate = 1) {
    const absRate = Math.max(1, Math.min(4, Math.abs(Number(rate) || 1)));
    const dir = Number(rate) < 0 ? -1 : 1;
    this.shuttleRate = dir * absRate;
    if (this.isPlaying) {
      if (this.shuttleRate !== 1) this.audioEngine.stopAll();
      this.renderer.syncVideoPlayback(this.project, this.currentFrame, this.mediaMap, true, this.shuttleRate);
      return;
    }
    this.stopTemplateLivePreview({ skipRender: true });
    if (dir > 0 && this.currentFrame >= this.project.durationFrames) {
      this.currentFrame = 0;
    } else if (dir < 0 && this.currentFrame <= 0) {
      this.currentFrame = this.project.durationFrames;
    }
    this.isPlaying = true;
    const token = ++this.playToken;
    document.getElementById('iconPlayPause').className = 'bi bi-pause-fill';
    this.lastTickMs = performance.now();
    if (this.shuttleRate === 1) {
      this.audioEngine.startPlayback(this.project, this.currentFrame, this.mediaMap);
    }
    if (this.shuttleRate > 0) {
      this.renderer.syncVideoPlayback(this.project, this.currentFrame, this.mediaMap, true, this.shuttleRate);
    } else {
      this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, false).catch(() => {});
    }
    this.renderPreview();

    const frameIntervalMs = 1000 / (this.project.fps || 30);
    let ticking = false;
    const tick = async (now) => {
      if (!this.isPlaying || token !== this.playToken) return;
      if (ticking) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - this.lastTickMs;
      if (elapsed >= frameIntervalMs) {
        ticking = true;
        try {
          const advance = Math.min(6, Math.floor(elapsed / frameIntervalMs)) * this.shuttleRate;
          this.lastTickMs = now - (elapsed % frameIntervalMs);
          this.currentFrame += advance;
          if (this.currentFrame >= this.project.durationFrames) {
            this.currentFrame = 0;
            if (this.shuttleRate === 1) {
              this.audioEngine.startPlayback(this.project, 0, this.mediaMap);
            }
          } else if (this.currentFrame <= 0) {
            this.currentFrame = 0;
            this.pause();
            this.timelineView.updatePlayhead(0);
            this.updateTransportLabels();
            this.renderPreview();
            return;
          }
          this.timelineView.updatePlayhead(this.currentFrame);
          this.updateTransportLabels();
          if (this.shuttleRate > 0) {
            this.renderer.syncVideoPlayback(this.project, this.currentFrame, this.mediaMap, true, this.shuttleRate);
          } else {
            await this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, false);
          }
          if (!this.isPlaying || token !== this.playToken) return;
          this.renderPreview();
        } finally {
          ticking = false;
        }
      }
      if (this.isPlaying && token === this.playToken) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    this.isPlaying = false;
    this.shuttleRate = 0;
    this.playToken++;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.audioEngine.stopAll();
    this.renderer.syncVideoPlayback(this.project, this.currentFrame, this.mediaMap, false, 0);
    document.getElementById('iconPlayPause').className = 'bi bi-play-fill';
    this.renderPreview();
  }

  setShuttlePlay(dir) {
    if (dir === 0) {
      this.pause();
      this.showToast('Shuttle Pause (K)');
      return;
    }
    const curDir = this.shuttleRate < 0 ? -1 : this.shuttleRate > 0 ? 1 : 0;
    const curMag = Math.abs(this.shuttleRate || 0);
    const nextMag = (this.isPlaying && curDir === dir)
      ? (curMag >= 4 ? 1 : curMag === 2 ? 4 : 2)
      : 1;
    const nextRate = dir * nextMag;
    this.play(nextRate);
    this.showToast(`Shuttle ${nextRate > 0 ? `+${nextRate}x` : `${nextRate}x`}`);
  }

  jumpCutPoint(dir = 1) {
    const cuts = TimelineEngine.getCutPointFrames(this.project);
    if (!cuts.length) return;
    const cur = Math.round(this.currentFrame);
    let target = cur;
    if (dir > 0) {
      const next = cuts.find((f) => f > cur + 1);
      target = next !== undefined ? next : cuts[cuts.length - 1];
    } else {
      for (let i = cuts.length - 1; i >= 0; i--) {
        if (cuts[i] < cur - 1) {
          target = cuts[i];
          break;
        }
      }
      if (target === cur) target = 0;
    }
    this.pause();
    this.seekToFrame(target);
    this.showToast(`Cut Point @ F${target}`);
  }

  selectLayer(layerId, opts = {}) {
    if (this.selectedLayerId === layerId && !opts.force) return;
    this.selectedLayerId = layerId;
    if (!opts.preserveMulti) {
      this.selectedLayerIds = layerId ? new Set([layerId]) : new Set();
    }
    if (opts.skipTimelineRender) {
      this.updateTransportLabels();
      this.renderPreview();
      this.panels.refreshAll();
      this.panels.renderRatioPanel();
      this.renderBottomToolbar();
      return;
    }
    this.updateAllUI();
  }

  toggleMultiSelectLayer(layerId) {
    if (!layerId) return;
    if (!this.selectedLayerIds || this.selectedLayerIds.size === 0) {
      this.selectedLayerIds = new Set(this.selectedLayerId ? [this.selectedLayerId] : []);
    }
    if (this.selectedLayerIds.has(layerId)) {
      this.selectedLayerIds.delete(layerId);
      if (this.selectedLayerId === layerId) {
        this.selectedLayerId = [...this.selectedLayerIds][0] || null;
      }
    } else {
      this.selectedLayerIds.add(layerId);
      this.selectedLayerId = layerId;
    }
    this.updateAllUI();
  }

  setMarqueeSelection(ids) {
    const clean = Array.isArray(ids) ? ids.filter((id) => this.project.layers.some((l) => l.id === id)) : [];
    this.selectedLayerIds = new Set(clean);
    this.selectedLayerId = clean[0] || null;
    this.updateAllUI();
    if (clean.length >= 2) {
      this.showToast(`Selected ${clean.length} clips`);
    }
  }

  toggleMute(layerId) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    this.mutateProject(() => {
      if (!l.audioProps) {
        l.audioProps = {
          volume: 1.0,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          muted: false,
          voiceEffect: 'none',
          reduceNoise: false,
          normalize: false
        };
      }
      l.audioProps.muted = !l.audioProps.muted;
    });
  }

  toggleVisibility(layerId) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    this.mutateProject(() => { l.visible = !l.visible; });
  }

  toggleLock(layerId) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    this.mutateProject(() => { l.locked = !l.locked; });
  }

  toggleTrackCompact(layerId) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    this.mutateProject(() => { l.trackCompact = !l.trackCompact; });
  }

  toggleKfExpanded(layerId) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    l.kfExpanded = !l.kfExpanded;
    if (l.kfExpanded) {
      this.selectedLayerId = l.id;
    }
    this.scheduleAutosave();
    this.updateAllUI();
  }

  togglePropLaneKeyframe(layerId, laneKey, frame = this.currentFrame) {
    const l = this.project.layers.find((x) => x.id === layerId);
    if (!l) return;
    let res = null;
    this.mutateProject(() => {
      res = KeyframeEngine.togglePropLaneKeyframeAtFrame(l, laneKey, frame);
    });
    if (res) {
      const group = KEYFRAME_LANE_GROUPS.find((g) => g.key === laneKey);
      const label = group?.label || laneKey;
      this.showToast(res.added ? `Keyframe ${label} + F${res.frame}` : `Keyframe ${label} @ F${res.frame} dihapus`);
    }
  }

  toggleAllTracksCompact() {
    if (!this.project.layers.length) return;
    const singleTracks = this.project.layers.filter((l) => l.trackRole !== 'main');
    const hasMain = this.project.layers.some((l) => l.trackRole === 'main');
    const allCompact =
      singleTracks.every((l) => Boolean(l.trackCompact)) &&
      (!hasMain || Boolean(this.project.settings?.mainTrackCompact));
    const next = !allCompact;
    this.mutateProject(() => {
      singleTracks.forEach((l) => { l.trackCompact = next; });
      if (hasMain) {
        if (!this.project.settings) this.project.settings = {};
        this.project.settings.mainTrackCompact = next;
      }
    });
  }

  setLayerTransformProp(layer, prop, value, pushHistory = true) {
    const applyFn = () => {
      const hasTrack = (layer.keyframes?.[prop]?.length || 0) > 0;
      if (hasTrack) {
        KeyframeEngine.setKeyframe(layer, prop, this.currentFrame, value);
      } else {
        layer.transform[prop] = value;
      }
    };
    if (pushHistory) {
      this.mutateProject(applyFn);
    } else {
      applyFn();
      this.renderPreview();
    }
  }

  setCameraProp(prop, value, pushHistory = false, recordKeyframe = null) {
    const cam = this.project.camera;
    const applyFn = () => {
      cam.enabled = true;
      const track = cam.keyframes?.[prop];
      const hasTrack = Array.isArray(track) && track.length > 0;
      const autoRec = recordKeyframe !== null
        ? Boolean(recordKeyframe)
        : Boolean(this.viewport3D?.enabled && this.viewport3D?.autoRecord);
      const curFrame = Math.max(0, Math.round(this.currentFrame));

      if (hasTrack || autoRec) {
        if (!hasTrack && curFrame > 0) {
          const baseVal = Number(cam[prop] ?? (prop === 'zoom' ? 1 : 0));
          KeyframeEngine.setKeyframe(cam, prop, 0, baseVal, 'smooth');
        }
        KeyframeEngine.setKeyframe(cam, prop, curFrame, value, 'smooth');
        if (curFrame === 0 || !hasTrack) {
          cam[prop] = value;
        }
      } else {
        cam[prop] = value;
      }
    };
    if (pushHistory) {
      this.mutateProject(applyFn);
    } else {
      applyFn();
      this.renderPreview();
    }
  }

  toggleViewport3D() {
    this.viewport3D.enabled = !this.viewport3D.enabled;
    if (this.viewport3D.enabled) {
      this.project.camera.enabled = true;
    }
    this.renderer.setViewport3DState(this.viewport3D);
    this.syncViewport3DUI();
    this.renderPreview();
  }

  toggleViewport3DAutoRecord() {
    this.viewport3D.autoRecord = !this.viewport3D.autoRecord;
    this.syncViewport3DUI();
    this.panels.renderStylePanel();
    this.showToast(
      this.viewport3D.autoRecord
        ? '3D Auto-Rec ON: gerak kamera otomatis direkam halus'
        : '3D Auto-Rec OFF: gerak kamera statis kecuali di-keyframe'
    );
  }

  smoothCameraPath() {
    const cam = this.project.camera;
    let totalKfs = 0;
    for (const arr of Object.values(cam.keyframes || {})) {
      totalKfs += Array.isArray(arr) ? arr.length : 0;
    }
    if (totalKfs < 2) {
      return this.showToast('Buat minimal 2 keyframe kamera untuk dihaluskan');
    }
    this.mutateProject(() => {
      KeyframeEngine.smoothCameraKeyframes(cam, 0.38);
    });
    this.showToast('Jalur gerakan kamera 3D diperhalus (Smooth Spline)');
  }

  setViewport3DTool(tool) {
    this.viewport3D.tool = tool;
    this.renderer.setViewport3DState(this.viewport3D);
    this.syncViewport3DUI();
    this.renderPreview();
  }

  syncViewport3DUI() {
    const on = Boolean(this.viewport3D?.enabled);
    document.getElementById('btnResetCameraQuick')?.classList.toggle('active', on);
    const hud = document.getElementById('hud3DViewport');
    if (hud) {
      hud.classList.toggle('d-none', !on);
      hud.classList.toggle('d-flex', on);
    }
    const tool = this.viewport3D?.tool || 'move';
    document.getElementById('btn3DToolMove')?.classList.toggle('active', tool === 'move');
    document.getElementById('btn3DToolRotate')?.classList.toggle('active', tool === 'rotate');
    document.getElementById('btn3DToolScale')?.classList.toggle('active', tool === 'scale');
    document.getElementById('btn3DToolCam')?.classList.toggle('active', tool === 'camera');
    document.getElementById('btn3DCamAutoRec')?.classList.toggle('active', Boolean(this.viewport3D?.autoRecord));

    const cam = KeyframeEngine.getCameraAtFrame(this.project.camera, this.currentFrame);
    const recTag = this.viewport3D?.autoRecord ? 'REC · ' : '';
    this.set3DHudReadout(
      `${recTag}Y:${Math.round(cam.rotY)}° X:${Math.round(cam.rotX)}° Z:${Math.round(cam.z)} (${cam.zoom.toFixed(2)}x)`
    );
  }

  set3DHudReadout(text) {
    const el = document.getElementById('lbl3DHudReadout');
    if (el && text) el.textContent = text;
  }

  keyframeCameraAtPlayhead() {
    const cam = this.project.camera;
    this.mutateProject(() => {
      cam.enabled = true;
      const cur = KeyframeEngine.getCameraAtFrame(cam, this.currentFrame);
      const f = this.currentFrame;
      KeyframeEngine.setKeyframe(cam, 'x', f, cur.x, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'y', f, cur.y, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'z', f, cur.z, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'rotX', f, cur.rotX, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'rotY', f, cur.rotY, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'rotZ', f, cur.rotZ || 0, 'smooth');
      KeyframeEngine.setKeyframe(cam, 'zoom', f, cur.zoom, 'smooth');
    });
    this.showToast(`3D Camera keyframed (Smooth) @ F${this.currentFrame}`);
  }

  resetCameraRig() {
    const cam = this.project.camera;
    this.mutateProject(() => {
      Object.assign(cam, {
        enabled: this.viewport3D.enabled,
        x: 0,
        y: 0,
        z: 0,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        zoom: 1,
        keyframes: { x: [], y: [], z: [], rotX: [], rotY: [], rotZ: [], zoom: [] }
      });
    });
    this.showToast('3D Camera reset');
  }

  splitSelectedAtPlayhead() {
    const f = Math.round(this.currentFrame);
    let layer = this.getSelectedLayer();
    if (!layer) {
      const mainSeq = TimelineEngine.getMainTrackClips(this.project);
      layer = mainSeq.find((c) => f > c.startFrame + 2 && f < c.endFrame - 2) || null;
    }
    if (!layer) return this.showToast('Select a clip or place playhead inside Main Track clip');
    if (f <= layer.startFrame + 2 || f >= layer.endFrame - 2) {
      return this.showToast('Place playhead inside the clip to split');
    }
    let created = null;
    this.mutateProject(() => {
      created = TimelineEngine.splitClipAtFrame(this.project, layer.id, f);
    });
    if (created) {
      this.selectedLayerId = created.id;
      this.updateAllUI();
      this.showToast('Clip split at playhead');
    }
  }

  deleteSplitSideAtPlayhead(side) {
    const f = Math.round(this.currentFrame);
    const layer = this.getSelectedLayer();
    const prevRedo = Array.isArray(this.history?.redoStack) ? [...this.history.redoStack] : [];
    this.pushUndo();
    const res = TimelineEngine.trimDeleteSideAtPlayhead(this.project, layer?.id || null, side, f);
    if (!res) {
      if (Array.isArray(this.history?.undoStack)) {
        this.history.undoStack.pop();
        this.history.redoStack = prevRedo;
        this.updateUndoRedoButtons();
      }
      return this.showToast(
        side === 'left'
          ? 'Nothing left of playhead to trim/delete'
          : 'Nothing right of playhead to trim/delete'
      );
    }
    this.selectedLayerId = res.selectedId;
    const nextFrame = Math.max(0, Math.min(this.project.durationFrames, res.playheadFrame));
    this.currentFrame = nextFrame;
    this.onTimelineMutated();
    this.seekToFrame(nextFrame);
    this.showToast(
      res.action === 'trimmed_left' || res.action === 'deleted_left'
        ? 'Deleted left of split'
        : 'Deleted right of split'
    );
  }

  duplicateSelectedLayer() {
    const multiIds = [...(this.selectedLayerIds || [])].filter((id) => this.project.layers.some((l) => l.id === id));
    if (multiIds.length > 1) {
      const clones = TimelineEngine.cloneLayersForClipboard(this.project, multiIds);
      const maxEnd = Math.max(...clones.map((l) => Number(l.endFrame) || 0));
      let pasted = [];
      this.mutateProject(() => {
        pasted = TimelineEngine.pasteLayersAtFrame(this.project, clones, maxEnd);
        if (pasted.length > 0) {
          this.selectedLayerIds = new Set(pasted.map((l) => l.id));
          this.selectedLayerId = pasted[0].id;
        }
      });
      if (pasted.length > 0) this.showToast(`Duplicated ${pasted.length} clips`);
      return;
    }
    const layer = this.getSelectedLayer();
    if (!layer) return;
    this.mutateProject(() => {
      const copy = TimelineEngine.duplicateLayer(this.project, layer.id);
      if (copy) {
        if (copy.trackRole === 'main' && this.project.settings?.rippleMode !== false) {
          TimelineEngine.reflowMainTrack(this.project, 0);
        }
        this.selectedLayerId = copy.id;
        this.selectedLayerIds = new Set([copy.id]);
      }
    });
  }

  copySelectedLayers() {
    const ids = [...(this.selectedLayerIds || [])].filter((id) => this.project.layers.some((l) => l.id === id));
    if (ids.length === 0 && this.selectedLayerId) ids.push(this.selectedLayerId);
    if (ids.length === 0) return this.showToast('Select clip(s) to copy');
    this.copiedLayers = TimelineEngine.cloneLayersForClipboard(this.project, ids);
    this.showToast(`Copied ${this.copiedLayers.length} clip(s)`);
  }

  pasteCopiedLayers() {
    if (!Array.isArray(this.copiedLayers) || this.copiedLayers.length === 0) {
      return this.showToast('Clipboard empty — copy a clip first (Ctrl+C)');
    }
    let pasted = [];
    this.mutateProject(() => {
      pasted = TimelineEngine.pasteLayersAtFrame(this.project, this.copiedLayers, this.currentFrame);
      if (pasted.length > 0) {
        this.selectedLayerIds = new Set(pasted.map((l) => l.id));
        this.selectedLayerId = pasted[0].id;
      }
    });
    if (pasted.length > 0) {
      this.showToast(`Pasted ${pasted.length} clip(s) @ F${this.currentFrame}`);
    }
  }

  groupSelectedLayersAction() {
    const checked = [...(this.timelineView?.checkedLayerIds || [])];
    const selected = [...(this.selectedLayerIds || [])];
    const ids = checked.length >= 2 ? checked : selected;
    if (ids.length < 2) {
      return this.showToast('Select 2+ clips (Marquee or Ctrl+Click) to Group');
    }
    this.mutateProject(() => {
      const grp = TimelineEngine.groupSelectedLayers(this.project, ids);
      if (grp) {
        this.selectedLayerId = grp.id;
        this.selectedLayerIds = new Set([grp.id]);
      }
      this.timelineView.checkedLayerIds.clear();
    });
    this.showToast(`Grouped ${ids.length} layers`);
  }

  deleteSelectedLayer() {
    const layer = this.getSelectedLayer();
    if (!layer) return;
    const wasMain = layer.trackRole === 'main';
    this.mutateProject(() => {
      TimelineEngine.deleteMainOrLayer(this.project, layer.id);
      if (wasMain) {
        const remainingMain = TimelineEngine.getMainTrackClips(this.project);
        this.selectedLayerId = remainingMain[0]?.id || this.project.layers[0]?.id || null;
      } else {
        this.selectedLayerId = this.project.layers[0]?.id || null;
      }
      this.selectedLayerIds = this.selectedLayerId ? new Set([this.selectedLayerId]) : new Set();
    });
    if (wasMain && this.project.settings?.rippleMode !== false) {
      this.showToast('Clip deleted & Main Track gap closed');
    }
  }

  closeFloatingPopovers() {
    document.querySelectorAll('.mf-clip-context-menu, .mf-marker-popover').forEach((el) => el.remove());
    this.timelineView?.closeTrackWheelMenu?.();
    if (this._popoverDismissFn) {
      window.removeEventListener('pointerdown', this._popoverDismissFn, true);
      this._popoverDismissFn = null;
    }
  }

  openClipContextMenu(layerId, clientX, clientY) {
    this.closeFloatingPopovers();
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const preserveMulti = this.selectedLayerIds?.has(layerId) && this.selectedLayerIds.size > 1;
    this.selectLayer(layerId, { force: true, preserveMulti });

    const menu = document.createElement('div');
    menu.className = 'mf-clip-context-menu';

    const items = [
      { icon: 'bi-scissors text-info', label: 'Split', fn: () => this.splitSelectedAtPlayhead() },
      { icon: 'bi-copy', label: 'Duplicate', fn: () => this.duplicateSelectedLayer() },
      { icon: 'bi-clipboard', label: 'Copy Clip', fn: () => this.copySelectedLayers() },
      { icon: 'bi-eyedropper text-info', label: 'Copy FX', fn: () => this.copySelectedStyle() },
      ...(this.copiedClipStyle ? [{ icon: 'bi-clipboard-check text-warning', label: 'Paste FX', fn: () => this.pasteStyleToSelected() }] : []),
      { icon: 'bi-stars text-info', label: 'Effects', fn: () => this.openSheet('sheetStyle', 'fx', 'effects') },
      { icon: 'bi-intersect text-info', label: 'Transition', fn: () => this.openTransitionsSheet({ layerId: layer.id }) },
      ...(layer.type === 'video'
        ? [{ icon: 'bi-music-note text-warning', label: 'Pisah Audio', fn: () => this.detachAudioFromSelected() }]
        : []),
      ...(layer.type === 'video' || layer.type === 'audio'
        ? [{ icon: 'bi-speedometer2 text-info', label: 'Speed Curve', fn: () => this.openSheet('sheetStyle', 'layer') }]
        : []),
      ...(layer.type === 'video' || layer.type === 'image'
        ? [{ icon: 'bi-aspect-ratio text-info', label: 'Auto Reframe', fn: () => this.autoReframeLayer(layer.id, 'smart') }]
        : []),
      ...(this.selectedLayerIds.size >= 2
        ? [{ icon: 'bi-collection text-warning', label: 'Group', fn: () => this.groupSelectedLayersAction() }]
        : layer.type === 'group'
          ? [{ icon: 'bi-diagram-2 text-warning', label: 'Ungroup', fn: () => { this.mutateProject(() => TimelineEngine.ungroupChildren(this.project, layer.id)); } }]
          : []),
      { icon: 'bi-trash', label: 'Delete', danger: true, fn: () => this.deleteSelectedLayer() }
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mf-ctx-btn${item.danger ? ' danger' : ''}`;
      btn.innerHTML = `<i class="bi ${item.icon} fs-6"></i><span>${item.label}</span>`;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        this.closeFloatingPopovers();
        item.fn();
      };
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 240;
    const mh = menu.offsetHeight || 200;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, clientX - mw * 0.5));
    const top = Math.max(8, Math.min(window.innerHeight - mh - 8, clientY - mh - 14));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    this._popoverDismissFn = (ev) => {
      if (!menu.contains(ev.target)) {
        this.closeFloatingPopovers();
      }
    };
    setTimeout(() => {
      if (this._popoverDismissFn) window.addEventListener('pointerdown', this._popoverDismissFn, true);
    }, 60);
  }

  openMarkerColorPopover(markerObj, clientX, clientY) {
    this.closeFloatingPopovers();
    if (!markerObj) return;
    const pop = document.createElement('div');
    pop.className = 'mf-marker-popover';
    const colors = ['#34d399', '#00e5ff', '#fbbf24', '#f472b6', '#a78bfa', '#f87171'];
    pop.innerHTML = `
      <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
        <span class="small fw-semibold text-light">${this.panels.esc(markerObj.label || 'Marker')} · F${markerObj.frame}</span>
        <button type="button" class="btn btn-xs btn-outline-light py-0 px-2" data-mkr-jump>Jump</button>
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        ${colors.map((c) => `
          <button type="button" class="mf-marker-color-dot ${(markerObj.color || '#34d399').toLowerCase() === c ? 'active' : ''}" style="background:${c};" data-mkr-col="${c}" aria-label="Color ${c}"></button>
        `).join('')}
      </div>
      <button type="button" class="btn btn-xs btn-outline-danger w-100 py-1" data-mkr-del><i class="bi bi-trash me-1"></i>Delete Marker</button>
    `;
    document.body.appendChild(pop);
    const pw = pop.offsetWidth || 210;
    const ph = pop.offsetHeight || 115;
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - pw - 8, clientX - pw * 0.5)))}px`;
    pop.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - ph - 8, clientY + 12)))}px`;

    pop.querySelector('[data-mkr-jump]').onclick = () => {
      this.closeFloatingPopovers();
      this.seekToFrame(markerObj.frame);
    };
    pop.querySelectorAll('[data-mkr-col]').forEach((dot) => {
      dot.onclick = () => {
        this.mutateProject(() => TimelineEngine.setMarkerColor(this.project, markerObj.id, dot.dataset.mkrCol));
        this.closeFloatingPopovers();
      };
    });
    pop.querySelector('[data-mkr-del]').onclick = () => {
      this.mutateProject(() => TimelineEngine.removeMarkerById(this.project, markerObj.id));
      this.closeFloatingPopovers();
      this.showToast('Marker removed');
    };

    this._popoverDismissFn = (ev) => {
      if (!pop.contains(ev.target)) {
        this.closeFloatingPopovers();
      }
    };
    setTimeout(() => {
      if (this._popoverDismissFn) window.addEventListener('pointerdown', this._popoverDismissFn, true);
    }, 60);
  }

  toggleRippleMode() {
    const next = !(this.project.settings?.rippleMode !== false);
    this.mutateProject(() => {
      if (!this.project.settings) this.project.settings = {};
      this.project.settings.rippleMode = next;
      if (next) {
        TimelineEngine.reflowMainTrack(this.project, 0);
      }
    });
    this.showToast(next ? 'Magnetic Main Track ON (gaps auto-close)' : 'Magnetic Main Track OFF (free gaps)');
  }

  toggleMainTrackProp(prop) {
    const mainClips = TimelineEngine.getMainTrackClips(this.project);
    if (mainClips.length === 0) return;
    this.mutateProject(() => {
      if (prop === 'visible') {
        const anyVisible = mainClips.some((c) => c.visible);
        mainClips.forEach((c) => { c.visible = !anyVisible; });
      } else if (prop === 'locked') {
        const allLocked = mainClips.every((c) => c.locked);
        mainClips.forEach((c) => { c.locked = !allLocked; });
      } else if (prop === 'muted') {
        const audioClips = mainClips.filter((c) => c.audioProps);
        if (audioClips.length > 0) {
          const allMuted = audioClips.every((c) => c.audioProps.muted);
          audioClips.forEach((c) => { c.audioProps.muted = !allMuted; });
        } else {
          mainClips.forEach((c) => {
            c.audioProps = {
              volume: 1.0,
              fadeInFrames: 0,
              fadeOutFrames: 0,
              muted: true,
              voiceEffect: 'none',
              reduceNoise: false,
              normalize: false
            };
          });
        }
      } else if (prop === 'compact') {
        if (!this.project.settings) this.project.settings = {};
        this.project.settings.mainTrackCompact = !this.project.settings.mainTrackCompact;
      }
    });
  }

  closeMainTrackGaps() {
    this.mutateProject(() => {
      TimelineEngine.reflowMainTrack(this.project, 0);
    });
    this.showToast('Closed Main Track gaps');
  }

  switchSelectedTrackRole(targetRole) {
    const layer = this.getSelectedLayer();
    if (!layer || (layer.type !== 'video' && layer.type !== 'image')) return;
    let changed = false;
    this.mutateProject(() => {
      changed = TimelineEngine.switchLayerTrackRole(this.project, layer.id, targetRole, this.currentFrame);
    });
    if (changed) {
      this.showToast(targetRole === 'main' ? 'Moved clip to Main Track' : 'Moved clip to Overlay track');
    }
  }

  moveSelectedMainClip(delta) {
    const layer = this.getSelectedLayer();
    if (!layer || layer.trackRole !== 'main') return;
    let moved = false;
    this.mutateProject(() => {
      moved = TimelineEngine.moveMainTrackClipStep(this.project, layer.id, delta);
    });
    if (moved) {
      this.showToast(delta < 0 ? 'Moved clip left on Main Track' : 'Moved clip right on Main Track');
    }
  }

  detachAudioFromSelected() {
    const layer = this.getSelectedLayer();
    if (!layer || layer.type !== 'video') return;
    let audioLayer = null;
    this.mutateProject(() => {
      audioLayer = TimelineEngine.detachAudioFromVideo(this.project, layer.id);
    });
    if (audioLayer) {
      this.selectedLayerId = audioLayer.id;
      this.selectedLayerIds = new Set([audioLayer.id]);
      this.updateAllUI();
      this.showToast('Audio dipisahkan ke track bawah');
    }
  }

  rippleDeleteSelectedLayer() {
    const layer = this.getSelectedLayer();
    if (!layer) return;
    this.mutateProject(() => {
      TimelineEngine.rippleDeleteLayer(this.project, layer.id);
      this.selectedLayerId = null;
    });
    this.showToast('Ripple deleted clip & closed gap');
  }

  toggleMarkerAtPlayhead() {
    let added = false;
    this.mutateProject(() => {
      added = TimelineEngine.toggleTimelineMarker(this.project, this.currentFrame);
    });
    this.showToast(added ? `Added Marker @ F${this.currentFrame}` : 'Removed Marker');
  }

  toggleBeatAtPlayhead() {
    let added = false;
    this.mutateProject(() => {
      added = TimelineEngine.toggleBeatMarker(this.project, this.currentFrame);
    });
    this.showToast(added ? `Added Beat Marker @ F${this.currentFrame}` : 'Removed Beat Marker');
  }

  replaceSelectedClip() {
    const layer = this.getSelectedLayer();
    if (!layer) return this.showToast('Select a clip first');
    this.mediaPickerContext = 'replace';
    this.importIntent = 'replace_selected';
    this.panels.renderMediaLibrary(this.mediaItems);
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('sheetMedia')).show();
  }

  async replaceSelectedWithMedia(mediaItem) {
    const layer = this.getSelectedLayer();
    if (!layer || !mediaItem) return;
    const existingOthers = this.project.layers.filter((l) => l.id !== layer.id);
    this.mutateProject(() => {
      layer.colorMatch = null;
      TimelineEngine.replaceLayerMedia(this.project, layer.id, mediaItem);
    });
    this.mediaPickerContext = null;
    this.importIntent = 'library';
    this.hideOpenSheets();
    this.showToast(`Replaced clip with "${mediaItem.name}"`);
    if (mediaItem.type === 'video' || mediaItem.type === 'image') {
      await this.autoMatchLayerColor(layer, existingOthers);
    }
  }

  async freezeSelectedFrame() {
    const layer = this.getSelectedLayer();
    if (!layer || (layer.type !== 'video' && layer.type !== 'image')) {
      return this.showToast('Select a video or image clip to freeze');
    }
    this.pause();
    await this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, true);
    const captured = await this.renderer.captureSourceLayerPng(this.project, this.currentFrame, this.mediaMap, layer.id);
    if (!captured || !captured.dataUrl) {
      return this.showToast('Could not capture frame for freeze');
    }
    const frozenId = `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const frozenItem = {
      id: frozenId,
      name: `${layer.name}_Freeze`,
      type: 'image',
      mimeType: 'image/png',
      url: captured.dataUrl,
      thumbUrl: captured.dataUrl,
      width: captured.width || layer.width || this.project.width,
      height: captured.height || layer.height || this.project.height,
      durationMs: 3000,
      sizeBytes: Math.round(captured.dataUrl.length * 0.75),
      addedAt: Date.now()
    };
    await ProjectStorage.saveMediaItem(frozenItem);
    this.mediaItems.unshift(frozenItem);
    this.rebuildMediaMap();
    this.panels.renderMediaLibrary(this.mediaItems);

    let created = null;
    this.mutateProject(() => {
      created = TimelineEngine.insertFreezeFrame(
        this.project,
        layer.id,
        this.currentFrame,
        frozenItem,
        (this.project.fps || 30) * 3
      );
      if (created) this.selectedLayerId = created.id;
    });
    if (created) {
      this.showToast('Inserted 3s Freeze Frame');
    }
  }

  triggerDeviceVisualPick(intent = 'main_append') {
    this.importIntent = intent;
    if (window.AndroidBridge?.pickVisualMedia) {
      window.AndroidBridge.pickVisualMedia('all');
    } else {
      document.getElementById('fallbackFileInput').click();
    }
  }

  triggerDeviceAudioPick(intent = 'audio_at_playhead') {
    this.importIntent = intent;
    if (window.AndroidBridge?.pickAudioMedia) {
      window.AndroidBridge.pickAudioMedia();
    } else {
      document.getElementById('fallbackFileInput').click();
    }
  }

  updateExportSpecPill() {
    const ep = this.project.exportPrefs || {};
    const res = ep.resPreset || '1080p';
    const fps = ep.fps || this.project.fps || 30;
    const pill = document.getElementById('btnQuickExportSpec');
    if (pill) pill.textContent = `${res}·${fps}`;
  }

  refreshExportEstimate() {
    const resPreset = document.getElementById('selExportRes')?.value || '1080p';
    const fps = Number(document.getElementById('selExportFps')?.value) || 30;
    const quality = document.getElementById('selExportQuality')?.value || 'high';
    const includeAudio = Boolean(document.getElementById('chkExportAudio')?.checked);
    const trimEl = document.getElementById('chkExportTrimTail');
    const trimTrailingEmpty = trimEl ? Boolean(trimEl.checked) : true;

    this.project.exportPrefs = { resPreset, fps, quality, includeAudio, trimTrailingEmpty };
    this.updateExportSpecPill();
    this.scheduleAutosave();

    const dims = this.exportEngine.computeOutputDimensions(this.project, resPreset);
    const mbps = this.exportEngine.getBitrateMbps(quality, resPreset, fps);
    const estMb = this.exportEngine.estimateFileSizeMb(this.project, resPreset, quality, includeAudio, trimTrailingEmpty, fps);
    const effFrames = this.exportEngine.getEffectiveDurationFrames(this.project, trimTrailingEmpty);
    const durSec = (effFrames / Math.max(1, this.project.fps || 30)).toFixed(1);

    const resLabelMap = { '480p': '480p', '720p': '720p', '1080p': '1080p', '4k': '2K/4K' };
    const fpsHintMap = { 24: 'Cinema', 25: 'PAL', 30: 'Standard', 50: 'Smooth', 60: 'Ultra Smooth' };
    const qualLabelMap = { low: 'Low', medium: 'Recommended', high: 'High', ultra: 'Ultra (PNG)' };

    const resValEl = document.getElementById('lblExportResVal');
    const resDimsEl = document.getElementById('lblExportResDims');
    if (resValEl) resValEl.textContent = resLabelMap[resPreset] || resPreset;
    if (resDimsEl) resDimsEl.textContent = `${dims.width}×${dims.height}`;

    const fpsValEl = document.getElementById('lblExportFpsVal');
    const fpsHintEl = document.getElementById('lblExportFpsHint');
    if (fpsValEl) fpsValEl.textContent = `${fps}fps`;
    if (fpsHintEl) fpsHintEl.textContent = fpsHintMap[fps] || `${fps} FPS`;

    const qualValEl = document.getElementById('lblExportBitrateVal');
    const mbpsSubEl = document.getElementById('lblExportMbpsSub');
    if (qualValEl) qualValEl.textContent = qualLabelMap[quality] || quality;
    if (mbpsSubEl) mbpsSubEl.textContent = `${mbps} Mbps`;

    const estEl = document.getElementById('lblExportEstimate');
    if (estEl) {
      estEl.textContent = `${dims.width}×${dims.height} · ${fps} FPS · ${durSec}s`;
    }
    const sizeBadge = document.getElementById('lblExportSizeBadge');
    if (sizeBadge) sizeBadge.textContent = `~${estMb} MB`;
    const ctaLabel = document.getElementById('btnStartExportLabel');
    if (ctaLabel) ctaLabel.textContent = `Export MP4 (~${estMb} MB)`;

    const paintSlider = (sliderEl) => {
      if (!sliderEl) return;
      const min = Number(sliderEl.min || 0);
      const max = Number(sliderEl.max || 1);
      const val = Number(sliderEl.value || 0);
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      sliderEl.style.background = `linear-gradient(to right, #00e5ff ${pct}%, #283246 ${pct}%)`;
    };
    paintSlider(document.getElementById('rngExportRes'));
    paintSlider(document.getElementById('rngExportFps'));
    paintSlider(document.getElementById('rngExportQuality'));
  }

  openSheet(sheetId, styleTab = null, subTab = null) {
    if (styleTab) this.panels.activeStyleTab = styleTab;
    if (styleTab === 'fx' && subTab) this.panels.activeFxSubTab = subTab;
    if (styleTab === 'layer' && subTab) this.panels.activeTextSubTab = subTab;
    if (sheetId === 'sheetStickers' && subTab) this.panels.activeStickerSubTab = subTab;
    if (sheetId === 'sheetAudioTools' && subTab) this.panels.activeAudioHubTab = subTab;
    this.panels.refreshAll();
    if (sheetId === 'sheetRatio') this.panels.renderRatioPanel();
    if (sheetId === 'sheetMedia') this.panels.renderMediaLibrary(this.mediaItems);
    if (sheetId === 'sheetStickers') this.panels.renderStickersPanel();
    if (sheetId === 'sheetAudioTools') this.panels.renderAudioToolsPanel();
    if (sheetId === 'sheetTemplates') this.panels.renderTemplatesPanel();
    if (sheetId === 'sheetTransitions') this.panels.renderTransitionsPanel();
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById(sheetId)).show();
  }

  openTransitionsSheet(opts = {}) {
    this.pause();
    this.panels.transitionTarget = {
      mode: opts.mode || 'junction',
      leftId: opts.leftId || null,
      rightId: opts.rightId || null,
      layerId: opts.layerId || this.selectedLayerId || null
    };
    this.openSheet('sheetTransitions');
  }

  applyTransitionFromSheet(typeId, durationFrames, target) {
    const tgt = target || this.panels.transitionTarget || {};
    const hasJunction = tgt.mode === 'junction' && tgt.leftId && tgt.rightId &&
      this.project.layers.some((l) => l.id === tgt.leftId) &&
      this.project.layers.some((l) => l.id === tgt.rightId);
    const targetLayer = !hasJunction && tgt.layerId
      ? this.project.layers.find((l) => l.id === tgt.layerId)
      : null;
    if (!hasJunction && !targetLayer) return;

    let applied = false;
    this.mutateProject(() => {
      if (hasJunction) {
        applied = TimelineEngine.applyTransitionBetweenClips(this.project, tgt.leftId, tgt.rightId, typeId, durationFrames);
      } else if (targetLayer) {
        if (!targetLayer.transitions) targetLayer.transitions = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };
        if (tgt.mode === 'out') {
          targetLayer.transitions.outType = typeId;
          targetLayer.transitions.outFrames = durationFrames;
        } else {
          targetLayer.transitions.inType = typeId;
          targetLayer.transitions.inFrames = durationFrames;
        }
        applied = true;
      }
    });
    if (applied) {
      this.panels.renderTransitionsPanel();
      this.showToast(typeId === 'none' ? 'Transition cleared' : `Transition "${typeId}" applied`);
    }
  }

  applyTransitionFromDrag(leftId, rightId, typeId) {
    if (!leftId || !rightId || !typeId) return;
    const durF = Math.max(8, Math.round((this.project.fps || 30) * 0.8));
    let applied = false;
    this.mutateProject(() => {
      applied = TimelineEngine.applyTransitionBetweenClips(this.project, leftId, rightId, typeId, durF);
    });
    if (applied) {
      this.panels.transitionTarget = { mode: 'junction', leftId, rightId, layerId: leftId };
      this.panels.renderTransitionsPanel();
      this.showToast(`Applied "${typeId}" transition between clips`);
    }
  }

  applyTransitionToAllFromSheet(typeId, durationFrames) {
    const junctions = TimelineEngine.findTransitionJunctions(this.project);
    if (junctions.length === 0) {
      this.panels.renderTransitionsPanel();
      return this.showToast('No adjacent clip seams found');
    }
    let count = 0;
    this.mutateProject(() => {
      count = TimelineEngine.applyTransitionToAllJunctions(this.project, typeId, durationFrames);
    });
    this.panels.renderTransitionsPanel();
    this.showToast(
      typeId === 'none' ? `Cleared transitions on ${count} cut seam(s)` : `Applied "${typeId}" to ${count} cut seam(s)`
    );
  }

  rotateSelected90(deltaDeg = 90) {
    const layer = this.getSelectedLayer();
    if (!layer) return;
    const tf = KeyframeEngine.getTransformAtFrame(layer, this.currentFrame);
    this.setLayerTransformProp(layer, 'rotation', Math.round((tf.rotation || 0) + deltaDeg), true);
  }

  flipSelected(axis = 'x') {
    const layer = this.getSelectedLayer();
    if (!layer) return;
    this.mutateProject(() => {
      if (axis === 'x') layer.flipX = !layer.flipX;
      else layer.flipY = !layer.flipY;
    });
    this.showToast(axis === 'x' ? (layer.flipX ? 'Mirrored Horizontal' : 'Mirror Off') : (layer.flipY ? 'Flipped Vertical' : 'Flip V Off'));
  }

  insertTextTemplate(tpl) {
    this.mutateProject(() => {
      const layer = TimelineEngine.createTextLayer(this.project, this.currentFrame);
      layer.name = tpl.label;
      layer.textTemplateId = tpl.id;
      Object.assign(layer.textProps, tpl.textProps);
      if (tpl.presetIn) {
        KeyframeEngine.applyPreset(layer, tpl.presetIn, this.project.width, this.project.height, 18);
      }
      TimelineEngine.addLayer(this.project, layer);
      this.selectedLayerId = layer.id;
    });
    this.hideOpenSheets();
    this.openSheet('sheetStyle', 'layer', 'edit');
    this.showToast(`Added "${tpl.label}" text template`);
  }

  async insertSticker(sticker) {
    const dataUrl = renderStickerPngDataUrl(sticker);
    const id = `stk_${sticker.id}_${Date.now().toString(36)}`;
    const mediaItem = {
      id,
      name: `Sticker_${sticker.label}`,
      type: 'image',
      mimeType: 'image/png',
      url: dataUrl,
      thumbUrl: dataUrl,
      width: 256,
      height: 256,
      durationMs: 3000,
      sizeBytes: Math.round(dataUrl.length * 0.75),
      addedAt: Date.now()
    };
    await ProjectStorage.saveMediaItem(mediaItem);
    this.mediaItems.unshift(mediaItem);
    this.rebuildMediaMap();
    this.mutateProject(() => {
      const layer = TimelineEngine.createMediaLayer(this.project, mediaItem, this.currentFrame);
      TimelineEngine.addLayer(this.project, layer);
      this.selectedLayerId = layer.id;
    });
    this.hideOpenSheets();
    this.showToast(`Added ${sticker.label} sticker`);
  }

  previewSfx(sfxId) {
    try {
      const url = synthesizeSfxWavDataUrl(sfxId);
      const a = new Audio(url);
      a.play().catch(() => {});
    } catch {}
  }

  async insertSfx(sfxId) {
    const spec = SFX_PACK.find((s) => s.id === sfxId) || SFX_PACK[0];
    const dataUrl = synthesizeSfxWavDataUrl(spec.id);
    const id = `sfx_${spec.id}_${Date.now().toString(36)}`;
    const mediaItem = {
      id,
      name: `SFX_${spec.label}.wav`,
      type: 'audio',
      mimeType: 'audio/wav',
      url: dataUrl,
      thumbUrl: '',
      width: 0,
      height: 0,
      durationMs: spec.durMs,
      sizeBytes: Math.round(dataUrl.length * 0.75),
      addedAt: Date.now()
    };
    await ProjectStorage.saveMediaItem(mediaItem);
    this.mediaItems.unshift(mediaItem);
    this.rebuildMediaMap();
    this.audioEngine.loadBuffer(mediaItem).then(() => this.refreshTimelineOnly());
    this.mutateProject(() => {
      const layer = TimelineEngine.createMediaLayer(this.project, mediaItem, this.currentFrame);
      TimelineEngine.addLayer(this.project, layer);
      this.selectedLayerId = layer.id;
    });
    this.hideOpenSheets();
    this.showToast(`Added SFX "${spec.label}"`);
  }

  startVoiceoverTimer() {
    clearInterval(this.voiceoverState.timerId);
    this.voiceoverState.elapsedSec = 0;
    this.voiceoverState.timerId = setInterval(() => {
      this.voiceoverState.elapsedSec++;
      this.panels.renderAudioToolsPanel();
    }, 1000);
  }

  stopVoiceoverTimer() {
    clearInterval(this.voiceoverState.timerId);
    this.voiceoverState.timerId = null;
  }

  async toggleVoiceoverRecord() {
    const vo = this.voiceoverState;
    if (window.AndroidBridge?.startVoiceover && window.AndroidBridge?.stopVoiceover) {
      if (vo.recording) {
        window.AndroidBridge.stopVoiceover();
      } else {
        this.pause();
        this.importIntent = 'audio_at_playhead';
        window.AndroidBridge.startVoiceover();
      }
      return;
    }

    // Browser / WebView fallback using MediaRecorder
    if (vo.recording && vo.webRecorder) {
      vo.webRecorder.stop();
      vo.recording = false;
      this.stopVoiceoverTimer();
      vo.statusText = 'Saving voiceover...';
      this.panels.renderAudioToolsPanel();
      return;
    }
    try {
      this.pause();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      vo.webChunks = [];
      rec.ondataavailable = (ev) => { if (ev.data?.size) vo.webChunks.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(vo.webChunks, { type: rec.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        this.importIntent = 'audio_at_playhead';
        window.__mfNative.onMediaImported([{
          id: `vo_${Date.now().toString(36)}`,
          name: `Voiceover_${new Date().toLocaleTimeString().replace(/[: ]/g, '')}`,
          type: 'audio',
          mimeType: blob.type,
          url,
          thumbUrl: '',
          width: 0,
          height: 0,
          durationMs: Math.max(500, vo.elapsedSec * 1000),
          sizeBytes: blob.size
        }]);
        vo.statusText = 'Tap Mic to record voiceover at playhead';
        this.panels.renderAudioToolsPanel();
      };
      vo.webRecorder = rec;
      vo.recording = true;
      vo.statusText = 'Recording voiceover... Tap Stop when done';
      this.startVoiceoverTimer();
      this.panels.renderAudioToolsPanel();
      rec.start();
    } catch {
      this.showToast('Microphone unavailable');
    }
  }

  async captureCoverFrame() {
    this.pause();
    await this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, true);
    this.renderPreview();
    const snap = this.renderer.capturePreviewThumbnailDataUrl(256, 192);
    if (!snap) return this.showToast('Unable to capture cover frame');
    this.mutateProject(() => {
      this.project.coverDataUrl = snap;
    });
    await ProjectStorage.saveProject(this.project);
    await this.panels.renderProjectsList();
    this.showToast(`Captured cover thumbnail @ F${this.currentFrame}`);
  }

  copySelectedStyle() {
    const layer = this.getSelectedLayer();
    if (!layer || layer.type === 'audio' || layer.type === 'group') {
      return this.showToast('Select a visual clip to copy its style');
    }
    this.copiedClipStyle = TimelineEngine.copyAttributesFromLayer(layer);
    this.panels.renderStylePanel();
    this.renderBottomToolbar();
    this.showToast('Copied Color, Filter, VFX & Mask style');
  }

  pasteStyleToSelected() {
    if (!this.copiedClipStyle) return this.showToast('Copy a clip style first');
    const selectedIds = [...(this.selectedLayerIds || [])];
    if (selectedIds.length === 0 && this.selectedLayerId) selectedIds.push(this.selectedLayerId);
    const targets = this.project.layers.filter(
      (l) => selectedIds.includes(l.id) && l.type !== 'audio' && l.type !== 'group'
    );
    if (targets.length === 0) {
      return this.showToast('Select target visual clip(s)');
    }
    this.mutateProject(() => {
      targets.forEach((t) => TimelineEngine.pasteAttributesToLayer(t, this.copiedClipStyle));
    });
    this.showToast(
      targets.length > 1
        ? `Pasted attributes to ${targets.length} clips`
        : `Pasted style to "${targets[0].name}"`
    );
  }

  autoReframeLayer(layerId, mode = 'smart') {
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer) return this.showToast('Select a visual clip first');
    let ok = false;
    this.mutateProject(() => {
      ok = TimelineEngine.applyAutoReframe(this.project, layer, mode);
    });
    if (ok) {
      this.showToast(`Auto Reframed "${layer.name}" (${this.project.width}×${this.project.height})`);
    }
  }

  autoReframeAllClips(mode = 'smart') {
    const visuals = this.project.layers.filter(
      (l) => l.type === 'video' || l.type === 'image' || l.type === 'text' || l.type === 'shape'
    );
    if (visuals.length === 0) return this.showToast('No visual clips to reframe');
    let count = 0;
    this.mutateProject(() => {
      for (const l of visuals) {
        if (TimelineEngine.applyAutoReframe(this.project, l, mode)) count++;
      }
    });
    this.showToast(`Auto Reframed ${count} clip(s) (${mode})`);
  }

  applyFilterAndAdjustToAllClips(sourceLayer) {
    if (!sourceLayer) return;
    let count = 0;
    this.mutateProject(() => {
      count = TimelineEngine.applyFilterAndAdjustToAll(this.project, sourceLayer);
    });
    this.showToast(count > 0 ? `Applied filter & look to ${count} other clip(s)` : 'No other visual clips on timeline');
  }

  applyPipPreset(presetId) {
    const layer = this.getSelectedLayer();
    if (!layer || layer.type === 'audio' || layer.type === 'group') {
      return this.showToast('Select a video, image, text, or shape layer first');
    }
    const preset = PIP_LAYOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.mutateProject(() => {
      const pw = this.project.width || 1280;
      const ph = this.project.height || 720;
      layer.transform.x = preset.x !== undefined ? preset.x : Math.round((preset.xNorm || 0) * pw);
      layer.transform.y = preset.y !== undefined ? preset.y : Math.round((preset.yNorm || 0) * ph);
      layer.transform.scaleX = preset.scale ?? 1;
      layer.transform.scaleY = preset.scale ?? 1;
      if (preset.crop) layer.crop = { ...preset.crop };
      if (preset.mask) layer.mask = { ...preset.mask };
      else if (preset.id === 'full') layer.mask = { type: 'none', scaleX: 0.85, scaleY: 0.85, offsetX: 0, offsetY: 0, rotation: 0, feather: 0.05, invert: false };
    });
    this.showToast(`Applied layout: ${preset.label}`);
  }

  synthesizeTtsForLayer(text, voiceStyle = 'natural') {
    const clean = String(text || '').trim();
    if (!clean) return this.showToast('Enter some text before generating voice');
    if (!window.AndroidBridge?.synthesizeTts) {
      this.ttsStatusText = 'Android native TTS unavailable in desktop browser';
      this.panels.renderStylePanel();
      return this.showToast(this.ttsStatusText);
    }
    this.pause();
    this.importIntent = 'audio_at_playhead';
    this.ttsStatusText = 'Synthesizing TTS speech (.wav)...';
    this.panels.renderStylePanel();
    window.AndroidBridge.synthesizeTts(clean, voiceStyle);
  }

  async autoDetectBeatsForLayer(layer, sensitivity = 0.55) {
    if (!layer || (layer.type !== 'audio' && layer.type !== 'video') || !layer.mediaId) {
      return this.showToast('Select an Audio or Video clip with sound first');
    }
    const mediaItem = this.mediaMap.get(layer.mediaId);
    if (!mediaItem) return this.showToast('Media source missing');
    this.showToast('Analyzing waveform beats...');
    const beats = await this.audioEngine.detectBeatsForLayer(layer, mediaItem, this.project.fps || 30, sensitivity);
    if (!beats || beats.length === 0) {
      return this.showToast('No strong beat peaks detected');
    }
    this.mutateProject(() => {
      const merged = new Set([...(this.project.beatMarkers || []), ...beats]);
      this.project.beatMarkers = [...merged].sort((a, b) => a - b);
    });
    this.showToast(`Added ${beats.length} auto beat markers`);
  }

  async populateAutoBeatCaptionsSrt() {
    const fps = Math.max(1, this.project.fps || 30);
    let beats = [...(this.project.beatMarkers || [])].sort((a, b) => a - b);
    if (beats.length < 2) {
      const sndLayer = this.project.layers.find((l) => (l.type === 'audio' || l.type === 'video') && l.mediaId);
      if (sndLayer) {
        const mediaItem = this.mediaMap.get(sndLayer.mediaId);
        if (mediaItem) {
          const detected = await this.audioEngine.detectBeatsForLayer(sndLayer, mediaItem, fps, this.panels.beatSensitivity || 0.55);
          if (detected?.length >= 2) {
            beats = detected;
            this.mutateProject(() => {
              const merged = new Set([...(this.project.beatMarkers || []), ...detected]);
              this.project.beatMarkers = [...merged].sort((a, b) => a - b);
            });
          }
        }
      }
    }

    const fmtSrt = (frame) => {
      const msTotal = Math.max(0, Math.round((frame / fps) * 1000));
      const h = Math.floor(msTotal / 3600000);
      const m = Math.floor((msTotal % 3600000) / 60000);
      const s = Math.floor((msTotal % 60000) / 1000);
      const ms = msTotal % 1000;
      const pad = (n, len = 2) => String(n).padStart(len, '0');
      return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
    };

    const cues = [];
    if (beats.length >= 2) {
      const step = beats.length > 16 ? 2 : 1;
      for (let i = 0; i < beats.length; i += step) {
        const sf = beats[i];
        const nextF = beats[Math.min(beats.length - 1, i + step)];
        const ef = Math.max(sf + Math.round(fps * 0.6), Math.min(sf + Math.round(fps * 2.2), nextF > sf ? nextF - 2 : sf + fps));
        cues.push({ sf, ef, text: `Beat Caption ${cues.length + 1}` });
      }
    } else {
      const visuals = TimelineEngine.getMainTrackClips(this.project);
      if (visuals.length > 0) {
        visuals.forEach((v, idx) => {
          cues.push({ sf: v.startFrame, ef: Math.max(v.startFrame + 15, v.endFrame - 2), text: `${v.name || `Scene ${idx + 1}`}` });
        });
      } else {
        const total = Math.max(fps * 2, this.project.durationFrames || fps * 6);
        const step = Math.round(fps * 2);
        for (let f = 0; f < total && cues.length < 12; f += step) {
          cues.push({ sf: f, ef: Math.min(total, f + step - 2), text: `Caption ${cues.length + 1}` });
        }
      }
    }

    const srtText = cues
      .slice(0, 24)
      .map((c, idx) => `${idx + 1}\n${fmtSrt(c.sf)} --> ${fmtSrt(c.ef)}\n${c.text}`)
      .join('\n\n');
    const box = document.getElementById('txtBatchCaptions');
    if (box) box.value = srtText;
    this.showToast(`Auto-generated ${Math.min(24, cues.length)} synced caption cues — edit text or tap Generate Captions`);
  }

  async applyAutoEditTemplate(templateId) {
    const visuals = this.mediaItems.filter((m) => m.type === 'video' || m.type === 'image');
    if (visuals.length === 0) {
      this.showToast('Import at least 1 video or photo first');
      return;
    }
    let count = 0;
    this.mutateProject(() => {
      count = TimelineEngine.autoEditArrangeClips(this.project, this.mediaItems, templateId);
      const firstVis = this.project.layers.find((l) => l.type !== 'audio');
      this.selectedLayerId = firstVis ? firstVis.id : null;
      this.selectedLayerIds = this.selectedLayerId ? new Set([this.selectedLayerId]) : new Set();
    });
    this.hideOpenSheets();
    await this.seekToFrame(0);
    this.showToast(`Auto-edited ${count} clip(s) with 3D camera & beats`);
  }

  importSrtOrGenerateCaptions(rawText, secPerLine = 2.0, styleId = 'minimalSub') {
    const cues = parseSrtOrLyrics(rawText, this.project.fps || 30, this.currentFrame, secPerLine);
    if (!cues || cues.length === 0) {
      return this.showToast('Paste .SRT blocks or lyrics lines first');
    }
    const tpl = TEXT_TEMPLATES.find((t) => t.id === styleId) || TEXT_TEMPLATES.find((t) => t.id === 'minimalSub');
    let lastId = null;
    this.mutateProject(() => {
      for (const cue of cues) {
        const layer = TimelineEngine.createTextLayer(this.project, cue.startFrame);
        layer.name = `Sub: ${cue.text.slice(0, 14)}`;
        layer.startFrame = cue.startFrame;
        layer.endFrame = cue.endFrame;
        layer.transform.y = Math.round((this.project.height || 720) * 0.34);
        if (tpl?.textProps) {
          Object.assign(layer.textProps, tpl.textProps, { text: cue.text });
          layer.textTemplateId = tpl.id;
        } else {
          layer.textProps.text = cue.text;
        }
        TimelineEngine.addLayer(this.project, layer);
        lastId = layer.id;
      }
      if (lastId) {
        this.selectedLayerId = lastId;
        this.selectedLayerIds = new Set([lastId]);
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('modalCaptions'))?.hide();
    this.showToast(`Generated ${cues.length} timed caption clip(s) (splittable)`);
  }

  async openCutoutBrushForSelected() {
    const layer = this.getSelectedLayer();
    if (!layer || (layer.type !== 'video' && layer.type !== 'image')) {
      return this.showToast('Select a Video or Image layer to cut out');
    }
    this.pause();
    await this.renderer.seekVideosForFrame(this.project, this.currentFrame, this.mediaMap, true);
    const captured = await this.renderer.captureSourceLayerPng(this.project, this.currentFrame, this.mediaMap, layer.id);
    if (!captured || !captured.dataUrl) {
      return this.showToast('Could not capture layer frame for cutout');
    }
    const img = new Image();
    img.onload = () => {
      const modalEl = document.getElementById('modalDraw');
      const canvas = document.getElementById('drawPadCanvas');
      if (!modalEl || !canvas) return;
      const maxSide = 760;
      const scale = Math.min(1, maxSide / Math.max(1, img.width, img.height));
      canvas.width = Math.max(120, Math.round(img.width * scale));
      canvas.height = Math.max(120, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const srcCopy = document.createElement('canvas');
      srcCopy.width = canvas.width;
      srcCopy.height = canvas.height;
      srcCopy.getContext('2d').drawImage(canvas, 0, 0);

      this._drawMode = 'cutout';
      this._cutoutTargetLayerId = layer.id;
      this._cutoutSourceCanvas = srcCopy;
      this._drawUndoStack = [];
      this._drawEraser = true;

      document.getElementById('drawModalIcon').className = 'bi bi-scissors me-2 text-warning';
      document.getElementById('drawModalTitleText').textContent = `Custom Brush Cutout — ${layer.name}`;
      document.getElementById('drawColorsRow')?.classList.add('d-none');
      document.getElementById('drawCutoutHint')?.classList.remove('d-none');
      document.getElementById('btnSaveDrawText').textContent = 'Apply Cutout to Clip';
      const eraserBtn = document.getElementById('btnDrawEraser');
      eraserBtn?.classList.add('btn-info', 'text-dark');

      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    };
    img.src = captured.dataUrl;
  }

  openDrawModal() {
    this.pause();
    const modalEl = document.getElementById('modalDraw');
    if (!modalEl) return;
    this._drawMode = 'doodle';
    this._cutoutTargetLayerId = null;
    this._cutoutSourceCanvas = null;
    document.getElementById('drawModalIcon').className = 'bi bi-brush me-2 text-info';
    document.getElementById('drawModalTitleText').textContent = 'Doodle / Brush Overlay';
    document.getElementById('drawColorsRow')?.classList.remove('d-none');
    document.getElementById('drawCutoutHint')?.classList.add('d-none');
    document.getElementById('btnSaveDrawText').textContent = 'Add Doodle to Timeline';

    const canvas = document.getElementById('drawPadCanvas');
    const targetW = Math.min(960, Math.max(360, this.project.width || 720));
    const targetH = Math.max(240, Math.round(targetW * ((this.project.height || 720) / (this.project.width || 1280))));
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, targetW, targetH);
    this._drawUndoStack = [];
    this._drawCurrentColor = document.getElementById('drawCustomColor')?.value || '#00E5FF';
    this._drawEraser = false;
    document.getElementById('btnDrawEraser')?.classList.remove('active', 'btn-info', 'text-dark');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  renderBottomToolbar() {
    const container = document.getElementById('bottomNavScroll');
    if (!container) return;
    const layer = this.getSelectedLayer();

    const makeBtn = (icon, label, onClick, extraCls = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn mf-nav-btn ${extraCls}`.trim();
      btn.innerHTML = `<i class="bi ${icon}"></i><span>${label}</span>`;
      btn.onclick = onClick;
      return btn;
    };

    container.innerHTML = '';

    if (!layer) {
      // CapCut ROOT TOOLBAR (when no clip is selected)
      const ensureVisualOrSelected = () => {
        if (this.project.layers.length > 0) {
          this.selectedLayerId = this.project.layers[0].id;
          this.updateAllUI();
          return true;
        }
        this.showToast('Import or add a clip first');
        return false;
      };
      const rootItems = [
        ['bi-plus-circle-fill text-info', 'Edit', () => this.triggerDeviceVisualPick('main_append')],
        ['bi-collection-play', 'Media', () => { this.mediaPickerContext = null; this.openSheet('sheetMedia'); }],
        ['bi-music-note-beamed text-warning', 'Audio', () => this.openSheet('sheetAudioTools', null, 'sfx')],
        ['bi-fonts text-primary', 'Text', () => {
          this.mutateProject(() => {
            const t = TimelineEngine.createTextLayer(this.project, this.currentFrame);
            TimelineEngine.addLayer(this.project, t);
            this.selectedLayerId = t.id;
          });
          this.openSheet('sheetStyle', 'layer', 'edit');
        }],
        ['bi-emoji-smile text-warning', 'Stickers', () => this.openSheet('sheetStickers', null, 'stickers')],
        ['bi-badge-cc text-info', 'Captions', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCaptions')).show()],
        ['bi-intersect text-info', 'Transitions', () => this.openTransitionsSheet()],
        ['bi-magic text-info', 'Templates', () => this.openSheet('sheetTemplates')],
        ['bi-brush text-info', 'Draw', () => this.openDrawModal()],
        ['bi-stars text-info', 'Effects', () => { if (ensureVisualOrSelected()) this.openSheet('sheetStyle', 'fx', 'effects'); }],
        ['bi-palette-fill text-success', 'Filters', () => { if (ensureVisualOrSelected()) this.openSheet('sheetStyle', 'fx', 'filters'); }],
        ['bi-layers-half text-success', 'Overlay', () => this.triggerDeviceVisualPick('overlay_at_playhead')],
        ['bi-sliders2-vertical text-warning', 'Adj Layer', () => {
          this.mutateProject(() => {
            const adj = TimelineEngine.createAdjustmentLayer(this.project, this.currentFrame);
            TimelineEngine.addLayer(this.project, adj);
            TimelineEngine.normalizeTrackZOrder(this.project);
            this.selectedLayerId = adj.id;
          });
          this.openSheet('sheetStyle', 'fx', 'adjust');
        }],
        ['bi-pentagon text-warning', 'Shapes', () => this.openSheet('sheetAddLayer')],
        ['bi-bookmark-plus text-success', 'Marker', () => this.toggleMarkerAtPlayhead()],
        ['bi-music-note-list text-warning', 'Beat', () => this.toggleBeatAtPlayhead()],
        ['bi-aspect-ratio', 'Canvas', () => this.openSheet('sheetRatio')],
        ['bi-badge-3d text-info', '3D Cam', () => {
          if (!this.viewport3D.enabled) this.toggleViewport3D();
          this.openSheet('sheetStyle', 'camera');
        }]
      ];
      rootItems.forEach(([ic, lbl, fn]) => container.appendChild(makeBtn(ic, lbl, fn)));
      return;
    }

    // CapCut CONTEXTUAL CLIP TOOLBAR (sticky Back '<' + tools matching selected layer type)
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'mf-nav-back-btn';
    backBtn.title = 'Back to Root Menu';
    backBtn.innerHTML = `<i class="bi bi-chevron-left fs-6"></i><span>Back</span>`;
    backBtn.onclick = () => this.selectLayer(null);
    container.appendChild(backBtn);

    const commonTransform = ['bi-bounding-box', 'Transform', () => this.openSheet('sheetInspector')];
    const commonAnim = ['bi-diamond-half text-info', 'Anim', () => this.openSheet('sheetKeyframes')];
    const commonTransition = ['bi-intersect text-info', 'Transition', () => this.openTransitionsSheet({ layerId: layer.id })];
    const commonSplit = ['bi-scissors', 'Split', () => this.splitSelectedAtPlayhead()];
    const commonDelLeft = ['bi-arrow-bar-left text-warning', 'Del Left', () => this.deleteSplitSideAtPlayhead('left')];
    const commonDelRight = ['bi-arrow-bar-right text-warning', 'Del Right', () => this.deleteSplitSideAtPlayhead('right')];
    const commonDup = ['bi-copy', 'Duplicate', () => this.duplicateSelectedLayer()];
    const commonDel = ['bi-trash', 'Delete', () => this.deleteSelectedLayer(), 'mf-nav-danger'];
    const commonRippleDel = ['bi-backspace', 'Ripple Del', () => this.rippleDeleteSelectedLayer(), 'mf-nav-danger'];
    const commonCopyStyle = ['bi-eyedropper text-info', 'Copy FX', () => this.copySelectedStyle()];
    const commonPasteStyle = this.copiedClipStyle ? ['bi-clipboard-check text-warning', 'Paste FX', () => this.pasteStyleToSelected()] : null;

    let ctxItems = [];
    const mainCount = TimelineEngine.getMainTrackClips(this.project).length;
    const trackToggleBtn = [
      'bi-layers-half text-info',
      layer.trackRole === 'main' ? 'Overlay' : 'Main Track',
      () => this.switchSelectedTrackRole(layer.trackRole === 'main' ? 'overlay' : 'main')
    ];
    const reorderBtns = (layer.trackRole === 'main' && mainCount > 1)
      ? [
          ['bi-arrow-left-square text-light', 'Move Left', () => this.moveSelectedMainClip(-1)],
          ['bi-arrow-right-square text-light', 'Move Right', () => this.moveSelectedMainClip(1)]
        ]
      : [];

    if (layer.type === 'video') {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-speedometer2 text-info', 'Speed', () => this.openSheet('sheetStyle', 'layer')],
        ['bi-volume-up', 'Volume/FX', () => this.openSheet('sheetStyle', 'layer')],
        commonAnim,
        commonTransition,
        trackToggleBtn,
        ...reorderBtns,
        ['bi-stars text-info', 'Effects', () => this.openSheet('sheetStyle', 'fx', 'effects')],
        ['bi-palette-fill text-success', 'Filters', () => this.openSheet('sheetStyle', 'fx', 'filters')],
        ['bi-sliders2', 'Adjust', () => this.openSheet('sheetStyle', 'fx', 'adjust')],
        ['bi-scissors text-warning', 'Cutout', () => this.openCutoutBrushForSelected()],
        ['bi-person-bounding-box text-success', 'Chroma', () => this.openSheet('sheetStyle', 'fx', 'chroma')],
        ['bi-pip text-info', 'PIP/Split', () => this.openSheet('sheetStyle', 'mask')],
        ['bi-crop text-warning', 'Crop/Rot', () => this.openSheet('sheetStyle', 'mask')],
        ['bi-camera-reels text-info', 'Stabilize', () => this.openStabilizerUI(layer.id)],
        ['bi-snow text-info', 'Freeze', () => this.freezeSelectedFrame()],
        ['bi-crosshair text-warning', 'Track 3D', () => this.openTrackerUI(layer.id)],
        ['bi-circle-half', 'Mask/Tr', () => this.openSheet('sheetStyle', 'mask')],
        commonTransform,
        commonCopyStyle,
        ...(commonPasteStyle ? [commonPasteStyle] : []),
        ['bi-music-note text-warning', 'Pisah Audio', () => this.detachAudioFromSelected()],
        ['bi-arrow-left-right', 'Replace', () => this.replaceSelectedClip()],
        ['bi-arrow-counterclockwise', 'Reverse', () => {
          this.mutateProject(() => { layer.reversed = !layer.reversed; });
          this.showToast(layer.reversed ? 'Clip Reversed' : 'Reverse Off');
        }],
        commonDup,
        commonRippleDel,
        commonDel
      ];
    } else if (layer.type === 'image') {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        commonAnim,
        commonTransition,
        trackToggleBtn,
        ...reorderBtns,
        ['bi-stars text-info', 'Effects', () => this.openSheet('sheetStyle', 'fx', 'effects')],
        ['bi-palette-fill text-success', 'Filters', () => this.openSheet('sheetStyle', 'fx', 'filters')],
        ['bi-sliders2', 'Adjust', () => this.openSheet('sheetStyle', 'fx', 'adjust')],
        ['bi-scissors text-warning', 'Cutout', () => this.openCutoutBrushForSelected()],
        ['bi-person-bounding-box text-success', 'Chroma', () => this.openSheet('sheetStyle', 'fx', 'chroma')],
        ['bi-pip text-info', 'PIP/Split', () => this.openSheet('sheetStyle', 'mask')],
        ['bi-crop text-warning', 'Crop/Rot', () => this.openSheet('sheetStyle', 'mask')],
        ['bi-snow text-info', 'Freeze', () => this.freezeSelectedFrame()],
        ['bi-circle-half', 'Mask/Tr', () => this.openSheet('sheetStyle', 'mask')],
        commonTransform,
        commonCopyStyle,
        ...(commonPasteStyle ? [commonPasteStyle] : []),
        ['bi-arrow-left-right', 'Replace', () => this.replaceSelectedClip()],
        commonDup,
        commonRippleDel,
        commonDel
      ];
    } else if (layer.type === 'text') {
      ctxItems = [
        ['bi-pencil-square text-info', 'Edit Text', () => this.openSheet('sheetStyle', 'layer', 'edit')],
        ['bi-card-heading text-warning', 'Templates', () => this.openSheet('sheetStyle', 'layer', 'templates')],
        ['bi-megaphone text-info', 'TTS/Caps', () => this.openSheet('sheetStyle', 'layer', 'voice')],
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-chat-square-text', 'Bubble', () => this.openSheet('sheetStyle', 'layer', 'bubble')],
        commonAnim,
        commonTransition,
        ['bi-stars text-info', 'Effects', () => this.openSheet('sheetStyle', 'fx', 'effects')],
        ['bi-crosshair text-warning', 'Track 3D', () => this.openTrackerUI()],
        commonTransform,
        ['bi-sliders2', 'Adjust/FX', () => this.openSheet('sheetStyle', 'fx', 'adjust')],
        ['bi-circle-half', 'Mask/Tr', () => this.openSheet('sheetStyle', 'mask')],
        commonDup,
        commonDel
      ];
    } else if (layer.type === 'shape') {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-palette2 text-warning', 'Style', () => this.openSheet('sheetStyle', 'layer')],
        commonAnim,
        commonTransition,
        ['bi-stars text-info', 'Effects', () => this.openSheet('sheetStyle', 'fx', 'effects')],
        ['bi-crosshair text-warning', 'Track 3D', () => this.openTrackerUI()],
        commonTransform,
        ['bi-sliders2', 'Adjust/FX', () => this.openSheet('sheetStyle', 'fx', 'adjust')],
        ['bi-circle-half', 'Mask/Tr', () => this.openSheet('sheetStyle', 'mask')],
        commonDup,
        commonDel
      ];
    } else if (layer.type === 'audio') {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-volume-up text-warning', 'Volume', () => this.openSheet('sheetStyle', 'layer')],
        ['bi-soundwave text-info', 'Voice FX', () => this.openSheet('sheetStyle', 'layer')],
        ['bi-graph-up', 'Fade', () => this.openSheet('sheetStyle', 'layer')],
        ['bi-speedometer2 text-info', 'Speed', () => this.openSheet('sheetStyle', 'layer')],
        ['bi-music-note-list text-warning', 'Beat', () => this.toggleBeatAtPlayhead()],
        ['bi-bookmark-plus text-success', 'Marker', () => this.toggleMarkerAtPlayhead()],
        ['bi-arrow-counterclockwise', 'Reverse', () => {
          this.mutateProject(() => { layer.reversed = !layer.reversed; });
          this.showToast(layer.reversed ? 'Audio Reversed' : 'Reverse Off');
        }],
        ['bi-arrow-left-right', 'Replace', () => this.replaceSelectedClip()],
        commonDup,
        commonRippleDel,
        commonDel
      ];
    } else if (layer.type === 'adjustment') {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-stars text-info', 'Effects', () => this.openSheet('sheetStyle', 'fx', 'effects')],
        ['bi-palette-fill text-success', 'Filters', () => this.openSheet('sheetStyle', 'fx', 'filters')],
        ['bi-sliders2 text-warning', 'Adjust/HSL', () => this.openSheet('sheetStyle', 'fx', 'adjust')],
        ['bi-circle-half', 'Mask/Tr', () => this.openSheet('sheetStyle', 'mask')],
        commonAnim,
        commonTransform,
        commonCopyStyle,
        ...(commonPasteStyle ? [commonPasteStyle] : []),
        commonDup,
        commonDel
      ];
    } else {
      ctxItems = [
        commonSplit,
        commonDelLeft,
        commonDelRight,
        ['bi-diagram-2 text-warning', 'Ungroup', () => {
          this.mutateProject(() => TimelineEngine.ungroupChildren(this.project, layer.id));
          this.showToast('Group children ungrouped');
        }],
        commonAnim,
        commonTransform,
        commonDup,
        commonDel
      ];
    }

    ctxItems.forEach((args) => container.appendChild(makeBtn(...args)));
  }

  openStabilizerUI(layerId = null) {
    if (layerId) this.selectedLayerId = layerId;
    this.panels.activeStyleTab = 'layer';
    this.openSheet('sheetStyle', 'layer');
    setTimeout(() => {
      document.getElementById('videoStabilizerCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }

  async runVideoStabilizer(layerId, level = 'recommended') {
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'video') return this.showToast('Select a video layer first');
    this.pause();

    this.stabilizerState.isStabilizing = true;
    this.stabilizerState.targetLayerId = layer.id;
    this.stabilizerState.level = level;
    this.stabilizerState.progressPct = 0;
    this.stabilizerState.progressDetail = 'Scanning video frames...';
    this.panels.renderStylePanel();

    const prevStab = layer.stabilizer ? JSON.parse(JSON.stringify(layer.stabilizer)) : null;
    try {
      const result = await this.stabilizerEngine.analyzeAndStabilize({
        project: this.project,
        videoLayer: layer,
        mediaMap: this.mediaMap,
        level,
        onProgress: (pct, cur, total) => {
          this.stabilizerState.progressPct = pct;
          this.stabilizerState.progressDetail = `Frame ${cur} / ${total}`;
          const bar = document.getElementById('stabProgressBar');
          if (bar) bar.style.width = `${pct}%`;
          const lbl = document.getElementById('stabPctLbl');
          if (lbl) lbl.textContent = `${pct}%`;
          const det = document.getElementById('stabDetailLbl');
          if (det) det.textContent = this.stabilizerState.progressDetail;
        }
      });

      this.stabilizerState.isStabilizing = false;
      this.stabilizerState.targetLayerId = null;
      // Record undo step properly relative to prior state
      const newStab = result;
      layer.stabilizer = prevStab;
      this.mutateProject(() => {
        layer.stabilizer = newStab;
      });
      await this.seekToFrame(this.currentFrame);
      this.showToast(`Stabilized (${result.level}) · Crop ${result.cropScale}x`);
    } catch (err) {
      this.stabilizerState.isStabilizing = false;
      this.stabilizerState.targetLayerId = null;
      layer.stabilizer = prevStab;
      this.panels.renderStylePanel();
      if (err?.message !== 'Stabilization cancelled') {
        this.showToast(err?.message || 'Stabilization failed');
      } else {
        this.showToast('Stabilization cancelled');
      }
    }
  }

  cancelVideoStabilizer() {
    this.stabilizerEngine.cancel();
    this.stabilizerState.isStabilizing = false;
    this.stabilizerState.targetLayerId = null;
    this.panels.renderStylePanel();
  }

  recomputeStabilizerLevel(layerId, level) {
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer?.stabilizer?.rawMotions?.length) return;
    const recomputed = StabilizerEngine.recomputePreset(layer.stabilizer, level);
    if (!recomputed) return;
    this.mutateProject(() => {
      layer.stabilizer = recomputed;
    });
    this.showToast(`Stabilizer: ${recomputed.level} · Crop ${recomputed.cropScale}x`);
  }

  toggleStabilizerEnabled(layerId, enabled) {
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer?.stabilizer) return;
    this.mutateProject(() => {
      layer.stabilizer.enabled = Boolean(enabled);
    });
  }

  clearVideoStabilizer(layerId) {
    const layer = this.project.layers.find((l) => l.id === layerId);
    if (!layer) return;
    this.mutateProject(() => {
      layer.stabilizer = null;
    });
    this.showToast('Stabilizer removed');
  }

  ensureTrackerSourceSelected(preferredId = null) {
    const visual = this.project.layers.filter((l) => l.type === 'video' || l.type === 'image');
    if (preferredId && visual.some((v) => v.id === preferredId)) {
      this.trackerState.sourceLayerId = preferredId;
      return visual.find((v) => v.id === preferredId);
    }
    const sel = this.getSelectedLayer();
    if (sel && (sel.type === 'video' || sel.type === 'image')) {
      this.trackerState.sourceLayerId = sel.id;
      return sel;
    }
    if (!visual.some((v) => v.id === this.trackerState.sourceLayerId)) {
      const firstVid = visual.find((v) => v.type === 'video') || visual[0] || null;
      this.trackerState.sourceLayerId = firstVid ? firstVid.id : null;
    }
    return visual.find((v) => v.id === this.trackerState.sourceLayerId) || null;
  }

  syncTrackerOverlay() {
    this.renderer.setTrackerOverlay(this.trackerState.active ? this.trackerState : null);
    document.getElementById('btnOpenTrackerQuick')?.classList.toggle('tracking-active', Boolean(this.trackerState.active));
    this.renderPreview();
  }

  openTrackerUI(sourceLayerId = null) {
    this.pause();
    const src = this.ensureTrackerSourceSelected(sourceLayerId);
    if (src) {
      this.trackerState.active = true;
      if (this.currentFrame < src.startFrame || this.currentFrame > src.endFrame) {
        this.seekToFrame(src.startFrame);
      }
    }
    this.panels.activeStyleTab = 'tracker';
    this.panels.renderStylePanel();
    this.syncTrackerOverlay();
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('sheetStyle')).show();
  }

  async runMotionTrack(direction = 'forward') {
    const src = this.ensureTrackerSourceSelected();
    if (!src) return this.showToast('Add a Video or Image layer first');
    this.pause();

    const anchorFrame = Math.max(src.startFrame, Math.min(src.endFrame, this.currentFrame));
    const prevTrackData = src.trackData ? JSON.parse(JSON.stringify(src.trackData)) : null;
    this.trackerState.isTracking = true;
    this.trackerState.active = true;
    this.trackerState.followTrackedPoints = true;
    this.trackerState.progressPct = 0;
    this.trackerState.progressDetail = `Analyzing from F${anchorFrame}...`;
    src.trackData = { sourceLayerId: src.id, anchorFrame, points: [] };
    this.panels.renderStylePanel();

    try {
      const result = await this.trackerEngine.trackLayer({
        project: this.project,
        videoLayer: src,
        mediaMap: this.mediaMap,
        anchorFrame,
        targetX: this.trackerState.targetX,
        targetY: this.trackerState.targetY,
        direction,
        patchRadiusProj: this.trackerState.patchRadius,
        searchRadiusProj: this.trackerState.searchRadius,
        trackScale: this.trackerState.trackScale,
        trackTilt3D: this.trackerState.trackTilt3D,
        onFrameTracked: (pct, pt, count) => {
          this.trackerState.progressPct = pct;
          this.trackerState.progressDetail = `F${pt.frame} (${count} pts · ${Math.round(pt.score * 100)}%)`;
          if (!src.trackData) src.trackData = { points: [] };
          src.trackData.points = [...(src.trackData.points || []).filter((p) => p.frame !== pt.frame), pt];
          this.currentFrame = pt.frame;
          this.timelineView.updatePlayhead(this.currentFrame);
          this.updateTransportLabels();
          this.renderPreview();
          const bar = document.querySelector('#styleBody .progress-bar');
          if (bar) bar.style.width = `${pct}%`;
          const pctLbl = document.getElementById('trkPctLbl');
          if (pctLbl) pctLbl.textContent = `${pct}%`;
          const detLbl = document.getElementById('trkDetailLbl');
          if (detLbl) detLbl.textContent = this.trackerState.progressDetail;
        }
      });

      this.trackerState.isTracking = false;
      src.trackData = prevTrackData;
      this.mutateProject(() => {
        src.trackData = result;
      });
      await this.seekToFrame(result.anchorFrame);
      this.showToast(`Tracked ${result.points.length} frames (${Math.round(result.avgConfidence * 100)}% lock)`);
    } catch (err) {
      this.trackerState.isTracking = false;
      src.trackData = prevTrackData;
      this.panels.renderStylePanel();
      this.renderPreview();
      this.showToast(err?.message || 'Tracking failed');
    }
  }

  cancelMotionTrack() {
    this.trackerEngine.cancel();
    this.trackerState.isTracking = false;
    this.panels.renderStylePanel();
  }

  pinNewTrackedText(srcLayer, textContent, offsetY = -65) {
    if (!srcLayer?.trackData?.points?.length) return this.showToast('Track the video target first');
    const startF = srcLayer.trackData.startFrame;
    this.mutateProject(() => {
      const txtLayer = TimelineEngine.createTextLayer(this.project, startF);
      txtLayer.name = textContent.slice(0, 18);
      txtLayer.textProps.text = textContent;
      txtLayer.textProps.fontSize = 54;
      TimelineEngine.addLayer(this.project, txtLayer);
      TrackerEngine.applyTrackToLayer(txtLayer, srcLayer.trackData, {
        offsetX: 0,
        offsetY,
        applyScale: this.trackerState.trackScale,
        use3DDepth: this.trackerState.use3DDepth,
        applyTilt3D: this.trackerState.trackTilt3D,
        autoTrim: true,
        exitMode: this.trackerState.exitMode
      });
      this.selectedLayerId = txtLayer.id;
    });
    this.trackerState.active = false;
    this.syncTrackerOverlay();
    this.hideOpenSheets();
    this.showToast('Pinned new Text to 3D tracked path');
  }

  pinExistingLayerToTrack(srcLayer, targetLayerId) {
    if (!srcLayer?.trackData?.points?.length) return this.showToast('Track the video target first');
    const target = this.project.layers.find((l) => l.id === targetLayerId);
    if (!target) return;

    const anchorPt = srcLayer.trackData.points.find((p) => p.frame === srcLayer.trackData.anchorFrame) || srcLayer.trackData.points[0];
    const curTf = KeyframeEngine.getTransformAtFrame(target, anchorPt.frame);
    const dx = curTf.x - anchorPt.x;
    const dy = curTf.y - anchorPt.y;
    const keepOffset = Math.hypot(dx, dy) < Math.max(this.project.width, this.project.height) * 0.45;

    this.mutateProject(() => {
      TrackerEngine.applyTrackToLayer(target, srcLayer.trackData, {
        offsetX: keepOffset ? dx : 0,
        offsetY: keepOffset ? dy : -65,
        applyScale: this.trackerState.trackScale,
        use3DDepth: this.trackerState.use3DDepth,
        applyTilt3D: this.trackerState.trackTilt3D,
        autoTrim: true,
        exitMode: this.trackerState.exitMode
      });
      this.selectedLayerId = target.id;
    });
    this.trackerState.active = false;
    this.syncTrackerOverlay();
    this.hideOpenSheets();
    this.showToast(`Pinned "${target.name}" to 3D tracked path`);
  }

  async registerFontFace(fontItem) {
    try {
      const face = new FontFace(fontItem.name, `url("${fontItem.url}")`);
      const loaded = await face.load();
      document.fonts.add(loaded);
    } catch {}
  }

  importCustomFont() {
    if (window.AndroidBridge?.pickFontFile) {
      window.AndroidBridge.pickFontFile();
    } else {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.ttf,.otf,.woff,.woff2';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        const name = f.name.replace(/\.[^.]+$/, '');
        window.__mfNative.onFontImported({ id: `f_${Date.now()}`, name, fileName: f.name, url });
      };
      inp.click();
    }
  }

  async autoMatchLayerColor(layer, existingPoolLayers, opts = {}) {
    if (!layer || !this.colorMatchEngine) return null;
    if (!opts.force && this.project.settings?.autoColorMatch === false) return null;
    if (!this.project.layers.some((l) => l.id === layer.id)) return null;

    const result = await this.colorMatchEngine.autoMatchLayerToTimeline(
      this.project,
      layer,
      existingPoolLayers,
      this.mediaMap,
      opts.intensity ?? (layer.colorMatch?.intensity ?? 0.78)
    );
    if (result) {
      this.renderPreview();
      this.refreshTimelineOnly();
      this.panels.renderStylePanel();
      this.scheduleAutosave();
      if (!opts.silent) {
        this.showToast(`Color matched "${layer.name}" to timeline palette`);
      }
    }
    return result;
  }

  async matchSelectedToTimelinePalette() {
    const layer = this.getSelectedLayer();
    if (!layer || (layer.type !== 'video' && layer.type !== 'image')) {
      return this.showToast('Select a video or image layer first');
    }
    const existingOthers = this.project.layers.filter((l) => l.id !== layer.id);
    if (existingOthers.length === 0) {
      return this.showToast('Add at least one other visual clip to match');
    }
    this.pushUndo();
    const res = await this.autoMatchLayerColor(layer, existingOthers, { force: true, silent: true });
    if (res) {
      this.showToast('Matched color palette to existing timeline');
    } else {
      this.showToast('No visual palette found on existing timeline');
    }
  }

  async addMediaToTimeline(mediaItem, opts = {}) {
    const existingBefore = [...this.project.layers];
    const asOverlay = Boolean(opts.asOverlay || this.mediaPickerContext === 'overlay');
    this.mediaPickerContext = null;

    let createdLayer = null;
    this.mutateProject(() => {
      if (mediaItem.type === 'audio' || asOverlay) {
        createdLayer = TimelineEngine.createMediaLayer(this.project, mediaItem, this.currentFrame, {
          trackRole: mediaItem.type === 'audio' ? null : 'overlay'
        });
        TimelineEngine.addLayer(this.project, createdLayer);
        TimelineEngine.normalizeTrackZOrder(this.project);
      } else {
        createdLayer = TimelineEngine.createMediaLayer(this.project, mediaItem, 0, { trackRole: 'main' });
        TimelineEngine.addToMainTrack(this.project, createdLayer);
      }
      this.selectedLayerId = createdLayer.id;
    });
    this.hideOpenSheets();
    this.showToast(`Added "${mediaItem.name}" to ${asOverlay && mediaItem.type !== 'audio' ? 'Overlay' : 'Main Track'}`);

    if (createdLayer && (mediaItem.type === 'video' || mediaItem.type === 'image')) {
      await this.autoMatchLayerColor(createdLayer, existingBefore);
    }
  }

  async deleteMediaFromLibrary(mediaItem) {
    await ProjectStorage.deleteMediaItem(mediaItem.id);
    this.audioEngine.purgeMediaCache(mediaItem.id);
    this.renderer.purgeMediaCache(mediaItem.id);
    this.colorMatchEngine?.purgeMediaCache(mediaItem.id);
    this.timelineView?.filmstripCache?.delete(mediaItem.id);
    if (typeof mediaItem.url === 'string' && mediaItem.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(mediaItem.url); } catch {}
    }
    if (typeof mediaItem.thumbUrl === 'string' && mediaItem.thumbUrl.startsWith('blob:') && mediaItem.thumbUrl !== mediaItem.url) {
      try { URL.revokeObjectURL(mediaItem.thumbUrl); } catch {}
    }
    if (window.AndroidBridge?.deleteMediaFile && mediaItem.fileName) {
      window.AndroidBridge.deleteMediaFile(mediaItem.fileName);
    }
    this.mediaItems = this.mediaItems.filter((m) => m.id !== mediaItem.id);
    this.rebuildMediaMap();
    this.panels.renderMediaLibrary(this.mediaItems);
    this.updateAllUI();
  }

  async getSavedProjects() {
    return ProjectStorage.listProjects();
  }

  async openProjectById(id) {
    const found = await ProjectStorage.getProject(id);
    if (!found) return;
    this.pause();
    this.project = deserializeProject(found);
    this.history.clear();
    this.currentFrame = 0;
    this.selectedLayerId = this.project.layers[0]?.id || null;
    this.hideOpenSheets();
    this.setSaveState(true);
    this.updateAllUI();
    this.showToast(`Opened "${this.project.name}"`);
  }

  async renameProjectById(id, newName) {
    if (id === this.project.id) {
      this.mutateProject(() => { this.project.name = newName; });
    } else {
      const p = await ProjectStorage.getProject(id);
      if (p) {
        p.name = newName;
        await ProjectStorage.saveProject(p);
      }
    }
    this.panels.renderProjectsList();
  }

  async deleteProjectById(id) {
    const list = await ProjectStorage.listProjects();
    if (list.length <= 1) {
      this.showToast('Keep at least one project');
      return;
    }
    await ProjectStorage.deleteProject(id);
    if (id === this.project.id) {
      const remaining = await ProjectStorage.listProjects();
      this.project = deserializeProject(remaining[0]);
      this.history.clear();
      this.currentFrame = 0;
      this.selectedLayerId = this.project.layers[0]?.id || null;
      this.setSaveState(true);
      this.updateAllUI();
    }
    this.panels.renderProjectsList();
  }

  hideOpenSheets() {
    document.querySelectorAll('.offcanvas.show').forEach((el) => {
      bootstrap.Offcanvas.getInstance(el)?.hide();
    });
  }

  bindOverlayGestures() {
    const overlay = document.getElementById('overlayCanvas');
    const pointers = new Map();
    let gesture = null;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    overlay.addEventListener('pointerdown', (e) => {
      const rect = overlay.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      pointers.set(e.pointerId, { x: px, y: py });
      try { overlay.setPointerCapture(e.pointerId); } catch {}

      // 2-finger Blender Camera Pinch-Zoom & Pan inside preview box
      if (pointers.size === 2 && this.viewport3D?.enabled) {
        const pts = [...pointers.values()];
        const startDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        const startMidX = (pts[0].x + pts[1].x) / 2;
        const startMidY = (pts[0].y + pts[1].y) / 2;
        const alreadyPushed = Boolean(gesture?.undoPushed);
        if (!alreadyPushed) this.pushUndo();
        const origCam = KeyframeEngine.getCameraAtFrame(this.project.camera, this.currentFrame);
        this.project.camera.enabled = true;
        gesture = {
          mode: 'cam_pinch_pan',
          undoPushed: true,
          startDist,
          startMidX,
          startMidY,
          origCam,
          sx: Math.max(0.05, rect.width / Math.max(1, this.project.width)),
          sy: Math.max(0.05, rect.height / Math.max(1, this.project.height))
        };
        return;
      }

      if (pointers.size > 1) return;

      const hit = this.renderer.hitTestOverlay(px, py);

      if (hit === 'tracker') {
        const tb = this.renderer.lastTrackerBox;
        this.trackerState.dragging = true;
        this.trackerState.followTrackedPoints = false;
        gesture = {
          mode: 'tracker',
          undoPushed: false,
          startX: px,
          startY: py,
          origTX: this.trackerState.targetX,
          origTY: this.trackerState.targetY,
          box: tb
        };
        return;
      }

      if (hit === 'cam_orbit') {
        const origCam = KeyframeEngine.getCameraAtFrame(this.project.camera, this.currentFrame);
        const pendingLayerPick = this.viewport3D.tool !== 'camera'
          ? this.renderer.hitTestAnyLayer(px, py)
          : null;
        this.project.camera.enabled = true;
        gesture = {
          mode: 'cam_orbit',
          undoPushed: false,
          startX: px,
          startY: py,
          origCam,
          pendingLayerPick,
          lastRecFrame: -999
        };
        return;
      }

      let layer = this.getSelectedLayer();
      if (!hit) {
        const picked = this.renderer.hitTestAnyLayer(px, py);
        if (picked) {
          this.selectLayer(picked);
          layer = this.getSelectedLayer();
          if (layer && !layer.locked && this.renderer.lastOverlayBox) {
            const box = this.renderer.lastOverlayBox;
            const origTf = KeyframeEngine.getTransformAtFrame(layer, this.currentFrame);
            gesture = {
              mode: 'move',
              undoPushed: false,
              startX: px,
              startY: py,
              origTf,
              layer,
              box,
              gizmo: this.renderer.lastGizmoHandles,
              startAngle: 0,
              startDist: 10
            };
          }
          return;
        }
        if (!this.viewport3D?.enabled && layer) {
          gesture = { mode: 'deselect_tap', undoPushed: false, startX: px, startY: py };
        }
        return;
      }

      if (!layer || layer.locked) return;

      const box = this.renderer.lastOverlayBox;
      const gizmo = this.renderer.lastGizmoHandles;
      const origTf = KeyframeEngine.getTransformAtFrame(layer, this.currentFrame);
      const bcx = box?.cx ?? px;
      const bcy = box?.cy ?? py;

      gesture = {
        mode: hit,
        undoPushed: false,
        startX: px,
        startY: py,
        origTf,
        layer,
        box,
        gizmo,
        startAngle: Math.atan2(py - bcy, px - bcx),
        startDist: Math.max(10, Math.hypot(px - bcx, py - bcy))
      };
    });

    overlay.addEventListener('pointermove', (e) => {
      const rect = overlay.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: px, y: py });
      }
      if (!gesture) return;

      if (gesture.mode === 'cam_pinch_pan' && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const curDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        const curMidX = (pts[0].x + pts[1].x) / 2;
        const curMidY = (pts[0].y + pts[1].y) / 2;
        const { origCam, startDist, startMidX, startMidY, sx, sy } = gesture;
        const nextZoom = clamp(Number((origCam.zoom * (curDist / startDist)).toFixed(2)), 0.25, 4.0);
        const nextX = Math.round(origCam.x - (curMidX - startMidX) / sx);
        const nextY = Math.round(origCam.y - (curMidY - startMidY) / sy);
        const canKeyNow = !this.isPlaying || Math.abs(this.currentFrame - (gesture.lastRecFrame ?? -999)) >= 2;
        this.setCameraProp('zoom', nextZoom, false, canKeyNow ? null : false);
        this.setCameraProp('x', nextX, false, canKeyNow ? null : false);
        this.setCameraProp('y', nextY, false, canKeyNow ? null : false);
        if (canKeyNow) gesture.lastRecFrame = this.currentFrame;
        gesture.lastZoom = nextZoom;
        gesture.lastX = nextX;
        gesture.lastY = nextY;
        const recPrefix = this.viewport3D.autoRecord ? 'REC · ' : '';
        this.set3DHudReadout(`${recPrefix}Pan (${nextX}, ${nextY}) · Zoom ${nextZoom.toFixed(2)}x`);
        return;
      }

      if (gesture.mode === 'cam_orbit') {
        const dx = px - gesture.startX;
        const dy = py - gesture.startY;
        if (!gesture.undoPushed && Math.hypot(dx, dy) < 4) return;
        if (!gesture.undoPushed) {
          this.pushUndo();
          gesture.undoPushed = true;
        }
        const nextRY = clamp(Math.round(gesture.origCam.rotY + dx * 0.38), -175, 175);
        const nextRX = clamp(Math.round(gesture.origCam.rotX + dy * 0.38), -85, 85);
        const canKeyNow = !this.isPlaying || Math.abs(this.currentFrame - (gesture.lastRecFrame ?? -999)) >= 2;
        this.setCameraProp('rotY', nextRY, false, canKeyNow ? null : false);
        this.setCameraProp('rotX', nextRX, false, canKeyNow ? null : false);
        if (canKeyNow) gesture.lastRecFrame = this.currentFrame;
        gesture.lastRY = nextRY;
        gesture.lastRX = nextRX;
        const recPrefix = this.viewport3D.autoRecord ? 'REC · ' : '';
        this.set3DHudReadout(`${recPrefix}Orbit Y:${nextRY}° X:${nextRX}°`);
        return;
      }

      if (gesture.mode === 'tracker') {
        const dx = (px - gesture.startX) / gesture.box.sx;
        const dy = (py - gesture.startY) / gesture.box.sy;
        this.trackerState.targetX = clamp(Math.round(gesture.origTX + dx), -this.project.width / 2, this.project.width / 2);
        this.trackerState.targetY = clamp(Math.round(gesture.origTY + dy), -this.project.height / 2, this.project.height / 2);
        const trkX = document.getElementById('trkX');
        const trkY = document.getElementById('trkY');
        if (trkX) trkX.value = String(this.trackerState.targetX);
        if (trkY) trkY.value = String(this.trackerState.targetY);
        this.renderPreview();
        return;
      }

      const { mode, startX, startY, origTf, layer, box, gizmo, startAngle, startDist } = gesture;
      if (!gesture.undoPushed) {
        if (Math.hypot(px - startX, py - startY) < 3) return;
        this.pushUndo();
        gesture.undoPushed = true;
      }

      if (mode === 'gizmo_x' && gizmo?.x) {
        const proj = (px - startX) * gizmo.x.dirX + (py - startY) * gizmo.x.dirY;
        const nx = Math.round(origTf.x + proj / Math.max(0.15, box.sx));
        this.setLayerTransformProp(layer, 'x', nx, false);
        this.set3DHudReadout(`Move X: ${nx}px`);
      } else if (mode === 'gizmo_y' && gizmo?.y) {
        const proj = (px - startX) * gizmo.y.dirX + (py - startY) * gizmo.y.dirY;
        const ny = Math.round(origTf.y - proj / Math.max(0.15, box.sy));
        this.setLayerTransformProp(layer, 'y', ny, false);
        this.set3DHudReadout(`Move Y: ${ny}px`);
      } else if (mode === 'gizmo_z' && gizmo?.z) {
        const proj = (px - startX) * gizmo.z.dirX + (py - startY) * gizmo.z.dirY;
        const nz = Math.round((origTf.z || 0) + (proj * 1.35) / Math.max(0.15, box.sx));
        this.setLayerTransformProp(layer, 'z', nz, false);
        this.set3DHudReadout(`Depth Z: ${nz}`);
      } else if (mode === 'gizmo_rot_xy') {
        const dx = px - startX;
        const dy = py - startY;
        const nRY = Math.round((origTf.rotY || 0) + dx * 0.65);
        const nRX = Math.round((origTf.rotX || 0) - dy * 0.65);
        this.setLayerTransformProp(layer, 'rotY', nRY, false);
        this.setLayerTransformProp(layer, 'rotX', nRX, false);
        this.set3DHudReadout(`Tilt X:${nRX}° Yaw Y:${nRY}°`);
      } else if (mode === 'gizmo_rot_z' || mode === 'rotate') {
        const curAngle = Math.atan2(py - box.cy, px - box.cx);
        const degDelta = ((curAngle - startAngle) * 180) / Math.PI;
        const nRot = Math.round(origTf.rotation + degDelta);
        this.setLayerTransformProp(layer, 'rotation', nRot, false);
        if (this.viewport3D.enabled) this.set3DHudReadout(`Roll Z: ${nRot}°`);
      } else if (mode === 'move') {
        const dx = (px - startX) / box.sx;
        const dy = (py - startY) / box.sy;
        const nx = Math.round(origTf.x + dx);
        const ny = Math.round(origTf.y + dy);
        this.setLayerTransformProp(layer, 'x', nx, false);
        this.setLayerTransformProp(layer, 'y', ny, false);
        if (this.viewport3D.enabled) this.set3DHudReadout(`Pos (${nx}, ${ny})`);
      } else if (mode === 'scale') {
        const curDist = Math.max(10, Math.hypot(px - box.cx, py - box.cy));
        const ratio = curDist / startDist;
        const sxVal = Number((origTf.scaleX * ratio).toFixed(2));
        const syVal = Number((origTf.scaleY * ratio).toFixed(2));
        this.setLayerTransformProp(layer, 'scaleX', sxVal, false);
        this.setLayerTransformProp(layer, 'scaleY', syVal, false);
        if (this.viewport3D.enabled) this.set3DHudReadout(`Scale ${sxVal.toFixed(2)}x`);
      }
    });

    // Mouse-wheel dolly in 3D Viewport (desktop / trackpad / emulator)
    overlay.addEventListener('wheel', (e) => {
      if (!this.viewport3D?.enabled) return;
      e.preventDefault();
      const cam = KeyframeEngine.getCameraAtFrame(this.project.camera, this.currentFrame);
      const nextZ = clamp(Math.round(cam.z - e.deltaY * 0.65), -1500, 1200);
      this.setCameraProp('z', nextZ, false);
      const recPrefix = this.viewport3D.autoRecord ? 'REC · ' : '';
      this.set3DHudReadout(`${recPrefix}Dolly Z: ${nextZ}`);
      this.scheduleAutosave();
    }, { passive: false });

    const endGesture = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size > 0 && gesture?.mode === 'cam_pinch_pan') {
        // Keep remaining finger from jumping after lifting one finger of pinch
        if (this.viewport3D.autoRecord && gesture.lastZoom !== undefined) {
          this.setCameraProp('zoom', gesture.lastZoom, false, true);
          this.setCameraProp('x', gesture.lastX, false, true);
          this.setCameraProp('y', gesture.lastY, false, true);
        }
        gesture = null;
        this.onTimelineMutated();
        return;
      }
      if (pointers.size === 0 && gesture) {
        const g = gesture;
        gesture = null;
        if (g.mode === 'deselect_tap') {
          const rect = overlay.getBoundingClientRect();
          const upX = e.clientX - rect.left;
          const upY = e.clientY - rect.top;
          if (Math.hypot(upX - g.startX, upY - g.startY) <= 8) {
            this.selectLayer(null);
          }
          return;
        }
        if (g.mode === 'cam_orbit' && !g.undoPushed) {
          if (g.pendingLayerPick) {
            this.selectLayer(g.pendingLayerPick);
          }
          return;
        }
        if (g.mode === 'cam_orbit' && this.viewport3D.autoRecord && g.lastRY !== undefined) {
          this.setCameraProp('rotY', g.lastRY, false, true);
          this.setCameraProp('rotX', g.lastRX, false, true);
        }
        if (g.mode === 'cam_pinch_pan' && this.viewport3D.autoRecord && g.lastZoom !== undefined) {
          this.setCameraProp('zoom', g.lastZoom, false, true);
          this.setCameraProp('x', g.lastX, false, true);
          this.setCameraProp('y', g.lastY, false, true);
        }
        if (g.mode === 'tracker') {
          this.trackerState.dragging = false;
          this.renderPreview();
        } else if (g.undoPushed) {
          this.onTimelineMutated();
        }
      }
    };
    overlay.addEventListener('pointerup', endGesture);
    overlay.addEventListener('pointercancel', endGesture);
  }

  bindNativeBridgeCallbacks() {
    window.__mfNative = {
      getPixabayApiKey: () => window.AndroidBridge?.getPixabayApiKey?.() || '',
      handleBack: () => {
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
          bootstrap.Modal.getInstance(openModal)?.hide();
          return true;
        }
        const openSheet = document.querySelector('.offcanvas.show');
        if (openSheet) {
          bootstrap.Offcanvas.getInstance(openSheet)?.hide();
          return true;
        }
        return false;
      },
      onVoiceoverState: (state, msg) => {
        const vo = this.voiceoverState;
        if (state === 'recording') {
          vo.recording = true;
          vo.statusText = msg || 'Recording voiceover... Tap Stop when done';
          this.startVoiceoverTimer();
        } else {
          vo.recording = false;
          this.stopVoiceoverTimer();
          vo.statusText = state === 'denied' || state === 'error'
            ? (msg || 'Microphone unavailable')
            : 'Tap Mic to record voiceover at playhead';
          if (state === 'denied' || state === 'error') {
            this.showToast(vo.statusText);
          }
        }
        this.panels.renderAudioToolsPanel();
      },
      onTtsState: (state, msg) => {
        this.ttsStatusText = msg || (state === 'done' ? 'Voice clip generated on timeline!' : 'TTS status updated');
        if (state === 'error') this.showToast(this.ttsStatusText);
        else if (state === 'done') this.showToast('Added AI Voiceover track at playhead');
        const lbl = document.getElementById('lblTtsStatus');
        if (lbl) lbl.textContent = this.ttsStatusText;
      },
      onMediaImportStarted: (count) => {
        this.showToast(`Importing ${count} file(s)...`);
      },
      onMediaImported: async (items) => {
        if (!Array.isArray(items) || items.length === 0) return;
        const imported = [];
        for (const raw of items) {
          const item = { ...raw, addedAt: Date.now() };
          await ProjectStorage.saveMediaItem(item);
          this.mediaItems.unshift(item);
          imported.push(item);
          if (item.type === 'audio' || item.type === 'video') {
            this.audioEngine.loadBuffer(item).then(() => this.refreshTimelineOnly());
          }
        }
        this.rebuildMediaMap();

        const intent = this.importIntent || 'library';
        this.importIntent = 'library';

        if (intent === 'replace_selected' && this.getSelectedLayer()) {
          this.replaceSelectedWithMedia(imported[0]);
          this.panels.renderMediaLibrary(this.mediaItems);
          return;
        }

        this.mediaPickerContext = null;
        this.panels.renderMediaLibrary(this.mediaItems);

        if (intent === 'main_append' || intent === 'overlay_at_playhead' || intent === 'audio_at_playhead') {
          const existingBeforeImport = [...this.project.layers];
          const createdLayers = [];
          let cursor = intent === 'main_append'
            ? TimelineEngine.getMainTrackEndFrame(this.project)
            : this.currentFrame;

          let firstCreated = null;
          let lastCreated = null;
          this.mutateProject(() => {
            // Adopt orientation on empty project when first visual media is imported
            if (intent === 'main_append' && this.project.layers.length === 0) {
              const firstVis = imported.find((m) => (m.type === 'video' || m.type === 'image') && m.width > 0 && m.height > 0);
              if (firstVis) {
                if (firstVis.height > firstVis.width) {
                  this.project.width = 1080;
                  this.project.height = 1920;
                } else if (firstVis.width === firstVis.height) {
                  this.project.width = 1080;
                  this.project.height = 1080;
                } else {
                  this.project.width = 1920;
                  this.project.height = 1080;
                }
              }
            }
            for (const item of imported) {
              if (intent === 'main_append' && item.type !== 'audio') {
                const layer = TimelineEngine.createMediaLayer(this.project, item, cursor, { trackRole: 'main' });
                TimelineEngine.addToMainTrack(this.project, layer);
                createdLayers.push(layer);
                if (!firstCreated) firstCreated = layer;
                lastCreated = layer;
                cursor = layer.endFrame;
              } else {
                const role = (intent === 'overlay_at_playhead' && item.type !== 'audio') ? 'overlay' : null;
                const layer = TimelineEngine.createMediaLayer(this.project, item, cursor, { trackRole: role });
                TimelineEngine.addLayer(this.project, layer);
                TimelineEngine.normalizeTrackZOrder(this.project);
                createdLayers.push(layer);
                if (!firstCreated) firstCreated = layer;
                lastCreated = layer;
                cursor = layer.endFrame;
              }
            }
            if (lastCreated) this.selectedLayerId = lastCreated.id;
          });
          this.hideOpenSheets();
          if (firstCreated) await this.seekToFrame(firstCreated.startFrame);

          // Automatically match color palette of newly added visual clips to existing timeline
          const pool = [...existingBeforeImport];
          let matchedAny = false;
          for (const created of createdLayers) {
            if (created.type === 'video' || created.type === 'image') {
              const matched = await this.autoMatchLayerColor(created, pool, { silent: true });
              if (matched) matchedAny = true;
              pool.push(created);
            }
          }
          this.showToast(
            matchedAny
              ? `Added ${imported.length} clip(s) · Auto color matched`
              : `Added ${imported.length} clip(s) to timeline`
          );
        } else {
          this.showToast(`Imported ${imported.length} media item(s)`);
        }
      },
      onProjectJsonImported: async (jsonText) => {
        try {
          const imported = deserializeProject(jsonText);
          await ProjectStorage.saveProject(imported);
          this.project = imported;
          this.history.clear();
          this.currentFrame = 0;
          this.selectedLayerId = this.project.layers[0]?.id || null;
          this.hideOpenSheets();
          this.updateAllUI();
          this.showToast(`Imported "${imported.name}"`);
        } catch (err) {
          this.showToast('Invalid project JSON file');
        }
      },
      onProjectJsonExported: () => {
        this.showToast('Project JSON saved');
      },
      onFontImported: async (fontObj) => {
        if (!fontObj || !fontObj.url) return;
        await ProjectStorage.saveFontItem(fontObj);
        this.customFonts.push(fontObj);
        await this.registerFontFace(fontObj);
        const layer = this.getSelectedLayer();
        if (layer?.type === 'text' && layer.textProps) {
          this.mutateProject(() => { layer.textProps.fontFamily = fontObj.name; });
        } else {
          this.panels.renderStylePanel();
        }
        this.showToast(`Loaded font "${fontObj.name}"`);
      }
    };
  }

  bindUIEvents() {
    document.addEventListener('hidden.bs.offcanvas', () => {
      this.stopTemplateLivePreview();
    });

    document.getElementById('btnGroupChecked').onclick = () => this.groupSelectedLayersAction();

    // Top Toolbar
    document.getElementById('btnProjects').onclick = async () => {
      await this.panels.renderProjectsList();
      bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('sheetProjects')).show();
    };
    document.getElementById('btnRenameQuick').onclick = () => {
      const next = prompt('Rename Project:', this.project.name);
      if (next && next.trim()) {
        this.mutateProject(() => { this.project.name = next.trim(); });
      }
    };
    this.undoAction = () => {
      const prev = this.history.undo(this.project);
      if (prev) {
        this.project = prev;
        this.currentFrame = Math.min(this.currentFrame, this.project.durationFrames);
        if (this.selectedLayerId && !this.project.layers.some((l) => l.id === this.selectedLayerId)) {
          this.selectedLayerId = this.project.layers[0]?.id || null;
        }
        this.selectedLayerIds = this.selectedLayerId ? new Set([this.selectedLayerId]) : new Set();
        this.scheduleAutosave();
        this.updateAllUI();
      }
    };
    this.redoAction = () => {
      const next = this.history.redo(this.project);
      if (next) {
        this.project = next;
        this.currentFrame = Math.min(this.currentFrame, this.project.durationFrames);
        if (this.selectedLayerId && !this.project.layers.some((l) => l.id === this.selectedLayerId)) {
          this.selectedLayerId = this.project.layers[0]?.id || null;
        }
        this.selectedLayerIds = this.selectedLayerId ? new Set([this.selectedLayerId]) : new Set();
        this.scheduleAutosave();
        this.updateAllUI();
      }
    };
    document.getElementById('btnUndo').onclick = () => this.undoAction();
    document.getElementById('btnRedo').onclick = () => this.redoAction();

    // Project Settings
    document.getElementById('btnProjectSettings').onclick = () => {
      document.getElementById('inpProjectName').value = this.project.name;
      const resVal = `${this.project.width}x${this.project.height}`;
      const sel = document.getElementById('selProjectRes');
      if ([...sel.options].some((o) => o.value === resVal)) sel.value = resVal;
      document.getElementById('selProjectFps').value = String(this.project.fps);
      document.getElementById('inpProjectDuration').value = String(Math.round(this.project.durationFrames / this.project.fps));
      document.getElementById('inpProjectBg').value = this.project.backgroundColor || '#05070B';
      const rippleChk = document.getElementById('chkSettingRipple');
      if (rippleChk) rippleChk.checked = this.project.settings?.rippleMode !== false;
      const cmChk = document.getElementById('chkSettingAutoColorMatch');
      if (cmChk) cmChk.checked = this.project.settings?.autoColorMatch !== false;
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalSettings')).show();
    };

    document.getElementById('btnApplySettings').onclick = () => {
      const [w, h] = document.getElementById('selProjectRes').value.split('x').map(Number);
      const fps = Number(document.getElementById('selProjectFps').value) || 30;
      const durSec = Math.max(2, Number(document.getElementById('inpProjectDuration').value) || 10);
      const bg = document.getElementById('inpProjectBg').value;
      const name = document.getElementById('inpProjectName').value.trim() || this.project.name;
      const rippleMode = document.getElementById('chkSettingRipple')?.checked !== false;
      const autoColorMatch = document.getElementById('chkSettingAutoColorMatch')?.checked !== false;
      this.mutateProject(() => {
        this.project.name = name;
        this.project.width = w;
        this.project.height = h;
        this.project.fps = fps;
        this.project.durationFrames = fps * durSec;
        this.project.backgroundColor = bg;
        if (!this.project.settings) this.project.settings = {};
        this.project.settings.rippleMode = rippleMode;
        this.project.settings.autoColorMatch = autoColorMatch;
        if (rippleMode) {
          TimelineEngine.reflowMainTrack(this.project, 0);
        }
        this.currentFrame = Math.min(this.currentFrame, this.project.durationFrames);
      });
      bootstrap.Modal.getInstance(document.getElementById('modalSettings'))?.hide();
    };

    // HUD toggles
    document.getElementById('btnOpenTrackerQuick').onclick = () => {
      this.openTrackerUI();
    };
    document.getElementById('btnToggleGrid').onclick = () => {
      this.project.settings.showGrid = !this.project.settings.showGrid;
      this.onTimelineMutated();
    };
    document.getElementById('btnResetCameraQuick').onclick = () => {
      this.toggleViewport3D();
    };
    document.getElementById('btn3DToolMove').onclick = () => this.setViewport3DTool('move');
    document.getElementById('btn3DToolRotate').onclick = () => this.setViewport3DTool('rotate');
    document.getElementById('btn3DToolScale').onclick = () => this.setViewport3DTool('scale');
    document.getElementById('btn3DToolCam').onclick = () => this.setViewport3DTool('camera');
    document.getElementById('btn3DCamAutoRec')?.addEventListener('click', () => this.toggleViewport3DAutoRecord());
    document.getElementById('btn3DCamSmoothPath')?.addEventListener('click', () => this.smoothCameraPath());
    document.getElementById('btn3DCamKf').onclick = () => this.keyframeCameraAtPlayhead();
    document.getElementById('btn3DCamReset').onclick = () => this.resetCameraRig();
    document.getElementById('btn3DOpenSheet').onclick = () => {
      this.panels.activeStyleTab = 'camera';
      this.panels.renderStylePanel();
      bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('sheetStyle')).show();
    };

    // Transport Controls
    document.getElementById('btnJumpStart').onclick = () => this.seekToFrame(0);
    document.getElementById('btnStepBack').onclick = () => { this.pause(); this.seekToFrame(this.currentFrame - 1); };
    document.getElementById('btnPlayPause').onclick = () => this.togglePlay();
    document.getElementById('btnStepForward').onclick = () => { this.pause(); this.seekToFrame(this.currentFrame + 1); };
    document.getElementById('btnSplitClip').onclick = () => this.splitSelectedAtPlayhead();
    document.getElementById('btnToggleSnap').onclick = () => {
      this.project.settings.snapToTimeline = !this.project.settings.snapToTimeline;
      this.onTimelineMutated();
      this.showToast(this.project.settings.snapToTimeline ? 'Snapping ON' : 'Snapping OFF');
    };
    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const key = String(e.key || '').toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (e.altKey) return;
        if (key === 'z' && e.shiftKey) {
          e.preventDefault();
          this.redoAction();
        } else if (key === 'z') {
          e.preventDefault();
          this.undoAction();
        } else if (key === 'y') {
          e.preventDefault();
          this.redoAction();
        } else if (key === 'c') {
          e.preventDefault();
          this.copySelectedLayers();
        } else if (key === 'v') {
          e.preventDefault();
          this.pasteCopiedLayers();
        } else if (key === 'd') {
          e.preventDefault();
          this.duplicateSelectedLayer();
        } else if (key === 'g') {
          e.preventDefault();
          this.groupSelectedLayersAction();
        }
        return;
      }
      if (e.altKey) return;
      if (key === ' ') {
        e.preventDefault();
        this.togglePlay();
      } else if (key === 'j') {
        e.preventDefault();
        this.setShuttlePlay(-1);
      } else if (key === 'k') {
        e.preventDefault();
        this.setShuttlePlay(0);
      } else if (key === 'l') {
        e.preventDefault();
        this.setShuttlePlay(1);
      } else if (key === 'arrowup') {
        e.preventDefault();
        this.jumpCutPoint(-1);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        this.jumpCutPoint(1);
      } else if (key === 'home') {
        e.preventDefault();
        this.seekToFrame(0);
      } else if (key === 'end') {
        e.preventDefault();
        this.seekToFrame(this.project.durationFrames);
      } else if (key === 'm') {
        e.preventDefault();
        this.toggleMarkerAtPlayhead();
      } else if (key === 'b') {
        e.preventDefault();
        this.toggleBeatAtPlayhead();
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        this.timelineView.zoomToFit(this.project);
        this.refreshTimelineOnly();
      } else if (key === '+' || key === '=') {
        e.preventDefault();
        this.timelineView.zoomIn(this.currentFrame);
        this.refreshTimelineOnly();
      } else if (key === '-') {
        e.preventDefault();
        this.timelineView.zoomOut(this.currentFrame);
        this.refreshTimelineOnly();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        this.deleteSelectedLayer();
      }
    });
    document.getElementById('btnToggleRipple')?.addEventListener('click', () => {
      this.toggleRippleMode();
    });
    document.getElementById('btnZoomIn').onclick = () => { this.timelineView.zoomIn(this.currentFrame); this.refreshTimelineOnly(); };
    document.getElementById('btnZoomOut').onclick = () => { this.timelineView.zoomOut(this.currentFrame); this.refreshTimelineOnly(); };
    document.getElementById('btnZoomFit')?.addEventListener('click', () => {
      this.timelineView.zoomToFit(this.project);
      this.refreshTimelineOnly();
      this.showToast('Zoomed timeline to fit clips');
    });
    window.addEventListener('resize', () => {
      this.timelineView.redrawRulerOnly();
      this.renderPreview();
    });

    document.getElementById('btnQuickKeyframe').onclick = () => {
      const layer = this.getSelectedLayer();
      if (!layer) return this.showToast('Select a layer first');
      this.mutateProject(() => {
        const exists = KeyframeEngine.hasAnyKeyframeAtFrame(layer, this.currentFrame);
        if (exists) {
          if (layer.keyframes) {
            Object.keys(layer.keyframes).forEach((p) => KeyframeEngine.removeKeyframe(layer, p, this.currentFrame));
          }
          this.showToast(`Removed keyframes at F${this.currentFrame}`);
        } else if (layer.type === 'audio') {
          const vol = KeyframeEngine.getValueAtFrame(layer, 'volume', this.currentFrame, layer.audioProps?.volume ?? 1);
          KeyframeEngine.setKeyframe(layer, 'volume', this.currentFrame, vol);
          this.showToast(`Keyframed volume at F${this.currentFrame}`);
        } else {
          const tf = KeyframeEngine.getTransformAtFrame(layer, this.currentFrame);
          KeyframeEngine.setKeyframe(layer, 'x', this.currentFrame, tf.x);
          KeyframeEngine.setKeyframe(layer, 'y', this.currentFrame, tf.y);
          KeyframeEngine.setKeyframe(layer, 'z', this.currentFrame, tf.z || 0);
          KeyframeEngine.setKeyframe(layer, 'scaleX', this.currentFrame, tf.scaleX);
          KeyframeEngine.setKeyframe(layer, 'scaleY', this.currentFrame, tf.scaleY);
          KeyframeEngine.setKeyframe(layer, 'rotation', this.currentFrame, tf.rotation);
          KeyframeEngine.setKeyframe(layer, 'rotX', this.currentFrame, tf.rotX || 0);
          KeyframeEngine.setKeyframe(layer, 'rotY', this.currentFrame, tf.rotY || 0);
          KeyframeEngine.setKeyframe(layer, 'opacity', this.currentFrame, tf.opacity);
          this.showToast(`Keyframed transforms at F${this.currentFrame}`);
        }
      });
    };

    document.getElementById('btnCompactAllTracks')?.addEventListener('click', () => {
      this.toggleAllTracksCompact();
    });

    document.getElementById('btnTimelineQuickAdd')?.addEventListener('click', () => {
      this.triggerDeviceVisualPick('main_append');
    });

    // Projects Sheet actions
    document.getElementById('btnNewProject').onclick = async () => {
      const name = prompt('New Project Name:', 'New Motion Project');
      if (!name) return;
      this.pause();
      this.project = createEmptyProject(name.trim() || 'New Motion Project');
      await ProjectStorage.saveProject(this.project);
      this.history.clear();
      this.currentFrame = 0;
      this.selectedLayerId = null;
      this.hideOpenSheets();
      this.setSaveState(true);
      this.updateAllUI();
    };
    document.getElementById('btnExportProjectJson').onclick = () => {
      const jsonStr = serializeProject(this.project);
      if (window.AndroidBridge?.exportProjectJson) {
        window.AndroidBridge.exportProjectJson(`${this.project.name}.mfproj.json`, jsonStr);
      } else {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${this.project.name}.mfproj.json`;
        a.click();
      }
    };
    document.getElementById('btnCaptureCover')?.addEventListener('click', () => {
      this.captureCoverFrame();
    });
    document.getElementById('inpSrtFile')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await f.text();
      const box = document.getElementById('txtBatchCaptions');
      if (box) box.value = txt;
    });
    document.getElementById('btnAutoBeatCaptions')?.addEventListener('click', () => {
      this.populateAutoBeatCaptionsSrt();
    });
    document.getElementById('btnApplyBatchCaptions')?.addEventListener('click', () => {
      const raw = document.getElementById('txtBatchCaptions')?.value || '';
      const sec = Number(document.getElementById('inpCaptionSecPerLine')?.value) || 2.0;
      const styleId = document.getElementById('selCaptionStyle')?.value || 'minimalSub';
      this.importSrtOrGenerateCaptions(raw, sec, styleId);
    });
    document.getElementById('btnImportProjectJson').onclick = () => {
      if (window.AndroidBridge?.importProjectJson) {
        window.AndroidBridge.importProjectJson();
      } else {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (f) window.__mfNative.onProjectJsonImported(await f.text());
        };
        inp.click();
      }
    };

    // Media Import buttons
    document.getElementById('btnImportVisual').onclick = () => {
      const intent = this.mediaPickerContext === 'replace'
        ? 'replace_selected'
        : this.mediaPickerContext === 'overlay'
          ? 'overlay_at_playhead'
          : 'main_append';
      this.triggerDeviceVisualPick(intent);
    };
    document.getElementById('btnImportAudio').onclick = () => {
      const intent = this.mediaPickerContext === 'replace' ? 'replace_selected' : 'audio_at_playhead';
      this.triggerDeviceAudioPick(intent);
    };
    document.getElementById('fallbackFileInput').onchange = async (e) => {
      const files = [...(e.target.files || [])];
      if (files.length === 0) return;
      const probeMedia = (url, type) => new Promise((resolve) => {
        if (type === 'image') {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth || 1280, height: img.naturalHeight || 720, durationMs: 5000, thumbUrl: url });
          img.onerror = () => resolve({ width: 1280, height: 720, durationMs: 5000, thumbUrl: url });
          img.src = url;
        } else if (type === 'video') {
          const vid = document.createElement('video');
          vid.preload = 'metadata';
          vid.muted = true;
          let done = false;
          const finish = (meta) => { if (!done) { done = true; resolve(meta); } };
          vid.onloadeddata = () => {
            let thumbUrl = '';
            try {
              const c = document.createElement('canvas');
              c.width = 160;
              c.height = Math.max(90, Math.round(160 * ((vid.videoHeight || 720) / Math.max(1, vid.videoWidth || 1280))));
              c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
              thumbUrl = c.toDataURL('image/jpeg', 0.78);
            } catch {}
            finish({
              width: vid.videoWidth || 1280,
              height: vid.videoHeight || 720,
              durationMs: Math.max(1000, Math.round((vid.duration || 5) * 1000)),
              thumbUrl
            });
          };
          vid.onerror = () => finish({ width: 1280, height: 720, durationMs: 5000, thumbUrl: '' });
          setTimeout(() => finish({ width: 1280, height: 720, durationMs: 5000, thumbUrl: '' }), 2500);
          vid.src = url;
        } else {
          const aud = document.createElement('audio');
          aud.preload = 'metadata';
          aud.onloadedmetadata = () => resolve({ width: 0, height: 0, durationMs: Math.max(500, Math.round((aud.duration || 5) * 1000)), thumbUrl: '' });
          aud.onerror = () => resolve({ width: 0, height: 0, durationMs: 5000, thumbUrl: '' });
          setTimeout(() => resolve({ width: 0, height: 0, durationMs: 5000, thumbUrl: '' }), 2000);
          aud.src = url;
        }
      });

      const imported = [];
      for (const f of files) {
        const url = URL.createObjectURL(f);
        const type = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image';
        const meta = await probeMedia(url, type);
        imported.push({
          id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          type,
          mimeType: f.type,
          url,
          thumbUrl: meta.thumbUrl,
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          sizeBytes: f.size
        });
      }
      e.target.value = '';
      window.__mfNative.onMediaImported(imported);
    };

    // Add Layer Sheet buttons
    const addAndSelect = (layer) => {
      this.mutateProject(() => {
        TimelineEngine.addLayer(this.project, layer);
        this.selectedLayerId = layer.id;
      });
      this.hideOpenSheets();
    };
    document.getElementById('btnAddTextLayer').onclick = () => addAndSelect(TimelineEngine.createTextLayer(this.project, this.currentFrame));
    document.getElementById('btnAddShapeRect').onclick = () => addAndSelect(TimelineEngine.createShapeLayer(this.project, 'rectangle', this.currentFrame));
    document.getElementById('btnAddShapeCircle').onclick = () => addAndSelect(TimelineEngine.createShapeLayer(this.project, 'circle', this.currentFrame));
    document.getElementById('btnAddShapeEllipse').onclick = () => addAndSelect(TimelineEngine.createShapeLayer(this.project, 'ellipse', this.currentFrame));
    document.getElementById('btnAddShapeLine').onclick = () => addAndSelect(TimelineEngine.createShapeLayer(this.project, 'line', this.currentFrame));
    document.getElementById('btnAddGroupLayer').onclick = () => addAndSelect(TimelineEngine.createGroupLayer(this.project, this.currentFrame));
    document.getElementById('btnAddAdjustmentLayer')?.addEventListener('click', () => {
      this.mutateProject(() => {
        const adj = TimelineEngine.createAdjustmentLayer(this.project, this.currentFrame);
        TimelineEngine.addLayer(this.project, adj);
        TimelineEngine.normalizeTrackZOrder(this.project);
        this.selectedLayerId = adj.id;
      });
      this.hideOpenSheets();
      this.openSheet('sheetStyle', 'fx', 'adjust');
    });

    // Doodle Draw Modal bindings
    const drawCanvas = document.getElementById('drawPadCanvas');
    if (drawCanvas) {
      const dctx = drawCanvas.getContext('2d');
      let drawing = false;
      let lastPt = null;
      const toCanvasPt = (ev) => {
        const r = drawCanvas.getBoundingClientRect();
        return {
          x: ((ev.clientX - r.left) / Math.max(1, r.width)) * drawCanvas.width,
          y: ((ev.clientY - r.top) / Math.max(1, r.height)) * drawCanvas.height
        };
      };
      drawCanvas.addEventListener('pointerdown', (ev) => {
        this._drawUndoStack = this._drawUndoStack || [];
        if (this._drawUndoStack.length > 20) this._drawUndoStack.shift();
        this._drawUndoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
        drawing = true;
        lastPt = toCanvasPt(ev);
        try { drawCanvas.setPointerCapture(ev.pointerId); } catch {}
      });
      drawCanvas.addEventListener('pointermove', (ev) => {
        if (!drawing || !lastPt) return;
        const pt = toCanvasPt(ev);
        const size = Number(document.getElementById('drawBrushSize')?.value || 10);
        dctx.save();
        dctx.lineCap = 'round';
        dctx.lineJoin = 'round';
        dctx.lineWidth = size;
        if (this._drawEraser) {
          dctx.globalCompositeOperation = 'destination-out';
          dctx.strokeStyle = 'rgba(0,0,0,1)';
        } else if (this._drawMode === 'cutout' && this._cutoutSourceCanvas) {
          dctx.globalCompositeOperation = 'source-over';
          dctx.strokeStyle = dctx.createPattern(this._cutoutSourceCanvas, 'no-repeat');
        } else {
          dctx.globalCompositeOperation = 'source-over';
          dctx.strokeStyle = this._drawCurrentColor || '#00E5FF';
        }
        dctx.beginPath();
        dctx.moveTo(lastPt.x, lastPt.y);
        dctx.lineTo(pt.x, pt.y);
        dctx.stroke();
        dctx.restore();
        lastPt = pt;
      });
      const stopDraw = () => { drawing = false; lastPt = null; };
      drawCanvas.addEventListener('pointerup', stopDraw);
      drawCanvas.addEventListener('pointercancel', stopDraw);

      document.querySelectorAll('[data-draw-color]').forEach((btn) => {
        btn.onclick = () => {
          this._drawCurrentColor = btn.dataset.drawColor;
          this._drawEraser = false;
          document.getElementById('drawCustomColor').value = this._drawCurrentColor;
          document.getElementById('btnDrawEraser')?.classList.remove('active', 'btn-info', 'text-dark');
        };
      });
      document.getElementById('drawCustomColor')?.addEventListener('change', (e) => {
        this._drawCurrentColor = e.target.value;
        this._drawEraser = false;
        document.getElementById('btnDrawEraser')?.classList.remove('active', 'btn-info', 'text-dark');
      });
      document.getElementById('btnDrawEraser')?.addEventListener('click', (e) => {
        this._drawEraser = !this._drawEraser;
        e.currentTarget.classList.toggle('btn-info', this._drawEraser);
        e.currentTarget.classList.toggle('text-dark', this._drawEraser);
      });
      document.getElementById('btnDrawUndo')?.addEventListener('click', () => {
        const snap = this._drawUndoStack?.pop();
        if (snap) dctx.putImageData(snap, 0, 0);
      });
      document.getElementById('btnDrawClear')?.addEventListener('click', () => {
        dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        if (this._drawMode === 'cutout' && this._cutoutSourceCanvas) {
          dctx.drawImage(this._cutoutSourceCanvas, 0, 0);
        }
      });
      document.getElementById('btnSaveDrawLayer')?.addEventListener('click', async () => {
        const dataUrl = drawCanvas.toDataURL('image/png');
        const isCutout = this._drawMode === 'cutout' && this._cutoutTargetLayerId;
        const id = `${isCutout ? 'cutout' : 'draw'}_${Date.now().toString(36)}`;
        const mediaItem = {
          id,
          name: `${isCutout ? 'Cutout' : 'Doodle'}_${new Date().toLocaleTimeString().replace(/[: ]/g, '')}.png`,
          type: 'image',
          mimeType: 'image/png',
          url: dataUrl,
          thumbUrl: dataUrl,
          width: drawCanvas.width,
          height: drawCanvas.height,
          durationMs: 3000,
          sizeBytes: Math.round(dataUrl.length * 0.75),
          addedAt: Date.now()
        };
        await ProjectStorage.saveMediaItem(mediaItem);
        this.mediaItems.unshift(mediaItem);
        this.rebuildMediaMap();
        this.panels.renderMediaLibrary(this.mediaItems);
        if (isCutout) {
          const target = this.project.layers.find((l) => l.id === this._cutoutTargetLayerId);
          if (target) {
            this.mutateProject(() => {
              TimelineEngine.replaceLayerMedia(this.project, target.id, mediaItem);
            });
            this.showToast('Applied manual alpha cutout to clip');
          }
        } else {
          this.mutateProject(() => {
            const layer = TimelineEngine.createMediaLayer(this.project, mediaItem, this.currentFrame);
            TimelineEngine.addLayer(this.project, layer);
            this.selectedLayerId = layer.id;
          });
          this.showToast('Added Doodle layer to timeline');
        }
        bootstrap.Modal.getInstance(document.getElementById('modalDraw'))?.hide();
      });
    }

    // Export MP4 Sheet (CapCut-Style Discrete Sliders) & Quick Spec Pill
    const RES_STEPS = ['480p', '720p', '1080p', '4k'];
    const FPS_STEPS = [24, 25, 30, 50, 60];
    const QUAL_STEPS = ['low', 'medium', 'high', 'ultra'];

    const syncResStep = (idx, supports4K = true) => {
      const maxIdx = supports4K ? 3 : 2;
      const clamped = Math.max(0, Math.min(maxIdx, Number(idx) || 0));
      const rng = document.getElementById('rngExportRes');
      if (rng) {
        rng.max = String(maxIdx);
        rng.value = String(clamped);
      }
      document.getElementById('selExportRes').value = RES_STEPS[clamped];
      document.querySelectorAll('#ticksExportRes .mf-tick-btn').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.resIdx) === clamped);
      });
      this.refreshExportEstimate();
    };

    const syncFpsStep = (idx) => {
      const clamped = Math.max(0, Math.min(FPS_STEPS.length - 1, Number(idx) || 0));
      const rng = document.getElementById('rngExportFps');
      if (rng) rng.value = String(clamped);
      document.getElementById('selExportFps').value = String(FPS_STEPS[clamped]);
      document.querySelectorAll('#ticksExportFps .mf-tick-btn').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.fpsIdx) === clamped);
      });
      this.refreshExportEstimate();
    };

    const syncQualityStep = (idx) => {
      const clamped = Math.max(0, Math.min(QUAL_STEPS.length - 1, Number(idx) || 0));
      const rng = document.getElementById('rngExportQuality');
      if (rng) rng.value = String(clamped);
      document.getElementById('selExportQuality').value = QUAL_STEPS[clamped];
      document.querySelectorAll('#ticksExportQuality .mf-tick-btn').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.qualIdx) === clamped);
      });
      this.refreshExportEstimate();
    };

    let cachedSupports4K = false;
    const openExportDialog = () => {
      this.pause();
      const caps = this.exportEngine.getCapabilities();
      cachedSupports4K = Boolean(caps.supports4K);
      const btn4k = document.getElementById('optExport4k');
      if (btn4k) {
        btn4k.disabled = !cachedSupports4K;
        btn4k.textContent = cachedSupports4K ? '2K/4K' : '4K (N/A)';
      }
      document.getElementById('exportCapsHint').textContent = cachedSupports4K
        ? `Hardware H.264 supports up to ${caps.maxWidth}×${caps.maxHeight} · 60 FPS interpolation ready`
        : `Hardware H.264 max: ${caps.maxWidth}×${caps.maxHeight} · 60 FPS smooth export ready`;

      // Capture current preview frame thumbnail for CapCut-style export cover
      try {
        this.renderPreview();
        const thumbUrl = this.previewCanvas.toDataURL('image/jpeg', 0.8);
        const heroImg = document.getElementById('imgExportPreviewThumb');
        const progImg = document.getElementById('imgExportProgressThumb');
        if (heroImg) heroImg.src = thumbUrl;
        if (progImg) progImg.src = thumbUrl;
      } catch {}

      const ep = this.project.exportPrefs || {};
      const resIdx = Math.max(0, RES_STEPS.indexOf(ep.resPreset || '1080p'));
      const savedFps = Number(ep.fps || this.project.fps || 30);
      const fpsIdx = FPS_STEPS.reduce((best, v, i) => (Math.abs(v - savedFps) < Math.abs(FPS_STEPS[best] - savedFps) ? i : best), 2);
      const qualIdx = Math.max(0, QUAL_STEPS.indexOf(ep.quality || 'high'));

      document.getElementById('chkExportAudio').checked = ep.includeAudio !== false;
      const trimEl = document.getElementById('chkExportTrimTail');
      if (trimEl) trimEl.checked = ep.trimTrailingEmpty !== false;
      document.getElementById('inpExportFileName').value = `${this.project.name.replace(/\s+/g, '_')}.mp4`;

      syncResStep(resIdx, cachedSupports4K);
      syncFpsStep(fpsIdx);
      syncQualityStep(qualIdx);

      document.getElementById('exportConfigPane').classList.remove('d-none');
      document.getElementById('exportProgressPane').classList.add('d-none');
      document.getElementById('exportDonePane').classList.add('d-none');
      document.getElementById('btnStartExport').classList.remove('d-none');
      document.getElementById('btnCancelExport').classList.add('d-none');
      document.getElementById('btnCloseExportX').disabled = false;
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalExport')).show();
    };
    document.getElementById('btnOpenExport').onclick = openExportDialog;
    document.getElementById('btnQuickExportSpec')?.addEventListener('click', openExportDialog);

    document.getElementById('rngExportRes')?.addEventListener('input', (e) => syncResStep(e.target.value, cachedSupports4K));
    document.querySelectorAll('#ticksExportRes .mf-tick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        syncResStep(btn.dataset.resIdx, cachedSupports4K);
      });
    });

    document.getElementById('rngExportFps')?.addEventListener('input', (e) => syncFpsStep(e.target.value));
    document.querySelectorAll('#ticksExportFps .mf-tick-btn').forEach((btn) => {
      btn.addEventListener('click', () => syncFpsStep(btn.dataset.fpsIdx));
    });

    document.getElementById('rngExportQuality')?.addEventListener('input', (e) => syncQualityStep(e.target.value));
    document.querySelectorAll('#ticksExportQuality .mf-tick-btn').forEach((btn) => {
      btn.addEventListener('click', () => syncQualityStep(btn.dataset.qualIdx));
    });

    ['#chkExportAudio', '#chkExportTrimTail'].forEach((sel) => {
      document.querySelector(sel)?.addEventListener('change', () => this.refreshExportEstimate());
    });

    document.getElementById('btnCancelExport').onclick = () => {
      this.exportEngine.cancel();
    };

    document.getElementById('btnStartExport').onclick = async () => {
      const resPreset = document.getElementById('selExportRes').value;
      const fps = Number(document.getElementById('selExportFps').value) || 30;
      const quality = document.getElementById('selExportQuality').value;
      const includeAudio = document.getElementById('chkExportAudio').checked;
      const trimTrailingEmpty = document.getElementById('chkExportTrimTail')?.checked !== false;
      const fileName = document.getElementById('inpExportFileName').value.trim() || 'MotionFlow_Export.mp4';

      document.getElementById('exportConfigPane').classList.add('d-none');
      document.getElementById('exportProgressPane').classList.remove('d-none');
      document.getElementById('btnStartExport').classList.add('d-none');
      document.getElementById('btnCancelExport').classList.remove('d-none');
      document.getElementById('btnCloseExportX').disabled = true;

      try {
        const result = await this.exportEngine.exportProject({
          project: this.project,
          mediaMap: this.mediaMap,
          resPreset,
          fps,
          quality,
          includeAudio,
          trimTrailingEmpty,
          fileName,
          onProgress: (pct, detail) => {
            document.getElementById('lblExportPercent').textContent = `${pct}%`;
            document.getElementById('barExportProgress').style.width = `${pct}%`;
            document.getElementById('lblExportDetail').textContent = detail;
          }
        });

        document.getElementById('exportProgressPane').classList.add('d-none');
        document.getElementById('exportDonePane').classList.remove('d-none');
        document.getElementById('btnCancelExport').classList.add('d-none');
        document.getElementById('btnCloseExportX').disabled = false;
        document.getElementById('lblExportResultInfo').textContent = result.contentUri
          ? `${result.fileName} saved to Movies/MotionFlow Studio (${Math.round((result.sizeBytes || 0) / 1024)} KB)`
          : `${result.fileName} saved internally (${Math.round((result.sizeBytes || 0) / 1024)} KB — tap Play or Share)`;

        document.getElementById('btnOpenExported').onclick = () => {
          if (window.AndroidBridge?.openExportedFile && result.internalPath) {
            window.AndroidBridge.openExportedFile(result.internalPath);
          }
        };
        document.getElementById('btnShareExported').onclick = () => {
          if (window.AndroidBridge?.shareExportedFile && result.internalPath) {
            window.AndroidBridge.shareExportedFile(result.internalPath);
          }
        };
      } catch (err) {
        document.getElementById('exportProgressPane').classList.add('d-none');
        document.getElementById('exportConfigPane').classList.remove('d-none');
        document.getElementById('btnStartExport').classList.remove('d-none');
        document.getElementById('btnCancelExport').classList.add('d-none');
        document.getElementById('btnCloseExportX').disabled = false;
        this.showToast(err?.message || 'Export failed');
      }
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new MotionFlowApp();
  app.init();
});
