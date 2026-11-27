import { KeyframeEngine } from './keyframeEngine.js';
import { TimelineEngine } from './timelineEngine.js';

export function detectBeatsFromPcm(samples, sampleRate, fps = 30, startFrame = 0, sensitivity = 0.65, offsetSec = 0, maxDurSec = Infinity) {
  if (!samples || samples.length === 0 || !sampleRate) return [];
  const winSize = Math.max(256, Math.round(sampleRate * 0.02)); // 20ms energy window
  const startSample = Math.max(0, Math.floor(offsetSec * sampleRate));
  const endSample = isFinite(maxDurSec)
    ? Math.min(samples.length, startSample + Math.ceil(maxDurSec * sampleRate))
    : samples.length;
  if (endSample - startSample < winSize * 2) return [];

  const energies = [];
  for (let i = startSample; i + winSize <= endSample; i += winSize) {
    let sumSq = 0;
    for (let j = 0; j < winSize; j++) {
      const s = samples[i + j];
      sumSq += s * s;
    }
    energies.push(Math.sqrt(sumSq / winSize));
  }

  const radius = 12; // ~240ms local energy average
  const mult = 1.85 - Math.max(0.1, Math.min(0.95, sensitivity)) * 0.7; // lower sensitivity -> higher threshold
  const minGapWins = Math.max(1, Math.round(0.24 / 0.02)); // max ~250 BPM
  const beats = [];
  let lastBeatWin = -minGapWins;

  for (let i = 1; i < energies.length - 1; i++) {
    const cur = energies[i];
    if (cur < 0.035) continue;
    if (cur < energies[i - 1] || cur < energies[i + 1]) continue;
    if (i - lastBeatWin < minGapWins) continue;

    let localSum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(energies.length - 1, i + radius); k++) {
      localSum += energies[k];
      count++;
    }
    const localAvg = localSum / Math.max(1, count);
    if (cur > localAvg * mult) {
      const secFromClipStart = (i * winSize) / sampleRate;
      const frame = Math.round(startFrame + secFromClipStart * fps);
      if (beats.length === 0 || frame - beats[beats.length - 1] >= 4) {
        beats.push(frame);
        lastBeatWin = i;
      }
    }
  }
  return beats;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // mediaId -> AudioBuffer
    this.reversedBuffers = new Map(); // mediaId -> reversed AudioBuffer
    this.peaks = new Map();   // mediaId -> number[]
    this.failedIds = new Set(); // mediaIds with no decodable audio track
    this.pendingLoads = new Map(); // mediaId -> Promise<AudioBuffer|null>
    this.activeSources = [];
    this._playToken = 0;
  }

  getReversedBuffer(mediaId, origBuf) {
    if (!origBuf) return null;
    if (this.reversedBuffers.has(mediaId)) return this.reversedBuffers.get(mediaId);
    const numCh = origBuf.numberOfChannels;
    const len = origBuf.length;
    const rev = this.ctx && typeof this.ctx.createBuffer === 'function'
      ? this.ctx.createBuffer(numCh, len, origBuf.sampleRate)
      : new AudioBuffer({ length: len, numberOfChannels: numCh, sampleRate: origBuf.sampleRate });
    for (let ch = 0; ch < numCh; ch++) {
      const src = origBuf.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        dst[i] = src[len - 1 - i];
      }
    }
    this.reversedBuffers.set(mediaId, rev);
    return rev;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  async loadBuffer(mediaItem) {
    if (!mediaItem || !mediaItem.url) return null;
    if (this.buffers.has(mediaItem.id)) return this.buffers.get(mediaItem.id);
    if (this.failedIds.has(mediaItem.id)) return null;
    if (this.pendingLoads.has(mediaItem.id)) return this.pendingLoads.get(mediaItem.id);

    const job = (async () => {
      try {
        const ctx = this.ensureContext();
        const resp = await fetch(mediaItem.url);
        const arr = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr.slice(0));
        this.buffers.set(mediaItem.id, decoded);
        this.peaks.set(mediaItem.id, this.computePeaks(decoded, 96));
        return decoded;
      } catch {
        this.failedIds.add(mediaItem.id);
        return null;
      } finally {
        this.pendingLoads.delete(mediaItem.id);
      }
    })();

    this.pendingLoads.set(mediaItem.id, job);
    return job;
  }

  async detectBeatsForLayer(layer, mediaItem, fps = 30, sensitivity = 0.65) {
    if (!layer || !mediaItem) return [];
    const buf = await this.loadBuffer(mediaItem);
    if (!buf) return [];
    const speed = Math.max(0.25, Math.min(4.0, layer.speed || 1));
    const clipDurSec = Math.max(0.1, (layer.endFrame - layer.startFrame) / fps);
    const offsetSec = (layer.mediaOffsetFrames || 0) / fps;
    const samples = buf.getChannelData(0);
    return detectBeatsFromPcm(samples, buf.sampleRate, fps * speed, layer.startFrame, sensitivity, offsetSec, clipDurSec * speed);
  }

  getPeaks(mediaId) {
    return this.peaks.get(mediaId) || null;
  }

  hasBuffer(mediaId) {
    return this.buffers.has(mediaId);
  }

  /**
   * Dynamically samples real-time peak + RMS waveform bins for a clip's exact visible timeline slice,
   * respecting mediaOffsetFrames (left trim), speed, speedCurve, and reversed playback.
   */
  sampleWaveformBins(mediaId, layer = null, projectFps = 30, startFrac = 0, endFrac = 1, numBins = 128) {
    const safeBins = Math.max(4, Math.min(1024, Math.round(numBins || 64)));
    const sFrac = Math.max(0, Math.min(1, Number(startFrac) || 0));
    const eFrac = Math.max(sFrac + 1e-6, Math.min(1, endFrac == null ? 1 : Number(endFrac)));
    const buf = this.buffers.get(mediaId);

    if (!buf) {
      const legacy = this.peaks.get(mediaId);
      if (!legacy || legacy.length === 0) {
        return { peaks: new Float32Array(0), rms: new Float32Array(0), hasBuffer: false };
      }
      const peaks = new Float32Array(safeBins);
      const rms = new Float32Array(safeBins);
      for (let i = 0; i < safeBins; i++) {
        const frac = sFrac + ((i + 0.5) / safeBins) * (eFrac - sFrac);
        const idx = Math.min(legacy.length - 1, Math.max(0, Math.floor(frac * legacy.length)));
        const v = Math.max(0, Math.min(1, Number(legacy[idx]) || 0));
        peaks[i] = v;
        rms[i] = v * 0.7;
      }
      return { peaks, rms, hasBuffer: false };
    }

    const fps = Math.max(1, Number(projectFps) || 30);
    const totalTimelineFrames = Math.max(1, ((layer?.endFrame ?? fps) - (layer?.startFrame ?? 0)));
    const baseSpeed = Math.max(0.25, Math.min(4.0, Number(layer?.speed) || 1));
    const hasCustomCurve = Array.isArray(layer?.customSpeedCurve) && layer.customSpeedCurve.length >= 2;
    const hasCurve = hasCustomCurve || Boolean(layer?.speedCurve && layer.speedCurve !== 'none');
    const baseOffsetSec = Math.max(0, (Number(layer?.mediaOffsetFrames) || 0) / fps);
    const isReversed = Boolean(layer?.reversed);

    const clipSpanSrcSec = hasCurve
      ? TimelineEngine.integrateSpeedCurveSourceFrames(layer, totalTimelineFrames) / fps
      : (totalTimelineFrames * baseSpeed) / fps;
    const windowEnd = Math.min(buf.duration, baseOffsetSec + clipSpanSrcSec);

    const timesSec = new Float64Array(safeBins + 1);
    if (!hasCurve) {
      for (let k = 0; k <= safeBins; k++) {
        const norm = sFrac + ((eFrac - sFrac) * k) / safeBins;
        const elapsedSrcSec = (norm * totalTimelineFrames * baseSpeed) / fps;
        timesSec[k] = isReversed ? (windowEnd - elapsedSrcSec) : (baseOffsetSec + elapsedSrcSec);
      }
    } else {
      let curElapsedSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, sFrac * totalTimelineFrames) / fps;
      timesSec[0] = isReversed ? (windowEnd - curElapsedSec) : (baseOffsetSec + curElapsedSec);
      const dLocalFrames = ((eFrac - sFrac) * totalTimelineFrames) / safeBins;
      for (let k = 1; k <= safeBins; k++) {
        const midNormT = sFrac + ((k - 0.5) / safeBins) * (eFrac - sFrac);
        const factor = TimelineEngine.evaluateLayerSpeedFactor(layer, midNormT);
        curElapsedSec += (factor * baseSpeed * dLocalFrames) / fps;
        timesSec[k] = isReversed ? (windowEnd - curElapsedSec) : (baseOffsetSec + curElapsedSec);
      }
    }

    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const sr = Math.max(1, buf.sampleRate || 44100);
    const totalSamples = ch0.length;
    const peaks = new Float32Array(safeBins);
    const rms = new Float32Array(safeBins);

    for (let i = 0; i < safeBins; i++) {
      const tA = timesSec[i];
      const tB = timesSec[i + 1];
      const loSec = Math.min(tA, tB);
      const hiSec = Math.max(tA, tB);
      if (hiSec <= 0 || loSec >= buf.duration || totalSamples === 0) {
        peaks[i] = 0;
        rms[i] = 0;
        continue;
      }

      const s0 = Math.max(0, Math.min(totalSamples - 1, Math.floor(loSec * sr)));
      const s1 = Math.max(s0 + 1, Math.min(totalSamples, Math.ceil(hiSec * sr)));
      const span = s1 - s0;
      const stride = Math.max(1, Math.floor(span / 32));

      let maxAbs = 0;
      let sumSq = 0;
      let checked = 0;
      for (let j = s0; j < s1; j += stride) {
        const a0 = Math.abs(ch0[j]);
        const v = ch1 ? Math.max(a0, Math.abs(ch1[j])) : a0;
        if (v > maxAbs) maxAbs = v;
        sumSq += v * v;
        checked++;
      }
      peaks[i] = Math.min(1, maxAbs);
      rms[i] = checked > 0 ? Math.min(1, Math.sqrt(sumSq / checked)) : 0;
    }

    return {
      peaks,
      rms,
      hasBuffer: true,
      clipDurationSec: totalTimelineFrames / fps,
      offsetSec: baseOffsetSec
    };
  }

  computePeaks(audioBuffer, numBins = 96) {
    const ch = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(ch.length / numBins));
    const peaks = [];
    for (let i = 0; i < numBins; i++) {
      const start = i * blockSize;
      const end = Math.min(ch.length, start + blockSize);
      let maxVal = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > maxVal) maxVal = v;
      }
      peaks.push(Number(maxVal.toFixed(3)));
    }
    return peaks;
  }

  purgeMediaCache(mediaId) {
    if (!mediaId) return;
    this.buffers.delete(mediaId);
    this.reversedBuffers.delete(mediaId);
    this.peaks.delete(mediaId);
    this.failedIds.delete(mediaId);
    this.pendingLoads.delete(mediaId);
  }

  stopAll() {
    this._playToken++;
    for (const item of this.activeSources) {
      try {
        item.source.stop();
        item.source.disconnect();
        item.gain.disconnect();
        if (item.osc) {
          item.osc.stop();
          item.osc.disconnect();
        }
      } catch {}
    }
    this.activeSources = [];
  }

  connectEffectsChain(ctx, src, layer, endGain, startTime = 0) {
    let tail = src;
    let osc = null;
    const ap = layer.audioProps || {};

    if (ap.reduceNoise) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 115;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7200;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.ratio.value = 4;
      tail.connect(hp);
      hp.connect(lp);
      lp.connect(comp);
      tail = comp;
    }

    if (ap.normalize) {
      const normComp = ctx.createDynamicsCompressor();
      normComp.threshold.value = -18;
      normComp.ratio.value = 6;
      normComp.attack.value = 0.005;
      normComp.release.value = 0.16;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.45;
      tail.connect(normComp);
      normComp.connect(makeup);
      tail = makeup;
    }

    const vfx = ap.voiceEffect || 'none';
    if (vfx === 'deep') {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 210;
      low.gain.value = 12;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1150;
      tail.connect(low);
      low.connect(lp);
      tail = lp;
    } else if (vfx === 'chipmunk') {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 420;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 2500;
      peak.Q.value = 1.2;
      peak.gain.value = 11;
      tail.connect(hp);
      hp.connect(peak);
      tail = peak;
    } else if (vfx === 'radio' || vfx === 'megaphone') {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = vfx === 'megaphone' ? 1850 : 1350;
      bp.Q.value = vfx === 'megaphone' ? 3.4 : 2.2;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      const drive = vfx === 'megaphone' ? 6.5 : 3.5;
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = Math.tanh(x * drive);
      }
      shaper.curve = curve;
      tail.connect(bp);
      bp.connect(shaper);
      tail = shaper;
    } else if (vfx === 'robot' || vfx === 'synth') {
      const modGain = ctx.createGain();
      modGain.gain.value = vfx === 'synth' ? 0.72 : 0.55;
      osc = ctx.createOscillator();
      osc.type = vfx === 'synth' ? 'sine' : 'sawtooth';
      osc.frequency.value = vfx === 'synth' ? 28 : 58;
      const oscScale = ctx.createGain();
      oscScale.gain.value = vfx === 'synth' ? 0.28 : 0.45;
      osc.connect(oscScale);
      oscScale.connect(modGain.gain);
      osc.start(startTime);
      tail.connect(modGain);
      tail = modGain;
    } else if (vfx === 'echo' || vfx === 'reverb') {
      const dry = ctx.createGain();
      dry.gain.value = vfx === 'reverb' ? 0.78 : 0.85;
      const delay1 = ctx.createDelay(1.0);
      delay1.delayTime.value = vfx === 'reverb' ? 0.065 : 0.22;
      const fb = ctx.createGain();
      fb.gain.value = vfx === 'reverb' ? 0.52 : 0.36;
      const wet = ctx.createGain();
      wet.gain.value = vfx === 'reverb' ? 0.6 : 0.55;
      tail.connect(dry);
      dry.connect(endGain);
      tail.connect(delay1);
      delay1.connect(fb);
      fb.connect(delay1);
      if (vfx === 'reverb') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;
        delay1.connect(lp);
        lp.connect(wet);
      } else {
        delay1.connect(wet);
      }
      wet.connect(endGain);
      return { osc };
    }

    tail.connect(endGain);
    return { osc };
  }

  _scheduleSpeedCurve(src, layer, playFromFrame, startAtSec, fps) {
    const baseSpeed = Math.max(0.25, Math.min(4.0, layer.speed || 1));
    const hasCustom = Array.isArray(layer?.customSpeedCurve) && layer.customSpeedCurve.length >= 2;
    if (hasCustom || (layer.speedCurve && layer.speedCurve !== 'none')) {
      const durFrames = Math.max(1, layer.endFrame - layer.startFrame);
      const startNorm = Math.max(0, Math.min(1, (playFromFrame - layer.startFrame) / durFrames));
      const startRate = Math.max(0.25, Math.min(4.0, baseSpeed * TimelineEngine.evaluateLayerSpeedFactor(layer, startNorm)));
      src.playbackRate.setValueAtTime(startRate, startAtSec);
      const steps = 16;
      const remFrames = Math.max(1, layer.endFrame - playFromFrame);
      for (let s = 1; s <= steps; s++) {
        const f = playFromFrame + (remFrames * s) / steps;
        const normT = Math.max(0, Math.min(1, (f - layer.startFrame) / durFrames));
        const tSec = startAtSec + (f - playFromFrame) / fps;
        const r = Math.max(0.25, Math.min(4.0, baseSpeed * TimelineEngine.evaluateLayerSpeedFactor(layer, normT)));
        src.playbackRate.linearRampToValueAtTime(r, tSec);
      }
    } else {
      src.playbackRate.value = baseSpeed;
    }
  }

  _scheduleGainWithKeyframes(gainParam, layer, defaultVol, clipStartFrame, playFromFrame, startAtSec, fps, fadeInSec, fadeOutSec, endAtSec, clipDurSec, elapsedInClipSec, remainingTimelineSec) {
    const volKfs = layer.keyframes?.volume;
    if (Array.isArray(volKfs) && volKfs.length > 0) {
      const startVol = Math.max(0, KeyframeEngine.getValueAtFrame(layer, 'volume', playFromFrame, defaultVol));
      gainParam.setValueAtTime(startVol, startAtSec);
      const endFrame = layer.endFrame;
      const stepFrames = Math.max(2, Math.round((endFrame - playFromFrame) / 24));
      for (let f = playFromFrame + stepFrames; f <= endFrame; f += stepFrames) {
        const tSec = startAtSec + (f - playFromFrame) / fps;
        const v = Math.max(0, KeyframeEngine.getValueAtFrame(layer, 'volume', f, defaultVol));
        gainParam.linearRampToValueAtTime(v, tSec);
      }
      const endVol = Math.max(0, KeyframeEngine.getValueAtFrame(layer, 'volume', endFrame, defaultVol));
      gainParam.linearRampToValueAtTime(endVol, endAtSec);
      return;
    }

    if (defaultVol <= 0.0001) {
      gainParam.setValueAtTime(0, startAtSec);
      return;
    }

    gainParam.setValueAtTime(defaultVol, startAtSec);
    const effFadeIn = Math.min(fadeInSec, clipDurSec * 0.5);
    const effFadeOut = Math.min(fadeOutSec, clipDurSec * 0.5);
    if (effFadeIn > 0 && elapsedInClipSec < effFadeIn) {
      const fadeStartGain = (elapsedInClipSec / effFadeIn) * defaultVol;
      gainParam.setValueAtTime(fadeStartGain, startAtSec);
      gainParam.linearRampToValueAtTime(defaultVol, startAtSec + (effFadeIn - elapsedInClipSec));
    }
    if (effFadeOut > 0 && remainingTimelineSec > 0.05) {
      if (elapsedInClipSec >= clipDurSec - effFadeOut) {
        const curVol = Math.max(0, defaultVol * (remainingTimelineSec / effFadeOut));
        gainParam.setValueAtTime(curVol, startAtSec);
        gainParam.linearRampToValueAtTime(0, endAtSec);
      } else {
        const fadeOutStart = Math.max(startAtSec + Math.max(0, effFadeIn - elapsedInClipSec), endAtSec - effFadeOut);
        gainParam.setValueAtTime(defaultVol, fadeOutStart);
        gainParam.linearRampToValueAtTime(0, endAtSec);
      }
    }
  }

  async startPlayback(project, currentFrame, mediaMap) {
    this.stopAll();
    const token = this._playToken;
    const ctx = this.ensureContext();
    const fps = project.fps || 30;

    const candidates = [];
    for (const layer of project.layers) {
      if (!layer.visible) continue;
      if (layer.type !== 'audio' && layer.type !== 'video') continue;
      if (layer.audioProps?.muted) continue;
      if (!layer.mediaId) continue;
      if (currentFrame >= layer.endFrame) continue;
      const mediaItem = mediaMap.get(layer.mediaId);
      if (!mediaItem) continue;
      candidates.push({ layer, mediaItem });
    }
    if (candidates.length === 0) return;

    const decodedList = await Promise.all(candidates.map((c) => this.loadBuffer(c.mediaItem)));
    if (token !== this._playToken) return;

    // Capture AudioContext clock once after async decoding so multi-track audio stays sample-locked
    const now = ctx.currentTime;

    for (let i = 0; i < candidates.length; i++) {
      const { layer, mediaItem } = candidates[i];
      const origBuf = decodedList[i];
      if (!origBuf) continue;
      const buf = layer.reversed ? this.getReversedBuffer(mediaItem.id, origBuf) : origBuf;

      const vol = layer.audioProps?.volume ?? 1.0;
      const fadeInSec = (layer.audioProps?.fadeInFrames || 0) / fps;
      const fadeOutSec = (layer.audioProps?.fadeOutFrames || 0) / fps;

      const clipStartSec = layer.startFrame / fps;
      const clipEndSec = layer.endFrame / fps;
      const curSec = currentFrame / fps;

      const delay = Math.max(0, clipStartSec - curSec);
      const elapsedInClipSec = Math.max(0, curSec - clipStartSec);
      const elapsedTimelineFrames = Math.max(0, currentFrame - layer.startFrame);
      const totalTimelineFrames = Math.max(1, layer.endFrame - layer.startFrame);
      const clipSpanSrcSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, totalTimelineFrames) / fps;
      const elapsedSrcSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, elapsedTimelineFrames) / fps;
      const remainingSrcSec = Math.max(0.001, clipSpanSrcSec - elapsedSrcSec);

      const baseOffsetSec = (layer.mediaOffsetFrames || 0) / fps;
      const windowEnd = Math.min(buf.duration, baseOffsetSec + clipSpanSrcSec);
      const revBaseSec = Math.max(0, buf.duration - windowEnd);
      const mediaOffsetSec = layer.reversed
        ? revBaseSec + elapsedSrcSec
        : baseOffsetSec + elapsedSrcSec;
      const remainingTimelineSec = clipEndSec - Math.max(curSec, clipStartSec);

      if (mediaOffsetSec >= buf.duration || remainingTimelineSec <= 0.02) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const gain = ctx.createGain();
      const startAt = now + delay;
      const endAt = startAt + remainingTimelineSec;
      const clipDurSec = Math.max(0.01, clipEndSec - clipStartSec);
      const playFromFrame = Math.max(layer.startFrame, currentFrame);

      this._scheduleSpeedCurve(src, layer, playFromFrame, startAt, fps);
      this._scheduleGainWithKeyframes(
        gain.gain, layer, vol, layer.startFrame, playFromFrame, startAt, fps,
        fadeInSec, fadeOutSec, endAt, clipDurSec, elapsedInClipSec, remainingTimelineSec
      );

      const { osc } = this.connectEffectsChain(ctx, src, layer, gain, startAt);
      gain.connect(ctx.destination);
      const safeSrcDur = Math.max(0.001, Math.min(buf.duration - mediaOffsetSec, remainingSrcSec));
      src.start(startAt, mediaOffsetSec, safeSrcDur);
      try {
        if (endAt > startAt) src.stop(endAt);
      } catch {}
      this.activeSources.push({ source: src, gain, osc });
    }
  }

  /**
   * Mixes all active audio/video audio tracks into 44.1kHz stereo Int16 PCM Base64 for native AAC MP4 export.
   */
  async renderMixedPcm16Base64(project, mediaMap, durationFramesOverride = null) {
    const fps = project.fps || 30;
    const totalFrames = Math.max(1, durationFramesOverride || project.durationFrames || 150);
    const totalSec = Math.max(0.1, totalFrames / fps);
    const sampleRate = 44100;
    const totalSamples = Math.ceil(totalSec * sampleRate);

    const audioLayers = project.layers.filter(
      (l) => l.visible && (l.type === 'audio' || l.type === 'video') && !l.audioProps?.muted && l.mediaId
    );
    if (audioLayers.length === 0) return null;

    let anyDecoded = false;
    const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

    for (const layer of audioLayers) {
      const startSec = layer.startFrame / fps;
      const endSec = layer.endFrame / fps;
      if (startSec >= totalSec || endSec <= startSec) continue;

      const mediaItem = mediaMap.get(layer.mediaId);
      if (!mediaItem) continue;
      const origBuf = await this.loadBuffer(mediaItem);
      if (!origBuf) continue;
      const buf = layer.reversed ? this.getReversedBuffer(mediaItem.id, origBuf) : origBuf;
      anyDecoded = true;

      const vol = layer.audioProps?.volume ?? 1.0;
      const fadeInSec = (layer.audioProps?.fadeInFrames || 0) / fps;
      const fadeOutSec = (layer.audioProps?.fadeOutFrames || 0) / fps;
      const durSec = Math.max(0.01, endSec - startSec);
      const totalTimelineFrames = Math.max(1, layer.endFrame - layer.startFrame);
      const clipSpanSrcSec = TimelineEngine.integrateSpeedCurveSourceFrames(layer, totalTimelineFrames) / fps;
      const baseOffsetSec = (layer.mediaOffsetFrames || 0) / fps;
      const windowEnd = Math.min(buf.duration, baseOffsetSec + clipSpanSrcSec);
      const offsetSec = layer.reversed
        ? Math.max(0, buf.duration - windowEnd)
        : baseOffsetSec;

      if (offsetSec >= buf.duration) continue;

      const src = offline.createBufferSource();
      src.buffer = buf;

      const gain = offline.createGain();
      this._scheduleSpeedCurve(src, layer, layer.startFrame, startSec, fps);
      this._scheduleGainWithKeyframes(
        gain.gain, layer, vol, layer.startFrame, layer.startFrame, startSec, fps,
        fadeInSec, fadeOutSec, endSec, durSec, 0, durSec
      );

      this.connectEffectsChain(offline, src, layer, gain, startSec);
      gain.connect(offline.destination);
      const safeSrcDur = Math.max(0.001, Math.min(buf.duration - offsetSec, clipSpanSrcSec));
      src.start(startSec, offsetSec, safeSrcDur);
      try {
        const stopAt = Math.min(totalSec, endSec);
        if (stopAt > startSec) src.stop(stopAt);
      } catch {}
    }

    if (!anyDecoded) return null;

    const rendered = await offline.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    const int16 = new Int16Array(rendered.length * 2);

    for (let i = 0; i < rendered.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      int16[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
      int16[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
    }

    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    const chunk = 4096;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
}
