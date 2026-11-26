export const WasmBridge = {
  exports: null,
  ready: false,
  hasLayerOps: false,

  async tryInit() {
    try {
      const resp = await fetch('./wasm/motionflow_rust.wasm');
      if (!resp.ok) return false;
      const bytes = await resp.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      this.exports = instance.exports;
      this.ready = Boolean(this.exports && typeof this.exports.mf_eval_cubic_bezier === 'function');
      this.hasLayerOps = Boolean(
        this.exports &&
        this.exports.memory &&
        typeof this.exports.mf_layer_snap_frame === 'function' &&
        typeof this.exports.mf_layer_trim_bounds === 'function' &&
        typeof this.exports.mf_layer_split_offsets === 'function' &&
        typeof this.exports.mf_ruler_lod_tier === 'function'
      );
      return this.ready;
    } catch {
      this.ready = false;
      this.hasLayerOps = false;
      return false;
    }
  },

  evalCubicBezier(t, x1, y1, x2, y2) {
    if (this.ready) {
      return this.exports.mf_eval_cubic_bezier(t, x1, y1, x2, y2);
    }
    return null;
  },

  snapFrame(candidateStart, clipLen, playheadFrame, edges, threshold = 4) {
    if (!this.hasLayerOps) return null;
    try {
      const mem = this.exports.memory;
      const neededBytes = 64 + edges.length * 4;
      if (mem.buffer.byteLength < neededBytes + 4096) return null;
      const ptr = mem.buffer.byteLength - neededBytes;
      const view = new Int32Array(mem.buffer, ptr, edges.length);
      for (let i = 0; i < edges.length; i++) view[i] = edges[i] | 0;
      return this.exports.mf_layer_snap_frame(
        candidateStart | 0,
        clipLen | 0,
        playheadFrame | 0,
        ptr,
        edges.length,
        threshold | 0
      );
    } catch {
      return null;
    }
  },

  trimBounds(isRight, origStart, origEnd, origOffset, newFrame, speed, snapEnabled, playheadFrame) {
    if (!this.hasLayerOps) return null;
    try {
      const mem = this.exports.memory;
      const outPtr = mem.buffer.byteLength - 16;
      this.exports.mf_layer_trim_bounds(
        isRight ? 1 : 0,
        origStart | 0,
        origEnd | 0,
        origOffset | 0,
        newFrame | 0,
        speed,
        snapEnabled ? 1 : 0,
        playheadFrame | 0,
        outPtr
      );
      const out = new Int32Array(mem.buffer, outPtr, 3);
      return { startFrame: out[0], endFrame: out[1], mediaOffsetFrames: out[2] };
    } catch {
      return null;
    }
  },

  splitOffsets(origStart, origEnd, splitFrame, origOffset, speed, reversed) {
    if (!this.hasLayerOps) return null;
    try {
      const mem = this.exports.memory;
      const outPtr = mem.buffer.byteLength - 16;
      this.exports.mf_layer_split_offsets(
        origStart | 0,
        origEnd | 0,
        splitFrame | 0,
        origOffset | 0,
        speed,
        reversed ? 1 : 0,
        outPtr
      );
      const out = new Int32Array(mem.buffer, outPtr, 2);
      return { leftOffset: out[0], rightOffset: out[1] };
    } catch {
      return null;
    }
  },

  getRulerLodTier(pxPerFrame, fps = 30) {
    if (this.exports && typeof this.exports.mf_ruler_lod_tier === 'function') {
      return this.exports.mf_ruler_lod_tier(pxPerFrame, fps);
    }
    return null;
  }
};
