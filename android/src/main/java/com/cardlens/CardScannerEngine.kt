package com.cardlens

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Business Card data model — extended to support multiple emails and websites.
 *
 * interface BusinessCard {
 *   companyName?: string;
 *   tagline?: string;
 *   contactPersons: { name: string; role?: string }[];
 *   phoneNumbers: string[];
 *   emails: string[];       // all emails (primary is emails[0])
 *   email?: string;         // backwards-compat alias for emails[0]
 *   websites: string[];     // all websites (primary is websites[0])
 *   website?: string;       // backwards-compat alias for websites[0]
 *   addressLines: string[];
 *   pincode?: string;
 *   gstin?: string;
 *   qrCodeData?: string;
 *   rawText: string;
 * }
 */
/**
 * Represents a phone number with an optional semantic label.
 */
data class LabeledPhone(
    val number: String,
    val label: String? = null
)

data class BusinessCard(
    val companyName: String? = null,
    val tagline: String? = null,
    val slogan: String? = null,
    val providedServices: List<String> = emptyList(),
    val contactPersons: List<ContactPerson> = emptyList(),
    val phoneNumbers: List<String> = emptyList(),
    val labeledPhones: List<LabeledPhone> = emptyList(),
    val emails: List<String> = emptyList(),
    val websites: List<String> = emptyList(),
    val addressLines: List<String> = emptyList(),
    val pincode: String? = null,
    val gstin: String? = null,
    val qrCodeData: String? = null,
    val rawText: String
) {
    /** Backwards-compat primary email accessor. */
    val email: String? get() = emails.firstOrNull()

    /** Backwards-compat primary website accessor. */
    val website: String? get() = websites.firstOrNull()

    /**
     * Serializes this BusinessCard into a React Native [WritableMap].
     */
    fun toWritableMap(): WritableMap {
        val map = Arguments.createMap()

        if (companyName != null) map.putString("companyName", companyName)
        else map.putNull("companyName")

        if (tagline != null) map.putString("tagline", tagline)
        else map.putNull("tagline")

        if (slogan != null) map.putString("slogan", slogan)
        else map.putNull("slogan")

        val servicesArray = Arguments.createArray()
        providedServices.forEach { servicesArray.pushString(it) }
        map.putArray("providedServices", servicesArray)

        val personsArray = Arguments.createArray()
        contactPersons.forEach { person ->
            val pMap = Arguments.createMap()
            pMap.putString("name", person.name)
            if (person.role != null) pMap.putString("role", person.role)
            else pMap.putNull("role")
            personsArray.pushMap(pMap)
        }
        map.putArray("contactPersons", personsArray)

        val phonesArray = Arguments.createArray()
        phoneNumbers.forEach { phonesArray.pushString(it) }
        map.putArray("phoneNumbers", phonesArray)

        val labeledPhonesArray = Arguments.createArray()
        labeledPhones.forEach { lp ->
            val pMap = Arguments.createMap()
            pMap.putString("number", lp.number)
            if (lp.label != null) pMap.putString("label", lp.label)
            else pMap.putNull("label")
            labeledPhonesArray.pushMap(pMap)
        }
        map.putArray("labeledPhones", labeledPhonesArray)

        // Multi-email array
        val emailsArray = Arguments.createArray()
        emails.forEach { emailsArray.pushString(it) }
        map.putArray("emails", emailsArray)
        // Backwards-compat single email field
        if (email != null) map.putString("email", email)
        else map.putNull("email")

        // Multi-website array
        val websitesArray = Arguments.createArray()
        websites.forEach { websitesArray.pushString(it) }
        map.putArray("websites", websitesArray)
        // Backwards-compat single website field
        if (website != null) map.putString("website", website)
        else map.putNull("website")

        val addressArray = Arguments.createArray()
        addressLines.forEach { addressArray.pushString(it) }
        map.putArray("addressLines", addressArray)

        if (pincode != null) map.putString("pincode", pincode)
        else map.putNull("pincode")

        if (gstin != null) map.putString("gstin", gstin)
        else map.putNull("gstin")

        if (qrCodeData != null) map.putString("qrCodeData", qrCodeData)
        else map.putNull("qrCodeData")

        map.putString("rawText", rawText)

        return map
    }
}

/**
 * Orchestrator that merges OCR output, Phase 2 regex extractors, Phase 3 layout
 * heuristics, and barcode scan results into a consolidated [BusinessCard].
 *
 * Supports dual OCR fusion: if both Latin and Devanagari results are provided,
 * merges them at the block level (highest-confidence script per spatial region).
 */
object CardScannerEngine {

    /**
     * Synthesizes a [BusinessCard] from the raw OCR text, block geometry,
     * and optional QR/barcode payload.
     *
     * @param rawText Combined raw text from best OCR pass (or fused text).
     * @param blocks Structured block list (from best OCR pass or fused blocks).
     * @param qrCodeData Optional QR code payload from concurrent barcode scan.
     */
    fun assembleBusinessCard(
        rawText: String,
        blocks: List<RawBlock>,
        qrCodeData: String? = null
    ): BusinessCard {
        // 1. Run Phase 2 Regex Field Extractors
        val contactFields = FieldExtractor.extractContactFields(rawText)

        // 2. Synthesize blocks from rawText if blocks list is empty (e.g. from plain text / Thinking Module)
        val effectiveBlocks = if (blocks.isEmpty() && rawText.isNotBlank()) {
            synthesizeBlocksFromText(rawText)
        } else {
            blocks
        }

        // 3. Run Phase 3 Layout Heuristics
        val layout = CardLayoutParser.parseLayout(effectiveBlocks)

        // 3. Merge into BusinessCard
        return BusinessCard(
            companyName = layout.companyName,
            tagline = layout.tagline,
            slogan = layout.slogan,
            providedServices = layout.providedServices,
            contactPersons = layout.contactPersons,
            phoneNumbers = contactFields.phoneNumbers,
            labeledPhones = contactFields.labeledPhones,
            emails = contactFields.emails,
            websites = contactFields.websites,
            addressLines = layout.addressLines,
            pincode = contactFields.pincodes.firstOrNull(),
            gstin = contactFields.gstin.firstOrNull(),
            qrCodeData = qrCodeData,
            rawText = rawText
        )
    }

    /**
     * OCR Fusion: merges Latin and Devanagari OCR block lists by coordinate space.
     *
     * Strategy:
     *  - For blocks that overlap significantly (IoU > 0.3), prefer the recognizer
     *    whose output script matches the dominant script detected in that block's text.
     *  - Devanagari blocks take precedence when Devanagari characters are detected.
     *  - Latin blocks are preserved for alphanumeric content (emails, phone, GSTIN).
     *  - Non-overlapping blocks from both recognizers are included.
     *
     * @param latinBlocks Blocks from the Latin ML Kit recognizer pass.
     * @param devanagariBlocks Blocks from the Devanagari ML Kit recognizer pass.
     * @return Fused block list for use in [assembleBusinessCard].
     */
    fun fuseOcrBlocks(
        latinBlocks: List<RawBlock>,
        devanagariBlocks: List<RawBlock>
    ): List<RawBlock> {
        if (latinBlocks.isEmpty()) return devanagariBlocks
        if (devanagariBlocks.isEmpty()) return latinBlocks

        val fused = mutableListOf<RawBlock>()
        val usedDevanagariIndices = mutableSetOf<Int>()

        for (latinBlock in latinBlocks) {
            // Find the best matching Devanagari block by bounding box IoU
            val bestDevIdx = devanagariBlocks.indices
                .filter { it !in usedDevanagariIndices }
                .maxByOrNull { idx ->
                    computeIoU(latinBlock.boundingBox, devanagariBlocks[idx].boundingBox)
                }

            val bestIoU = bestDevIdx?.let {
                computeIoU(latinBlock.boundingBox, devanagariBlocks[it].boundingBox)
            } ?: 0.0

            if (bestDevIdx != null && bestIoU > 0.3) {
                val devBlock = devanagariBlocks[bestDevIdx]
                // Choose which block to keep based on script content
                val hasDevanagari = ScriptDetector.hasDevanagariCodepoints(devBlock.text)
                val latinIsAlphanumeric = latinBlock.text.all { !ScriptDetector.hasDevanagariCodepoints(it.toString()) }

                if (hasDevanagari && ScriptDetector.countDevanagariCharacters(devBlock.text) >
                    ScriptDetector.countDevanagariCharacters(latinBlock.text)) {
                    // Prefer Devanagari block for this region
                    fused.add(devBlock)
                } else {
                    // Prefer Latin block (better for English text, email, phone, GSTIN)
                    fused.add(latinBlock)
                }
                usedDevanagariIndices.add(bestDevIdx)
            } else {
                // No overlap: include Latin block as-is
                fused.add(latinBlock)
            }
        }

        // Include any Devanagari blocks that were not matched to any Latin block
        for ((idx, devBlock) in devanagariBlocks.withIndex()) {
            if (idx !in usedDevanagariIndices) {
                fused.add(devBlock)
            }
        }

        return fused.sortedBy { it.boundingBox.top }
    }

    /**
     * Fuse raw text from Latin and Devanagari passes.
     * Prefers Devanagari text for Devanagari-containing lines,
     * Latin text for pure-ASCII contact lines.
     */
    fun fuseRawText(latinText: String, devanagariText: String): String {
        if (latinText.isBlank()) return devanagariText
        if (devanagariText.isBlank()) return latinText

        val devLines = devanagariText.lines().map { it.trim() }.filter { it.isNotBlank() }
        val latinLines = latinText.lines().map { it.trim() }.filter { it.isNotBlank() }

        val result = mutableListOf<String>()
        val seen = mutableSetOf<String>()

        // 1. Add Devanagari lines that have Devanagari characters
        devLines.forEach { line ->
            if (ScriptDetector.hasDevanagariCodepoints(line)) {
                if (seen.add(line)) result.add(line)
            }
        }

        // 2. Add Latin lines (contains emails, websites, phones, English text)
        latinLines.forEach { line ->
            if (seen.add(line)) {
                result.add(line)
            }
        }

        return result.joinToString("\n")
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    /**
     * Compute Intersection over Union (IoU) for two bounding boxes.
     * Returns a value in [0.0, 1.0].
     */
    private fun computeIoU(a: BoundingBox, b: BoundingBox): Double {
        val interLeft = maxOf(a.left, b.left)
        val interTop = maxOf(a.top, b.top)
        val interRight = minOf(a.right, b.right)
        val interBottom = minOf(a.bottom, b.bottom)

        val interWidth = (interRight - interLeft).coerceAtLeast(0)
        val interHeight = (interBottom - interTop).coerceAtLeast(0)
        val interArea = interWidth.toLong() * interHeight.toLong()

        val aArea = a.width.toLong() * a.height.toLong()
        val bArea = b.width.toLong() * b.height.toLong()
        val unionArea = aArea + bArea - interArea

        return if (unionArea == 0L) 0.0 else interArea.toDouble() / unionArea.toDouble()
    }

    /**
     * Synthesize visual layout geometry for plain text lines (e.g. from tests or thinking module).
     */
    fun synthesizeBlocksFromText(rawText: String): List<RawBlock> {
        val lines = rawText.lines().map { it.trim() }.filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()

        return lines.mapIndexed { index, lineText ->
            val top = index * 40
            val bottom = top + 30
            val bbox = BoundingBox(left = 20, top = top, right = 600, bottom = bottom)
            val rawLine = RawLine(lineText, bbox)
            RawBlock(lineText, bbox, listOf(rawLine))
        }
    }
}
