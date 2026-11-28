import { KeyframeEngine } from '../engine/keyframeEngine.js';

export class ExportEngine {
  constructor(renderer, audioEngine) {
    this.renderer = renderer;
    this.audioEngine = audioEngine;
    this.cancelled = false;
    this.lastResult = null;
  }

  isNativeAvailable() {
    return Boolean(window.AndroidBridge && typeof window.AndroidBridge.startVideoExport === 'function');
  }

  getCapabilities() {
    if (this.isNativeAvailable()) {
      try {
        return JSON.parse(window.AndroidBridge.getExportCapabilities());
      } catch {}
    }
    return { supports4K: false, maxWidth: 1920, maxHeight: 1080 };
  }

  computeOutputDimensions(project, preset) {
    const pw = Math.max(2, Number(project.width) || 1280);
    const ph = Math.max(2, Number(project.height) || 720);
    let shortSide = 720;
    if (preset === '480p') shortSide = 480;
    if (preset === '1080p') shortSide = 1080;
    if (preset === '4k') shortSide = 2160;

    const toEven = (n) => Math.max(2, Math.round(n / 2) * 2);
    if (pw === ph) return { width: toEven(shortSide), height: toEven(shortSide) };
    if (ph > pw) {
      return {
        width: toEven(shortSide),
        height: toEven(shortSide * (ph / pw))
      };
    }
    return {
      width: toEven(shortSide * (pw / ph)),
      height: toEven(shortSide)
    };
  }

  getBitrateMbps(quality, resPreset, fps = 30) {
    const resScale = resPreset === '4k' ? 1.8 : resPreset === '480p' ? 0.55 : resPreset === '720p' ? 0.75 : 1.0;
    const base = quality === 'ultra' ? 20 : quality === 'high' ? 12 : quality === 'medium' ? 7 : 4;
    const safeFps = Math.max(12, Math.min(120, Number(fps) || 30));
    const fpsScale = safeFps >= 100 ? 1.9 : safeFps >= 50 ? 1.45 : safeFps >= 45 ? 1.3 : safeFps <= 24 ? 0.9 : 1.0;
    return Math.max(2, Math.min(60, Math.round(base * resScale * fpsScale)));
  }

  getEffectiveDurationFrames(project, trimTrailingEmpty = true) {
    const rawDur = Math.max(1, Number(project?.durationFrames) || 150);
    if (!trimTrailingEmpty || !Array.isArray(project?.layers) || project.layers.length === 0) {
      return rawDur;
    }
    const maxEnd = Math.max(0, ...project.layers.map((l) => Number(l.endFrame) || 0));
    return maxEnd > 0 ? Math.min(rawDur, maxEnd) : rawDur;
  }

  estimateFileSizeMb(project, resPreset, quality, includeAudio = true, trimTrailingEmpty = true, fps = 30) {
    const effFrames = this.getEffectiveDurationFrames(project, trimTrailingEmpty);
    const sec = Math.max(0.5, effFrames / Math.max(1, project.fps || 30));
    const vMbps = this.getBitrateMbps(quality, resPreset, fps);
    const aMbps = includeAudio ? 0.192 : 0;
    return Number((((vMbps + aMbps) * sec) / 8).toFixed(1));
  }

  cancel() {
    this.cancelled = true;
    if (this.isNativeAvailable()) {
      window.AndroidBridge.cancelVideoExport();
    }
  }

  async exportProject({
    project,
    mediaMap,
    resPreset,
    fps,
    quality,
    includeAudio,
    trimTrailingEmpty = true,
    fileName,
    customUri = '',
    fileHandle = null,
    onProgress
  }) {
    this.cancelled = false;
    const safeFps = Math.max(12, Math.min(120, Math.round(Number(fps) || 30)));
    const { width, height } = this.computeOutputDimensions(project, resPreset);
    const bitrateMbps = this.getBitrateMbps(quality, resPreset, safeFps);
    const useLosslessFrames = quality === 'ultra';
    const effProjectFrames = this.getEffectiveDurationFrames(project, trimTrailingEmpty);
    const totalExportFrames = Math.max(
      1,
      Math.round((effProjectFrames / (project.fps || 30)) * safeFps)
    );
    const baseName = (fileName || `${project.name || 'MotionFlow'}.mp4`).replace(/[\\/:*?"<>|]/g, '_');
    const safeName = /\.mp4$/i.test(baseName) ? baseName : `${baseName}.mp4`;

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;

    if (this.isNativeAvailable()) {
      let pcmBase64 = null;
      if (includeAudio) {
        onProgress(2, 'Mixing audio tracks (AAC)...');
        pcmBase64 = await this.audioEngine.renderMixedPcm16Base64(project, mediaMap, effProjectFrames);
      }

      const initRes = JSON.parse(
        window.AndroidBridge.startVideoExport(
          JSON.stringify({
            width,
            height,
            fps: safeFps,
            bitrateMbps,
            totalFrames: totalExportFrames,
            includeAudio: Boolean(pcmBase64),
            fileName: safeName,
            customUri: customUri || ''
          })
        )
      );
      if (!initRes.ok) throw new Error(initRes.error || 'Failed to start native MediaCodec');

      if (pcmBase64) {
        onProgress(5, 'Encoding AAC audio stream...');
        const aRes = JSON.parse(window.AndroidBridge.pushExportAudioPcm(pcmBase64));
        if (!aRes.ok) throw new Error(aRes.error || 'Audio encode failed');
      }

      for (let i = 0; i < totalExportFrames; i++) {
        if (this.cancelled) {
          throw new Error('Export cancelled by user');
        }
        const projectFrame = (i / safeFps) * (project.fps || 30);
        await this.renderer.seekVideosForFrame(project, projectFrame, mediaMap, true);
        this.renderer.renderFrame(project, projectFrame, mediaMap, null, offscreen, width, height);

        const frameDataUrl = useLosslessFrames
          ? offscreen.toDataURL('image/png')
          : offscreen.toDataURL('image/jpeg', quality === 'high' ? 0.96 : 0.92);
        const pushRes = JSON.parse(window.AndroidBridge.pushExportFrame(i, frameDataUrl));
        if (!pushRes.ok) throw new Error(pushRes.error || `Frame ${i} encode error`);

        const pct = Math.min(98, Math.round(6 + ((i + 1) / totalExportFrames) * 92));
        onProgress(pct, `Encoding frame ${i + 1} / ${totalExportFrames} (${width}×${height} · ${safeFps}fps)`);

        // Yield periodically so UI progress bar paints smoothly
        if (i % 3 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      onProgress(99, 'Finalizing MP4 container...');
      const fin = JSON.parse(window.AndroidBridge.finishVideoExport());
      if (!fin.ok) throw new Error(fin.error || 'Muxer finalize failed');
      this.lastResult = fin.result;
      onProgress(100, 'Done');
      return fin.result;
    }

    // Browser fallback (WebM via MediaRecorder if tested outside Android WebView)
    return this.exportWebFallback({
      project,
      mediaMap,
      offscreen,
      width,
      height,
      fps: safeFps,
      totalExportFrames,
      fileName: safeName,
      fileHandle,
      onProgress
    });
  }

  async exportWebFallback({ project, mediaMap, offscreen, width, height, fps, totalExportFrames, fileName, fileHandle = null, onProgress }) {
    const stream = offscreen.captureStream(fps);
    const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('video/webm')
      ? 'video/webm'
      : undefined;
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const donePromise = new Promise((resolve) => {
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const outName = (fileName || 'MotionFlow_Export').replace(/\.mp4$/i, '.webm');
        let savedCustom = false;
        if (fileHandle && typeof fileHandle.createWritable === 'function') {
          try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            savedCustom = true;
          } catch {}
        }
        const url = URL.createObjectURL(blob);
        if (!savedCustom) {
          const a = document.createElement('a');
          a.href = url;
          a.download = outName;
          a.click();
        }
        resolve({
          fileName: fileHandle?.name || outName,
          sizeBytes: blob.size,
          internalPath: '',
          contentUri: url,
          isCustomLocation: savedCustom
        });
      };
    });

    recorder.start();
    const frameIntervalMs = 1000 / fps;
    for (let i = 0; i < totalExportFrames; i++) {
      if (this.cancelled) {
        recorder.stop();
        throw new Error('Cancelled');
      }
      const projectFrame = (i / fps) * (project.fps || 30);
      await this.renderer.seekVideosForFrame(project, projectFrame, mediaMap, true);
      this.renderer.renderFrame(project, projectFrame, mediaMap, null, offscreen, width, height);
      const pct = Math.round(((i + 1) / totalExportFrames) * 100);
      onProgress(pct, `Rendering frame ${i + 1} / ${totalExportFrames}`);
      await new Promise((r) => setTimeout(r, frameIntervalMs));
    }
    recorder.stop();
    const res = await donePromise;
    this.lastResult = res;
    return res;
  }
}
