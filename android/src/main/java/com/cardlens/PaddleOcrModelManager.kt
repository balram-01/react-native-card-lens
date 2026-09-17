package com.cardlens

import android.content.Context
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages model files and character dictionaries for on-device PaddleOCR inference
 * across multiple script families (Devanagari/Marathi, Latin, Arabic, CJK, Cyrillic, etc.).
 *
 * Supported locations:
 *  1. Bundled assets: `assets/paddleocr/{script}/{rec.onnx, keys.txt}` or `assets/paddleocr/{det.onnx, rec.onnx, keys.txt}`
 *  2. Downloaded sandbox: `<filesDir>/paddleocr/{script}/{rec.onnx, keys.txt}` and `<filesDir>/paddleocr/det.onnx`
 */
object PaddleOcrModelManager {

    // Default universal text detection model (language-agnostic DBNet)
    const val DEFAULT_DET_MODEL_URL = "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx"

    // Backward-compatible fallback URLs
    const val DEFAULT_REC_MODEL_URL = "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/rec.onnx"
    const val DEFAULT_KEYS_URL = "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/dict.txt"

    const val DET_FILENAME = "det.onnx"
    const val REC_FILENAME = "rec.onnx"
    const val KEYS_FILENAME = "keys.txt"

    /**
     * Resolves a language or script string to a normalized script family name.
     */
    fun resolveScriptForLanguage(langOrScript: String?): String {
        if (langOrScript.isNullOrBlank()) return "devanagari"
        return when (langOrScript.trim().lowercase()) {
            "mr", "marathi", "hi", "hindi", "ne", "nepali", "sa", "sanskrit", "kok", "konkani", "bho", "bhojpuri", "mai", "devanagari" -> "devanagari"
            "en", "english", "es", "spanish", "fr", "french", "de", "german", "it", "italian", "pt", "portuguese", "nl", "dutch", "id", "indonesian", "ms", "malay", "tr", "turkish", "vi", "vietnamese", "pl", "polish", "sv", "swedish", "latin" -> "latin"
            "zh", "zh-hans", "zh-hant", "cn", "chinese", "ja", "japanese", "japan", "ch" -> "ch"
            "ko", "korean" -> "korean"
            "ar", "arabic", "fa", "persian", "ur", "urdu" -> "arabic"
            "ru", "russian", "uk", "ukrainian", "be", "belarusian", "bg", "bulgarian", "sr", "serbian", "cyrillic", "eslav" -> "cyrillic"
            "ta", "tamil" -> "tamil"
            "te", "telugu" -> "telugu"
            "th", "thai" -> "thai"
            "el", "greek" -> "greek"
            else -> "devanagari"
        }
    }

    /**
     * Default public recognition ONNX model endpoint for a given script family.
     */
    fun getDefaultRecModelUrl(script: String): String {
        return when (resolveScriptForLanguage(script)) {
            "devanagari" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/rec.onnx"
            "latin" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/rec.onnx"
            "arabic" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/arabic/rec.onnx"
            "cyrillic" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/rec.onnx"
            "korean" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx"
            "tamil" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/tamil/rec.onnx"
            "telugu" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/telugu/rec.onnx"
            "thai" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/rec.onnx"
            "greek" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/greek/rec.onnx"
            "ch" -> "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx"
            else -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/rec.onnx"
        }
    }

    /**
     * Default character dictionary endpoint for a given script family.
     */
    fun getDefaultKeysUrl(script: String): String {
        return when (resolveScriptForLanguage(script)) {
            "devanagari" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/dict.txt"
            "latin" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/dict.txt"
            "arabic" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/arabic/dict.txt"
            "cyrillic" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/dict.txt"
            "korean" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt"
            "tamil" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/tamil/dict.txt"
            "telugu" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/telugu/dict.txt"
            "thai" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/dict.txt"
            "greek" -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/greek/dict.txt"
            "ch" -> "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.8/ppocr/utils/ppocr_keys_v1.txt"
            else -> "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/dict.txt"
        }
    }

    fun getPaddleDir(context: Context, script: String? = null): File {
        val base = File(context.filesDir, "paddleocr")
        val target = if (script.isNullOrBlank()) base else File(base, resolveScriptForLanguage(script))
        if (!target.exists()) target.mkdirs()
        return target
    }

    /**
     * Checks if all required models (universal detector + script recognizer + dictionary) exist.
     */
    fun isReady(context: Context, script: String? = null): Boolean {
        val resolved = resolveScriptForLanguage(script)
        val detReady = getDetModelFile(context) != null
        val recReady = getRecModelFile(context, resolved) != null
        val keysReady = getKeysReader(context, resolved) != null
        return detReady && recReady && keysReady
    }

    /**
     * Finds the first available script that has its recognition model and dictionary installed.
     */
    fun getPrimaryAvailableScript(context: Context): String {
        val candidateScripts = listOf("devanagari", "latin", "ch", "arabic", "cyrillic", "tamil", "telugu")
        for (script in candidateScripts) {
            if (isReady(context, script)) return script
        }
        return "devanagari"
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

    fun getRecModelFile(context: Context, script: String? = null): File? {
        val resolved = resolveScriptForLanguage(script)

        // 1. Script-specific sandbox directory (<filesDir>/paddleocr/<script>/rec.onnx)
        val scriptLocal = File(getPaddleDir(context, resolved), REC_FILENAME)
        if (scriptLocal.exists() && scriptLocal.length() > 1024 * 1024) return scriptLocal

        // 2. Backward-compatible root sandbox (<filesDir>/paddleocr/rec.onnx)
        val rootLocal = File(getPaddleDir(context), REC_FILENAME)
        if (rootLocal.exists() && rootLocal.length() > 1024 * 1024) return rootLocal

        // 3. Script-specific asset (assets/paddleocr/<script>/rec.onnx)
        if (assetExists(context, "paddleocr/$resolved/$REC_FILENAME")) {
            return copyAssetToSandbox(context, "paddleocr/$resolved/$REC_FILENAME", scriptLocal)
        }

        // 4. Root asset (assets/paddleocr/rec.onnx)
        if (assetExists(context, "paddleocr/$REC_FILENAME")) {
            return copyAssetToSandbox(context, "paddleocr/$REC_FILENAME", rootLocal)
        }

        return null
    }

    fun getKeysReader(context: Context, script: String? = null): BufferedReader? {
        val resolved = resolveScriptForLanguage(script)

        // 1. Script-specific sandbox directory
        val scriptLocal = File(getPaddleDir(context, resolved), KEYS_FILENAME)
        if (scriptLocal.exists() && scriptLocal.length() > 50) {
            return scriptLocal.bufferedReader()
        }

        // 2. Root sandbox
        val rootLocal = File(getPaddleDir(context), KEYS_FILENAME)
        if (rootLocal.exists() && rootLocal.length() > 50) {
            return rootLocal.bufferedReader()
        }

        // 3. Script-specific asset
        if (assetExists(context, "paddleocr/$resolved/$KEYS_FILENAME")) {
            return try {
                val stream = context.assets.open("paddleocr/$resolved/$KEYS_FILENAME")
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
            } catch (_: Exception) { null }
        }

        // 4. Root asset
        if (assetExists(context, "paddleocr/$KEYS_FILENAME")) {
            return try {
                val stream = context.assets.open("paddleocr/$KEYS_FILENAME")
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
            } catch (_: Exception) { null }
        }

        return null
    }

    /**
     * Loads the character dictionary for CTC decoding for the requested script.
     * Index 0 is reserved for 'blank' in CTC greedy decoding.
     */
    fun loadDictionary(context: Context, script: String? = null): List<String> {
        val dict = mutableListOf<String>()
        dict.add("blank") // CTC blank token at index 0

        val reader = getKeysReader(context, script) ?: return dict
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
        val parentDir = destFile.parentFile ?: getPaddleDir(destFile.parentFile?.parentFile?.let { null } ?: return)
        if (!parentDir.exists()) parentDir.mkdirs()
        val tempFile = File(parentDir, "${destFile.name}.tmp")

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
            val parent = destFile.parentFile
            if (parent != null && !parent.exists()) parent.mkdirs()
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
