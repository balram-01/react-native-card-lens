package com.cardlens

import org.junit.Assert.*
import org.junit.Test

class BillScannerEngineTest {

    @Test
    fun `parseBill extracts document metadata and amounts correctly`() {
        val invoiceText = """
            APEX HEALTHCARE SERVICES
            123 Medical Center Drive, Suite 400
            TAX INVOICE
            Invoice No: INV-2024-8891
            Invoice Date: 15/04/2024
            Due Date: 30/04/2024
            
            Subtotal: $1,250.00
            Amount Due: $1,375.50
        """.trimIndent()

        val blocks = listOf(
            RawBlock(
                text = "APEX HEALTHCARE SERVICES",
                boundingBox = BoundingBox(50, 20, 400, 60),
                lines = listOf(RawLine("APEX HEALTHCARE SERVICES", BoundingBox(50, 20, 400, 60)))
            ),
            RawBlock(
                text = "TAX INVOICE",
                boundingBox = BoundingBox(50, 80, 250, 110),
                lines = listOf(RawLine("TAX INVOICE", BoundingBox(50, 80, 250, 110)))
            )
        )

        val bill = BillScannerEngine.parseBill(invoiceText, blocks)

        assertEquals("TAX INVOICE", bill.documentType)
        assertEquals("APEX HEALTHCARE SERVICES", bill.issuerName)
        assertEquals("INV-2024-8891", bill.invoiceNumber)
        assertEquals("15/04/2024", bill.invoiceDate)
        assertEquals("30/04/2024", bill.dueDate)
        assertEquals(1250.0, bill.subtotal!!, 0.01)
        assertEquals(1375.50, bill.amountDue!!, 0.01)
    }

    @Test
    fun `reconstructLineItems parses tabular medical claim with columns`() {
        // Table:
        // PROCEDURE               CODE      BILLED     INSURANCE  PATIENT
        // Office Consultation     99213     $150.00    $100.00    $50.00
        // Blood Test Panel        80053     $85.00     $70.00     $15.00
        // Total Due: $65.00
        val headerRow = RawBlock(
            text = "PROCEDURE CODE BILLED INSURANCE PATIENT",
            boundingBox = BoundingBox(20, 100, 800, 130),
            lines = listOf(
                RawLine("PROCEDURE", BoundingBox(20, 100, 250, 130)),
                RawLine("CODE", BoundingBox(270, 100, 370, 130)),
                RawLine("BILLED", BoundingBox(400, 100, 500, 130)),
                RawLine("INSURANCE", BoundingBox(520, 100, 640, 130)),
                RawLine("PATIENT", BoundingBox(660, 100, 780, 130))
            )
        )

        val row1 = RawBlock(
            text = "Office Consultation 99213 $150.00 $100.00 $50.00",
            boundingBox = BoundingBox(20, 140, 800, 170),
            lines = listOf(
                RawLine("Office Consultation", BoundingBox(20, 140, 250, 170)),
                RawLine("99213", BoundingBox(270, 140, 370, 170)),
                RawLine("$150.00", BoundingBox(400, 140, 500, 170)),
                RawLine("$100.00", BoundingBox(520, 140, 640, 170)),
                RawLine("$50.00", BoundingBox(660, 140, 780, 170))
            )
        )

        val row2 = RawBlock(
            text = "Blood Test Panel 80053 $85.00 $70.00 $15.00",
            boundingBox = BoundingBox(20, 180, 800, 210),
            lines = listOf(
                RawLine("Blood Test Panel", BoundingBox(20, 180, 250, 210)),
                RawLine("80053", BoundingBox(270, 180, 370, 210)),
                RawLine("$85.00", BoundingBox(400, 180, 500, 210)),
                RawLine("$70.00", BoundingBox(520, 180, 640, 210)),
                RawLine("$15.00", BoundingBox(660, 180, 780, 210))
            )
        )

        val summaryRow = RawBlock(
            text = "Total Due: $65.00",
            boundingBox = BoundingBox(20, 230, 500, 260),
            lines = listOf(
                RawLine("Total Due: $65.00", BoundingBox(20, 230, 500, 260))
            )
        )

        val items = BillScannerEngine.reconstructLineItems(listOf(headerRow, row1, row2, summaryRow))

        assertEquals(2, items.size)

        val item1 = items[0]
        assertEquals("Office Consultation", item1.description)
        assertEquals("99213", item1.code)
        assertEquals(150.0, item1.billedAmount!!, 0.01)
        assertEquals(100.0, item1.insurancePaid!!, 0.01)
        assertEquals(50.0, item1.patientResponsibility!!, 0.01)

        val item2 = items[1]
        assertEquals("Blood Test Panel", item2.description)
        assertEquals("80053", item2.code)
        assertEquals(85.0, item2.billedAmount!!, 0.01)
        assertEquals(70.0, item2.insurancePaid!!, 0.01)
        assertEquals(15.0, item2.patientResponsibility!!, 0.01)
    }

    @Test
    fun `reconstructLineItems parses general invoice items with description and amount`() {
        val headerRow = RawBlock(
            text = "ITEM DESCRIPTION AMOUNT",
            boundingBox = BoundingBox(10, 50, 600, 80),
            lines = listOf(
                RawLine("ITEM DESCRIPTION", BoundingBox(10, 50, 300, 80)),
                RawLine("AMOUNT", BoundingBox(400, 50, 580, 80))
            )
        )

        val itemRow1 = RawBlock(
            text = "Laptop Charger 65W ₹1,850.00",
            boundingBox = BoundingBox(10, 90, 600, 120),
            lines = listOf(
                RawLine("Laptop Charger 65W", BoundingBox(10, 90, 300, 120)),
                RawLine("₹1,850.00", BoundingBox(400, 90, 580, 120))
            )
        )

        val itemRow2 = RawBlock(
            text = "USB-C Cable 2M ₹450.00",
            boundingBox = BoundingBox(10, 130, 600, 160),
            lines = listOf(
                RawLine("USB-C Cable 2M", BoundingBox(10, 130, 300, 160)),
                RawLine("₹450.00", BoundingBox(400, 130, 580, 160))
            )
        )

        val items = BillScannerEngine.reconstructLineItems(listOf(headerRow, itemRow1, itemRow2))

        assertEquals(2, items.size)
        assertEquals("Laptop Charger 65W", items[0].description)
        assertEquals(1850.0, items[0].billedAmount!!, 0.01)
        assertEquals("USB-C Cable 2M", items[1].description)
        assertEquals(450.0, items[1].billedAmount!!, 0.01)
    }

    @Test
    fun `DocumentClassifier correctly routes bills and cards`() {
        val invoiceText = """
            RELIANCE RETAIL LIMITED
            TAX INVOICE
            Invoice No: RR/2024/099
            Date: 12/03/2024
            Item        Qty    Rate    Amount
            Milk 1L      2     30.00   60.00
            Bread        1     40.00   40.00
            Subtotal: 100.00
            Amount Due: 100.00
        """.trimIndent()

        val cardText = """
            NEXUS SOLUTIONS
            Rajesh Sharma
            Managing Director
            Phone: +91 98220 12345
            rajesh@nexus.in
            www.nexus.in
            Pune 411014
        """.trimIndent()

        assertEquals("bill", DocumentClassifier.classifyDocument(invoiceText))
        assertEquals("card", DocumentClassifier.classifyDocument(cardText))
    }
}
