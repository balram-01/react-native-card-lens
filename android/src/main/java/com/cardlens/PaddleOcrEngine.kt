package com.cardlens

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import com.facebook.react.bridge.WritableMap
import java.io.File
import kotlin.math.max

/**
 * Lightweight stub for PaddleOCR.
 *
 * NOTE: The heavy Microsoft ONNX Runtime dependency (~20 MB native .so binaries)
 * has been removed from CardLens to ensure the library is ultra-lightweight and adds
 * 0 MB overhead to production apps. Google ML Kit is the primary, production-grade
 * text recognition engine.
 */
class PaddleOcrEngine(private val context: Context) {

    @Synchronized
    fun isLoaded(script: String? = null): Boolean {
        return false
    }

    @Synchronized
    fun isAnyLoaded(): Boolean {
        return false
    }

    @Synchronized
    fun initSessions(detFile: File? = null, recFile: File? = null, script: String? = null): Boolean {
        return false
    }

    fun process(
        bitmap: Bitmap,
        boxThresh: Float = 0.5f,
        unclipRatio: Float = 1.6f,
        detLimitSideLen: Int = 960,
        script: String? = null
    ): WritableMap {
        throw UnsupportedOperationException(
            "PaddleOCR is disabled to keep CardLens lightweight (~0 MB APK footprint). " +
            "Please use the default Google ML Kit engine ('mlkit')."
        )
    }

    companion object {
        /**
         * Filters out non-text logo hallucinations, decorative emblems, and noise symbols.
         */
        fun isValidTextLine(text: String, confidence: Float, box: Rect, imageW: Int, imageH: Int): Boolean {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return false

            // 1. Must contain at least one genuine letter (Latin, Devanagari, Arabic, Cyrillic, CJK, etc.) or digit
            val hasValidScriptChar = trimmed.any { ch ->
                (ch in '\u0900'..'\u097F') || // Devanagari (Marathi, Hindi, Sanskrit)
                (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9') ||
                (ch in '\u0600'..'\u06FF') || // Arabic
                (ch in '\u0400'..'\u04FF') || // Cyrillic
                (ch in '\u4E00'..'\u9FFF') || // CJK
                (ch in '\u0B80'..'\u0BFF') || // Tamil
                (ch in '\u0C00'..'\u0C7F')    // Telugu
            }
            if (!hasValidScriptChar) return false

            // 2. Reject single isolated punctuation or symbol noise
            if (trimmed.length == 1 && !trimmed[0].isLetterOrDigit() && trimmed[0] !in '\u0900'..'\u097F') {
                return false
            }

            // 3. Reject low-confidence logo hallucinations
            if (confidence < 0.32f && trimmed.length <= 4) {
                return false
            }

            // 4. Reject disproportionately massive square logo blocks (Area > 15% of image with aspect ratio 0.8..1.25)
            if (imageW > 0 && imageH > 0) {
                val areaRatio = (box.width().toLong() * box.height().toLong()).toFloat() / (imageW.toLong() * imageH.toLong()).toFloat()
                val aspect = box.width().toFloat() / max(1, box.height()).toFloat()
                if (areaRatio > 0.15f && aspect in 0.80f..1.25f && trimmed.length < 10) {
                    return false
                }
            }

            return true
        }
    }
}
