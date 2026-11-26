package com.example

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

  @Test
  fun `read string from context`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("MotionFlow Studio", appName)
  }

  @Test
  fun `mediaStorageHelper serves index html and byte range requests`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val helper = MediaStorageHelper(context)

    val indexResp = helper.interceptRequest(fakeRequest("https://${MediaStorageHelper.APP_HOST}/"))
    assertNotNull(indexResp)
    assertEquals("text/html", indexResp!!.mimeType)
    assertEquals(200, indexResp.statusCode)
    val htmlText = indexResp.data.bufferedReader().use { it.readText() }
    assertTrue(htmlText.contains("MotionFlow Studio"))

    val missingResp = helper.interceptRequest(fakeRequest("https://${MediaStorageHelper.APP_HOST}/media/nonexistent.mp4"))
    assertNotNull(missingResp)
    assertEquals(404, missingResp!!.statusCode)

    val sampleMedia = File(helper.mediaDir, "sample_clip.mp4")
    sampleMedia.writeBytes("0123456789ABCDEF".toByteArray())
    val rangeResp = helper.interceptRequest(
      fakeRequest("https://${MediaStorageHelper.APP_HOST}/media/sample_clip.mp4", mapOf("Range" to "bytes=4-9"))
    )
    assertNotNull(rangeResp)
    assertEquals(206, rangeResp!!.statusCode)
    assertEquals("video/mp4", rangeResp.mimeType)
    assertEquals("bytes 4-9/16", rangeResp.responseHeaders["Content-Range"])
    val slice = rangeResp.data.readBytes().decodeToString()
    assertEquals("456789", slice)

    val suffixResp = helper.interceptRequest(
      fakeRequest("https://${MediaStorageHelper.APP_HOST}/media/sample_clip.mp4", mapOf("Range" to "bytes=-4"))
    )
    assertNotNull(suffixResp)
    assertEquals(206, suffixResp!!.statusCode)
    assertEquals("bytes 12-15/16", suffixResp.responseHeaders["Content-Range"])
    assertEquals("CDEF", suffixResp.data.readBytes().decodeToString())
    sampleMedia.delete()
  }

  @Test
  fun `nativeMp4Exporter reports baseline capabilities cleanly`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val exporter = NativeMp4Exporter(context, File(context.filesDir, "exports"))
    val caps = exporter.getMaxSupportedResolution()
    assertTrue(caps.getInt("maxWidth") >= 1920)
    assertTrue(caps.getInt("maxHeight") >= 1080)
  }

  private fun fakeRequest(urlStr: String, headers: Map<String, String> = emptyMap()): WebResourceRequest {
    val parsed = Uri.parse(urlStr)
    return object : WebResourceRequest {
      override fun getUrl(): Uri = parsed
      override fun isForMainFrame(): Boolean = false
      override fun isRedirect(): Boolean = false
      override fun hasGesture(): Boolean = false
      override fun getMethod(): String = "GET"
      override fun getRequestHeaders(): Map<String, String> = headers
    }
  }
}
