package com.cardlens

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Business Card data model matching the exact Phase 4 JS interface specification:
 *
 * interface BusinessCard {
 *   companyName?: string;
 *   tagline?: string;
 *   contactPersons: { name: string; role?: string }[];
 *   phoneNumbers: string[];
 *   email?: string;
 *   website?: string;
 *   addressLines: string[];
 *   pincode?: string;
 *   gstin?: string;
 *   qrCodeData?: string;
 *   rawText: string;
 * }
 */
data class BusinessCard(
    val companyName: String? = null,
    val tagline: String? = null,
    val contactPersons: List<ContactPerson> = emptyList(),
    val phoneNumbers: List<String> = emptyList(),
    val email: String? = null,
    val website: String? = null,
    val addressLines: List<String> = emptyList(),
    val pincode: String? = null,
    val gstin: String? = null,
    val qrCodeData: String? = null,
    val rawText: String
) {
    /**
     * Serializes this BusinessCard into a React Native [WritableMap].
     */
    fun toWritableMap(): WritableMap {
        val map = Arguments.createMap()

        if (companyName != null) map.putString("companyName", companyName)
        else map.putNull("companyName")

        if (tagline != null) map.putString("tagline", tagline)
        else map.putNull("tagline")

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

        if (email != null) map.putString("email", email)
        else map.putNull("email")

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
 */
object CardScannerEngine {

    /**
     * Synthesizes a [BusinessCard] from the raw OCR text, block geometry,
     * and optional QR/barcode payload.
     */
    fun assembleBusinessCard(
        rawText: String,
        blocks: List<RawBlock>,
        qrCodeData: String? = null
    ): BusinessCard {
        // 1. Run Phase 2 Regex Field Extractors
        val contactFields = FieldExtractor.extractContactFields(rawText)

        // 2. Run Phase 3 Layout Heuristics
        val layout = CardLayoutParser.parseLayout(blocks)

        // 3. Merge into BusinessCard
        return BusinessCard(
            companyName = layout.companyName,
            tagline = layout.tagline,
            contactPersons = layout.contactPersons,
            phoneNumbers = contactFields.phoneNumbers,
            email = contactFields.emails.firstOrNull(),
            website = contactFields.websites.firstOrNull(),
            addressLines = layout.addressLines,
            pincode = contactFields.pincodes.firstOrNull(),
            gstin = contactFields.gstin.firstOrNull(),
            qrCodeData = qrCodeData,
            rawText = rawText
        )
    }
}
