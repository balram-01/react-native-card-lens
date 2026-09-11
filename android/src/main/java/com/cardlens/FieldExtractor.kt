package com.cardlens

/**
 * Pure Kotlin field extraction engine for business cards and documents.
 * Script-agnostic regex & heuristic extractors:
 *  - Phone numbers (Indian mobile with +91/91/0, landlines, split formats)
 *  - Email addresses
 *  - Websites & domains (excludes email handles)
 *  - Indian GSTIN (15-character statutory format)
 *  - Indian PIN codes (6-digit, guarded against phone number & GSTIN substrings)
 *
 * 100% pure functions, zero Android dependencies, fast & fully unit-testable.
 */
object FieldExtractor {

    // ── Regular Expressions ──────────────────────────────────────────────────

    private val EMAIL_REGEX = Regex(
        "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
        RegexOption.IGNORE_CASE
    )

    // Indian GSTIN: 2-digit state code + 10-char PAN + 1 entity char + 'Z' + 1 check digit
    private val GSTIN_REGEX = Regex(
        "\\b[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9a-zA-Z]{1}[zZ][0-9a-zA-Z]{1}\\b"
    )

    // Indian Mobile: optional (+91 / 91 / 0), followed by 10 digits starting with 6, 7, 8, or 9
    // Handles common separators: space, hyphen, dot, or no separator.
    private val INDIAN_MOBILE_REGEX = Regex(
        "(?<!\\d)(?:(?:\\+91|91|0)[\\s.-]?)?([6-9]\\d{4}[\\s.-]?\\d{5}|[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{4}|[6-9]\\d{9})(?!\\d)"
    )

    // Indian Landline: STD code (2-4 digits starting with 0) + 6-8 digit local number
    private val INDIAN_LANDLINE_REGEX = Regex(
        "(?<!\\d)(0\\d{1,4}[\\s.-]?[1-9]\\d{5,7})(?!\\d)"
    )

    // 6-digit Indian PIN code (digits 1-9 followed by 5 digits, not surrounded by other digits)
    private val PINCODE_CANDIDATE_REGEX = Regex(
        "(?<!\\d)[1-9][0-9]{5}(?!\\d)"
    )

    // URLs starting with http://, https://, or www.
    private val URL_WITH_PREFIX_REGEX = Regex(
        "(?:https?://|www\\.)[a-zA-Z0-9.-]+(?:\\.[a-zA-Z]{2,})+(?:/[^\\s,;)\\]]*)?",
        RegexOption.IGNORE_CASE
    )

    // Naked domains with popular TLDs
    private val NAKED_DOMAIN_REGEX = Regex(
        "\\b[a-zA-Z0-9][a-zA-Z0-9.-]*\\.(?:com|in|co\\.in|org|net|io|ai|biz|info|tech|online|store|co|edu|gov)(?:/[^\\s,;)\\]]*)?\\b",
        RegexOption.IGNORE_CASE
    )

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Extract all email addresses found in the text.
     * Returned as lowercase, trimmed, deduplicated list.
     */
    fun extractEmails(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        return EMAIL_REGEX.findAll(text)
            .map { it.value.trim().lowercase() }
            .distinct()
            .toList()
    }

    /**
     * Extract website URLs and domain names.
     * Automatically masks email addresses so their domain names are not falsely
     * extracted as standalone websites.
     */
    fun extractWebsites(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        // Mask emails so "user@company.com" doesn't produce "company.com" as a website
        val maskedText = EMAIL_REGEX.replace(text, " ")

        val candidates = mutableListOf<String>()

        URL_WITH_PREFIX_REGEX.findAll(maskedText).forEach {
            candidates.add(cleanUrl(it.value))
        }

        NAKED_DOMAIN_REGEX.findAll(maskedText).forEach {
            candidates.add(cleanUrl(it.value))
        }

        return candidates
            .filter { it.isNotBlank() && it.contains(".") && !it.contains("@") }
            .distinct()
    }

    /**
     * Extract 15-character Indian Goods and Services Tax Identification Numbers (GSTIN).
     * Normalizes results to uppercase.
     */
    fun extractGstin(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        return GSTIN_REGEX.findAll(text)
            .map { it.value.trim().uppercase() }
            .distinct()
            .toList()
    }

    /**
     * Converts Devanagari numerals (०, १, २, ३, ४, ५, ६, ७, ८, ९ -> U+0966..U+096F)
     * to standard ASCII digits (0..9).
     */
    fun normalizeDevanagariDigits(text: String): String {
        val devZero = '\u0966'
        val devNine = '\u096F'
        return buildString(text.length) {
            for (ch in text) {
                if (ch in devZero..devNine) {
                    append('0' + (ch - devZero))
                } else {
                    append(ch)
                }
            }
        }
    }

    /**
     * Extract Indian mobile and landline numbers.
     * Supports formats:
     *  - +91 98765 43210
     *  - +91-9876543210
     *  - 09876543210
     *  - 9876543210
     *  - 98765 43210 / 91234 56789
     *  - Landlines: 020-25678901
     *  - Numbers in Devanagari digits (९१४६४९६९९४ -> 9146496994)
     * Guarantees 6-digit pincodes are NOT extracted as phone numbers.
     */
    fun extractPhoneNumbers(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        val normalized = normalizeDevanagariDigits(text)
        val results = mutableListOf<String>()

        // 1. Check Indian mobile numbers
        INDIAN_MOBILE_REGEX.findAll(normalized).forEach { match ->
            val raw = match.value.trim()
            val digitsOnly = raw.filter { it.isDigit() }
            // An Indian phone number must have at least 10 digits
            if (digitsOnly.length in 10..13) {
                results.add(normalizePhoneNumber(raw))
            }
        }

        // 2. Check Indian landline numbers
        INDIAN_LANDLINE_REGEX.findAll(normalized).forEach { match ->
            val raw = match.value.trim()
            val digitsOnly = raw.filter { it.isDigit() }
            if (digitsOnly.length in 8..12 && !results.any { it.contains(raw) }) {
                results.add(raw)
            }
        }

        return results.distinct()
    }

    /**
     * Extract 6-digit Indian PIN codes.
     *
     * Guarded against false positives:
     *  1. Strict boundary check: (?<!\d)[1-9]\d{5}(?!\d)
     *  2. Cross-checked against extracted phone numbers: if a 6-digit number is
     *     a substring of any phone number (e.g. 987654 in 9876543210), it is discarded.
     *  3. Cross-checked against GSTIN digits to prevent matching invoice/GST numbers.
     */
    fun extractPincodes(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        val normalized = normalizeDevanagariDigits(text)
        val phoneNumbers = extractPhoneNumbers(normalized)
        val phoneDigits = phoneNumbers.map { it.filter { ch -> ch.isDigit() } }
        val gstins = extractGstin(normalized)

        val candidates = PINCODE_CANDIDATE_REGEX.findAll(normalized)
            .map { it.value.trim() }
            .distinct()
            .toList()

        return candidates.filter { pin ->
            // Reject if this 6-digit string is part of any phone number
            val isPartOfPhone = phoneDigits.any { phone -> phone.contains(pin) }
            // Reject if part of any GSTIN
            val isPartOfGstin = gstins.any { gstin -> gstin.contains(pin) }

            !isPartOfPhone && !isPartOfGstin
        }
    }

    /**
     * Convenience method to extract all structured contact fields in a single pass.
     */
    fun extractContactFields(text: String): ContactFields {
        return ContactFields(
            phoneNumbers = extractPhoneNumbers(text),
            emails = extractEmails(text),
            websites = extractWebsites(text),
            gstin = extractGstin(text),
            pincodes = extractPincodes(text)
        )
    }

    // ── Helper functions ─────────────────────────────────────────────────────

    private fun cleanUrl(url: String): String {
        return url.trim()
            .trimEnd('.', ',', ';', ':', ')', ']', '>', '/')
            .lowercase()
    }

    private fun normalizePhoneNumber(phone: String): String {
        val trimmed = phone.trim().replace(Regex("^[^0-9+]+"), "")
        // Clean multiple consecutive spaces
        return trimmed.replace(Regex("\\s+"), " ")
    }
}

/**
 * Data class representing all script-agnostic contact fields extracted from OCR text.
 */
data class ContactFields(
    val phoneNumbers: List<String>,
    val emails: List<String>,
    val websites: List<String>,
    val gstin: List<String>,
    val pincodes: List<String>
)
