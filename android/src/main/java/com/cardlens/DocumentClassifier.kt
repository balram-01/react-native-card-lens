package com.cardlens

/**
 * Lightweight rule-based document classifier for Phase 6.
 *
 * Routes scanned documents between:
 *  - "bill" (invoices, medical claims, utility bills, receipts)
 *  - "card" (business cards, visiting cards)
 *
 * Zero ML models required — fast, 100% on-device, deterministic.
 */
object DocumentClassifier {

    private val STRONG_BILL_KEYWORDS = setOf(
        "INVOICE", "TAX INVOICE", "BILL OF SUPPLY", "MEDICAL CLAIM",
        "AMOUNT DUE", "SUBTOTAL", "SUB TOTAL", "TOTAL DUE", "GRAND TOTAL",
        "BALANCE DUE", "PAYMENT DUE", "TOTAL PAYABLE"
    )

    private val GENERAL_BILL_KEYWORDS = setOf(
        "BILL", "RECEIPT", "STATEMENT", "CHARGES", "BILLED", "PROCEDURE",
        "PATIENT", "INSURANCE", "CGST", "SGST", "IGST", "DUE DATE",
        "TAXABLE", "INVOICE DATE", "BILL DATE", "QTY", "RATE", "UNIT PRICE"
    )

    private val CARD_KEYWORDS = setOf(
        "CEO", "FOUNDER", "CO-FOUNDER", "DIRECTOR", "PROPRIETOR", "PROP.",
        "MANAGING DIRECTOR", "CHAIRMAN", "CONSULTANT", "PARTNER",
        "डायरेक्टर", "संचालक", "संस्थापक", "मालक", "प्रोप्राईटर"
    )

    /**
     * Classifies document OCR text into "bill" or "card".
     */
    fun classifyDocument(rawText: String): String {
        if (rawText.isBlank()) return "card"
        val upper = rawText.uppercase()

        // 1. Check strong bill signals
        val hasStrongBillKeyword = STRONG_BILL_KEYWORDS.any { kw ->
            val regex = Regex("(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])")
            regex.containsMatchIn(upper)
        }
        if (hasStrongBillKeyword) {
            return "bill"
        }

        // 2. Score general billing keywords vs card keywords
        val billScore = GENERAL_BILL_KEYWORDS.count { kw ->
            val regex = Regex("(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])")
            regex.containsMatchIn(upper)
        }

        val cardScore = CARD_KEYWORDS.count { kw ->
            val regex = Regex("(?i)(?:^|[^\\p{L}\\p{N}])${Regex.escape(kw)}(?:$|[^\\p{L}\\p{N}])")
            regex.containsMatchIn(upper)
        }

        return if (billScore >= 2 && billScore > cardScore) {
            "bill"
        } else {
            "card"
        }
    }
}
