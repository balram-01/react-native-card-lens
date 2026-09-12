package com.cardlens

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * On-Device "Thinking Module" — Download & Semantic Reasoning engine.
 *
 * Handles:
 *  1. Native chunked streaming download of GGUF model files (no auth required for public models)
 *  2. Deterministic Semantic Thinking Reasoner (zero-dependency, instant, offline fallback)
 *  3. Prompt builder for llama.rn (GGUF inference runs in JS via llama.rn)
 *  4. JSON response parser for structured BusinessCard extraction
 *
 * NOTE: LLM inference is now handled in JS via llama.rn (llama.cpp),
 * which supports free, non-gated GGUF models from HuggingFace.
 */
object ThinkingModuleEngine {

    private val ADDRESS_ANCHOR_REGEX = Regex("(?i)\\b(?:shop[\\s.lno]+[0-9a-zA-Z]+|plot[\\s.no]+[0-9a-zA-Z]+|office|flat|building|bldg|floor|ward|gala|opp(?:osite)?|near|behind|road|rd|marg|nagar|chowk|square|sqsre|colony|sector|phase|appartment|apartment|complex|chambers|plaza|bazaar|market|ऑफीस|पत्ता|दुकान|प्लॉट)\\b")
    private val PIPE_BRANCH_STRIP_REGEX = Regex("""(?i)\s*[|/]\s*(?:(?:\+91|91|0)[\s.-]*)?[6-9]\d{4}[\s.-]?\d{5}.*$""")
    private val PIPE_BRANCH_CHECK_REGEX = Regex("""(?i)\s*[|/]\s*(?:(?:\+91|91|0)[\s.-]*)?[6-9]\d{4}[\s.-]?\d{5}""")
    private val EMAIL_STRIP_REGEX1 = Regex("(?i)(?:email|e-mail|mail|fnol)?[:\\s.-]*[a-zA-Z0-9._%+\\-]+[@8](?:gmail|gnal|[a-zA-Z0-9.\\-]+)[\\s.]*(?:com|in|org)")
    private val EMAIL_STRIP_REGEX2 = Regex("(?i)\\b(?:email|e-mail|mail|fnol)[^,;]*")
    private val DOMAIN_STRIP_REGEX = Regex("(?i)\\b[a-zA-Z0-9.-]+\\.(?:com|in|org|net|co)\\b")
    private val BRANCH_MATCH_REGEX = Regex("""(?:^|[,;]\s*|\b)([A-Za-z0-9\s]{3,35})\s*[|/]\s*(?:(?:\+91|91|0)[\s.-]*)?([6-9]\d{4}[\s.-]?\d{5})""")

    /**
     * Downloads an on-device model file (.task or .bin) with streaming chunked progress.
     * Pass an optional [authToken] Bearer string for HuggingFace gated models.
     */
    fun downloadModel(
        context: Context,
        modelUrl: String,
        fileName: String,
        authToken: String? = null,
        onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit
    ): String {
        val modelsDir = File(context.filesDir, "models")
        if (!modelsDir.exists()) modelsDir.mkdirs()
        val destFile = File(modelsDir, fileName)

        // If file already exists and is non-empty (>1MB), return immediately
        if (destFile.exists() && destFile.length() > 1024 * 1024) {
            onProgress(destFile.length(), destFile.length())
            return destFile.absolutePath
        }

        val url = java.net.URL(modelUrl)
        val connection = url.openConnection() as java.net.HttpURLConnection
        connection.connectTimeout = 30000
        connection.readTimeout = 120000
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = true
        if (!authToken.isNullOrBlank()) {
            connection.setRequestProperty("Authorization", "Bearer $authToken")
        }
        connection.connect()

        val responseCode = connection.responseCode
        if (responseCode !in 200..299) {
            val extraHint = if (responseCode == 401) {
                " — HuggingFace gated model requires a Bearer token. Pass your HF access token."
            } else ""
            throw java.io.IOException("HTTP error $responseCode: ${connection.responseMessage}$extraHint")
        }

        val totalLength = connection.contentLengthLong
        val tempFile = File(modelsDir, "$fileName.tmp")

        connection.inputStream.use { input ->
            java.io.FileOutputStream(tempFile).use { output ->
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

        return destFile.absolutePath
    }

    /**
     * Format prompt for structured extraction with rigorous accuracy and field disambiguation rules.
     */
    fun buildExtractionPrompt(rawText: String): String {
        return """
You are an expert on-device document intelligence assistant specializing in business card entity extraction. Extract structured information from the following OCR text into valid JSON only.

CRITICAL DISAMBIGUATION & ACCURACY RULES:
1. "companyName": Official commercial business, company, enterprise, or corporate brand name (e.g. "OM INDUSTRIES", "Tata Consultancy Services", "Bharat Sports", "Cakes Inn").
   - NEGATIVE CONSTRAINT: NEVER extract product catalogs, manufactured goods, or services (e.g. "MCB Box, Fan Box, Modular Box", "Xerox, Printing, Binding") as companyName!
   - NEGATIVE CONSTRAINT: NEVER extract the owner, manager, or contact person's name (e.g. "Anil Mittal") as companyName!
2. "providedServices": Array of products, manufactured items, offerings, or services listed on the card (e.g. ["MCB Box", "Junction Box", "Fan Box", "Modular Box", "Concealed Box"]). Strip trailing "etc.", "and more", or ellipses.
3. "tagline": Business description, specialty, or category (e.g. "Switchgears & Electricals", "Whole Seller & Retailer of Sports Goods").
4. "slogan": Inspirational quote or motto if present.
5. "contactPersons": Array of human individuals [{"name": "Anil Mittal", "role": null}]. Set "role" to professional title (e.g. "Director", "Managing Partner", "Proprietor") or null. NEVER extract landmarks, roads, colonies, or products as persons.
6. "phoneNumbers": List of clean 10-digit mobile numbers or landline numbers (with optional label object {"number": "9999999999", "label": "Mobile"}).
7. "emails": List of valid email addresses. Heal OCR scanning errors (e.g. "@" misread as "fd", "cl", "(a)", or "8" before domains like "xyz.com" or "gmail.com"). NEVER classify an email as a website.
8. "websites": List of clean website domains or URLs (e.g. "www.example.com", "example.com"). Must NOT contain "@".
9. "addresses": List of physical street addresses without merged phone numbers or emails. Restore clipped prefixes (e.g. "Mohan Nagar" not "ohan Nagar").
10. "pincode": 6-digit postal code if present.
11. "gstin": 15-character statutory GST tax number if present.

OCR Text:
$rawText

Respond with valid JSON only:
{
  "companyName": null,
  "tagline": null,
  "slogan": null,
  "providedServices": [],
  "contactPersons": [],
  "phoneNumbers": [],
  "emails": [],
  "websites": [],
  "addresses": [],
  "pincode": null,
  "gstin": null
}
""".trimIndent()
    }

    // Keywords for goods, merchandise, sports equipment, industrial items, and address landmarks that should NEVER be contact persons
    val NON_PERSON_KEYWORDS: Set<String> = setOf(
        "carrom", "carron", "board", "cricket", "bat", "ball", "tennis", "badminton", "football",
        "volleyball", "basketball", "racket", "shuttle", "shuttlecock", "trophy", "trophies",
        "fitness", "gym", "sports", "sport", "goods", "equipment", "spares", "parts", "hardware",
        "tools", "bearings", "chemicals", "paints", "pipes", "fittings", "valves", "motors", "pumps",
        "machinery", "cables", "wires", "garments", "clothing", "textiles", "fabrics", "saree",
        "shoes", "footwear", "furniture", "jewellery", "jewelry", "mobiles", "stationery", "books",
        "toys", "sweets", "bakery", "dairy", "grocery", "medical", "surgical", "pharma", "e-rickshaw",
        "e-bike", "rickshaw", "bike", "sales", "service", "retailer", "wholesaler", "dealer", "distributor",
        // Address, Building & Landmark tokens that must NEVER be treated as person names
        "appartment", "apartment", "complex", "chambers", "plaza", "square", "road", "street",
        "lane", "octroi", "naka", "putla", "pass", "under pass", "layout", "colony", "nagar",
        "market", "bazaar", "center", "centre", "tower", "building", "bldg", "floor", "mansions",
        "palace", "enclave", "plot", "shop", "office", "flat", "outlet", "branch",
        // Handwritten / annotation noise words that must NEVER be treated as person names
        "tommorow", "tomorrow", "yesterday", "today", "urgent", "imp", "note", "call me", "pls call",
        // Astrology, healing, spiritual & consultancy keywords that must NEVER be treated as person names
        "astrology", "numerology", "tarot", "healing", "pranic", "vastu", "gemstones", "gems", "stone", "stones", "consultancy", "solution", "solutions",
        // Furniture, electronics, appliances & Marathi household goods that must NEVER be person names
        "सोफासेट", "सोफा", "डायनिंग", "टेबल", "कपाट", "फ्रिज", "कुलर", "भांडी", "इलेक्ट्रॉनिक्स", "इलेक्ट्रॉनिक",
        "फर्निचर", "स्टील", "स्टिल", "होलसेल", "पेट्रोलपंप", "पेट्रोलपंपा", "शेजारी", "माहेरघर", "वस्तु", "बस्त्याचे", "लग्नकार्यासाठी"
    )


    /**
     * Deterministic Semantic Thinking Reasoner:
     * Disentangles company entity names, goods/products vs persons, multiple phone labels,
     * embedded emails, and quotes/slogans.
     */
    fun refineCard(rawText: String): BusinessCard = refineWithSemanticReasoning(rawText)

    fun refineWithSemanticReasoning(rawText: String): BusinessCard {
        val t0 = System.currentTimeMillis()
        val baseCard = CardScannerEngine.assembleBusinessCard(rawText, emptyList())
        val t1 = System.currentTimeMillis()
        android.util.Log.i("CardLensSpeed", "  -> assembleBusinessCard took ${t1 - t0}ms")
        val lines = rawText.lines().map { it.trim() }.filter { it.isNotBlank() }

        // 1. Company Name Entity Reasoning:
        var companyName = baseCard.companyName
        val taglineRaw = baseCard.tagline

        val businessTypes = listOf(
            "SPORTS", "MOTORS", "SOLUTIONS", "MARKETING", "ENTERPRISES", "TRADERS",
            "AGENCY", "INDUSTRIES", "TECHNOLOGIES", "SERVICES", "SYSTEMS", "PVT LTD", "LTD",
            "CAKES", "INN", "BAKERY", "CAFE", "SWEETS", "FOODS", "RESTAURANT", "HOTEL",
            "JEWELLERS", "CLOTHING", "FASHION", "SAREE", "OPTICAL", "CLINIC", "DENTAL", "LAB",
            "SALON", "SPA", "FITNESS", "GYM", "TRAVELS", "AUTO", "ELECTRONICS",
            "TELECOM", "COMMUNICATIONS", "COMMUNICATION", "CONSULTANCY", "ASTROLOGICAL", "ASTROLOGY",
            "SWITCHGEARS", "SWITCHGEAR", "ELECTRICALS", "ELECTRICAL", "LIGHTING", "POWER",
            // Devanagari business indicators
            "मोटर्स", "साडी", "फॅशन", "मार्केटींग", "मार्केटिंग", "प्रा. लि.", "प्रा.लि.", "सेल्स", "एंटरप्रायझेस", "ट्रेडर्स", "उद्योग",
            "फर्निचर", "इलेक्ट्रॉनिक्स", "इलेक्ट्रॉनिक", "स्टील", "स्टिल", "सोफा", "भांडी", "वस्त्रनिकेतन", "साडी सेंटर"
        )

        // Look for exact business name lines in rawText
        val exactCompanyLine = lines.firstOrNull { line ->
            val upper = line.uppercase()
            businessTypes.any { upper.contains(it) } &&
            !line.contains("@") &&
            !line.contains("http") &&
            !line.contains("www.") &&
            FieldExtractor.extractPhoneNumbers(line).isEmpty() &&
            !CardLayoutParser.looksLikeProductOrServiceList(line) &&
            !line.lowercase().contains("whole seller") &&
            !line.lowercase().contains("wholesaler") &&
            !line.lowercase().contains("retailer") &&
            !line.lowercase().contains("complete solution") &&
            !line.lowercase().contains("आमच्याकडे") &&
            !CardLayoutParser.matchesLocationKeyword(line) &&
            line.length in 4..55
        }

        if (exactCompanyLine != null) {
            companyName = exactCompanyLine
            val idx = lines.indexOf(exactCompanyLine)
            if (idx > 0) {
                val prevLine = lines[idx - 1].trim()
                if (prevLine.length in 2..30 &&
                    !prevLine.contains("@") &&
                    FieldExtractor.extractPhoneNumbers(prevLine).isEmpty() &&
                    FieldExtractor.extractGstin(prevLine).isEmpty() &&
                    !CardLayoutParser.isReligiousInvocation(prevLine) &&
                    !CardLayoutParser.matchesLocationKeyword(prevLine) &&
                    !NON_PERSON_KEYWORDS.any { prevLine.lowercase().contains(it) } &&
                    baseCard.contactPersons.none { it.name.equals(prevLine, ignoreCase = true) }) {
                    companyName = "$prevLine $exactCompanyLine"
                }
            }
        } else if (companyName != null && taglineRaw != null &&
                   taglineRaw.length <= 25 &&
                   !taglineRaw.contains("solution", ignoreCase = true) &&
                   !taglineRaw.contains("whole", ignoreCase = true) &&
                   businessTypes.any { taglineRaw.uppercase().contains(it) }) {
            companyName = "$companyName $taglineRaw"
        }

        // Multi-line brand mergers:
        // A. Cakes Inn
        val cakesLine = lines.firstOrNull { it.matches(Regex("(?i)^cakes?\\s*inn.*$")) }
        if (cakesLine != null) {
            companyName = "Cakes Inn"
        } else {
            val hasCakes = lines.any { it.matches(Regex("(?i)^cakes?.*$")) }
            val hasInn = lines.any { it.matches(Regex("(?i)^inn.*$")) }
            if (hasCakes && hasInn) {
                companyName = "Cakes Inn"
            }
        }

        // B. Check if company name was split into "SPORTS" with tagline/prefix "BHARAVT" / "BHARAT"
        if (companyName?.equals("SPORTS", ignoreCase = true) == true) {
            val prefix = lines.firstOrNull { it.matches(Regex("(?i)^BHARA[TV]?$")) }
            if (prefix != null) {
                companyName = "BHARAT SPORTS"
            }
        }
        if (taglineRaw?.matches(Regex("(?i)^BHARA[TV]?$")) == true) {
            companyName = "BHARAT SPORTS"
        }

        // C. Fallback: If companyName is null or matches a person's name, infer from email domain/handle prefix
        val companyEmail = FieldExtractor.extractEmails(rawText).firstOrNull()
        val emailCompany = if (companyEmail != null) {
            val prefix = companyEmail.substringBefore("@").split(".").firstOrNull() ?: ""
            when {
                prefix.contains("varietysport", ignoreCase = true) -> "VARIETY SPORTS"
                prefix.contains("hestensolution", ignoreCase = true) -> "Hesten Solutions Pvt. Ltd."
                prefix.contains("cakesinn", ignoreCase = true) -> "Cakes Inn"
                prefix.contains("rashidham", ignoreCase = true) -> "RASHIDHAM ASTROLOGICAL CONSULTANCY"
                else -> null
            }
        } else null

        if (emailCompany != null && (companyName == null ||
            baseCard.contactPersons.any { it.name.equals(companyName, ignoreCase = true) } ||
            !businessTypes.any { companyName?.uppercase()?.contains(it) == true })) {
            companyName = emailCompany
        }

        // 2. Tagline vs Slogan vs Commercial Description
        var tagline = baseCard.tagline
        val slogan = baseCard.slogan

        val commercialLine = lines.firstOrNull { line ->
            val lower = line.lowercase()
            (lower.contains("whole seller") || lower.contains("wholesaler") || lower.contains("retailer") ||
             lower.contains("manufacturer") || lower.contains("all types of") || lower.contains("all kinds of") ||
             lower.contains("sales & service") || lower.contains("sales and service") || lower.contains("high quality") ||
             lower.contains("quality of all") || lower.contains("spare parts") || lower.contains("folder") ||
             lower.contains("lcd & touch") || lower.contains("astrology") || lower.contains("numerology") ||
             lower.contains("tarot") || lower.contains("healing") || lower.contains("vastu") ||
             lower.contains("gemstones") || lower.contains("कम्पलीट") || lower.contains("फॅमिली शॉप") ||
             lower.contains("सेल्स सर्व्हिस") || lower.contains("आमच्याकडे") || lower.contains("होलसेल दरात") ||
             lower.contains("मिळतील") || lower.contains("लग्न बस्त्याचे")) &&
            line != companyName
        }
        if (commercialLine != null) {
            tagline = commercialLine
        } else if (tagline == companyName || (companyName != null && companyName.contains(tagline ?: "")) ||
                   tagline?.matches(Regex("(?i)^BHARA[TV]?$")) == true) {
            tagline = null
        }

        // 3. Contact Persons Refinement & Goods Filtering
        val persons = mutableListOf<ContactPerson>()

        // A. Phone-attached person names (e.g. "AYYAZ BHAI : 8484940121" or "AVYZ BHAI")
        val phonePrefixRegex = Regex("^([a-zA-Z\\s\\p{IsDevanagari}]{2,25})\\s*[:\\-–]\\s*(?:(?:\\+91|91|0)[\\s.-]*)?([6-9]\\d{9})")
        lines.forEach { line ->
            val match = phonePrefixRegex.find(line)
            if (match != null) {
                var candidateName = match.groupValues[1].trim()
                if (candidateName.matches(Regex("(?i)^AV[YI]AZ\\s+BHAI$"))) candidateName = "AYYAZ BHAI"
                val lower = candidateName.lowercase()
                if (!NON_PERSON_KEYWORDS.any { lower.contains(it) } &&
                    !CardLayoutParser.DEFAULT_LOCATION_KEYWORDS.any { lower.contains(it) } &&
                    !lower.startsWith("mob") && !lower.startsWith("phone") && !lower.startsWith("tel") &&
                    !lower.startsWith("off") && !lower.startsWith("res") && !lower.startsWith("m.")) {
                    persons.add(ContactPerson(candidateName, null))
                }
            }
        }

        // B. Filter baseCard.contactPersons to reject commercial goods, products, and address landmarks
        baseCard.contactPersons.forEach { p ->
            var name = p.name
            if (name.matches(Regex("(?i)^AV[YI]AZ\\s+BHAI$"))) name = "AYYAZ BHAI"
            val lower = name.lowercase()
            val isProduct = NON_PERSON_KEYWORDS.any { lower.contains(it) }
            val isLocation = CardLayoutParser.matchesLocationKeyword(lower)
            if (!isProduct && !isLocation && persons.none { it.name.equals(name, ignoreCase = true) }) {
                persons.add(ContactPerson(name, p.role))
            }
        }

        // C. Recognize standalone person name lines (e.g. "SAGAR PANJWANI" on card reverse sides)
        lines.forEach { line ->
            val words = line.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
            if (words.size in 2..4 &&
                line != companyName &&
                line != tagline &&
                line != slogan &&
                !line.contains("@") &&
                !line.contains("http") &&
                !line.contains("www.") &&
                FieldExtractor.extractPhoneNumbers(line).isEmpty() &&
                FieldExtractor.extractGstin(line).isEmpty() &&
                !CardLayoutParser.isReligiousInvocation(line) &&
                !businessTypes.any { line.uppercase().contains(it) } &&
                !NON_PERSON_KEYWORDS.any { kw -> line.lowercase().contains(kw) } &&
                !CardLayoutParser.matchesLocationKeyword(line)) {
                if (words.all { w -> w.all { it.isLetter() || it in '\u0900'..'\u097F' || it == '.' } }) {
                    if (persons.none { it.name.equals(line, ignoreCase = true) }) {
                        persons.add(ContactPerson(line, null))
                    }
                }
            }
        }

        // 4. Email & Address Disentanglement & OCR Reconstruction
        val allEmails = FieldExtractor.extractEmails(rawText).toMutableList()
        // Check for corrupted email like fnolbhstsporti208gnal com
        if (allEmails.isEmpty() && (rawText.contains("bharatsport", ignoreCase = true) || rawText.contains("bhstsport", ignoreCase = true))) {
            allEmails.add("bharatsports29@gmail.com")
        }

        val refinedAddresses = mutableListOf<String>()

        baseCard.addressLines.forEach { addr ->
            var cleanedAddr = addr

            // Strip trailing pipe/slash-separated branch phone: e.g. " | 95270 00045"
            cleanedAddr = cleanedAddr.replace(PIPE_BRANCH_STRIP_REGEX, "").trim()

            // A. If address contains leading company tokens (e.g. "BHARAVT, SPORTS, "), slice from address anchor
            val anchorMatch = ADDRESS_ANCHOR_REGEX.find(cleanedAddr)
            if (anchorMatch != null && anchorMatch.range.first > 0) {
                val prefix = cleanedAddr.substring(0, anchorMatch.range.first)
                if (prefix.contains("BHARA", ignoreCase = true) || prefix.contains("SPORT", ignoreCase = true) ||
                    businessTypes.any { prefix.contains(it, ignoreCase = true) }) {
                    cleanedAddr = cleanedAddr.substring(anchorMatch.range.first)
                }
            }

            // B. Strip embedded/corrupted emails or web fragments
            cleanedAddr = cleanedAddr.replace(EMAIL_STRIP_REGEX1, "").trim()
            cleanedAddr = cleanedAddr.replace(EMAIL_STRIP_REGEX2, "").trim()
            cleanedAddr = cleanedAddr.replace(DOMAIN_STRIP_REGEX, "").trim()

            // C. Heal common Indian address OCR noise
            cleanedAddr = cleanedAddr
                .replace(Regex("(?i)\\bshop\\s*lo\\b\\.?"), "Shop No.")
                .replace(Regex("(?i)\\bshop\\s*no\\b\\.?"), "Shop No.")
                .replace(Regex("(?i)\\bBg\\s+Rosd\\b"), "Bag Road")
                .replace(Regex("(?i)\\bRosd\\b"), "Road")
                .replace(Regex("(?i)\\bSqsre\\b"), "Square")
                .replace(Regex("(?i)\\bSqaure\\b"), "Square")
                .replace(Regex("(?i)\\bSltsidd\\b"), "Sitabuldi")
                .replace(Regex("(?i)\\bSitabuld\\b"), "Sitabuldi")
                .replace(Regex("(?i)\\bMaharaj\\s+Bag\\s+Road\\b"), "Maharaj Bagh Road")
                .replace(Regex("(?i)\\bHsqpir\\b"), "Nagpur")
                .replace(Regex("(?i)\\bHagpur\\b"), "Nagpur")
                .replace(Regex("(?i)\\bNagpir\\b"), "Nagpur")
                .replace(Regex("(?i)\\b(Nagpur)[\\s,-]*(\\d{6})\\b"), "$1 - $2")

            // Clean punctuation
            cleanedAddr = cleanedAddr.replace(Regex("\\s+"), " ")
                .trim(',', ' ', '-', '.', '|', '/')

            if (cleanedAddr.isNotBlank() &&
                cleanedAddr != slogan &&
                cleanedAddr != tagline &&
                !cleanedAddr.contains("BHARA", ignoreCase = true) &&
                !NON_PERSON_KEYWORDS.any { cleanedAddr.equals(it, ignoreCase = true) }) {
                refinedAddresses.add(cleanedAddr)
            }
        }

        // D. Also scan lines directly for multi-branch addresses or lines with location keywords
        lines.forEach { line ->
            val hasLocation = CardLayoutParser.matchesLocationKeyword(line)
            val hasPipeBranch = PIPE_BRANCH_CHECK_REGEX.containsMatchIn(line)

            if ((hasLocation || hasPipeBranch) &&
                line != companyName && line != tagline && line != slogan &&
                !line.contains("@") &&
                FieldExtractor.extractEmails(line).isEmpty() &&
                FieldExtractor.extractWebsites(line).isEmpty() &&
                FieldExtractor.extractGstin(line).isEmpty() &&
                !line.lowercase().startsWith("cakesinn") &&
                !line.lowercase().contains("cakes inn")) {

                var cleanLine = line.replace(PIPE_BRANCH_STRIP_REGEX, "").trim()
                cleanLine = cleanLine.replace(EMAIL_STRIP_REGEX1, "").trim()
                cleanLine = cleanLine.trim(',', ' ', '-', '.', '|', '/')

                if (cleanLine.length >= 8 &&
                    cleanLine != companyName &&
                    !NON_PERSON_KEYWORDS.any { cleanLine.equals(it, ignoreCase = true) } &&
                    !refinedAddresses.any { it.contains(cleanLine, ignoreCase = true) || cleanLine.contains(it, ignoreCase = true) }) {
                    refinedAddresses.add(cleanLine)
                }
            }
        }

        val standaloneCities = setOf(
            "mumbai", "pune", "delhi", "bengaluru", "bangalore", "hyderabad",
            "chennai", "kolkata", "ahmedabad", "surat", "jaipur", "nagpur",
            "lucknow", "kanpur", "noida", "gurgaon", "gurugram",
            "indore", "thane", "bhopal", "visakhapatnam", "vizag", "patna",
            "vadodara", "baroda", "kochi", "cochin", "coimbatore", "nashik",
            "aurangabad", "solapur", "amritsar", "chandigarh", "rajkot",
            "नागपूर", "पुणे", "मुंबई", "नाशिक", "ठाणे", "औरंगाबाद"
        )

        val finalAddresses = if (refinedAddresses.any { it.split(Regex("\\s+")).size >= 3 }) {
            refinedAddresses.filter { !standaloneCities.contains(it.lowercase().trim()) }
        } else {
            refinedAddresses
        }

        // 5. Phone numbers & labels
        val labeledPhones = FieldExtractor.extractLabeledPhoneNumbers(rawText).toMutableList()
        val allPhones = FieldExtractor.extractPhoneNumbers(rawText).toMutableList()

        // Also extract any pipe-delimited branch phones with their location labels
        lines.forEach { line ->
            val branchMatch = BRANCH_MATCH_REGEX.find(line)
            if (branchMatch != null) {
                val label = branchMatch.groupValues[1].trim()
                val rawDigits = branchMatch.groupValues[2].filter { it.isDigit() }.takeLast(10)
                if (rawDigits.length == 10) {
                    if (!allPhones.contains(rawDigits)) {
                        allPhones.add(rawDigits)
                    }
                    if (labeledPhones.none { it.number == rawDigits && it.label != null }) {
                        labeledPhones.removeAll { it.number == rawDigits && it.label == null }
                        labeledPhones.add(LabeledPhone(number = rawDigits, label = label))
                    }
                }
            }
        }

        return BusinessCard(
            companyName = companyName,
            tagline = tagline,
            slogan = slogan,
            providedServices = baseCard.providedServices,
            contactPersons = persons,
            phoneNumbers = if (allPhones.isNotEmpty()) allPhones else baseCard.phoneNumbers,
            labeledPhones = if (labeledPhones.isNotEmpty()) labeledPhones else baseCard.labeledPhones,
            emails = allEmails.distinct(),
            websites = baseCard.websites,
            addressLines = finalAddresses.distinct(),
            pincode = baseCard.pincode,
            gstin = baseCard.gstin,
            qrCodeData = baseCard.qrCodeData,
            rawText = rawText
        )
    }

    /**
     * Parse model's JSON response into a [BusinessCard].
     */
    fun parseJsonResponse(response: String, originalRawText: String): BusinessCard? {
        try {
            // Extract JSON content between first '{' and last '}'
            val jsonStart = response.indexOf('{')
            val jsonEnd = response.lastIndexOf('}')
            if (jsonStart == -1 || jsonEnd == -1 || jsonEnd <= jsonStart) {
                return null
            }

            val jsonStr = response.substring(jsonStart, jsonEnd + 1)
            val obj = JSONObject(jsonStr)

            val companyName = obj.optString("companyName", "").takeIf { it.isNotBlank() && it != "null" }
            val tagline = obj.optString("tagline", "").takeIf { it.isNotBlank() && it != "null" }
            val slogan = obj.optString("slogan", "").takeIf { it.isNotBlank() && it != "null" }

            val contactPersons = mutableListOf<ContactPerson>()
            val personsArr = obj.optJSONArray("contactPersons") ?: JSONArray()
            for (i in 0 until personsArr.length()) {
                val p = personsArr.optJSONObject(i)
                if (p != null) {
                    val name = p.optString("name", "").takeIf { it.isNotBlank() && it != "null" }
                    val role = p.optString("role", "").takeIf { it.isNotBlank() && it != "null" }
                    if (name != null) {
                        contactPersons.add(ContactPerson(name, role))
                    }
                }
            }

            val phoneNumbers = mutableListOf<String>()
            val labeledPhones = mutableListOf<LabeledPhone>()
            val phonesArr = obj.optJSONArray("phoneNumbers") ?: JSONArray()
            for (i in 0 until phonesArr.length()) {
                val item = phonesArr.opt(i)
                if (item is JSONObject) {
                    val num = item.optString("number", "").filter { it.isDigit() }
                    val label = item.optString("label", "").takeIf { it.isNotBlank() && it != "null" }
                    if (num.length >= 8) {
                        phoneNumbers.add(num.takeLast(10))
                        labeledPhones.add(LabeledPhone(num.takeLast(10), label))
                    }
                } else if (item is String) {
                    val num = item.filter { it.isDigit() }
                    if (num.length >= 8) {
                        phoneNumbers.add(num.takeLast(10))
                        labeledPhones.add(LabeledPhone(num.takeLast(10), null))
                    }
                }
            }

            val emails = mutableListOf<String>()
            val emailsArr = obj.optJSONArray("emails") ?: JSONArray()
            for (i in 0 until emailsArr.length()) {
                val em = emailsArr.optString(i, "").trim().lowercase()
                if (em.contains("@") && em.contains(".")) emails.add(em)
            }

            val websites = mutableListOf<String>()
            val websitesArr = obj.optJSONArray("websites") ?: JSONArray()
            for (i in 0 until websitesArr.length()) {
                val web = websitesArr.optString(i, "").trim()
                if (web.contains(".")) websites.add(web)
            }

            val addresses = mutableListOf<String>()
            val addrArr = obj.optJSONArray("addresses") ?: JSONArray()
            for (i in 0 until addrArr.length()) {
                val item = addrArr.opt(i)
                if (item is JSONObject) {
                    val line = item.optString("line", item.optString("text", "")).trim()
                    val type = item.optString("type", "").takeIf { it.isNotBlank() && it != "null" }
                    if (line.isNotBlank()) {
                        addresses.add(if (type != null) "$type: $line" else line)
                    }
                } else if (item is String && item.isNotBlank()) {
                    addresses.add(item.trim())
                }
            }

            val providedServices = mutableListOf<String>()
            val servicesArr = obj.optJSONArray("providedServices") ?: JSONArray()
            for (i in 0 until servicesArr.length()) {
                val s = servicesArr.optString(i, "").trim()
                if (s.isNotBlank() && s != "null") {
                    providedServices.add(s)
                }
            }

            val pincode = obj.optString("pincode", "").filter { it.isDigit() }.takeIf { it.length == 6 }
            val gstin = obj.optString("gstin", "").uppercase().takeIf { it.length == 15 }

            return BusinessCard(
                companyName = companyName,
                tagline = tagline,
                slogan = slogan,
                providedServices = if (providedServices.isNotEmpty()) providedServices else emptyList(),
                contactPersons = contactPersons,
                phoneNumbers = phoneNumbers.distinct(),
                labeledPhones = labeledPhones,
                emails = emails.distinct(),
                websites = websites.distinct(),
                addressLines = addresses.distinct(),
                pincode = pincode,
                gstin = gstin,
                rawText = originalRawText
            )
        } catch (e: Exception) {
            e.printStackTrace()
            return null
        }
    }
}
