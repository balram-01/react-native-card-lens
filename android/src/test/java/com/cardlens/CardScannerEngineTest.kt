package com.cardlens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CardScannerEngineTest {

    // ── Script Detection Tests ───────────────────────────────────────────────

    @Test
    fun `hasDevanagariCodepoints detects Hindi and Marathi text`() {
        assertTrue(ScriptDetector.hasDevanagariCodepoints("राजेश शर्मा"))
        assertTrue(ScriptDetector.hasDevanagariCodepoints("पुणे, महाराष्ट्र"))
        assertTrue(ScriptDetector.hasDevanagariCodepoints("संचालक"))
        assertFalse(ScriptDetector.hasDevanagariCodepoints("John Doe, CEO"))
        assertFalse(ScriptDetector.hasDevanagariCodepoints("+91 98220 12345"))
    }

    @Test
    fun `shouldRerunWithDevanagari triggers on Devanagari presence or low text density`() {
        // Devanagari present -> true
        assertTrue(ScriptDetector.shouldRerunWithDevanagari("डॉ. आनंद पाटील - संचालक"))

        // Very short / sparse Latin output from a Devanagari image -> true
        assertTrue(ScriptDetector.shouldRerunWithDevanagari("a b"))

        // Rich Latin card -> false (no need to rerun Devanagari)
        assertFalse(ScriptDetector.shouldRerunWithDevanagari("Apex Technologies Pvt Ltd, Rajesh Sharma, Managing Director, Pune"))
    }

    @Test
    fun `isDevanagariResultBetter selects Devanagari pass when script is detected`() {
        val latinText = "| ~ . / _"
        val devanagariText = "श्री गणेश ट्रेडर्स, आनंद पाटील - संचालक"

        assertTrue(ScriptDetector.isDevanagariResultBetter(latinText, devanagariText))
    }

    // ── Business Card Assembly Tests ─────────────────────────────────────────

    @Test
    fun `assembleBusinessCard merges regex, layout, and QR code into BusinessCard`() {
        val rawText = """
            QUANTUM DYNAMICS LTD
            Pioneering Intelligent Systems

            Dr. Arvind Kelkar
            Managing Director

            Office: 501, Tech Park, Baner Road, Pune - 411045
            Tel: +91 98220 11223
            Email: arvind@quantumdynamics.in
            Web: https://quantumdynamics.in
            GSTIN: 27AAAAA1234A1Z5
        """.trimIndent()

        val companyBlock = RawBlock(
            text = "QUANTUM DYNAMICS LTD",
            boundingBox = BoundingBox(50, 20, 500, 80),
            lines = listOf(RawLine("QUANTUM DYNAMICS LTD", BoundingBox(50, 20, 500, 80)))
        )

        val taglineBlock = RawBlock(
            text = "Pioneering Intelligent Systems",
            boundingBox = BoundingBox(50, 95, 450, 120),
            lines = listOf(RawLine("Pioneering Intelligent Systems", BoundingBox(50, 95, 450, 120)))
        )

        val personBlock = RawBlock(
            text = "Dr. Arvind Kelkar\nManaging Director",
            boundingBox = BoundingBox(50, 140, 350, 190),
            lines = listOf(
                RawLine("Dr. Arvind Kelkar", BoundingBox(50, 140, 320, 162)),
                RawLine("Managing Director", BoundingBox(50, 166, 260, 188))
            )
        )

        val addressBlock = RawBlock(
            text = "Office: 501, Tech Park, Baner Road, Pune - 411045",
            boundingBox = BoundingBox(50, 230, 480, 260),
            lines = listOf(RawLine("Office: 501, Tech Park, Baner Road, Pune - 411045", BoundingBox(50, 230, 480, 260)))
        )

        val contactBlock = RawBlock(
            text = "Tel: +91 98220 11223\nEmail: arvind@quantumdynamics.in\nWeb: https://quantumdynamics.in\nGSTIN: 27AAAAA1234A1Z5",
            boundingBox = BoundingBox(50, 300, 450, 400),
            lines = listOf(
                RawLine("Tel: +91 98220 11223", BoundingBox(50, 300, 300, 320)),
                RawLine("Email: arvind@quantumdynamics.in", BoundingBox(50, 325, 400, 345)),
                RawLine("Web: https://quantumdynamics.in", BoundingBox(50, 350, 380, 370)),
                RawLine("GSTIN: 27AAAAA1234A1Z5", BoundingBox(50, 375, 360, 395))
            )
        )

        val blocks = listOf(companyBlock, taglineBlock, personBlock, addressBlock, contactBlock)
        val qrPayload = "BEGIN:VCARD\nFN:Arvind Kelkar\nEND:VCARD"

        val card = CardScannerEngine.assembleBusinessCard(
            rawText = rawText,
            blocks = blocks,
            qrCodeData = qrPayload
        )

        // Verify all fields in BusinessCard
        assertEquals("QUANTUM DYNAMICS LTD", card.companyName)
        assertEquals("Pioneering Intelligent Systems", card.tagline)
        assertEquals(1, card.contactPersons.size)
        assertEquals("Dr. Arvind Kelkar", card.contactPersons[0].name)
        assertEquals("Managing Director", card.contactPersons[0].role)
        assertTrue(card.phoneNumbers.any { it.contains("98220 11223") })
        assertEquals("arvind@quantumdynamics.in", card.email)
        assertEquals("https://quantumdynamics.in", card.website)
        assertTrue(card.addressLines.any { it.contains("Baner Road") })
        assertEquals("411045", card.pincode)
        assertEquals("27AAAAA1234A1Z5", card.gstin)
        assertEquals(qrPayload, card.qrCodeData)
        assertEquals(rawText, card.rawText)
    }
}
