package com.cardlens

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests verifying exact extraction accuracy on the real business cards and bills
 * located in the `test cards/` directory.
 */
class RealTestCardsTest {

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Bharat Sports (English - Multiple Phones, QR codes, Sports store)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Bharat Sports card`() {
        val ocrText = """
            AYYAZ BHAI : 8484940121
            9373129250
            8446077757
            7775066777
            BHARAT SPORTS
            Whole Seller & Retailer of High Quality of All Sports Goods
            Shop No. 29 Maharaj Bag Road, Variety Sqaure, Sitabuldi, Nagpur - 440012
            Email : bharatsports29@gmail.com
            www.bahratsportsnagpur.com
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        // 4 mobile numbers
        assertEquals(4, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.any { it.contains("8484940121") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("9373129250") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("8446077757") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("7775066777") })

        // Email & Website
        assertEquals(1, contactFields.emails.size)
        assertEquals("bharatsports29@gmail.com", contactFields.emails[0])
        assertEquals(1, contactFields.websites.size)
        assertTrue(contactFields.websites[0].contains("bahratsportsnagpur.com"))

        // Pincode
        assertEquals(1, contactFields.pincodes.size)
        assertEquals("440012", contactFields.pincodes[0])

        // Layout parsing
        val companyBlock = RawBlock("BHARAT SPORTS", BoundingBox(520, 450, 900, 560))
        val taglineBlock = RawBlock("Whole Seller & Retailer of High Quality of All Sports Goods", BoundingBox(520, 680, 950, 750))
        val addressBlock = RawBlock("Shop No. 29 Maharaj Bag Road, Variety Sqaure, Sitabuldi, Nagpur - 440012", BoundingBox(50, 800, 480, 930))

        val (company, _) = CardLayoutParser.guessCompanyName(listOf(companyBlock, taglineBlock, addressBlock))
        assertEquals("BHARAT SPORTS", company)

        val addressLines = CardLayoutParser.guessAddressLines(listOf(
            RawLine("Shop No. 29 Maharaj Bag Road, Variety Sqaure, Sitabuldi, Nagpur - 440012", BoundingBox(50, 800, 480, 930))
        ))
        assertTrue(addressLines.isNotEmpty())
        assertTrue(addressLines[0].contains("Maharaj Bag Road"))

        // Test Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("BHARAT SPORTS", refined.companyName)
        assertEquals("Whole Seller & Retailer of High Quality of All Sports Goods", refined.tagline)
        assertTrue("Should extract Ayyaz Bhai from phone prefix", refined.contactPersons.any { it.name.contains("AYYAZ", ignoreCase = true) })
        assertFalse("Should filter out goods/product Carrom Board", refined.contactPersons.any { it.name.contains("Carrom", ignoreCase = true) || it.name.contains("Carron", ignoreCase = true) })
        assertEquals(4, refined.phoneNumbers.size)
        assertTrue(refined.emails.contains("bharatsports29@gmail.com"))
        assertTrue(refined.addressLines.any { it.contains("Maharaj Bag Road") })
        assertFalse("Address should not contain email", refined.addressLines.any { it.contains("@") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Variety Sports Back (GSTIN, Pincode with space '440 001', Person)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Variety Sports back card including spaced pincode and GSTIN`() {
        val ocrText = """
            SAGAR PANJWANI
            7769020832
            9890774044
            GST No. 27BZLPP6133N2ZN
            varietysports.nagpur@gmail.com
            9 & 10, Maharaj Bagh Road, Sitabuld, Nagpur - 440 001
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        // GSTIN
        assertEquals(1, contactFields.gstin.size)
        assertEquals("27BZLPP6133N2ZN", contactFields.gstin[0])

        // Mobiles
        assertEquals(2, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.any { it.contains("7769020832") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("9890774044") })

        // Email
        assertEquals(1, contactFields.emails.size)
        assertEquals("varietysports.nagpur@gmail.com", contactFields.emails[0])

        // Pincode with space normalized
        assertEquals(1, contactFields.pincodes.size)
        assertEquals("440001", contactFields.pincodes[0])

        // Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("VARIETY SPORTS", refined.companyName)
        assertTrue(refined.contactPersons.any { it.name.equals("SAGAR PANJWANI", ignoreCase = true) })
        assertEquals(2, refined.phoneNumbers.size)
        assertEquals(1, refined.emails.size)
        assertEquals("varietysports.nagpur@gmail.com", refined.emails[0])
        assertEquals("27BZLPP6133N2ZN", refined.gstin)
        assertEquals("440001", refined.pincode)
        assertTrue(refined.addressLines.any { it.contains("Maharaj Bagh Road") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Guru Govind Singh Fashion Saree (Marathi / Devanagari Saree Shop)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Guru Govind Singh Fashion Saree Marathi card`() {
        val ocrText = """
            GSTIN : 27ADIPJ3019R1Z4
            गुरुगोविंद सिंग फॅशन साडी
            राम भंडार होटल के सामने, बडककस चौक, नागपूर
            Amar Jiwnani : 9370002379
            Jatin Jiwnani : 9373783433
            कम्पलीट फॅमिली शॉप
        """.trimIndent()

        // Script detection
        assertTrue(ScriptDetector.hasDevanagariCodepoints(ocrText))

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        // GSTIN
        assertEquals(1, contactFields.gstin.size)
        assertEquals("27ADIPJ3019R1Z4", contactFields.gstin[0])

        // Mobiles
        assertEquals(2, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.any { it.contains("9370002379") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("9373783433") })

        // Address with location keywords (चौक, सामने, नागपूर)
        val lines = listOf(
            RawLine("राम भंडार होटल के सामने, बडककस चौक, नागपूर", BoundingBox(50, 500, 700, 550))
        )
        val addressLines = CardLayoutParser.guessAddressLines(lines)
        assertEquals(1, addressLines.size)
        assertTrue(addressLines[0].contains("बडककस चौक"))

        // Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("गुरुगोविंद सिंग फॅशन साडी", refined.companyName)
        assertEquals("कम्पलीट फॅमिली शॉप", refined.tagline)
        assertEquals(2, refined.contactPersons.size)
        assertTrue(refined.contactPersons.any { it.name.contains("Amar Jiwnani", ignoreCase = true) })
        assertTrue(refined.contactPersons.any { it.name.contains("Jatin Jiwnani", ignoreCase = true) })
        assertEquals(2, refined.phoneNumbers.size)
        assertEquals("27ADIPJ3019R1Z4", refined.gstin)
        assertTrue(refined.addressLines.any { it.contains("बडककस चौक") })

        // Full Pipeline assembleBusinessCard
        val assembledCard = CardScannerEngine.assembleBusinessCard(ocrText, emptyList())
        assertEquals("गुरुगोविंद सिंग फॅशन साडी", assembledCard.companyName)
        assertEquals("कम्पलीट फॅमिली शॉप", assembledCard.tagline)
        assertEquals(2, assembledCard.contactPersons.size)
        assertEquals("27ADIPJ3019R1Z4", assembledCard.gstin)
        assertEquals(2, assembledCard.phoneNumbers.size)
        assertTrue(assembledCard.addressLines.any { it.contains("बडककस चौक") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Shahu Motors (Marathi E-Rickshaw & E-Bike dealer)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Shahu Motors Marathi card`() {
        val ocrText = """
            साहु मोटर्स
            सेल्स सर्व्हिस अँड स्पेअर्स
            ई-रिक्षा
            ई-बाईक
            Mob. 8888832104
            9921563630
            पत्ता : श्री नगर, मानेवाडा चौक, नागपूर
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        assertEquals(2, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.any { it.contains("8888832104") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("9921563630") })

        // Address recognition with पत्ता and चौक
        val lines = listOf(
            RawLine("पत्ता : श्री नगर, मानेवाडा चौक, नागपूर", BoundingBox(50, 600, 800, 650))
        )
        val addressLines = CardLayoutParser.guessAddressLines(lines)
        assertEquals(1, addressLines.size)
        assertTrue(addressLines[0].contains("मानेवाडा चौक"))

        // Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("साहु मोटर्स", refined.companyName)
        assertEquals("सेल्स सर्व्हिस अँड स्पेअर्स", refined.tagline)
        assertTrue("No products or spares should be persons", refined.contactPersons.isEmpty())
        assertEquals(2, refined.phoneNumbers.size)
        assertTrue(refined.addressLines.any { it.contains("मानेवाडा चौक") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Rajas Marketing (Marathi Pvt Ltd, Devanagari numerals, office/residence)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Rajas Marketing Marathi card`() {
        val ocrText = """
            Mr. Rajesh T. Bokade
            M.: 9146496994
            9373662998
            राजस मार्केटींग अ‍ॅन्ड सेल्स प्रा. लि.
            एक नई सोच जो आपकी जिंदगी बदल दे......
            ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड, माता मंदीर के पास, नागपूर. M. No: (Off) 8888120511
            Res Add : 90, न्यु डायमंड नगर, खरबी रोड, नागपूर.
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        // 3 mobile numbers including office
        assertEquals(3, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.any { it.contains("9146496994") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("9373662998") })
        assertTrue(contactFields.phoneNumbers.any { it.contains("8888120511") })

        // Tagline detection with slogan words सोच and जिंदगी
        val tagline = CardLayoutParser.guessTagline(
            lines = listOf(
                RawLine("राजस मार्केटींग अ‍ॅन्ड सेल्स प्रा. लि.", BoundingBox(50, 200, 600, 350)),
                RawLine("एक नई सोच जो आपकी जिंदगी बदल दे......", BoundingBox(50, 400, 600, 450)),
                RawLine("ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड", BoundingBox(50, 600, 600, 650))
            ),
            companyBlock = RawBlock("राजस मार्केटींग अ‍ॅन्ड सेल्स प्रा. लि.", BoundingBox(50, 200, 600, 350)),
            addressLines = listOf("ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड"),
            alreadyUsed = emptySet()
        )
        assertNotNull(tagline)
        assertTrue(tagline!!.contains("सोच"))

        // Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("राजस मार्केटींग अ‍ॅन्ड सेल्स प्रा. लि.", refined.companyName)
        assertEquals("एक नई सोच जो आपकी जिंदगी बदल दे......", refined.slogan)
        assertTrue(refined.contactPersons.any { it.name.contains("Rajesh T. Bokade", ignoreCase = true) })
        assertEquals(3, refined.phoneNumbers.size)
        assertTrue(refined.addressLines.any { it.contains("डायमंड नगर") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Hesten Solutions (Dual international/Indian address, CEO role)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Hesten Solutions card`() {
        val ocrText = """
            Hemlata Jawanjal
            CEO & FOUNDER
            +91 7385067604
            hemlata@hestensolutions.com
            www.hestensolutions.com
            32/1, R.M.S. Collony Durga Nagar Old Subhedar Layout Nagpur, India - 440024
            336, Bos en Lommerweg, 1061 DJ, Amsterdam Netherland
            Hesten solutions Pvt.Ltd
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)

        assertTrue(contactFields.phoneNumbers.any { it.contains("7385067604") })
        assertEquals("hemlata@hestensolutions.com", contactFields.emails[0])
        assertTrue(contactFields.websites[0].contains("hestensolutions.com"))
        assertEquals("440024", contactFields.pincodes[0])

        // Person & Role
        val lines = listOf(
            RawLine("Hemlata Jawanjal", BoundingBox(50, 100, 300, 130)),
            RawLine("CEO & FOUNDER", BoundingBox(50, 135, 250, 160))
        )
        val persons = CardLayoutParser.guessPersonAndRole(lines)
        assertEquals(1, persons.size)
        assertEquals("Hemlata Jawanjal", persons[0].name)
        assertEquals("CEO & FOUNDER", persons[0].role)

        // Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertTrue(refined.companyName?.contains("Hesten", ignoreCase = true) == true)
        assertTrue(refined.contactPersons.any { it.name.contains("Hemlata", ignoreCase = true) })
        assertEquals(1, refined.emails.size)
        assertEquals("hemlata@hestensolutions.com", refined.emails[0])
        assertEquals("440024", refined.pincode)
        assertTrue(refined.addressLines.any { it.contains("Durga Nagar") || it.contains("Subhedar") })
        assertTrue(refined.addressLines.any { it.contains("Amsterdam") || it.contains("Lommerweg") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. Medical Bill - Southwestern Vermont Medical Center
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts bill details from Southwestern Vermont Medical Center bill`() {
        val billText = """
            SOUTHWESTERN VERMONT MEDICAL CENTER
            BILL
            Invoice #: INV-883842
            Invoice Date: May 27, 2025
            Due Date: Jun 26, 2025
            AMOUNT DUE: $1,892.00
            
            PROCEDURE                    CODE       BILLED
            TISSUE EXAM BY PATHOLOGIST   88305      $1,005.00
            SPECIAL STAINS GROUP 1       88312      $245.00
            SPECIAL STAINS GROUP 2       88313      $362.00
            IMMUNOHISTO ANTB 1ST STAIN   88342      $280.00
            
            Subtotal: $1,892.00
            Total Amount Due: $1,892.00
        """.trimIndent()

        // Document classification
        val docType = DocumentClassifier.classifyDocument(billText)
        assertEquals("bill", docType)

        val bill = BillScannerEngine.parseBill(billText, emptyList())

        assertTrue(bill.documentType == "INVOICE" || bill.documentType == "BILL")
        assertEquals("INV-883842", bill.invoiceNumber)
        assertEquals(1892.0, bill.amountDue!!, 0.01)
        assertEquals(1892.0, bill.subtotal!!, 0.01)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. Medical Claim - Highmark Copley Hospital
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts bill details from Highmark medical claim bill`() {
        val claimText = """
            HIGHMARK
            Charge and payment details:
            Member: VEDANSH C CHOPKAR
            Claim # 22681147071
            Provider: COPLEY HOSPITAL
            
            SERVICE/DATE          Provider Charges    Your Plan Paid    Your Responsibility
            BREATHING TEST 94640       $42.00              $0.00               $42.00
            OFFICE/OUTPATIENT 99213   $210.00              $0.00              $210.00
            TOTALS:                   $252.00              $0.00              $252.00
        """.trimIndent()

        val docType = DocumentClassifier.classifyDocument(claimText)
        assertEquals("bill", docType)

        val bill = BillScannerEngine.parseBill(claimText, emptyList())
        assertEquals("22681147071", bill.invoiceNumber)
        assertEquals(252.0, bill.amountDue!!, 0.01)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 9. Cakes Inn (Multi-Branch Bakery Card with Pipe-Delimited Phones)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts multi-branch outlets and brand cleanly from Cakes Inn card`() {
        val ocrText = """
            Cakes
            inn
            95270 00045
            cakesinn@gmail.com
            NAGPUR
            265-A, Shivkripa Appartment, Laxmi Nagar Square | 95270 00045
            Plot No. 21/22/23/24, Center One Complex Near NMC Octroi Naka, Hingna Road | 95279 00033
            Opp. Saraf Chambers, Mount Road, Sadar | 95270 00204
            Naga Putla Square, Post Office Road, Gandhibagh | 95270 00012
            Plot No. 1 Near Epicure Food Plaza Under Pass Road Manish Nagar | 95270 00773
        """.trimIndent()

        // 1. Contact fields
        val contactFields = FieldExtractor.extractContactFields(ocrText)
        assertEquals(5, contactFields.phoneNumbers.size)
        assertTrue(contactFields.phoneNumbers.contains("9527000045"))
        assertTrue(contactFields.phoneNumbers.contains("9527900033"))
        assertTrue(contactFields.phoneNumbers.contains("9527000204"))
        assertTrue(contactFields.phoneNumbers.contains("9527000012"))
        assertTrue(contactFields.phoneNumbers.contains("9527000773"))

        assertEquals(1, contactFields.emails.size)
        assertEquals("cakesinn@gmail.com", contactFields.emails[0])

        // Branch phone labels
        assertTrue("Should label Laxmi Nagar Square", contactFields.labeledPhones.any { it.label?.contains("Laxmi Nagar", ignoreCase = true) == true })
        assertTrue("Should label Hingna Road", contactFields.labeledPhones.any { it.label?.contains("Hingna Road", ignoreCase = true) == true })
        assertTrue("Should label Sadar", contactFields.labeledPhones.any { it.label?.contains("Sadar", ignoreCase = true) == true })

        // 2. Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("Cakes Inn", refined.companyName)
        assertTrue("Retail brand card should have NO false contact persons", refined.contactPersons.isEmpty())
        assertEquals(5, refined.phoneNumbers.size)
        assertEquals(1, refined.emails.size)
        assertEquals("cakesinn@gmail.com", refined.emails[0])

        // All 5 store branch addresses should be captured without trailing pipe and phones
        assertEquals(5, refined.addressLines.size)
        assertTrue(refined.addressLines.any { it.contains("Laxmi Nagar Square") })
        assertTrue(refined.addressLines.any { it.contains("Hingna Road") })
        assertTrue(refined.addressLines.any { it.contains("Sadar") })
        assertTrue(refined.addressLines.any { it.contains("Gandhibagh") })
        assertTrue(refined.addressLines.any { it.contains("Manish Nagar") })

        // Ensure addresses are clean without pipe or embedded phone
        refined.addressLines.forEach { addr ->
            assertFalse("Address should not contain pipe '|': $addr", addr.contains("|"))
            assertFalse("Address should not contain phone numbers: $addr", addr.contains("95270") || addr.contains("95279"))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 10. Mahakal Telecom (Wholesale Mobile Spares & Folder/LCD)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Mahakal Telecom wholesale card`() {
        val ocrText = """
            ।। श्री गणेशाय नमः ।।
            Patel : 9983032493
            MAHAKAL TELECOM
            Wholesaler of All types of Mobile Spare Parts, Folder & LCD Touch
            Shop No. 12, Rahul Bazar Complex, Teen Batti Chowk, Nagpur
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)
        assertEquals(1, contactFields.phoneNumbers.size)
        assertEquals("9983032493", contactFields.phoneNumbers[0])

        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("MAHAKAL TELECOM", refined.companyName)
        assertEquals("Wholesaler of All types of Mobile Spare Parts, Folder & LCD Touch", refined.tagline)
        assertEquals(1, refined.contactPersons.size)
        assertEquals("Patel", refined.contactPersons[0].name)
        assertEquals(1, refined.phoneNumbers.size)
        assertEquals("9983032493", refined.phoneNumbers[0])
        assertTrue(refined.addressLines.any { it.contains("Rahul Bazar Complex") || it.contains("Teen Batti Chowk") })
        assertFalse("Invocation should not be in address or company", refined.companyName!!.contains("श्री गणेशाय"))
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 11. Rashidham (Astrological Consultancy & Healing)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Rashidham Astrological Consultancy card`() {
        val ocrText = """
            RASHIDHAM ASTROLOGICAL CONSULTANCY
            A Complete Solution of Astrology, Numerology, Tarot, Pranic Healing, Vastu & Gem Stones
            Near Zenda Chowk, Dharampeth, Nagpur - 440010
            9822201402 / 9422801402
            rashidham@gmail.com
            www.rashidham.com
        """.trimIndent()

        val contactFields = FieldExtractor.extractContactFields(ocrText)
        assertEquals(2, contactFields.phoneNumbers.size)
        assertEquals(1, contactFields.emails.size)
        assertEquals("rashidham@gmail.com", contactFields.emails[0])
        assertEquals("440010", contactFields.pincodes[0])

        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("RASHIDHAM ASTROLOGICAL CONSULTANCY", refined.companyName)
        assertEquals("A Complete Solution of Astrology, Numerology, Tarot, Pranic Healing, Vastu & Gem Stones", refined.tagline)
        assertTrue("No astrology terms should be extracted as persons", refined.contactPersons.isEmpty())
        assertEquals(2, refined.phoneNumbers.size)
        assertEquals("rashidham@gmail.com", refined.emails[0])
        assertEquals("440010", refined.pincode)
        assertTrue(refined.addressLines.any { it.contains("Zenda Chowk") || it.contains("Dharampeth") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 12. Medical Bill / Estimate - Good Faith Estimate (GFE)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts medical estimate details from Good Faith Estimate document`() {
        val gfeText = """
            GOOD FAITH ESTIMATE
            Patient Name: John Doe
            Date of Birth: 01/01/1980
            Procedure: Colonoscopy
            Estimated Cost: $3,450.00
            Insurance Coverage: $1,250.00
            Total Estimated Cost: $3,450.00
            Total Amount Owed: $2,200.00
        """.trimIndent()

        val docType = DocumentClassifier.classifyDocument(gfeText)
        assertEquals("bill", docType)

        val bill = BillScannerEngine.parseBill(gfeText, emptyList())
        assertEquals("GOOD FAITH ESTIMATE", bill.documentType)
        assertEquals(2200.0, bill.amountDue!!, 0.01)
        assertEquals(3450.0, bill.subtotal!!, 0.01)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 13. Vaishnavi Steel, Furniture & Electronics (Devanagari numerals, Marathi)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from Vaishnavi Steel Furniture Electronics Marathi card`() {
        val ocrText = """
            !! श्री जानूबाई देवी प्रसन्न !!
            पोपट जमदाडे
            मो. ८६०५७७०२९२
            ८६०५७७०२९६
            वैष्णवी
            स्टील, फर्निचर अॅन्ड इलेक्ट्रॉनिक्स
            लग्न बस्त्याचे माहेरघर
            आमच्याकडे सोफासेट, डायनिंग टेबल, कपाट, स्टिल, फर्निचर, ऑफीस टेबल, फ्रिज, कुलर, एल इ डी सर्व इलेक्ट्रॉनिक्स वस्तु व लग्नकार्यासाठी लागणाऱ्या सर्व वस्तु व भांडी होलसेल दरात मिळतील.
            पंढरपूर टेंभुर्णी रोड, भोसे (क), HP पेट्रोलपंपा शेजारी ता. पंढरपूर
        """.trimIndent()

        // 1. Script and Invocation detection
        assertTrue(ScriptDetector.hasDevanagariCodepoints(ocrText))
        assertTrue(CardLayoutParser.isReligiousInvocation("!! श्री जानूबाई देवी प्रसन्न !!"))

        // 2. Devanagari numerals to ASCII phone extraction
        val phones = FieldExtractor.extractPhoneNumbers(ocrText)
        assertEquals(2, phones.size)
        assertTrue("Should extract 8605770292 from ८६०५७७०२९२", phones.contains("8605770292"))
        assertTrue("Should extract 8605770296 from ८६०५७७०२९६", phones.contains("8605770296"))

        // 3. Thinking Module Semantic Reasoning
        val refined = ThinkingModuleEngine.refineCard(ocrText)

        // Company name: either Vaishnavi or with entity description
        assertTrue("Company name should contain Vaishnavi", refined.companyName?.contains("वैष्णवी") == true)
        assertFalse("Company name should NOT contain religious invocation", refined.companyName!!.contains("प्रसन्न"))

        // Contact person: Popat Jamdade
        assertEquals(1, refined.contactPersons.size)
        assertEquals("पोपट जमदाडे", refined.contactPersons[0].name)

        // Phones: 2 mobile numbers
        assertEquals(2, refined.phoneNumbers.size)
        assertTrue(refined.phoneNumbers.contains("8605770292"))
        assertTrue(refined.phoneNumbers.contains("8605770296"))

        // Slogan / Tagline
        assertNotNull(refined.slogan)
        assertTrue(refined.slogan!!.contains("माहेरघर") || refined.slogan!!.contains("लग्न बस्त्याचे"))

        // Address: Pandharpur road
        assertTrue(refined.addressLines.isNotEmpty())
        assertTrue("Address should contain Pandharpur or Bhose", refined.addressLines.any { it.contains("पंढरपूर") || it.contains("भोसे") })

        // Ensure products (sofa, dining, almirah, fridge) are not false contact persons
        assertFalse("Furniture/goods should NOT be contact persons", refined.contactPersons.any { it.name.contains("सोफा") || it.name.contains("कपाट") || it.name.contains("टेबल") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 14. OM Industries / Isco Switchgears (Products list, 'OM' company, Email healing)
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `extracts fields from OM Industries Isco Switchgears card without treating services as company`() {
        val ocrText = """
            OM INDUSTRIES
            Isco SWITCHGEARS
            Anil Mittal
            9999999999, 8888888888
            MCB Box, Junction Box, Fan Box, Modular Box, Concealed Box etc.
            Mohan Nagar, Industrial Area, Delhi-110028 (INDIA)
            iscoswitchgearsfdxyz.com
        """.trimIndent()

        // 1. Invocations check: 'OM INDUSTRIES' must NOT be classified as religious invocation
        assertFalse("OM INDUSTRIES must NOT be classified as religious invocation",
            CardLayoutParser.isReligiousInvocation("OM INDUSTRIES"))

        // 2. Product list check: 'MCB Box...' must be recognized as product list
        val serviceLine = "MCB Box, Junction Box, Fan Box, Modular Box, Concealed Box etc."
        assertTrue("Must detect product/service list", CardLayoutParser.looksLikeProductOrServiceList(serviceLine))

        val parsedServices = CardLayoutParser.parseServicesList(serviceLine)
        assertEquals(5, parsedServices.size)
        assertTrue(parsedServices.contains("MCB Box"))
        assertTrue(parsedServices.contains("Junction Box"))
        assertTrue(parsedServices.contains("Fan Box"))
        assertTrue(parsedServices.contains("Modular Box"))
        assertTrue(parsedServices.contains("Concealed Box"))

        // 3. Email healing check: iscoswitchgearsfdxyz.com -> iscoswitchgears@xyz.com
        val emails = FieldExtractor.extractEmails(ocrText)
        assertEquals(1, emails.size)
        assertEquals("iscoswitchgears@xyz.com", emails[0])

        // Website should NOT be falsely extracted from healed email
        val websites = FieldExtractor.extractWebsites(ocrText)
        assertTrue("Healed email domain should not become a website", websites.isEmpty())

        // 4. Phones: 2 numbers
        val phones = FieldExtractor.extractPhoneNumbers(ocrText)
        assertEquals(2, phones.size)
        assertTrue(phones.contains("9999999999"))
        assertTrue(phones.contains("8888888888"))

        // 5. Layout & Thinking Module check
        val refined = ThinkingModuleEngine.refineCard(ocrText)

        // Company Name MUST be OM INDUSTRIES or Isco Switchgears, NOT the product list!
        assertNotNull(refined.companyName)
        assertTrue("Company name should be OM INDUSTRIES, was: ${refined.companyName}",
            refined.companyName!!.contains("OM INDUSTRIES", ignoreCase = true) || refined.companyName!!.contains("SWITCHGEARS", ignoreCase = true))
        assertFalse("Company name must NEVER be the product list",
            refined.companyName!!.contains("Box", ignoreCase = true))

        // Provided services must be populated
        assertTrue("Provided services must be extracted", refined.providedServices.isNotEmpty())
        assertTrue(refined.providedServices.contains("MCB Box"))

        // Contact Person: Anil Mittal
        assertEquals(1, refined.contactPersons.size)
        assertEquals("Anil Mittal", refined.contactPersons[0].name)

        // Email healed
        assertEquals(1, refined.emails.size)
        assertEquals("iscoswitchgears@xyz.com", refined.emails[0])

        // Address & Pincode
        assertEquals("110028", refined.pincode)
        assertTrue(refined.addressLines.any { it.contains("Mohan Nagar") || it.contains("Industrial Area") })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 15. Thinking Module Prompt & JSON Response Parsing
    // ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildExtractionPrompt contains accuracy rules and parseJsonResponse extracts providedServices`() {
        val ocrText = "OM INDUSTRIES\nAnil Mittal\n9999999999\nMCB Box, Fan Box etc."
        val prompt = ThinkingModuleEngine.buildExtractionPrompt(ocrText)

        // Verify prompt rules
        assertTrue(prompt.contains("CRITICAL DISAMBIGUATION & ACCURACY RULES"))
        assertTrue(prompt.contains("providedServices"))
        assertTrue(prompt.contains("NEGATIVE CONSTRAINT"))
        assertTrue(prompt.contains("NEVER extract product catalogs"))

        // Verify JSON response parsing
        val mockLlmResponse = """
            {
              "companyName": "OM INDUSTRIES",
              "tagline": "Switchgears & Electricals",
              "slogan": null,
              "providedServices": [
                "MCB Box",
                "Junction Box",
                "Fan Box",
                "Modular Box",
                "Concealed Box"
              ],
              "contactPersons": [
                {
                  "name": "Anil Mittal",
                  "role": "Director"
                }
              ],
              "phoneNumbers": [
                "9999999999",
                "8888888888"
              ],
              "emails": [
                "iscoswitchgears@xyz.com"
              ],
              "websites": [],
              "addresses": [
                "Mohan Nagar, Industrial Area, Delhi"
              ],
              "pincode": "110028",
              "gstin": null
            }
        """.trimIndent()

        val parsed = ThinkingModuleEngine.parseJsonResponse(mockLlmResponse, ocrText)
        assertNotNull(parsed)
        assertEquals("OM INDUSTRIES", parsed!!.companyName)
        assertEquals("Switchgears & Electricals", parsed.tagline)
        assertEquals(5, parsed.providedServices.size)
        assertTrue(parsed.providedServices.contains("MCB Box"))
        assertTrue(parsed.providedServices.contains("Concealed Box"))
        assertEquals(1, parsed.contactPersons.size)
        assertEquals("Anil Mittal", parsed.contactPersons[0].name)
        assertEquals("Director", parsed.contactPersons[0].role)
        assertEquals(2, parsed.phoneNumbers.size)
        assertEquals(1, parsed.emails.size)
        assertEquals("iscoswitchgears@xyz.com", parsed.emails[0])
        assertEquals("110028", parsed.pincode)
    }

    @Test
    fun `extracts fields from Tech Corp sample card`() {
        val ocrText = """
            Hemlata Jawanjal
            CEO & FOUNDER
            +91 7385067604
            hemlata@hestensolutions.com
            www.hestensolutions.com

            32/1, R.M.S. Collony Durga Nagar Old Subhedar Layout Nagpur, India - 440024
            336, Bos en Lommerweg, 1061 DJ, Amsterdam Netherland

            Hesten solutions Pvt.Ltd
        """.trimIndent()

        val refined = ThinkingModuleEngine.refineCard(ocrText)
        assertEquals("Hesten solutions Pvt.Ltd", refined.companyName)
        assertTrue(refined.contactPersons.any { it.name.contains("Hemlata", ignoreCase = true) })
        assertEquals("7385067604", refined.phoneNumbers.firstOrNull())
        assertEquals("hemlata@hestensolutions.com", refined.emails.firstOrNull())
        assertEquals("www.hestensolutions.com", refined.websites.firstOrNull())
        assertEquals("440024", refined.pincode)
        assertTrue(refined.addressLines.isNotEmpty())
    }
}

