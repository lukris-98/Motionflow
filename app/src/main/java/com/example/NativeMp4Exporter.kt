package com.example

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.view.Surface
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

class NativeMp4Exporter(
    private val context: Context,
    private val exportsDir: File
) {
    private var videoEncoder: MediaCodec? = null
    private var audioEncoder: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var eglHelper: EglInputSurface? = null

    private var videoTrackIndex = -1
    private var audioTrackIndex = -1
    private var muxerStarted = false
    private var hasAudio = false

    private data class PendingSample(val data: ByteArray, val info: MediaCodec.BufferInfo)
    private val pendingVideoSamples = mutableListOf<PendingSample>()
    private val pendingAudioSamples = mutableListOf<PendingSample>()

    private var width = 1280
    private var height = 720
    private var fps = 30
    private var totalFrames = 0
    private var outFile: File? = null
    private var outputName: String = "MotionFlow_Export.mp4"
    private var customOutputUri: Uri? = null

    @Volatile
    private var cancelled = false

    fun getMaxSupportedResolution(): JSONObject {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        var maxW = 1920
        var maxH = 1080
        for (info in list.codecInfos) {
            if (!info.isEncoder) continue
            if (info.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) }) {
                try {
                    val caps = info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities
                    if (caps != null) {
                        maxW = maxOf(maxW, caps.supportedWidths.upper)
                        maxH = maxOf(maxH, caps.supportedHeights.upper)
                    }
                } catch (_: Exception) {}
            }
        }
        return JSONObject().apply {
            put("supports4K", maxW >= 3840 && maxH >= 2160)
            put("maxWidth", maxW)
            put("maxHeight", maxH)
        }
    }

    @Synchronized
    fun begin(
        reqWidth: Int,
        reqHeight: Int,
        reqFps: Int,
        bitrateMbps: Int,
        totalFrames: Int,
        includeAudio: Boolean,
        fileName: String,
        customUri: Uri? = null
    ) {
        cleanup()
        cancelled = false
        // H.264 requires even dimensions
        this.width = (reqWidth / 2) * 2
        this.height = (reqHeight / 2) * 2
        this.fps = reqFps.coerceIn(12, 60)
        this.totalFrames = totalFrames.coerceAtLeast(1)
        this.hasAudio = includeAudio
        this.outputName = if (fileName.endsWith(".mp4", ignoreCase = true)) fileName else "$fileName.mp4"
        this.customOutputUri = customUri

        exportsDir.mkdirs()
        val tempFile = File(exportsDir, "export_${System.currentTimeMillis()}.mp4")
        outFile = tempFile

        val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrateMbps.coerceIn(2, 40) * 1_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        val vCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        vCodec.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = vCodec.createInputSurface()
        vCodec.start()
        videoEncoder = vCodec

        eglHelper = EglInputSurface(inputSurface, width, height)

        if (hasAudio) {
            val audioFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, 44100, 2).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 192_000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
            }
            val aCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            aCodec.configure(audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            aCodec.start()
            audioEncoder = aCodec
        }

        muxer = MediaMuxer(tempFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        videoTrackIndex = -1
        audioTrackIndex = -1
        muxerStarted = false
        pendingVideoSamples.clear()
        pendingAudioSamples.clear()
    }

    @Synchronized
    fun pushFrameBase64(frameIndex: Int, dataUrlOrBase64: String) {
        if (cancelled) return
        val vCodec = videoEncoder ?: throw IllegalStateException("Video encoder not initialized")
        val egl = eglHelper ?: throw IllegalStateException("EGL surface not initialized")

        val pureBase64 = if (dataUrlOrBase64.contains(",")) {
            dataUrlOrBase64.substringAfter(",")
        } else {
            dataUrlOrBase64
        }
        val bytes = Base64.decode(pureBase64, Base64.DEFAULT)
        val rawBmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalStateException("Failed to decode frame $frameIndex")

        val frameBmp = if (rawBmp.width != width || rawBmp.height != height) {
            Bitmap.createScaledBitmap(rawBmp, width, height, true).also { rawBmp.recycle() }
        } else {
            rawBmp
        }

        egl.makeCurrent()
        egl.drawBitmap(frameBmp)
        frameBmp.recycle()

        val ptsNs = (frameIndex.toLong() * 1_000_000_000L) / fps.toLong()
        egl.setPresentationTime(ptsNs)
        egl.swapBuffers()

        drainVideoEncoder(vCodec, endOfStream = false)
    }

    @Synchronized
    fun pushAudioPcmBase64(base64Pcm16Stereo: String) {
        if (cancelled || !hasAudio) return
        val aCodec = audioEncoder ?: return
        val pcmBytes = Base64.decode(base64Pcm16Stereo, Base64.DEFAULT)

        var offset = 0
        var totalSamplesFed = 0L
        val bytesPerSampleFrame = 4 // 16-bit stereo = 2ch * 2bytes

        while (offset < pcmBytes.size && !cancelled) {
            val inIdx = aCodec.dequeueInputBuffer(10_000)
            if (inIdx >= 0) {
                val inputBuf = aCodec.getInputBuffer(inIdx) ?: break
                inputBuf.clear()
                val rawChunk = minOf(inputBuf.remaining(), pcmBytes.size - offset)
                val chunk = (rawChunk / bytesPerSampleFrame) * bytesPerSampleFrame
                if (chunk <= 0) break
                inputBuf.put(pcmBytes, offset, chunk)
                val ptsUs = (totalSamplesFed * 1_000_000L) / 44100L
                aCodec.queueInputBuffer(inIdx, 0, chunk, ptsUs, 0)
                offset += chunk
                totalSamplesFed += (chunk / bytesPerSampleFrame)
            }
            drainAudioEncoder(aCodec, endOfStream = false)
        }

        // Send audio EOS
        var eosQueued = false
        while (!eosQueued && !cancelled) {
            val inIdx = aCodec.dequeueInputBuffer(10_000)
            if (inIdx >= 0) {
                val ptsUs = (totalSamplesFed * 1_000_000L) / 44100L
                aCodec.queueInputBuffer(inIdx, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                eosQueued = true
            }
            drainAudioEncoder(aCodec, endOfStream = false)
        }
        drainAudioEncoder(aCodec, endOfStream = true)
    }

    @Synchronized
    fun finish(): JSONObject {
        if (cancelled) {
            cleanup()
            throw IllegalStateException("Export cancelled")
        }
        val vCodec = videoEncoder ?: throw IllegalStateException("Video encoder not started")
        vCodec.signalEndOfInputStream()
        drainVideoEncoder(vCodec, endOfStream = true)

        if (hasAudio && audioTrackIndex < 0) {
            audioEncoder?.let { aCodec ->
                val inIdx = aCodec.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    aCodec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                }
                drainAudioEncoder(aCodec, endOfStream = true)
            }
            if (!muxerStarted && audioTrackIndex < 0 && videoTrackIndex >= 0) {
                hasAudio = false
                tryStartMuxer()
            }
        }

        val internalFile = outFile ?: throw IllegalStateException("No output file")
        releaseCodecsOnly()

        val targetCustomUri = customOutputUri
        customOutputUri = null

        var isCustomLocation = false
        var savedUri: Uri? = null
        if (targetCustomUri != null) {
            savedUri = writeToCustomUri(internalFile, targetCustomUri)
            if (savedUri != null) {
                isCustomLocation = true
            }
        }
        if (savedUri == null) {
            savedUri = saveToPublicMovies(internalFile, outputName)
        }

        return JSONObject().apply {
            put("fileName", outputName)
            put("internalUrl", "https://${MediaStorageHelper.APP_HOST}/exports/${internalFile.name}")
            put("internalPath", internalFile.absolutePath)
            put("contentUri", savedUri?.toString() ?: "")
            put("isCustomLocation", isCustomLocation)
            put("sizeBytes", internalFile.length())
        }
    }

    @Synchronized
    fun cancel() {
        cancelled = true
        val f = outFile
        val pendingUri = customOutputUri
        customOutputUri = null
        cleanup()
        f?.delete()
        if (pendingUri != null) {
            try {
                DocumentsContract.deleteDocument(context.contentResolver, pendingUri)
            } catch (_: Exception) {}
        }
    }

    private fun drainVideoEncoder(encoder: MediaCodec, endOfStream: Boolean) {
        val bufferInfo = MediaCodec.BufferInfo()
        val m = muxer ?: return
        var tries = 0
        while (true) {
            val outIdx = encoder.dequeueOutputBuffer(bufferInfo, if (endOfStream) 10_000 else 0)
            if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream || ++tries > 50) break
            } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (videoTrackIndex < 0) {
                    videoTrackIndex = m.addTrack(encoder.outputFormat)
                    tryStartMuxer()
                }
            } else if (outIdx >= 0) {
                val encodedData = encoder.getOutputBuffer(outIdx)
                if (encodedData != null && (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && bufferInfo.size > 0) {
                    if (!muxerStarted) {
                        // Wait for audio format if audio is enabled, up to a small safety limit
                        if (hasAudio && audioTrackIndex < 0) {
                            audioEncoder?.let { drainAudioEncoder(it, false) }
                        }
                        if (!muxerStarted && !hasAudio) tryStartMuxer()
                    }
                    if (muxerStarted && videoTrackIndex >= 0) {
                        encodedData.position(bufferInfo.offset)
                        encodedData.limit(bufferInfo.offset + bufferInfo.size)
                        m.writeSampleData(videoTrackIndex, encodedData, bufferInfo)
                    } else {
                        val copy = ByteArray(bufferInfo.size)
                        encodedData.position(bufferInfo.offset)
                        encodedData.get(copy)
                        val infoCopy = MediaCodec.BufferInfo().apply {
                            set(0, copy.size, bufferInfo.presentationTimeUs, bufferInfo.flags)
                        }
                        pendingVideoSamples.add(PendingSample(copy, infoCopy))
                    }
                }
                encoder.releaseOutputBuffer(outIdx, false)
                if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
            }
        }
    }

    private fun drainAudioEncoder(encoder: MediaCodec, endOfStream: Boolean) {
        val bufferInfo = MediaCodec.BufferInfo()
        val m = muxer ?: return
        var tries = 0
        while (true) {
            val outIdx = encoder.dequeueOutputBuffer(bufferInfo, if (endOfStream) 10_000 else 0)
            if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream || ++tries > 40) break
            } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (audioTrackIndex < 0) {
                    audioTrackIndex = m.addTrack(encoder.outputFormat)
                    tryStartMuxer()
                }
            } else if (outIdx >= 0) {
                val encodedData = encoder.getOutputBuffer(outIdx)
                if (encodedData != null && (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && bufferInfo.size > 0) {
                    if (muxerStarted && audioTrackIndex >= 0) {
                        encodedData.position(bufferInfo.offset)
                        encodedData.limit(bufferInfo.offset + bufferInfo.size)
                        m.writeSampleData(audioTrackIndex, encodedData, bufferInfo)
                    } else {
                        val copy = ByteArray(bufferInfo.size)
                        encodedData.position(bufferInfo.offset)
                        encodedData.get(copy)
                        val infoCopy = MediaCodec.BufferInfo().apply {
                            set(0, copy.size, bufferInfo.presentationTimeUs, bufferInfo.flags)
                        }
                        pendingAudioSamples.add(PendingSample(copy, infoCopy))
                    }
                }
                encoder.releaseOutputBuffer(outIdx, false)
                if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
            }
        }
    }

    private fun tryStartMuxer() {
        val m = muxer ?: return
        if (muxerStarted) return
        val ready = if (hasAudio) (videoTrackIndex >= 0 && audioTrackIndex >= 0) else (videoTrackIndex >= 0)
        if (ready) {
            m.start()
            muxerStarted = true
            for (s in pendingVideoSamples) {
                if (videoTrackIndex >= 0) m.writeSampleData(videoTrackIndex, ByteBuffer.wrap(s.data), s.info)
            }
            pendingVideoSamples.clear()
            for (s in pendingAudioSamples) {
                if (audioTrackIndex >= 0) m.writeSampleData(audioTrackIndex, ByteBuffer.wrap(s.data), s.info)
            }
            pendingAudioSamples.clear()
        }
    }

    private fun writeToCustomUri(source: File, targetUri: Uri): Uri? {
        return try {
            context.contentResolver.openOutputStream(targetUri, "wt")?.use { out ->
                FileInputStream(source).use { inp -> inp.copyTo(out) }
            } ?: return null
            targetUri
        } catch (_: Exception) {
            null
        }
    }

    private fun saveToPublicMovies(source: File, displayName: String): Uri? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/MotionFlow Studio")
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)?.use { out ->
                    FileInputStream(source).use { inp -> inp.copyTo(out) }
                }
                values.clear()
                values.put(MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                uri
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun releaseCodecsOnly() {
        try { eglHelper?.release() } catch (_: Exception) {}
        eglHelper = null
        try { videoEncoder?.stop(); videoEncoder?.release() } catch (_: Exception) {}
        videoEncoder = null
        try { audioEncoder?.stop(); audioEncoder?.release() } catch (_: Exception) {}
        audioEncoder = null
        try {
            if (muxerStarted) muxer?.stop()
            muxer?.release()
        } catch (_: Exception) {}
        muxer = null
        muxerStarted = false
        videoTrackIndex = -1
        audioTrackIndex = -1
    }

    private fun cleanup() {
        releaseCodecsOnly()
    }

    /**
     * Minimal EGL14 + GLES20 textured quad renderer for pushing Bitmap frames
     * into MediaCodec Surface with frame-accurate eglPresentationTimeANDROID timestamps.
     */
    private class EglInputSurface(
        private val surface: Surface,
        private val width: Int,
        private val height: Int
    ) {
        private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
        private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
        private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
        private var program = 0
        private var textureId = 0
        private var posHandle = 0
        private var texHandle = 0

        private val vertexBuffer: FloatBuffer
        private val texCoordBuffer: FloatBuffer

        init {
            val vertices = floatArrayOf(
                -1f, -1f,
                 1f, -1f,
                -1f,  1f,
                 1f,  1f
            )
            // Flip Y because Bitmap origin is top-left while GL texture is bottom-left
            val texCoords = floatArrayOf(
                0f, 1f,
                1f, 1f,
                0f, 0f,
                1f, 0f
            )
            vertexBuffer = ByteBuffer.allocateDirect(vertices.size * 4)
                .order(ByteOrder.nativeOrder()).asFloatBuffer().put(vertices).apply { position(0) }
            texCoordBuffer = ByteBuffer.allocateDirect(texCoords.size * 4)
                .order(ByteOrder.nativeOrder()).asFloatBuffer().put(texCoords).apply { position(0) }

            initEgl()
            makeCurrent()
            initGl()
        }

        private fun initEgl() {
            eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val version = IntArray(2)
            EGL14.eglInitialize(eglDisplay, version, 0, version, 1)

            val attribList = intArrayOf(
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                0x3142, 1, // EGL_RECORDABLE_ANDROID
                EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val numConfigs = IntArray(1)
            EGL14.eglChooseConfig(eglDisplay, attribList, 0, configs, 0, configs.size, numConfigs, 0)

            val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
            eglContext = EGL14.eglCreateContext(eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)

            val surfaceAttribs = intArrayOf(EGL14.EGL_NONE)
            eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, configs[0], surface, surfaceAttribs, 0)
        }

        private fun initGl() {
            val vsSource = """
                attribute vec2 aPosition;
                attribute vec2 aTexCoord;
                varying vec2 vTexCoord;
                void main() {
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                    vTexCoord = aTexCoord;
                }
            """.trimIndent()
            val fsSource = """
                precision mediump float;
                varying vec2 vTexCoord;
                uniform sampler2D uTexture;
                void main() {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                }
            """.trimIndent()

            val vs = compileShader(GLES20.GL_VERTEX_SHADER, vsSource)
            val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, fsSource)
            program = GLES20.glCreateProgram()
            GLES20.glAttachShader(program, vs)
            GLES20.glAttachShader(program, fs)
            GLES20.glLinkProgram(program)

            posHandle = GLES20.glGetAttribLocation(program, "aPosition")
            texHandle = GLES20.glGetAttribLocation(program, "aTexCoord")

            val textures = IntArray(1)
            GLES20.glGenTextures(1, textures, 0)
            textureId = textures[0]
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        }

        private fun compileShader(type: Int, code: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, code)
            GLES20.glCompileShader(shader)
            return shader
        }

        fun makeCurrent() {
            EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)
        }

        fun drawBitmap(bmp: Bitmap) {
            GLES20.glViewport(0, 0, width, height)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)

            GLES20.glEnableVertexAttribArray(posHandle)
            GLES20.glVertexAttribPointer(posHandle, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)

            GLES20.glEnableVertexAttribArray(texHandle)
            GLES20.glVertexAttribPointer(texHandle, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer)

            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        }

        fun setPresentationTime(nsecs: Long) {
            EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, nsecs)
        }

        fun swapBuffers() {
            EGL14.eglSwapBuffers(eglDisplay, eglSurface)
        }

        fun release() {
            if (eglDisplay !== EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                EGL14.eglDestroySurface(eglDisplay, eglSurface)
                EGL14.eglDestroyContext(eglDisplay, eglContext)
                EGL14.eglReleaseThread()
                EGL14.eglTerminate(eglDisplay)
            }
            surface.release()
            eglDisplay = EGL14.EGL_NO_DISPLAY
            eglContext = EGL14.EGL_NO_CONTEXT
            eglSurface = EGL14.EGL_NO_SURFACE
        }
    }
}
