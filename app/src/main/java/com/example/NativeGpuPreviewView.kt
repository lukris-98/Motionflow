package com.example

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Hardware-accelerated GPU Preview Compositor using MediaCodec -> SurfaceTexture (OES)
 * and OpenGL ES 2.0 shaders inside a TextureView.
 *
 * Tuned for mobile GPUs (including MediaTek Helio G88 / Mali-G52 MC2):
 * - 6 OES texture slots with max 4 active concurrent hardware decoders & non-blocking async eviction
 * - Seek-in-flight tracking + EOS clamp to prevent mid-playback seek loops & freezes
 * - Upright layer UV space before uTexMatrix conversion for accurate portrait video effects
 * - Zero-WebGL full-scene support: backgrounds (color/gradient/blur), images, uploaded text/shape/GIF/cutout
 *   textures, 16 stacked VFX (ping-pong FBO), 8-channel HSL, outline, stabilizer, adjustment layers, motion blur
 */
class NativeGpuPreviewView(
    context: Context,
    private val mediaDir: File
) : TextureView(context), TextureView.SurfaceTextureListener {

    private data class VfxPassSpec(
        val shaderId: Float,
        val intensity: Float,
        val timeSec: Float
    )

    private data class MotionSubPassSpec(
        val mvp: FloatArray,
        val alpha: Float,
        val timeMs: Long,
        val timeSec: Float
    )

    private data class LayerRenderSpec(
        val id: String,
        val type: String, // "video" | "image" | "uploaded" | "adjustment"
        val mediaId: String,
        val fileName: String,
        val texKey: String,
        val timeMs: Long,
        val isPlaying: Boolean,
        val reversed: Boolean,
        val mvp: FloatArray,
        val alpha: Float,
        val brightness: Float,
        val contrast: Float,
        val saturation: Float,
        val temperature: Float,
        val tint: Float,
        val exposure: Float,
        val highlights: Float,
        val shadows: Float,
        val fade: Float,
        val sharpen: Float,
        val blur: Float,
        val vignette: Float,
        val grain: Float,
        val texelX: Float,
        val texelY: Float,
        val chromaOn: Float,
        val chromaR: Float,
        val chromaG: Float,
        val chromaB: Float,
        val chromaSim: Float,
        val chromaSmooth: Float,
        val chromaSpill: Float,
        val outlineW: Float,
        val outlineR: Float,
        val outlineG: Float,
        val outlineB: Float,
        val maskType: Float,
        val maskOffsetX: Float,
        val maskOffsetY: Float,
        val maskScaleX: Float,
        val maskScaleY: Float,
        val maskRot: Float,
        val maskFeather: Float,
        val maskInvert: Float,
        val cropL: Float,
        val cropT: Float,
        val cropR: Float,
        val cropB: Float,
        val stabDx: Float,
        val stabDy: Float,
        val stabRot: Float,
        val stabScale: Float,
        val wipeType: Float,
        val wipeProgress: Float,
        val timeSec: Float,
        val blendMode: String,
        val vfxList: List<VfxPassSpec>,
        val hslFlat: FloatArray?, // 24 floats when active
        val tintOn: Boolean,
        val tintR: Float,
        val tintG: Float,
        val tintB: Float,
        val tintA: Float,
        val subPasses: List<MotionSubPassSpec>?
    )

    private data class PrewarmSpec(
        val mediaId: String,
        val fileName: String,
        val entryTimeMs: Long
    )

    private data class SceneSpec(
        val bgMode: String,
        val bgColor: Int,
        val grad0: Int,
        val grad1: Int,
        val bgBlurLayer: LayerRenderSpec?,
        val isPlaying: Boolean,
        val layers: List<LayerRenderSpec>,
        val prewarm: List<PrewarmSpec>
    )

    private data class ImageTexEntry(
        val texId: Int,
        var lastUsedSeq: Long
    )

    private class UploadedTexEntry(
        @Volatile var token: String,
        @Volatile var pendingBmp: Bitmap? = null,
        @Volatile var dirty: Boolean = false,
        var texId: Int = 0
    )

    private class OesSlot(
        val texId: Int,
        val surfaceTexture: SurfaceTexture,
        val surface: Surface
    ) {
        val texMatrix = FloatArray(16).apply {
            android.opengl.Matrix.setIdentityM(this, 0)
        }
        val framePendingUpdate = AtomicBoolean(false)
        @Volatile var hasFrame = false
        @Volatile var boundMediaId: String? = null
        @Volatile var inUseByDecoder = false
        var lastUsedSeq: Long = 0L

        fun updateTexImageSafe() {
            try {
                surfaceTexture.updateTexImage()
                surfaceTexture.getTransformMatrix(texMatrix)
                hasFrame = true
            } catch (_: Exception) {}
        }

        fun release() {
            try { surface.release() } catch (_: Exception) {}
            try { surfaceTexture.release() } catch (_: Exception) {}
        }
    }

    private inner class VideoDecoderSlot(
        val mediaId: String,
        val file: File,
        val oesSlot: OesSlot,
        private val useHardwareGpu: Boolean
    ) {
        private val lock = Object()
        private val running = AtomicBoolean(true)
        private val desiredTimeUs = AtomicLong(0L)
        @Volatile private var desiredPlaying = false
        @Volatile private var desiredReversed = false
        @Volatile private var currentPtsUs = -1L
        @Volatile private var seekInFlightTargetUs = -1L
        @Volatile private var dirtyTarget = true
        private var worker: Thread? = null

        fun start(initialTimeMs: Long, playing: Boolean, reversed: Boolean = false) {
            desiredTimeUs.set(max(0L, initialTimeMs) * 1000L)
            desiredPlaying = playing
            desiredReversed = reversed
            dirtyTarget = true
            worker = Thread({ decodeLoop() }, "MF-NatDec-${mediaId.take(6)}").apply {
                priority = Thread.MAX_PRIORITY - 1
                start()
            }
        }

        fun requestTarget(timeMs: Long, playing: Boolean, reversed: Boolean = false) {
            val nextUs = max(0L, timeMs) * 1000L
            val prevUs = desiredTimeUs.getAndSet(nextUs)
            val prevPlay = desiredPlaying
            val prevRev = desiredReversed
            desiredPlaying = playing
            desiredReversed = reversed
            if (abs(nextUs - prevUs) > 8_000L || prevPlay != playing || prevRev != reversed) {
                dirtyTarget = true
                synchronized(lock) { lock.notifyAll() }
            }
        }

        fun releaseAsync() {
            running.set(false)
            synchronized(lock) { lock.notifyAll() }
        }

        fun release() {
            releaseAsync()
            try {
                worker?.join(250)
            } catch (_: Exception) {}
            worker = null
            oesSlot.boundMediaId = null
        }

        private fun findCodecName(mime: String, wantHardware: Boolean): String? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
            return try {
                val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
                list.codecInfos.firstOrNull { info ->
                    !info.isEncoder &&
                        !info.name.contains(".secure", ignoreCase = true) &&
                        (if (wantHardware) info.isHardwareAccelerated else info.isSoftwareOnly) &&
                        info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
                }?.name
            } catch (_: Exception) {
                null
            }
        }

        private fun startCodecWithFallback(mime: String, baseFormat: MediaFormat): MediaCodec? {
            val attempts = mutableListOf<Pair<String?, Boolean>>()
            if (useHardwareGpu) {
                attempts += (findCodecName(mime, true) to true)
                attempts += (null to false)
                attempts += (findCodecName(mime, false) to false)
            } else {
                attempts += (findCodecName(mime, false) to false)
                attempts += (null to false)
            }

            for ((codecName, applyBoostHints) in attempts) {
                var candidate: MediaCodec? = null
                try {
                    val fmt = MediaFormat().apply {
                        setString(MediaFormat.KEY_MIME, mime)
                        if (baseFormat.containsKey(MediaFormat.KEY_WIDTH)) {
                            setInteger(MediaFormat.KEY_WIDTH, baseFormat.getInteger(MediaFormat.KEY_WIDTH))
                        }
                        if (baseFormat.containsKey(MediaFormat.KEY_HEIGHT)) {
                            setInteger(MediaFormat.KEY_HEIGHT, baseFormat.getInteger(MediaFormat.KEY_HEIGHT))
                        }
                        for (csd in listOf("csd-0", "csd-1", "csd-2")) {
                            if (baseFormat.containsKey(csd)) {
                                baseFormat.getByteBuffer(csd)?.let { setByteBuffer(csd, it) }
                            }
                        }
                        if (baseFormat.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                            try { setInteger(MediaFormat.KEY_FRAME_RATE, baseFormat.getInteger(MediaFormat.KEY_FRAME_RATE)) } catch (_: Exception) {}
                        }
                        if (baseFormat.containsKey(MediaFormat.KEY_ROTATION)) {
                            try { setInteger(MediaFormat.KEY_ROTATION, baseFormat.getInteger(MediaFormat.KEY_ROTATION)) } catch (_: Exception) {}
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && applyBoostHints) {
                            setInteger(MediaFormat.KEY_PRIORITY, 0)
                            setInteger(MediaFormat.KEY_OPERATING_RATE, 60)
                        }
                    }
                    candidate = if (codecName != null) {
                        MediaCodec.createByCodecName(codecName)
                    } else {
                        MediaCodec.createDecoderByType(mime)
                    }
                    candidate.configure(fmt, oesSlot.surface, null, 0)
                    candidate.start()
                    return candidate
                } catch (_: Exception) {
                    try { candidate?.release() } catch (_: Exception) {}
                }
            }
            return null
        }

        private fun decodeLoop() {
            var extractor: MediaExtractor? = null
            var codec: MediaCodec? = null
            try {
                extractor = MediaExtractor()
                extractor.setDataSource(file.absolutePath)
                var videoTrack = -1
                var videoFormat: MediaFormat? = null
                for (i in 0 until extractor.trackCount) {
                    val fmt = extractor.getTrackFormat(i)
                    val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("video/")) {
                        videoTrack = i
                        videoFormat = fmt
                        break
                    }
                }
                if (videoTrack < 0 || videoFormat == null) return
                extractor.selectTrack(videoTrack)
                val mime = videoFormat.getString(MediaFormat.KEY_MIME) ?: return

                val c = startCodecWithFallback(mime, videoFormat) ?: return
                codec = c

                val info = MediaCodec.BufferInfo()
                var inputEos = false
                var outputEos = false

                while (running.get()) {
                    val targetUs = desiredTimeUs.get()
                    val playing = desiredPlaying
                    val rev = desiredReversed

                    if (!dirtyTarget && !playing && currentPtsUs >= 0L) {
                        synchronized(lock) {
                            if (running.get() && !dirtyTarget && !desiredPlaying) {
                                lock.wait(120)
                            }
                        }
                        continue
                    }

                    val backTol = if (rev) 18_000L else 90_000L
                    val catchingUpSeek = currentPtsUs < 0L &&
                        seekInFlightTargetUs >= 0L &&
                        targetUs >= seekInFlightTargetUs - 90_000L &&
                        targetUs <= seekInFlightTargetUs + 1_200_000L
                    val clampedAtEnd = outputEos &&
                        currentPtsUs >= 0L &&
                        !rev &&
                        targetUs >= currentPtsUs - 18_000L

                    val needSeek = !clampedAtEnd && !catchingUpSeek && (
                        currentPtsUs < 0L ||
                            targetUs < currentPtsUs - backTol ||
                            targetUs > currentPtsUs + 450_000L
                        )

                    if (needSeek && seekInFlightTargetUs != targetUs) {
                        try {
                            c.flush()
                            extractor.seekTo(targetUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                            inputEos = false
                            outputEos = false
                            currentPtsUs = -1L
                            seekInFlightTargetUs = targetUs
                        } catch (_: Exception) {}
                    }

                    if (clampedAtEnd && playing) {
                        dirtyTarget = false
                        synchronized(lock) {
                            if (running.get() && desiredPlaying && desiredTimeUs.get() >= currentPtsUs - 18_000L) {
                                lock.wait(16)
                            }
                        }
                        continue
                    }

                    if (playing && currentPtsUs >= targetUs + 24_000L && !needSeek && !rev) {
                        dirtyTarget = false
                        synchronized(lock) {
                            if (running.get() && desiredPlaying && currentPtsUs >= desiredTimeUs.get() + 20_000L) {
                                lock.wait(8)
                            }
                        }
                        continue
                    }

                    if (!inputEos) {
                        val inIdx = c.dequeueInputBuffer(4_000)
                        if (inIdx >= 0) {
                            val buf = c.getInputBuffer(inIdx)
                            if (buf != null) {
                                val size = extractor.readSampleData(buf, 0)
                                if (size < 0) {
                                    c.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                    inputEos = true
                                } else {
                                    val pts = extractor.sampleTime
                                    c.queueInputBuffer(inIdx, 0, size, pts, 0)
                                    extractor.advance()
                                }
                            }
                        }
                    }

                    val outIdx = c.dequeueOutputBuffer(info, 6_000)
                    if (outIdx >= 0) {
                        val pts = info.presentationTimeUs
                        val isEos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        if (isEos) outputEos = true
                        val curTarget = desiredTimeUs.get()
                        val shouldRender = pts >= curTarget - 18_000L || outputEos || info.size == 0
                        if (shouldRender && info.size > 0) {
                            currentPtsUs = pts
                            seekInFlightTargetUs = -1L
                            dirtyTarget = false
                            c.releaseOutputBuffer(outIdx, true)
                        } else {
                            c.releaseOutputBuffer(outIdx, false)
                            if (info.size > 0) currentPtsUs = pts
                            if (isEos) seekInFlightTargetUs = -1L
                        }

                        if (outputEos && !playing) {
                            dirtyTarget = false
                        }
                    } else if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER && outputEos) {
                        seekInFlightTargetUs = -1L
                        dirtyTarget = false
                        synchronized(lock) {
                            if (running.get() && !dirtyTarget) lock.wait(60)
                        }
                    }
                }
            } catch (_: Exception) {
            } finally {
                try { codec?.stop() } catch (_: Exception) {}
                try { codec?.release() } catch (_: Exception) {}
                try { extractor?.release() } catch (_: Exception) {}
                if (oesSlot.boundMediaId == mediaId) {
                    oesSlot.boundMediaId = null
                }
                oesSlot.hasFrame = false
                oesSlot.inUseByDecoder = false
            }
        }
    }

    @Volatile private var engineEnabled = false
    @Volatile private var preferGpu = true
    @Volatile private var currentScene: SceneSpec? = null
    @Volatile private var surfaceReady = false
    @Volatile private var surfaceW = 0
    @Volatile private var surfaceH = 0
    @Volatile private var glRendererName: String = ""

    private var renderThread: HandlerThread? = null
    private var renderHandler: Handler? = null
    private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var pendingSurfaceTexture: SurfaceTexture? = null

    private var oesProgram = 0
    private var tex2dProgram = 0
    private var oesUniforms: ProgramUniforms? = null
    private var tex2dUniforms: ProgramUniforms? = null
    private var quadVertexBuf: FloatBuffer? = null

    private val oesPoolSize = 6
    private val maxActiveVideoDecoders = 4
    private val maxGpuFileTextures = 24
    private val oesPool = mutableListOf<OesSlot>()
    private val decoderPoolLock = Any()
    private val videoSlots = ConcurrentHashMap<String, VideoDecoderSlot>()
    private val imageTextures = HashMap<String, ImageTexEntry>()
    private val uploadedTextures = ConcurrentHashMap<String, UploadedTexEntry>()
    private val pendingDeleteTexIds = ConcurrentLinkedQueue<Int>()
    private val imageCache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
        override fun entryRemoved(evicted: Boolean, key: String, oldValue: Bitmap, newValue: Bitmap?) {
            if (evicted && oldValue !== newValue) {
                try {
                    if (!oldValue.isRecycled) oldValue.recycle()
                } catch (_: Exception) {}
            }
        }
    }
    private val loadingImages = ConcurrentHashMap.newKeySet<String>()
    private val imageLoaderExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    private var slotSeqCounter = 0L

    // Offscreen FBO targets for stacked VFX & adjustment layers
    private var fxFboA = 0
    private var fxFboB = 0
    private var fxTexA = 0
    private var fxTexB = 0
    private var fxW = 0
    private var fxH = 0

    private var sceneFboA = 0
    private var sceneFboB = 0
    private var sceneTexA = 0
    private var sceneTexB = 0
    private var sceneFboW = 0
    private var sceneFboH = 0

    // Pre-allocated matrices & scratch buffers to eliminate per-frame GC churn
    private val identityMat = FloatArray(16).apply {
        android.opengl.Matrix.setIdentityM(this, 0)
    }
    private val fboFlipYMat = FloatArray(16).apply {
        android.opengl.Matrix.setIdentityM(this, 0)
        android.opengl.Matrix.translateM(this, 0, 0f, 1f, 0f)
        android.opengl.Matrix.scaleM(this, 0, 1f, -1f, 1f)
    }
    private val orthoMvp = FloatArray(16).apply {
        android.opengl.Matrix.setIdentityM(this, 0)
        android.opengl.Matrix.scaleM(this, 0, 2f, 2f, 1f)
    }
    private val zeroHsl = FloatArray(24)
    private val tempIntArr = IntArray(1)

    private class ProgramUniforms(prog: Int) {
        val aPos = GLES20.glGetAttribLocation(prog, "aPos")
        val aUv = GLES20.glGetAttribLocation(prog, "aUv")
        val uMvp = GLES20.glGetUniformLocation(prog, "uMvp")
        val uTexMatrix = GLES20.glGetUniformLocation(prog, "uTexMatrix")
        val uTex = GLES20.glGetUniformLocation(prog, "uTex")
        val uAlpha = GLES20.glGetUniformLocation(prog, "uAlpha")
        val uPremul = GLES20.glGetUniformLocation(prog, "uPremul")
        val uColorAdjOn = GLES20.glGetUniformLocation(prog, "uColorAdjOn")
        val uBright = GLES20.glGetUniformLocation(prog, "uBright")
        val uContrast = GLES20.glGetUniformLocation(prog, "uContrast")
        val uSat = GLES20.glGetUniformLocation(prog, "uSat")
        val uTemp = GLES20.glGetUniformLocation(prog, "uTemp")
        val uTint = GLES20.glGetUniformLocation(prog, "uTint")
        val uExposure = GLES20.glGetUniformLocation(prog, "uExposure")
        val uHighlights = GLES20.glGetUniformLocation(prog, "uHighlights")
        val uShadows = GLES20.glGetUniformLocation(prog, "uShadows")
        val uFade = GLES20.glGetUniformLocation(prog, "uFade")
        val uSharpen = GLES20.glGetUniformLocation(prog, "uSharpen")
        val uBlur = GLES20.glGetUniformLocation(prog, "uBlur")
        val uVignette = GLES20.glGetUniformLocation(prog, "uVignette")
        val uGrain = GLES20.glGetUniformLocation(prog, "uGrain")
        val uTexel = GLES20.glGetUniformLocation(prog, "uTexel")
        val uChromaOn = GLES20.glGetUniformLocation(prog, "uChromaOn")
        val uChromaKey = GLES20.glGetUniformLocation(prog, "uChromaKey")
        val uChromaSim = GLES20.glGetUniformLocation(prog, "uChromaSim")
        val uChromaSmooth = GLES20.glGetUniformLocation(prog, "uChromaSmooth")
        val uChromaSpill = GLES20.glGetUniformLocation(prog, "uChromaSpill")
        val uOutlineW = GLES20.glGetUniformLocation(prog, "uOutlineW")
        val uOutlineCol = GLES20.glGetUniformLocation(prog, "uOutlineCol")
        val uMaskType = GLES20.glGetUniformLocation(prog, "uMaskType")
        val uMaskRect = GLES20.glGetUniformLocation(prog, "uMaskRect")
        val uMaskRot = GLES20.glGetUniformLocation(prog, "uMaskRot")
        val uMaskFeather = GLES20.glGetUniformLocation(prog, "uMaskFeather")
        val uMaskInvert = GLES20.glGetUniformLocation(prog, "uMaskInvert")
        val uCropRect = GLES20.glGetUniformLocation(prog, "uCropRect")
        val uStab = GLES20.glGetUniformLocation(prog, "uStab")
        val uVfx = GLES20.glGetUniformLocation(prog, "uVfx")
        val uWipe = GLES20.glGetUniformLocation(prog, "uWipe")
        val uHslOn = GLES20.glGetUniformLocation(prog, "uHslOn")
        val uHsl = GLES20.glGetUniformLocation(prog, "uHsl[0]")
        val uColorTint = GLES20.glGetUniformLocation(prog, "uColorTint")
        val uBgGradOn = GLES20.glGetUniformLocation(prog, "uBgGradOn")
        val uBgGrad0 = GLES20.glGetUniformLocation(prog, "uBgGrad0")
        val uBgGrad1 = GLES20.glGetUniformLocation(prog, "uBgGrad1")
    }

    init {
        isOpaque = true
        surfaceTextureListener = this
        visibility = View.GONE
    }

    fun setEngineConfig(enabled: Boolean, gpuPreferred: Boolean) {
        val changedMode = (preferGpu != gpuPreferred)
        engineEnabled = enabled
        preferGpu = gpuPreferred
        post {
            visibility = if (enabled) View.VISIBLE else View.GONE
            if (enabled && alpha == 0f) alpha = 1f
        }
        if (!enabled) {
            pauseAndReleaseDecoders()
        } else if (changedMode) {
            pauseAndReleaseDecoders()
        }
    }

    fun updateViewportRect(normX: Float, normY: Float, normW: Float, normH: Float, visible: Boolean) {
        post {
            if (!engineEnabled) {
                if (visibility != View.GONE) visibility = View.GONE
                return@post
            }
            val parentView = parent as? View ?: return@post
            val pw = parentView.width
            val ph = parentView.height
            val shouldShow = visible && pw > 0 && ph > 0 && normW > 0.01f && normH > 0.01f
            if (visibility != View.VISIBLE) {
                visibility = View.VISIBLE
            }
            alpha = if (shouldShow) 1f else 0f
            if (!shouldShow) return@post

            val lp = (layoutParams as? FrameLayout.LayoutParams) ?: FrameLayout.LayoutParams(0, 0)
            val left = (normX * pw).toInt().coerceIn(0, pw)
            val top = (normY * ph).toInt().coerceIn(0, ph)
            val w = (normW * pw).toInt().coerceIn(2, max(2, pw - left))
            val h = (normH * ph).toInt().coerceIn(2, max(2, ph - top))
            if (lp.leftMargin != left || lp.topMargin != top || lp.width != w || lp.height != h) {
                lp.leftMargin = left
                lp.topMargin = top
                lp.width = w
                lp.height = h
                layoutParams = lp
            }
        }
    }

    fun uploadTexture(texKey: String, token: String, dataUrlOrBase64: String) {
        if (texKey.isBlank() || dataUrlOrBase64.isBlank()) return
        val existing = uploadedTextures[texKey]
        if (existing != null && existing.token == token && (existing.texId != 0 || existing.pendingBmp != null)) {
            return
        }
        imageLoaderExecutor.execute {
            try {
                val b64 = dataUrlOrBase64.substringAfter("base64,", dataUrlOrBase64)
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@execute
                val entry = uploadedTextures.computeIfAbsent(texKey) { UploadedTexEntry(token) }
                synchronized(entry) {
                    val prevPending = entry.pendingBmp
                    entry.token = token
                    entry.pendingBmp = bmp
                    entry.dirty = true
                    if (prevPending != null && prevPending !== bmp && !prevPending.isRecycled) {
                        try { prevPending.recycle() } catch (_: Exception) {}
                    }
                }
                requestRenderOnGlThread()
            } catch (_: Exception) {}
        }
    }

    fun hasTexture(texKey: String, token: String): Boolean {
        val entry = uploadedTextures[texKey] ?: return false
        return entry.token == token && (entry.texId != 0 || entry.pendingBmp != null)
    }

    fun pruneTextures(activeKeys: Set<String>) {
        for (key in uploadedTextures.keys.toList()) {
            if (!activeKeys.contains(key)) {
                val removed = uploadedTextures.remove(key) ?: continue
                if (removed.texId != 0) {
                    pendingDeleteTexIds.offer(removed.texId)
                    removed.texId = 0
                }
                val pb = removed.pendingBmp
                removed.pendingBmp = null
                if (pb != null && !pb.isRecycled) {
                    try { pb.recycle() } catch (_: Exception) {}
                }
            }
        }
    }

    fun captureSnapshotBase64(maxW: Int, maxH: Int): String {
        if (!engineEnabled || !surfaceReady || width <= 0 || height <= 0) return ""
        val bmp = captureBitmapSync() ?: return ""
        return try {
            val scale = min(
                max(24, maxW).toFloat() / max(1, bmp.width),
                min(max(24, maxH).toFloat() / max(1, bmp.height), 1f)
            )
            val tw = max(24, (bmp.width * scale).roundToInt())
            val th = max(24, (bmp.height * scale).roundToInt())
            val scaled = if (tw < bmp.width || th < bmp.height) {
                Bitmap.createScaledBitmap(bmp, tw, th, true)
            } else {
                bmp
            }
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 76, out)
            if (scaled !== bmp) scaled.recycle()
            bmp.recycle()
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            try { if (!bmp.isRecycled) bmp.recycle() } catch (_: Exception) {}
            ""
        }
    }

    fun sampleColorHexAt(normX: Float, normY: Float): String {
        if (!engineEnabled || !surfaceReady || width <= 0 || height <= 0) return ""
        val bmp = captureBitmapSync() ?: return ""
        return try {
            val cx = (normX.coerceIn(0f, 1f) * (bmp.width - 1)).roundToInt()
            val cy = (normY.coerceIn(0f, 1f) * (bmp.height - 1)).roundToInt()
            var rSum = 0L
            var gSum = 0L
            var bSum = 0L
            var count = 0
            for (dy in -2..2) {
                val py = (cy + dy).coerceIn(0, bmp.height - 1)
                for (dx in -2..2) {
                    val px = (cx + dx).coerceIn(0, bmp.width - 1)
                    val pxColor = bmp.getPixel(px, py)
                    rSum += Color.red(pxColor)
                    gSum += Color.green(pxColor)
                    bSum += Color.blue(pxColor)
                    count++
                }
            }
            bmp.recycle()
            if (count <= 0) return ""
            String.format(
                "#%02X%02X%02X",
                (rSum / count).toInt().coerceIn(0, 255),
                (gSum / count).toInt().coerceIn(0, 255),
                (bSum / count).toInt().coerceIn(0, 255)
            )
        } catch (_: Exception) {
            try { if (!bmp.isRecycled) bmp.recycle() } catch (_: Exception) {}
            ""
        }
    }

    private fun captureBitmapSync(): Bitmap? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return if (isAvailable && visibility == View.VISIBLE) getBitmap() else null
        }
        val latch = CountDownLatch(1)
        var result: Bitmap? = null
        post {
            try {
                if (isAvailable && width > 0 && height > 0) {
                    result = getBitmap()
                }
            } catch (_: Exception) {
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(280, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {}
        return result
    }

    fun renderScene(sceneJson: String) {
        if (!engineEnabled) return
        val parsed = parseSceneJson(sceneJson) ?: return
        currentScene = parsed
        val h = renderHandler
        if (h != null) {
            h.removeCallbacks(sceneSyncRunnable)
            h.post(sceneSyncRunnable)
        } else {
            syncDecoderPool(parsed)
        }
    }

    fun pauseAndReleaseDecoders() {
        synchronized(decoderPoolLock) {
            val keys = videoSlots.keys.toList()
            for (k in keys) {
                videoSlots.remove(k)?.release()
            }
        }
    }

    fun release() {
        engineEnabled = false
        pauseAndReleaseDecoders()
        stopGlThread()
        try { imageLoaderExecutor.shutdownNow() } catch (_: Exception) {}
        try { imageCache.evictAll() } catch (_: Exception) {}
        for (entry in uploadedTextures.values) {
            entry.pendingBmp?.let { if (!it.isRecycled) try { it.recycle() } catch (_: Exception) {} }
            entry.pendingBmp = null
        }
        uploadedTextures.clear()
    }

    fun getCapabilitiesJson(): JSONObject {
        var hwVideoDecoders = 0
        var swVideoDecoders = 0
        try {
            val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
            for (info in list.codecInfos) {
                if (info.isEncoder) continue
                if (info.name.contains(".secure", ignoreCase = true)) continue
                val isVideo = info.supportedTypes.any { it.startsWith("video/") }
                if (!isVideo) continue
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    if (info.isHardwareAccelerated) hwVideoDecoders++ else swVideoDecoders++
                } else {
                    if (info.name.startsWith("OMX.google.", true) || info.name.startsWith("c2.android.", true)) {
                        swVideoDecoders++
                    } else {
                        hwVideoDecoders++
                    }
                }
            }
        } catch (_: Exception) {}
        return JSONObject().apply {
            put("hardwareCodecAvailable", hwVideoDecoders > 0)
            put("hwVideoDecoders", hwVideoDecoders)
            put("swVideoDecoders", swVideoDecoders)
            put("oesPoolSize", oesPoolSize)
            put("maxActiveVideoDecoders", maxActiveVideoDecoders)
            put("gpuRenderer", glRendererName)
            put("glesVersion", "OpenGL ES 2.0 Zero-WebGL")
        }
    }

    private fun parseLayerObject(lo: JSONObject, isPlayingScene: Boolean): LayerRenderSpec? {
        val mvpArr = lo.optJSONArray("mvp") ?: return null
        if (mvpArr.length() != 16) return null
        val mvp = FloatArray(16) { idx -> mvpArr.optDouble(idx, 0.0).toFloat() }
        val tw = max(16.0, lo.optDouble("texW", 720.0)).toFloat()
        val th = max(16.0, lo.optDouble("texH", 720.0)).toFloat()
        val reversed = lo.optBoolean("reversed", false)

        val vfxArr = lo.optJSONArray("vfx")
        val vfxList = if (vfxArr != null && vfxArr.length() > 0) {
            ArrayList<VfxPassSpec>(vfxArr.length()).apply {
                for (vi in 0 until vfxArr.length()) {
                    val vo = vfxArr.optJSONObject(vi) ?: continue
                    val sid = vo.optDouble("shaderId", 0.0).toFloat()
                    val inten = vo.optDouble("intensity", 0.0).toFloat()
                    if (sid > 0.5f && inten > 0.01f) {
                        add(VfxPassSpec(sid, inten, vo.optDouble("timeSec", 0.0).toFloat()))
                    }
                }
            }
        } else emptyList()

        val hslArr = lo.optJSONArray("hsl")
        var hslFlat: FloatArray? = null
        if (hslArr != null && hslArr.length() == 24) {
            var anyNonZero = false
            val buf = FloatArray(24)
            for (hi in 0 until 24) {
                val v = hslArr.optDouble(hi, 0.0).toFloat()
                buf[hi] = v
                if (abs(v) > 0.001f) anyNonZero = true
            }
            if (anyNonZero) hslFlat = buf
        }

        val outRgbArr = lo.optJSONArray("outlineRgb")
        val outR = outRgbArr?.optDouble(0, 1.0)?.toFloat() ?: 1f
        val outG = outRgbArr?.optDouble(1, 1.0)?.toFloat() ?: 1f
        val outB = outRgbArr?.optDouble(2, 1.0)?.toFloat() ?: 1f

        val tintArr = lo.optJSONArray("colorTint")
        val tintR = tintArr?.optDouble(0, 1.0)?.toFloat() ?: 1f
        val tintG = tintArr?.optDouble(1, 1.0)?.toFloat() ?: 1f
        val tintB = tintArr?.optDouble(2, 1.0)?.toFloat() ?: 1f
        val tintA = tintArr?.optDouble(3, 0.0)?.toFloat() ?: 0f

        val subArr = lo.optJSONArray("subPasses")
        val subPasses = if (subArr != null && subArr.length() > 1) {
            ArrayList<MotionSubPassSpec>(subArr.length()).apply {
                for (si in 0 until subArr.length()) {
                    val so = subArr.optJSONObject(si) ?: continue
                    val sMvpArr = so.optJSONArray("mvp") ?: continue
                    if (sMvpArr.length() != 16) continue
                    add(
                        MotionSubPassSpec(
                            mvp = FloatArray(16) { idx -> sMvpArr.optDouble(idx, 0.0).toFloat() },
                            alpha = so.optDouble("alpha", 1.0).toFloat(),
                            timeMs = so.optLong("timeMs", lo.optLong("timeMs", 0L)),
                            timeSec = so.optDouble("timeSec", lo.optDouble("timeSec", 0.0)).toFloat()
                        )
                    )
                }
            }
        } else null

        return LayerRenderSpec(
            id = lo.optString("id"),
            type = lo.optString("type"),
            mediaId = lo.optString("mediaId"),
            fileName = lo.optString("fileName"),
            texKey = lo.optString("texKey"),
            timeMs = lo.optLong("timeMs", 0L),
            isPlaying = isPlayingScene && !reversed,
            reversed = reversed,
            mvp = mvp,
            alpha = lo.optDouble("alpha", 1.0).toFloat(),
            brightness = lo.optDouble("brightness", 0.0).toFloat(),
            contrast = lo.optDouble("contrast", 1.0).toFloat(),
            saturation = lo.optDouble("saturation", 1.0).toFloat(),
            temperature = lo.optDouble("temperature", 0.0).toFloat(),
            tint = lo.optDouble("tint", 0.0).toFloat(),
            exposure = lo.optDouble("exposure", 0.0).toFloat(),
            highlights = lo.optDouble("highlights", 0.0).toFloat(),
            shadows = lo.optDouble("shadows", 0.0).toFloat(),
            fade = lo.optDouble("fade", 0.0).toFloat(),
            sharpen = lo.optDouble("sharpen", 0.0).toFloat(),
            blur = lo.optDouble("blur", 0.0).toFloat(),
            vignette = lo.optDouble("vignette", 0.0).toFloat(),
            grain = lo.optDouble("grain", 0.0).toFloat(),
            texelX = 1f / tw,
            texelY = 1f / th,
            chromaOn = if (lo.optBoolean("chromaOn", false)) 1f else 0f,
            chromaR = lo.optDouble("chromaR", 0.0).toFloat(),
            chromaG = lo.optDouble("chromaG", 1.0).toFloat(),
            chromaB = lo.optDouble("chromaB", 0.0).toFloat(),
            chromaSim = lo.optDouble("chromaSim", 0.35).toFloat(),
            chromaSmooth = lo.optDouble("chromaSmooth", 0.12).toFloat(),
            chromaSpill = lo.optDouble("chromaSpill", 0.5).toFloat(),
            outlineW = lo.optDouble("outlineW", 0.0).toFloat(),
            outlineR = outR,
            outlineG = outG,
            outlineB = outB,
            maskType = lo.optDouble("maskType", 0.0).toFloat(),
            maskOffsetX = lo.optDouble("maskOffsetX", 0.0).toFloat(),
            maskOffsetY = lo.optDouble("maskOffsetY", 0.0).toFloat(),
            maskScaleX = lo.optDouble("maskScaleX", 0.85).toFloat(),
            maskScaleY = lo.optDouble("maskScaleY", 0.85).toFloat(),
            maskRot = lo.optDouble("maskRot", 0.0).toFloat(),
            maskFeather = lo.optDouble("maskFeather", 0.05).toFloat(),
            maskInvert = if (lo.optBoolean("maskInvert", false)) 1f else 0f,
            cropL = lo.optDouble("cropL", 0.0).toFloat(),
            cropT = lo.optDouble("cropT", 0.0).toFloat(),
            cropR = lo.optDouble("cropR", 0.0).toFloat(),
            cropB = lo.optDouble("cropB", 0.0).toFloat(),
            stabDx = lo.optDouble("stabDx", 0.0).toFloat(),
            stabDy = lo.optDouble("stabDy", 0.0).toFloat(),
            stabRot = lo.optDouble("stabRot", 0.0).toFloat(),
            stabScale = lo.optDouble("stabScale", 1.0).toFloat(),
            wipeType = lo.optDouble("wipeType", 0.0).toFloat(),
            wipeProgress = lo.optDouble("wipeProgress", 1.0).toFloat(),
            timeSec = lo.optDouble("timeSec", 0.0).toFloat(),
            blendMode = lo.optString("blendMode", "normal"),
            vfxList = vfxList,
            hslFlat = hslFlat,
            tintOn = tintA > 0.005f,
            tintR = tintR,
            tintG = tintG,
            tintB = tintB,
            tintA = tintA,
            subPasses = subPasses
        )
    }

    private fun parseSceneJson(raw: String): SceneSpec? {
        return try {
            val obj = JSONObject(raw)
            val bgMode = obj.optString("bgMode", "color")
            val bgColor = parseColorSafe(obj.optString("bgHex", "#05070B"), Color.parseColor("#05070B"))
            val grad0 = parseColorSafe(obj.optString("grad0", "#0F172A"), Color.parseColor("#0F172A"))
            val grad1 = parseColorSafe(obj.optString("grad1", "#1E1B4B"), Color.parseColor("#1E1B4B"))
            val isPlaying = obj.optBoolean("isPlaying", false)
            val bgBlurLayer = obj.optJSONObject("bgLayer")?.let { parseLayerObject(it, isPlaying) }

            val layersArr = obj.optJSONArray("layers") ?: JSONArray()
            val layers = ArrayList<LayerRenderSpec>(layersArr.length())
            for (i in 0 until layersArr.length()) {
                val lo = layersArr.optJSONObject(i) ?: continue
                parseLayerObject(lo, isPlaying)?.let { layers.add(it) }
            }

            val preArr = obj.optJSONArray("prewarm") ?: JSONArray()
            val prewarm = ArrayList<PrewarmSpec>(preArr.length())
            for (i in 0 until preArr.length()) {
                val po = preArr.optJSONObject(i) ?: continue
                prewarm.add(
                    PrewarmSpec(
                        mediaId = po.optString("mediaId"),
                        fileName = po.optString("fileName"),
                        entryTimeMs = po.optLong("entryTimeMs", 0L)
                    )
                )
            }

            SceneSpec(bgMode, bgColor, grad0, grad1, bgBlurLayer, isPlaying, layers, prewarm)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseColorSafe(hex: String, fallback: Int): Int {
        return try {
            Color.parseColor(hex)
        } catch (_: Exception) {
            fallback
        }
    }

    private fun resolveMediaFile(fileName: String): File? {
        if (fileName.isBlank()) return null
        val clean = File(fileName).name
        val f = File(mediaDir, clean)
        return if (f.exists() && f.isFile && f.length() > 0L) f else null
    }

    private fun syncDecoderPool(scene: SceneSpec) {
        synchronized(decoderPoolLock) {
            if (oesPool.isEmpty()) return
            val neededIds = LinkedHashSet<String>()
            scene.bgBlurLayer?.let { bl ->
                if (bl.type == "video" && bl.mediaId.isNotBlank()) neededIds.add(bl.mediaId)
                if (bl.type == "image" && bl.mediaId.isNotBlank()) ensureImageLoaded(bl.mediaId, bl.fileName)
            }
            for (l in scene.layers) {
                if (l.type == "video" && l.mediaId.isNotBlank()) neededIds.add(l.mediaId)
                if (l.type == "image" && l.mediaId.isNotBlank()) ensureImageLoaded(l.mediaId, l.fileName)
            }
            for (p in scene.prewarm) {
                if (p.mediaId.isBlank() || neededIds.size >= maxActiveVideoDecoders) break
                neededIds.add(p.mediaId)
            }

            if (videoSlots.size >= maxActiveVideoDecoders) {
                for (key in videoSlots.keys.toList()) {
                    if (!neededIds.contains(key)) {
                        videoSlots.remove(key)?.releaseAsync()
                    }
                }
            }

            val seq = ++slotSeqCounter
            val bgVideo = scene.bgBlurLayer?.takeIf { it.type == "video" && it.mediaId.isNotBlank() }
            if (bgVideo != null) {
                ensureVideoSlot(bgVideo, seq)
            }
            for (l in scene.layers) {
                if (l.type != "video" || l.mediaId.isBlank()) continue
                ensureVideoSlot(l, seq)
            }

            for (p in scene.prewarm) {
                if (p.mediaId.isBlank()) continue
                val existing = videoSlots[p.mediaId]
                if (existing != null) {
                    existing.oesSlot.lastUsedSeq = seq
                } else if (videoSlots.size < maxActiveVideoDecoders) {
                    val f = resolveMediaFile(p.fileName) ?: continue
                    val freeOes = acquireOesSlot(p.mediaId, seq) ?: continue
                    val slot = VideoDecoderSlot(p.mediaId, f, freeOes, preferGpu)
                    videoSlots[p.mediaId] = slot
                    slot.start(p.entryTimeMs, false, false)
                }
            }
        }
    }

    private fun ensureVideoSlot(l: LayerRenderSpec, seq: Long) {
        val existing = videoSlots[l.mediaId]
        if (existing != null) {
            existing.oesSlot.lastUsedSeq = seq
            existing.requestTarget(l.timeMs, l.isPlaying, l.reversed)
        } else if (videoSlots.size < maxActiveVideoDecoders) {
            val f = resolveMediaFile(l.fileName) ?: return
            val freeOes = acquireOesSlot(l.mediaId, seq) ?: return
            val slot = VideoDecoderSlot(l.mediaId, f, freeOes, preferGpu)
            videoSlots[l.mediaId] = slot
            slot.start(l.timeMs, l.isPlaying, l.reversed)
        } else {
            val f = resolveMediaFile(l.fileName) ?: return
            val freeOes = acquireOesSlot(l.mediaId, seq) ?: return
            val slot = VideoDecoderSlot(l.mediaId, f, freeOes, preferGpu)
            videoSlots[l.mediaId] = slot
            slot.start(l.timeMs, l.isPlaying, l.reversed)
        }
    }

    private fun acquireOesSlot(mediaId: String, seq: Long): OesSlot? {
        val unused = oesPool.firstOrNull { it.boundMediaId == null && !it.inUseByDecoder }
        if (unused != null) {
            unused.boundMediaId = mediaId
            unused.inUseByDecoder = true
            unused.hasFrame = false
            unused.framePendingUpdate.set(false)
            unused.lastUsedSeq = seq
            return unused
        }
        val oldestActive = oesPool
            .filter { it.boundMediaId != null }
            .minByOrNull { it.lastUsedSeq }
        if (oldestActive != null) {
            val oldId = oldestActive.boundMediaId
            if (oldId != null) {
                videoSlots.remove(oldId)?.releaseAsync()
            }
            val cleanFree = oesPool.firstOrNull { it.boundMediaId == null && !it.inUseByDecoder }
            if (cleanFree != null) {
                cleanFree.boundMediaId = mediaId
                cleanFree.inUseByDecoder = true
                cleanFree.hasFrame = false
                cleanFree.framePendingUpdate.set(false)
                cleanFree.lastUsedSeq = seq
                return cleanFree
            }
        }
        return null
    }

    private fun ensureImageLoaded(mediaId: String, fileName: String) {
        if (imageCache.get(mediaId) != null || imageTextures.containsKey(mediaId) || !loadingImages.add(mediaId)) return
        val file = resolveMediaFile(fileName)
        if (file == null) {
            loadingImages.remove(mediaId)
            return
        }
        imageLoaderExecutor.execute {
            try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                val maxSide = 1440
                var sample = 1
                while (bounds.outWidth / sample > maxSide || bounds.outHeight / sample > maxSide) {
                    sample *= 2
                }
                val opts = BitmapFactory.Options().apply { inSampleSize = sample }
                val raw = BitmapFactory.decodeFile(file.absolutePath, opts)
                if (raw != null) {
                    val rot = readExifRotation(file)
                    val finalBmp = if (rot != 0f) {
                        val m = Matrix().apply { postRotate(rot) }
                        Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also {
                            if (it !== raw) raw.recycle()
                        }
                    } else raw
                    imageCache.put(mediaId, finalBmp)
                    requestRenderOnGlThread()
                }
            } catch (_: Exception) {
            } finally {
                loadingImages.remove(mediaId)
            }
        }
    }

    private fun readExifRotation(file: File): Float {
        return try {
            val exif = ExifInterface(file.absolutePath)
            when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (_: Exception) {
            0f
        }
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        pendingSurfaceTexture = surface
        surfaceW = max(2, width)
        surfaceH = max(2, height)
        surfaceReady = true
        startGlThread(surface)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        surfaceW = max(2, width)
        surfaceH = max(2, height)
        requestRenderOnGlThread()
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        surfaceReady = false
        stopGlThread()
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}

    private fun startGlThread(surface: SurfaceTexture) {
        stopGlThread()
        val thread = HandlerThread("MF-NativeGpuGL").apply { start() }
        renderThread = thread
        val handler = Handler(thread.looper)
        renderHandler = handler
        handler.post {
            initEglAndGl(surface, handler)
            currentScene?.let { syncDecoderPool(it) }
            drawGlFrame()
        }
    }

    private fun stopGlThread() {
        pauseAndReleaseDecoders()
        val handler = renderHandler
        val thread = renderThread
        renderHandler = null
        renderThread = null
        if (handler != null && thread != null) {
            handler.post {
                releaseEglAndGl()
                thread.quitSafely()
            }
            try { thread.join(350) } catch (_: Exception) {}
        }
    }

    private fun requestRenderOnGlThread() {
        val h = renderHandler ?: return
        h.removeCallbacks(renderRunnable)
        h.post(renderRunnable)
    }

    private val sceneSyncRunnable = Runnable {
        if (!engineEnabled) return@Runnable
        currentScene?.let { syncDecoderPool(it) }
        if (surfaceReady) {
            drawGlFrame()
        }
    }

    private val renderRunnable = Runnable {
        if (surfaceReady && engineEnabled) {
            drawGlFrame()
        }
    }

    private fun initEglAndGl(surface: SurfaceTexture, glHandler: Handler) {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        EGL14.eglInitialize(eglDisplay, version, 0, version, 1)

        val attribList = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        EGL14.eglChooseConfig(eglDisplay, attribList, 0, configs, 0, 1, numConfigs, 0)
        val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
        eglContext = EGL14.eglCreateContext(eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)
        eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0)
        EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)
        try {
            glRendererName = GLES20.glGetString(GLES20.GL_RENDERER) ?: ""
        } catch (_: Exception) {}

        val quadVerts = floatArrayOf(
            -0.5f, -0.5f, 0f, 1f,
             0.5f, -0.5f, 1f, 1f,
            -0.5f,  0.5f, 0f, 0f,
             0.5f,  0.5f, 1f, 0f
        )
        quadVertexBuf = ByteBuffer.allocateDirect(quadVerts.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .put(quadVerts)
            .apply { position(0) }

        oesProgram = buildShaderProgram(isOes = true)
        tex2dProgram = buildShaderProgram(isOes = false)
        oesUniforms = ProgramUniforms(oesProgram)
        tex2dUniforms = ProgramUniforms(tex2dProgram)

        val ids = IntArray(oesPoolSize)
        GLES20.glGenTextures(oesPoolSize, ids, 0)
        for (texId in ids) {
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            val st = SurfaceTexture(texId)
            val slot = OesSlot(texId, st, Surface(st))
            st.setOnFrameAvailableListener({
                slot.framePendingUpdate.set(true)
                requestRenderOnGlThread()
            }, glHandler)
            oesPool.add(slot)
        }
    }

    private fun releaseOffscreenTargets() {
        val fbos = intArrayOf(fxFboA, fxFboB, sceneFboA, sceneFboB).filter { it != 0 }.toIntArray()
        if (fbos.isNotEmpty()) {
            try { GLES20.glDeleteFramebuffers(fbos.size, fbos, 0) } catch (_: Exception) {}
        }
        val texs = intArrayOf(fxTexA, fxTexB, sceneTexA, sceneTexB).filter { it != 0 }.toIntArray()
        if (texs.isNotEmpty()) {
            try { GLES20.glDeleteTextures(texs.size, texs, 0) } catch (_: Exception) {}
        }
        fxFboA = 0; fxFboB = 0; fxTexA = 0; fxTexB = 0; fxW = 0; fxH = 0
        sceneFboA = 0; sceneFboB = 0; sceneTexA = 0; sceneTexB = 0; sceneFboW = 0; sceneFboH = 0
    }

    private fun releaseEglAndGl() {
        for (slot in oesPool) {
            try { GLES20.glDeleteTextures(1, intArrayOf(slot.texId), 0) } catch (_: Exception) {}
            slot.release()
        }
        oesPool.clear()
        for (entry in imageTextures.values) {
            try { GLES20.glDeleteTextures(1, intArrayOf(entry.texId), 0) } catch (_: Exception) {}
        }
        imageTextures.clear()
        for (entry in uploadedTextures.values) {
            if (entry.texId != 0) {
                try { GLES20.glDeleteTextures(1, intArrayOf(entry.texId), 0) } catch (_: Exception) {}
                entry.texId = 0
            }
        }
        drainPendingTextureDeletes()
        releaseOffscreenTargets()

        if (oesProgram != 0) { try { GLES20.glDeleteProgram(oesProgram) } catch (_: Exception) {}; oesProgram = 0 }
        if (tex2dProgram != 0) { try { GLES20.glDeleteProgram(tex2dProgram) } catch (_: Exception) {}; tex2dProgram = 0 }

        if (eglDisplay !== EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (eglSurface !== EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface)
            if (eglContext !== EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(eglDisplay)
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY
        eglContext = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
    }

    private fun buildShaderProgram(isOes: Boolean): Int {
        val vs = """
            attribute vec2 aPos;
            attribute vec2 aUv;
            uniform mat4 uMvp;
            varying vec2 vLayerUv;
            void main() {
                gl_Position = uMvp * vec4(aPos, 0.0, 1.0);
                vLayerUv = vec2(aPos.x + 0.5, 0.5 - aPos.y);
            }
        """.trimIndent()
        val extHeader = if (isOes) "#extension GL_OES_EGL_image_external : require\n" else ""
        val samplerType = if (isOes) "samplerExternalOES" else "sampler2D"
        val sampleCoordExpr = if (isOes) {
            "(uTexMatrix * vec4(p.x, 1.0 - p.y, 0.0, 1.0)).xy"
        } else {
            "(uTexMatrix * vec4(p.x, p.y, 0.0, 1.0)).xy"
        }
        val fs = """
            ${extHeader}precision mediump float;
            varying vec2 vLayerUv;
            uniform $samplerType uTex;
            uniform mat4 uTexMatrix;
            uniform float uAlpha;
            uniform float uPremul;
            uniform float uColorAdjOn;
            uniform float uBright;
            uniform float uContrast;
            uniform float uSat;
            uniform float uTemp;
            uniform float uTint;
            uniform float uExposure;
            uniform float uHighlights;
            uniform float uShadows;
            uniform float uFade;
            uniform float uSharpen;
            uniform float uBlur;
            uniform float uVignette;
            uniform float uGrain;
            uniform vec2 uTexel;
            uniform float uChromaOn;
            uniform vec3 uChromaKey;
            uniform float uChromaSim;
            uniform float uChromaSmooth;
            uniform float uChromaSpill;
            uniform float uOutlineW;
            uniform vec3 uOutlineCol;
            uniform float uMaskType;
            uniform vec4 uMaskRect;
            uniform float uMaskRot;
            uniform float uMaskFeather;
            uniform float uMaskInvert;
            uniform vec4 uCropRect;
            uniform vec4 uStab;
            uniform vec3 uVfx;
            uniform vec2 uWipe;
            uniform float uHslOn;
            uniform vec3 uHsl[8];
            uniform vec4 uColorTint;
            uniform float uBgGradOn;
            uniform vec4 uBgGrad0;
            uniform vec4 uBgGrad1;

            vec4 sampleTex(vec2 p) {
                vec2 cp = clamp(p, 0.0, 1.0);
                vec2 sp = $sampleCoordExpr;
                return texture2D(uTex, clamp(sp, 0.0, 1.0));
            }

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            vec3 rgb2hsl(vec3 c) {
                float cmax = max(c.r, max(c.g, c.b));
                float cmin = min(c.r, min(c.g, c.b));
                float delta = cmax - cmin;
                float l = 0.5 * (cmax + cmin);
                float s = 0.0;
                if (delta > 0.0001) {
                    s = delta / (1.0 - abs(2.0 * l - 1.0) + 0.0001);
                }
                float h = 0.0;
                if (delta > 0.0001) {
                    if (cmax == c.r) h = mod((c.g - c.b) / delta, 6.0);
                    else if (cmax == c.g) h = (c.b - c.r) / delta + 2.0;
                    else h = (c.r - c.g) / delta + 4.0;
                    h /= 6.0;
                    if (h < 0.0) h += 1.0;
                }
                return vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
            }

            float hue2rgb(float p, float q, float t) {
                if (t < 0.0) t += 1.0;
                if (t > 1.0) t -= 1.0;
                if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
                if (t < 0.5) return q;
                if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
                return p;
            }

            vec3 hsl2rgb(vec3 hsl) {
                if (hsl.y <= 0.0001) return vec3(hsl.z);
                float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
                float p = 2.0 * hsl.z - q;
                return vec3(
                    hue2rgb(p, q, hsl.x + 1.0 / 3.0),
                    hue2rgb(p, q, hsl.x),
                    hue2rgb(p, q, hsl.x - 1.0 / 3.0)
                );
            }

            float hueDist(float h, float center) {
                float d = abs(h - center);
                return min(d, 1.0 - d);
            }

            float evalChromaAlpha(vec4 col) {
                if (uChromaOn < 0.5) return col.a;
                float y = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
                float cb = -0.168736 * col.r - 0.331264 * col.g + 0.5 * col.b;
                float cr = 0.5 * col.r - 0.418688 * col.g - 0.081312 * col.b;
                float ky = 0.299 * uChromaKey.r + 0.587 * uChromaKey.g + 0.114 * uChromaKey.b;
                float kcb = -0.168736 * uChromaKey.r - 0.331264 * uChromaKey.g + 0.5 * uChromaKey.b;
                float kcr = 0.5 * uChromaKey.r - 0.418688 * uChromaKey.g - 0.081312 * uChromaKey.b;
                float dist = length(vec2(cb - kcb, cr - kcr)) + 0.15 * abs(y - ky);
                return col.a * smoothstep(uChromaSim, uChromaSim + max(0.005, uChromaSmooth), dist);
            }

            void main() {
                if (uBgGradOn > 0.5) {
                    float t = clamp((vLayerUv.x * 256.0 + vLayerUv.y * 16384.0) / 16640.0, 0.0, 1.0);
                    gl_FragColor = vec4(mix(uBgGrad0.rgb, uBgGrad1.rgb, t), 1.0);
                    return;
                }

                if (vLayerUv.x < uCropRect.x || vLayerUv.x > 1.0 - uCropRect.z ||
                    vLayerUv.y < uCropRect.y || vLayerUv.y > 1.0 - uCropRect.w) {
                    discard;
                }

                vec2 uv = vLayerUv;
                if (uStab.w > 1.0005 || abs(uStab.x) > 0.0001 || abs(uStab.y) > 0.0001 || abs(uStab.z) > 0.0001) {
                    float stabAsp = uTexel.y / max(1e-6, uTexel.x);
                    float cs = cos(uStab.z);
                    float sn = sin(uStab.z);
                    vec2 p = (uv - 0.5) / max(1.0, uStab.w);
                    p.x *= stabAsp;
                    vec2 rp = vec2(p.x * cs + p.y * sn, -p.x * sn + p.y * cs);
                    rp.x /= max(0.1, stabAsp);
                    uv = clamp(rp - uStab.xy + 0.5, 0.0, 1.0);
                }

                float vfxType = uVfx.x;
                float vfxInt = uVfx.y;
                float vfxTime = uVfx.z;

                if (vfxType > 3.5 && vfxType < 4.5 && vfxInt > 0.01) {
                    float zoomComp = 1.0 - 0.06 * vfxInt;
                    vec2 shakeOff = vec2(sin(vfxTime * 29.0) * 0.022, cos(vfxTime * 37.0) * 0.022) * vfxInt;
                    uv = (uv - 0.5) * zoomComp + 0.5 + shakeOff;
                }
                if (vfxType > 0.5 && vfxType < 1.5 && vfxInt > 0.01) {
                    float band = floor(uv.y * 20.0);
                    float trigger = step(0.68, hash12(vec2(band, floor(vfxTime * 14.0))));
                    float shift = (hash12(vec2(band + 7.0, floor(vfxTime * 18.0))) - 0.5) * 0.14 * vfxInt * trigger;
                    uv.x = clamp(uv.x + shift, 0.0, 1.0);
                }
                if (vfxType > 2.5 && vfxType < 3.5 && vfxInt > 0.01) {
                    float wob = sin(uv.y * 18.0 + vfxTime * 9.0) * 0.008 * vfxInt;
                    uv.x = clamp(uv.x + wob, 0.0, 1.0);
                }
                if (vfxType > 8.5 && vfxType < 9.5 && vfxInt > 0.01) {
                    float cells = mix(140.0, 18.0, vfxInt);
                    uv = (floor(uv * cells) + 0.5) / cells;
                }
                if (vfxType > 9.5 && vfxType < 10.5 && vfxInt > 0.01) {
                    vec2 scaled = uv * 2.0;
                    vec2 tile = floor(scaled);
                    vec2 fuv = fract(scaled);
                    if (mod(tile.x, 2.0) > 0.5) fuv.x = 1.0 - fuv.x;
                    if (mod(tile.y, 2.0) > 0.5) fuv.y = 1.0 - fuv.y;
                    uv = mix(uv, fuv, clamp(vfxInt * 1.4, 0.0, 1.0));
                }
                if (vfxType > 11.5 && vfxType < 12.5 && vfxInt > 0.01) {
                    vec2 d = uv - 0.5;
                    float r = length(d);
                    float bind = 0.707;
                    float power = mix(0.0, 1.6, vfxInt);
                    if (r > 0.001) {
                        uv = 0.5 + normalize(d) * tan(r * power) * bind / max(0.01, tan(bind * power));
                    }
                }
                if (vfxType > 13.5 && vfxType < 14.5 && vfxInt > 0.01) {
                    vec2 dc = uv - 0.5;
                    float d2 = dot(dc, dc);
                    uv = uv + dc * (d2 * 0.35 * vfxInt);
                }

                vec4 c = sampleTex(uv);

                if (vfxType > 12.5 && vfxType < 13.5 && vfxInt > 0.01) {
                    vec2 dir = (0.5 - uv) * 0.035 * vfxInt;
                    vec4 zb = c * 0.28;
                    zb += sampleTex(uv + dir * 0.5) * 0.22;
                    zb += sampleTex(uv + dir * 1.0) * 0.20;
                    zb += sampleTex(uv + dir * 1.6) * 0.16;
                    zb += sampleTex(uv + dir * 2.2) * 0.14;
                    c = zb;
                }
                if ((vfxType > 0.5 && vfxType < 2.5) && vfxInt > 0.01) {
                    float rgbOff = (vfxType < 1.5 ? 0.014 : 0.022) * vfxInt;
                    c.r = sampleTex(uv + vec2(rgbOff, 0.0)).r;
                    c.b = sampleTex(uv - vec2(rgbOff, 0.0)).b;
                }

                if (uBlur > 0.01) {
                    vec2 off = uTexel * uBlur;
                    vec4 acc = c * 0.25;
                    acc += sampleTex(uv + vec2(off.x, 0.0)) * 0.125;
                    acc += sampleTex(uv - vec2(off.x, 0.0)) * 0.125;
                    acc += sampleTex(uv + vec2(0.0, off.y)) * 0.125;
                    acc += sampleTex(uv - vec2(0.0, off.y)) * 0.125;
                    acc += sampleTex(uv + vec2(off.x, off.y)) * 0.0625;
                    acc += sampleTex(uv + vec2(-off.x, off.y)) * 0.0625;
                    acc += sampleTex(uv + vec2(off.x, -off.y)) * 0.0625;
                    acc += sampleTex(uv + vec2(-off.x, -off.y)) * 0.0625;
                    c = acc;
                }
                if (uSharpen > 0.01) {
                    vec3 n0 = sampleTex(uv + vec2(uTexel.x, 0.0)).rgb;
                    vec3 n1 = sampleTex(uv - vec2(uTexel.x, 0.0)).rgb;
                    vec3 n2 = sampleTex(uv + vec2(0.0, uTexel.y)).rgb;
                    vec3 n3 = sampleTex(uv - vec2(0.0, uTexel.y)).rgb;
                    c.rgb = clamp(c.rgb * (1.0 + 2.4 * uSharpen) - (n0 + n1 + n2 + n3) * (0.6 * uSharpen), 0.0, 1.0);
                }
                if (vfxType > 7.5 && vfxType < 8.5 && vfxInt > 0.01) {
                    vec2 boff = uTexel * (4.0 + 6.0 * vfxInt);
                    vec3 bloom = (
                        sampleTex(uv + vec2(boff.x, 0.0)).rgb +
                        sampleTex(uv - vec2(boff.x, 0.0)).rgb +
                        sampleTex(uv + vec2(0.0, boff.y)).rgb +
                        sampleTex(uv - vec2(0.0, boff.y)).rgb
                    ) * 0.25;
                    c.rgb = mix(c.rgb, max(c.rgb, bloom * 1.18), 0.55 * vfxInt);
                }
                if (vfxType > 10.5 && vfxType < 11.5 && vfxInt > 0.01) {
                    vec2 eo = uTexel * 2.0;
                    float lL = dot(sampleTex(uv - vec2(eo.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
                    float lR = dot(sampleTex(uv + vec2(eo.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
                    float lU = dot(sampleTex(uv - vec2(0.0, eo.y)).rgb, vec3(0.299, 0.587, 0.114));
                    float lD = dot(sampleTex(uv + vec2(0.0, eo.y)).rgb, vec3(0.299, 0.587, 0.114));
                    float edge = clamp(length(vec2(lR - lL, lD - lU)) * 3.8, 0.0, 1.0);
                    vec3 neon = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.25, 0.55), sin(vfxTime * 3.0 + uv.x * 4.0) * 0.5 + 0.5) * edge;
                    c.rgb = mix(c.rgb, max(c.rgb * 0.35, neon), vfxInt);
                }

                if (uChromaOn > 0.5) {
                    c.a = evalChromaAlpha(c);
                    if (uChromaSpill > 0.005) {
                        float y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
                        float cb = -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
                        float cr = 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
                        float kcb = -0.168736 * uChromaKey.r - 0.331264 * uChromaKey.g + 0.5 * uChromaKey.b;
                        float kcr = 0.5 * uChromaKey.r - 0.418688 * uChromaKey.g - 0.081312 * uChromaKey.b;
                        float kMagSq = kcb * kcb + kcr * kcr;
                        if (kMagSq > 0.0002) {
                            float proj = (cb * kcb + cr * kcr) / kMagSq;
                            if (proj > 0.0) {
                                float spillAmt = uChromaSpill * clamp(1.15 - c.a, 0.12, 1.0);
                                float ncb = cb - kcb * proj * spillAmt;
                                float ncr = cr - kcr * proj * spillAmt;
                                c.r = clamp(y + 1.402 * ncr, 0.0, 1.0);
                                c.g = clamp(y - 0.344136 * ncb - 0.714136 * ncr, 0.0, 1.0);
                                c.b = clamp(y + 1.772 * ncb, 0.0, 1.0);
                            }
                        }
                    }
                }

                if (uOutlineW > 0.005) {
                    vec2 oo = uTexel * (uOutlineW * 12.0);
                    float maxA = 0.0;
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(oo.x, 0.0))));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv - vec2(oo.x, 0.0))));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(0.0, oo.y))));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv - vec2(0.0, oo.y))));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(oo.x, oo.y) * 0.7)));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(-oo.x, oo.y) * 0.7)));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(oo.x, -oo.y) * 0.7)));
                    maxA = max(maxA, evalChromaAlpha(sampleTex(uv + vec2(-oo.x, -oo.y) * 0.7)));
                    float ring = smoothstep(0.15, 0.75, maxA) * (1.0 - smoothstep(0.2, 0.75, c.a));
                    c.rgb = mix(c.rgb, uOutlineCol, ring);
                    c.a = max(c.a, ring * maxA);
                }

                if (uColorAdjOn > 0.5) {
                    c.rgb *= exp2(uExposure * 1.4);
                    c.r += uTemp * 0.14 + uTint * 0.06;
                    c.g += uTemp * 0.02 - uTint * 0.10;
                    c.b -= uTemp * 0.14 - uTint * 0.06;
                    c.rgb += uBright * 0.45;
                    float lumAdj = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                    float shadowW = pow(max(0.0001, clamp(1.0 - lumAdj, 0.0, 1.0)), 1.6);
                    float highW = pow(max(0.0001, clamp(lumAdj, 0.0, 1.0)), 1.6);
                    c.rgb += uShadows * 0.35 * shadowW + uHighlights * 0.35 * highW;
                    c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
                    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                    c.rgb = mix(vec3(lum), c.rgb, uSat);
                    if (uFade > 0.005) {
                        c.rgb = mix(c.rgb, max(c.rgb, vec3(0.16)), uFade);
                    }
                }

                if (uHslOn > 0.5) {
                    vec3 hsl = rgb2hsl(clamp(c.rgb, 0.0, 1.0));
                    if (hsl.y > 0.04) {
                        float w0 = max(0.0, 1.0 - hueDist(hsl.x, 0.0) / 0.09);
                        float w1 = max(0.0, 1.0 - hueDist(hsl.x, 0.083) / 0.08);
                        float w2 = max(0.0, 1.0 - hueDist(hsl.x, 0.166) / 0.08);
                        float w3 = max(0.0, 1.0 - hueDist(hsl.x, 0.333) / 0.12);
                        float w4 = max(0.0, 1.0 - hueDist(hsl.x, 0.500) / 0.10);
                        float w5 = max(0.0, 1.0 - hueDist(hsl.x, 0.666) / 0.11);
                        float w6 = max(0.0, 1.0 - hueDist(hsl.x, 0.777) / 0.09);
                        float w7 = max(0.0, 1.0 - hueDist(hsl.x, 0.900) / 0.09);
                        vec3 adj = w0 * uHsl[0] + w1 * uHsl[1] + w2 * uHsl[2] + w3 * uHsl[3] +
                                   w4 * uHsl[4] + w5 * uHsl[5] + w6 * uHsl[6] + w7 * uHsl[7];
                        if (abs(adj.x) + abs(adj.y) + abs(adj.z) > 0.001) {
                            hsl.x = fract(hsl.x + adj.x * 0.18 + 1.0);
                            hsl.y = clamp(hsl.y + adj.y * 0.85, 0.0, 1.0);
                            hsl.z = clamp(hsl.z + adj.z * 0.35, 0.0, 1.0);
                            c.rgb = hsl2rgb(hsl);
                        }
                    }
                }

                if (uGrain > 0.005) {
                    float gVal = (hash12(uv * 540.0 + fract(vfxTime * 19.0 + 0.37) * 77.0) - 0.5) * 0.28 * uGrain;
                    c.rgb += vec3(gVal);
                }

                if (vfxType > 2.5 && vfxType < 3.5 && vfxInt > 0.01) {
                    float scan = 0.88 + 0.12 * sin(uv.y * 420.0);
                    float gr = (hash12(uv * 320.0 + fract(vfxTime) * 53.0) - 0.5) * 0.14 * vfxInt;
                    c.rgb = c.rgb * scan + vec3(gr);
                    c.r += 0.04 * vfxInt;
                }
                if (vfxType > 4.5 && vfxType < 5.5 && vfxInt > 0.01) {
                    float pulseRaw = max(0.0, sin(vfxTime * 8.0));
                    float pulse = pulseRaw * pulseRaw * pulseRaw * pulseRaw;
                    c.rgb += vec3(pulse * 0.55 * vfxInt);
                }
                if (vfxType > 5.5 && vfxType < 6.5 && vfxInt > 0.01) {
                    float gr = (hash12(uv * 512.0 + fract(vfxTime * 24.0) * 91.0) - 0.5) * 0.24 * vfxInt;
                    c.rgb += vec3(gr);
                }
                if (vfxType > 6.5 && vfxType < 7.5 && vfxInt > 0.01) {
                    float nl = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                    float scan = 0.84 + 0.16 * sin(uv.y * 360.0);
                    vec3 nvg = vec3(nl * 0.25, nl * 1.35 + 0.08, nl * 0.35) * scan;
                    c.rgb = mix(c.rgb, nvg, vfxInt);
                }
                if (vfxType > 13.5 && vfxType < 14.5 && vfxInt > 0.01) {
                    float sc = 0.78 + 0.22 * sin(uv.y * 380.0);
                    float ph = 0.90 + 0.10 * cos(uv.x * 460.0);
                    c.rgb *= mix(1.0, sc * ph, vfxInt);
                }
                if (vfxType > 14.5 && vfxType < 15.5 && vfxInt > 0.01) {
                    vec2 cell = fract(uv * 72.0) - 0.5;
                    float htLum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                    float dotMask = smoothstep(htLum * 0.55 + 0.06, htLum * 0.55 - 0.06, length(cell));
                    c.rgb = mix(c.rgb, c.rgb * (0.55 + 0.75 * dotMask), vfxInt);
                }
                if (vfxType > 15.5 && vfxType < 16.5 && vfxInt > 0.01) {
                    float blk = step(0.45, sin(vfxTime * 18.0));
                    c.rgb *= mix(1.0, 1.0 - blk * 0.88, vfxInt);
                }

                if (uVignette > 0.005) {
                    float vd = distance(vLayerUv, vec2(0.5)) * 1.414;
                    float vig = smoothstep(0.35, 1.05, vd);
                    c.rgb *= (1.0 - vig * uVignette * 0.85);
                }
                if (uColorTint.a > 0.005) {
                    c.rgb = mix(c.rgb, clamp(c.rgb * uColorTint.rgb * 1.15 + uColorTint.rgb * 0.25, 0.0, 1.0), uColorTint.a);
                }
                c.rgb = clamp(c.rgb, 0.0, 1.0);

                if (uMaskType > 0.5) {
                    vec2 centered = vLayerUv - vec2(0.5 + uMaskRect.x, 0.5 + uMaskRect.y);
                    float cs = cos(-uMaskRot);
                    float sn = sin(-uMaskRot);
                    vec2 rCent = vec2(centered.x * cs - centered.y * sn, centered.x * sn + centered.y * cs);
                    vec2 mp = rCent / max(vec2(0.02), uMaskRect.zw * 0.5);
                    float sd = 0.0;
                    if (uMaskType < 1.5) {
                        vec2 mq = abs(mp) - vec2(1.0);
                        sd = max(mq.x, mq.y);
                    } else if (uMaskType < 2.5) {
                        sd = length(mp) - 1.0;
                    } else if (uMaskType < 3.5) {
                        sd = mp.y;
                    } else if (uMaskType < 4.5) {
                        sd = abs(mp.y) - 1.0;
                    } else if (uMaskType < 5.5) {
                        vec2 hp = vec2(abs(mp.x), -mp.y) * 0.85 + vec2(0.0, 0.5);
                        if (hp.y + hp.x > 1.0) sd = length(hp - vec2(0.25, 0.75)) - 0.3535;
                        else sd = min(length(hp - vec2(0.0, 1.0)), length(hp - vec2(0.5 * max(hp.x + hp.y, 0.0)))) * sign(hp.x - hp.y);
                        sd *= 1.4;
                    } else {
                        float ang = atan(mp.y, mp.x);
                        float rStar = 0.68 + 0.30 * cos(5.0 * ang + 1.5708);
                        sd = length(mp) - rStar;
                    }
                    float fth = max(0.004, uMaskFeather * 2.0);
                    float mAlpha = 1.0 - smoothstep(-fth, fth, sd);
                    if (uMaskInvert > 0.5) mAlpha = 1.0 - mAlpha;
                    c.a *= mAlpha;
                }
                if (uWipe.x > 0.5) {
                    float p = clamp(uWipe.y, 0.0, 1.0);
                    float soft = 0.03;
                    if (uWipe.x < 1.5) {
                        float e = mix(-soft, 1.0 + soft, p);
                        c.a *= 1.0 - smoothstep(e - soft, e + soft, vLayerUv.x);
                    } else if (uWipe.x < 2.5) {
                        float e = mix(1.0 + soft, -soft, p);
                        c.a *= smoothstep(e - soft, e + soft, vLayerUv.x);
                    } else if (uWipe.x < 3.5) {
                        float e = mix(1.0 + soft, -soft, p);
                        c.a *= smoothstep(e - soft, e + soft, vLayerUv.y);
                    } else if (uWipe.x < 4.5) {
                        float e = mix(-soft, 1.0 + soft, p);
                        c.a *= 1.0 - smoothstep(e - soft, e + soft, vLayerUv.y);
                    } else {
                        float e = mix(-soft, 0.72 + soft, p);
                        c.a *= 1.0 - smoothstep(e - soft, e + soft, distance(vLayerUv, vec2(0.5)));
                    }
                }
                float outAlpha = c.a * uAlpha;
                if (uPremul > 0.5) {
                    c.rgb *= outAlpha;
                }
                gl_FragColor = vec4(c.rgb, outAlpha);
            }
        """.trimIndent()
        val vShader = compileShader(GLES20.GL_VERTEX_SHADER, vs)
        val fShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fs)
        val prog = GLES20.glCreateProgram()
        GLES20.glAttachShader(prog, vShader)
        GLES20.glAttachShader(prog, fShader)
        GLES20.glLinkProgram(prog)
        return prog
    }

    private fun compileShader(type: Int, src: String): Int {
        val s = GLES20.glCreateShader(type)
        GLES20.glShaderSource(s, src)
        GLES20.glCompileShader(s)
        return s
    }

    private fun drainPendingTextureDeletes() {
        while (true) {
            val id = pendingDeleteTexIds.poll() ?: break
            if (id != 0) {
                tempIntArr[0] = id
                try { GLES20.glDeleteTextures(1, tempIntArr, 0) } catch (_: Exception) {}
            }
        }
    }

    private fun ensureFboPair(
        reqW: Int,
        reqH: Int,
        curW: Int,
        curH: Int,
        fboA: Int,
        fboB: Int,
        texA: Int,
        texB: Int,
        onAllocated: (Int, Int, Int, Int, Int, Int) -> Unit
    ): Boolean {
        val fw = max(2, min(1920, reqW))
        val fh = max(2, min(1920, reqH))
        if (fboA != 0 && fboB != 0 && curW == fw && curH == fh) return true
        if (fboA == 0 || fboB == 0) {
            val fIds = IntArray(2)
            val tIds = IntArray(2)
            GLES20.glGenFramebuffers(2, fIds, 0)
            GLES20.glGenTextures(2, tIds, 0)
            for (i in 0..1) {
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tIds[i])
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
                GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, fw, fh, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fIds[i])
                GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tIds[i], 0)
                if (GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER) != GLES20.GL_FRAMEBUFFER_COMPLETE) {
                    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
                    GLES20.glDeleteFramebuffers(2, fIds, 0)
                    GLES20.glDeleteTextures(2, tIds, 0)
                    return false
                }
            }
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            onAllocated(fIds[0], fIds[1], tIds[0], tIds[1], fw, fh)
            return true
        }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texA)
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, fw, fh, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texB)
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, fw, fh, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        onAllocated(fboA, fboB, texA, texB, fw, fh)
        return true
    }

    private fun applyBlendMode(blendMode: String): Float {
        return when (blendMode) {
            "add" -> {
                GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE)
                0f
            }
            "screen" -> {
                GLES20.glBlendFuncSeparate(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_COLOR, GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
                1f
            }
            "multiply" -> {
                GLES20.glBlendFuncSeparate(GLES20.GL_DST_COLOR, GLES20.GL_ONE_MINUS_SRC_ALPHA, GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
                1f
            }
            else -> {
                GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
                0f
            }
        }
    }

    private fun drawGlFrame() {
        if (eglDisplay === EGL14.EGL_NO_DISPLAY || eglSurface === EGL14.EGL_NO_SURFACE) return
        try {
            EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)
        } catch (_: Exception) {
            return
        }

        drainPendingTextureDeletes()

        for (slot in oesPool) {
            if (slot.boundMediaId != null && slot.framePendingUpdate.getAndSet(false)) {
                slot.updateTexImageSafe()
            }
        }

        val scene = currentScene
        if (scene == null) {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            GLES20.glViewport(0, 0, surfaceW, surfaceH)
            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glClearColor(0.02f, 0.03f, 0.04f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            EGL14.eglSwapBuffers(eglDisplay, eglSurface)
            return
        }

        val adjIndices = ArrayList<Int>()
        for (i in scene.layers.indices) {
            if (scene.layers[i].type == "adjustment") adjIndices.add(i)
        }
        val lastAdjIndex = adjIndices.lastOrNull() ?: -1
        var curSceneFbo = 0
        var curSceneIdx = 0
        if (lastAdjIndex >= 0 && ensureFboPair(surfaceW, surfaceH, sceneFboW, sceneFboH, sceneFboA, sceneFboB, sceneTexA, sceneTexB) { fa, fb, ta, tb, w, h ->
                sceneFboA = fa; sceneFboB = fb; sceneTexA = ta; sceneTexB = tb; sceneFboW = w; sceneFboH = h
            }) {
            curSceneFbo = sceneFboA
        }

        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, curSceneFbo)
        GLES20.glViewport(0, 0, surfaceW, surfaceH)
        GLES20.glDisable(GLES20.GL_BLEND)

        val r = Color.red(scene.bgColor) / 255f
        val g = Color.green(scene.bgColor) / 255f
        val b = Color.blue(scene.bgColor) / 255f
        GLES20.glClearColor(r, g, b, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

        if (scene.bgMode == "gradient") {
            tex2dUniforms?.let { u ->
                GLES20.glUseProgram(tex2dProgram)
                drawBackgroundGradient(u, scene.grad0, scene.grad1)
            }
        } else if (scene.bgMode == "blur" && scene.bgBlurLayer != null) {
            drawSingleLayer(scene.bgBlurLayer, curSceneFbo, blendEnabled = false)
        }

        GLES20.glEnable(GLES20.GL_BLEND)
        for (idx in scene.layers.indices) {
            val layer = scene.layers[idx]
            if (layer.type == "adjustment") {
                if (curSceneFbo == 0 || lastAdjIndex < 0) continue
                val srcTex = if (curSceneIdx == 0) sceneTexA else sceneTexB
                val nextFbo = if (idx == lastAdjIndex) 0 else if (curSceneIdx == 0) sceneFboB else sceneFboA
                drawAdjustmentPass(layer, srcTex, nextFbo)
                curSceneFbo = nextFbo
                if (nextFbo != 0) curSceneIdx = 1 - curSceneIdx
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, curSceneFbo)
                GLES20.glViewport(0, 0, surfaceW, surfaceH)
                GLES20.glEnable(GLES20.GL_BLEND)
                continue
            }

            val subs = layer.subPasses
            if (subs != null && subs.size > 1) {
                for (si in subs.indices) {
                    val sub = subs[si]
                    if (sub.alpha <= 0.002f) continue
                    drawSingleLayer(layer, curSceneFbo, blendEnabled = true, overrideMvp = sub.mvp, overrideAlpha = sub.alpha, overrideTimeSec = sub.timeSec)
                }
            } else if (layer.alpha > 0.002f) {
                drawSingleLayer(layer, curSceneFbo, blendEnabled = true)
            }
        }

        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        EGL14.eglSwapBuffers(eglDisplay, eglSurface)
    }

    private fun drawAdjustmentPass(layer: LayerRenderSpec, srcSceneTex: Int, targetFbo: Int) {
        val u = tex2dUniforms ?: return
        val vbuf = quadVertexBuf ?: return
        var activeTex = srcSceneTex
        var texMat = fboFlipYMat
        var lastVfx: VfxPassSpec? = layer.vfxList.lastOrNull()

        if (layer.vfxList.size > 1) {
            val passW = min(surfaceW, 1280)
            val passH = min(surfaceH, 1280)
            if (ensureFboPair(passW, passH, fxW, fxH, fxFboA, fxFboB, fxTexA, fxTexB) { fa, fb, ta, tb, w, h ->
                    fxFboA = fa; fxFboB = fb; fxTexA = ta; fxTexB = tb; fxW = w; fxH = h
                }) {
                GLES20.glUseProgram(tex2dProgram)
                GLES20.glDisable(GLES20.GL_BLEND)
                GLES20.glViewport(0, 0, fxW, fxH)
                var targetIdx = 0
                for (vi in 0 until layer.vfxList.size - 1) {
                    val vItem = layer.vfxList[vi]
                    val fbo = if (targetIdx == 0) fxFboA else fxFboB
                    val nextTex = if (targetIdx == 0) fxTexA else fxTexB
                    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
                    GLES20.glClearColor(0f, 0f, 0f, 0f)
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                    drawNeutralPass(u, vbuf, GLES20.GL_TEXTURE_2D, activeTex, texMat, orthoMvp, 1f / passW, 1f / passH, vItem)
                    activeTex = nextTex
                    texMat = fboFlipYMat
                    targetIdx = 1 - targetIdx
                }
            }
        }

        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, targetFbo)
        GLES20.glViewport(0, 0, surfaceW, surfaceH)
        GLES20.glUseProgram(tex2dProgram)

        val needBackdrop = layer.alpha < 0.999f ||
            layer.blendMode != "normal" ||
            layer.maskType > 0.5f ||
            layer.wipeType > 0.5f ||
            layer.cropL > 0.001f || layer.cropT > 0.001f || layer.cropR > 0.001f || layer.cropB > 0.001f

        if (needBackdrop) {
            GLES20.glDisable(GLES20.GL_BLEND)
            drawNeutralPass(u, vbuf, GLES20.GL_TEXTURE_2D, srcSceneTex, fboFlipYMat, orthoMvp, 1f / max(1, surfaceW), 1f / max(1, surfaceH), null)
            GLES20.glEnable(GLES20.GL_BLEND)
        } else {
            GLES20.glDisable(GLES20.GL_BLEND)
        }

        val premul = if (needBackdrop) applyBlendMode(layer.blendMode) else 0f
        drawQuadWithUniforms(
            u = u,
            vbuf = vbuf,
            texTarget = GLES20.GL_TEXTURE_2D,
            texId = activeTex,
            texMatrix = texMat,
            layer = layer,
            mvpOverride = orthoMvp,
            alphaOverride = if (needBackdrop) layer.alpha else 1f,
            premul = premul,
            vfxOverride = lastVfx,
            timeSecOverride = layer.timeSec
        )
    }

    private fun drawSingleLayer(
        layer: LayerRenderSpec,
        targetFbo: Int,
        blendEnabled: Boolean,
        overrideMvp: FloatArray? = null,
        overrideAlpha: Float? = null,
        overrideTimeSec: Float? = null
    ) {
        val vbuf = quadVertexBuf ?: return
        var texTarget = GLES20.GL_TEXTURE_2D
        var srcTexId = 0
        var srcTexMat = identityMat
        var isOesSource = false

        when (layer.type) {
            "video" -> {
                val slot = videoSlots[layer.mediaId] ?: return
                if (!slot.oesSlot.hasFrame) return
                texTarget = GLES11Ext.GL_TEXTURE_EXTERNAL_OES
                srcTexId = slot.oesSlot.texId
                srcTexMat = slot.oesSlot.texMatrix
                isOesSource = true
            }
            "image" -> {
                srcTexId = getOrUploadImageTexture(layer.mediaId) ?: return
            }
            "uploaded" -> {
                srcTexId = getOrUploadUploadedTexture(layer.texKey) ?: return
            }
            else -> return
        }

        var activeTex = srcTexId
        var activeTarget = texTarget
        var activeMat = srcTexMat
        var activeOes = isOesSource
        val lastVfx = layer.vfxList.lastOrNull()

        if (layer.vfxList.size > 1) {
            val layerW = max(64, min(surfaceW, (1f / max(1e-4f, layer.texelX)).roundToInt()))
            val layerH = max(64, min(surfaceH, (1f / max(1e-4f, layer.texelY)).roundToInt()))
            if (ensureFboPair(layerW, layerH, fxW, fxH, fxFboA, fxFboB, fxTexA, fxTexB) { fa, fb, ta, tb, w, h ->
                    fxFboA = fa; fxFboB = fb; fxTexA = ta; fxTexB = tb; fxW = w; fxH = h
                }) {
                GLES20.glDisable(GLES20.GL_BLEND)
                GLES20.glViewport(0, 0, fxW, fxH)
                var targetIdx = 0
                for (vi in 0 until layer.vfxList.size - 1) {
                    val vItem = layer.vfxList[vi]
                    val fbo = if (targetIdx == 0) fxFboA else fxFboB
                    val nextTex = if (targetIdx == 0) fxTexA else fxTexB
                    val passProg = if (activeOes) oesProgram else tex2dProgram
                    val passU = (if (activeOes) oesUniforms else tex2dUniforms) ?: break
                    GLES20.glUseProgram(passProg)
                    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
                    GLES20.glClearColor(0f, 0f, 0f, 0f)
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                    drawNeutralPass(passU, vbuf, activeTarget, activeTex, activeMat, orthoMvp, layer.texelX, layer.texelY, vItem)
                    activeTex = nextTex
                    activeTarget = GLES20.GL_TEXTURE_2D
                    activeMat = fboFlipYMat
                    activeOes = false
                    targetIdx = 1 - targetIdx
                }
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, targetFbo)
                GLES20.glViewport(0, 0, surfaceW, surfaceH)
            }
        }

        if (blendEnabled) {
            GLES20.glEnable(GLES20.GL_BLEND)
        } else {
            GLES20.glDisable(GLES20.GL_BLEND)
        }
        val premul = if (blendEnabled) applyBlendMode(layer.blendMode) else 0f
        val prog = if (activeOes) oesProgram else tex2dProgram
        val u = (if (activeOes) oesUniforms else tex2dUniforms) ?: return
        GLES20.glUseProgram(prog)
        drawQuadWithUniforms(
            u = u,
            vbuf = vbuf,
            texTarget = activeTarget,
            texId = activeTex,
            texMatrix = activeMat,
            layer = layer,
            mvpOverride = overrideMvp,
            alphaOverride = overrideAlpha,
            premul = premul,
            vfxOverride = lastVfx,
            timeSecOverride = overrideTimeSec
        )
    }

    private fun getOrUploadImageTexture(mediaId: String): Int? {
        val existing = imageTextures[mediaId]
        if (existing != null) {
            existing.lastUsedSeq = ++slotSeqCounter
            return existing.texId
        }
        val bmp = imageCache.get(mediaId) ?: return null
        if (bmp.isRecycled) return null
        GLES20.glGenTextures(1, tempIntArr, 0)
        val texId = tempIntArr[0]
        if (texId == 0) return null
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
        imageTextures[mediaId] = ImageTexEntry(texId, ++slotSeqCounter)

        if (imageTextures.size > maxGpuFileTextures) {
            val oldestKey = imageTextures.entries.minByOrNull { it.value.lastUsedSeq }?.key
            if (oldestKey != null && oldestKey != mediaId) {
                imageTextures.remove(oldestKey)?.let { ev ->
                    pendingDeleteTexIds.offer(ev.texId)
                }
            }
        }
        return texId
    }

    private fun getOrUploadUploadedTexture(texKey: String): Int? {
        if (texKey.isBlank()) return null
        val entry = uploadedTextures[texKey] ?: return null
        if (entry.dirty) {
            val bmpToUpload: Bitmap?
            synchronized(entry) {
                bmpToUpload = entry.pendingBmp
                entry.pendingBmp = null
                entry.dirty = false
            }
            if (bmpToUpload != null && !bmpToUpload.isRecycled) {
                if (entry.texId == 0) {
                    GLES20.glGenTextures(1, tempIntArr, 0)
                    entry.texId = tempIntArr[0]
                }
                if (entry.texId != 0) {
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, entry.texId)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
                    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmpToUpload, 0)
                }
                try { bmpToUpload.recycle() } catch (_: Exception) {}
            }
        }
        return if (entry.texId != 0) entry.texId else null
    }

    private fun drawBackgroundGradient(u: ProgramUniforms, c0: Int, c1: Int) {
        val vbuf = quadVertexBuf ?: return
        vbuf.position(0)
        GLES20.glEnableVertexAttribArray(u.aPos)
        GLES20.glVertexAttribPointer(u.aPos, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        if (u.aUv >= 0) {
            vbuf.position(2)
            GLES20.glEnableVertexAttribArray(u.aUv)
            GLES20.glVertexAttribPointer(u.aUv, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        }
        GLES20.glUniformMatrix4fv(u.uMvp, 1, false, orthoMvp, 0)
        GLES20.glUniformMatrix4fv(u.uTexMatrix, 1, false, identityMat, 0)
        GLES20.glUniform1f(u.uBgGradOn, 1f)
        GLES20.glUniform4f(u.uBgGrad0, Color.red(c0) / 255f, Color.green(c0) / 255f, Color.blue(c0) / 255f, 1f)
        GLES20.glUniform4f(u.uBgGrad1, Color.red(c1) / 255f, Color.green(c1) / 255f, Color.blue(c1) / 255f, 1f)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glUniform1f(u.uBgGradOn, 0f)
    }

    private fun drawNeutralPass(
        u: ProgramUniforms,
        vbuf: FloatBuffer,
        texTarget: Int,
        texId: Int,
        texMatrix: FloatArray,
        mvp: FloatArray,
        texelX: Float,
        texelY: Float,
        vfx: VfxPassSpec?
    ) {
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(texTarget, texId)
        GLES20.glUniform1i(u.uTex, 0)

        vbuf.position(0)
        GLES20.glEnableVertexAttribArray(u.aPos)
        GLES20.glVertexAttribPointer(u.aPos, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        if (u.aUv >= 0) {
            vbuf.position(2)
            GLES20.glEnableVertexAttribArray(u.aUv)
            GLES20.glVertexAttribPointer(u.aUv, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        }

        GLES20.glUniformMatrix4fv(u.uMvp, 1, false, mvp, 0)
        GLES20.glUniformMatrix4fv(u.uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniform1f(u.uBgGradOn, 0f)
        GLES20.glUniform1f(u.uAlpha, 1f)
        GLES20.glUniform1f(u.uPremul, 0f)
        GLES20.glUniform1f(u.uColorAdjOn, 0f)
        GLES20.glUniform1f(u.uHslOn, 0f)
        GLES20.glUniform1f(u.uSharpen, 0f)
        GLES20.glUniform1f(u.uBlur, 0f)
        GLES20.glUniform1f(u.uVignette, 0f)
        GLES20.glUniform1f(u.uGrain, 0f)
        GLES20.glUniform2f(u.uTexel, texelX, texelY)
        GLES20.glUniform1f(u.uChromaOn, 0f)
        GLES20.glUniform1f(u.uOutlineW, 0f)
        GLES20.glUniform1f(u.uMaskType, 0f)
        GLES20.glUniform4f(u.uCropRect, 0f, 0f, 0f, 0f)
        GLES20.glUniform4f(u.uStab, 0f, 0f, 0f, 1f)
        GLES20.glUniform2f(u.uWipe, 0f, 1f)
        GLES20.glUniform4f(u.uColorTint, 1f, 1f, 1f, 0f)
        if (vfx != null) {
            GLES20.glUniform3f(u.uVfx, vfx.shaderId, vfx.intensity, vfx.timeSec)
        } else {
            GLES20.glUniform3f(u.uVfx, 0f, 0f, 0f)
        }
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }

    private fun drawQuadWithUniforms(
        u: ProgramUniforms,
        vbuf: FloatBuffer,
        texTarget: Int,
        texId: Int,
        texMatrix: FloatArray,
        layer: LayerRenderSpec,
        mvpOverride: FloatArray? = null,
        alphaOverride: Float? = null,
        premul: Float = 0f,
        vfxOverride: VfxPassSpec? = null,
        timeSecOverride: Float? = null
    ) {
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(texTarget, texId)
        GLES20.glUniform1i(u.uTex, 0)

        vbuf.position(0)
        GLES20.glEnableVertexAttribArray(u.aPos)
        GLES20.glVertexAttribPointer(u.aPos, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        if (u.aUv >= 0) {
            vbuf.position(2)
            GLES20.glEnableVertexAttribArray(u.aUv)
            GLES20.glVertexAttribPointer(u.aUv, 2, GLES20.GL_FLOAT, false, 16, vbuf)
        }

        GLES20.glUniformMatrix4fv(u.uMvp, 1, false, mvpOverride ?: layer.mvp, 0)
        GLES20.glUniformMatrix4fv(u.uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniform1f(u.uBgGradOn, 0f)
        GLES20.glUniform1f(u.uAlpha, alphaOverride ?: layer.alpha)
        GLES20.glUniform1f(u.uPremul, premul)

        val colorAdjActive = abs(layer.brightness) > 0.002f ||
            abs(layer.contrast - 1f) > 0.002f ||
            abs(layer.saturation - 1f) > 0.002f ||
            abs(layer.temperature) > 0.002f ||
            abs(layer.tint) > 0.002f ||
            abs(layer.exposure) > 0.002f ||
            abs(layer.highlights) > 0.002f ||
            abs(layer.shadows) > 0.002f ||
            layer.fade > 0.005f
        GLES20.glUniform1f(u.uColorAdjOn, if (colorAdjActive) 1f else 0f)
        GLES20.glUniform1f(u.uBright, layer.brightness)
        GLES20.glUniform1f(u.uContrast, layer.contrast)
        GLES20.glUniform1f(u.uSat, layer.saturation)
        GLES20.glUniform1f(u.uTemp, layer.temperature)
        GLES20.glUniform1f(u.uTint, layer.tint)
        GLES20.glUniform1f(u.uExposure, layer.exposure)
        GLES20.glUniform1f(u.uHighlights, layer.highlights)
        GLES20.glUniform1f(u.uShadows, layer.shadows)
        GLES20.glUniform1f(u.uFade, layer.fade)

        GLES20.glUniform1f(u.uSharpen, layer.sharpen)
        GLES20.glUniform1f(u.uBlur, layer.blur)
        GLES20.glUniform1f(u.uVignette, layer.vignette)
        GLES20.glUniform1f(u.uGrain, layer.grain)
        GLES20.glUniform2f(u.uTexel, layer.texelX, layer.texelY)

        GLES20.glUniform1f(u.uChromaOn, layer.chromaOn)
        GLES20.glUniform3f(u.uChromaKey, layer.chromaR, layer.chromaG, layer.chromaB)
        GLES20.glUniform1f(u.uChromaSim, layer.chromaSim)
        GLES20.glUniform1f(u.uChromaSmooth, layer.chromaSmooth)
        GLES20.glUniform1f(u.uChromaSpill, layer.chromaSpill)

        GLES20.glUniform1f(u.uOutlineW, layer.outlineW)
        GLES20.glUniform3f(u.uOutlineCol, layer.outlineR, layer.outlineG, layer.outlineB)

        GLES20.glUniform1f(u.uMaskType, layer.maskType)
        GLES20.glUniform4f(u.uMaskRect, layer.maskOffsetX, layer.maskOffsetY, layer.maskScaleX, layer.maskScaleY)
        GLES20.glUniform1f(u.uMaskRot, layer.maskRot)
        GLES20.glUniform1f(u.uMaskFeather, layer.maskFeather)
        GLES20.glUniform1f(u.uMaskInvert, layer.maskInvert)

        GLES20.glUniform4f(u.uCropRect, layer.cropL, layer.cropT, layer.cropR, layer.cropB)
        GLES20.glUniform4f(u.uStab, layer.stabDx, layer.stabDy, layer.stabRot, layer.stabScale)
        GLES20.glUniform2f(u.uWipe, layer.wipeType, layer.wipeProgress)

        val vfx = vfxOverride
        if (vfx != null) {
            GLES20.glUniform3f(u.uVfx, vfx.shaderId, vfx.intensity, vfx.timeSec)
        } else {
            GLES20.glUniform3f(u.uVfx, 0f, 0f, timeSecOverride ?: layer.timeSec)
        }

        val hsl = layer.hslFlat
        if (hsl != null) {
            GLES20.glUniform1f(u.uHslOn, 1f)
            GLES20.glUniform3fv(u.uHsl, 8, hsl, 0)
        } else {
            GLES20.glUniform1f(u.uHslOn, 0f)
            GLES20.glUniform3fv(u.uHsl, 8, zeroHsl, 0)
        }

        if (layer.tintOn) {
            GLES20.glUniform4f(u.uColorTint, layer.tintR, layer.tintG, layer.tintB, layer.tintA)
        } else {
            GLES20.glUniform4f(u.uColorTint, 1f, 1f, 1f, 0f)
        }

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }
}
