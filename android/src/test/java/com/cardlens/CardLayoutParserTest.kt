package com.cardlens

import org.junit.Assert.*
import org.junit.Test

class CardLayoutParserTest {

    // ── Company Name Heuristic ───────────────────────────────────────────────

    @Test
    fun `guessCompanyName picks the tallest text block that is not contact info`() {
        val companyBlock = RawBlock(
            text = "LIQUIDTEXT AI LABS",
            boundingBox = BoundingBox(left = 50, top = 20, right = 450, bottom = 80), // height = 60
            lines = listOf(
                RawLine("LIQUIDTEXT AI LABS", BoundingBox(50, 20, 450, 80))
            )
        )

        val smallBlock = RawBlock(
            text = "Software Solutions",
            boundingBox = BoundingBox(left = 50, top = 90, right = 300, bottom = 110), // height = 20
            lines = listOf(
                RawLine("Software Solutions", BoundingBox(50, 90, 300, 110))
            )
        )

        val phoneBlock = RawBlock(
            text = "+91 98220 12345 / 98220 54321",
            boundingBox = BoundingBox(left = 50, top = 300, right = 500, bottom = 380), // height = 80 (tall but phone)
            lines = listOf(
                RawLine("+91 98220 12345 / 98220 54321", BoundingBox(50, 300, 500, 380))
            )
        )

        val (name, block) = CardLayoutParser.guessCompanyName(listOf(phoneBlock, smallBlock, companyBlock))

        assertEquals("LIQUIDTEXT AI LABS", name)
        assertEquals(companyBlock, block)
    }

    // ── Person and Role Heuristics ───────────────────────────────────────────

    @Test
    fun `guessPersonAndRole matches adjacent lines with English role keyword`() {
        val lines = listOf(
            RawLine("Apex Technologies Pvt Ltd", BoundingBox(50, 20, 400, 60)),
            RawLine("Dr. Rajesh Sharma", BoundingBox(50, 120, 300, 145)),
            RawLine("Managing Director", BoundingBox(50, 150, 250, 170)),
            RawLine("M.G. Road, Pune - 411001", BoundingBox(50, 250, 450, 280))
        )

        val persons = CardLayoutParser.guessPersonAndRole(lines)

        assertEquals(1, persons.size)
        assertEquals("Dr. Rajesh Sharma", persons[0].name)
        assertEquals("Managing Director", persons[0].role)
    }

    @Test
    fun `guessPersonAndRole matches Devanagari role keywords`() {
        val lines = listOf(
            RawLine("श्री गणेश ट्रेडर्स", BoundingBox(50, 20, 400, 70)),
            RawLine("आनंद बाबुराव पाटील", BoundingBox(50, 120, 320, 145)),
            RawLine("संचालक", BoundingBox(50, 150, 180, 170)),
            RawLine("शिवाजी नगर, पुणे", BoundingBox(50, 250, 400, 280))
        )

        val persons = CardLayoutParser.guessPersonAndRole(lines)

        assertEquals(1, persons.size)
        assertEquals("आनंद बाबुराव पाटील", persons[0].name)
        assertEquals("संचालक", persons[0].role)
    }

    @Test
    fun `guessPersonAndRole matches inline role format`() {
        val lines = listOf(
            RawLine("Vikram Singhania (Proprietor)", BoundingBox(50, 120, 380, 150))
        )

        val persons = CardLayoutParser.guessPersonAndRole(lines)

        assertEquals(1, persons.size)
        assertEquals("Vikram Singhania", persons[0].name)
        assertEquals("Proprietor", persons[0].role)
    }

    // ── Address Lines Heuristics ─────────────────────────────────────────────

    @Test
    fun `guessAddressLines detects lines with English and Devanagari location keywords`() {
        val lines = listOf(
            RawLine("Plot No. 42, MIDC Industrial Area", BoundingBox(50, 200, 450, 225)),
            RawLine("Near City Pride, Chinchwad Station Road", BoundingBox(50, 230, 450, 255)),
            RawLine("लक्ष्मी रोड, शनिवार चौक, पुणे - ४११०३०", BoundingBox(50, 260, 480, 285))
        )

        val address = CardLayoutParser.guessAddressLines(lines)

        assertEquals(3, address.size)
        assertTrue(address[0].contains("MIDC"))
        assertTrue(address[1].contains("Road"))
        assertTrue(address[2].contains("चौक"))
    }

    // ── Tagline Heuristic ────────────────────────────────────────────────────

    @Test
    fun `guessTagline finds short non-numeric line between company name and address`() {
        val companyBlock = RawBlock(
            text = "TITAN VENTURES",
            boundingBox = BoundingBox(50, 20, 400, 70),
            lines = listOf(RawLine("TITAN VENTURES", BoundingBox(50, 20, 400, 70)))
        )

        val lines = listOf(
            companyBlock.lines[0],
            RawLine("Empowering Digital Transformation", BoundingBox(50, 85, 380, 105)), // Tagline
            RawLine("Amitabh Roy", BoundingBox(50, 140, 250, 165)),
            RawLine("Founder & CEO", BoundingBox(50, 170, 220, 190)),
            RawLine("Cyber Towers, Hitec City, Hyderabad", BoundingBox(50, 250, 450, 275))
        )

        val addressLines = listOf("Cyber Towers, Hitec City, Hyderabad")
        val alreadyUsed = setOf("TITAN VENTURES", "Amitabh Roy", "Founder & CEO")

        val tagline = CardLayoutParser.guessTagline(lines, companyBlock, addressLines, alreadyUsed)

        assertEquals("Empowering Digital Transformation", tagline)
    }

    // ── End-to-End Layout Parsing Test ───────────────────────────────────────

    @Test
    fun `parseLayout extracts all layout fields end-to-end`() {
        val companyBlock = RawBlock(
            text = "KIRAN ENTERPRISES",
            boundingBox = BoundingBox(50, 30, 500, 95), // height = 65 (tallest header)
            lines = listOf(RawLine("KIRAN ENTERPRISES", BoundingBox(50, 30, 500, 95)))
        )

        val taglineBlock = RawBlock(
            text = "Quality Products, Trusted Service",
            boundingBox = BoundingBox(50, 110, 400, 130),
            lines = listOf(RawLine("Quality Products, Trusted Service", BoundingBox(50, 110, 400, 130)))
        )

        val personBlock = RawBlock(
            text = "Kiran Deshmukh\nProprietor",
            boundingBox = BoundingBox(50, 160, 300, 210),
            lines = listOf(
                RawLine("Kiran Deshmukh", BoundingBox(50, 160, 280, 182)),
                RawLine("Proprietor", BoundingBox(50, 186, 200, 206))
            )
        )

        val addressBlock = RawBlock(
            text = "Shop 12, Swargate Commercial Complex\nTilak Road, Pune - 411030",
            boundingBox = BoundingBox(50, 250, 480, 300),
            lines = listOf(
                RawLine("Shop 12, Swargate Commercial Complex", BoundingBox(50, 250, 480, 272)),
                RawLine("Tilak Road, Pune - 411030", BoundingBox(50, 276, 380, 298))
            )
        )

        val contactBlock = RawBlock(
            text = "Mob: +91 98220 99999\nEmail: kiran@kiranenterprises.in",
            boundingBox = BoundingBox(50, 330, 450, 380),
            lines = listOf(
                RawLine("Mob: +91 98220 99999", BoundingBox(50, 330, 300, 352)),
                RawLine("Email: kiran@kiranenterprises.in", BoundingBox(50, 356, 420, 378))
            )
        )

        val blocks = listOf(companyBlock, taglineBlock, personBlock, addressBlock, contactBlock)

        val layout = CardLayoutParser.parseLayout(blocks)

        assertEquals("KIRAN ENTERPRISES", layout.companyName)
        assertEquals("Quality Products, Trusted Service", layout.tagline)
        assertEquals(1, layout.contactPersons.size)
        assertEquals("Kiran Deshmukh", layout.contactPersons[0].name)
        assertEquals("Proprietor", layout.contactPersons[0].role)
        assertEquals(2, layout.addressLines.size)
        assertTrue(layout.addressLines[0].contains("Complex"))
        assertTrue(layout.addressLines[1].contains("Road"))
    }

    @Test
    fun `parseLayout accurately extracts bilingual card with religious header, salutation and Devanagari suffixes`() {
        val religiousBlock = RawBlock(
            text = "॥ परमात्मा एक ॥",
            boundingBox = BoundingBox(300, 10, 500, 35),
            lines = listOf(RawLine("॥ परमात्मा एक ॥", BoundingBox(300, 10, 500, 35)))
        )

        val personBlock = RawBlock(
            text = "Mr. Rajesh T. Bokade",
            boundingBox = BoundingBox(20, 20, 250, 45),
            lines = listOf(RawLine("Mr. Rajesh T. Bokade", BoundingBox(20, 20, 250, 45)))
        )

        val companyBlock = RawBlock(
            text = "राजस मार्केटींग अॅन्ड सेल्स प्रा. लि.",
            boundingBox = BoundingBox(40, 100, 750, 160),
            lines = listOf(RawLine("राजस मार्केटींग अॅन्ड सेल्स प्रा. लि.", BoundingBox(40, 100, 750, 160)))
        )

        val taglineBlock = RawBlock(
            text = "एक नई सोच जो आपकी जिंदगी बदल दे.....",
            boundingBox = BoundingBox(100, 175, 700, 205),
            lines = listOf(RawLine("एक नई सोच जो आपकी जिंदगी बदल दे.....", BoundingBox(100, 175, 700, 205)))
        )

        val addressBlock1 = RawBlock(
            text = "ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड, माता मंदीर के पास, नागपूर. M. No: ( Off ) 8888120511",
            boundingBox = BoundingBox(20, 220, 780, 250),
            lines = listOf(RawLine("ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड, माता मंदीर के पास, नागपूर. M. No: ( Off ) 8888120511", BoundingBox(20, 220, 780, 250)))
        )

        val addressBlock2 = RawBlock(
            text = "Res Add : 90, न्यु डायमंड नगर, खरबी रोड, नागपूर.",
            boundingBox = BoundingBox(20, 260, 780, 290),
            lines = listOf(RawLine("Res Add : 90, न्यु डायमंड नगर, खरबी रोड, नागपूर.", BoundingBox(20, 260, 780, 290)))
        )

        val blocks = listOf(religiousBlock, personBlock, companyBlock, taglineBlock, addressBlock1, addressBlock2)

        val layout = CardLayoutParser.parseLayout(blocks)

        // Company Name: Must be Rajas Marketing (NOT the religious header!)
        assertEquals("राजस मार्केटींग अॅन्ड सेल्स प्रा. लि.", layout.companyName)

        // Tagline: Must be the Hindi slogan
        assertEquals("एक नई सोच जो आपकी जिंदगी बदल दे.....", layout.tagline)

        // Person: Extracted via salutation prefix "Mr."
        assertEquals(1, layout.contactPersons.size)
        assertEquals("Mr. Rajesh T. Bokade", layout.contactPersons[0].name)

        // Addresses: Both office and residential addresses extracted and cleaned of trailing phone
        assertEquals(2, layout.addressLines.size)
        assertTrue(layout.addressLines[0].contains("ऑफीस पत्ता"))
        assertTrue(layout.addressLines[0].contains("नागपूर"))
        assertFalse("Address line should have trailing phone stripped", layout.addressLines[0].contains("8888120511"))
        assertTrue(layout.addressLines[1].contains("Res Add"))
    }

    @Test
    fun `guessPersonAndRole extracts legal and medical specialized roles`() {
        val lines = listOf(
            RawLine("Adv. Sneha Kulkarni", BoundingBox(50, 100, 300, 120)),
            RawLine("Managing Partner & Legal Counsel", BoundingBox(50, 125, 350, 145)),
            RawLine("Dr. Rohit Mehra", BoundingBox(400, 100, 600, 120)),
            RawLine("Chief Surgeon & Consultant", BoundingBox(400, 125, 650, 145))
        )

        val columns = listOf(lines.subList(0, 2), lines.subList(2, 4))
        val persons = CardLayoutParser.guessPersonAndRole(columns)

        assertEquals(2, persons.size)
        assertEquals("Adv. Sneha Kulkarni", persons[0].name)
        assertEquals("Managing Partner & Legal Counsel", persons[0].role)
        assertEquals("Dr. Rohit Mehra", persons[1].name)
        assertEquals("Chief Surgeon & Consultant", persons[1].role)
    }
}
