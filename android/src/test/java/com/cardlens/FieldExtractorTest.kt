package com.cardlens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldExtractorTest {

    // ── Phone Numbers ────────────────────────────────────────────────────────

    @Test
    fun `extracts 10-digit mobile numbers with various prefixes and separators`() {
        val text = """
            Contact: +91 98765 43210
            Alternate: 919123456780
            Office: 09822334455
            Mobile: 8765432109
            Hyphenated: 76543-21098
        """.trimIndent()

        val phones = FieldExtractor.extractPhoneNumbers(text)

        assertTrue(phones.any { it.contains("98765") && it.contains("43210") })
        assertTrue(phones.any { it.contains("9123456780") })
        assertTrue(phones.any { it.contains("9822334455") })
        assertTrue(phones.any { it.contains("8765432109") })
        assertTrue(phones.any { it.contains("76543") && it.contains("21098") })
    }

    @Test
    fun `extracts multiple phone numbers on the same line with slash separator`() {
        val text = "Mob: +91 98220 12345 / 98220 54321"
        val phones = FieldExtractor.extractPhoneNumbers(text)

        assertEquals(2, phones.size)
        assertTrue(phones[0].contains("12345"))
        assertTrue(phones[1].contains("54321"))
    }

    @Test
    fun `extracts Indian landline with STD code`() {
        val text = "Tel: 020-25678901, Fax: 022 28765432"
        val phones = FieldExtractor.extractPhoneNumbers(text)

        assertTrue(phones.any { it.contains("020") && it.contains("25678901") })
        assertTrue(phones.any { it.contains("022") && it.contains("28765432") })
    }

    @Test
    fun `does NOT extract 6-digit pincodes as phone numbers`() {
        val text = "Address: M.G. Road, Pune - 411001, Maharashtra"
        val phones = FieldExtractor.extractPhoneNumbers(text)

        assertTrue("Pincode 411001 must not be treated as phone number", phones.isEmpty())
    }

    // ── Email Addresses ──────────────────────────────────────────────────────

    @Test
    fun `extracts and normalizes emails`() {
        val text = """
            Write to us: Info@LiquidText.Co.In
            Support: help.desk-sales@sub.domain.org
        """.trimIndent()

        val emails = FieldExtractor.extractEmails(text)

        assertEquals(2, emails.size)
        assertEquals("info@liquidtext.co.in", emails[0])
        assertEquals("help.desk-sales@sub.domain.org", emails[1])
    }

    @Test
    fun `auto-heals common OCR domain typos like gmai1 and hotma1l`() {
        val text = "Contact: john.doe@gmai1.com, support@hotma1l.com, admin(c)out1ook.com"
        val emails = FieldExtractor.extractEmails(text)

        assertEquals(3, emails.size)
        assertTrue(emails.contains("john.doe@gmail.com"))
        assertTrue(emails.contains("support@hotmail.com"))
        assertTrue(emails.contains("admin@outlook.com"))
    }

    // ── Websites ─────────────────────────────────────────────────────────────

    @Test
    fun `extracts websites with http, https, www, and naked domains`() {
        val text = """
            Visit https://www.liquidtext.ai/products
            Also check www.mycompany.co.in and partner.store
        """.trimIndent()

        val websites = FieldExtractor.extractWebsites(text)

        assertTrue(websites.any { it.contains("liquidtext.ai") })
        assertTrue(websites.any { it.contains("mycompany.co.in") })
        assertTrue(websites.any { it.contains("partner.store") })
    }

    @Test
    fun `does NOT extract website domain from email address`() {
        val text = "For queries email: contact@specialservice.com"
        val websites = FieldExtractor.extractWebsites(text)

        assertFalse(
            "Email domain must not be extracted as standalone website",
            websites.contains("specialservice.com")
        )
    }

    @Test
    fun `extracts website if it appears separately from email`() {
        val text = """
            Email: contact@mybrand.com
            Web: www.mybrand.com
        """.trimIndent()

        val websites = FieldExtractor.extractWebsites(text)
        assertTrue(websites.any { it.contains("mybrand.com") })
    }

    // ── GSTIN ────────────────────────────────────────────────────────────────

    @Test
    fun `extracts valid 15-character Indian GSTIN`() {
        val text = """
            TAX INVOICE
            GSTIN: 27AAAAA0000A1Z5
            State: Maharashtra (27)
        """.trimIndent()

        val gstin = FieldExtractor.extractGstin(text)

        assertEquals(1, gstin.size)
        assertEquals("27AAAAA0000A1Z5", gstin[0])
    }

    @Test
    fun `normalizes lowercase GSTIN from OCR to uppercase`() {
        val text = "gst no: 29abcde1234f1z5"
        val gstin = FieldExtractor.extractGstin(text)

        assertEquals(1, gstin.size)
        assertEquals("29ABCDE1234F1Z5", gstin[0])
    }

    // ── PIN Codes ────────────────────────────────────────────────────────────

    @Test
    fun `extracts 6-digit Indian pincodes`() {
        val text = """
            Flat 402, Shivajinagar,
            Pune, Maharashtra - 411005
        """.trimIndent()

        val pins = FieldExtractor.extractPincodes(text)

        assertEquals(1, pins.size)
        assertEquals("411005", pins[0])
    }

    @Test
    fun `does NOT extract pincode from substrings of phone numbers`() {
        val text = """
            Call: +91 9876543210
            Tel: 9123456789
        """.trimIndent()

        // 987654 or 543210 must NOT be extracted as a pincode!
        val pins = FieldExtractor.extractPincodes(text)

        assertTrue(
            "Substrings of phone numbers must never be extracted as pincodes",
            pins.isEmpty()
        )
    }

    // ── Comprehensive End-to-End Business Card Text Test ─────────────────────

    @Test
    fun `extracts all fields from realistic Indian business card OCR text`() {
        val cardOcrText = """
            APEX TECHNOLOGIES PVT LTD
            Rajesh Sharma
            Managing Director

            Office: 204, Fortune Business Park,
            Viman Nagar, Pune, Maharashtra - 411014

            Mob: +91 98220 12345 / +91 98220 67890
            Tel: 020-66001234
            Email: rajesh.sharma@apextech.in
            Web: www.apextech.in
            GST No: 27AAACA1234B1Z9
        """.trimIndent()

        val result = FieldExtractor.extractContactFields(cardOcrText)

        // Phones
        assertEquals(3, result.phoneNumbers.size)
        assertTrue(result.phoneNumbers.any { it.contains("12345") })
        assertTrue(result.phoneNumbers.any { it.contains("67890") })
        assertTrue(result.phoneNumbers.any { it.contains("020") })

        // Emails
        assertEquals(listOf("rajesh.sharma@apextech.in"), result.emails)

        // Website
        assertEquals(1, result.websites.size)
        assertTrue(result.websites[0].contains("apextech.in"))

        // GSTIN
        assertEquals(listOf("27AAACA1234B1Z9"), result.gstin)

        // Pincode (411014 found, and none from the phone numbers)
        assertEquals(listOf("411014"), result.pincodes)
    }

    @Test
    fun `extracts phones from bilingual card with Devanagari numerals and labels`() {
        val text = """
            Mr. Rajesh T. Bokade
            M.: 9146496994
            9373662998
            ॥ परमात्मा एक ॥
            राजस मार्केटींग अॅन्ड सेल्स प्रा. लि.
            एक नई सोच जो आपकी जिंदगी बदल दे.....
            ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खरबी रोड, माता मंदीर के पास, नागपूर. M. No: ( Off ) 8888120511
            Res Add : 90, न्यु डायमंड नगर, खरबी रोड, नागपूर.
        """.trimIndent()

        val fields = FieldExtractor.extractContactFields(text)

        assertEquals(3, fields.phoneNumbers.size)
        assertTrue(fields.phoneNumbers.contains("9146496994"))
        assertTrue(fields.phoneNumbers.contains("9373662998"))
        assertTrue(fields.phoneNumbers.contains("8888120511"))
    }
}

