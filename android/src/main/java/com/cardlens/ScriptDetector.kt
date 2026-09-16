package com.cardlens

/**
 * Heuristics for on-device script detection and dual-recognizer routing.
 *
 * Avoids blindly running both Latin and Devanagari recognizers on every scan
 * to minimize latency and conserve device battery.
 */
object ScriptDetector {

    // Unicode ranges for Devanagari script:
    // U+0900..U+097F (Main Devanagari block: Hindi, Marathi, Sanskrit, Konkani, Nepali)
    // U+A8E0..U+A8FF (Devanagari Extended)
    private val DEVANAGARI_REGEX = Regex("[\\u0900-\\u097F\\uA8E0-\\uA8FF]")

    /**
     * Checks if the text contains any Devanagari Unicode codepoints.
     */
    fun hasDevanagariCodepoints(text: String): Boolean {
        if (text.isBlank()) return false
        return DEVANAGARI_REGEX.containsMatchIn(text)
    }

    /**
     * Count the number of Devanagari characters in the text.
     */
    fun countDevanagariCharacters(text: String): Int {
        if (text.isBlank()) return 0
        return DEVANAGARI_REGEX.findAll(text).count()
    }

    /**
     * Decides whether an image should be re-run with the Devanagari recognizer
     * after an initial Latin pass.
     *
     * Triggers when:
     *  1. Any Unicode Devanagari codepoints were already detected in the Latin pass.
     *  2. The Latin pass produced very low text density (< 15 characters).
     *  3. The Latin pass produced mostly garbled symbols / non-word noise
     *     (a common artifact when Latin models scan Devanagari glyphs).
     */
    fun shouldRerunWithDevanagari(latinText: String): Boolean {
        val trimmed = latinText.trim()
        if (trimmed.isBlank()) return true

        // 1. Direct Devanagari codepoints detected
        if (hasDevanagariCodepoints(trimmed)) {
            return true
        }

        // 2. Indian statutory / address / contact signals that warrant Devanagari check
        val hasIndianContext = trimmed.contains(Regex("\\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\\b")) ||
                               trimmed.contains("+91") ||
                               trimmed.contains("GSTIN", ignoreCase = true) ||
                               trimmed.contains("Chowk", ignoreCase = true) ||
                               trimmed.contains("Nagar", ignoreCase = true) ||
                               trimmed.contains("Road", ignoreCase = true)

        if (hasIndianContext) {
            return true
        }

        // 3. Strong Latin indicators: email, website, or domain patterns
        if (trimmed.contains("@") ||
            trimmed.contains("http://", ignoreCase = true) ||
            trimmed.contains("https://", ignoreCase = true) ||
            trimmed.contains(".com", ignoreCase = true) ||
            trimmed.contains(".in", ignoreCase = true) ||
            trimmed.contains(".org", ignoreCase = true) ||
            trimmed.contains(".net", ignoreCase = true)
        ) {
            return false
        }

        val letters = trimmed.count { it.isLetter() }

        // If card already contains substantial Latin letters, do not rerun
        if (letters >= 30) {
            return false
        }

        // 4. Very sparse non-digit fragment typical of Latin OCR scanning Devanagari glyphs (e.g. "a b")
        if (trimmed.length in 1..10 && letters < 5 && !trimmed.any { it.isDigit() }) {
            return true
        }

        // 5. Garbled symbols check: extremely low letter ratio without phone numbers/digits
        val letterRatio = letters.toDouble() / trimmed.length.coerceAtLeast(1)
        if (letterRatio < 0.35 && trimmed.length in 10..40 && !trimmed.any { it.isDigit() }) {
            return true
        }

        return false
    }

    /**
     * Compare the output from the Latin pass and the Devanagari pass,
     * choosing the result that yielded richer, more meaningful text.
     */
    fun isDevanagariResultBetter(latinText: String, devanagariText: String): Boolean {
        val devanagariCountInDev = countDevanagariCharacters(devanagariText)
        val devanagariCountInLatin = countDevanagariCharacters(latinText)

        // If the Devanagari pass found Devanagari script, prefer it
        if (devanagariCountInDev > 0 && devanagariCountInDev >= devanagariCountInLatin) {
            return true
        }

        // If Latin text was very sparse (< 15) and Devanagari produced substantially more text
        if (latinText.trim().length < 15 && devanagariText.trim().length >= 15) {
            return true
        }

        return false
    }
}
