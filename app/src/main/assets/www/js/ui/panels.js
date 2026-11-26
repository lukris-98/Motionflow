import { ANIMATABLE_PROPS, ANIMATION_PRESETS, EASING_TYPES, KeyframeEngine } from '../engine/keyframeEngine.js';
import {
  ANIMATION_CATALOG,
  AUTO_EDIT_TEMPLATES,
  CAMERA_MOTION_PRESETS,
  FILTER_PRESETS,
  HSL_CHANNELS,
  MASK_PRESETS,
  PIP_LAYOUT_PRESETS,
  SFX_PACK,
  STICKER_PACK,
  TEXT_TEMPLATES,
  TRANSITION_CATEGORIES,
  TRANSITION_PRESETS,
  VIDEO_EFFECT_PRESETS
} from '../engine/capcutCatalog.js';
import { SPEED_CURVE_PRESETS, TimelineEngine } from '../engine/timelineEngine.js';
import { STABILIZE_PRESETS } from '../engine/stabilizerEngine.js';
import { TrackerEngine } from '../engine/trackerEngine.js';
import { formatBytes, formatDurationMs } from '../utils/math.js';

const SAMPLE_PREVIEW_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0%" stop-color="#ff7043"/><stop offset="50%" stop-color="#7c4dff"/><stop offset="100%" stop-color="#00bcd4"/>' +
  '</linearGradient></defs>' +
  '<rect width="120" height="90" fill="url(#g)"/>' +
  '<circle cx="88" cy="24" r="14" fill="#ffe082"/>' +
  '<path d="M0 74 L38 42 L72 68 L96 50 L120 72 L120 90 L0 90 Z" fill="#101826" opacity="0.88"/>' +
  '</svg>'
);

export class PanelsUI {
  constructor(app) {
    this.app = app;
    this.selectedKfProp = 'x';
    this.copiedKeyframe = null;
    this.activeStyleTab = 'layer';
    this.activeFxSubTab = 'effects';
    this.activeAnimTab = 'in';
    this.activeTextSubTab = 'edit';
    this.activeTransSide = 'in';
    this.activeStickerSubTab = 'stickers';
    this.activeAudioHubTab = 'sfx';
    this.activeEffectCat = 'all';
    this.activeFilterCat = 'all';
    this.activeSfxCat = 'all';
    this.activeTransCat = 'all';
    this.transitionTarget = { mode: 'junction', leftId: null, rightId: null, layerId: null };
    this.selectedHslIdx = 0;
  }

  getPreviewThumbSrc() {
    if (this.app.project?.layers?.some((l) => l.visible && (l.type === 'video' || l.type === 'image'))) {
      const snap = this.app.renderer?.capturePreviewThumbnailDataUrl?.(120, 90);
      if (snap) return snap;
    }
    return SAMPLE_PREVIEW_SVG;
  }

  refreshAll() {
    this.renderInspector();
    this.renderKeyframesPanel();
    this.renderStylePanel();
    if (document.getElementById('sheetTransitions')?.classList.contains('show')) {
      this.renderTransitionsPanel();
    }
  }

  async renderProjectsList() {
    const container = document.getElementById('projectsList');
    const projects = await this.app.getSavedProjects();
    container.innerHTML = '';

    projects.forEach((p) => {
      const isCurrent = p.id === this.app.project.id;
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6';
      col.innerHTML = `
        <div class="p-2 rounded border ${isCurrent ? 'border-info bg-info bg-opacity-10' : 'border-secondary-subtle bg-dark'} d-flex justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
            ${p.coverDataUrl
              ? `<img src="${p.coverDataUrl}" class="mf-proj-cover" alt="Cover" />`
              : `<div class="mf-proj-cover d-flex align-items-center justify-content-center text-secondary"><i class="bi bi-film"></i></div>`}
            <div class="min-w-0">
              <div class="fw-semibold small text-truncate">${this.esc(p.name)} ${isCurrent ? '<span class="badge bg-info text-dark ms-1">Active</span>' : ''}</div>
              <div class="text-secondary" style="font-size:0.7rem;">${p.width}×${p.height} · ${p.fps} FPS · ${p.layers?.length || 0} layers</div>
            </div>
          </div>
          <div class="d-flex gap-1 flex-shrink-0">
            <button class="btn btn-xs btn-outline-info py-1 px-2" data-act="open">Open</button>
            <button class="btn btn-xs btn-outline-light py-1 px-2" data-act="rename"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-xs btn-outline-danger py-1 px-2" data-act="del"><i class="bi bi-trash"></i></button>
          </div>
        </div>
      `;
      col.querySelector('[data-act="open"]').onclick = () => this.app.openProjectById(p.id);
      col.querySelector('[data-act="rename"]').onclick = () => {
        const next = prompt('Rename project:', p.name);
        if (next && next.trim()) this.app.renameProjectById(p.id, next.trim());
      };
      col.querySelector('[data-act="del"]').onclick = () => this.app.deleteProjectById(p.id);
      container.appendChild(col);
    });
  }

  renderMediaLibrary(mediaItems) {
    const grid = document.getElementById('mediaLibraryGrid');
    const empty = document.getElementById('mediaLibraryEmpty');
    grid.innerHTML = '';
    empty.classList.toggle('d-none', mediaItems.length > 0);

    const isReplace = this.app.mediaPickerContext === 'replace';
    const sel = this.app.getSelectedLayer();
    if (isReplace && sel) {
      const banner = document.createElement('div');
      banner.className = 'col-12';
      banner.innerHTML = `
        <div class="alert alert-info py-1 px-2 mb-1 d-flex align-items-center justify-content-between small">
          <span><i class="bi bi-arrow-left-right me-1"></i>Replacing <strong>${this.esc(sel.name)}</strong> — tap a clip below or import new media</span>
          <button id="btnCancelReplaceMode" class="btn btn-xs btn-outline-light py-0 px-2">Cancel</button>
        </div>
      `;
      banner.querySelector('#btnCancelReplaceMode').onclick = () => {
        this.app.mediaPickerContext = null;
        this.renderMediaLibrary(mediaItems);
      };
      grid.appendChild(banner);
    }

    mediaItems.forEach((item) => {
      const col = document.createElement('div');
      col.className = 'col-6 col-sm-4 col-md-3';
      const thumbHtml = item.thumbUrl
        ? `<img src="${item.thumbUrl}" class="mf-media-thumb" alt="${this.esc(item.name)}" />`
        : `<div class="mf-media-thumb d-flex align-items-center justify-content-center"><i class="bi ${item.type === 'audio' ? 'bi-music-note-beamed text-warning' : 'bi-film text-info'} fs-2"></i></div>`;

      const resLabel = item.type === 'audio' ? formatDurationMs(item.durationMs) : `${item.width}×${item.height} · ${formatDurationMs(item.durationMs)}`;
      const actionLabel = isReplace && sel ? 'Replace' : 'Timeline';
      col.innerHTML = `
        <div class="mf-media-card h-100 d-flex flex-column">
          ${thumbHtml}
          <div class="p-2 flex-grow-1 d-flex flex-column justify-content-between">
            <div>
              <div class="small fw-semibold text-truncate" title="${this.esc(item.name)}">${this.esc(item.name)}</div>
              <div class="text-secondary" style="font-size:0.65rem;">${resLabel} · ${formatBytes(item.sizeBytes)}</div>
            </div>
            <div class="d-flex gap-1 mt-2">
              <button class="btn btn-xs mf-btn-accent flex-grow-1 py-1" data-act="add"><i class="bi ${isReplace ? 'bi-arrow-left-right' : 'bi-plus-lg'} me-1"></i>${actionLabel}</button>
              <button class="btn btn-xs btn-outline-danger py-1 px-2" data-act="del" aria-label="Delete Media"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      `;
      col.querySelector('[data-act="add"]').onclick = () => {
        if (this.app.mediaPickerContext === 'replace' && this.app.getSelectedLayer()) {
          this.app.replaceSelectedWithMedia(item);
        } else {
          this.app.addMediaToTimeline(item);
        }
      };
      col.querySelector('[data-act="del"]').onclick = () => this.app.deleteMediaFromLibrary(item);
      grid.appendChild(col);
    });
  }

  renderInspector() {
    const body = document.getElementById('inspectorBody');
    const layer = this.app.getSelectedLayer();
    if (!layer) {
      body.innerHTML = `<div class="text-center text-secondary py-4 small">Select a layer on the timeline or preview to inspect &amp; transform it.</div>`;
      return;
    }

    const frame = this.app.currentFrame;
    const tf = KeyframeEngine.getTransformAtFrame(layer, frame);
    const groups = this.app.project.layers.filter((l) => l.type === 'group' && l.id !== layer.id);

    body.innerHTML = `
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2 pb-2 border-bottom border-secondary-subtle">
        <div class="d-flex align-items-center gap-1 flex-grow-1">
          <input id="inspLayerName" type="text" class="form-control form-control-sm" value="${this.esc(layer.name)}" style="max-width:140px;" />
          <button id="inspMoveUp" class="btn btn-sm btn-dark border-secondary-subtle" title="Move Layer Up"><i class="bi bi-arrow-up"></i></button>
          <button id="inspMoveDown" class="btn btn-sm btn-dark border-secondary-subtle" title="Move Layer Down"><i class="bi bi-arrow-down"></i></button>
        </div>
        <div class="d-flex flex-wrap gap-1">
          ${layer.type === 'video' ? `<button id="inspMotionTrack" class="btn btn-sm btn-outline-warning" title="Motion / Camera Track"><i class="bi bi-crosshair"></i></button>` : ''}
          ${layer.type === 'video' ? `<button id="inspDetachAudio" class="btn btn-sm btn-outline-warning" title="Detach Audio Track"><i class="bi bi-music-note"></i></button>` : ''}
          ${(layer.type === 'video' || layer.type === 'image') ? `<button id="inspFreeze" class="btn btn-sm btn-outline-info" title="Freeze Frame at Playhead"><i class="bi bi-snow"></i></button>` : ''}
          ${(layer.type === 'video' || layer.type === 'image' || layer.type === 'audio') ? `<button id="inspReplace" class="btn btn-sm btn-outline-light" title="Replace Clip Media"><i class="bi bi-arrow-left-right"></i></button>` : ''}
          ${layer.type === 'group' ? `<button id="inspUngroup" class="btn btn-sm btn-outline-warning" title="Ungroup Children"><i class="bi bi-diagram-2"></i></button>` : ''}
          <button id="inspSplit" class="btn btn-sm btn-outline-info" title="Split at Playhead"><i class="bi bi-scissors"></i></button>
          <button id="inspDup" class="btn btn-sm btn-outline-light" title="Duplicate"><i class="bi bi-copy"></i></button>
          <button id="inspRippleDel" class="btn btn-sm btn-outline-warning" title="Ripple Delete (Close Gap)"><i class="bi bi-backspace"></i></button>
          <button id="inspDel" class="btn btn-sm btn-outline-danger" title="Delete Layer"><i class="bi bi-trash"></i></button>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-1 mb-2">
        <button id="inspRotMinus90" class="btn btn-xs btn-outline-light py-1 px-2"><i class="bi bi-arrow-counterclockwise me-1"></i>-90°</button>
        <button id="inspRotPlus90" class="btn btn-xs btn-outline-light py-1 px-2"><i class="bi bi-arrow-clockwise me-1"></i>+90°</button>
        <button id="inspFlipX" class="btn btn-xs ${layer.flipX ? 'btn-info text-dark fw-semibold' : 'btn-outline-light'} py-1 px-2"><i class="bi bi-symmetry-vertical me-1"></i>Mirror H</button>
        <button id="inspFlipY" class="btn btn-xs ${layer.flipY ? 'btn-info text-dark fw-semibold' : 'btn-outline-light'} py-1 px-2"><i class="bi bi-symmetry-horizontal me-1"></i>Flip V</button>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Pos X</label>
          <input id="inspX" type="number" step="1" class="form-control form-control-sm" value="${Math.round(tf.x)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Pos Y</label>
          <input id="inspY" type="number" step="1" class="form-control form-control-sm" value="${Math.round(tf.y)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Depth Z</label>
          <input id="inspZ" type="number" step="5" class="form-control form-control-sm" value="${Math.round(tf.z || 0)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Scale X</label>
          <input id="inspSX" type="number" step="0.05" class="form-control form-control-sm" value="${tf.scaleX.toFixed(2)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Scale Y</label>
          <input id="inspSY" type="number" step="0.05" class="form-control form-control-sm" value="${tf.scaleY.toFixed(2)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Rot Z (°)</label>
          <input id="inspRot" type="number" step="1" class="form-control form-control-sm" value="${Math.round(tf.rotation)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">3D Tilt X</label>
          <input id="inspRotX" type="number" step="1" class="form-control form-control-sm" value="${Math.round(tf.rotX || 0)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">3D Tilt Y</label>
          <input id="inspRotY" type="number" step="1" class="form-control form-control-sm" value="${Math.round(tf.rotY || 0)}" />
        </div>
        <div class="col-4 col-sm-2">
          <label class="form-label small text-secondary mb-0">Opacity (<span id="lblInspOp">${Math.round(tf.opacity * 100)}%</span>)</label>
          <input id="inspOp" type="range" min="0" max="1" step="0.02" class="form-range mt-1" value="${tf.opacity}" />
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label small text-secondary mb-0">Speed (<span id="lblInspSpeed">${(layer.speed || 1).toFixed(2)}x</span>)</label>
          <input id="inspSpeed" type="range" min="0.25" max="4" step="0.05" class="form-range mt-1" value="${layer.speed || 1}" />
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label small text-secondary mb-0">Anchor X / Y</label>
          <div class="input-group input-group-sm">
            <input id="inspAX" type="number" step="1" class="form-control" value="${Math.round(tf.anchorX)}" />
            <input id="inspAY" type="number" step="1" class="form-control" value="${Math.round(tf.anchorY)}" />
          </div>
        </div>
        <div class="col-6 col-sm-4">
          <label class="form-label small text-secondary mb-0">Parent Group</label>
          <select id="inspGroup" class="form-select form-select-sm" ${layer.type === 'group' ? 'disabled' : ''}>
            <option value="">None (Top Level)</option>
            ${groups.map((g) => `<option value="${g.id}" ${layer.parentId === g.id ? 'selected' : ''}>${this.esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-3 col-sm-4">
          <label class="form-label small text-secondary mb-0">Start F</label>
          <input id="inspStartF" type="number" min="0" class="form-control form-control-sm" value="${layer.startFrame}" />
        </div>
        <div class="col-3 col-sm-4">
          <label class="form-label small text-secondary mb-0">End F</label>
          <input id="inspEndF" type="number" min="1" class="form-control form-control-sm" value="${layer.endFrame}" />
        </div>
      </div>
    `;

    body.querySelector('#inspLayerName').onchange = (e) => this.app.mutateProject(() => { layer.name = e.target.value.trim() || layer.name; });
    body.querySelector('#inspMoveUp').onclick = () => this.app.mutateProject(() => TimelineEngine.reorderLayer(this.app.project, layer.id, 'up'));
    body.querySelector('#inspMoveDown').onclick = () => this.app.mutateProject(() => TimelineEngine.reorderLayer(this.app.project, layer.id, 'down'));
    body.querySelector('#inspRotMinus90')?.addEventListener('click', () => this.app.rotateSelected90(-90));
    body.querySelector('#inspRotPlus90')?.addEventListener('click', () => this.app.rotateSelected90(90));
    body.querySelector('#inspFlipX')?.addEventListener('click', () => this.app.flipSelected('x'));
    body.querySelector('#inspFlipY')?.addEventListener('click', () => this.app.flipSelected('y'));
    body.querySelector('#inspMotionTrack')?.addEventListener('click', () => this.app.openTrackerUI(layer.id));
    body.querySelector('#inspDetachAudio')?.addEventListener('click', () => this.app.detachAudioFromSelected());
    body.querySelector('#inspFreeze')?.addEventListener('click', () => this.app.freezeSelectedFrame());
    body.querySelector('#inspReplace')?.addEventListener('click', () => this.app.replaceSelectedClip());
    body.querySelector('#inspUngroup')?.addEventListener('click', () => {
      this.app.mutateProject(() => TimelineEngine.ungroupChildren(this.app.project, layer.id));
      this.app.showToast('Group children ungrouped');
    });
    body.querySelector('#inspSplit').onclick = () => this.app.splitSelectedAtPlayhead();
    body.querySelector('#inspDup').onclick = () => this.app.duplicateSelectedLayer();
    body.querySelector('#inspRippleDel').onclick = () => this.app.rippleDeleteSelectedLayer();
    body.querySelector('#inspDel').onclick = () => this.app.deleteSelectedLayer();

    const bindProp = (id, prop) => {
      body.querySelector(id).addEventListener('change', (e) => {
        const val = Number(e.target.value);
        if (!isFinite(val)) return;
        this.app.setLayerTransformProp(layer, prop, val);
      });
    };
    bindProp('#inspX', 'x');
    bindProp('#inspY', 'y');
    bindProp('#inspZ', 'z');
    bindProp('#inspSX', 'scaleX');
    bindProp('#inspSY', 'scaleY');
    bindProp('#inspRot', 'rotation');
    bindProp('#inspRotX', 'rotX');
    bindProp('#inspRotY', 'rotY');
    bindProp('#inspAX', 'anchorX');
    bindProp('#inspAY', 'anchorY');

    const inspOpEl = body.querySelector('#inspOp');
    const lblInspOp = body.querySelector('#lblInspOp');
    let opOrigTransform = null;
    let opOrigKeyframes = null;
    const captureOpStart = () => {
      if (opOrigTransform === null) {
        opOrigTransform = JSON.parse(JSON.stringify(layer.transform || {}));
        opOrigKeyframes = JSON.parse(JSON.stringify(layer.keyframes || {}));
      }
    };
    inspOpEl.addEventListener('pointerdown', captureOpStart);
    inspOpEl.addEventListener('focus', captureOpStart);
    inspOpEl.addEventListener('input', (e) => {
      captureOpStart();
      const v = Number(e.target.value);
      if (lblInspOp) lblInspOp.textContent = `${Math.round(v * 100)}%`;
      this.app.setLayerTransformProp(layer, 'opacity', v, false);
    });
    inspOpEl.addEventListener('change', (e) => {
      const nextVal = Number(e.target.value);
      if (opOrigTransform !== null) {
        layer.transform = opOrigTransform;
        layer.keyframes = opOrigKeyframes;
        opOrigTransform = null;
        opOrigKeyframes = null;
      }
      this.app.setLayerTransformProp(layer, 'opacity', nextVal, true);
    });
    const inspSpeedEl = body.querySelector('#inspSpeed');
    const lblInspSpeed = body.querySelector('#lblInspSpeed');
    inspSpeedEl.addEventListener('input', (e) => {
      if (lblInspSpeed) lblInspSpeed.textContent = `${Number(e.target.value).toFixed(2)}x`;
    });
    inspSpeedEl.addEventListener('change', (e) => {
      this.app.mutateProject(() => TimelineEngine.setClipSpeed(this.app.project, layer.id, Number(e.target.value)));
    });
    body.querySelector('#inspGroup').addEventListener('change', (e) => {
      this.app.mutateProject(() => TimelineEngine.assignToGroup(this.app.project, layer.id, e.target.value || null));
    });
    body.querySelector('#inspStartF').addEventListener('change', (e) => {
      this.app.mutateProject(() => TimelineEngine.trimClip(this.app.project, layer.id, 'left', Number(e.target.value), false, 0));
    });
    body.querySelector('#inspEndF').addEventListener('change', (e) => {
      this.app.mutateProject(() => TimelineEngine.trimClip(this.app.project, layer.id, 'right', Number(e.target.value), false, 0));
    });
  }

  renderKeyframesPanel() {
    const body = document.getElementById('keyframesBody');
    const layer = this.app.getSelectedLayer();
    if (!layer) {
      body.innerHTML = `<div class="text-center text-secondary py-4 small">Select a layer to preview Animations &amp; Keyframes.</div>`;
      return;
    }

    const frame = this.app.currentFrame;
    const prop = this.selectedKfProp;
    const tf = KeyframeEngine.getTransformAtFrame(layer, frame);
    const curVal = tf[prop] ?? 0;
    const kfAtCur = KeyframeEngine.getKeyframeAtFrame(layer, prop, frame);
    const list = KeyframeEngine.ensurePropTrack(layer, prop);
    const activeEasing = kfAtCur?.easing || 'easeInOut';
    const bez = [...(kfAtCur?.bezier || [0.42, 0, 0.58, 1])];
    const animItems = ANIMATION_CATALOG.filter((a) => a.cat === this.activeAnimTab);

    body.innerHTML = `
      <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn ${this.activeAnimTab === 'in' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-anim-tab="in">In</button>
          <button type="button" class="btn ${this.activeAnimTab === 'out' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-anim-tab="out">Out</button>
          <button type="button" class="btn ${this.activeAnimTab === 'combo' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-anim-tab="combo">Combo</button>
        </div>
        <div class="d-flex align-items-center gap-1">
          <span class="small text-secondary">Dur(f)</span>
          <input id="presetDurFrames" type="number" min="6" max="180" value="24" class="form-control form-control-sm" style="width:62px;" />
        </div>
      </div>

      <div class="mf-tile-grid mb-3">
        ${animItems.map((a) => `
          <button type="button" class="mf-preview-tile ${layer.activePresetId === a.id ? 'active' : ''}" data-preset="${a.id}">
            <div class="mf-tile-stage">
              <div class="mf-anim-chip ${a.animClass}" style="background:linear-gradient(135deg, ${a.color}, #7c4dff);">Aa</div>
            </div>
            <div class="mf-tile-label">${a.label}</div>
          </button>
        `).join('')}
      </div>

      <hr class="border-secondary-subtle my-2" />
      <div class="small text-info fw-semibold mb-1"><i class="bi bi-diamond-half me-1"></i>Custom Keyframe Curve (${prop})</div>
      <div class="row g-2 mb-2 align-items-end">
        <div class="col-5">
          <label class="form-label small text-secondary mb-0">Property</label>
          <select id="kfPropSel" class="form-select form-select-sm">
            ${ANIMATABLE_PROPS.map((p) => `<option value="${p.key}" ${p.key === prop ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="col-4">
          <label class="form-label small text-secondary mb-0">Val @ F${frame}</label>
          <input id="kfValInp" type="number" step="0.1" class="form-control form-control-sm" value="${Number(curVal.toFixed(2))}" />
        </div>
        <div class="col-3 d-flex gap-1">
          <button id="btnAddSetKf" class="btn btn-sm mf-btn-accent flex-grow-1" title="Set Keyframe"><i class="bi bi-diamond-fill"></i></button>
          <button id="btnCopyKf" class="btn btn-sm btn-outline-light" title="Copy Keyframe" ${kfAtCur ? '' : 'disabled'}><i class="bi bi-clipboard"></i></button>
          <button id="btnPasteKf" class="btn btn-sm btn-outline-info" title="Paste Keyframe" ${this.copiedKeyframe ? '' : 'disabled'}><i class="bi bi-clipboard-check"></i></button>
        </div>
      </div>

      <div class="row g-2 mb-2 align-items-start">
        <div class="col-6">
          <label class="form-label small text-secondary mb-0">Easing Curve</label>
          <select id="kfEasingSel" class="form-select form-select-sm mb-2">
            ${EASING_TYPES.map((e) => `<option value="${e.key}" ${e.key === activeEasing ? 'selected' : ''}>${e.label}</option>`).join('')}
          </select>
          <div id="kfBezierWrap" class="${activeEasing === 'cubicBezier' ? '' : 'd-none'}">
            <label class="form-label small text-secondary mb-0">Cubic Bezier (x1, y1, x2, y2)</label>
            <div class="input-group input-group-sm">
              <input id="bzX1" type="number" min="0" max="1" step="0.05" class="form-control" value="${bez[0]}" />
              <input id="bzY1" type="number" min="-0.5" max="1.5" step="0.05" class="form-control" value="${bez[1]}" />
              <input id="bzX2" type="number" min="0" max="1" step="0.05" class="form-control" value="${bez[2]}" />
              <input id="bzY2" type="number" min="-0.5" max="1.5" step="0.05" class="form-control" value="${bez[3]}" />
            </div>
          </div>
        </div>
        <div class="col-6 ${activeEasing === 'cubicBezier' ? '' : 'd-none'}" id="kfBezierGraphWrap">
          <svg id="svgBezier" viewBox="0 0 120 100" class="mf-bezier-svg"></svg>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-1">
        ${list.length === 0 ? '<span class="small text-secondary">Tap a kotak animation preset above or set manual keyframes.</span>' : ''}
        ${list.map((k) => `
          <div class="badge ${k.frame === frame ? 'text-bg-info' : 'text-bg-dark border border-secondary-subtle'} d-inline-flex align-items-center gap-1 py-1 px-2">
            <span class="cursor-pointer" data-kf-jump="${k.frame}">F${k.frame}: ${Number(k.value.toFixed(2))} (${k.easing})</span>
            <button class="btn-close btn-close-white ms-1" style="font-size:0.5rem;" data-kf-del="${k.id}" aria-label="Delete Keyframe"></button>
          </div>
        `).join('')}
      </div>
    `;

    this.drawBezierGraph(body.querySelector('#svgBezier'), bez, kfAtCur, body, layer, prop, frame, curVal);

    body.querySelectorAll('[data-anim-tab]').forEach((btn) => {
      btn.onclick = () => {
        this.activeAnimTab = btn.dataset.animTab;
        this.renderKeyframesPanel();
      };
    });

    body.querySelector('#kfPropSel').onchange = (e) => {
      this.selectedKfProp = e.target.value;
      this.renderKeyframesPanel();
    };

    body.querySelector('#btnAddSetKf').onclick = () => {
      const val = Number(body.querySelector('#kfValInp').value);
      const easing = body.querySelector('#kfEasingSel').value;
      const bezVal = [
        Number(body.querySelector('#bzX1').value) || 0.42,
        Number(body.querySelector('#bzY1').value) || 0,
        Number(body.querySelector('#bzX2').value) || 0.58,
        Number(body.querySelector('#bzY2').value) || 1
      ];
      this.app.mutateProject(() => {
        KeyframeEngine.setKeyframe(layer, prop, frame, val, easing, bezVal);
      });
    };

    body.querySelector('#kfEasingSel').onchange = (e) => {
      const easing = e.target.value;
      body.querySelector('#kfBezierWrap').classList.toggle('d-none', easing !== 'cubicBezier');
      body.querySelector('#kfBezierGraphWrap').classList.toggle('d-none', easing !== 'cubicBezier');
      if (kfAtCur) {
        this.app.mutateProject(() => { kfAtCur.easing = easing; });
      }
    };

    ['#bzX1', '#bzY1', '#bzX2', '#bzY2'].forEach((sel, idx) => {
      body.querySelector(sel).onchange = (e) => {
        if (kfAtCur) {
          this.app.mutateProject(() => {
            if (!kfAtCur.bezier) kfAtCur.bezier = [0.42, 0, 0.58, 1];
            kfAtCur.bezier[idx] = Number(e.target.value);
          });
        }
      };
    });

    body.querySelector('#btnCopyKf').onclick = () => {
      if (kfAtCur) {
        this.copiedKeyframe = { value: kfAtCur.value, easing: kfAtCur.easing, bezier: [...(kfAtCur.bezier || [0.42, 0, 0.58, 1])] };
        this.app.showToast('Keyframe copied');
        this.renderKeyframesPanel();
      }
    };

    body.querySelector('#btnPasteKf').onclick = () => {
      if (this.copiedKeyframe) {
        this.app.mutateProject(() => {
          KeyframeEngine.setKeyframe(layer, prop, frame, this.copiedKeyframe.value, this.copiedKeyframe.easing, this.copiedKeyframe.bezier);
        });
      }
    };

    body.querySelectorAll('[data-kf-jump]').forEach((el) => {
      el.onclick = () => this.app.seekToFrame(Number(el.dataset.kfJump));
    });

    body.querySelectorAll('[data-kf-del]').forEach((el) => {
      el.onclick = () => {
        this.app.mutateProject(() => KeyframeEngine.removeKeyframe(layer, prop, el.dataset.kfDel));
      };
    });

    body.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        const durF = Number(body.querySelector('#presetDurFrames').value) || 24;
        const pid = btn.dataset.preset;
        this.app.mutateProject(() => {
          layer.activePresetId = pid;
          KeyframeEngine.applyPreset(layer, pid, this.app.project.width, this.app.project.height, durF);
        });
        this.app.showToast(`Applied "${btn.querySelector('.mf-tile-label')?.textContent || pid}" animation`);
      };
    });
  }

  drawBezierGraph(svg, bez, kfAtCur, rootEl, layer, prop, frame, curVal) {
    if (!svg) return;
    const toSvgX = (x) => 15 + x * 90;
    const toSvgY = (y) => 85 - y * 70;
    const render = () => {
      const p1x = toSvgX(bez[0]);
      const p1y = toSvgY(bez[1]);
      const p2x = toSvgX(bez[2]);
      const p2y = toSvgY(bez[3]);
      svg.innerHTML = `
        <rect x="15" y="15" width="90" height="70" fill="none" stroke="#283246" stroke-width="1" />
        <line x1="15" y1="85" x2="${p1x}" y2="${p1y}" stroke="#7C4DFF" stroke-width="1" stroke-dasharray="2,2" />
        <line x1="105" y1="15" x2="${p2x}" y2="${p2y}" stroke="#7C4DFF" stroke-width="1" stroke-dasharray="2,2" />
        <path d="M 15 85 C ${p1x} ${p1y}, ${p2x} ${p2y}, 105 15" fill="none" stroke="#00E5FF" stroke-width="2.5" />
        <circle cx="${p1x}" cy="${p1y}" r="6" fill="#7C4DFF" stroke="#fff" stroke-width="1.5" data-handle="1" style="cursor:pointer;" />
        <circle cx="${p2x}" cy="${p2y}" r="6" fill="#FFAB40" stroke="#fff" stroke-width="1.5" data-handle="2" style="cursor:pointer;" />
      `;
    };
    render();

    let activeHandle = null;
    const origBez = [...bez];
    svg.onpointerdown = (e) => {
      const h = e.target.getAttribute('data-handle');
      if (h) {
        activeHandle = Number(h);
        svg.setPointerCapture(e.pointerId);
      }
    };
    svg.onpointermove = (e) => {
      if (!activeHandle) return;
      const rect = svg.getBoundingClientRect();
      const vx = ((e.clientX - rect.left) / rect.width) * 120;
      const vy = ((e.clientY - rect.top) / rect.height) * 100;
      const nx = Math.max(0, Math.min(1, Number(((vx - 15) / 90).toFixed(2))));
      const ny = Math.max(-0.5, Math.min(1.5, Number(((85 - vy) / 70).toFixed(2))));
      if (activeHandle === 1) {
        bez[0] = nx; bez[1] = ny;
        rootEl.querySelector('#bzX1').value = nx;
        rootEl.querySelector('#bzY1').value = ny;
      } else {
        bez[2] = nx; bez[3] = ny;
        rootEl.querySelector('#bzX2').value = nx;
        rootEl.querySelector('#bzY2').value = ny;
      }
      render();
    };
    const finishHandle = () => {
      if (activeHandle) {
        const nextBez = [...bez];
        if (kfAtCur) kfAtCur.bezier = [...origBez];
        this.app.mutateProject(() => {
          if (kfAtCur) {
            kfAtCur.bezier = nextBez;
            kfAtCur.easing = 'cubicBezier';
          } else if (layer) {
            KeyframeEngine.setKeyframe(layer, prop, frame, curVal, 'cubicBezier', nextBez);
          }
        });
      }
      activeHandle = null;
    };
    svg.onpointerup = finishHandle;
    svg.onpointercancel = () => { activeHandle = null; };
  }

  ensureLayerFx(layer) {
    if (!layer.fx) {
      layer.fx = {
        brightness: 0, contrast: 1, saturation: 1, temperature: 0,
        tint: 0, exposure: 0, highlights: 0, shadows: 0, fade: 0, sharpen: 0,
        blur: 0, vignette: 0, grain: 0, outlineWidth: 0, outlineColor: '#FFFFFF',
        hsl: Array.from({ length: 8 }, () => [0, 0, 0]),
        chromaEnabled: false, chromaColor: '#00FF00', chromaSimilarity: 0.35, chromaSmoothness: 0.12, chromaSpill: 0.5
      };
    }
    if (layer.fx.grain === undefined) layer.fx.grain = 0;
    if (layer.fx.outlineWidth === undefined) layer.fx.outlineWidth = 0;
    if (!layer.fx.outlineColor) layer.fx.outlineColor = '#FFFFFF';
    if (!Array.isArray(layer.fx.hsl) || layer.fx.hsl.length !== 8) {
      layer.fx.hsl = Array.from({ length: 8 }, () => [0, 0, 0]);
    }
    return layer.fx;
  }

  ensureLayerVfx(layer) {
    const def = { type: 'none', intensity: 0.75, speed: 1 };
    layer.vfx = layer.vfx ? Object.assign(def, layer.vfx) : def;
    return layer.vfx;
  }

  ensureLayerCrop(layer) {
    const def = { left: 0, right: 0, top: 0, bottom: 0 };
    layer.crop = layer.crop ? Object.assign(def, layer.crop) : def;
    return layer.crop;
  }

  ensureLayerMask(layer) {
    const def = { type: 'none', scaleX: 0.85, scaleY: 0.85, offsetX: 0, offsetY: 0, rotation: 0, feather: 0.05, invert: false };
    layer.mask = layer.mask ? Object.assign(def, layer.mask) : def;
    return layer.mask;
  }

  ensureLayerTransitions(layer) {
    const def = { inType: 'none', inFrames: 15, outType: 'none', outFrames: 15 };
    layer.transitions = layer.transitions ? Object.assign(def, layer.transitions) : def;
    return layer.transitions;
  }

  bindLiveRange(inputEl, labelEl, obj, key, fmtFn) {
    if (!inputEl) return;
    let startVal = obj[key];
    let captured = false;
    const capture = () => {
      if (!captured) {
        startVal = obj[key];
        captured = true;
      }
    };
    inputEl.addEventListener('pointerdown', capture);
    inputEl.addEventListener('focus', capture);
    inputEl.addEventListener('input', (e) => {
      capture();
      const v = Number(e.target.value);
      obj[key] = v;
      if (labelEl) labelEl.textContent = fmtFn(v);
      this.app.renderPreview();
    });
    inputEl.addEventListener('change', (e) => {
      const nextVal = Number(e.target.value);
      obj[key] = startVal;
      captured = false;
      this.app.mutateProject(() => {
        obj[key] = nextVal;
      });
    });
  }

  renderStylePanel() {
    const body = document.getElementById('styleBody');
    const layer = this.app.getSelectedLayer();
    const cam = this.app.project.camera;

    const tabsHtml = `
      <ul class="nav nav-pills nav-fill mb-2 bg-dark p-1 rounded border border-secondary-subtle flex-nowrap overflow-auto">
        <li class="nav-item">
          <button class="nav-link py-1 px-1 small text-nowrap ${this.activeStyleTab === 'layer' ? 'active bg-info text-dark fw-semibold' : 'text-light'}" id="tabStyleLayer">Style</button>
        </li>
        <li class="nav-item">
          <button class="nav-link py-1 px-1 small text-nowrap ${this.activeStyleTab === 'fx' ? 'active bg-info text-dark fw-semibold' : 'text-light'}" id="tabStyleFx">Color/FX</button>
        </li>
        <li class="nav-item">
          <button class="nav-link py-1 px-1 small text-nowrap ${this.activeStyleTab === 'mask' ? 'active bg-info text-dark fw-semibold' : 'text-light'}" id="tabStyleMask">Mask/Tr</button>
        </li>
        <li class="nav-item">
          <button class="nav-link py-1 px-1 small text-nowrap ${this.activeStyleTab === 'tracker' ? 'active bg-warning text-dark fw-semibold' : 'text-light'}" id="tabStyleTracker"><i class="bi bi-crosshair me-1"></i>Track</button>
        </li>
        <li class="nav-item">
          <button class="nav-link py-1 px-1 small text-nowrap ${this.activeStyleTab === 'camera' ? 'active bg-info text-dark fw-semibold' : 'text-light'}" id="tabStyleCamera">Cam 3D</button>
        </li>
      </ul>
    `;

    let innerHtml = '';
    if (this.activeStyleTab === 'tracker') {
      innerHtml = this.buildTrackerTabHtml();
    } else if (this.activeStyleTab === 'camera') {
      const autoRec = Boolean(this.app.viewport3D?.autoRecord);
      const curCam = KeyframeEngine.getCameraAtFrame(cam, this.app.currentFrame);
      innerHtml = `
        <div class="d-flex flex-wrap gap-3 mb-2">
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="camEnabled" ${cam.enabled ? 'checked' : ''} />
            <label class="form-check-label small fw-semibold" for="camEnabled">WebGL 3D Camera</label>
          </div>
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="camAutoRec" ${autoRec ? 'checked' : ''} />
            <label class="form-check-label small text-danger fw-semibold" for="camAutoRec">Auto-Rec Motion</label>
          </div>
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="camMotionBlur" ${cam.motionBlur ? 'checked' : ''} />
            <label class="form-check-label small" for="camMotionBlur">Motion Blur</label>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-4 col-sm-3"><label class="form-label small text-secondary mb-0">Cam X</label><input id="camX" type="number" class="form-control form-control-sm" value="${Math.round(curCam.x)}" /></div>
          <div class="col-4 col-sm-3"><label class="form-label small text-secondary mb-0">Cam Y</label><input id="camY" type="number" class="form-control form-control-sm" value="${Math.round(curCam.y)}" /></div>
          <div class="col-4 col-sm-3"><label class="form-label small text-secondary mb-0">Cam Z</label><input id="camZ" type="number" class="form-control form-control-sm" value="${Math.round(curCam.z)}" /></div>
          <div class="col-3"><label class="form-label small text-secondary mb-0">Rot X (°)</label><input id="camRX" type="number" class="form-control form-control-sm" value="${Math.round(curCam.rotX)}" /></div>
          <div class="col-3"><label class="form-label small text-secondary mb-0">Rot Y (°)</label><input id="camRY" type="number" class="form-control form-control-sm" value="${Math.round(curCam.rotY)}" /></div>
          <div class="col-3"><label class="form-label small text-secondary mb-0">Rot Z (°)</label><input id="camRZ" type="number" class="form-control form-control-sm" value="${Math.round(curCam.rotZ || 0)}" /></div>
          <div class="col-3"><label class="form-label small text-secondary mb-0">Zoom</label><input id="camZoom" type="number" step="0.05" min="0.2" max="4" class="form-control form-control-sm" value="${Number((curCam.zoom ?? 1).toFixed(2))}" /></div>
        </div>
        <div class="mt-2 d-flex gap-1 mb-2">
          <button id="btnCamKf" class="btn btn-sm mf-btn-accent flex-grow-1"><i class="bi bi-diamond-fill me-1"></i>Key @ F${this.app.currentFrame}</button>
          <button id="btnCamSmoothPath" class="btn btn-sm btn-outline-info"><i class="bi bi-bezier2 me-1"></i>Smooth Path</button>
          <button id="btnCamReset" class="btn btn-sm btn-outline-light">Reset</button>
        </div>
        <div>
          <label class="form-label small text-secondary mb-1">Camera Motion Keyframe Presets</label>
          <div class="d-flex flex-wrap gap-1">
            ${CAMERA_MOTION_PRESETS.map((cp) => `
              <button type="button" class="btn btn-xs btn-outline-info py-1 px-2" data-cam-preset="${cp.id}">
                <i class="bi ${cp.icon} me-1"></i>${cp.label}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (!layer) {
      innerHtml = `<div class="text-center text-secondary py-4 small">Select a Text, Shape, Image, Video, or Audio layer to edit its properties.</div>`;
    } else if (this.activeStyleTab === 'fx') {
      innerHtml = this.buildFxTabHtml(layer);
    } else if (this.activeStyleTab === 'mask') {
      innerHtml = this.buildMaskTransTabHtml(layer);
    } else if (layer.type === 'text' && layer.textProps) {
      const tp = layer.textProps;
      const customFonts = this.app.customFonts || [];
      innerHtml = `
        <div class="d-flex justify-content-between align-items-center mb-2 gap-1">
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn ${this.activeTextSubTab === 'edit' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-txt-sub="edit">Font &amp; Style</button>
            <button type="button" class="btn ${this.activeTextSubTab === 'templates' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-txt-sub="templates">Templates</button>
            <button type="button" class="btn ${this.activeTextSubTab === 'bubble' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-txt-sub="bubble">Bubble</button>
            <button type="button" class="btn ${this.activeTextSubTab === 'voice' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-txt-sub="voice">TTS/Caps</button>
          </div>
          <button id="btnTextOpenDraw" type="button" class="btn btn-xs btn-outline-warning py-1 px-2"><i class="bi bi-brush me-1"></i>Draw</button>
        </div>

        ${this.activeTextSubTab === 'templates' ? `
          <div class="mf-tile-grid">
            ${TEXT_TEMPLATES.map((tpl) => {
              const s = tpl.textProps;
              const styleStr = [
                `color:${s.color}`,
                `font-family:${s.fontFamily || 'sans-serif'}`,
                `font-weight:${s.fontWeight || '700'}`,
                s.bgEnabled ? `background:${s.bgColor || '#05070B'};border-radius:${Math.min(10, Math.round((s.bgRadius || 10) / 2))}px;` : '',
                s.shadowBlur ? `text-shadow:0 0 8px ${s.shadowColor || '#00e5ff'};` : '',
                s.strokeWidth ? `-webkit-text-stroke:1px ${s.strokeColor || '#000'};` : ''
              ].join(';');
              return `
                <button type="button" class="mf-preview-tile ${layer.textTemplateId === tpl.id ? 'active' : ''}" data-apply-txt-tpl="${tpl.id}">
                  <div class="mf-tile-stage">
                    <span class="mf-tpl-box" style="${styleStr}">${this.esc(tpl.sample)}</span>
                  </div>
                  <div class="mf-tile-label">${tpl.label}</div>
                </button>
              `;
            }).join('')}
          </div>
        ` : this.activeTextSubTab === 'bubble' ? `
          <div class="p-2 rounded bg-dark border border-secondary-subtle">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" id="txtBgEnabled" ${tp.bgEnabled ? 'checked' : ''} />
                <label class="form-check-label small fw-semibold text-info" for="txtBgEnabled">Text Bubble / Label Pill</label>
              </div>
              <input id="txtBgColor" type="color" class="form-control form-control-color form-control-sm" style="width:46px;" value="${tp.bgColor || '#0B0E14'}" />
            </div>
            <div class="row g-2">
              <div class="col-4">
                <label class="form-label small text-secondary mb-0">Bg Op (<span id="lblTxtBgOp">${Math.round((tp.bgOpacity ?? 0.78) * 100)}%</span>)</label>
                <input id="txtBgOp" type="range" min="0.1" max="1" step="0.05" class="form-range" value="${tp.bgOpacity ?? 0.78}" />
              </div>
              <div class="col-4">
                <label class="form-label small text-secondary mb-0">Radius (<span id="lblTxtBgRad">${tp.bgRadius ?? 16}</span>)</label>
                <input id="txtBgRad" type="range" min="0" max="48" step="2" class="form-range" value="${tp.bgRadius ?? 16}" />
              </div>
              <div class="col-4">
                <label class="form-label small text-secondary mb-0">Pad (<span id="lblTxtBgPad">${tp.bgPadding ?? 20}</span>)</label>
                <input id="txtBgPad" type="range" min="4" max="48" step="2" class="form-range" value="${tp.bgPadding ?? 20}" />
              </div>
            </div>
          </div>
        ` : this.activeTextSubTab === 'voice' ? `
          <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
            <div class="small fw-semibold text-info mb-1"><i class="bi bi-megaphone-fill me-1"></i>Text-to-Speech (Generate Voice Clip)</div>
            <div class="input-group input-group-sm mb-2">
              <select id="txtTtsStyle" class="form-select">
                <option value="natural">Natural Voice</option>
                <option value="deep">Deep Narrator</option>
                <option value="high">Energetic High</option>
                <option value="fast">Fast Commentary</option>
                <option value="calm">Calm Story</option>
              </select>
              <button id="btnTextTtsSpeak" type="button" class="btn mf-btn-accent fw-semibold"><i class="bi bi-soundwave me-1"></i>Generate Voice</button>
            </div>
            <div id="lblTtsStatus" class="small text-secondary">${this.esc(this.app.ttsStatusText || 'Synthesizes current text into an Audio track at playhead.')}</div>
          </div>
          <button id="btnTextOpenCaptions" type="button" class="btn btn-sm btn-outline-info w-100">
            <i class="bi bi-badge-cc me-1"></i>Open Batch .SRT / Lyrics Captions Importer
          </button>
        ` : `
          <div class="mb-2">
            <label class="form-label small text-secondary mb-0">Text Content</label>
            <textarea id="txtContent" rows="2" class="form-control form-control-sm">${this.esc(tp.text)}</textarea>
          </div>
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small text-secondary mb-0 d-flex justify-content-between">
                <span>Font Family</span>
                <a href="#" id="btnImportFontLink" class="text-info text-decoration-none">+ Import .TTF/.OTF</a>
              </label>
              <select id="txtFont" class="form-select form-select-sm">
                <option value="sans-serif" ${tp.fontFamily === 'sans-serif' ? 'selected' : ''}>Sans Serif</option>
                <option value="serif" ${tp.fontFamily === 'serif' ? 'selected' : ''}>Serif</option>
                <option value="monospace" ${tp.fontFamily === 'monospace' ? 'selected' : ''}>Monospace</option>
                <option value="cursive" ${tp.fontFamily === 'cursive' ? 'selected' : ''}>Display / Script</option>
                ${customFonts.map((f) => `<option value="${this.esc(f.name)}" ${tp.fontFamily === f.name ? 'selected' : ''}>${this.esc(f.name)} (Custom)</option>`).join('')}
              </select>
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Size</label>
              <input id="txtSize" type="number" min="12" max="300" class="form-control form-control-sm" value="${tp.fontSize}" />
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Weight</label>
              <select id="txtWeight" class="form-select form-select-sm">
                <option value="400" ${tp.fontWeight === '400' ? 'selected' : ''}>Regular</option>
                <option value="700" ${tp.fontWeight === '700' ? 'selected' : ''}>Bold</option>
                <option value="900" ${tp.fontWeight === '900' ? 'selected' : ''}>Black</option>
              </select>
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Fill</label>
              <input id="txtColor" type="color" class="form-control form-control-color form-control-sm w-100" value="${tp.color}" />
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Align</label>
              <select id="txtAlign" class="form-select form-select-sm">
                <option value="left" ${tp.align === 'left' ? 'selected' : ''}>Left</option>
                <option value="center" ${tp.align === 'center' ? 'selected' : ''}>Center</option>
                <option value="right" ${tp.align === 'right' ? 'selected' : ''}>Right</option>
              </select>
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Stroke W</label>
              <input id="txtStrokeW" type="number" min="0" max="24" class="form-control form-control-sm" value="${tp.strokeWidth}" />
            </div>
            <div class="col-3">
              <label class="form-label small text-secondary mb-0">Stroke</label>
              <input id="txtStrokeCol" type="color" class="form-control form-control-color form-control-sm w-100" value="${tp.strokeColor}" />
            </div>
            <div class="col-6 d-flex align-items-end gap-1">
              <button id="txtItalic" type="button" class="btn btn-sm ${tp.italic ? 'btn-info text-dark fw-bold' : 'btn-outline-light'} flex-grow-1 fst-italic">I</button>
              <button id="txtUnderline" type="button" class="btn btn-sm ${tp.underline ? 'btn-info text-dark fw-bold' : 'btn-outline-light'} flex-grow-1 text-decoration-underline">U</button>
              <select id="txtCase" class="form-select form-select-sm" style="max-width:86px;">
                <option value="normal" ${(tp.textCase || 'normal') === 'normal' ? 'selected' : ''}>Aa</option>
                <option value="upper" ${tp.textCase === 'upper' ? 'selected' : ''}>AA</option>
                <option value="lower" ${tp.textCase === 'lower' ? 'selected' : ''}>aa</option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label small text-secondary mb-0">Shadow Blur (<span id="lblTxtShadow">${tp.shadowBlur || 0}</span>)</label>
              <input id="txtShadow" type="range" min="0" max="40" class="form-range" value="${tp.shadowBlur || 0}" />
            </div>
            <div class="col-6">
              <label class="form-label small text-secondary mb-0">Spacing (<span id="lblTxtSpacing">${tp.letterSpacing || 0}</span>px)</label>
              <input id="txtSpacing" type="range" min="-6" max="24" step="1" class="form-range" value="${tp.letterSpacing || 0}" />
            </div>
            <div class="col-6">
              <label class="form-label small text-secondary mb-0">Line H (<span id="lblTxtLineH">${(tp.lineHeight || 1.2).toFixed(2)}</span>)</label>
              <input id="txtLineHeight" type="range" min="0.8" max="2.2" step="0.05" class="form-range" value="${tp.lineHeight || 1.2}" />
            </div>
            <div class="col-6">
              <label class="form-label small text-secondary mb-0">Curved Arc (<span id="lblTxtCurve">${tp.curve || 0}°</span>)</label>
              <input id="txtCurve" type="range" min="-120" max="120" step="4" class="form-range" value="${tp.curve || 0}" />
            </div>
            <div class="col-6 d-flex align-items-center justify-content-between pt-2">
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" id="txtGradOn" ${tp.gradientEnabled ? 'checked' : ''} />
                <label class="form-check-label small" for="txtGradOn">Gradient 2</label>
              </div>
              <input id="txtGradCol2" type="color" class="form-control form-control-color form-control-sm" style="width:46px;" value="${tp.gradientColor2 || '#00E5FF'}" />
            </div>
          </div>
        `}
      `;
    } else if (layer.type === 'shape' && layer.shapeProps) {
      const sp = layer.shapeProps;
      innerHtml = `
        <div class="row g-2">
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Shape Type</label>
            <select id="shpType" class="form-select form-select-sm">
              <option value="rectangle" ${sp.shapeType === 'rectangle' ? 'selected' : ''}>Rectangle</option>
              <option value="circle" ${sp.shapeType === 'circle' ? 'selected' : ''}>Circle</option>
              <option value="ellipse" ${sp.shapeType === 'ellipse' ? 'selected' : ''}>Ellipse</option>
              <option value="line" ${sp.shapeType === 'line' ? 'selected' : ''}>Line</option>
            </select>
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Width</label>
            <input id="shpW" type="number" min="10" max="2000" class="form-control form-control-sm" value="${layer.width}" />
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Height</label>
            <input id="shpH" type="number" min="4" max="2000" class="form-control form-control-sm" value="${layer.height}" />
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Fill Color</label>
            <input id="shpFill" type="color" class="form-control form-control-color form-control-sm w-100" value="${sp.fillColor}" />
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Stroke</label>
            <input id="shpStroke" type="color" class="form-control form-control-color form-control-sm w-100" value="${sp.strokeColor}" />
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Stroke W</label>
            <input id="shpStrokeW" type="number" min="0" max="40" class="form-control form-control-sm" value="${sp.strokeWidth}" />
          </div>
          <div class="col-3">
            <label class="form-label small text-secondary mb-0">Radius</label>
            <input id="shpRad" type="number" min="0" max="200" class="form-control form-control-sm" value="${sp.cornerRadius || 0}" />
          </div>
        </div>
      `;
    } else if (layer.type === 'audio' || layer.type === 'video') {
      const ap = layer.audioProps || { volume: 1, fadeInFrames: 0, fadeOutFrames: 0, muted: false, voiceEffect: 'none', reduceNoise: false };
      const curCurve = layer.speedCurve || 'none';
      const beatCount = Array.isArray(this.app.project.beatMarkers) ? this.app.project.beatMarkers.length : 0;
      const voiceEffects = [
        { id: 'none', label: 'Normal' },
        { id: 'deep', label: 'Deep' },
        { id: 'chipmunk', label: 'High' },
        { id: 'robot', label: 'Robot' },
        { id: 'radio', label: 'Radio' },
        { id: 'echo', label: 'Echo' },
        { id: 'reverb', label: 'Reverb' },
        { id: 'megaphone', label: 'Megaphone' },
        { id: 'synth', label: 'Synth' }
      ];
      const curveSvg = (pts) => {
        const d = pts.map(([t, v], idx) => {
          const x = 4 + t * 56;
          const y = 26 - Math.min(3, Math.max(0.2, v)) * 7.5;
          return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ');
        return `<svg viewBox="0 0 64 28" style="width:60px;height:24px;display:block;margin:0 auto;"><path d="${d}" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round"/></svg>`;
      };
      innerHtml = `
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <div class="d-flex flex-wrap gap-2">
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" id="audMute" ${ap.muted ? 'checked' : ''} />
              <label class="form-check-label small" for="audMute">Mute</label>
            </div>
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" id="audNoise" ${ap.reduceNoise ? 'checked' : ''} />
              <label class="form-check-label small text-success" for="audNoise">Noise Cut</label>
            </div>
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" id="audNormalize" ${ap.normalize ? 'checked' : ''} />
              <label class="form-check-label small text-warning" for="audNormalize">Normalize</label>
            </div>
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" id="audReverse" ${layer.reversed ? 'checked' : ''} />
              <label class="form-check-label small text-info" for="audReverse">Reverse</label>
            </div>
          </div>
          <div class="d-flex flex-wrap gap-1">
            <button id="btnToggleBeatMarker" class="btn btn-xs btn-outline-warning py-1 px-2"><i class="bi bi-music-note-list me-1"></i>Beat (${beatCount})</button>
            <button id="btnAutoBeatDetect" class="btn btn-xs btn-outline-info py-1 px-2" title="Auto-detect rhythm peaks"><i class="bi bi-activity me-1"></i>Auto Beat</button>
            ${layer.type === 'video' ? `<button id="btnStyleFreeze" class="btn btn-xs btn-outline-info py-1 px-2"><i class="bi bi-snow me-1"></i>Freeze</button>` : ''}
            ${layer.type === 'video' ? `<button id="btnStyleDetachAudio" class="btn btn-xs btn-outline-warning py-1 px-2"><i class="bi bi-music-note me-1"></i>Extract</button>` : ''}
            <button id="btnStyleReplace" class="btn btn-xs btn-outline-light py-1 px-2"><i class="bi bi-arrow-left-right"></i></button>
          </div>
        </div>
        <div class="row g-2 mb-2">
          <div class="col-6">
            <label class="form-label small text-secondary mb-0 d-flex justify-content-between">
              <span>Volume (<span id="lblAudVol">${Math.round(ap.volume * 100)}%</span>)</span>
              <a href="#" id="btnAudVolKf" class="text-info text-decoration-none"><i class="bi bi-diamond-fill"></i> KF @ F${this.app.currentFrame}</a>
            </label>
            <input id="audVol" type="range" min="0" max="2" step="0.05" class="form-range" value="${ap.volume}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Normal Speed (<span id="lblAudSpeed">${(layer.speed || 1).toFixed(2)}x</span>)</label>
            <input id="audSpeed" type="range" min="0.25" max="4" step="0.05" class="form-range" value="${layer.speed || 1}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Fade In (Frames)</label>
            <input id="audFadeIn" type="number" min="0" max="300" class="form-control form-control-sm" value="${ap.fadeInFrames || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Fade Out (Frames)</label>
            <input id="audFadeOut" type="number" min="0" max="300" class="form-control form-control-sm" value="${ap.fadeOutFrames || 0}" />
          </div>
        </div>
        <div class="mb-2">
          <label class="form-label small text-secondary mb-1">Voice Effect</label>
          <div class="d-flex flex-wrap gap-1">
            ${voiceEffects.map((ve) => `
              <button type="button" class="btn btn-xs ${(ap.voiceEffect || 'none') === ve.id ? 'btn-info text-dark fw-semibold' : 'btn-outline-light'} py-1 px-2" data-voice-fx="${ve.id}">${ve.label}</button>
            `).join('')}
          </div>
        </div>
        ${layer.type === 'video' ? (() => {
          const stState = this.app.stabilizerState || {};
          const stab = layer.stabilizer || null;
          const activeLevel = stab?.level || stState.level || 'recommended';
          const isBusy = Boolean(stState.isStabilizing && stState.targetLayerId === layer.id);
          return `
            <div id="videoStabilizerCard" class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="small fw-semibold text-info"><i class="bi bi-camera-reels me-1"></i>Stabilizer (CapCut EIS)</span>
                ${stab?.frames?.length ? `
                  <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-info-subtle text-info" style="font-size:0.62rem;">Crop ${stab.cropScale}x · Shake ${stab.avgShakePx}px</span>
                    <div class="form-check form-switch mb-0">
                      <input class="form-check-input" type="checkbox" id="chkStabEnabled" ${stab.enabled ? 'checked' : ''} />
                    </div>
                  </div>
                ` : ''}
              </div>
              <div class="btn-group btn-group-sm w-100 mb-2">
                ${STABILIZE_PRESETS.map((sp) => `
                  <button type="button" class="btn ${activeLevel === sp.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-stab-lvl="${sp.id}" ${isBusy ? 'disabled' : ''}>${sp.label}</button>
                `).join('')}
              </div>
              ${isBusy ? `
                <div class="d-flex justify-content-between small mb-1">
                  <span class="text-info">Analyzing motion vectors...</span>
                  <span id="stabPctLbl">${stState.progressPct || 0}%</span>
                </div>
                <div class="progress mf-export-progress mb-1">
                  <div id="stabProgressBar" class="progress-bar bg-info" style="width:${stState.progressPct || 0}%"></div>
                </div>
                <div class="d-flex justify-content-between align-items-center">
                  <span id="stabDetailLbl" class="small text-secondary">${this.esc(stState.progressDetail || '')}</span>
                  <button id="btnStabCancel" type="button" class="btn btn-xs btn-outline-danger py-0 px-2">Cancel</button>
                </div>
              ` : `
                <div class="d-flex gap-1">
                  <button id="btnStabAnalyze" type="button" class="btn btn-xs mf-btn-accent flex-grow-1 py-1 fw-semibold">
                    <i class="bi bi-magic me-1"></i>${stab?.frames?.length ? 'Re-Stabilize Video' : 'Analyze & Stabilize'}
                  </button>
                  ${stab?.frames?.length ? `<button id="btnStabClear" type="button" class="btn btn-xs btn-outline-danger py-1 px-2">Clear</button>` : ''}
                </div>
              `}
            </div>
          `;
        })() : ''}
        <div>
          <label class="form-label small text-secondary mb-1">CapCut Speed Curve Preset</label>
          <div class="d-flex gap-1 overflow-x-auto pb-1">
            ${Object.entries(SPEED_CURVE_PRESETS).map(([key, preset]) => `
              <button type="button" class="mf-speed-curve-card ${curCurve === key ? 'active' : ''}" data-speed-curve="${key}">
                ${curveSvg(preset.pts)}
                <div style="font-size:0.62rem;" class="text-light text-truncate">${preset.label}</div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      innerHtml = `<div class="text-secondary small py-3 text-center">Use Color/FX, Mask/Tr, Transform &amp; Keyframes tabs to style and animate this ${layer.type} layer.</div>`;
    }

    body.innerHTML = tabsHtml + innerHtml;

    body.querySelector('#tabStyleLayer').onclick = () => { this.activeStyleTab = 'layer'; this.renderStylePanel(); };
    body.querySelector('#tabStyleFx').onclick = () => { this.activeStyleTab = 'fx'; this.renderStylePanel(); };
    body.querySelector('#tabStyleMask').onclick = () => { this.activeStyleTab = 'mask'; this.renderStylePanel(); };
    body.querySelector('#tabStyleTracker').onclick = () => {
      this.activeStyleTab = 'tracker';
      this.app.ensureTrackerSourceSelected();
      this.renderStylePanel();
    };
    body.querySelector('#tabStyleCamera').onclick = () => { this.activeStyleTab = 'camera'; this.renderStylePanel(); };

    if (this.activeStyleTab === 'tracker') {
      this.bindTrackerTabEvents(body);
      return;
    }

    if (this.activeStyleTab === 'camera') {
      body.querySelector('#camEnabled').onchange = (e) => this.app.mutateProject(() => { cam.enabled = e.target.checked; });
      body.querySelector('#camAutoRec')?.addEventListener('change', (e) => {
        this.app.viewport3D.autoRecord = e.target.checked;
        this.app.syncViewport3DUI();
      });
      body.querySelector('#camMotionBlur').onchange = (e) => this.app.mutateProject(() => { cam.motionBlur = e.target.checked; });
      const bindCam = (id, prop, fallback = 0, minVal = -Infinity, maxVal = Infinity) => {
        body.querySelector(id).onchange = (e) => {
          const parsed = Number(e.target.value);
          const val = Number.isFinite(parsed) ? Math.max(minVal, Math.min(maxVal, parsed)) : fallback;
          this.app.setCameraProp(prop, val, true);
        };
      };
      bindCam('#camX', 'x');
      bindCam('#camY', 'y');
      bindCam('#camZ', 'z');
      bindCam('#camRX', 'rotX', 0, -85, 85);
      bindCam('#camRY', 'rotY', 0, -175, 175);
      bindCam('#camRZ', 'rotZ');
      bindCam('#camZoom', 'zoom', 1, 0.2, 4.0);
      body.querySelector('#btnCamKf').onclick = () => this.app.keyframeCameraAtPlayhead();
      body.querySelector('#btnCamSmoothPath')?.addEventListener('click', () => this.app.smoothCameraPath());
      body.querySelector('#btnCamReset').onclick = () => this.app.resetCameraRig();
      body.querySelectorAll('[data-cam-preset]').forEach((btn) => {
        btn.onclick = () => {
          const pid = btn.dataset.camPreset;
          this.app.mutateProject(() => {
            KeyframeEngine.applyCameraPreset(cam, pid, this.app.project.durationFrames);
          });
          this.app.showToast(`Applied camera motion: ${btn.textContent.trim()}`);
        };
      });
      return;
    }

    if (!layer) return;

    if (this.activeStyleTab === 'fx') {
      this.bindFxTabEvents(body, layer);
      return;
    }

    if (this.activeStyleTab === 'mask') {
      this.bindMaskTransTabEvents(body, layer);
      return;
    }

    if (layer.type === 'text' && layer.textProps) {
      const tp = layer.textProps;
      body.querySelectorAll('[data-txt-sub]').forEach((btn) => {
        btn.onclick = () => {
          this.activeTextSubTab = btn.dataset.txtSub;
          this.renderStylePanel();
        };
      });
      body.querySelector('#btnTextOpenDraw')?.addEventListener('click', () => this.app.openDrawModal());
      body.querySelector('#btnTextTtsSpeak')?.addEventListener('click', () => {
        const style = body.querySelector('#txtTtsStyle')?.value || 'natural';
        this.app.synthesizeTtsForLayer(tp.text, style);
      });
      body.querySelector('#btnTextOpenCaptions')?.addEventListener('click', () => {
        this.app.hideOpenSheets();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCaptions')).show();
      });
      body.querySelectorAll('[data-apply-txt-tpl]').forEach((btn) => {
        btn.onclick = () => {
          const tpl = TEXT_TEMPLATES.find((t) => t.id === btn.dataset.applyTxtTpl);
          if (!tpl) return;
          this.app.mutateProject(() => {
            layer.textTemplateId = tpl.id;
            Object.assign(layer.textProps, tpl.textProps, { text: layer.textProps.text || tpl.textProps.text });
            if (tpl.presetIn) {
              KeyframeEngine.applyPreset(layer, tpl.presetIn, this.app.project.width, this.app.project.height, 18);
            }
          });
          this.app.showToast(`Applied "${tpl.label}" template`);
        };
      });

      body.querySelector('#btnImportFontLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        this.app.importCustomFont();
      });
      const txtContent = body.querySelector('#txtContent');
      if (txtContent) {
        let origText = tp.text;
        let capturedText = false;
        txtContent.onfocus = () => {
          origText = tp.text;
          capturedText = true;
        };
        txtContent.oninput = (e) => {
          if (!capturedText) {
            origText = tp.text;
            capturedText = true;
          }
          tp.text = e.target.value;
          this.app.renderPreview();
        };
        txtContent.onchange = (e) => {
          const nextText = e.target.value;
          tp.text = origText;
          capturedText = false;
          if (nextText !== origText) {
            this.app.mutateProject(() => {
              tp.text = nextText;
            });
          }
        };
      }
      body.querySelector('#txtFont')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.fontFamily = e.target.value; }));
      body.querySelector('#txtSize')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.fontSize = Number(e.target.value) || 48; }));
      body.querySelector('#txtWeight')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.fontWeight = e.target.value; }));
      body.querySelector('#txtColor')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.color = e.target.value; }));
      body.querySelector('#txtAlign')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.align = e.target.value; }));
      body.querySelector('#txtStrokeW')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.strokeWidth = Number(e.target.value) || 0; }));
      body.querySelector('#txtStrokeCol')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.strokeColor = e.target.value; }));
      body.querySelector('#txtItalic')?.addEventListener('click', () => this.app.mutateProject(() => { tp.italic = !tp.italic; }));
      body.querySelector('#txtUnderline')?.addEventListener('click', () => this.app.mutateProject(() => { tp.underline = !tp.underline; }));
      body.querySelector('#txtCase')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.textCase = e.target.value; }));
      body.querySelector('#txtGradOn')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.gradientEnabled = e.target.checked; }));
      body.querySelector('#txtGradCol2')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.gradientColor2 = e.target.value; tp.gradientEnabled = true; }));
      this.bindLiveRange(body.querySelector('#txtShadow'), body.querySelector('#lblTxtShadow'), tp, 'shadowBlur', (v) => String(Math.round(v)));
      this.bindLiveRange(body.querySelector('#txtSpacing'), body.querySelector('#lblTxtSpacing'), tp, 'letterSpacing', (v) => String(Math.round(v)));
      this.bindLiveRange(body.querySelector('#txtLineHeight'), body.querySelector('#lblTxtLineH'), tp, 'lineHeight', (v) => v.toFixed(2));
      this.bindLiveRange(body.querySelector('#txtCurve'), body.querySelector('#lblTxtCurve'), tp, 'curve', (v) => `${Math.round(v)}°`);
      body.querySelector('#txtBgEnabled')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.bgEnabled = e.target.checked; }));
      body.querySelector('#txtBgColor')?.addEventListener('change', (e) => this.app.mutateProject(() => { tp.bgColor = e.target.value; tp.bgEnabled = true; }));
      this.bindLiveRange(body.querySelector('#txtBgOp'), body.querySelector('#lblTxtBgOp'), tp, 'bgOpacity', (v) => `${Math.round(v * 100)}%`);
      this.bindLiveRange(body.querySelector('#txtBgRad'), body.querySelector('#lblTxtBgRad'), tp, 'bgRadius', (v) => String(Math.round(v)));
      this.bindLiveRange(body.querySelector('#txtBgPad'), body.querySelector('#lblTxtBgPad'), tp, 'bgPadding', (v) => String(Math.round(v)));
    } else if (layer.type === 'shape' && layer.shapeProps) {
      const sp = layer.shapeProps;
      body.querySelector('#shpType').onchange = (e) => this.app.mutateProject(() => { sp.shapeType = e.target.value; });
      body.querySelector('#shpW').onchange = (e) => this.app.mutateProject(() => { layer.width = Number(e.target.value) || 100; });
      body.querySelector('#shpH').onchange = (e) => this.app.mutateProject(() => { layer.height = Number(e.target.value) || 100; });
      body.querySelector('#shpFill').onchange = (e) => this.app.mutateProject(() => { sp.fillColor = e.target.value; });
      body.querySelector('#shpStroke').onchange = (e) => this.app.mutateProject(() => { sp.strokeColor = e.target.value; });
      body.querySelector('#shpStrokeW').onchange = (e) => this.app.mutateProject(() => { sp.strokeWidth = Number(e.target.value) || 0; });
      body.querySelector('#shpRad').onchange = (e) => this.app.mutateProject(() => { sp.cornerRadius = Number(e.target.value) || 0; });
    } else if (layer.type === 'audio' || layer.type === 'video') {
      if (!layer.audioProps) layer.audioProps = { volume: 1, fadeInFrames: 0, fadeOutFrames: 0, muted: false, voiceEffect: 'none', reduceNoise: false, normalize: false };
      const ap = layer.audioProps;
      body.querySelector('#btnToggleBeatMarker')?.addEventListener('click', () => this.app.toggleBeatAtPlayhead());
      body.querySelector('#btnAutoBeatDetect')?.addEventListener('click', () => this.app.autoDetectBeatsForLayer(layer));
      body.querySelector('#btnStyleFreeze')?.addEventListener('click', () => this.app.freezeSelectedFrame());
      body.querySelector('#btnStyleDetachAudio')?.addEventListener('click', () => this.app.detachAudioFromSelected());
      body.querySelector('#btnStyleReplace')?.addEventListener('click', () => this.app.replaceSelectedClip());
      body.querySelector('#btnAudVolKf')?.addEventListener('click', (e) => {
        e.preventDefault();
        const curVol = KeyframeEngine.getValueAtFrame(layer, 'volume', this.app.currentFrame, ap.volume ?? 1);
        this.app.mutateProject(() => {
          KeyframeEngine.setKeyframe(layer, 'volume', this.app.currentFrame, curVol, 'linear');
        });
        this.app.showToast(`Volume keyframed (${Math.round(curVol * 100)}%) @ F${this.app.currentFrame}`);
      });
      body.querySelector('#audMute').onchange = (e) => this.app.mutateProject(() => { ap.muted = e.target.checked; });
      body.querySelector('#audNoise')?.addEventListener('change', (e) => {
        this.app.mutateProject(() => { ap.reduceNoise = e.target.checked; });
        this.app.showToast(e.target.checked ? 'Noise Reduction enabled' : 'Noise Reduction off');
      });
      body.querySelector('#audNormalize')?.addEventListener('change', (e) => {
        this.app.mutateProject(() => { ap.normalize = e.target.checked; });
        this.app.showToast(e.target.checked ? 'Auto Loudness Normalize On' : 'Normalize Off');
      });
      body.querySelector('#audReverse').onchange = (e) => this.app.mutateProject(() => { layer.reversed = e.target.checked; });
      if (layer.type === 'video') {
        body.querySelectorAll('[data-stab-lvl]').forEach((btn) => {
          btn.onclick = () => {
            this.app.stabilizerState.level = btn.dataset.stabLvl;
            if (layer.stabilizer?.frames?.length) {
              this.app.recomputeStabilizerLevel(layer.id, btn.dataset.stabLvl);
            } else {
              this.renderStylePanel();
            }
          };
        });
        body.querySelector('#chkStabEnabled')?.addEventListener('change', (e) => {
          this.app.toggleStabilizerEnabled(layer.id, e.target.checked);
        });
        body.querySelector('#btnStabAnalyze')?.addEventListener('click', () => {
          this.app.runVideoStabilizer(layer.id, this.app.stabilizerState.level);
        });
        body.querySelector('#btnStabCancel')?.addEventListener('click', () => {
          this.app.cancelVideoStabilizer();
        });
        body.querySelector('#btnStabClear')?.addEventListener('click', () => {
          this.app.clearVideoStabilizer(layer.id);
        });
      }
      this.bindLiveRange(body.querySelector('#audVol'), body.querySelector('#lblAudVol'), ap, 'volume', (v) => `${Math.round(v * 100)}%`);
      const audSpeedEl = body.querySelector('#audSpeed');
      const lblAudSpeed = body.querySelector('#lblAudSpeed');
      audSpeedEl.oninput = (e) => { if (lblAudSpeed) lblAudSpeed.textContent = `${Number(e.target.value).toFixed(2)}x`; };
      audSpeedEl.onchange = (e) => this.app.mutateProject(() => TimelineEngine.setClipSpeed(this.app.project, layer.id, Number(e.target.value)));
      body.querySelector('#audFadeIn').onchange = (e) => this.app.mutateProject(() => { ap.fadeInFrames = Number(e.target.value) || 0; });
      body.querySelector('#audFadeOut').onchange = (e) => this.app.mutateProject(() => { ap.fadeOutFrames = Number(e.target.value) || 0; });
      body.querySelectorAll('[data-voice-fx]').forEach((btn) => {
        btn.onclick = () => {
          const vfx = btn.dataset.voiceFx;
          this.app.mutateProject(() => { ap.voiceEffect = vfx; });
          this.app.showToast(`Voice Effect: ${btn.textContent.trim()}`);
        };
      });
      body.querySelectorAll('[data-speed-curve]').forEach((btn) => {
        btn.onclick = () => {
          const curveId = btn.dataset.speedCurve;
          this.app.mutateProject(() => { layer.speedCurve = curveId; });
          this.app.showToast(`Speed Curve: ${SPEED_CURVE_PRESETS[curveId]?.label || curveId}`);
        };
      });
    }
  }

  renderRatioPanel() {
    const body = document.getElementById('ratioBody');
    if (!body) return;
    const p = this.app.project;
    const curKey = `${p.width}x${p.height}`;
    const ratios = [
      { key: '1080x1920', label: '9:16', sub: 'TikTok / Reels', w: 14, h: 24 },
      { key: '1920x1080', label: '16:9', sub: 'YouTube', w: 24, h: 14 },
      { key: '1080x1080', label: '1:1', sub: 'Square', w: 18, h: 18 },
      { key: '1080x1350', label: '4:5', sub: 'IG Portrait', w: 16, h: 20 },
      { key: '1080x1440', label: '3:4', sub: 'Classic', w: 15, h: 20 },
      { key: '1440x1080', label: '4:3', sub: 'Vintage', w: 20, h: 15 },
      { key: '1920x816', label: '2.35:1', sub: 'Cinema', w: 26, h: 11 }
    ];
    const bgMode = p.backgroundMode || 'color';
    const bgSwatches = ['#05070B', '#000000', '#FFFFFF', '#162038', '#1F132A', '#132A23'];
    const gradients = [
      ['#0F172A', '#1E1B4B'],
      ['#1A0B2E', '#FF4081'],
      ['#061826', '#00B8D4'],
      ['#1C110A', '#FF7043'],
      ['#082018', '#00C853'],
      ['#212121', '#607D8B']
    ];
    body.innerHTML = `
      <div class="d-flex gap-2 overflow-x-auto pb-2 mb-2">
        ${ratios.map((r) => `
          <button type="button" class="btn btn-sm ${curKey === r.key ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'} flex-shrink-0 d-flex flex-column align-items-center justify-content-center" style="min-width:74px;min-height:66px;" data-ratio="${r.key}">
            <span class="d-inline-block border ${curKey === r.key ? 'border-dark' : 'border-info'} rounded-1 mb-1" style="width:${r.w}px;height:${r.h}px;"></span>
            <span class="small lh-1">${r.label}</span>
            <span style="font-size:0.58rem;opacity:0.75;">${r.sub}</span>
          </button>
        `).join('')}
      </div>
      <div class="pt-2 border-top border-secondary-subtle">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <span class="small text-secondary fw-semibold">Canvas Background</span>
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn ${bgMode === 'color' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-bg-mode="color">Color</button>
            <button type="button" class="btn ${bgMode === 'gradient' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-bg-mode="gradient">Gradient</button>
            <button type="button" class="btn ${bgMode === 'blur' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-bg-mode="blur">Blur BG</button>
          </div>
        </div>

        ${bgMode === 'color' ? `
          <div class="d-flex align-items-center gap-1 flex-wrap">
            ${bgSwatches.map((hex) => `
              <button type="button" class="btn p-0 rounded-circle border border-secondary" style="width:26px;height:26px;background:${hex};" data-bg="${hex}" aria-label="Background ${hex}"></button>
            `).join('')}
            <input id="ratioBgPicker" type="color" class="form-control form-control-color form-control-sm ms-1" style="width:42px;height:26px;" value="${p.backgroundColor || '#05070B'}" />
          </div>
        ` : bgMode === 'gradient' ? `
          <div class="d-flex align-items-center gap-2 overflow-x-auto">
            ${gradients.map(([c1, c2]) => `
              <button type="button" class="btn p-0 rounded border border-secondary flex-shrink-0" style="width:44px;height:28px;background:linear-gradient(135deg,${c1},${c2});" data-bg-grad="${c1},${c2}" aria-label="Gradient"></button>
            `).join('')}
          </div>
        ` : `
          <div>
            <label class="form-label small text-secondary mb-0">Background Blur Level (${p.backgroundBlurLevel || 2})</label>
            <input id="ratioBlurLevel" type="range" min="1" max="5" step="1" class="form-range" value="${p.backgroundBlurLevel || 2}" />
          </div>
        `}
      </div>
    `;
    body.querySelectorAll('[data-ratio]').forEach((btn) => {
      btn.onclick = () => {
        const [w, h] = btn.dataset.ratio.split('x').map(Number);
        this.app.mutateProject(() => {
          p.width = w;
          p.height = h;
        });
        this.renderRatioPanel();
      };
    });
    body.querySelectorAll('[data-bg-mode]').forEach((btn) => {
      btn.onclick = () => {
        this.app.mutateProject(() => { p.backgroundMode = btn.dataset.bgMode; });
        this.renderRatioPanel();
      };
    });
    body.querySelectorAll('[data-bg]').forEach((btn) => {
      btn.onclick = () => {
        this.app.mutateProject(() => { p.backgroundColor = btn.dataset.bg; p.backgroundMode = 'color'; });
        this.renderRatioPanel();
      };
    });
    body.querySelector('#ratioBgPicker')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { p.backgroundColor = e.target.value; p.backgroundMode = 'color'; });
    });
    body.querySelectorAll('[data-bg-grad]').forEach((btn) => {
      btn.onclick = () => {
        const cols = btn.dataset.bgGrad.split(',');
        this.app.mutateProject(() => { p.backgroundGradient = cols; p.backgroundMode = 'gradient'; });
      };
    });
    body.querySelector('#ratioBlurLevel')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { p.backgroundBlurLevel = Number(e.target.value) || 2; p.backgroundMode = 'blur'; });
    });
  }

  buildFxTabHtml(layer) {
    if (layer.type === 'audio' || layer.type === 'group') {
      return `<div class="text-center text-secondary py-4 small">Video Effects, Filters, Adjust, and Chroma Key apply to Video, Image, Text, and Shape layers.</div>`;
    }
    const fx = this.ensureLayerFx(layer);
    const vfx = this.ensureLayerVfx(layer);
    const blend = layer.blendMode || 'normal';
    const thumbSrc = this.getPreviewThumbSrc();
    const effectCats = [
      { id: 'all', label: 'All' },
      { id: 'trending', label: 'Trending' },
      { id: 'retro', label: 'Retro' },
      { id: 'lens', label: 'Lens/Optic' }
    ];
    const filterCats = [
      { id: 'all', label: 'All' },
      { id: 'cinema', label: 'Cinema' },
      { id: 'warm', label: 'Warm/Vibe' },
      { id: 'bw', label: 'Film/B&W' },
      { id: 'neon', label: 'Neon/Ice' }
    ];
    const visibleVfx = this.activeEffectCat === 'all'
      ? VIDEO_EFFECT_PRESETS
      : VIDEO_EFFECT_PRESETS.filter((e) => e.id === 'none' || e.cat === this.activeEffectCat);
    const visibleFilters = this.activeFilterCat === 'all'
      ? FILTER_PRESETS
      : FILTER_PRESETS.filter((f) => f.id === 'normal' || f.cat === this.activeFilterCat);
    const curHsl = fx.hsl?.[this.selectedHslIdx] || [0, 0, 0];
    const activeCh = HSL_CHANNELS[this.selectedHslIdx] || HSL_CHANNELS[0];

    return `
      <div class="d-flex justify-content-between align-items-center mb-2 gap-1">
        <div class="btn-group btn-group-sm flex-grow-1">
          <button type="button" class="btn ${this.activeFxSubTab === 'effects' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-fx-sub="effects">Effects</button>
          <button type="button" class="btn ${this.activeFxSubTab === 'filters' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-fx-sub="filters">Filters</button>
          <button type="button" class="btn ${this.activeFxSubTab === 'adjust' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-fx-sub="adjust">Adjust/HSL</button>
          <button type="button" class="btn ${this.activeFxSubTab === 'chroma' ? 'btn-success text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-fx-sub="chroma">Cutout</button>
        </div>
        <button id="btnFxReset" class="btn btn-xs btn-outline-secondary py-1 px-2">Reset</button>
      </div>

      ${this.activeFxSubTab === 'effects' ? `
        <div class="mf-cat-scroll mb-1">
          ${effectCats.map((c) => `
            <button type="button" class="btn btn-xs ${this.activeEffectCat === c.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'} py-0 px-2 text-nowrap" data-ef-cat="${c.id}">${c.label}</button>
          `).join('')}
        </div>
        <div class="mf-tile-grid mb-2">
          ${visibleVfx.map((ef) => `
            <button type="button" class="mf-preview-tile ${(vfx.type || 'none') === ef.id ? 'active' : ''}" data-vfx-id="${ef.id}">
              <div class="mf-tile-stage">
                <img src="${thumbSrc}" class="mf-tile-thumb" style="filter:${ef.css};" alt="${this.esc(ef.label)}" />
                <span class="mf-tile-badge" style="color:${ef.accent};">${ef.badge}</span>
              </div>
              <div class="mf-tile-label">${ef.label}</div>
            </button>
          `).join('')}
        </div>
        <div class="row g-2 align-items-end">
          <div class="col-4">
            <label class="form-label small text-secondary mb-0">Intensity (<span id="lblVfxInt">${Math.round((vfx.intensity ?? 0.75) * 100)}%</span>)</label>
            <input id="vfxIntensity" type="range" min="0" max="1" step="0.05" class="form-range" value="${vfx.intensity ?? 0.75}" />
          </div>
          <div class="col-4">
            <label class="form-label small text-secondary mb-0">Speed (<span id="lblVfxSpd">${(vfx.speed ?? 1).toFixed(1)}x</span>)</label>
            <input id="vfxSpeed" type="range" min="0.2" max="3" step="0.1" class="form-range" value="${vfx.speed ?? 1}" />
          </div>
          <div class="col-4">
            <button id="btnFxApplyAll" type="button" class="btn btn-xs btn-outline-info w-100 py-1">Apply to All</button>
          </div>
        </div>
      ` : this.activeFxSubTab === 'filters' ? `
        <div class="mf-cat-scroll mb-1">
          ${filterCats.map((c) => `
            <button type="button" class="btn btn-xs ${this.activeFilterCat === c.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'} py-0 px-2 text-nowrap" data-flt-cat="${c.id}">${c.label}</button>
          `).join('')}
        </div>
        <div class="mf-tile-grid mb-2">
          ${visibleFilters.map((fp) => `
            <button type="button" class="mf-preview-tile ${(layer.filterId || 'normal') === fp.id ? 'active' : ''}" data-fx-preset="${fp.id}">
              <div class="mf-tile-stage">
                <img src="${thumbSrc}" class="mf-tile-thumb" style="filter:${fp.css};" alt="${this.esc(fp.label)}" />
              </div>
              <div class="mf-tile-label">${fp.label}</div>
            </button>
          `).join('')}
        </div>
        <div class="row g-2 align-items-end">
          <div class="col-8">
            <label class="form-label small text-secondary mb-0">Filter Intensity (<span id="lblFilterInt">${Math.round((layer.filterIntensity ?? 1) * 100)}%</span>)</label>
            <input id="fxFilterInt" type="range" min="0" max="1" step="0.05" class="form-range" value="${layer.filterIntensity ?? 1}" />
          </div>
          <div class="col-4">
            <button id="btnFilterApplyAll" type="button" class="btn btn-xs btn-outline-info w-100 py-1">Apply to All</button>
          </div>
        </div>
      ` : this.activeFxSubTab === 'chroma' ? `
        <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" id="fxChromaOn" ${fx.chromaEnabled ? 'checked' : ''} />
              <label class="form-check-label small fw-semibold text-success" for="fxChromaOn">Chroma Key (Green / Blue Screen)</label>
            </div>
            <input id="fxChromaColor" type="color" class="form-control form-control-color form-control-sm" style="width:46px;" value="${fx.chromaColor || '#00FF00'}" title="Key Color" />
          </div>
          <div class="row g-2">
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Sim (<span id="lblChromaSim">${(fx.chromaSimilarity ?? 0.35).toFixed(2)}</span>)</label>
              <input id="fxChromaSim" type="range" min="0.05" max="0.75" step="0.01" class="form-range" value="${fx.chromaSimilarity ?? 0.35}" />
            </div>
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Smooth (<span id="lblChromaSm">${(fx.chromaSmoothness ?? 0.12).toFixed(2)}</span>)</label>
              <input id="fxChromaSm" type="range" min="0.01" max="0.35" step="0.01" class="form-range" value="${fx.chromaSmoothness ?? 0.12}" />
            </div>
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Despill (<span id="lblChromaSp">${Math.round((fx.chromaSpill ?? 0.5) * 100)}%</span>)</label>
              <input id="fxChromaSp" type="range" min="0" max="1" step="0.02" class="form-range" value="${fx.chromaSpill ?? 0.5}" />
            </div>
          </div>
        </div>
        <div class="p-2 rounded bg-dark border border-secondary-subtle">
          <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
            <div>
              <div class="small fw-semibold text-info"><i class="bi bi-scissors me-1"></i>Custom Cutout &amp; Alpha Stroke</div>
              <div class="text-secondary" style="font-size:0.65rem;">Erase BG manually with brush &amp; add glowing outline</div>
            </div>
            <button id="btnOpenCutoutBrush" type="button" class="btn btn-xs btn-outline-warning py-1 px-2" ${layer.type === 'video' || layer.type === 'image' ? '' : 'disabled'}>
              <i class="bi bi-eraser-fill me-1"></i>Brush Cutout
            </button>
          </div>
          <div class="row g-2 align-items-center">
            <div class="col-8">
              <label class="form-label small text-secondary mb-0">Subject Outline (<span id="lblFxOutlineW">${Math.round((fx.outlineWidth || 0) * 100)}</span>)</label>
              <input id="fxOutlineW" type="range" min="0" max="1" step="0.05" class="form-range" value="${fx.outlineWidth || 0}" />
            </div>
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Stroke Color</label>
              <input id="fxOutlineCol" type="color" class="form-control form-control-color form-control-sm w-100" value="${fx.outlineColor || '#FFFFFF'}" />
            </div>
          </div>
        </div>
      ` : `
        <div class="d-flex justify-content-between align-items-center gap-1 mb-2">
          <div class="d-flex gap-1">
            <button id="btnStyleCopy" type="button" class="btn btn-xs btn-outline-info py-1 px-2"><i class="bi bi-copy me-1"></i>Copy Style</button>
            <button id="btnStylePaste" type="button" class="btn btn-xs btn-outline-warning py-1 px-2" ${this.app.copiedClipStyle ? '' : 'disabled'}><i class="bi bi-clipboard-check me-1"></i>Paste Style</button>
          </div>
          <button id="btnAdjApplyAll" type="button" class="btn btn-xs btn-outline-light py-1 px-2">Apply to All</button>
        </div>

        <div class="row g-2 mb-2 align-items-center">
          <div class="col-7">
            <label class="form-label small text-secondary mb-0">Blend Mode</label>
            <select id="fxBlendMode" class="form-select form-select-sm">
              <option value="normal" ${blend === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="add" ${blend === 'add' ? 'selected' : ''}>Add (Glow / Linear Dodge)</option>
              <option value="screen" ${blend === 'screen' ? 'selected' : ''}>Screen</option>
              <option value="multiply" ${blend === 'multiply' ? 'selected' : ''}>Multiply</option>
            </select>
          </div>
          <div class="col-5 pt-3">
            ${layer.type === 'video' ? `
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" id="fxReverseChk" ${layer.reversed ? 'checked' : ''} />
                <label class="form-check-label small" for="fxReverseChk">Reverse Clip</label>
              </div>
            ` : `<span class="small text-secondary">WebGL Color Engine</span>`}
          </div>
        </div>

        <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
          <div class="small fw-semibold text-info mb-1"><i class="bi bi-palette me-1"></i>HSL Selective Color (${activeCh.label})</div>
          <div class="mf-cat-scroll mb-2">
            ${HSL_CHANNELS.map((ch) => `
              <button type="button" class="mf-hsl-pill ${this.selectedHslIdx === ch.idx ? 'active' : ''}" data-hsl-ch="${ch.idx}" title="${ch.label}">
                <span class="mf-hsl-dot" style="background:${ch.color};"></span>
              </button>
            `).join('')}
          </div>
          <div class="row g-2">
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Hue (<span id="lblHslH">${Math.round(curHsl[0] * 100)}</span>)</label>
              <input id="fxHslH" type="range" min="-1" max="1" step="0.05" class="form-range" value="${curHsl[0]}" />
            </div>
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Sat (<span id="lblHslS">${Math.round(curHsl[1] * 100)}</span>)</label>
              <input id="fxHslS" type="range" min="-1" max="1" step="0.05" class="form-range" value="${curHsl[1]}" />
            </div>
            <div class="col-4">
              <label class="form-label small text-secondary mb-0">Lum (<span id="lblHslL">${Math.round(curHsl[2] * 100)}</span>)</label>
              <input id="fxHslL" type="range" min="-1" max="1" step="0.05" class="form-range" value="${curHsl[2]}" />
            </div>
          </div>
        </div>

        <div class="row g-2">
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Brightness (<span id="lblFxBright">${Number(fx.brightness || 0).toFixed(2)}</span>)</label>
            <input id="fxBright" type="range" min="-0.8" max="0.8" step="0.02" class="form-range" value="${fx.brightness || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Contrast (<span id="lblFxContrast">${Number(fx.contrast ?? 1).toFixed(2)}</span>)</label>
            <input id="fxContrast" type="range" min="0.2" max="2.2" step="0.02" class="form-range" value="${fx.contrast ?? 1}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Saturation (<span id="lblFxSat">${Number(fx.saturation ?? 1).toFixed(2)}</span>)</label>
            <input id="fxSat" type="range" min="0" max="2.2" step="0.02" class="form-range" value="${fx.saturation ?? 1}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Exposure (<span id="lblFxExp">${Number(fx.exposure || 0).toFixed(2)}</span>)</label>
            <input id="fxExp" type="range" min="-1.0" max="1.0" step="0.02" class="form-range" value="${fx.exposure || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Highlights (<span id="lblFxHigh">${Number(fx.highlights || 0).toFixed(2)}</span>)</label>
            <input id="fxHigh" type="range" min="-0.6" max="0.6" step="0.02" class="form-range" value="${fx.highlights || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Shadows (<span id="lblFxShad">${Number(fx.shadows || 0).toFixed(2)}</span>)</label>
            <input id="fxShad" type="range" min="-0.6" max="0.6" step="0.02" class="form-range" value="${fx.shadows || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Temp (<span id="lblFxTemp">${Number(fx.temperature || 0).toFixed(2)}</span>)</label>
            <input id="fxTemp" type="range" min="-0.8" max="0.8" step="0.02" class="form-range" value="${fx.temperature || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Tint (<span id="lblFxTint">${Number(fx.tint || 0).toFixed(2)}</span>)</label>
            <input id="fxTint" type="range" min="-0.8" max="0.8" step="0.02" class="form-range" value="${fx.tint || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Fade (<span id="lblFxFade">${Math.round((fx.fade || 0) * 100)}%</span>)</label>
            <input id="fxFade" type="range" min="0" max="0.8" step="0.02" class="form-range" value="${fx.fade || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Sharpen (<span id="lblFxSharp">${Number(fx.sharpen || 0).toFixed(2)}</span>)</label>
            <input id="fxSharp" type="range" min="0" max="1" step="0.02" class="form-range" value="${fx.sharpen || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">GPU Blur (<span id="lblFxBlur">${Number(fx.blur || 0).toFixed(1)}</span>)</label>
            <input id="fxBlur" type="range" min="0" max="10" step="0.2" class="form-range" value="${fx.blur || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Vignette (<span id="lblFxVig">${Math.round((fx.vignette || 0) * 100)}%</span>)</label>
            <input id="fxVig" type="range" min="0" max="1" step="0.02" class="form-range" value="${fx.vignette || 0}" />
          </div>
          <div class="col-12">
            <label class="form-label small text-secondary mb-0">Film Grain (<span id="lblFxGrain">${Math.round((fx.grain || 0) * 100)}%</span>)</label>
            <input id="fxGrain" type="range" min="0" max="1" step="0.02" class="form-range" value="${fx.grain || 0}" />
          </div>
        </div>
      `}
    `;
  }

  bindFxTabEvents(body, layer) {
    if (layer.type === 'audio' || layer.type === 'group') return;
    const fx = this.ensureLayerFx(layer);
    const vfx = this.ensureLayerVfx(layer);

    body.querySelectorAll('[data-fx-sub]').forEach((btn) => {
      btn.onclick = () => {
        this.activeFxSubTab = btn.dataset.fxSub;
        this.renderStylePanel();
      };
    });
    body.querySelectorAll('[data-ef-cat]').forEach((btn) => {
      btn.onclick = () => {
        this.activeEffectCat = btn.dataset.efCat;
        this.renderStylePanel();
      };
    });
    body.querySelectorAll('[data-flt-cat]').forEach((btn) => {
      btn.onclick = () => {
        this.activeFilterCat = btn.dataset.fltCat;
        this.renderStylePanel();
      };
    });

    body.querySelectorAll('[data-vfx-id]').forEach((btn) => {
      btn.onclick = () => {
        const vid = btn.dataset.vfxId;
        this.app.mutateProject(() => {
          vfx.type = vid;
          if (!vfx.intensity) vfx.intensity = 0.75;
        });
        this.app.showToast(`Effect: ${VIDEO_EFFECT_PRESETS.find((e) => e.id === vid)?.label || vid}`);
      };
    });

    this.bindLiveRange(body.querySelector('#vfxIntensity'), body.querySelector('#lblVfxInt'), vfx, 'intensity', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#vfxSpeed'), body.querySelector('#lblVfxSpd'), vfx, 'speed', (v) => `${v.toFixed(1)}x`);

    body.querySelectorAll('[data-fx-preset]').forEach((btn) => {
      btn.onclick = () => {
        const fp = FILTER_PRESETS.find((p) => p.id === btn.dataset.fxPreset);
        if (fp) {
          this.app.mutateProject(() => {
            TimelineEngine.applyFilterWithIntensity(layer, fp.id, fp.fx, layer.filterIntensity ?? 1);
          });
          this.app.showToast(`Filter: ${fp.label}`);
        }
      };
    });

    const filterIntEl = body.querySelector('#fxFilterInt');
    const lblFilterInt = body.querySelector('#lblFilterInt');
    if (filterIntEl) {
      let startInt = layer.filterIntensity ?? 1;
      let capInt = false;
      const capStart = () => { if (!capInt) { startInt = layer.filterIntensity ?? 1; capInt = true; } };
      filterIntEl.addEventListener('pointerdown', capStart);
      filterIntEl.addEventListener('input', (e) => {
        capStart();
        const val = Number(e.target.value);
        const fp = FILTER_PRESETS.find((p) => p.id === (layer.filterId || 'normal')) || FILTER_PRESETS[0];
        if (lblFilterInt) lblFilterInt.textContent = `${Math.round(val * 100)}%`;
        TimelineEngine.applyFilterWithIntensity(layer, fp.id, fp.fx, val);
        this.app.renderPreview();
      });
      filterIntEl.addEventListener('change', (e) => {
        const nextVal = Number(e.target.value);
        const fp = FILTER_PRESETS.find((p) => p.id === (layer.filterId || 'normal')) || FILTER_PRESETS[0];
        TimelineEngine.applyFilterWithIntensity(layer, fp.id, fp.fx, startInt);
        capInt = false;
        this.app.mutateProject(() => {
          TimelineEngine.applyFilterWithIntensity(layer, fp.id, fp.fx, nextVal);
        });
      });
    }

    body.querySelector('#btnFxApplyAll')?.addEventListener('click', () => this.app.applyFilterAndAdjustToAllClips(layer));
    body.querySelector('#btnFilterApplyAll')?.addEventListener('click', () => this.app.applyFilterAndAdjustToAllClips(layer));
    body.querySelector('#btnAdjApplyAll')?.addEventListener('click', () => this.app.applyFilterAndAdjustToAllClips(layer));
    body.querySelector('#btnStyleCopy')?.addEventListener('click', () => this.app.copySelectedStyle());
    body.querySelector('#btnStylePaste')?.addEventListener('click', () => this.app.pasteStyleToSelected());
    body.querySelector('#btnOpenCutoutBrush')?.addEventListener('click', () => {
      this.app.hideOpenSheets();
      this.app.openCutoutBrushForSelected();
    });

    body.querySelector('#btnFxReset')?.addEventListener('click', () => {
      this.app.mutateProject(() => {
        layer.filterId = 'normal';
        layer.filterIntensity = 1;
        Object.assign(fx, FILTER_PRESETS[0].fx, {
          blur: 0, sharpen: 0, grain: 0, outlineWidth: 0, outlineColor: '#FFFFFF',
          hsl: Array.from({ length: 8 }, () => [0, 0, 0]),
          chromaEnabled: false, chromaColor: '#00FF00', chromaSimilarity: 0.35, chromaSmoothness: 0.12, chromaSpill: 0.5
        });
        vfx.type = 'none';
        layer.blendMode = 'normal';
      });
    });

    body.querySelector('#fxBlendMode')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { layer.blendMode = e.target.value; });
    });
    body.querySelector('#fxReverseChk')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { layer.reversed = e.target.checked; });
    });

    body.querySelectorAll('[data-hsl-ch]').forEach((btn) => {
      btn.onclick = () => {
        this.selectedHslIdx = Number(btn.dataset.hslCh) || 0;
        this.renderStylePanel();
      };
    });
    const hslVec = fx.hsl[this.selectedHslIdx];
    this.bindLiveRange(body.querySelector('#fxHslH'), body.querySelector('#lblHslH'), hslVec, 0, (v) => String(Math.round(v * 100)));
    this.bindLiveRange(body.querySelector('#fxHslS'), body.querySelector('#lblHslS'), hslVec, 1, (v) => String(Math.round(v * 100)));
    this.bindLiveRange(body.querySelector('#fxHslL'), body.querySelector('#lblHslL'), hslVec, 2, (v) => String(Math.round(v * 100)));

    this.bindLiveRange(body.querySelector('#fxBright'), body.querySelector('#lblFxBright'), fx, 'brightness', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxContrast'), body.querySelector('#lblFxContrast'), fx, 'contrast', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxSat'), body.querySelector('#lblFxSat'), fx, 'saturation', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxExp'), body.querySelector('#lblFxExp'), fx, 'exposure', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxHigh'), body.querySelector('#lblFxHigh'), fx, 'highlights', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxShad'), body.querySelector('#lblFxShad'), fx, 'shadows', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxTemp'), body.querySelector('#lblFxTemp'), fx, 'temperature', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxTint'), body.querySelector('#lblFxTint'), fx, 'tint', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxFade'), body.querySelector('#lblFxFade'), fx, 'fade', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#fxSharp'), body.querySelector('#lblFxSharp'), fx, 'sharpen', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxBlur'), body.querySelector('#lblFxBlur'), fx, 'blur', (v) => v.toFixed(1));
    this.bindLiveRange(body.querySelector('#fxVig'), body.querySelector('#lblFxVig'), fx, 'vignette', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#fxGrain'), body.querySelector('#lblFxGrain'), fx, 'grain', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#fxOutlineW'), body.querySelector('#lblFxOutlineW'), fx, 'outlineWidth', (v) => String(Math.round(v * 100)));
    body.querySelector('#fxOutlineCol')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { fx.outlineColor = e.target.value; });
    });

    body.querySelector('#fxChromaOn')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { fx.chromaEnabled = e.target.checked; });
    });
    body.querySelector('#fxChromaColor')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { fx.chromaColor = e.target.value; });
    });
    this.bindLiveRange(body.querySelector('#fxChromaSim'), body.querySelector('#lblChromaSim'), fx, 'chromaSimilarity', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxChromaSm'), body.querySelector('#lblChromaSm'), fx, 'chromaSmoothness', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#fxChromaSp'), body.querySelector('#lblChromaSp'), fx, 'chromaSpill', (v) => `${Math.round(v * 100)}%`);
  }

  buildMaskTransTabHtml(layer) {
    if (layer.type === 'audio' || layer.type === 'group') {
      return `<div class="text-center text-secondary py-4 small">Crop, Masking &amp; Clip Transitions apply to visual layers (Video, Image, Text, Shape).</div>`;
    }
    const mask = this.ensureLayerMask(layer);
    const tr = this.ensureLayerTransitions(layer);
    const crop = this.ensureLayerCrop(layer);
    const curTrId = this.activeTransSide === 'in' ? tr.inType : tr.outType;
    const curTrFrames = this.activeTransSide === 'in' ? (tr.inFrames || 15) : (tr.outFrames || 15);

    return `
      <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn ${this.activeTransSide === 'in' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-tr-side="in">In</button>
            <button type="button" class="btn ${this.activeTransSide === 'out' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-tr-side="out">Out</button>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button id="btnOpenFullTransitions" type="button" class="btn btn-xs btn-outline-info py-1 px-2"><i class="bi bi-intersect me-1"></i>Between Clips</button>
            <span class="small text-secondary">F</span>
            <input id="trCurFrames" type="number" min="2" max="120" class="form-control form-control-sm" style="width:56px;" value="${curTrFrames}" />
          </div>
        </div>
        <div class="mf-tile-grid">
          ${TRANSITION_PRESETS.map((tp) => `
            <button type="button" class="mf-preview-tile ${(curTrId || 'none') === tp.id ? 'active' : ''}" data-tr-pick="${tp.id}">
              <div class="mf-tile-stage">
                <div class="mf-tr-stage ${tp.animClass || 'mf-tr-none'}">
                  <div class="mf-tr-clip-a">A</div>
                  <div class="mf-tr-clip-b">B</div>
                  <div class="mf-tr-flash-ov"></div>
                </div>
              </div>
              <div class="mf-tile-label">${tp.label}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="small fw-semibold text-warning"><i class="bi bi-crop me-1"></i>Crop Frame Bounds</span>
          <button id="btnCropReset" type="button" class="btn btn-xs btn-outline-secondary py-0 px-2">Reset Crop</button>
        </div>
        <div class="row g-2">
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Left (<span id="lblCropL">${Math.round(crop.left * 100)}%</span>)</label>
            <input id="cropL" type="range" min="0" max="0.45" step="0.01" class="form-range" value="${crop.left}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Right (<span id="lblCropR">${Math.round(crop.right * 100)}%</span>)</label>
            <input id="cropR" type="range" min="0" max="0.45" step="0.01" class="form-range" value="${crop.right}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Top (<span id="lblCropT">${Math.round(crop.top * 100)}%</span>)</label>
            <input id="cropT" type="range" min="0" max="0.45" step="0.01" class="form-range" value="${crop.top}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Bottom (<span id="lblCropB">${Math.round(crop.bottom * 100)}%</span>)</label>
            <input id="cropB" type="range" min="0" max="0.45" step="0.01" class="form-range" value="${crop.bottom}" />
          </div>
        </div>
      </div>

      <div class="p-2 rounded bg-dark border border-secondary-subtle mb-2">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="small fw-semibold text-info"><i class="bi bi-pip me-1"></i>PIP &amp; Split Screen Layouts</span>
        </div>
        <div class="mf-cat-scroll">
          ${PIP_LAYOUT_PRESETS.map((pp) => `
            <button type="button" class="btn btn-xs btn-outline-light py-1 px-2 text-nowrap" data-pip-preset="${pp.id}">${pp.label}</button>
          `).join('')}
        </div>
      </div>

      <div class="p-2 rounded bg-dark border border-secondary-subtle">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="small fw-semibold text-info"><i class="bi bi-bounding-box-circles me-1"></i>Mask Shape</span>
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="mskInvert" ${mask.invert ? 'checked' : ''} />
            <label class="form-check-label small" for="mskInvert">Invert</label>
          </div>
        </div>
        <div class="mf-tile-grid mb-2">
          ${MASK_PRESETS.map((mp) => `
            <button type="button" class="mf-preview-tile ${(mask.type || 'none') === mp.id ? 'active' : ''}" data-mask-pick="${mp.id}">
              <div class="mf-tile-stage"><i class="bi ${mp.icon} fs-4 text-info"></i></div>
              <div class="mf-tile-label">${mp.label}</div>
            </button>
          `).join('')}
        </div>
        <div class="row g-2">
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Rotate (<span id="lblMskRot">${Math.round(mask.rotation || 0)}°</span>)</label>
            <input id="mskRot" type="range" min="-180" max="180" step="2" class="form-range" value="${mask.rotation || 0}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Feather (<span id="lblMskFeather">${mask.feather.toFixed(2)}</span>)</label>
            <input id="mskFeather" type="range" min="0" max="0.25" step="0.01" class="form-range" value="${mask.feather}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Width (<span id="lblMskW">${Math.round(mask.scaleX * 100)}%</span>)</label>
            <input id="mskW" type="range" min="0.1" max="1.2" step="0.02" class="form-range" value="${mask.scaleX}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Height (<span id="lblMskH">${Math.round(mask.scaleY * 100)}%</span>)</label>
            <input id="mskH" type="range" min="0.1" max="1.2" step="0.02" class="form-range" value="${mask.scaleY}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Center X (<span id="lblMskX">${mask.offsetX.toFixed(2)}</span>)</label>
            <input id="mskX" type="range" min="-0.5" max="0.5" step="0.02" class="form-range" value="${mask.offsetX}" />
          </div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-0">Center Y (<span id="lblMskY">${mask.offsetY.toFixed(2)}</span>)</label>
            <input id="mskY" type="range" min="-0.5" max="0.5" step="0.02" class="form-range" value="${mask.offsetY}" />
          </div>
        </div>
      </div>
    `;
  }

  bindMaskTransTabEvents(body, layer) {
    if (layer.type === 'audio' || layer.type === 'group') return;
    const mask = this.ensureLayerMask(layer);
    const tr = this.ensureLayerTransitions(layer);
    const crop = this.ensureLayerCrop(layer);

    body.querySelectorAll('[data-tr-side]').forEach((btn) => {
      btn.onclick = () => {
        this.activeTransSide = btn.dataset.trSide;
        this.renderStylePanel();
      };
    });
    body.querySelectorAll('[data-tr-pick]').forEach((btn) => {
      btn.onclick = () => {
        const val = btn.dataset.trPick;
        this.app.mutateProject(() => {
          if (this.activeTransSide === 'in') tr.inType = val;
          else tr.outType = val;
        });
      };
    });
    body.querySelector('#btnOpenFullTransitions')?.addEventListener('click', () => {
      this.app.hideOpenSheets();
      this.app.openTransitionsSheet({ layerId: layer.id });
    });
    body.querySelector('#trCurFrames')?.addEventListener('change', (e) => {
      const val = Math.max(2, Number(e.target.value) || 15);
      this.app.mutateProject(() => {
        if (this.activeTransSide === 'in') tr.inFrames = val;
        else tr.outFrames = val;
      });
    });

    body.querySelector('#btnCropReset')?.addEventListener('click', () => {
      this.app.mutateProject(() => { crop.left = 0; crop.right = 0; crop.top = 0; crop.bottom = 0; });
    });
    this.bindLiveRange(body.querySelector('#cropL'), body.querySelector('#lblCropL'), crop, 'left', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#cropR'), body.querySelector('#lblCropR'), crop, 'right', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#cropT'), body.querySelector('#lblCropT'), crop, 'top', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#cropB'), body.querySelector('#lblCropB'), crop, 'bottom', (v) => `${Math.round(v * 100)}%`);

    body.querySelectorAll('[data-pip-preset]').forEach((btn) => {
      btn.onclick = () => this.app.applyPipPreset(btn.dataset.pipPreset);
    });
    body.querySelectorAll('[data-mask-pick]').forEach((btn) => {
      btn.onclick = () => {
        this.app.mutateProject(() => { mask.type = btn.dataset.maskPick; });
      };
    });
    body.querySelector('#mskInvert')?.addEventListener('change', (e) => {
      this.app.mutateProject(() => { mask.invert = e.target.checked; });
    });
    this.bindLiveRange(body.querySelector('#mskRot'), body.querySelector('#lblMskRot'), mask, 'rotation', (v) => `${Math.round(v)}°`);
    this.bindLiveRange(body.querySelector('#mskFeather'), body.querySelector('#lblMskFeather'), mask, 'feather', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#mskW'), body.querySelector('#lblMskW'), mask, 'scaleX', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#mskH'), body.querySelector('#lblMskH'), mask, 'scaleY', (v) => `${Math.round(v * 100)}%`);
    this.bindLiveRange(body.querySelector('#mskX'), body.querySelector('#lblMskX'), mask, 'offsetX', (v) => v.toFixed(2));
    this.bindLiveRange(body.querySelector('#mskY'), body.querySelector('#lblMskY'), mask, 'offsetY', (v) => v.toFixed(2));
  }

  renderStickersPanel() {
    const body = document.getElementById('stickersBody');
    if (!body) return;
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn ${this.activeStickerSubTab === 'stickers' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-stk-tab="stickers">Stickers</button>
          <button type="button" class="btn ${this.activeStickerSubTab === 'templates' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-stk-tab="templates">Text Templates</button>
        </div>
        <button id="btnStkOpenDraw" type="button" class="btn btn-sm btn-outline-warning"><i class="bi bi-brush me-1"></i>Draw Doodle</button>
      </div>

      ${this.activeStickerSubTab === 'stickers' ? `
        <div class="mf-tile-grid">
          ${STICKER_PACK.map((s) => `
            <button type="button" class="mf-preview-tile" data-add-sticker="${s.id}">
              <div class="mf-tile-stage">
                ${s.badge
                  ? `<span class="badge bg-dark border border-danger text-white px-2 py-1">🔴 ${s.badge}</span>`
                  : `<span class="mf-sticker-box">${s.emoji}</span>`}
              </div>
              <div class="mf-tile-label">${s.label}</div>
            </button>
          `).join('')}
        </div>
      ` : `
        <div class="mf-tile-grid">
          ${TEXT_TEMPLATES.map((tpl) => {
            const s = tpl.textProps;
            const styleStr = [
              `color:${s.color}`,
              `font-family:${s.fontFamily || 'sans-serif'}`,
              `font-weight:${s.fontWeight || '700'}`,
              s.bgEnabled ? `background:${s.bgColor || '#05070B'};border-radius:${Math.min(10, Math.round((s.bgRadius || 10) / 2))}px;` : '',
              s.shadowBlur ? `text-shadow:0 0 8px ${s.shadowColor || '#00e5ff'};` : '',
              s.strokeWidth ? `-webkit-text-stroke:1px ${s.strokeColor || '#000'};` : ''
            ].join(';');
            return `
              <button type="button" class="mf-preview-tile" data-insert-tpl="${tpl.id}">
                <div class="mf-tile-stage">
                  <span class="mf-tpl-box" style="${styleStr}">${this.esc(tpl.sample)}</span>
                </div>
                <div class="mf-tile-label">${tpl.label}</div>
              </button>
            `;
          }).join('')}
        </div>
      `}
    `;

    body.querySelectorAll('[data-stk-tab]').forEach((btn) => {
      btn.onclick = () => {
        this.activeStickerSubTab = btn.dataset.stkTab;
        this.renderStickersPanel();
      };
    });
    body.querySelector('#btnStkOpenDraw')?.addEventListener('click', () => {
      this.app.hideOpenSheets();
      this.app.openDrawModal();
    });
    body.querySelectorAll('[data-add-sticker]').forEach((btn) => {
      btn.onclick = () => {
        const sticker = STICKER_PACK.find((s) => s.id === btn.dataset.addSticker);
        if (sticker) this.app.insertSticker(sticker);
      };
    });
    body.querySelectorAll('[data-insert-tpl]').forEach((btn) => {
      btn.onclick = () => {
        const tpl = TEXT_TEMPLATES.find((t) => t.id === btn.dataset.insertTpl);
        if (tpl) this.app.insertTextTemplate(tpl);
      };
    });
  }

  renderAudioToolsPanel() {
    const body = document.getElementById('audioToolsBody');
    if (!body) return;
    const vo = this.app.voiceoverState || { recording: false, elapsedSec: 0, statusText: 'Tap Mic to record voiceover at playhead' };
    const sel = this.app.getSelectedLayer();
    const canExtract = sel?.type === 'video' || this.app.project.layers.some((l) => l.type === 'video');
    const canBeatLayer = this.app.project.layers.find((l) => (l.id === sel?.id || true) && (l.type === 'audio' || l.type === 'video') && l.mediaId);
    const sfxCats = [
      { id: 'all', label: 'All' },
      { id: 'trans', label: 'Transition' },
      { id: 'ui', label: 'UI / Pop' },
      { id: 'impact', label: 'Impact' },
      { id: 'retro', label: 'Retro' }
    ];
    const visibleSfx = this.activeSfxCat === 'all'
      ? SFX_PACK
      : SFX_PACK.filter((s) => s.cat === this.activeSfxCat);

    body.innerHTML = `
      <div class="btn-group btn-group-sm w-100 mb-2">
        <button type="button" class="btn ${this.activeAudioHubTab === 'sfx' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-aud-tab="sfx">Sound Effects</button>
        <button type="button" class="btn ${this.activeAudioHubTab === 'voiceover' ? 'btn-danger text-white fw-semibold' : 'btn-dark border-secondary-subtle'}" data-aud-tab="voiceover">Record Voiceover</button>
        <button type="button" class="btn ${this.activeAudioHubTab === 'import' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-aud-tab="import">Sounds &amp; Beats</button>
      </div>

      ${this.activeAudioHubTab === 'sfx' ? `
        <div class="mf-cat-scroll mb-2">
          ${sfxCats.map((c) => `
            <button type="button" class="btn btn-xs ${this.activeSfxCat === c.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'} py-0 px-2 text-nowrap" data-sfx-cat="${c.id}">${c.label}</button>
          `).join('')}
        </div>
        <div class="row g-2">
          ${visibleSfx.map((s) => `
            <div class="col-6 col-sm-4">
              <div class="mf-sfx-tile d-flex align-items-center justify-content-between gap-1">
                <div class="min-w-0">
                  <div class="small fw-semibold text-truncate"><i class="bi ${s.icon} me-1" style="color:${s.color};"></i>${s.label}</div>
                  <div class="text-secondary" style="font-size:0.65rem;">${(s.durMs / 1000).toFixed(2)}s WAV</div>
                </div>
                <div class="d-flex gap-1 flex-shrink-0">
                  <button type="button" class="btn btn-xs btn-outline-light py-1 px-2" data-sfx-play="${s.id}" aria-label="Preview SFX"><i class="bi bi-volume-up"></i></button>
                  <button type="button" class="btn btn-xs mf-btn-accent py-1 px-2" data-sfx-add="${s.id}" aria-label="Add SFX"><i class="bi bi-plus-lg"></i></button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : this.activeAudioHubTab === 'voiceover' ? `
        <div class="text-center py-2">
          <div class="small text-info mb-2 fw-semibold">${this.esc(vo.statusText)}</div>
          <button id="btnVoToggle" type="button" class="mf-vo-rec-btn ${vo.recording ? 'recording' : ''}" aria-label="Toggle Voiceover Recording">
            <i class="bi ${vo.recording ? 'bi-stop-fill' : 'bi-mic-fill'}"></i>
          </button>
          <div class="mt-2 font-monospace small ${vo.recording ? 'text-danger fw-bold' : 'text-secondary'}">${vo.recording ? `REC 00:${String(vo.elapsedSec || 0).padStart(2, '0')}` : '44.1kHz WAV Mono'}</div>
        </div>
      ` : `
        <div class="row g-2 py-2">
          <div class="col-4">
            <button id="btnAudHubDevice" type="button" class="btn btn-dark border border-secondary-subtle w-100 py-3 d-flex flex-column align-items-center gap-1">
              <i class="bi bi-music-note-beamed fs-3 text-warning"></i>
              <span class="small fw-semibold">Device Music</span>
              <span class="text-secondary" style="font-size:0.62rem;">MP3, WAV, M4A</span>
            </button>
          </div>
          <div class="col-4">
            <button id="btnAudHubExtract" type="button" class="btn btn-dark border border-secondary-subtle w-100 py-3 d-flex flex-column align-items-center gap-1" ${canExtract ? '' : 'disabled'}>
              <i class="bi bi-file-earmark-music fs-3 text-info"></i>
              <span class="small fw-semibold">Extract Audio</span>
              <span class="text-secondary" style="font-size:0.62rem;">Separate lane</span>
            </button>
          </div>
          <div class="col-4">
            <button id="btnAudHubAutoBeats" type="button" class="btn btn-dark border border-secondary-subtle w-100 py-3 d-flex flex-column align-items-center gap-1" ${canBeatLayer ? '' : 'disabled'}>
              <i class="bi bi-activity fs-3 text-success"></i>
              <span class="small fw-semibold">Auto Beats</span>
              <span class="text-secondary" style="font-size:0.62rem;">Detect peaks</span>
            </button>
          </div>
        </div>
      `}
    `;

    body.querySelectorAll('[data-aud-tab]').forEach((btn) => {
      btn.onclick = () => {
        this.activeAudioHubTab = btn.dataset.audTab;
        this.renderAudioToolsPanel();
      };
    });
    body.querySelectorAll('[data-sfx-cat]').forEach((btn) => {
      btn.onclick = () => {
        this.activeSfxCat = btn.dataset.sfxCat;
        this.renderAudioToolsPanel();
      };
    });
    body.querySelectorAll('[data-sfx-play]').forEach((btn) => {
      btn.onclick = () => this.app.previewSfx(btn.dataset.sfxPlay);
    });
    body.querySelectorAll('[data-sfx-add]').forEach((btn) => {
      btn.onclick = () => this.app.insertSfx(btn.dataset.sfxAdd);
    });
    body.querySelector('#btnVoToggle')?.addEventListener('click', () => this.app.toggleVoiceoverRecord());
    body.querySelector('#btnAudHubDevice')?.addEventListener('click', () => {
      this.app.hideOpenSheets();
      this.app.triggerDeviceAudioPick('audio_at_playhead');
    });
    body.querySelector('#btnAudHubExtract')?.addEventListener('click', () => {
      if (!sel || sel.type !== 'video') {
        const firstVid = this.app.project.layers.find((l) => l.type === 'video');
        if (firstVid) this.app.selectedLayerId = firstVid.id;
      }
      this.app.detachAudioFromSelected();
      this.app.hideOpenSheets();
    });
    body.querySelector('#btnAudHubAutoBeats')?.addEventListener('click', async () => {
      const target = (sel && (sel.type === 'audio' || sel.type === 'video') && sel.mediaId)
        ? sel
        : this.app.project.layers.find((l) => (l.type === 'audio' || l.type === 'video') && l.mediaId);
      if (target) {
        await this.app.autoDetectBeatsForLayer(target);
        this.app.hideOpenSheets();
      }
    });
  }

  renderTemplatesPanel() {
    const body = document.getElementById('templatesBody');
    if (!body) return;
    const visualCount = (this.app.mediaItems || []).filter((m) => m.type === 'video' || m.type === 'image').length;
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="small text-secondary">Applies beats, transitions, curves &amp; 3D camera across your imported clips.</span>
        <span class="badge ${visualCount > 0 ? 'bg-info text-dark' : 'bg-secondary'}">${visualCount} clips ready</span>
      </div>
      <div class="row g-2">
        ${AUTO_EDIT_TEMPLATES.map((tpl) => `
          <div class="col-12 col-sm-4">
            <div class="mf-auto-tpl-card h-100 d-flex flex-column justify-content-between gap-2">
              <div>
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="fw-semibold small">${tpl.label}</span>
                  <span class="badge" style="background:${tpl.accent};color:#071018;font-size:0.6rem;">${tpl.badge}</span>
                </div>
                <div class="text-secondary" style="font-size:0.72rem;">${tpl.desc}</div>
              </div>
              <button type="button" class="btn btn-sm mf-btn-accent fw-semibold w-100" data-auto-tpl="${tpl.id}">
                <i class="bi bi-magic me-1"></i>Apply Template
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    body.querySelectorAll('[data-auto-tpl]').forEach((btn) => {
      btn.onclick = () => this.app.applyAutoEditTemplate(btn.dataset.autoTpl);
    });
  }

  renderTransitionsPanel() {
    const body = document.getElementById('transitionsBody');
    if (!body) return;

    const project = this.app.project;
    const fps = Math.max(1, project.fps || 30);
    const junctions = TimelineEngine.findTransitionJunctions(project);
    const visualLayers = project.layers.filter((l) => l.type !== 'audio' && l.type !== 'group');

    let tgt = this.transitionTarget || { mode: 'junction', leftId: null, rightId: null, layerId: null };
    let activeJunction = null;

    if (tgt.leftId && tgt.rightId) {
      activeJunction = junctions.find((j) => j.leftId === tgt.leftId && j.rightId === tgt.rightId) || null;
    }
    if (!activeJunction && junctions.length > 0 && tgt.mode === 'junction') {
      const selId = tgt.layerId || this.app.selectedLayerId;
      activeJunction = junctions.find((j) => j.leftId === selId || j.rightId === selId)
        || [...junctions].sort((a, b) => Math.abs(a.seamFrame - this.app.currentFrame) - Math.abs(b.seamFrame - this.app.currentFrame))[0];
    }

    if (tgt.mode === 'junction' && !activeJunction) {
      tgt = { ...tgt, mode: 'in' };
    }
    if (activeJunction && tgt.mode === 'junction') {
      tgt.leftId = activeJunction.leftId;
      tgt.rightId = activeJunction.rightId;
    }

    const activeLayer = visualLayers.find((l) => l.id === (tgt.layerId || this.app.selectedLayerId))
      || visualLayers[0]
      || null;
    if (activeLayer && !tgt.layerId) tgt.layerId = activeLayer.id;
    this.transitionTarget = tgt;

    let currentType = 'none';
    let currentFrames = Math.round(fps * 0.8);
    if (tgt.mode === 'junction' && activeJunction) {
      currentType = activeJunction.type || 'none';
      currentFrames = activeJunction.durationFrames || Math.round(fps * 0.8);
    } else if (activeLayer) {
      const tr = this.ensureLayerTransitions(activeLayer);
      currentType = tgt.mode === 'out' ? (tr.outType || 'none') : (tr.inType || 'none');
      currentFrames = tgt.mode === 'out' ? (tr.outFrames || 15) : (tr.inFrames || 15);
    }
    const currentSec = Math.max(0.2, Math.min(2.0, Number((currentFrames / fps).toFixed(1))));

    const visiblePresets = this.activeTransCat === 'all'
      ? TRANSITION_PRESETS
      : TRANSITION_PRESETS.filter((p) => p.id === 'none' || p.cat === this.activeTransCat);

    body.innerHTML = `
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn ${tgt.mode === 'junction' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-tr-mode="junction" ${junctions.length === 0 ? 'disabled' : ''}>
            <i class="bi bi-intersect me-1"></i>Cut Seam (${junctions.length})
          </button>
          <button type="button" class="btn ${tgt.mode === 'in' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-tr-mode="in" ${!activeLayer ? 'disabled' : ''}>Clip In</button>
          <button type="button" class="btn ${tgt.mode === 'out' ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'}" data-tr-mode="out" ${!activeLayer ? 'disabled' : ''}>Clip Out</button>
        </div>

        ${tgt.mode === 'junction' && activeJunction ? `
          <select id="selTransJunction" class="form-select form-select-sm flex-grow-1" style="max-width:230px;">
            ${junctions.map((j) => `
              <option value="${j.id}" ${j.id === activeJunction.id ? 'selected' : ''}>
                ${this.esc(j.left.name)} ⇄ ${this.esc(j.right.name)} (@F${j.seamFrame})
              </option>
            `).join('')}
          </select>
        ` : activeLayer ? `
          <span class="badge bg-secondary-subtle text-light text-truncate" style="max-width:190px;">${this.esc(activeLayer.name)}</span>
        ` : ''}
      </div>

      ${junctions.length === 0 ? `
        <div class="alert alert-dark border-secondary-subtle py-1 px-2 mb-2 small text-secondary">
          <i class="bi bi-info-circle text-info me-1"></i>Split a clip or import sequential clips to unlock Cut Seam transitions — or apply Clip In/Out below.
        </div>
      ` : ''}

      <div class="mf-cat-scroll mb-2">
        ${TRANSITION_CATEGORIES.map((c) => `
          <button type="button" class="btn btn-xs ${this.activeTransCat === c.id ? 'btn-info text-dark fw-semibold' : 'btn-dark border-secondary-subtle'} py-0 px-2 text-nowrap" data-tr-cat="${c.id}">${c.label}</button>
        `).join('')}
      </div>

      <div class="mf-tile-grid mb-2">
        ${visiblePresets.map((tp) => `
          <button type="button" class="mf-preview-tile ${currentType === tp.id ? 'active' : ''}" data-tr-apply="${tp.id}">
            <div class="mf-tile-stage">
              <div class="mf-tr-stage ${tp.animClass}">
                <div class="mf-tr-clip-a">A</div>
                <div class="mf-tr-clip-b">B</div>
                <div class="mf-tr-flash-ov"></div>
              </div>
              ${tp.badge ? `<span class="mf-tile-badge">${tp.badge}</span>` : ''}
            </div>
            <div class="mf-tile-label">${tp.label}</div>
          </button>
        `).join('')}
      </div>

      <div class="p-2 rounded bg-dark border border-secondary-subtle">
        <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
          <label class="form-label small text-secondary mb-0">Duration: <strong id="lblTransSheetDur" class="text-info">${currentSec.toFixed(1)}s</strong> (${currentFrames}f)</label>
          <div class="d-flex gap-1">
            ${tgt.mode === 'junction' && activeJunction ? `
              <button id="btnTransPreviewSeam" type="button" class="btn btn-xs btn-outline-light py-1 px-2"><i class="bi bi-play-fill me-1"></i>Preview</button>
              <button id="btnTransApplyAll" type="button" class="btn btn-xs btn-outline-info py-1 px-2" ${junctions.length < 2 ? 'disabled' : ''}><i class="bi bi-check2-all me-1"></i>Apply to All</button>
            ` : ''}
          </div>
        </div>
        <input id="rngTransSheetDur" type="range" min="0.2" max="2.0" step="0.1" class="form-range" value="${currentSec}" />
      </div>
    `;

    body.querySelectorAll('[data-tr-mode]').forEach((btn) => {
      btn.onclick = () => {
        this.transitionTarget.mode = btn.dataset.trMode;
        this.renderTransitionsPanel();
      };
    });

    body.querySelector('#selTransJunction')?.addEventListener('change', (e) => {
      const found = junctions.find((j) => j.id === e.target.value);
      if (found) {
        this.transitionTarget = { mode: 'junction', leftId: found.leftId, rightId: found.rightId, layerId: found.leftId };
        this.renderTransitionsPanel();
      }
    });

    body.querySelectorAll('[data-tr-cat]').forEach((btn) => {
      btn.onclick = () => {
        this.activeTransCat = btn.dataset.trCat;
        this.renderTransitionsPanel();
      };
    });

    const getChosenFrames = () => {
      const secVal = Number(body.querySelector('#rngTransSheetDur')?.value || currentSec);
      return Math.max(4, Math.round(secVal * fps));
    };

    body.querySelectorAll('[data-tr-apply]').forEach((btn) => {
      btn.onclick = () => {
        const typeId = btn.dataset.trApply;
        const durF = getChosenFrames();
        this.app.applyTransitionFromSheet(typeId, durF, this.transitionTarget);
      };
    });

    body.querySelector('#rngTransSheetDur')?.addEventListener('input', (e) => {
      const secVal = Number(e.target.value) || 0.8;
      const lbl = body.querySelector('#lblTransSheetDur');
      if (lbl) lbl.textContent = `${secVal.toFixed(1)}s`;
    });
    body.querySelector('#rngTransSheetDur')?.addEventListener('change', (e) => {
      const secVal = Number(e.target.value) || 0.8;
      const durF = Math.max(4, Math.round(secVal * fps));
      if (currentType && currentType !== 'none') {
        this.app.applyTransitionFromSheet(currentType, durF, this.transitionTarget);
      }
    });

    body.querySelector('#btnTransApplyAll')?.addEventListener('click', () => {
      const durF = getChosenFrames();
      this.app.applyTransitionToAllFromSheet(currentType, durF);
    });

    body.querySelector('#btnTransPreviewSeam')?.addEventListener('click', async () => {
      if (!activeJunction) return;
      const startPreview = Math.max(0, activeJunction.seamFrame - Math.round(fps * 1.1));
      this.app.pause();
      await this.app.seekToFrame(startPreview);
      this.app.play();
    });
  }

  buildTrackerTabHtml() {
    const tr = this.app.trackerState;
    const visualSources = this.app.project.layers.filter((l) => l.type === 'video' || l.type === 'image');
    const srcLayer = visualSources.find((l) => l.id === tr.sourceLayerId) || visualSources[0] || null;
    const trackData = srcLayer?.trackData || null;
    const pinnableLayers = this.app.project.layers.filter(
      (l) => l.id !== srcLayer?.id && l.type !== 'audio'
    );

    if (!srcLayer) {
      return `<div class="text-center text-secondary py-4 small">Import and add a Video (or Image) clip to the timeline first to use Motion Tracking.</div>`;
    }

    const ptCount = trackData?.points?.length || 0;
    return `
      <div class="row g-2 mb-2 align-items-end">
        <div class="col-7">
          <label class="form-label small text-secondary mb-0">Video / Source Layer</label>
          <select id="trkSourceSel" class="form-select form-select-sm" ${tr.isTracking ? 'disabled' : ''}>
            ${visualSources.map((v) => `<option value="${v.id}" ${v.id === srcLayer.id ? 'selected' : ''}>${this.esc(v.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-5">
          <button id="btnTrkAimToggle" class="btn btn-sm w-100 ${tr.active ? 'btn-warning text-dark fw-semibold' : 'btn-outline-warning'}">
            <i class="bi bi-crosshair me-1"></i>${tr.active ? 'Aiming On' : 'Aim Target'}
          </button>
        </div>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-3">
          <label class="form-label small text-secondary mb-0">Target X</label>
          <input id="trkX" type="number" class="form-control form-control-sm" value="${Math.round(tr.targetX)}" ${tr.isTracking ? 'disabled' : ''} />
        </div>
        <div class="col-3">
          <label class="form-label small text-secondary mb-0">Target Y</label>
          <input id="trkY" type="number" class="form-control form-control-sm" value="${Math.round(tr.targetY)}" ${tr.isTracking ? 'disabled' : ''} />
        </div>
        <div class="col-3">
          <label class="form-label small text-secondary mb-0">Box Size</label>
          <select id="trkBoxSize" class="form-select form-select-sm" ${tr.isTracking ? 'disabled' : ''}>
            <option value="20" ${tr.patchRadius === 20 ? 'selected' : ''}>Small</option>
            <option value="28" ${tr.patchRadius === 28 ? 'selected' : ''}>Medium</option>
            <option value="40" ${tr.patchRadius === 40 ? 'selected' : ''}>Large</option>
          </select>
        </div>
        <div class="col-3">
          <label class="form-label small text-secondary mb-0">On Exit</label>
          <select id="trkExitMode" class="form-select form-select-sm" ${tr.isTracking ? 'disabled' : ''}>
            <option value="fadeTrim" ${tr.exitMode === 'fadeTrim' ? 'selected' : ''}>Fade+Trim</option>
            <option value="slideTrim" ${tr.exitMode === 'slideTrim' ? 'selected' : ''}>Slide+Trim</option>
            <option value="none" ${tr.exitMode === 'none' ? 'selected' : ''}>Keep Visible</option>
          </select>
        </div>
      </div>

      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div class="d-flex flex-wrap gap-3">
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="trkScaleChk" ${tr.trackScale ? 'checked' : ''} ${tr.isTracking ? 'disabled' : ''} />
            <label class="form-check-label small" for="trkScaleChk">Scale / Zoom</label>
          </div>
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="trkTilt3DChk" ${tr.trackTilt3D ? 'checked' : ''} ${tr.isTracking ? 'disabled' : ''} />
            <label class="form-check-label small" for="trkTilt3DChk">3D Tilt &amp; Roll</label>
          </div>
          <div class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="trkDepthZChk" ${tr.use3DDepth ? 'checked' : ''} ${tr.isTracking ? 'disabled' : ''} />
            <label class="form-check-label small" for="trkDepthZChk">True Depth (Z)</label>
          </div>
        </div>
        <span class="small text-secondary">3D X/Y/Z + Tilt · Drag <span class="text-warning">[+]</span></span>
      </div>

      ${tr.isTracking ? `
        <div class="p-2 rounded bg-dark border border-warning-subtle mb-2">
          <div class="d-flex justify-content-between small mb-1">
            <span class="text-warning fw-semibold">Tracking 3D motion &amp; orientation...</span>
            <span id="trkPctLbl">${tr.progressPct}%</span>
          </div>
          <div class="progress mf-export-progress mb-1">
            <div class="progress-bar bg-warning" style="width:${tr.progressPct}%"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <span id="trkDetailLbl" class="small text-secondary">${this.esc(tr.progressDetail)}</span>
            <button id="btnTrkCancel" class="btn btn-xs btn-outline-danger py-0 px-2">Stop</button>
          </div>
        </div>
      ` : `
        <div class="d-flex gap-1 mb-2">
          <button id="btnTrkBack" class="btn btn-sm btn-outline-info flex-grow-1"><i class="bi bi-skip-backward-fill me-1"></i>Track Back</button>
          <button id="btnTrkBoth" class="btn btn-sm btn-warning text-dark fw-semibold flex-grow-1"><i class="bi bi-arrows-expand-vertical me-1"></i>Track Both</button>
          <button id="btnTrkFwd" class="btn btn-sm mf-btn-accent fw-semibold flex-grow-1">Track Fwd<i class="bi bi-skip-forward-fill ms-1"></i></button>
        </div>
      `}

      ${ptCount > 0 ? `
        <div class="p-2 rounded bg-dark border border-secondary-subtle">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="small fw-semibold text-info">Tracked F${trackData.startFrame} → F${trackData.endFrame} (${ptCount} pts · ${Math.round((trackData.avgConfidence || 0) * 100)}%)</span>
            <button id="btnTrkClear" class="btn btn-xs btn-outline-danger py-0 px-2">Clear</button>
          </div>
          <div class="input-group input-group-sm mb-2">
            <input id="trkNewTextVal" type="text" class="form-control" placeholder="Text label (e.g. Tikungan Tajam)" value="LANDMARK" />
            <input id="trkOffsetY" type="number" class="form-control" style="max-width:68px;" value="-65" title="Y Offset (px)" />
            <button id="btnPinNewText" class="btn mf-btn-accent fw-semibold"><i class="bi bi-pin-angle-fill me-1"></i>Pin Text</button>
          </div>
          ${pinnableLayers.length > 0 ? `
            <div class="input-group input-group-sm">
              <select id="trkTargetLayerSel" class="form-select">
                ${pinnableLayers.map((l) => `<option value="${l.id}">${this.esc(l.name)} (${l.type})</option>`).join('')}
              </select>
              <button id="btnPinExistingLayer" class="btn btn-outline-info">Pin Layer</button>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  bindTrackerTabEvents(body) {
    const tr = this.app.trackerState;
    const visualSources = this.app.project.layers.filter((l) => l.type === 'video' || l.type === 'image');
    const srcLayer = visualSources.find((l) => l.id === tr.sourceLayerId) || visualSources[0] || null;
    if (!srcLayer) return;

    body.querySelector('#trkSourceSel')?.addEventListener('change', (e) => {
      tr.sourceLayerId = e.target.value;
      tr.active = true;
      this.app.syncTrackerOverlay();
      this.renderStylePanel();
    });

    body.querySelector('#btnTrkAimToggle')?.addEventListener('click', () => {
      tr.active = !tr.active;
      if (tr.active) tr.followTrackedPoints = false;
      this.app.syncTrackerOverlay();
      this.renderStylePanel();
    });

    const syncCoords = () => {
      tr.targetX = Number(body.querySelector('#trkX').value) || 0;
      tr.targetY = Number(body.querySelector('#trkY').value) || 0;
      tr.active = true;
      tr.followTrackedPoints = false;
      this.app.syncTrackerOverlay();
    };
    body.querySelector('#trkX')?.addEventListener('change', syncCoords);
    body.querySelector('#trkY')?.addEventListener('change', syncCoords);

    body.querySelector('#trkBoxSize')?.addEventListener('change', (e) => {
      tr.patchRadius = Number(e.target.value) || 28;
      this.app.syncTrackerOverlay();
    });
    body.querySelector('#trkExitMode')?.addEventListener('change', (e) => {
      tr.exitMode = e.target.value;
    });
    body.querySelector('#trkScaleChk')?.addEventListener('change', (e) => {
      tr.trackScale = e.target.checked;
    });
    body.querySelector('#trkTilt3DChk')?.addEventListener('change', (e) => {
      tr.trackTilt3D = e.target.checked;
    });
    body.querySelector('#trkDepthZChk')?.addEventListener('change', (e) => {
      tr.use3DDepth = e.target.checked;
    });

    body.querySelector('#btnTrkFwd')?.addEventListener('click', () => this.app.runMotionTrack('forward'));
    body.querySelector('#btnTrkBack')?.addEventListener('click', () => this.app.runMotionTrack('backward'));
    body.querySelector('#btnTrkBoth')?.addEventListener('click', () => this.app.runMotionTrack('both'));
    body.querySelector('#btnTrkCancel')?.addEventListener('click', () => this.app.cancelMotionTrack());

    body.querySelector('#btnTrkClear')?.addEventListener('click', () => {
      this.app.mutateProject(() => { srcLayer.trackData = null; });
    });

    body.querySelector('#btnPinNewText')?.addEventListener('click', () => {
      const txt = body.querySelector('#trkNewTextVal')?.value?.trim() || 'LANDMARK';
      const offY = Number(body.querySelector('#trkOffsetY')?.value);
      this.app.pinNewTrackedText(srcLayer, txt, isFinite(offY) ? offY : -65);
    });

    body.querySelector('#btnPinExistingLayer')?.addEventListener('click', () => {
      const targetId = body.querySelector('#trkTargetLayerSel')?.value;
      if (targetId) this.app.pinExistingLayerToTrack(srcLayer, targetId);
    });
  }

  esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
}
