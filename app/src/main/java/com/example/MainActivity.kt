package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {

    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var storageHelper: MediaStorageHelper
    private lateinit var mp4Exporter: NativeMp4Exporter
    private var webView: WebView? = null
    private var pendingJsonToExport: String? = null
    private var selectedExportUri: Uri? = null
    private var selectedExportDisplayName: String = ""
    private var pendingInternalSavePath: String? = null
    private val isRecordingVoiceover = AtomicBoolean(false)
    private var voiceoverJob: Job? = null
    private var textToSpeech: TextToSpeech? = null
    @Volatile
    private var ttsReady: Boolean = false

    private val requestMicPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            beginVoiceoverRecording()
        } else {
            evalJs("window.__mfNative && window.__mfNative.onVoiceoverState && window.__mfNative.onVoiceoverState('denied', 'Microphone permission denied');")
        }
    }

    private val pickVisualMediaLauncher = registerForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(10)
    ) { uris ->
        if (uris.isNotEmpty()) {
            importPickedUris(uris, null)
        }
    }

    private val pickAudioLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) {
            importPickedUris(uris, "audio")
        }
    }

    private val pickFontLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            ioScope.launch {
                val fontObj = withContext(Dispatchers.IO) { storageHelper.importFontUri(uri) }
                if (fontObj != null) {
                    val literal = fontObj.toString()
                    evalJs("window.__mfNative && window.__mfNative.onFontImported($literal);")
                }
            }
        }
    }

    private val openProjectJsonLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            ioScope.launch {
                val jsonText = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                }
                if (!jsonText.isNullOrBlank()) {
                    val encoded = JSONObject.quote(jsonText)
                    evalJs("window.__mfNative && window.__mfNative.onProjectJsonImported($encoded);")
                }
            }
        }
    }

    private val createProjectJsonLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val payload = pendingJsonToExport ?: return@registerForActivityResult
        pendingJsonToExport = null
        if (uri != null) {
            ioScope.launch(Dispatchers.IO) {
                contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(payload) }
                withContext(Dispatchers.Main) {
                    evalJs("window.__mfNative && window.__mfNative.onProjectJsonExported(true);")
                }
            }
        }
    }

    private val pickExportLocationLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("video/mp4")
    ) { uri ->
        if (uri != null) {
            val prev = selectedExportUri
            if (prev != null && prev != uri) {
                try { DocumentsContract.deleteDocument(contentResolver, prev) } catch (_: Exception) {}
            }
            selectedExportUri = uri
            val name = queryDisplayName(uri)
            selectedExportDisplayName = name
            val payload = JSONObject().apply {
                put("uri", uri.toString())
                put("displayName", name)
            }.toString()
            evalJs("window.__mfNative && window.__mfNative.onExportLocationPicked && window.__mfNative.onExportLocationPicked($payload);")
        }
    }

    private val saveExportedAsLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("video/mp4")
    ) { uri ->
        val srcPath = pendingInternalSavePath
        pendingInternalSavePath = null
        if (uri == null || srcPath.isNullOrBlank()) return@registerForActivityResult
        ioScope.launch(Dispatchers.IO) {
            var ok = false
            var errMsg = ""
            try {
                val srcFile = File(srcPath)
                if (srcFile.exists()) {
                    contentResolver.openOutputStream(uri, "wt")?.use { out ->
                        FileInputStream(srcFile).use { inp -> inp.copyTo(out) }
                    }
                    ok = true
                } else {
                    errMsg = "Exported file missing"
                }
            } catch (e: Exception) {
                errMsg = e.message ?: "Save failed"
            }
            val displayName = queryDisplayName(uri)
            val payload = JSONObject().apply {
                put("ok", ok)
                put("uri", uri.toString())
                put("displayName", displayName)
                put("error", errMsg)
            }.toString()
            withContext(Dispatchers.Main) {
                evalJs("window.__mfNative && window.__mfNative.onExportSavedToLocation && window.__mfNative.onExportSavedToLocation($payload);")
            }
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        var result = ""
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) result = cursor.getString(idx) ?: ""
                }
            }
        } catch (_: Exception) {}
        return result.ifBlank { uri.lastPathSegment?.substringAfterLast('/') ?: "MotionFlow_Export.mp4" }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        super.onCreate(savedInstanceState)

        storageHelper = MediaStorageHelper(applicationContext)
        mp4Exporter = NativeMp4Exporter(applicationContext, storageHelper.exportsDir)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView?.evaluateJavascript(
                    "(function(){ return window.__mfNative && window.__mfNative.handleBack ? window.__mfNative.handleBack() : false; })()"
                ) { handled ->
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        setContent {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(ComposeColor(0xFF0B0E14))
                    .windowInsetsPadding(WindowInsets.safeDrawing)
            ) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            setBackgroundColor(Color.parseColor("#0B0E14"))
                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                databaseEnabled = true
                                mediaPlaybackRequiresUserGesture = false
                                allowFileAccess = false
                                allowContentAccess = false
                                builtInZoomControls = false
                                displayZoomControls = false
                                useWideViewPort = true
                                loadWithOverviewMode = true
                                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            }
                            addJavascriptInterface(MotionFlowBridge(), "AndroidBridge")

                            webViewClient = object : WebViewClient() {
                                override fun shouldInterceptRequest(
                                    view: WebView?,
                                    request: WebResourceRequest?
                                ): WebResourceResponse? {
                                    if (request == null) return null
                                    return storageHelper.interceptRequest(request)
                                }

                                override fun shouldOverrideUrlLoading(
                                    view: WebView?,
                                    request: WebResourceRequest?
                                ): Boolean {
                                    val host = request?.url?.host ?: return false
                                    return host != MediaStorageHelper.APP_HOST
                                }
                            }

                            webChromeClient = object : WebChromeClient() {
                                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                                    return super.onConsoleMessage(consoleMessage)
                                }
                            }

                            webView = this
                            loadUrl(MediaStorageHelper.BASE_URL)
                        }
                    }
                )
            }
        }
    }

    private fun importPickedUris(uris: List<Uri>, forcedCategory: String?) {
        evalJs("window.__mfNative && window.__mfNative.onMediaImportStarted(${uris.size});")
        ioScope.launch {
            val importedArray = withContext(Dispatchers.IO) {
                val arr = JSONArray()
                for (uri in uris) {
                    storageHelper.importUri(uri, forcedCategory)?.let { arr.put(it) }
                }
                arr
            }
            val jsonLiteral = importedArray.toString()
            evalJs("window.__mfNative && window.__mfNative.onMediaImported($jsonLiteral);")
        }
    }

    private fun evalJs(script: String) {
        runOnUiThread {
            webView?.evaluateJavascript(script, null)
        }
    }

    private fun beginVoiceoverRecording() {
        if (!isRecordingVoiceover.compareAndSet(false, true)) return
        evalJs("window.__mfNative && window.__mfNative.onVoiceoverState && window.__mfNative.onVoiceoverState('recording', 'Recording voiceover...');")
        voiceoverJob = ioScope.launch(Dispatchers.IO) {
            val id = UUID.randomUUID().toString().replace("-", "").take(12)
            val fileName = "vo_${id}.wav"
            val outFile = File(storageHelper.mediaDir, fileName)
            val sampleRate = 44100
            val channelConfig = AudioFormat.CHANNEL_IN_MONO
            val encoding = AudioFormat.ENCODING_PCM_16BIT
            val minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, encoding).coerceAtLeast(4096)
            var recorder: AudioRecord? = null
            var dataBytes = 0L

            try {
                @SuppressLint("MissingPermission")
                val rec = AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, channelConfig, encoding, minBuf * 2)
                if (rec.state != AudioRecord.STATE_INITIALIZED) {
                    rec.release()
                    throw IllegalStateException("Microphone AudioRecord initialization failed")
                }
                recorder = rec
                RandomAccessFile(outFile, "rw").use { raf ->
                    raf.setLength(0)
                    raf.write(ByteArray(44)) // reserve WAV header
                    val buf = ByteArray(minBuf)
                    rec.startRecording()
                    while (isRecordingVoiceover.get()) {
                        val read = rec.read(buf, 0, buf.size)
                        if (read > 0) {
                            raf.write(buf, 0, read)
                            dataBytes += read
                        }
                    }
                    try { rec.stop() } catch (_: Exception) {}
                    writeWavHeader(raf, dataBytes, sampleRate, 1, 16)
                }

                if (dataBytes > 0L) {
                    val durationMs = ((dataBytes * 1000L) / (sampleRate * 2L)).coerceAtLeast(300L)
                    val item = JSONObject().apply {
                        put("id", id)
                        put("name", "Voiceover_${id.take(4)}.wav")
                        put("type", "audio")
                        put("mimeType", "audio/wav")
                        put("fileName", fileName)
                        put("url", "https://${MediaStorageHelper.APP_HOST}/media/$fileName")
                        put("thumbUrl", "")
                        put("width", 0)
                        put("height", 0)
                        put("durationMs", durationMs)
                        put("sizeBytes", outFile.length())
                        put("isGif", false)
                    }
                    val arrLiteral = JSONArray().put(item).toString()
                    evalJs("window.__mfNative && window.__mfNative.onVoiceoverState && window.__mfNative.onVoiceoverState('stopped', 'Voiceover saved');")
                    evalJs("window.__mfNative && window.__mfNative.onMediaImported($arrLiteral);")
                } else {
                    outFile.delete()
                    evalJs("window.__mfNative && window.__mfNative.onVoiceoverState && window.__mfNative.onVoiceoverState('error', 'No audio captured');")
                }
            } catch (e: Exception) {
                outFile.delete()
                val msg = JSONObject.quote(e.message ?: "Voiceover failed")
                evalJs("window.__mfNative && window.__mfNative.onVoiceoverState && window.__mfNative.onVoiceoverState('error', $msg);")
            } finally {
                isRecordingVoiceover.set(false)
                try { recorder?.release() } catch (_: Exception) {}
            }
        }
    }

    private fun writeWavHeader(raf: RandomAccessFile, dataLen: Long, sampleRate: Int, channels: Int, bitsPerSample: Int) {
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt((36L + dataLen).toInt())
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)
        header.putShort(1.toShort())
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign.toShort())
        header.putShort(bitsPerSample.toShort())
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataLen.toInt())
        raf.seek(0)
        raf.write(header.array())
    }

    private fun ensureTtsInitialized(onReady: (Boolean) -> Unit) {
        val existing = textToSpeech
        if (existing != null && ttsReady) {
            onReady(true)
            return
        }
        try {
            existing?.shutdown()
        } catch (_: Exception) {}
        ttsReady = false
        var completed = false
        textToSpeech = TextToSpeech(applicationContext) { status ->
            if (completed) return@TextToSpeech
            completed = true
            ttsReady = status == TextToSpeech.SUCCESS
            onReady(ttsReady)
        }
    }

    private fun synthesizeTextToWav(text: String, voiceStyle: String) {
        val cleanText = text.trim()
        if (cleanText.isEmpty()) {
            evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'Text is empty');")
            return
        }
        evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('busy', 'Synthesizing voice...');")
        ensureTtsInitialized { ok ->
            val tts = textToSpeech
            if (!ok || tts == null) {
                evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'Android TTS engine unavailable');")
                return@ensureTtsInitialized
            }
            val id = UUID.randomUUID().toString().replace("-", "").take(12)
            val fileName = "tts_${id}.wav"
            val outFile = File(storageHelper.mediaDir, fileName)

            when (voiceStyle) {
                "deep" -> { tts.setPitch(0.72f); tts.setSpeechRate(0.92f) }
                "high" -> { tts.setPitch(1.42f); tts.setSpeechRate(1.06f) }
                "fast" -> { tts.setPitch(1.04f); tts.setSpeechRate(1.38f) }
                "calm" -> { tts.setPitch(0.94f); tts.setSpeechRate(0.84f) }
                else -> { tts.setPitch(1.0f); tts.setSpeechRate(1.0f) }
            }

            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    if (utteranceId != id) return
                    ioScope.launch(Dispatchers.IO) {
                        var durMs = 2000L
                        val mmr = MediaMetadataRetriever()
                        try {
                            mmr.setDataSource(outFile.absolutePath)
                            durMs = (mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 2000L).coerceAtLeast(300L)
                        } catch (_: Exception) {
                        } finally {
                            try { mmr.release() } catch (_: Exception) {}
                        }
                        if (outFile.exists() && outFile.length() > 44L) {
                            val item = JSONObject().apply {
                                put("id", id)
                                put("name", "TTS_${cleanText.take(12).replace(Regex("[^a-zA-Z0-9_-]"), "_")}.wav")
                                put("type", "audio")
                                put("mimeType", "audio/wav")
                                put("fileName", fileName)
                                put("url", "https://${MediaStorageHelper.APP_HOST}/media/$fileName")
                                put("thumbUrl", "")
                                put("width", 0)
                                put("height", 0)
                                put("durationMs", durMs)
                                put("sizeBytes", outFile.length())
                                put("isGif", false)
                            }
                            val arrLiteral = JSONArray().put(item).toString()
                            evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('done', 'TTS voice added');")
                            evalJs("window.__mfNative && window.__mfNative.onMediaImported($arrLiteral);")
                        } else {
                            outFile.delete()
                            evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'TTS file empty');")
                        }
                    }
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    if (utteranceId == id) {
                        outFile.delete()
                        evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'TTS synthesis failed');")
                    }
                }
                override fun onError(utteranceId: String?, errorCode: Int) {
                    if (utteranceId == id) {
                        outFile.delete()
                        evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'TTS synthesis error $errorCode');")
                    }
                }
            })

            val params = Bundle()
            val res = tts.synthesizeToFile(cleanText, params, outFile, id)
            if (res != TextToSpeech.SUCCESS) {
                outFile.delete()
                evalJs("window.__mfNative && window.__mfNative.onTtsState && window.__mfNative.onTtsState('error', 'TTS engine rejected request');")
            }
        }
    }

    override fun onDestroy() {
        isRecordingVoiceover.set(false)
        voiceoverJob?.cancel()
        try { textToSpeech?.stop(); textToSpeech?.shutdown() } catch (_: Exception) {}
        textToSpeech = null
        ioScope.cancel()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    inner class MotionFlowBridge {

        @JavascriptInterface
        fun isAndroidNative(): Boolean = true

        @JavascriptInterface
        fun pickVisualMedia(mode: String) {
            runOnUiThread {
                val mediaType = when (mode) {
                    "video" -> ActivityResultContracts.PickVisualMedia.VideoOnly
                    "image" -> ActivityResultContracts.PickVisualMedia.ImageOnly
                    else -> ActivityResultContracts.PickVisualMedia.ImageAndVideo
                }
                pickVisualMediaLauncher.launch(PickVisualMediaRequest(mediaType))
            }
        }

        @JavascriptInterface
        fun pickAudioMedia() {
            runOnUiThread {
                pickAudioLauncher.launch(arrayOf("audio/*"))
            }
        }

        @JavascriptInterface
        fun pickFontFile() {
            runOnUiThread {
                pickFontLauncher.launch(arrayOf("font/*", "application/x-font-ttf", "application/font-sfnt", "application/octet-stream"))
            }
        }

        @JavascriptInterface
        fun deleteMediaFile(fileName: String) {
            ioScope.launch(Dispatchers.IO) {
                storageHelper.deleteMediaFile(fileName)
            }
        }

        @JavascriptInterface
        fun startVoiceover() {
            runOnUiThread {
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    beginVoiceoverRecording()
                } else {
                    requestMicPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }

        @JavascriptInterface
        fun stopVoiceover() {
            isRecordingVoiceover.set(false)
        }

        @JavascriptInterface
        fun synthesizeTts(text: String, voiceStyle: String) {
            runOnUiThread {
                synthesizeTextToWav(text, voiceStyle)
            }
        }

        @JavascriptInterface
        fun importProjectJson() {
            runOnUiThread {
                openProjectJsonLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
            }
        }

        @JavascriptInterface
        fun exportProjectJson(fileName: String, jsonContent: String) {
            runOnUiThread {
                pendingJsonToExport = jsonContent
                val safeName = if (fileName.endsWith(".json")) fileName else "$fileName.mfproj.json"
                createProjectJsonLauncher.launch(safeName)
            }
        }

        @JavascriptInterface
        fun getExportCapabilities(): String {
            return mp4Exporter.getMaxSupportedResolution().toString()
        }

        @JavascriptInterface
        fun pickExportLocation(suggestedName: String) {
            runOnUiThread {
                val safeName = if (suggestedName.endsWith(".mp4", ignoreCase = true)) {
                    suggestedName
                } else {
                    "${suggestedName.ifBlank { "MotionFlow_Export" }}.mp4"
                }
                pickExportLocationLauncher.launch(safeName)
            }
        }

        @JavascriptInterface
        fun clearExportLocation() {
            val prev = selectedExportUri
            selectedExportUri = null
            selectedExportDisplayName = ""
            if (prev != null) {
                ioScope.launch(Dispatchers.IO) {
                    try { DocumentsContract.deleteDocument(contentResolver, prev) } catch (_: Exception) {}
                }
            }
        }

        @JavascriptInterface
        fun saveExportToLocation(internalPath: String, suggestedName: String) {
            runOnUiThread {
                pendingInternalSavePath = internalPath
                val safeName = if (suggestedName.endsWith(".mp4", ignoreCase = true)) {
                    suggestedName
                } else {
                    "${suggestedName.ifBlank { "MotionFlow_Export" }}.mp4"
                }
                saveExportedAsLauncher.launch(safeName)
            }
        }

        @JavascriptInterface
        fun startVideoExport(configJson: String): String {
            return try {
                val cfg = JSONObject(configJson)
                val customUriStr = cfg.optString("customUri", "")
                val targetUri = if (customUriStr.isNotBlank()) Uri.parse(customUriStr) else null
                if (targetUri == null) {
                    selectedExportUri = null
                    selectedExportDisplayName = ""
                }
                mp4Exporter.begin(
                    reqWidth = cfg.optInt("width", 1280),
                    reqHeight = cfg.optInt("height", 720),
                    reqFps = cfg.optInt("fps", 30),
                    bitrateMbps = cfg.optInt("bitrateMbps", 8),
                    totalFrames = cfg.optInt("totalFrames", 150),
                    includeAudio = cfg.optBoolean("includeAudio", false),
                    fileName = cfg.optString("fileName", "MotionFlow_Export.mp4"),
                    customUri = targetUri
                )
                JSONObject().put("ok", true).toString()
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "Export init failed").toString()
            }
        }

        @JavascriptInterface
        fun pushExportFrame(frameIndex: Int, base64Png: String): String {
            return try {
                mp4Exporter.pushFrameBase64(frameIndex, base64Png)
                JSONObject().put("ok", true).toString()
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "Frame encode failed").toString()
            }
        }

        @JavascriptInterface
        fun pushExportAudioPcm(base64Pcm: String): String {
            return try {
                mp4Exporter.pushAudioPcmBase64(base64Pcm)
                JSONObject().put("ok", true).toString()
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "Audio encode failed").toString()
            }
        }

        @JavascriptInterface
        fun finishVideoExport(): String {
            return try {
                val res = mp4Exporter.finish()
                JSONObject().put("ok", true).put("result", res).toString()
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "Export finalize failed").toString()
            }
        }

        @JavascriptInterface
        fun cancelVideoExport() {
            mp4Exporter.cancel()
        }

        @JavascriptInterface
        fun shareExportedFile(internalPath: String) {
            runOnUiThread {
                try {
                    val file = File(internalPath)
                    if (!file.exists()) return@runOnUiThread
                    val uri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        file
                    )
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "video/mp4"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(intent, "Share Exported Video"))
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun openExportedFile(internalPath: String) {
            runOnUiThread {
                try {
                    val file = File(internalPath)
                    if (!file.exists()) return@runOnUiThread
                    val uri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        file
                    )
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "video/mp4")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(intent)
                } catch (_: Exception) {}
            }
        }
    }
}
