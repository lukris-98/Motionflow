package com.example

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID

class MediaStorageHelper(private val context: Context) {

    val mediaDir: File = File(context.filesDir, "media").apply { mkdirs() }
    val exportsDir: File = File(context.filesDir, "exports").apply { mkdirs() }
    val fontsDir: File = File(context.filesDir, "fonts").apply { mkdirs() }

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val BASE_URL = "https://$APP_HOST/index.html"
    }

    fun importUri(uri: Uri, forcedCategory: String? = null): JSONObject? {
        val resolver = context.contentResolver
        val rawMime = resolver.getType(uri) ?: "application/octet-stream"
        var displayName = "media_${System.currentTimeMillis()}"
        var fileSize = 0L

        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0) {
                        cursor.getString(nameIdx)?.let { displayName = it }
                    }
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        fileSize = cursor.getLong(sizeIdx)
                    }
                }
            }

        val id = UUID.randomUUID().toString().replace("-", "").take(12)
        val extFromName = displayName.substringAfterLast('.', "").lowercase()
        val extFromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(rawMime)?.lowercase()
        val ext = when {
            extFromName.isNotEmpty() && extFromName.length <= 5 -> extFromName
            !extFromMime.isNullOrEmpty() -> extFromMime
            rawMime.startsWith("video/") -> "mp4"
            rawMime.startsWith("audio/") -> "mp3"
            else -> "png"
        }

        val mediaCategory = when {
            forcedCategory != null -> forcedCategory
            rawMime.startsWith("video/") || ext in setOf("mp4", "mov", "webm", "mkv", "3gp") -> "video"
            rawMime.startsWith("audio/") || ext in setOf("mp3", "wav", "aac", "m4a", "ogg", "flac") -> "audio"
            else -> "image"
        }

        val targetFileName = "${id}.${ext}"
        val targetFile = File(mediaDir, targetFileName)

        resolver.openInputStream(uri)?.use { input ->
            FileOutputStream(targetFile).use { output ->
                input.copyTo(output, bufferSize = 32 * 1024)
            }
        } ?: return null

        if (fileSize <= 0L) {
            fileSize = targetFile.length()
        }

        var width = 0
        var height = 0
        var durationMs = 0L
        var thumbUrl = ""

        if (mediaCategory == "video") {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(targetFile.absolutePath)
                width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 1280
                height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 720
                val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                if (rot == 90 || rot == 270) {
                    val tmp = width
                    width = height
                    height = tmp
                }
                durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 3000L

                val frameBitmap = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                if (frameBitmap != null) {
                    val thumbName = "thumb_${id}.jpg"
                    val thumbFile = File(mediaDir, thumbName)
                    saveScaledThumbnail(frameBitmap, thumbFile)
                    frameBitmap.recycle()
                    thumbUrl = "https://$APP_HOST/media/$thumbName"
                }
            } catch (_: Exception) {
                width = 1280
                height = 720
                durationMs = 5000L
            } finally {
                try {
                    retriever.release()
                } catch (_: Exception) {}
            }
        } else if (mediaCategory == "audio") {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(targetFile.absolutePath)
                durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 5000L
            } catch (_: Exception) {
                durationMs = 5000L
            } finally {
                try {
                    retriever.release()
                } catch (_: Exception) {}
            }
        } else {
            // Image or GIF
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(targetFile.absolutePath, opts)
            width = opts.outWidth.coerceAtLeast(1)
            height = opts.outHeight.coerceAtLeast(1)

            val exifRot = try {
                val exif = ExifInterface(targetFile.absolutePath)
                when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } catch (_: Exception) { 0f }

            if (exifRot == 90f || exifRot == 270f) {
                val tmp = width
                width = height
                height = tmp
            }

            val sampleOpts = BitmapFactory.Options().apply {
                inSampleSize = calculateInSampleSize(opts.outWidth.coerceAtLeast(1), opts.outHeight.coerceAtLeast(1), 320, 320)
            }
            BitmapFactory.decodeFile(targetFile.absolutePath, sampleOpts)?.let { rawBmp ->
                val bmp = if (exifRot != 0f) {
                    val m = Matrix().apply { postRotate(exifRot) }
                    Bitmap.createBitmap(rawBmp, 0, 0, rawBmp.width, rawBmp.height, m, true).also {
                        if (it !== rawBmp) rawBmp.recycle()
                    }
                } else rawBmp
                val thumbName = "thumb_${id}.jpg"
                val thumbFile = File(mediaDir, thumbName)
                saveScaledThumbnail(bmp, thumbFile)
                bmp.recycle()
                thumbUrl = "https://$APP_HOST/media/$thumbName"
            }
            durationMs = 5000L
        }

        val mediaUrl = "https://$APP_HOST/media/$targetFileName"
        return JSONObject().apply {
            put("id", id)
            put("name", displayName)
            put("type", mediaCategory)
            put("mimeType", rawMime)
            put("fileName", targetFileName)
            put("url", mediaUrl)
            put("thumbUrl", thumbUrl)
            put("width", width)
            put("height", height)
            put("durationMs", durationMs)
            put("sizeBytes", fileSize)
            put("isGif", ext == "gif" || rawMime == "image/gif")
        }
    }

    private fun saveScaledThumbnail(src: Bitmap, outFile: File) {
        val maxDim = 320
        val scale = minOf(maxDim.toFloat() / src.width, maxDim.toFloat() / src.height, 1f)
        val targetW = (src.width * scale).toInt().coerceAtLeast(1)
        val targetH = (src.height * scale).toInt().coerceAtLeast(1)
        val scaled = if (targetW != src.width || targetH != src.height) {
            Bitmap.createScaledBitmap(src, targetW, targetH, true)
        } else {
            src
        }
        FileOutputStream(outFile).use { fos ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, fos)
        }
        if (scaled !== src) scaled.recycle()
    }

    private fun calculateInSampleSize(w: Int, h: Int, reqW: Int, reqH: Int): Int {
        var inSampleSize = 1
        if (h > reqH || w > reqW) {
            val halfH = h / 2
            val halfW = w / 2
            while ((halfH / inSampleSize) >= reqH && (halfW / inSampleSize) >= reqW) {
                inSampleSize *= 2
            }
        }
        return inSampleSize
    }

    fun deleteMediaFile(fileName: String) {
        val safeName = File(fileName).name
        File(mediaDir, safeName).delete()
        val id = safeName.substringBeforeLast('.')
        File(mediaDir, "thumb_${id}.jpg").delete()
    }

    private fun dirSize(dir: File?): Long {
        if (dir == null || !dir.exists()) return 0L
        var total = 0L
        val children = dir.listFiles() ?: return 0L
        for (f in children) {
            total += if (f.isDirectory) dirSize(f) else f.length()
        }
        return total
    }

    private fun deleteDirContents(dir: File?, skipRootNames: Set<String> = emptySet()): Pair<Int, Long> {
        if (dir == null || !dir.exists() || !dir.isDirectory) return 0 to 0L
        var count = 0
        var bytes = 0L
        val children = dir.listFiles() ?: return 0 to 0L
        for (f in children) {
            if (skipRootNames.contains(f.name)) continue
            if (f.isDirectory) {
                val (c, b) = deleteDirContents(f)
                count += c
                bytes += b
                try {
                    if (f.listFiles()?.isEmpty() == true) f.delete()
                } catch (_: Exception) {}
            } else {
                val len = f.length()
                try {
                    if (f.delete()) {
                        count++
                        bytes += len
                    }
                } catch (_: Exception) {}
            }
        }
        return count to bytes
    }

    fun getStorageStatsJson(): JSONObject {
        var mediaCount = 0
        var mediaBytes = 0L
        mediaDir.listFiles()?.forEach { f ->
            if (f.isFile) {
                if (!f.name.startsWith("thumb_")) mediaCount++
                mediaBytes += f.length()
            }
        }
        var exportCount = 0
        var exportBytes = 0L
        exportsDir.listFiles()?.forEach { f ->
            if (f.isFile) {
                exportCount++
                exportBytes += f.length()
            }
        }
        val appCacheBytes = dirSize(context.cacheDir) + dirSize(context.codeCacheDir)
        return JSONObject().apply {
            put("mediaCount", mediaCount)
            put("mediaBytes", mediaBytes)
            put("exportCount", exportCount)
            put("exportBytes", exportBytes)
            put("appCacheBytes", appCacheBytes)
            put("cacheBytes", exportBytes + appCacheBytes)
            put("totalBytes", mediaBytes + exportBytes + appCacheBytes)
        }
    }

    fun clearTempCache(usedFileNames: Set<String>?, cleanOrphanMedia: Boolean): JSONObject {
        var deletedCount = 0
        var freedBytes = 0L

        val (cacheDel, cacheBytes) = deleteDirContents(context.cacheDir, setOf("WebView"))
        deletedCount += cacheDel
        freedBytes += cacheBytes

        val (codeDel, codeBytes) = deleteDirContents(context.codeCacheDir)
        deletedCount += codeDel
        freedBytes += codeBytes

        val now = System.currentTimeMillis()
        exportsDir.listFiles()?.forEach { f ->
            if (f.isFile && (now - f.lastModified() > 15_000L)) {
                val len = f.length()
                if (f.delete()) {
                    deletedCount++
                    freedBytes += len
                }
            }
        }

        if (cleanOrphanMedia && usedFileNames != null) {
            val orphanRes = cleanupUnusedFiles(usedFileNames)
            deletedCount += orphanRes.optInt("deletedCount", 0)
            freedBytes += orphanRes.optLong("freedBytes", 0L)
        }

        return JSONObject().apply {
            put("deletedCount", deletedCount)
            put("freedBytes", freedBytes)
        }
    }

    fun cleanupUnusedFiles(usedFileNames: Set<String>): JSONObject {
        val keptIds = usedFileNames.mapTo(HashSet()) { File(it).name.substringBeforeLast('.') }
        var deletedCount = 0
        var freedBytes = 0L

        mediaDir.listFiles()?.forEach { f ->
            if (!f.isFile) return@forEach
            val name = f.name
            val keep = if (name.startsWith("thumb_") && name.endsWith(".jpg")) {
                val thumbId = name.removePrefix("thumb_").removeSuffix(".jpg")
                keptIds.contains(thumbId)
            } else {
                usedFileNames.contains(name)
            }
            if (!keep) {
                val len = f.length()
                if (f.delete()) {
                    deletedCount++
                    freedBytes += len
                }
            }
        }

        val now = System.currentTimeMillis()
        exportsDir.listFiles()?.forEach { f ->
            if (f.isFile && (now - f.lastModified() > 120_000L)) {
                val len = f.length()
                if (f.delete()) {
                    deletedCount++
                    freedBytes += len
                }
            }
        }

        return JSONObject().apply {
            put("deletedCount", deletedCount)
            put("freedBytes", freedBytes)
        }
    }

    fun importFontUri(uri: Uri): JSONObject? {
        val resolver = context.contentResolver
        var displayName = "CustomFont_${System.currentTimeMillis()}.ttf"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) cursor.getString(idx)?.let { displayName = it }
            }
        }
        val ext = displayName.substringAfterLast('.', "ttf").lowercase()
        val safeExt = if (ext in setOf("ttf", "otf", "woff", "woff2")) ext else "ttf"
        val id = UUID.randomUUID().toString().replace("-", "").take(10)
        val fileName = "${id}.${safeExt}"
        val outFile = File(fontsDir, fileName)
        resolver.openInputStream(uri)?.use { inp ->
            FileOutputStream(outFile).use { out -> inp.copyTo(out) }
        } ?: return null

        val familyName = displayName.substringBeforeLast('.').replace(Regex("[^a-zA-Z0-9 _-]"), "").trim()
            .ifEmpty { "Font_$id" }
        return JSONObject().apply {
            put("id", id)
            put("name", familyName)
            put("fileName", fileName)
            put("url", "https://$APP_HOST/userfonts/$fileName")
        }
    }

    fun interceptRequest(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url ?: return null
        if (url.host != APP_HOST) return null
        val path = (url.path ?: "/").trimStart('/')

        if (path.startsWith("media/")) {
            val fileName = path.removePrefix("media/").substringBefore('?')
            val file = File(mediaDir, File(fileName).name)
            if (file.exists() && file.isFile) {
                return serveFileWithRange(file, request.requestHeaders, "public, max-age=3600")
            }
            return notFoundResponse()
        }

        if (path.startsWith("userfonts/")) {
            val fileName = path.removePrefix("userfonts/").substringBefore('?')
            val file = File(fontsDir, File(fileName).name)
            if (file.exists() && file.isFile) {
                return serveFileWithRange(file, request.requestHeaders, "public, max-age=3600")
            }
            return notFoundResponse()
        }

        if (path.startsWith("exports/")) {
            val fileName = path.removePrefix("exports/").substringBefore('?')
            val file = File(exportsDir, File(fileName).name)
            if (file.exists() && file.isFile) {
                return serveFileWithRange(file, request.requestHeaders, "no-cache")
            }
            return notFoundResponse()
        }

        if (path == "img/filter_landscape" || path == "img/filter_landscape.jpg") {
            return try {
                val headers = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "max-age=86400"
                )
                WebResourceResponse(
                    "image/jpeg",
                    null,
                    200,
                    "OK",
                    headers,
                    context.resources.openRawResource(R.drawable.img_filter_landscape)
                )
            } catch (_: Exception) {
                notFoundResponse()
            }
        }

        val assetPath = if (path.isEmpty()) "www/index.html" else "www/$path"
        return try {
            val stream = BufferedInputStream(context.assets.open(assetPath), 16 * 1024)
            val mime = guessMimeType(assetPath)
            val isStaticImmutable = !assetPath.endsWith(".html", ignoreCase = true)
            val cacheHeader = if (isStaticImmutable) "public, max-age=86400" else "no-cache"
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to cacheHeader
            )
            WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream)
        } catch (_: Exception) {
            null
        }
    }

    private fun serveFileWithRange(
        file: File,
        requestHeaders: Map<String, String>,
        cacheControl: String = "public, max-age=3600"
    ): WebResourceResponse {
        val totalSize = file.length()
        val mime = guessMimeType(file.name)
        val rangeHeader = requestHeaders.entries
            .firstOrNull { it.key.equals("Range", ignoreCase = true) }
            ?.value

        if (rangeHeader != null && rangeHeader.startsWith("bytes=") && totalSize > 0) {
            val rangeSpec = rangeHeader.removePrefix("bytes=").split(',')[0].trim()
            val parts = rangeSpec.split('-')
            val startRaw = parts.getOrNull(0)?.trim()?.toLongOrNull()
            val endRaw = parts.getOrNull(1)?.trim()?.toLongOrNull()
            val start: Long
            val end: Long
            if (startRaw == null && endRaw != null) {
                start = (totalSize - endRaw).coerceAtLeast(0L)
                end = totalSize - 1
            } else {
                start = (startRaw ?: 0L).coerceIn(0L, totalSize - 1)
                end = (endRaw ?: (totalSize - 1)).coerceIn(start, totalSize - 1)
            }
            val length = (end - start + 1).coerceAtLeast(0L)

            val fis = FileInputStream(file)
            if (start > 0) {
                var skipped = 0L
                while (skipped < start) {
                    val s = fis.skip(start - skipped)
                    if (s <= 0) break
                    skipped += s
                }
            }
            val bounded = BoundedInputStream(fis, length)
            val headers = mapOf(
                "Accept-Ranges" to "bytes",
                "Content-Range" to "bytes $start-$end/$totalSize",
                "Content-Length" to length.toString(),
                "Cache-Control" to cacheControl,
                "Access-Control-Allow-Origin" to "*"
            )
            return WebResourceResponse(mime, null, 206, "Partial Content", headers, bounded)
        }

        val headers = mapOf(
            "Accept-Ranges" to "bytes",
            "Content-Length" to totalSize.toString(),
            "Cache-Control" to cacheControl,
            "Access-Control-Allow-Origin" to "*"
        )
        return WebResourceResponse(mime, null, 200, "OK", headers, BufferedInputStream(FileInputStream(file), 32 * 1024))
    }

    private fun notFoundResponse(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            emptyMap(),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    private fun guessMimeType(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            "avif" -> "image/avif"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "mov" -> "video/quicktime"
            "mkv" -> "video/x-matroska"
            "3gp" -> "video/3gpp"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "m4a", "aac" -> "audio/mp4"
            "ogg" -> "audio/ogg"
            else -> "application/octet-stream"
        }
    }

    private class BoundedInputStream(
        private val inner: InputStream,
        private var remaining: Long
    ) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0) return -1
            val b = inner.read()
            if (b >= 0) remaining--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            val toRead = minOf(len.toLong(), remaining).toInt()
            val count = inner.read(b, off, toRead)
            if (count > 0) remaining -= count
            return count
        }

        override fun close() {
            inner.close()
        }
    }
}
