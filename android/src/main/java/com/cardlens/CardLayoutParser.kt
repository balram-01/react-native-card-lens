package com.cardlens

/**
 * Pure Kotlin layout-based heuristics engine for business cards.
 *
 * Uses ML Kit TextBlock and TextLine bounding-box geometry to infer:
 *  - [guessCompanyName]: Multi-signal scorer: font size, position, entity suffix, capitalization.
 *  - [guessPersonAndRole]: Column-aware parsing. Detects persons without role/salutation via
 *                          Title Case heuristic. Expanded role keyword list (50+ modern titles).
 *  - [guessAddressLines]: Spatial proximity expansion — seed line + adjacent continuation lines.
 *  - [guessTagline]: Short non-numeric line(s) between company name and address.
 *  - [clusterIntoColumns]: 2D column grouping to prevent multi-column interleaving bugs.
 *
 * Zero Android framework dependencies, fully deterministic, fast & unit-testable.
 */
object CardLayoutParser {

    // ── Configurable Keyword Sets ────────────────────────────────────────────

    /**
     * Common religious invocations, mottos and blessings
     * that should be excluded from company names, taglines, and person names.
     */
    val RELIGIOUS_INVOCATIONS: Set<String> = setOf(
        "परमात्मा एक", "श्री गणेशाय नमः", "श्री गणेशाय नम", "श्री स्वामी समर्थ",
        "जय माता दी", "ॐ", "ओम", "अल्लाह", "786", "सत्यमेव जयते",
        "ੴ", "एक ओंकार", "जय श्री राम", "शुभ लाभ", "हर हर महादेव",
        "प्रसन्न", "देवी प्रसन्न", "श्री प्रसन्न", "कुलदैवत प्रसन्न",
        "श्री जानूबाई देवी प्रसन्न", "श्री महालक्ष्मी प्रसन्न", "श्री तुळजाभवानी प्रसन्न",
        "jai mata di", "om", "ganesh"
    )

    /**
     * Statutory and commercial entity indicators (Devanagari & English).
     * These must appear as clear company suffixes/designations.
     * Prefer longer, more specific indicators to reduce false positives.
     */
    val COMPANY_INDICATORS: Set<String> = setOf(
        // Devanagari
        "प्रा. लि.", "प्रा.लि.", "मार्केटींग", "मार्केटिंग", "सेल्स",
        "एंटरप्रायझेस", "एंटरप्रायजेस", "ट्रेडर्स", "उद्योग", "कंपनी", "ग्रुप",
        "इंजिनिअरिंग", "डेव्हलपर्स", "अॅन्ड", "अँड", "सर्व्हिसेस",
        "हॉस्पिटल", "अकॅडमी", "इन्स्टिट्यूट", "फाउंडेशन",
        "फर्निचर", "इलेक्ट्रॉनिक्स", "इलेक्ट्रॉनिक", "स्टील", "स्टिल",
        "ऑटोमोबाईल्स", "वस्त्रनिकेतन", "साडी सेंटर", "साडी", "फॅशन साडी", "फॅशन", "ज्वेलर्स",
        // English — specific entity suffixes (multi-word first to avoid partial matches)
        "PVT. LTD.", "PVT LTD", "PVT. LTD", "LTD.", "LTD", "LIMITED",
        "ENTERPRISES", "TRADERS", "MARKETING", "INDUSTRIES",
        "DEVELOPERS", "SOLUTIONS", "SYSTEMS", "TECHNOLOGIES",
        "VENTURES", "HOLDINGS", "INTERNATIONAL", "BROTHERS", "BROS.",
        "CONSTRUCTION", "BUILDERS", "CONTRACTORS", "SUPPLIERS",
        "DISTRIBUTORS", "EXPORTS", "IMPORTS", "PHARMACEUTICALS", "PHARMA",
        "CHEMICALS", "METALS", "TEXTILES", "FOODS", "BEVERAGES",
        "CONSULTING", "MANAGEMENT", "INFRASTRUCTURE", "CAPITAL",
        "FOUNDATION", "TRUST", "SOCIETY", "LLP", "INC", "INC.", "LLC",
        // Retail, Food, Telecom & Consultancy
        "CAKES", "INN", "BAKERY", "CAFE", "SWEETS", "RESTAURANT", "HOTEL",
        "JEWELLERS", "JEWELERS", "CLOTHING", "FASHION", "SAREE", "MOTORS",
        "AUTO", "ELECTRONICS", "OPTICAL", "CLINIC", "DENTAL", "LAB", "SALON",
        "SPA", "FITNESS", "GYM", "TRAVELS", "LOGISTICS", "TELECOM", "COMMUNICATIONS",
        "COMMUNICATION", "CONSULTANCY", "ASTROLOGICAL", "ASTROLOGY",
        "MAKEOVER", "MAKEOVERS", "BEAUTY", "PARLOUR", "PARLOR", "SALON", "STUDIO", "BOUTIQUE",
        "CREATION", "CREATIONS", "COLLECTION", "COLLECTIONS", "KITCHEN", "CUISINE",
        "ACADEMY", "CLASSES",
        "FURNITURE", "STEEL", "SWITCHGEARS", "SWITCHGEAR", "ELECTRICALS", "ELECTRICAL",
        "LIGHTING", "POWER SYSTEMS",
        // Short but unambiguous
        "CORP", "CO.", "CO", "GROUP", "ASSOCIATES"
    )

    /**
     * Person name prefixes / salutations (English & Devanagari).
     */
    val NAME_SALUTATIONS: List<String> = listOf(
        "Mr.", "Mr", "Mrs.", "Mrs", "Ms.", "Ms", "Dr.", "Dr", "Prof.", "Prof",
        "Shri", "Smt.", "Smt", "Er.", "Er", "Adv.", "Adv", "CA.", "CA", "CS.", "CS",
        "Hon.", "Hon", "Rev.", "Capt.", "Col.", "Major",
        "श्री.", "श्री", "श्रीमती.", "श्रीमती", "सौ.", "सौ", "डॉ.", "डॉ", "प्रा.", "अॅड.", "अ‍ॅड."
    )

    /**
     * Expanded role titles covering modern, professional, creative, medical, legal, and industrial designations.
     * 150+ keywords in English + Devanagari.
     */
    val DEFAULT_ROLE_KEYWORDS: Set<String> = setOf(
        // C-Suite & Executive
        "CEO", "CTO", "CFO", "COO", "CMO", "CIO", "CHRO", "CPO", "CSO", "CRO",
        "FOUNDER", "CO-FOUNDER", "COFOUNDER", "CO FOUNDER",
        "MANAGING DIRECTOR", "MD", "DIRECTOR", "EXECUTIVE DIRECTOR", "JOINT DIRECTOR",
        "PRESIDENT", "VICE PRESIDENT", "VP", "SVP", "EVP", "AVP",
        "CHAIRMAN", "CHAIRPERSON", "MANAGING TRUSTEE", "TRUSTEE",
        // Management
        "GENERAL MANAGER", "GM", "MANAGER", "SR. MANAGER", "SENIOR MANAGER",
        "ASSISTANT MANAGER", "DEPUTY MANAGER", "BRANCH MANAGER",
        "AREA MANAGER", "REGIONAL MANAGER", "ZONAL MANAGER", "OPERATIONS MANAGER",
        "BUSINESS DEVELOPMENT MANAGER", "BDM", "RELATIONSHIP MANAGER",
        // Owner / Proprietor / Partners
        "OWNER", "PROPRIETOR", "PROP.", "PROP", "PARTNER", "MANAGING PARTNER",
        "SENIOR PARTNER", "CO-OWNER", "ASSOCIATE", "PRINCIPAL",
        // Professional / Specialist
        "CONSULTANT", "SR. CONSULTANT", "SENIOR CONSULTANT", "CHIEF CONSULTANT",
        "ADVISOR", "STRATEGIST", "ANALYST", "SPECIALIST", "EXPERT",
        "ENGINEER", "CHIEF ENGINEER", "ARCHITECT", "DEVELOPER", "DESIGNER",
        "PRODUCT MANAGER", "PROJECT MANAGER", "PROGRAM MANAGER", "ACCOUNT MANAGER",
        // Legal & Regulatory
        "ADVOCATE", "SENIOR ADVOCATE", "LAWYER", "ATTORNEY", "SOLICITOR", "BARRISTER",
        "LEGAL COUNSEL", "GENERAL COUNSEL", "LEGAL ADVISOR", "NOTARY", "NOTARY PUBLIC",
        "CHARTERED ACCOUNTANT", "CA", "CS", "COMPANY SECRETARY",
        "COST ACCOUNTANT", "AUDITOR", "TAX CONSULTANT", "GST PRACTITIONER", "FINANCIAL ADVISOR",
        // Medical & Healthcare
        "DOCTOR", "PHYSICIAN", "SURGEON", "CHIEF SURGEON", "DENTIST", "ORTHODONTIST",
        "CONSULTANT PHYSICIAN", "DERMATOLOGIST", "CARDIOLOGIST", "PEDIATRICIAN",
        "GYNECOLOGIST", "OBSTETRICIAN", "NEUROLOGIST", "NEUROSURGEON", "ORTHOPEDIC SURGEON",
        "OPHTHALMOLOGIST", "ENT SURGEON", "RADIOLOGIST", "PATHOLOGIST", "ANESTHETIST",
        "PSYCHIATRIST", "PHYSIOTHERAPIST", "VETERINARIAN", "HOMEOPATH", "AYURVEDIC PHYSICIAN",
        "VAIDYA", "RMO", "MEDICAL DIRECTOR", "PHARMACIST",
        // Academic & Research
        "PROFESSOR", "ASST. PROFESSOR", "ASSOCIATE PROFESSOR", "LECTURER",
        "PRINCIPAL", "DEAN", "VICE CHANCELLOR", "HEAD OF DEPARTMENT", "HOD",
        "RESEARCH SCHOLAR", "SCIENTIST", "CHIEF SCIENTIST", "TRAINER", "COACH",
        // Sales, Marketing & Real Estate
        "SALES EXECUTIVE", "SALES MANAGER", "MARKETING EXECUTIVE", "MARKETING HEAD",
        "BUSINESS EXECUTIVE", "EXECUTIVE", "ESTATE AGENT", "PROPERTY CONSULTANT",
        "BUILDER & DEVELOPER", "GOVT CONTRACTOR", "GOVERNMENT CONTRACTOR",
        "AUTHORIZED DEALER", "AUTHORISED DEALER", "DISTRIBUTOR", "STOCKIST",
        // Tech & Creative
        "TECH LEAD", "TEAM LEAD", "FULL STACK", "FRONTEND", "BACKEND", "DEVOPS",
        "SOLUTION ARCHITECT", "ENTERPRISE ARCHITECT", "CHIEF ARCHITECT",
        "DATA SCIENTIST", "ML ENGINEER", "AI ENGINEER", "PRODUCT DESIGNER",
        "UI DESIGNER", "UX DESIGNER", "GRAPHIC DESIGNER", "CREATIVE DIRECTOR",
        "ART DIRECTOR", "BRAND MANAGER", "SCRUM MASTER",
        // Admin
        "ADMINISTRATOR", "SECRETARY", "COORDINATOR", "SUPERVISOR",
        "INSPECTOR", "OFFICER", "AGENT",
        // Devanagari equivalents
        "डायरेक्टर", "संचालक", "व्यवस्थापकीय संचालक", "मुख्य कार्यकारी अधिकारी",
        "संस्थापक", "सह-संस्थापक", "अध्यक्ष", "उपाध्यक्ष",
        "व्यवस्थापक", "महाव्यवस्थापक", "विक्री व्यवस्थापक",
        "मालक", "प्रोप्राईटर", "भागीदार", "कायदेशीर सल्लागार", "वरिष्ठ सल्लागार",
        "सल्लागार", "कर सल्लागार", "हिशोबनीस", "सरकारी कंत्राटदार", "अधिकृत वितरक",
        "कार्यकारी", "वकील", "डॉक्टर", "वैद्य", "दंतवैद्य", "शल्यचिकित्सक", "बालरोगतज्ज्ञ",
        "अभियंता", "प्राचार्य", "उपप्राचार्य", "विभागप्रमुख",
        "प्राध्यापक", "शिक्षक"
    )

    /**
     * Location / address keywords commonly appearing in business card addresses.
     * Configurable: callers can supply their own list or use defaults.
     */
    val DEFAULT_LOCATION_KEYWORDS: Set<String> = setOf(
        // English — General
        "road", "rd", "street", "st", "lane", "nagar", "chowk", "square",
        "sqsre", "sqaure", "colony", "layout", "building", "bldg", "floor", "tower", "plot",
        "sector", "phase", "opposite", "opp", "near", "behind", "complex",
        "appartment", "apartment", "chambers", "plaza", "naka", "octroi", "putla", "pass",
        "under pass", "bazaar", "market", "arcade", "mansions", "center", "centre",
        "avenue", "park", "estate", "midc", "industrial area", "indl area",
        "marg", "gali", "rasta", "cross", "dist", "dist.", "state",
        "flat", "shop", "office", "no.", "pincode", "pin", "res add", "office add",
        "add:", "address", "next to", "above", "below", "adj",
        // US/UK style
        "suite", "ste", "blvd", "boulevard", "highway", "hwy", "expressway",
        "suburb", "district", "county", "borough", "zip", "postal code",
        // Indian cities (major)
        "mumbai", "pune", "delhi", "bengaluru", "bangalore", "hyderabad",
        "chennai", "kolkata", "ahmedabad", "surat", "jaipur", "nagpur",
        "lucknow", "kanpur", "noida", "gurgaon", "gurugram",
        "indore", "thane", "bhopal", "visakhapatnam", "vizag", "patna",
        "vadodara", "baroda", "kochi", "cochin", "coimbatore", "nashik",
        "aurangabad", "solapur", "amritsar", "chandigarh", "rajkot",
        // Devanagari location, landmark and address prefixes
        "रोड", "नगर", "चौक", "रस्ता", "मार्ग", "गल्ली", "कॉलनी", "संकुल",
        "सोसायटी", "प्लॉट", "मजला", "जवळ", "समोर", "मागे", "इस्टेट", "दुकान",
        "कार्यालय", "जि.", "पिन", "पत्ता", "ऑफीस", "के पास", "के सामने", "के पीछे",
        "मंदिर", "मंदीर", "न्यु", "न्यू", "नागपूर", "पुणे", "मुंबई", "नाशिक",
        "ठाणे", "औरंगाबाद", "खरबी", "डायमंड", "नगर",
        "शेजारी", "पेट्रोलपंप", "पेट्रोलपंपा", "ता.", "ता", "तालुका", "जिल्हा",
        "पंढरपूर", "टेंभुर्णी", "भोसे", "सोलापूर",
        "sitabuldi", "dharampeth", "sadar", "gandhibagh", "hingna", "manish nagar",
        "laxmi nagar", "maharaj bag", "amsterdam", "netherland",
        "बडकस", "बडकस चौक", "मानेवाडा", "धरमपेठ", "सिताबर्डी"
    )

    // Slogan emotional keywords
    val SLOGAN_KEYWORDS: Set<String> = setOf(
        "सोच", "जिंदगी", "विश्वास", "सेवा", "गुणवत्ता", "सत्य", "प्रगती", "ध्येय",
        "माहेरघर", "लग्न बस्त्याचे",
        "quality", "trusted", "service", "innovate", "excellence", "growth", "best",
        "vision", "mission", "dedication", "commitment", "integrity", "passion",
        "transform", "empower", "inspire", "solution", "future", "premier", "leading"
    )

    // Business description & category keywords
    val TAGLINE_BUSINESS_KEYWORDS: Set<String> = setOf(
        "wholesaler", "retailer", "whole seller", "dealer", "distributor", "stockist",
        "manufacturer", "supplier", "solutions", "services", "sales & service",
        "sales and service", "high quality", "all types of", "all kinds of",
        "goods", "spares", "parts", "systems", "technologies", "technology", "pioneering",
        "intelligent", "innovative", "engineering", "consulting", "automation",
        "logistics", "industries", "enterprise",
        "सेल्स", "सर्व्हिस", "स्पेअर्स", "विक्रेते", "उत्पादक", "दुरुस्ती",
        "ई-रिक्षा", "ई-बाईक", "रिक्षा", "बाईक", "दुकान",
        "होलसेल", "होलसेल दरात", "मिळतील", "कम्पलीट", "कम्प्लीट", "फॅमिली शॉप"
    )

    // Keywords for goods, digital badges, astrology tokens, and words that must NEVER be person names
    val NON_PERSON_KEYWORDS: Set<String> = setOf(
        // Audience, demographics & retail customer specializations
        "only ladies", "ladies only", "only gents", "gents only", "only kids", "kids only",
        "for ladies", "for gents", "for kids", "women only", "men only", "family salon",
        "all types of", "all kinds of", "wholesale & retail", "wholesale and retail",
        "dealers in", "specialists in", "specialist in", "exclusive showroom", "exclusive store",
        "open 24 hours", "home delivery", "free delivery",
        "फक्त महिलांसाठी", "महिलांसाठी", "फक्त लेडीज", "लेडीज स्पेशल",
        // IT, Surveillance, Security, Repairing & Service Offerings
        "our services", "services", "products", "offerings", "specialities", "solutions",
        "computer", "computers", "laptop", "laptops", "printer", "printers", "cctv", "cctv camera",
        "camera", "cameras", "door lock", "door lock system", "lock system", "intercom", "epbx", "epabx",
        "intercom system", "networking", "biometric", "attendance machine", "video door phone",
        "door phone", "repairing", "refilling", "recovery", "data recovery", "maintenance", "amc",
        "annual maintenance", "tonner", "toner", "tonner refilling", "toner refilling", "installation",
        "surveillance", "access control", "fire alarm", "security systems", "hardware", "software",
        "cartridge", "ink refill", "antivirus", "anti virus", "system", "systems",
        // Marathi trade / service keywords
        "दुरुस्ती", "सर्व्हिसिंग", "देखभाल", "इन्स्टॉलेशन", "नेटवर्किंग", "कम्प्युटर", "लॅपटॉप", "प्रिंटर",
        "सीसीटीव्ही", "कॅमेरा", "आमच्या सेवा", "सेवा",
        // Fitness, Gym, Training, Sports & Wellness Offerings
        "transformation", "zumba", "crossfit", "pilates", "aerobics", "six pack", "abs blast",
        "diet plan", "wellness", "boot camp", "cardio", "weight training", "lose weight", "yoga",
        "marathon", "qubo training", "ramfit training", "sunsalutation", "sun salutation", "cpr aed",
        "never give up", "no pain no gain", "functional programme", "functional training",
        "coach diet plan", "workout", "outdoor workout", "endurance", "strength training", "agility",
        "v-shape", "martial arts", "kick boxing", "body building", "sports training", "gym workout",
        "training", "trainings", "gym", "fitness",
        // Digital badges, stores & app download instructions
        "app store", "google play", "play store", "download", "scan", "qr", "qr code", "code", "app", "apps",
        "get it on", "dowrod", "from", "app from", "click here", "scan qr", "scan qr code", "ios", "android",
        "get it", "on the",
        // Astrology, Zodiac, Planets & Vedic Rituals
        "राशि", "राशी", "कुंडली", "मकर", "वृश्चिक", "धनु", "तुला", "मेष", "वृषभ", "मिथुन", "कर्क", "सिंह", "कन्या", "कुंभ", "मीन",
        "सूर्य", "सुर्य", "चंद्र", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "राहु", "केतु", "बृहस्पति", "ग्रह", "नक्षत्र", "पूजा", "हवन", "rituals",
        "zodiac", "horoscope", "astrology", "numerology", "tarot", "healing", "vastu", "gemstones", "gems", "stone", "stones", "consultancy",
        "vedic astrology", "astro numerology", "puja rituals", "pranic", "pranic healing",
        // Sports, merchandise, industrial
        "carrom", "carron", "board", "cricket", "bat", "ball", "tennis", "badminton", "football",
        "volleyball", "basketball", "racket", "shuttle", "shuttlecock", "trophy", "trophies",
        "fitness", "gym", "sports", "sport", "goods", "equipment", "spares", "parts", "hardware",
        "tools", "bearings", "chemicals", "paints", "pipes", "fittings", "valves", "motors", "pumps",
        "machinery", "cables", "wires", "garments", "clothing", "textiles", "fabrics", "saree",
        "shoes", "footwear", "furniture", "jewellery", "jewelry", "mobiles", "stationery", "books",
        "toys", "sweets", "bakery", "dairy", "grocery", "medical", "surgical", "pharma", "e-rickshaw",
        "e-bike", "rickshaw", "bike", "sales", "service", "retailer", "wholesaler", "dealer", "distributor",
        // Address & Building
        "appartment", "apartment", "complex", "chambers", "plaza", "square", "road", "street",
        "lane", "octroi", "naka", "putla", "pass", "under pass", "layout", "colony", "nagar",
        "market", "bazaar", "center", "centre", "tower", "building", "bldg", "floor", "mansions",
        "palace", "enclave", "plot", "shop", "office", "flat", "outlet", "branch",
        // Furniture / appliances in Marathi
        "सोफासेट", "सोफा", "डायनिंग", "टेबल", "कपाट", "फ्रिज", "कुलर", "भांडी", "इलेक्ट्रॉनिक्स", "इलेक्ट्रॉनिक",
        "फर्निचर", "स्टील", "स्टिल", "होलसेल", "पेट्रोलपंप", "पेट्रोलपंपा", "शेजारी", "माहेरघर", "वस्तु", "बस्त्याचे", "लग्नकार्यासाठी"
    )

    /**
     * Checks whether a text line is an inspirational quote, slogan, or commercial tagline
     * rather than an address continuation line.
     */
    fun isSloganOrTagline(text: String): Boolean {
        val clean = text.trim()
        val lower = clean.lowercase()
        if ((clean.startsWith("\"") && clean.endsWith("\"")) ||
            (clean.startsWith("“") && clean.endsWith("”"))) return true
        if (clean.contains("...") || clean.contains("…")) return true
        if (SLOGAN_KEYWORDS.any { lower.contains(it) }) return true
        if (TAGLINE_BUSINESS_KEYWORDS.any { lower.contains(it) }) return true
        return false
    }

    // ── Core Layout Parsing ──────────────────────────────────────────────────

    /**
     * Parse structured card layout from the hierarchy of TextBlocks.
     *
     * Pipeline:
     *  1. Cluster lines into visual columns (prevents multi-column interleaving).
     *  2. Guess Company Name (multi-signal scorer).
     *  3. Guess Contact Persons & Roles (column-aware, Title Case fallback).
     *  4. Guess Address Lines (seed + proximity expansion).
     *  5. Guess Tagline.
     */
    fun parseLayout(
        blocks: List<RawBlock>,
        roleKeywords: Set<String> = DEFAULT_ROLE_KEYWORDS,
        locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS
    ): CardLayoutFields {
        if (blocks.isEmpty()) {
            return CardLayoutFields(
                companyName = null,
                tagline = null,
                slogan = null,
                contactPersons = emptyList(),
                addressLines = emptyList()
            )
        }

        val allLines = blocks.flatMap { it.lines }
            .sortedBy { it.boundingBox.top }

        // Cluster all lines into columns for column-aware parsing
        val columns = clusterIntoColumns(allLines)

        val usedLineTexts = mutableSetOf<String>()

        // 1. Guess Company Name (multi-signal scoring)
        val (companyName, companyBlock) = guessCompanyName(blocks)
        if (companyName != null) usedLineTexts.add(companyName.trim())
        companyBlock?.lines?.forEach { usedLineTexts.add(it.text.trim()) }
        companyBlock?.text?.lines()?.forEach { usedLineTexts.add(it.trim()) }
        companyName?.split(" ")?.filter { it.length > 2 }?.forEach { usedLineTexts.add(it.trim()) }

        // 2. Pre-extract Provided Services & Offerings (bullet points, "OUR SERVICES" section, product lists)
        val providedServices = guessProvidedServices(allLines, usedLineTexts)
        providedServices.forEach { usedLineTexts.add(it.trim()) }
        allLines.forEach { l ->
            val t = l.text.trim()
            if (BULLET_PREFIX_REGEX.containsMatchIn(t) || SERVICES_SECTION_HEADER_REGEX.matches(t)) {
                usedLineTexts.add(t)
                usedLineTexts.add(t.replace(BULLET_PREFIX_REGEX, "").trim())
            }
        }

        // 3. Guess Contact Persons & Roles (column-aware)
        val contactPersons = guessPersonAndRole(columns, roleKeywords, usedLineTexts)
        contactPersons.forEach { person ->
            usedLineTexts.add(person.name.trim())
            person.role?.let { usedLineTexts.add(it.trim()) }
        }

        // 4. Guess Slogan / Quote
        val slogan = guessSlogan(allLines, usedLineTexts)
        if (slogan != null) usedLineTexts.add(slogan.trim())

        // 5. Guess Address Lines (proximity clustering, strictly guarding against slogans/taglines)
        val addressLines = guessAddressLines(allLines, locationKeywords, usedLineTexts)
        addressLines.forEach { usedLineTexts.add(it.trim()) }

        // 6. Guess Tagline (short line / business description)
        val tagline = guessTagline(allLines, companyBlock, addressLines, usedLineTexts)
        if (tagline != null) usedLineTexts.add(tagline.trim())

        return CardLayoutFields(
            companyName = companyName,
            tagline = tagline ?: slogan,
            slogan = slogan,
            providedServices = providedServices,
            contactPersons = contactPersons,
            addressLines = addressLines
        )
    }

    /**
     * Extracts lists of offered services, products, or merchandise
     * (e.g. "MCB Box, Junction Box, Fan Box, Modular Box, Concealed Box etc.").
     */
    fun guessProvidedServices(allLines: List<RawLine>, usedLineTexts: Set<String>): List<String> {
        val result = mutableListOf<String>()
        val headerLine = allLines.firstOrNull { SERVICES_SECTION_HEADER_REGEX.matches(it.text.trim()) }
        val headerTop = headerLine?.boundingBox?.bottom ?: -1

        for (line in allLines) {
            val raw = line.text.trim()
            if (raw.isBlank() || usedLineTexts.contains(raw) || isContactInfo(raw) || looksLikePureAddress(raw) || isReligiousInvocation(raw)) continue
            if (SERVICES_SECTION_HEADER_REGEX.matches(raw)) continue

            val hasBullet = BULLET_PREFIX_REGEX.containsMatchIn(raw)
            val isUnderHeader = headerTop >= 0 && line.boundingBox.top >= headerTop - 10
            val looksLikeList = looksLikeProductOrServiceList(raw)
            val lower = raw.lowercase()
            val hasServiceKw = listOf("repairing", "refilling", "maintenance", "recovery", "installation", "networking", "biometric", "intercom", "cctv", "camera", "door lock", "amc", "attendance").any { lower.contains(it) }

            if (hasBullet || (isUnderHeader && (hasBullet || raw.length in 3..45)) || looksLikeList || hasServiceKw) {
                val clean = raw.replace(BULLET_PREFIX_REGEX, "").trim()
                if (clean.isNotBlank() && clean.length > 1 && !SERVICES_SECTION_HEADER_REGEX.matches(clean)) {
                    result.addAll(parseServicesList(clean))
                }
            }
        }
        return result.distinct()
    }

    // ── Heuristic Functions ──────────────────────────────────────────────────

    /**
     * Cluster lines into visual reading columns using X-coordinate centers.
     *
     * Prevents multi-column interleaving: when two founders are side-by-side
     * (Name A, Name B in a row), sorting by top alone interleaves them.
     * Instead, group lines whose horizontal centers are within the same column
     * band, then sort each column top-to-bottom.
     *
     * @param lines all lines, pre-sorted by Y (top).
     * @return list of columns, each column is lines sorted top-to-bottom.
     */
    fun clusterIntoColumns(lines: List<RawLine>): List<List<RawLine>> {
        if (lines.isEmpty()) return emptyList()

        val cardWidth = lines.maxOfOrNull { it.boundingBox.right } ?: 1000
        // Column threshold: lines within 30% of card width are in the same column
        val colThreshold = (cardWidth * 0.30).toInt().coerceAtLeast(80)

        val columns = mutableListOf<MutableList<RawLine>>()

        for (line in lines.sortedBy { it.boundingBox.top }) {
            val center = (line.boundingBox.left + line.boundingBox.right) / 2
            val matchedColumn = columns.firstOrNull { col ->
                val colCenter = col.map { (it.boundingBox.left + it.boundingBox.right) / 2 }.average()
                kotlin.math.abs(colCenter - center) <= colThreshold
            }
            if (matchedColumn != null) {
                matchedColumn.add(line)
            } else {
                columns.add(mutableListOf(line))
            }
        }

        // Sort each column top-to-bottom
        return columns.map { col -> col.sortedBy { it.boundingBox.top } }
            .sortedBy { col -> col.firstOrNull()?.boundingBox?.left ?: 0 } // left-to-right column order
    }

    /**
     * Check if a text contains a company/entity indicator.
     * For shorter indicators (< 5 chars), they must appear at the start or end of the text
     * to avoid matching common English words mid-sentence.
     */
    private val COMPANY_INDICATORS_UPPER by lazy { COMPANY_INDICATORS.map { it.uppercase() }.toSet() }
    private val COMPANY_MULTI_WORD by lazy { COMPANY_INDICATORS.filter { it.contains(" ") || it.contains(".") }.map { it.uppercase() } }

    fun hasCompanyIndicator(text: String): Boolean {
        if (text.isBlank()) return false
        // Commercial possessive brand: e.g. "Ishani's Makeover", "Raju's Kitchen"
        if (Regex("""\b[A-Za-z0-9&]+'s\s+[A-Za-z0-9&]+""", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            return true
        }
        val upper = text.uppercase().trim()
        val tokens = upper.split(TOKEN_DELIMITERS)
        for (token in tokens) {
            if (token.isNotEmpty() && COMPANY_INDICATORS_UPPER.contains(token)) {
                if (token.length <= 5 && !token.contains(".")) {
                    if (upper.endsWith(" $token") || upper == token || upper.endsWith(", $token")) return true
                } else {
                    return true
                }
            }
        }
        for (mw in COMPANY_MULTI_WORD) {
            if (upper.contains(mw)) return true
        }
        return false
    }

    fun isReligiousInvocation(text: String): Boolean {
        val clean = text.trim()
        if ((clean.startsWith("॥") || clean.startsWith("||") || clean.startsWith("|")) &&
            (clean.endsWith("॥") || clean.endsWith("||") || clean.endsWith("|"))) {
            return true
        }
        // Text containing explicit company indicators (e.g. OM INDUSTRIES, OM ENTERPRISES) is never a religious invocation
        if (hasCompanyIndicator(clean)) {
            return false
        }

        val lower = clean.lowercase()
        for (inv in RELIGIOUS_INVOCATIONS) {
            if (inv.equals("om", ignoreCase = true) || inv == "ॐ" || inv == "ओम") {
                val words = lower.split(TOKEN_DELIMITERS).filter { it.isNotBlank() }
                if (words.size <= 3 && (words.contains("om") || words.contains("ॐ") || words.contains("ओम") ||
                    lower.contains("om namah") || lower.contains("om sai") || lower.contains("om shree ganesh"))) {
                    return true
                }
            } else {
                if (lower.contains(inv.lowercase())) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * Strips any inline religious invocations (e.g. "!! श्री जानूबाई देवी प्रसन्न !!") from a line,
     * allowing person names or contact details on the same line to be recovered.
     */
    fun stripReligiousInvocation(text: String): String {
        var clean = text.trim()
        clean = clean.replace(Regex("(?:!!|॥|\\|\\|)?\\s*(?:परमात्मा\\s*एक|श्री\\s*[\\p{L}\\p{M}\\s]+(?:प्रसन्न|नमः|कृपा)|श्री\\s*गणेशाय\\s*नमः|स्वामी\\s*समर्थ|[\\p{L}\\p{M}\\s]+प्रसन्न|ॐ\\s*नमः\\s*शिवाय|जय\\s*माता\\s*दी)\\s*(?:!!|॥|\\|\\|)?|॥\\s*श्री\\s*॥|!!\\s*[\\p{L}\\p{M}\\s]+प्रसन्न\\s*!!"), "")
        clean = clean.replace(Regex("^[|॥!]+\\s*|\\s*[|॥!]+$"), "")
        return clean.trim()
    }

    /**
     * Checks whether a text line or block represents a list of offered goods, services, or products
     * (e.g. "MCB Box, Junction Box, Fan Box, Modular Box, Concealed Box etc.").
     */
    fun looksLikeProductOrServiceList(text: String): Boolean {
        val clean = text.trim()
        val lower = clean.lowercase()

        // Location lines and company trade titles with conjunctions (e.g. "स्टील, फर्निचर अॅन्ड इलेक्ट्रॉनिक्स") are not product lists
        if (matchesLocationKeyword(lower)) return false
        if (clean.contains("अॅन्ड") || clean.contains(" & ") || clean.contains(" AND ", ignoreCase = true) ||
            clean.endsWith("pvt ltd", ignoreCase = true) || clean.endsWith("ltd", ignoreCase = true) ||
            clean.contains("सोल्युशन्स", ignoreCase = true) || clean.contains("solutions", ignoreCase = true)) {
            return false
        }

        val endsWithEtc = lower.endsWith("etc.") || lower.endsWith("etc") ||
                          lower.endsWith("and more") || lower.endsWith("इत्यादी") || lower.endsWith("आदी")

        val commaCount = clean.count { it == ',' }

        val productKeywords = setOf(
            "box", "boxes", "mcb", "fan box", "junction box", "modular box", "concealed box",
            "spares", "parts", "fittings", "pipes", "valves", "cables", "wires", "switches",
            "switchgears", "hardware", "tools", "motors", "pumps", "appliances", "equipment",
            "accessories", "goods", "items", "stationery", "garments", "textiles", "fabrics",
            // Indic / Marathi goods and product keywords
            "सोफासेट", "सोफा", "कपाट", "टेबल", "फ्रिज", "कुलर",
            "भांडी", "वस्तु", "सामग्री", "होलसेल", "ऑईल चेंज", "टायर"
        )
        val hasProductKw = productKeywords.any { lower.contains(it) }

        val hasOfferingPrefix = lower.startsWith("dealing in") || lower.startsWith("dealers of") ||
                                lower.startsWith("dealers in") || lower.startsWith("all types of") ||
                                lower.startsWith("all kinds of") || lower.startsWith("manufacturers of") ||
                                lower.startsWith("mfg. of") || lower.startsWith("services:") ||
                                lower.startsWith("products:") || lower.startsWith("आमच्याकडे") ||
                                lower.startsWith("येथे") || lower.contains("मिळतील") || lower.contains("मिळेल")

        if (endsWithEtc && commaCount >= 1) return true
        if (hasOfferingPrefix) return true
        if (commaCount >= 2 && hasProductKw) return true
        if (commaCount >= 3 && hasProductKw) return true

        return false
    }

    /**
     * Parses a product/service line into individual clean items.
     */
    fun parseServicesList(text: String): List<String> {
        var clean = text.trim()
        clean = clean.replace(Regex("(?i)^(?:dealing in|dealers of|dealers in|all types of|all kinds of|manufacturers of|mfg\\. of|services:|products:)\\s*"), "")
        clean = clean.replace(Regex("(?i)[,\\s]*(?:etc\\.?|and more|इत्यादी|आदी)\\s*$"), "")

        return clean.split(Regex("[,;•▪|]+"))
            .map { it.trim().trimStart('-', '•', '▪', '*', '✔', '►', '>') }
            .filter { it.isNotBlank() && it.length > 1 }
    }

    fun matchSalutation(text: String): String? {
        val clean = text.trim()
        return NAME_SALUTATIONS.firstOrNull { prefix ->
            clean.startsWith(prefix, ignoreCase = true) &&
            (clean.length == prefix.length || clean[prefix.length].isWhitespace() || clean[prefix.length] == '.')
        }
    }

    /**
     * Guess Company Name:
     * Multi-signal scoring model:
     *  - Font height relative to card median (+30 pts for top 20% height)
     *  - Vertical position: top 40% of card (+20 pts), bottom 20% (-10 pts)
     *  - Entity suffix indicator (+100 pts: Pvt Ltd, Inc, ट्रेडर्स, etc.)
     *  - ALL_CAPS or Title Case brand name (+10 pts)
     *  - Rejects blocks that contain phone, email, website, or GSTIN
     *  - Allows mixed-contact blocks if they ALSO contain a company indicator
     *    (handles "Company Name\n+91 98220 11111" in same block)
     */
    fun guessCompanyName(blocks: List<RawBlock>): Pair<String?, RawBlock?> {
        if (blocks.isEmpty()) return Pair(null, null)

        val cardBottom = blocks.maxOfOrNull { it.boundingBox.bottom } ?: 1
        val cardTop = blocks.minOfOrNull { it.boundingBox.top } ?: 0
        val cardHeight = (cardBottom - cardTop).coerceAtLeast(1)

        // Pre-compute median line height across all blocks
        val allHeights = blocks.flatMap { b ->
            b.lines.map { l -> l.boundingBox.height }
        }.filter { it > 2 }.sorted()
        val medianHeight = if (allHeights.isEmpty()) 20
                           else allHeights[allHeights.size / 2]

        val candidates = blocks.filter { block ->
            val text = block.text.trim()
            text.isNotBlank() &&
            !isReligiousInvocation(text) &&
            !looksLikePureAddress(text) &&
            !looksLikeProductOrServiceList(text) &&
            !SERVICES_SECTION_HEADER_REGEX.matches(text) &&
            !BULLET_PREFIX_REGEX.containsMatchIn(text) &&
            // Reject blocks that contain ONLY contact info and NO company indicator
            !(FieldExtractor.extractPhoneNumbers(text).isNotEmpty() &&
              !hasCompanyIndicator(text)) &&
            !(FieldExtractor.extractEmails(text).isNotEmpty() &&
              !hasCompanyIndicator(text)) &&
            !(FieldExtractor.extractWebsites(text).isNotEmpty() &&
              !hasCompanyIndicator(text)) &&
            FieldExtractor.extractGstin(text).isEmpty()
        }

        if (candidates.isEmpty()) return Pair(null, null)

        val bestBlock = candidates.maxByOrNull { block ->
            var score = 0

            // Personal salutation / title penalty: prevent doctor/advocate names from taking company slot
            val lowerTrimmed = block.text.trim().lowercase()
            if (matchSalutation(block.text) != null ||
                lowerTrimmed.startsWith("dr.") || lowerTrimmed.startsWith("adv.") ||
                lowerTrimmed.contains("m.d.") || lowerTrimmed.contains("mbbs") ||
                lowerTrimmed.contains("consulting physician") || lowerTrimmed.contains("legal consultant")) {
                score -= 150
            }
            // 1. Font height score — raw pixel height is the primary signal.
            //    Multiply by 3 so a genuinely larger font dominates by a wide margin.
            val lineCount = block.lines.size.coerceAtLeast(1)
            val avgLineHeight = block.boundingBox.height / lineCount
            score += avgLineHeight * 3

            // 2. Vertical position bonus — company names are usually near the top
            val blockTop = block.boundingBox.top
            val relPos = (blockTop - cardTop).toDouble() / cardHeight
            score += when {
                relPos < 0.40 -> 20  // top 40% of card: +20 bonus
                relPos > 0.80 -> -10 // bottom 20% of card: slight penalty
                else -> 0
            }

            // 3. Entity suffix boost (secondary — only decisive when fonts are similar size)
            if (hasCompanyIndicator(block.text)) score += 25

            // 4. Capitalization style — minor boost
            val trimmed = block.text.trim()
            val words = trimmed.split(Regex("\\s+")).filter { it.isNotBlank() }
            val allCaps = words.all { w -> w.all { !it.isLetter() || it.isUpperCase() } }
            val titleCase = words.count { w -> w.firstOrNull()?.isUpperCase() == true } >= words.size / 2
            if (allCaps && words.size >= 2) score += 8
            else if (titleCase && words.size >= 2) score += 4

            score
        }

        // If the best block is a multi-line block containing both company & phone,
        // extract the company title lines (or merge with adjacent brand prefix block)
        val bestText = bestBlock?.let { block ->
            if (block.lines.size > 1) {
                val nonContactLines = block.lines.filter { line ->
                    val t = line.text.trim()
                    val lower = t.lowercase()
                    !isContactInfo(t) && !looksLikePureAddress(t) && !isReligiousInvocation(t) &&
                    !looksLikeProductOrServiceList(t) && t.count { it == ',' } < 2 &&
                    !TAGLINE_BUSINESS_KEYWORDS.any { lower.contains(it) } &&
                    !SLOGAN_KEYWORDS.any { lower.contains(it) } &&
                    !NON_PERSON_KEYWORDS.any { lower.contains(it) }
                }
                if (nonContactLines.isNotEmpty() && nonContactLines.size <= 2) {
                    nonContactLines.joinToString(" ") { it.text.trim() }
                } else {
                    val companyLine = block.lines.firstOrNull { hasCompanyIndicator(it.text) }
                        ?: block.lines.maxByOrNull { it.boundingBox.height }
                    companyLine?.text?.trim() ?: block.text.trim()
                }
            } else {
                val prefixBlock = blocks.firstOrNull { other ->
                    other != block &&
                    !isReligiousInvocation(other.text) &&
                    !isContactInfo(other.text) &&
                    !looksLikePureAddress(other.text) &&
                    !hasCompanyIndicator(other.text) &&
                    matchSalutation(other.text) == null &&
                    other.boundingBox.bottom <= block.boundingBox.top + 20 &&
                    block.boundingBox.top - other.boundingBox.bottom <= block.boundingBox.height * 1.5 &&
                    kotlin.math.abs(other.boundingBox.left - block.boundingBox.left) <= block.boundingBox.width &&
                    other.text.trim().length in 3..35
                }
                val suffixBlock = if (block.text.trim().endsWith("'s", ignoreCase = true)) {
                    blocks.firstOrNull { other ->
                        other != block &&
                        !isReligiousInvocation(other.text) &&
                        !isContactInfo(other.text) &&
                        !looksLikePureAddress(other.text) &&
                        other.boundingBox.top >= block.boundingBox.bottom - 20 &&
                        other.boundingBox.top - block.boundingBox.bottom <= block.boundingBox.height * 1.8 &&
                        other.text.trim().length in 3..35
                    }
                } else null

                if (prefixBlock != null) {
                    "${prefixBlock.text.trim()} ${block.text.trim()}"
                } else if (suffixBlock != null) {
                    "${block.text.trim()} ${suffixBlock.text.trim()}"
                } else {
                    block.text.trim()
                }
            }
        }

        return Pair(bestText, bestBlock)
    }

    /**
     * Guess Person and Role:
     * Column-aware: processes each visual column independently to prevent
     * multi-column interleaving (e.g., two founders side by side).
     *
     * Detection methods (in priority order):
     *  0. Salutation prefix: "Mr. Rajesh T. Bokade", "Dr. Priya Sharma"
     *  1. Inline role: "Vikram Singhania (Proprietor)", "Rajesh Sharma - CEO"
     *  2. Adjacent role keyword: name line followed by designation line
     *  3. Title Case fallback: 2–4 words, title cased, not company, not address
     */
    fun guessPersonAndRole(
        columns: List<List<RawLine>>,
        roleKeywords: Set<String> = DEFAULT_ROLE_KEYWORDS,
        alreadyUsed: Set<String> = emptySet()
    ): List<ContactPerson> {
        val persons = mutableListOf<ContactPerson>()
        val seenNames = mutableSetOf<String>()

        for (columnLines in columns) {
            val matchedIndices = mutableSetOf<Int>()
            val lines = columnLines

            for (i in lines.indices) {
                if (i in matchedIndices) continue
                val currentLine = lines[i]
                val currentText = currentLine.text.trim()
                if (alreadyUsed.contains(currentText) ||
                    isContactInfo(currentText) ||
                    isReligiousInvocation(currentText) ||
                    seenNames.contains(currentText)) continue

                // 0. Salutation prefix detection
                val salutation = matchSalutation(currentText)
                if (salutation != null && isValidPersonName(currentText, alreadyUsed)) {
                    val nextIndex = i + 1
                    var matchedRole: String? = null
                    if (nextIndex < lines.size && nextIndex !in matchedIndices) {
                        val nextText = lines[nextIndex].text.trim()
                        val r = matchRole(nextText, roleKeywords)
                        if (r != null) {
                            matchedRole = nextText
                            matchedIndices.add(nextIndex)
                        }
                    }
                    val person = ContactPerson(name = currentText, role = matchedRole)
                    persons.add(person)
                    seenNames.add(currentText)
                    matchedIndices.add(i)
                    continue
                }

                // 1. Inline role format: "Name (Role)" or "Name - Role"
                val inlinePerson = extractInlinePerson(currentText, roleKeywords)
                if (inlinePerson != null && !seenNames.contains(inlinePerson.name)) {
                    persons.add(inlinePerson)
                    seenNames.add(inlinePerson.name)
                    matchedIndices.add(i)
                    continue
                }

                // 2. Role keyword on this line → look for name above or below
                val matchedRole = matchRole(currentText, roleKeywords)
                if (matchedRole != null) {
                    val prevIndex = i - 1
                    if (prevIndex >= 0 && prevIndex !in matchedIndices) {
                        val prevText = lines[prevIndex].text.trim()
                        if (isValidPersonName(prevText, alreadyUsed) && !seenNames.contains(prevText)) {
                            val person = ContactPerson(name = prevText, role = currentText)
                            persons.add(person)
                            seenNames.add(prevText)
                            matchedIndices.add(prevIndex)
                            matchedIndices.add(i)
                            continue
                        }
                    }
                    val nextIndex = i + 1
                    if (nextIndex < lines.size && nextIndex !in matchedIndices) {
                        val nextText = lines[nextIndex].text.trim()
                        if (isValidPersonName(nextText, alreadyUsed) && !seenNames.contains(nextText)) {
                            val person = ContactPerson(name = nextText, role = currentText)
                            persons.add(person)
                            seenNames.add(nextText)
                            matchedIndices.add(nextIndex)
                            matchedIndices.add(i)
                            continue
                        }
                    }
                }

                // 3. Title Case heuristic fallback (no salutation, no role needed)
                //    Catches "Sundar Pichai", "Rahul Sharma", "Priya Anil Desai"
                if (looksLikePersonNameByTitleCase(currentText) &&
                    isValidPersonName(currentText, alreadyUsed) &&
                    !seenNames.contains(currentText)) {
                    // Look for an adjacent role
                    val nextIndex = i + 1
                    var adjacentRole: String? = null
                    if (nextIndex < lines.size && nextIndex !in matchedIndices) {
                        val nextText = lines[nextIndex].text.trim()
                        val r = matchRole(nextText, roleKeywords)
                        if (r != null) {
                            adjacentRole = nextText
                            matchedIndices.add(nextIndex)
                        }
                    }
                    val person = ContactPerson(name = currentText, role = adjacentRole)
                    persons.add(person)
                    seenNames.add(currentText)
                    matchedIndices.add(i)
                }
            }
        }

        return persons
    }

    // Overload for backwards-compat: accepts flat line list (clusters into columns internally)
    @JvmName("guessPersonAndRoleFromLines")
    fun guessPersonAndRole(
        lines: List<RawLine>,
        roleKeywords: Set<String> = DEFAULT_ROLE_KEYWORDS,
        alreadyUsed: Set<String> = emptySet()
    ): List<ContactPerson> {
        val columns = clusterIntoColumns(lines)
        return guessPersonAndRole(columns, roleKeywords, alreadyUsed)
    }

    private val EMBEDDED_PHONE_PREFIX_REGEX = Regex(
        "(?i)[\\s,.-]+(?:m\\.?\\s*no|mob(?:ile)?|phone|tel|ph|cell|contact)[:\\s.-]*(?:\\([\\w\\s]+\\)[\\s.-]*)?\\d{6,}.*$"
    )

    fun looksLikeEmailOrWebFragment(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains(".com") || lower.contains(".in") || lower.contains(".org") ||
               lower.contains(".net") || lower.contains("@") || lower.contains("www.") ||
               lower.contains("http") || lower.startsWith("email") || lower.startsWith("e-mail") ||
               lower.startsWith("mail") || lower.contains("gmail") || lower.contains("gnal") ||
               lower.contains("yahoo") || lower.contains("outlook") || lower.contains("fnol")
    }

    private val ADDR_PIPE_BRANCH_STRIP_REGEX = Regex("""(?i)\s*[|/]\s*(?:(?:\+91|91|0)[\s.-]*)?[6-9]\d{4}[\s.-]?\d{5}.*$""")
    private val ADDR_EMAIL_STRIP_REGEX = Regex("(?i)(?:email|e-mail|mail|fnol)?[:\\s.-]*[a-zA-Z0-9._%+\\-]+[@8](?:gmail|gnal|[a-zA-Z0-9.\\-]+)[\\s.]*(?:com|in|org)")
    private val ADDR_WEB_STRIP_REGEX = Regex("(?i)\\b(?:www\\.|https?://)[^\\s,;)\\]]*")

    fun cleanAddressLine(text: String): String {
        var cleaned = text.replace(EMBEDDED_PHONE_PREFIX_REGEX, "").trim()
        cleaned = cleaned.replace(ADDR_PIPE_BRANCH_STRIP_REGEX, "").trim()
        cleaned = cleaned.replace(ADDR_EMAIL_STRIP_REGEX, "").trim()
        cleaned = cleaned.replace(ADDR_WEB_STRIP_REGEX, "").trim()
        return cleaned.trimEnd(',', '-', '.', '|', '/', ' ')
    }

    /**
     * Guess Address Lines with spatial proximity expansion.
     *
     * Algorithm:
     *  1. Find "seed" lines: contain a location keyword OR a PIN code.
     *  2. For each seed, expand upward/downward within the SAME horizontal column
     *     and within 1.8x line-height distance.
     *  3. Strictly isolates company titles and email/web fragments from entering address.
     *  4. Deduplicate and return cleaned address strings.
     */
    fun guessAddressLines(
        lines: List<RawLine>,
        locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS,
        alreadyUsed: Set<String> = emptySet()
    ): List<String> {
        val result = mutableListOf<String>()
        val claimedIndices = mutableSetOf<Int>()

        val eligible = lines.filter { line ->
            val text = line.text.trim()
            !alreadyUsed.contains(text) &&
            text.isNotBlank() &&
            !isReligiousInvocation(text) &&
            !hasCompanyIndicator(text) &&
            !looksLikeEmailOrWebFragment(text) &&
            FieldExtractor.extractEmails(text).isEmpty() &&
            FieldExtractor.extractWebsites(text).isEmpty() &&
            FieldExtractor.extractGstin(text).isEmpty()
        }

        // For each seed line, gather a group: [preceding non-seeds] + [seed] + [following non-seeds]
        for (i in eligible.indices) {
            val line = eligible[i]
            val text = line.text.trim()
            val isSeed = matchesLocationKeyword(text, locationKeywords) ||
                         FieldExtractor.extractPincodes(text).isNotEmpty()

            if (!isSeed || i in claimedIndices) continue

            val avgLineHeight = line.boundingBox.height.coerceAtLeast(12)
            val verticalGap = (avgLineHeight * 1.8).toInt()

            val lineLeft = line.boundingBox.left
            val lineRight = line.boundingBox.right

            // Gather preceding non-seed continuation lines (in reverse order for ordering)
            val before = mutableListOf<Int>()
            var prevIdx = i - 1
            while (prevIdx >= 0 && prevIdx !in claimedIndices) {
                val prevLine = eligible[prevIdx]
                val prevText = prevLine.text.trim()
                val prevIsSeed = matchesLocationKeyword(prevText, locationKeywords) ||
                                 FieldExtractor.extractPincodes(prevText).isNotEmpty()
                val gap = line.boundingBox.top - prevLine.boundingBox.bottom

                val prevLeft = prevLine.boundingBox.left
                val prevRight = prevLine.boundingBox.right
                val minW = minOf(line.boundingBox.width, prevLine.boundingBox.width).coerceAtLeast(1)
                val hOverlap = minOf(lineRight, prevRight) - maxOf(lineLeft, prevLeft)
                val isSameColumn = if (line.boundingBox.width > 40 && prevLine.boundingBox.width > 40) {
                    (hOverlap.toDouble() / minW > 0.25) || kotlin.math.abs((lineLeft + lineRight)/2 - (prevLeft + prevRight)/2) < minW * 0.8
                } else {
                    true
                }

                val isStatusBar = prevText.matches(Regex("(?i).*\\d{1,2}:\\d{2}.*(?:KB/s|MB/s|\\d+%).*")) ||
                                  prevText.contains("KB/s", ignoreCase = true)

                val ok = !prevIsSeed && gap <= verticalGap && isSameColumn &&
                    !isStatusBar &&
                    !isContactInfo(prevText) && !isReligiousInvocation(prevText) &&
                    !isSloganOrTagline(prevText) && !hasCompanyIndicator(prevText) &&
                    !looksLikeProductOrServiceList(prevText) &&
                    !looksLikeEmailOrWebFragment(prevText) &&
                    !COMPANY_INDICATORS.any { prevText.uppercase().contains(it) } &&
                    !alreadyUsed.contains(prevText) && prevText.length > 3 &&
                    matchRole(prevText, DEFAULT_ROLE_KEYWORDS) == null &&
                    matchSalutation(prevText) == null
                if (ok) { before.add(0, prevIdx); prevIdx-- } else break
            }

            // Gather following non-seed continuation lines
            val after = mutableListOf<Int>()
            var nextIdx = i + 1
            while (nextIdx < eligible.size && nextIdx !in claimedIndices) {
                val nextLine = eligible[nextIdx]
                val nextText = nextLine.text.trim()
                val nextIsSeed = matchesLocationKeyword(nextText, locationKeywords) ||
                                 FieldExtractor.extractPincodes(nextText).isNotEmpty()
                val gap = nextLine.boundingBox.top - line.boundingBox.bottom

                val nextLeft = nextLine.boundingBox.left
                val nextRight = nextLine.boundingBox.right
                val minW = minOf(line.boundingBox.width, nextLine.boundingBox.width).coerceAtLeast(1)
                val hOverlap = minOf(lineRight, nextRight) - maxOf(lineLeft, nextLeft)
                val isSameColumn = if (line.boundingBox.width > 40 && nextLine.boundingBox.width > 40) {
                    (hOverlap.toDouble() / minW > 0.25) || kotlin.math.abs((lineLeft + lineRight)/2 - (nextLeft + nextRight)/2) < minW * 0.8
                } else {
                    true
                }

                val isNextStatusBar = nextText.matches(Regex("(?i).*\\d{1,2}:\\d{2}.*(?:KB/s|MB/s|\\d+%).*")) ||
                                      nextText.contains("KB/s", ignoreCase = true)

                val ok = !nextIsSeed && gap <= verticalGap && isSameColumn &&
                    !isNextStatusBar &&
                    !isContactInfo(nextText) && !isReligiousInvocation(nextText) &&
                    !isSloganOrTagline(nextText) && !hasCompanyIndicator(nextText) &&
                    !looksLikeProductOrServiceList(nextText) &&
                    !looksLikeEmailOrWebFragment(nextText) &&
                    !COMPANY_INDICATORS.any { nextText.uppercase().contains(it) } &&
                    !alreadyUsed.contains(nextText) && nextText.length > 3 &&
                    matchRole(nextText, DEFAULT_ROLE_KEYWORDS) == null
                if (ok) { after.add(nextIdx); nextIdx++ } else break
            }

            // Claim all indices in this group
            val group = before + listOf(i) + after
            claimedIndices.addAll(group)

            // Build address entry
            val parts = group.map { idx -> cleanAddressLine(eligible[idx].text.trim()) }
                             .filter { it.isNotBlank() }
            if (parts.size == 1) {
                result.add(parts[0])
            } else if (parts.size > 1) {
                result.add(parts.joinToString(", "))
            }
        }

        return result
    }

    /**
     * Guess Slogan / Inspirational Quote:
     * Discovers philosophical slogans, quotes, or corporate mottos.
     * Looks for quotation marks, ellipses ("...", "…"), or emotional keywords (सोच, जिंदगी, विश्वास, quality, etc.).
     */
    fun guessSlogan(
        lines: List<RawLine>,
        alreadyUsed: Set<String> = emptySet()
    ): String? {
        val candidates = lines.filter { line ->
            val text = line.text.trim()
            !alreadyUsed.contains(text) &&
            !isReligiousInvocation(text) &&
            !isContactInfo(text) &&
            text.length in 5..150
        }

        val best = candidates.maxByOrNull { line ->
            var score = 0
            val clean = line.text.trim()
            val lower = clean.lowercase()

            if (clean.contains("...") || clean.contains("…")) score += 8
            if ((clean.startsWith("\"") && clean.endsWith("\"")) ||
                (clean.startsWith("“") && clean.endsWith("”"))) score += 7
            if (SLOGAN_KEYWORDS.any { lower.contains(it) }) score += 10
            if (matchesLocationKeyword(clean, DEFAULT_LOCATION_KEYWORDS)) score -= 15
            if (FieldExtractor.extractPincodes(clean).isNotEmpty()) score -= 15
            if (looksLikePersonNameByTitleCase(clean)) score -= 6
            score
        }

        return if (best != null) {
            val clean = best.text.trim()
            val lower = clean.lowercase()
            if (clean.contains("...") || clean.contains("…") ||
                clean.startsWith("\"") || clean.startsWith("“") ||
                SLOGAN_KEYWORDS.any { lower.contains(it) }) {
                clean
            } else null
        } else null
    }

    /**
     * Guess Tagline / Business Description (3-arg overload without precomputed addressLines).
     */
    fun guessTagline(
        lines: List<RawLine>,
        companyBlock: RawBlock?,
        alreadyUsed: Set<String>
    ): String? {
        return guessTagline(lines, companyBlock, emptyList(), alreadyUsed)
    }

    /**
     * Guess Tagline:
     * Unmatched short non-numeric line(s) describing company business category or services.
     */
    fun guessTagline(
        lines: List<RawLine>,
        companyBlock: RawBlock?,
        addressLines: List<String>,
        alreadyUsed: Set<String>
    ): String? {
        val companyBottom = companyBlock?.boundingBox?.bottom ?: 0
        val addressTop = if (addressLines.isNotEmpty()) {
            lines.filter { line -> addressLines.any { line.text.contains(it) } }
                .minOfOrNull { it.boundingBox.top } ?: Int.MAX_VALUE
        } else {
            Int.MAX_VALUE
        }

        val candidates = lines.filter { line ->
            val text = line.text.trim()
            !alreadyUsed.contains(text) &&
            !isReligiousInvocation(text) &&
            text.length in 5..120 &&
            !isNumeric(text) &&
            !isContactInfo(text) &&
            !matchesLocationKeyword(text, DEFAULT_LOCATION_KEYWORDS) &&
            FieldExtractor.extractPincodes(text).isEmpty() &&
            (companyBottom == 0 || line.boundingBox.top >= companyBottom - 10) &&
            line.boundingBox.bottom <= addressTop + 20
        }

        // Prioritize candidates with business description or emotional words and proximity to company header
        val bestCandidate = candidates.maxByOrNull { line ->
            var score = 0
            val lower = line.text.lowercase()
            if (TAGLINE_BUSINESS_KEYWORDS.any { lower.contains(it) }) score += 8
            if (SLOGAN_KEYWORDS.any { lower.contains(it) }) score += 5
            if (line.text.contains("...") || line.text.contains("…")) score += 2
            if (looksLikePersonNameByTitleCase(line.text) && !TAGLINE_BUSINESS_KEYWORDS.any { lower.contains(it) }) score -= 4
            // Proximity bonus: lines located immediately beneath company header are favored
            if (companyBottom > 0) {
                val distance = (line.boundingBox.top - companyBottom).coerceAtLeast(0)
                score -= distance / 25
            }
            score
        }

        return bestCandidate?.text?.trim()
    }

    // ── Private Validation Helpers ───────────────────────────────────────────

    val ROLE_MULTI_WORD: List<String> by lazy {
        DEFAULT_ROLE_KEYWORDS.filter { it.contains(" ") || it.contains("-") }.map { it.uppercase() }
    }

    private fun matchRole(text: String, roleKeywords: Set<String>): String? {
        val clean = text.trim()
        if (clean.isBlank()) return null
        val upper = clean.uppercase()
        val tokens = upper.split(TOKEN_DELIMITERS)
        for (token in tokens) {
            if (token.isNotEmpty()) {
                val match = roleKeywords.firstOrNull { it.equals(token, ignoreCase = true) }
                if (match != null) return match
            }
        }
        for (mw in ROLE_MULTI_WORD) {
            if (upper.contains(mw)) {
                val match = roleKeywords.firstOrNull { it.equals(mw, ignoreCase = true) }
                if (match != null) return match
            }
        }
        return null
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

    /**
     * Title Case heuristic for person name detection without salutation or role.
     *
     * Criteria:
     *  - 2 to 4 words (first + middle + last)
     *  - Each word starts with uppercase letter
     *  - No more than 2 digits in total
     *  - Words are 2–20 chars each (not abbreviations or numbers)
     *  - Does NOT look like a company, address, or slogan
     */
    val SERVICES_SECTION_HEADER_REGEX = Regex("""(?i)^\s*(?:our\s+)?(?:services|products|offerings|specialities|solutions|deals\s+in|we\s+offer|facilities|amenities)(?:\s*[:\-–])?\s*$""")
    val BULLET_PREFIX_REGEX = Regex("""^[>►•▪*\-✔✓+→\u2022\u25BA\u25B6]+\s*|^[0-9]+[\.\)]\s+""")

    val DEMOGRAPHIC_AUDIENCE_REGEX = Regex("""(?i)^\s*(?:(?:only\s+)?(?:ladies|women|gents|men|kids|boys|girls|children)(?:\s+only)?|(?:for\s+)?(?:ladies|women|gents|men|kids)(?:\s+only)?|(?:ladies|women)\s*(?:&|and)\s*(?:gents|men|kids)|all\s+types\s+of|specialists?\s+in|exclusive\s+showroom|wholesale\s*(&|and)?\s*retail)\s*$""")

    fun looksLikePersonNameByTitleCase(text: String): Boolean {
        val clean = text.trim()
        if (clean.isBlank()) return false
        if (BULLET_PREFIX_REGEX.containsMatchIn(clean)) return false
        if (SERVICES_SECTION_HEADER_REGEX.matches(clean)) return false
        if (DEMOGRAPHIC_AUDIENCE_REGEX.containsMatchIn(clean)) return false
        // Person names do not contain commas or ellipsis
        if (clean.contains(',') || clean.contains("...") || clean.contains("…")) return false
        // Person names don't contain slogan/tagline keywords or company indicators
        val lower = clean.lowercase()
        if (NON_PERSON_KEYWORDS.any { lower.contains(it) }) return false
        if (lower.startsWith("download") || lower.startsWith("scan") || lower.startsWith("get it") || lower.startsWith("app")) return false
        if (lower.contains("राशि") || lower.contains("राशी") || lower.contains("कुंडली") || lower.contains("graha")) return false
        if (SLOGAN_KEYWORDS.any { lower.contains(it) }) return false
        if (TAGLINE_BUSINESS_KEYWORDS.any { lower.contains(it) }) return false
        if (COMPANY_INDICATORS.any { lower.contains(it.lowercase()) }) return false
        if (hasCompanyIndicator(clean)) return false
        val words = clean.split(Regex("[\\s]+")).filter { it.isNotBlank() }
        if (words.size !in 2..4) return false
        // All words should start with uppercase or be a known initial (e.g. "T.")
        val allTitleCase = words.all { word ->
            val stripped = word.trimEnd('.')
            stripped.isNotEmpty() &&
            stripped.first().isUpperCase() &&
            stripped.length in 1..20 &&
            stripped.count { it.isDigit() } <= 1
        }
        if (!allTitleCase) return false
        // Total digit count
        val totalDigits = clean.count { it.isDigit() }
        if (totalDigits > 2) return false
        // Must have at least 2 actual letter-words (not all initials)
        val letterWords = words.count { w -> w.filter { it.isLetter() }.length >= 2 }
        if (letterWords < 2) return false
        // No special characters that indicate non-person lines
        if (clean.contains(Regex("[/@#%&*(){}<>]"))) return false
        return true
    }

    val CONTACT_LABEL_KEYWORDS: Set<String> = setOf(
        "tel", "telephone", "phone", "ph", "mob", "mobile", "cell", "off", "office",
        "res", "residence", "fax", "contact", "email", "mail", "web", "website", "site",
        "url", "http", "https", "www", "address", "add", "pin", "pincode", "gst", "gstin",
        "मोबाईल", "मोबाइल", "मो.", "मो", "फोन", "दूरध्वनी", "संपर्क", "पत्ता", "पता", "कार्यालय"
    )

    fun isValidPersonName(text: String, alreadyUsed: Set<String>): Boolean {
        if (text.isBlank() || alreadyUsed.contains(text)) return false
        if (BULLET_PREFIX_REGEX.containsMatchIn(text.trim())) return false
        if (SERVICES_SECTION_HEADER_REGEX.matches(text.trim())) return false
        if (DEMOGRAPHIC_AUDIENCE_REGEX.containsMatchIn(text.trim())) return false
        if (text.length > 55) return false
        val lower = text.trim().lowercase()
        if (CONTACT_LABEL_KEYWORDS.contains(lower)) return false
        if (NON_PERSON_KEYWORDS.any { lower.contains(it) }) return false
        if (lower.startsWith("download") || lower.startsWith("scan") || lower.startsWith("get it") || lower.startsWith("app")) return false
        if (DEFAULT_ROLE_KEYWORDS.any { lower == it.lowercase() }) return false
        if (isSloganOrTagline(text)) return false
        if (isContactInfo(text)) return false
        if (hasCompanyIndicator(text)) return false
        if (isReligiousInvocation(text)) return false
        if (matchesLocationKeyword(text, DEFAULT_LOCATION_KEYWORDS)) return false
        if (looksLikePureAddress(text)) return false
        // Person name should never contain pipe or slash separators (branch/address delimiters)
        if (text.contains("|") || text.contains("/")) return false
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

    val TOKEN_DELIMITERS: Regex = Regex("[\\s,;:.|/\\-–—\\[\\](){}\"'!?]+")

    val MULTI_WORD_LOCATION_KEYWORDS: List<String> by lazy {
        DEFAULT_LOCATION_KEYWORDS.filter { it.contains(" ") }.map { it.lowercase() }
    }

    fun matchesLocationKeyword(text: String, locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS): Boolean {
        if (text.isBlank()) return false
        val clean = text.trim().lowercase()
        val tokens = clean.split(TOKEN_DELIMITERS)
        for (token in tokens) {
            if (token.isNotEmpty() && locationKeywords.contains(token)) {
                return true
            }
        }
        for (kw in MULTI_WORD_LOCATION_KEYWORDS) {
            if (clean.contains(kw)) return true
        }
        return false
    }

    fun countLocationKeywords(text: String, locationKeywords: Set<String> = DEFAULT_LOCATION_KEYWORDS): Int {
        if (text.isBlank()) return 0
        val clean = text.trim().lowercase()
        var count = 0
        val tokens = clean.split(TOKEN_DELIMITERS)
        for (token in tokens) {
            if (token.isNotEmpty() && locationKeywords.contains(token)) {
                count++
            }
        }
        for (kw in MULTI_WORD_LOCATION_KEYWORDS) {
            if (clean.contains(kw)) count++
        }
        return count
    }

    fun looksLikePureAddress(text: String): Boolean {
        return countLocationKeywords(text) >= 2 || FieldExtractor.extractPincodes(text).isNotEmpty()
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
    val lines: List<RawLine> = emptyList()
)

data class ContactPerson(
    val name: String,
    val role: String? = null,
    val phones: List<String> = emptyList()
)

data class CardLayoutFields(
    val companyName: String?,
    val tagline: String?,
    val slogan: String? = null,
    val providedServices: List<String> = emptyList(),
    val contactPersons: List<ContactPerson>,
    val addressLines: List<String>
)
