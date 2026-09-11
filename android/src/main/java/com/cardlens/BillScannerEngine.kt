package com.cardlens

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import kotlin.math.abs
import kotlin.math.max

/**
 * Line item inside a bill or invoice table.
 */
data class LineItem(
    val description: String,
    val code: String? = null,
    val billedAmount: Double? = null,
    val insurancePaid: Double? = null,
    val patientResponsibility: Double? = null
) {
    fun toWritableMap(): WritableMap {
        val map = Arguments.createMap()
        map.putString("description", description)
        if (code != null) map.putString("code", code) else map.putNull("code")
        if (billedAmount != null) map.putDouble("billedAmount", billedAmount) else map.putNull("billedAmount")
        if (insurancePaid != null) map.putDouble("insurancePaid", insurancePaid) else map.putNull("insurancePaid")
        if (patientResponsibility != null) map.putDouble("patientResponsibility", patientResponsibility) else map.putNull("patientResponsibility")
        return map
    }
}

/**
 * Structured bill / invoice document representation matching the Phase 5 JS specification.
 */
data class BillDocument(
    val documentType: String? = null,
    val issuerName: String? = null,
    val invoiceNumber: String? = null,
    val invoiceDate: String? = null,
    val dueDate: String? = null,
    val lineItems: List<LineItem> = emptyList(),
    val subtotal: Double? = null,
    val amountDue: Double? = null,
    val rawText: String
) {
    fun toWritableMap(): WritableMap {
        val map = Arguments.createMap()
        if (documentType != null) map.putString("documentType", documentType) else map.putNull("documentType")
        if (issuerName != null) map.putString("issuerName", issuerName) else map.putNull("issuerName")
        if (invoiceNumber != null) map.putString("invoiceNumber", invoiceNumber) else map.putNull("invoiceNumber")
        if (invoiceDate != null) map.putString("invoiceDate", invoiceDate) else map.putNull("invoiceDate")
        if (dueDate != null) map.putString("dueDate", dueDate) else map.putNull("dueDate")

        val itemsArray = Arguments.createArray()
        lineItems.forEach { itemsArray.pushMap(it.toWritableMap()) }
        map.putArray("lineItems", itemsArray)

        if (subtotal != null) map.putDouble("subtotal", subtotal) else map.putNull("subtotal")
        if (amountDue != null) map.putDouble("amountDue", amountDue) else map.putNull("amountDue")
        map.putString("rawText", rawText)

        return map
    }
}

/**
 * 100% on-device Bill and Invoice Extraction Engine.
 *
 * Performs:
 *  1. Bounding box Y-clustering to assemble text into horizontal table rows.
 *  2. Bounding box X-clustering to identify header columns (Description, Code, Billed, Paid, Total).
 *  3. Row-to-column intersection to reconstruct structured [LineItem] arrays.
 *  4. Document-level regex heuristics for invoice numbers, dates, subtotal, and amount due.
 */
object BillScannerEngine {

    // ── Document Type Keywords ───────────────────────────────────────────────
    private val DOC_TYPES = listOf(
        "GOOD FAITH ESTIMATE", "ESTIMATE", "TAX INVOICE", "COMMERCIAL INVOICE", "PROFORMA INVOICE", "INVOICE",
        "BILL OF SUPPLY", "MEDICAL CLAIM", "HEALTH INSURANCE CLAIM",
        "HOSPITAL BILL", "CASH RECEIPT", "RECEIPT", "BILL"
    )

    // ── Table Header Keywords ────────────────────────────────────────────────
    val DEFAULT_HEADER_KEYWORDS = setOf(
        "PROCEDURE", "DESCRIPTION", "PARTICULARS", "ITEM", "SERVICE", "DETAILS",
        "CODE", "CPT", "HSN", "SAC",
        "BILLED", "CHARGES", "AMOUNT", "RATE", "PRICE", "QTY", "QUANTITY", "TOTAL",
        "INSURANCE", "PAID", "DISCOUNT", "PATIENT", "RESPONSIBILITY", "NET"
    )

    // ── Summary / Totals Stop Keywords ───────────────────────────────────────
    private val SUMMARY_KEYWORDS = setOf(
        "TOTAL", "SUBTOTAL", "SUB TOTAL", "AMOUNT DUE", "TOTAL DUE", "GRAND TOTAL",
        "NET AMOUNT", "BALANCE DUE", "TAX", "GST", "CGST", "SGST", "IGST",
        "AMOUNT OWED", "TOTAL OWED"
    )

    // ── Regex Extractors ─────────────────────────────────────────────────────
    private val INVOICE_NO_REGEX = Regex(
        "(?i)(?:invoice|inv|bill|receipt|claim|memo|estimate)\\s*(?:(?:no|#|num|number)[.:\\s-]*|[:#-])\\s*([A-Za-z0-9][A-Za-z0-9\\/-]{2,25})"
    )

    private val DUE_DATE_REGEX = Regex(
        "(?i)(?:due\\s*date|payment\\s*due|pay\\s*by|due)[:\\s]*(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}[\\/.-]\\d{1,2}[\\/.-]\\d{1,2}|\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{2,4})"
    )

    private val INVOICE_DATE_REGEX = Regex(
        "(?i)(?:invoice\\s*date|bill\\s*date|dated|date)[:\\s]*(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}[\\/.-]\\d{1,2}[\\/.-]\\d{1,2}|\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{2,4})"
    )

    private val GENERIC_DATE_REGEX = Regex(
        "\\b(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}[\\/.-]\\d{1,2}[\\/.-]\\d{1,2})\\b"
    )

    private val SUBTOTAL_REGEX = Regex(
        "(?i)(?:sub\\s*total|taxable\\s*value|taxable\\s*amount|subtotal|estimated\\s*cost|total\\s*estimated\\s*cost)[:\\s]*[$₹€£]?\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?)"
    )

    private val AMOUNT_DUE_REGEX = Regex(
        "(?i)(?:amount\\s*due|total\\s*amount|total\\s*due|net\\s*amount|grand\\s*total|balance\\s*due|total\\s*payable|total\\s*charges|balance|totals?|amount\\s*owed|total\\s*owed|patient\\s*responsibility|you\\s*owe)[:\\s]*[$₹€£]?\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?)"
    )

    private val AMOUNT_PARSE_REGEX = Regex("[$₹€£\\s,]")

    /**
     * Parses a raw text and block list into a [BillDocument].
     */
    fun parseBill(
        rawText: String,
        blocks: List<RawBlock>
    ): BillDocument {
        val documentType = extractDocumentType(rawText)
        val issuerName = extractIssuerName(blocks)
        val invoiceNumber = extractInvoiceNumber(rawText)
        val invoiceDate = extractInvoiceDate(rawText)
        val dueDate = extractDueDate(rawText)
        val subtotal = extractSubtotal(rawText)
        val amountDue = extractAmountDue(rawText)
        val lineItems = reconstructLineItems(blocks)

        return BillDocument(
            documentType = documentType,
            issuerName = issuerName,
            invoiceNumber = invoiceNumber,
            invoiceDate = invoiceDate,
            dueDate = dueDate,
            lineItems = lineItems,
            subtotal = subtotal,
            amountDue = amountDue,
            rawText = rawText
        )
    }

    // ── Table Reconstruction ─────────────────────────────────────────────────

    /**
     * Clusters lines into horizontal rows based on Y-coordinates, identifies header columns,
     * and maps row cells into [LineItem] structures.
     */
    fun reconstructLineItems(blocks: List<RawBlock>): List<LineItem> {
        val allLines = blocks.flatMap { it.lines }.filter { it.text.isNotBlank() }
        if (allLines.isEmpty()) return emptyList()

        // Sort lines top-to-bottom
        val sortedLines = allLines.sortedBy { it.boundingBox.top }

        // Cluster lines into horizontal rows
        val rows = clusterIntoRows(sortedLines)
        if (rows.isEmpty()) return emptyList()

        // Locate header row by matching header keywords
        var headerIndex = -1
        for (i in rows.indices) {
            val rowText = rows[i].joinToString(" ") { it.text }.uppercase()
            val matchCount = DEFAULT_HEADER_KEYWORDS.count { kw ->
                rowText.contains(kw)
            }
            if (matchCount >= 2) {
                headerIndex = i
                break
            }
        }

        val items = mutableListOf<LineItem>()

        if (headerIndex != -1) {
            val headerRow = rows[headerIndex]
            val colPositions = analyzeColumns(headerRow)

            // Rows below header until summary or end
            for (r in (headerIndex + 1) until rows.size) {
                val row = rows[r]
                val rowJoined = row.joinToString(" ") { it.text }.trim()
                val upper = rowJoined.uppercase()

                // If row matches summary totals keyword at line start, stop table
                if (SUMMARY_KEYWORDS.any { upper.startsWith(it) || upper.contains("TOTAL:") || upper.contains("DUE:") }) {
                    break
                }

                val item = parseRowWithColumns(row, colPositions)
                if (item != null && item.description.isNotBlank()) {
                    items.add(item)
                }
            }
        } else {
            // Fallback: heuristic row parsing without explicit header
            for (row in rows) {
                val rowJoined = row.joinToString(" ") { it.text }.trim()
                val upper = rowJoined.uppercase()
                if (SUMMARY_KEYWORDS.any { upper.startsWith(it) }) continue

                val item = parseFallbackRow(row)
                if (item != null && item.description.isNotBlank()) {
                    items.add(item)
                }
            }
        }

        return items
    }

    private fun clusterIntoRows(lines: List<RawLine>): List<List<RawLine>> {
        val rows = mutableListOf<MutableList<RawLine>>()

        for (line in lines) {
            val lineMidY = (line.boundingBox.top + line.boundingBox.bottom) / 2
            val lineHeight = line.boundingBox.height.coerceAtLeast(10)

            // Find an existing row where Y center aligns within tolerance
            val matchedRow = rows.firstOrNull { row ->
                val rowMidY = (row.first().boundingBox.top + row.first().boundingBox.bottom) / 2
                val rowHeight = row.first().boundingBox.height.coerceAtLeast(10)
                val tolerance = max(lineHeight, rowHeight) * 0.7
                abs(lineMidY - rowMidY) < tolerance
            }

            if (matchedRow != null) {
                matchedRow.add(line)
            } else {
                rows.add(mutableListOf(line))
            }
        }

        // Sort lines in each row left-to-right
        return rows.map { row -> row.sortedBy { it.boundingBox.left } }
    }

    private data class TableColumns(
        val descLeft: Int,
        val descRight: Int,
        val codeLeft: Int,
        val codeRight: Int,
        val billedLeft: Int,
        val billedRight: Int,
        val paidLeft: Int,
        val paidRight: Int,
        val respLeft: Int,
        val respRight: Int
    )

    private fun analyzeColumns(headerRow: List<RawLine>): TableColumns {
        var descL = 0; var descR = 300
        var codeL = -1; var codeR = -1
        var billedL = -1; var billedR = -1
        var paidL = -1; var paidR = -1
        var respL = -1; var respR = -1

        for (item in headerRow) {
            val upper = item.text.uppercase()
            val left = item.boundingBox.left
            val right = item.boundingBox.right

            when {
                upper.contains("PROCEDURE") || upper.contains("DESCRIPTION") || upper.contains("ITEM") || upper.contains("PARTICULARS") -> {
                    descL = left; descR = right
                }
                upper.contains("CODE") || upper.contains("CPT") || upper.contains("HSN") -> {
                    codeL = left; codeR = right
                }
                upper.contains("BILLED") || upper.contains("CHARGES") || upper.contains("AMOUNT") || upper.contains("RATE") || upper.contains("PRICE") -> {
                    billedL = left; billedR = right
                }
                upper.contains("PAID") || upper.contains("INSURANCE") -> {
                    paidL = left; paidR = right
                }
                upper.contains("PATIENT") || upper.contains("RESPONSIBILITY") || upper.contains("NET") -> {
                    respL = left; respR = right
                }
            }
        }

        return TableColumns(
            descLeft = descL, descRight = descR,
            codeLeft = codeL, codeRight = codeR,
            billedLeft = billedL, billedRight = billedR,
            paidLeft = paidL, paidRight = paidR,
            respLeft = respL, respRight = respR
        )
    }

    private fun parseRowWithColumns(row: List<RawLine>, cols: TableColumns): LineItem? {
        val descParts = mutableListOf<String>()
        var code: String? = null
        var billed: Double? = null
        var paid: Double? = null
        var resp: Double? = null

        for (cell in row) {
            val text = cell.text.trim()
            val cellMidX = (cell.boundingBox.left + cell.boundingBox.right) / 2
            val numVal = parseAmount(text)

            when {
                // If cell matches a code pattern (alphanumeric code, e.g. 99213, HSN 8471)
                cols.codeLeft != -1 && isNearColumn(cellMidX, cols.codeLeft, cols.codeRight) -> {
                    code = text
                }
                // Billed amount column
                cols.billedLeft != -1 && isNearColumn(cellMidX, cols.billedLeft, cols.billedRight) && numVal != null -> {
                    billed = numVal
                }
                // Insurance paid column
                cols.paidLeft != -1 && isNearColumn(cellMidX, cols.paidLeft, cols.paidRight) && numVal != null -> {
                    paid = numVal
                }
                // Patient responsibility column
                cols.respLeft != -1 && isNearColumn(cellMidX, cols.respLeft, cols.respRight) && numVal != null -> {
                    resp = numVal
                }
                else -> {
                    // If it's a numeric amount appearing on the right half of row, assign to billed if not set
                    if (numVal != null && billed == null && cell.boundingBox.left > cols.descRight) {
                        billed = numVal
                    } else if (numVal == null) {
                        descParts.add(text)
                    }
                }
            }
        }

        val desc = descParts.joinToString(" ").trim()
        if (desc.isBlank() && billed == null) return null

        return LineItem(
            description = desc.ifBlank { "Item" },
            code = code,
            billedAmount = billed,
            insurancePaid = paid,
            patientResponsibility = resp
        )
    }

    private fun isNearColumn(midX: Int, colLeft: Int, colRight: Int): Boolean {
        val colMid = (colLeft + colRight) / 2
        val colWidth = (colRight - colLeft).coerceAtLeast(40)
        return abs(midX - colMid) < colWidth * 0.9
    }

    private fun parseFallbackRow(row: List<RawLine>): LineItem? {
        val descParts = mutableListOf<String>()
        var amount: Double? = null

        for (cell in row) {
            val text = cell.text.trim()
            val num = parseAmount(text)
            if (num != null && amount == null) {
                amount = num
            } else {
                descParts.add(text)
            }
        }

        val desc = descParts.joinToString(" ").trim()
        if (desc.isBlank() && amount == null) return null

        return LineItem(
            description = desc.ifBlank { "Item" },
            billedAmount = amount
        )
    }

    // ── Document Metadata Extractors ─────────────────────────────────────────

    fun extractDocumentType(rawText: String): String? {
        val upper = rawText.uppercase()
        return DOC_TYPES.firstOrNull { upper.contains(it) }
    }

    fun extractIssuerName(blocks: List<RawBlock>): String? {
        if (blocks.isEmpty()) return null
        val minY = blocks.minOf { it.boundingBox.top }
        val maxY = blocks.maxOf { it.boundingBox.bottom }
        val topQuarter = minY + (maxY - minY) * 0.35

        val topBlocks = blocks.filter { it.boundingBox.top <= topQuarter && it.text.isNotBlank() }
        if (topBlocks.isEmpty()) return null

        val candidate = topBlocks
            .filter { block ->
                val upper = block.text.uppercase()
                !DOC_TYPES.any { upper.contains(it) } &&
                !upper.contains("INVOICE") &&
                !upper.contains("PHONE") &&
                !upper.contains("EMAIL") &&
                !upper.contains("GSTIN")
            }
            .maxByOrNull { it.boundingBox.height }

        return candidate?.lines?.firstOrNull()?.text?.trim()
    }

    fun extractInvoiceNumber(rawText: String): String? {
        val matches = INVOICE_NO_REGEX.findAll(rawText)
        for (match in matches) {
            val candidate = match.groupValues[1].trim()
            val upper = candidate.uppercase()
            if (upper != "DATE" && upper != "TOTAL" && upper != "AMOUNT" && upper != "DUE" && upper != "INVOICE") {
                return candidate
            }
        }
        return null
    }

    fun extractInvoiceDate(rawText: String): String? {
        val match = INVOICE_DATE_REGEX.find(rawText)
        if (match != null) {
            return match.groupValues[1].trim()
        }
        return GENERIC_DATE_REGEX.find(rawText)?.value
    }

    fun extractDueDate(rawText: String): String? {
        val match = DUE_DATE_REGEX.find(rawText)
        return match?.groupValues?.get(1)?.trim()
    }

    fun extractSubtotal(rawText: String): Double? {
        val match = SUBTOTAL_REGEX.find(rawText)
        return match?.groupValues?.get(1)?.let { parseAmount(it) }
    }

    fun extractAmountDue(rawText: String): Double? {
        val matches = AMOUNT_DUE_REGEX.findAll(rawText).toList()
        if (matches.isNotEmpty()) {
            val lastMatch = matches.last()
            return parseAmount(lastMatch.groupValues[1])
        }
        return null
    }

    fun parseAmount(text: String): Double? {
        val cleaned = text.replace(AMOUNT_PARSE_REGEX, "").trim()
        return cleaned.toDoubleOrNull()
    }
}
