package com.cardlens

import android.content.Context
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages model files and character dictionaries for on-device PaddleOCR inference.
 *
 * Supported locations:
 *  1. Bundled assets: `assets/paddleocr/{det.onnx, rec.onnx, keys.txt}`
 *  2. Downloaded sandbox: `<filesDir>/paddleocr/{det.onnx, rec.onnx, keys.txt}`
 */
object PaddleOcrModelManager {

    // Default public mirrors for lightweight, high-performance PP-OCR mobile models (ONNX format)
    const val DEFAULT_DET_MODEL_URL = "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx"
    const val DEFAULT_REC_MODEL_URL = "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx"
    const val DEFAULT_KEYS_URL = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.8/ppocr/utils/ppocr_keys_v1.txt"

    const val DET_FILENAME = "det.onnx"
    const val REC_FILENAME = "rec.onnx"
    const val KEYS_FILENAME = "keys.txt"

    fun getPaddleDir(context: Context): File {
        val dir = File(context.filesDir, "paddleocr")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /**
     * Checks if all required models (detection, recognition, keys) exist either in assets or sandbox.
     */
    fun isReady(context: Context): Boolean {
        return getDetModelFile(context) != null &&
               getRecModelFile(context) != null &&
               getKeysReader(context) != null
    }

    fun getDetModelFile(context: Context): File? {
        val local = File(getPaddleDir(context), DET_FILENAME)
        if (local.exists() && local.length() > 500 * 1024) return local

        // Check assets and copy to cache if present
        if (assetExists(context, "paddleocr/$DET_FILENAME")) {
            return copyAssetToSandbox(context, "paddleocr/$DET_FILENAME", local)
        }
        return null
    }

    fun getRecModelFile(context: Context): File? {
        val local = File(getPaddleDir(context), REC_FILENAME)
        if (local.exists() && local.length() > 1024 * 1024) return local

        if (assetExists(context, "paddleocr/$REC_FILENAME")) {
            return copyAssetToSandbox(context, "paddleocr/$REC_FILENAME", local)
        }
        return null
    }

    fun getKeysReader(context: Context): BufferedReader? {
        val local = File(getPaddleDir(context), KEYS_FILENAME)
        if (local.exists() && local.length() > 100) {
            return local.bufferedReader()
        }

        return try {
            val stream = context.assets.open("paddleocr/$KEYS_FILENAME")
            BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Loads the character dictionary for CTC decoding.
     * Index 0 is reserved for 'blank' in CTC greedy decoding.
     */
    fun loadDictionary(context: Context): List<String> {
        val dict = mutableListOf<String>()
        dict.add("blank") // CTC blank token at index 0

        val reader = getKeysReader(context) ?: return dict
        reader.useLines { lines ->
            lines.forEach { line ->
                val trimmed = line.trimEnd('\r', '\n')
                if (trimmed.isNotEmpty()) {
                    dict.add(trimmed)
                }
            }
        }
        dict.add(" ") // Append space token
        return dict
    }

    /**
     * Downloads an on-device model file with streaming progress and redirect handling.
     */
    fun downloadFile(
        urlStr: String,
        destFile: File,
        authToken: String? = null,
        onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit
    ) {
        if (destFile.exists() && destFile.length() > 1024) {
            onProgress(destFile.length(), destFile.length())
            return
        }

        var currentUrl = urlStr
        var conn: HttpURLConnection? = null
        var redirectCount = 0

        while (true) {
            val url = URL(currentUrl)
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 30000
            connection.readTimeout = 120000
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = true
            if (!authToken.isNullOrBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $authToken")
            }
            connection.connect()

            val responseCode = connection.responseCode
            if (responseCode in 300..399) {
                val newUrl = connection.getHeaderField("Location")
                connection.disconnect()
                if (!newUrl.isNullOrBlank() && redirectCount < 8) {
                    currentUrl = newUrl
                    redirectCount++
                    continue
                }
            }

            if (responseCode !in 200..299) {
                throw java.io.IOException("HTTP error $responseCode: ${connection.responseMessage} for $currentUrl")
            }

            conn = connection
            break
        }

        val activeConn = conn ?: throw java.io.IOException("Failed to establish connection for $urlStr")
        val totalLength = activeConn.contentLengthLong
        val tempFile = File(destFile.parentFile, "${destFile.name}.tmp")

        activeConn.inputStream.use { input ->
            FileOutputStream(tempFile).use { output ->
                val buffer = ByteArray(32768)
                var bytesRead: Int
                var totalBytesRead = 0L
                var lastProgressUpdate = 0L

                while (input.read(buffer).also { bytesRead = it } != -1) {
                    output.write(buffer, 0, bytesRead)
                    totalBytesRead += bytesRead

                    val now = System.currentTimeMillis()
                    if (now - lastProgressUpdate > 150 || totalBytesRead == totalLength) {
                        lastProgressUpdate = now
                        onProgress(totalBytesRead, totalLength)
                    }
                }
            }
        }

        if (destFile.exists()) destFile.delete()
        if (!tempFile.renameTo(destFile)) {
            throw java.io.IOException("Failed to save downloaded model to ${destFile.name}")
        }
    }

    private fun assetExists(context: Context, path: String): Boolean {
        return try {
            context.assets.open(path).close()
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun copyAssetToSandbox(context: Context, assetPath: String, destFile: File): File? {
        return try {
            context.assets.open(assetPath).use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            }
            destFile
        } catch (_: Exception) {
            null
        }
    }
}
