package com.cardlens

/**
 * Pure Kotlin field extraction engine for business cards and documents.
 * Script-agnostic regex & heuristic extractors:
 *  - Phone numbers (Indian mobile + landline, international E.164, shared-prefix slash notation)
 *  - Email addresses (with OCR broken-space healing)
 *  - Websites & domains (expanded TLD list, excludes email handles)
 *  - Indian GSTIN (15-character statutory format)
 *  - Indian PIN codes (6-digit, guarded against phone number & GSTIN substrings)
 *  - OCR noise cleaning: character-confusion substitutions, spaced-out text healing
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

    // Indian Mobile: optional (+91 / 91 / 0), followed by 10 digits starting with 6, 7, 8, or 9.
    // Matches any digit spacing: 98765 43210, 9876 543 210, 98-765-43210, etc.
    private val INDIAN_MOBILE_REGEX = Regex(
        "(?<!\\d)(?:(?:\\+91|91|0)[\\s.-]*)?([6-9](?:[\\s.-]?\\d){9})(?!\\d)"
    )

    // Indian Landline: STD code (2-4 digits starting with 0) + 6-8 digit local number
    private val INDIAN_LANDLINE_REGEX = Regex(
        "(?<!\\d)(0\\d{1,4}[\\s.-]?[1-9]\\d{5,7})(?!\\d)"
    )

    // International phone: +CC followed by 6-14 digits (handles US, UK, UAE, SG, AU, EU, etc.)
    // Country codes 1-999 covered, digit separators allowed
    private val INTERNATIONAL_PHONE_REGEX = Regex(
        "\\+(?!91\\b)([1-9]\\d{0,2})[\\s.-]?(?:\\(\\d{1,4}\\)[\\s.-]?)?(?:\\d[\\s.-]?){6,14}\\d(?:[ ]?(?:ext|x|extn)\\.?[\\s.-]?\\d{1,5})?"
    )

    // Shared-prefix slash notation: +91 98220 11111 / 22222 or 98220 11111 / 22222
    private val SLASH_SUFFIX_REGEX = Regex(
        "(?:(?:\\+91|91|0)[\\s.-]?)?[6-9]\\d{4}[\\s.-]?\\d{5}\\s*/\\s*(\\d{5})(?!\\s*\\d)"
    )

    // 6-digit Indian PIN code (digits 1-9 followed by 5 digits, allowing optional space or hyphen: e.g. 440001 or 440 001)
    private val PINCODE_CANDIDATE_REGEX = Regex(
        "(?<!\\d)[1-9][0-9]{2}[\\s-]?[0-9]{3}(?!\\d)"
    )

    // URLs starting with http://, https://, or www.
    private val URL_WITH_PREFIX_REGEX = Regex(
        "(?:https?://|www\\.)[a-zA-Z0-9.-]+(?:\\.[a-zA-Z]{2,})+(?:/[^\\s,;)\\]]*)?",
        RegexOption.IGNORE_CASE
    )

    // Naked domains with expanded TLD list (including modern gTLDs)
    private val NAKED_DOMAIN_REGEX = Regex(
        "\\b[a-zA-Z0-9][a-zA-Z0-9.-]*\\.(?:" +
            "com|in|co\\.in|org|net|io|ai|biz|info|tech|online|store|co|edu|gov|" +
            "app|dev|me|us|uk|ca|au|sg|ae|de|fr|jp|cn|global|studio|agency|solutions|" +
            "cloud|digital|services|group|institute|foundation|ventures|media|news|" +
            "health|care|finance|consulting|design|build|works|systems|software|" +
            "int|mobi|name|pro|travel|jobs|museum|coop|aero|mil|gov\\.in|ac\\.in|" +
            "nic\\.in|res\\.in|edu\\.in|gov\\.uk|co\\.uk|org\\.uk)(?:/[^\\s,;)\\]]*)?\\b",
        RegexOption.IGNORE_CASE
    )

    // ── OCR Noise Cleaning Patterns ──────────────────────────────────────────

    // Spaced-out email: "j o h n @ g m a i l . c o m" -> "john@gmail.com"
    private val SPACED_EMAIL_REGEX = Regex(
        "(?:[a-zA-Z0-9][\\s]{1,2}){2,}@(?:[a-zA-Z0-9][\\s]{0,2}){2,}\\.[a-zA-Z]{2,}",
        RegexOption.IGNORE_CASE
    )

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Clean OCR artifacts from raw text before field extraction.
     *
     * Handles:
     *  1. Symbol confusion: © → @ in email-like contexts
     *  2. Heals spaced-out email addresses: "j o h n @ g m a i l . c o m"
     */
    fun cleanOcrText(rawText: String): String {
        var text = rawText

        // Fix ©, ®, or (c) misread as @ in email-like contexts
        text = text.replace(Regex("([a-zA-Z0-9._%+\\-])(?:©|®|\\(c\\)|\\(C\\))([a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})")) { mr ->
            "${mr.groupValues[1]}@${mr.groupValues[2]}"
        }

        // Heal spaced-out email addresses: "j o h n @ g m a i l . c o m" -> "john@gmail.com"
        text = SPACED_EMAIL_REGEX.replace(text) { mr ->
            mr.value.replace(Regex("\\s"), "")
        }

        // Fix OCR character-swaps in popular email providers (e.g. 1 for l, 0 for o)
        text = text.replace(Regex("(?i)@(gmai[1l]|gma1l|gmaii|gmall)\\.com"), "@gmail.com")
            .replace(Regex("(?i)@(hotmai[1l]|hotma1l)\\.com"), "@hotmail.com")
            .replace(Regex("(?i)@(out1ook|outl00k)\\.com"), "@outlook.com")
            .replace(Regex("(?i)@(yah00|yaho0|yah0o)\\.com"), "@yahoo.com")
            .replace(Regex("(?i)@(red1ffmail|rediffmai1)\\.com"), "@rediffmail.com")

        // Heal accidental space around @ or . in email addresses: e.g. "bharatsports29@gmail. com" -> "bharatsports29@gmail.com"
        text = text.replace(Regex("(?i)([a-zA-Z0-9._%+\\-]+)\\s*@\\s*([a-zA-Z0-9.\\-]+)\\s*\\.\\s*([a-zA-Z]{2,})")) { mr ->
            "${mr.groupValues[1]}@${mr.groupValues[2].replace(" ", "")}.${mr.groupValues[3]}"
        }

        return text
    }

    /**
     * Extract all email addresses found in the text.
     * Heals OCR spacing artifacts before matching.
     * Returned as lowercase, trimmed, deduplicated list.
     */
    fun extractEmails(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        val cleaned = cleanOcrText(text)
        return EMAIL_REGEX.findAll(cleaned)
            .map { it.value.trim().lowercase() }
            .distinct()
            .toList()
    }

    /**
     * Extract website URLs and domain names.
     * Automatically masks email addresses so their domain names are not falsely
     * extracted as standalone websites.
     * Expanded TLD coverage (modern gTLDs: .app, .dev, .ai, .studio, .agency, etc.)
     */
    fun extractWebsites(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        val cleaned = cleanOcrText(text)
        // Mask emails so "user@company.com" doesn't produce "company.com" as a website
        val maskedText = EMAIL_REGEX.replace(cleaned, " ")

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
     * Extract Indian mobile and landline numbers, PLUS international numbers.
     *
     * Supports:
     *  - Indian: +91 98765 43210, +91-9876543210, 09876543210, 9876543210
     *  - Indian landlines: 020-25678901
     *  - Shared-prefix slash: +91 98220 11111 / 22222 → [9822011111, 9822022222]
     *  - Devanagari digits: ९८७६५ ४३२१० → 9876543210
     *  - International: +1 415 555 0199, +44 20 7946 0958, +971 4 312 0000
     *  - Extensions: +91 22 6600 1234 Ext. 402
     *
     * Guarantees 6-digit pincodes are NOT extracted as phone numbers.
     */
    fun extractPhoneNumbers(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        val normalized = normalizeDevanagariDigits(cleanOcrText(text))
        val results = mutableListOf<String>()

        // 1. Check shared-prefix slash notation FIRST to expand both numbers
        SLASH_SUFFIX_REGEX.findAll(normalized).forEach { match ->
            val fullMatch = match.value
            // Extract the prefix number (first full number)
            val prefixMatch = INDIAN_MOBILE_REGEX.find(fullMatch)
            if (prefixMatch != null) {
                val prefixDigits = prefixMatch.value.filter { it.isDigit() }
                if (prefixDigits.length in 10..13) {
                    val normalizedPrefix = prefixDigits.takeLast(10)
                    results.add(normalizedPrefix)

                    // Expand with the suffix: replace last 5 digits
                    val suffix = match.groupValues[1]
                    if (suffix.length == 5) {
                        val expandedSecond = normalizedPrefix.dropLast(5) + suffix
                        results.add(expandedSecond)
                    }
                }
            }
        }

        // 2. Check Indian mobile numbers
        INDIAN_MOBILE_REGEX.findAll(normalized).forEach { match ->
            val raw = match.value.trim()
            val digitsOnly = raw.filter { it.isDigit() }
            // An Indian phone number must have at least 10 digits
            if (digitsOnly.length in 10..13) {
                val normalized10 = digitsOnly.takeLast(10)
                if (!results.contains(normalized10)) {
                    results.add(normalized10)
                }
            }
        }

        // 3. Check Indian landline numbers
        INDIAN_LANDLINE_REGEX.findAll(normalized).forEach { match ->
            val raw = match.value.trim()
            val digitsOnly = raw.filter { it.isDigit() }
            if (digitsOnly.length in 8..12 && !results.any { it.contains(raw) }) {
                results.add(raw)
            }
        }

        // 4. International phone numbers (+CC prefix, not already covered by Indian)
        INTERNATIONAL_PHONE_REGEX.findAll(normalized).forEach { match ->
            val raw = match.value.trim()
            val digitsOnly = raw.filter { it.isDigit() }
            // Min 7 digits (local), max 15 total (E.164 max)
            if (digitsOnly.length in 7..15 && !results.any { result ->
                    result.filter { it.isDigit() }.contains(digitsOnly.takeLast(7))
                }) {
                results.add(raw.trim())
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
            .map { it.value.trim().replace(Regex("[\\s-]"), "") }
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
     * Extract phone numbers with their semantic label (Mobile, Office, Residence, WhatsApp)
     * by inspecting surrounding text, prefixes (M., Off:, Res:, Mob., etc.) and parentheses.
     */
    fun extractLabeledPhoneNumbers(text: String): List<LabeledPhone> {
        if (text.isBlank()) return emptyList()

        val normalized = normalizeDevanagariDigits(cleanOcrText(text))
        val labeled = mutableListOf<LabeledPhone>()
        val seenNumbers = mutableSetOf<String>()

        val lines = normalized.lines()
        for (line in lines) {
            val trimmedLine = line.trim()
            if (trimmedLine.isBlank()) continue

            var defaultLabel: String? = null
            when {
                Regex("(?i)\\b(?:off(?:ice)?|दुकान|कार्यालय)\\b").containsMatchIn(trimmedLine) -> defaultLabel = "Office"
                Regex("(?i)\\b(?:res(?:idence|id)?|घर)\\b").containsMatchIn(trimmedLine) -> defaultLabel = "Residence"
                Regex("(?i)\\b(?:whats?app|wa)\\b").containsMatchIn(trimmedLine) -> defaultLabel = "WhatsApp"
                Regex("(?i)\\b(?:mob(?:ile)?|cell|m\\.?\\s*no|मो(?:बाईल)?)\\b").containsMatchIn(trimmedLine) -> defaultLabel = "Mobile"
                Regex("(?i)\\b(?:tel(?:ephone)?|landline|ph(?:one)?|फोन)\\b").containsMatchIn(trimmedLine) -> defaultLabel = "Landline"
            }

            if (defaultLabel == null) {
                // Pipe or slash separated branch landmark: e.g. "Laxmi Nagar Square | 95270 00045"
                val pipeIdx = trimmedLine.indexOf('|').takeIf { it != -1 } ?: trimmedLine.indexOf('/').takeIf { it != -1 } ?: -1
                if (pipeIdx > 0) {
                    val beforePipe = trimmedLine.substring(0, pipeIdx).trim()
                    val afterPipe = trimmedLine.substring(pipeIdx + 1).trim()
                    val branchPhones = extractPhoneNumbers(afterPipe)
                    if (branchPhones.isNotEmpty()) {
                        val segments = beforePipe.split(',', ';')
                        var lastSegment = segments.lastOrNull()?.trim() ?: beforePipe
                        if (lastSegment.length > 30) {
                            val words = lastSegment.split(Regex("\\s+"))
                            lastSegment = words.takeLast(2).joinToString(" ")
                        }
                        if (lastSegment.isNotBlank() && lastSegment.length in 3..35 && !lastSegment.all { it.isDigit() }) {
                            defaultLabel = lastSegment
                        }
                    }
                }
            }

            val lineNumbers = extractPhoneNumbers(trimmedLine)
            for (num in lineNumbers) {
                if (seenNumbers.add(num)) {
                    var specificLabel = defaultLabel
                    if (Regex("(?i)\\(off\\)").containsMatchIn(trimmedLine)) specificLabel = "Office"
                    else if (Regex("(?i)\\(res\\)").containsMatchIn(trimmedLine)) specificLabel = "Residence"
                    else if (Regex("(?i)\\(wa\\)").containsMatchIn(trimmedLine)) specificLabel = "WhatsApp"

                    labeled.add(LabeledPhone(number = num, label = specificLabel))
                } else if (defaultLabel != null) {
                    // Update previously unlabeled number with this branch landmark label
                    val existingIdx = labeled.indexOfFirst { it.number == num && it.label == null }
                    if (existingIdx != -1) {
                        labeled[existingIdx] = LabeledPhone(number = num, label = defaultLabel)
                    }
                }
            }
        }

        val allNumbers = extractPhoneNumbers(text)
        for (num in allNumbers) {
            if (seenNumbers.add(num)) {
                labeled.add(LabeledPhone(number = num, label = null))
            }
        }

        return labeled
    }

    /**
     * Convenience method to extract all structured contact fields in a single pass.
     */
    fun extractContactFields(text: String): ContactFields {
        val numbers = extractPhoneNumbers(text)
        val labeled = extractLabeledPhoneNumbers(text)
        return ContactFields(
            phoneNumbers = numbers,
            labeledPhones = labeled,
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
    val labeledPhones: List<LabeledPhone> = emptyList(),
    val emails: List<String>,
    val websites: List<String>,
    val gstin: List<String>,
    val pincodes: List<String>
)
