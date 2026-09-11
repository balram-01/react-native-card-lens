package com.cardlens

/**
 * Pure Kotlin layout-based heuristics engine for business cards.
 *
 * Uses ML Kit TextBlock and TextLine bounding-box geometry to infer:
 *  - [guessCompanyName]: Tallest text block (header / largest font), excluding contact info.
 *  - [guessPersonAndRole]: Adjacent line pairs or inline matches with role keywords
 *                          (in English and Devanagari).
 *  - [guessAddressLines]: Lines containing configurable location keywords or PIN codes.
 *  - [guessTagline]: Short non-numeric line(s) between company name and address.
 *
 * Zero Android framework dependencies, fully deterministic, fast & unit-testable.
 */
object CardLayoutParser {

    // ── Configurable Keyword Sets ────────────────────────────────────────────

    /**
     * Role titles commonly found on business cards (English & Devanagari).
     * Configurable: callers can supply their own list or use defaults.
     */
    val DEFAULT_ROLE_KEYWORDS: Set<String> = setOf(
        // English
        "CEO", "FOUNDER", "CO-FOUNDER", "PROPRIETOR", "PROP.", "DIRECTOR",
        "MANAGING DIRECTOR", "MD", "PRESIDENT", "VICE PRESIDENT", "VP",
        "CHAIRMAN", "GENERAL MANAGER", "MANAGER", "PARTNER", "ASSOCIATE",
        "CONSULTANT", "EXECUTIVE", "ADVOCATE", "ARCHITECT", "ENGINEER", "OWNER",
        // Devanagari equivalents
        "डायरेक्टर", "संचालक", "संस्थापक", "अध्यक्ष", "उपाध्यक्ष",
        "व्यवस्थापक", "मालक", "प्रोप्राईटर", "सल्लागार", "भागीदार",
        "कार्यकारी"
    )

    /**
     * Location / address keywords commonly appearing in business card addresses.
     * Configurable: callers can supply their own list or use defaults.
     */
    val DEFAULT_LOCATION_KEYWORDS: Set<String> = setOf(
        // English
        "road", "rd", "street", "st", "lane", "nagar", "chowk", "square",
        "colony", "layout", "building", "bldg", "floor", "tower", "plot",
        "sector", "phase", "opposite", "opp", "near", "behind", "complex",
        "avenue", "park", "estate", "midc", "industrial area", "indl area",
        "marg", "gali", "rasta", "naka", "cross", "dist", "dist.", "state",
        "flat", "shop", "office", "no.", "pincode", "pin",
        // Devanagari
        "रोड", "नगर", "चौक", "रस्ता", "मार्ग", "गल्ली", "कॉलनी", "संकुल",
        "सोसायटी", "प्लॉट", "मजला", "जवळ", "समोर", "मागे", "इस्टेट", "दुकान",
        "कार्यालय", "जि.", "पिन"
    )

    // ── Core Layout Parsing ──────────────────────────────────────────────────

    /**
     * Parse structured card layout from the hierarchy of TextBlocks.
     */
    fun parseLayout(
        blocks: List<RawBlock>,
        roleKeywords: Set<String> = DEFAULT_ROLE_KEYWORDS,
        locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS
    ): CardLayoutFields {
        if (blocks.isEmpty()) {
            return CardLayoutFields(null, null, emptyList(), emptyList())
        }

        val allLines = blocks.flatMap { it.lines }
            .sortedBy { it.boundingBox.top }

        val usedLineTexts = mutableSetOf<String>()

        // 1. Guess Company Name (tallest non-contact text block)
        val (companyName, companyBlock) = guessCompanyName(blocks)
        companyBlock?.lines?.forEach { usedLineTexts.add(it.text.trim()) }

        // 2. Guess Contact Persons & Roles
        val contactPersons = guessPersonAndRole(allLines, roleKeywords, usedLineTexts)
        contactPersons.forEach { person ->
            usedLineTexts.add(person.name.trim())
            person.role?.let { usedLineTexts.add(it.trim()) }
        }

        // 3. Guess Address Lines
        val addressLines = guessAddressLines(allLines, locationKeywords, usedLineTexts)
        addressLines.forEach { usedLineTexts.add(it.trim()) }

        // 4. Guess Tagline (short line between company name and address)
        val tagline = guessTagline(allLines, companyBlock, addressLines, usedLineTexts)

        return CardLayoutFields(
            companyName = companyName,
            tagline = tagline,
            contactPersons = contactPersons,
            addressLines = addressLines
        )
    }

    // ── Heuristic Functions ──────────────────────────────────────────────────

    /**
     * Guess Company Name:
     * Evaluates blocks that do not contain phone, email, website, or GSTIN patterns.
     * Picks the candidate block with the tallest line height (largest font header).
     */
    fun guessCompanyName(blocks: List<RawBlock>): Pair<String?, RawBlock?> {
        val candidates = blocks.filter { block ->
            val text = block.text.trim()
            text.isNotBlank() &&
            FieldExtractor.extractPhoneNumbers(text).isEmpty() &&
            FieldExtractor.extractEmails(text).isEmpty() &&
            FieldExtractor.extractWebsites(text).isEmpty() &&
            FieldExtractor.extractGstin(text).isEmpty() &&
            !looksLikePureAddress(text)
        }

        if (candidates.isEmpty()) return Pair(null, null)

        // Find block with largest average line height (indicative of prominent header font)
        val bestBlock = candidates.maxByOrNull { block ->
            val lineCount = block.lines.size.coerceAtLeast(1)
            val avgLineHeight = block.boundingBox.height / lineCount
            avgLineHeight
        }

        return Pair(bestBlock?.text?.trim(), bestBlock)
    }

    /**
     * Guess Person and Role:
     * Identifies pairs of adjacent lines where the second line matches a role keyword,
     * or single lines containing an inline role like "Name (Director)".
     */
    fun guessPersonAndRole(
        lines: List<RawLine>,
        roleKeywords: Set<String> = DEFAULT_ROLE_KEYWORDS,
        alreadyUsed: Set<String> = emptySet()
    ): List<ContactPerson> {
        val persons = mutableListOf<ContactPerson>()
        val matchedIndices = mutableSetOf<Int>()

        for (i in lines.indices) {
            if (i in matchedIndices) continue
            val currentLine = lines[i]
            val currentText = currentLine.text.trim()
            if (alreadyUsed.contains(currentText) || isContactInfo(currentText)) continue

            // 1. Check if current line contains an inline role (e.g. "Rajesh Sharma (Director)" or "Rajesh Sharma - CEO")
            val inlinePerson = extractInlinePerson(currentText, roleKeywords)
            if (inlinePerson != null) {
                persons.add(inlinePerson)
                matchedIndices.add(i)
                continue
            }

            // 2. Check if this line is a role keyword itself (e.g. "Managing Director")
            val matchedRole = matchRole(currentText, roleKeywords)
            if (matchedRole != null) {
                // The preceding line is typically the person's name!
                val prevIndex = i - 1
                if (prevIndex >= 0 && prevIndex !in matchedIndices) {
                    val prevText = lines[prevIndex].text.trim()
                    if (isValidPersonName(prevText, alreadyUsed)) {
                        persons.add(ContactPerson(name = prevText, role = currentText))
                        matchedIndices.add(prevIndex)
                        matchedIndices.add(i)
                        continue
                    }
                }

                // If preceding line was not valid, check next line (some cards put title above name)
                val nextIndex = i + 1
                if (nextIndex < lines.size && nextIndex !in matchedIndices) {
                    val nextText = lines[nextIndex].text.trim()
                    if (isValidPersonName(nextText, alreadyUsed)) {
                        persons.add(ContactPerson(name = nextText, role = currentText))
                        matchedIndices.add(nextIndex)
                        matchedIndices.add(i)
                        continue
                    }
                }
            }
        }

        return persons
    }

    /**
     * Guess Address Lines:
     * Finds lines that contain configured location keywords, postal PIN codes,
     * or are vertically grouped with address lines.
     */
    fun guessAddressLines(
        lines: List<RawLine>,
        locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS,
        alreadyUsed: Set<String> = emptySet()
    ): List<String> {
        val addressLines = mutableListOf<String>()

        for (line in lines) {
            val text = line.text.trim()
            if (alreadyUsed.contains(text) || text.isBlank()) continue

            // Skip lines that are purely phone, email, or website
            if (FieldExtractor.extractEmails(text).isNotEmpty() ||
                FieldExtractor.extractWebsites(text).isNotEmpty() ||
                FieldExtractor.extractGstin(text).isNotEmpty()) {
                continue
            }

            val hasLocationKeyword = matchesLocationKeyword(text, locationKeywords)
            val hasPincode = FieldExtractor.extractPincodes(text).isNotEmpty()

            if (hasLocationKeyword || hasPincode) {
                addressLines.add(text)
            }
        }

        return addressLines
    }

    /**
     * Guess Tagline:
     * Unmatched short non-numeric line(s) between the company name and address section.
     */
    fun guessTagline(
        lines: List<RawLine>,
        companyBlock: RawBlock?,
        addressLines: List<String>,
        alreadyUsed: Set<String>
    ): String? {
        val companyBottom = companyBlock?.boundingBox?.bottom ?: 0
        val addressTop = lines.filter { addressLines.contains(it.text.trim()) }
            .minOfOrNull { it.boundingBox.top } ?: Int.MAX_VALUE

        val candidates = lines.filter { line ->
            val text = line.text.trim()
            !alreadyUsed.contains(text) &&
            text.length in 5..80 &&
            !isNumeric(text) &&
            !isContactInfo(text) &&
            (companyBottom == 0 || line.boundingBox.top >= companyBottom - 10) &&
            line.boundingBox.bottom <= addressTop + 20
        }

        return candidates.firstOrNull()?.text?.trim()
    }

    // ── Private Validation Helpers ───────────────────────────────────────────

    private fun matchRole(text: String, roleKeywords: Set<String>): String? {
        val clean = text.trim()
        return roleKeywords.firstOrNull { kw ->
            // Use Unicode letter/digit boundaries so English & Devanagari both match accurately
            val pattern = "(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])"
            Regex(pattern).containsMatchIn(clean)
        }
    }

    private fun extractInlinePerson(text: String, roleKeywords: Set<String>): ContactPerson? {
        // Formats: "Name (Role)" or "Name - Role" or "Name, Role"
        val separators = listOf(" - ", " – ", " — ", "(", ",")
        for (sep in separators) {
            if (text.contains(sep)) {
                val parts = if (sep == "(") {
                    val namePart = text.substringBefore("(").trim()
                    val rolePart = text.substringAfter("(").removeSuffix(")").trim()
                    listOf(namePart, rolePart)
                } else {
                    text.split(sep, limit = 2).map { it.trim() }
                }

                if (parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()) {
                    val matchedRole = matchRole(parts[1], roleKeywords)
                    if (matchedRole != null && isValidPersonName(parts[0], emptySet())) {
                        return ContactPerson(name = parts[0], role = parts[1])
                    }
                }
            }
        }
        return null
    }

    private fun isValidPersonName(text: String, alreadyUsed: Set<String>): Boolean {
        if (text.isBlank() || alreadyUsed.contains(text)) return false
        if (text.length > 50) return false
        if (isContactInfo(text)) return false
        // A person's name shouldn't have excessive numbers
        val digitCount = text.count { it.isDigit() }
        if (digitCount > 2) return false
        // Shouldn't be pure punctuation or symbols
        val letterCount = text.count { it.isLetter() }
        return letterCount >= 3
    }

    private fun isContactInfo(text: String): Boolean {
        return FieldExtractor.extractPhoneNumbers(text).isNotEmpty() ||
               FieldExtractor.extractEmails(text).isNotEmpty() ||
               FieldExtractor.extractWebsites(text).isNotEmpty() ||
               FieldExtractor.extractGstin(text).isNotEmpty()
    }

    private fun matchesLocationKeyword(text: String, locationKeywords: Set<String>): Boolean {
        val clean = text.trim()
        return locationKeywords.any { kw ->
            val pattern = "(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])"
            Regex(pattern).containsMatchIn(clean)
        }
    }

    private fun looksLikePureAddress(text: String): Boolean {
        val clean = text.trim()
        val count = DEFAULT_LOCATION_KEYWORDS.count { kw ->
            val pattern = "(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])"
            Regex(pattern).containsMatchIn(clean)
        }
        return count >= 2 || FieldExtractor.extractPincodes(text).isNotEmpty()
    }

    private fun isNumeric(text: String): Boolean {
        val digits = text.count { it.isDigit() }
        return digits.toDouble() / text.length.coerceAtLeast(1) > 0.4
    }
}

// ── Data Models ──────────────────────────────────────────────────────────────

data class BoundingBox(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int
) {
    val height: Int get() = (bottom - top).coerceAtLeast(0)
    val width: Int get() = (right - left).coerceAtLeast(0)
}

data class RawLine(
    val text: String,
    val boundingBox: BoundingBox
)

data class RawBlock(
    val text: String,
    val boundingBox: BoundingBox,
    val lines: List<RawLine>
)

data class ContactPerson(
    val name: String,
    val role: String? = null
)

data class CardLayoutFields(
    val companyName: String?,
    val tagline: String?,
    val contactPersons: List<ContactPerson>,
    val addressLines: List<String>
)
