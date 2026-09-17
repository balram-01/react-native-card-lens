package com.cardlens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PaddleOcrEngineTest {

    @Test
    fun `test ctc greedy decoding skips blanks and collapses repeated characters`() {
        // Mock character dictionary where index 0 = blank, 1 = 'C', 2 = 'A', 3 = 'R', 4 = 'D'
        val dictionary = listOf("blank", "C", "A", "R", "D")

        // Construct mock logits for sequence: [C, C, blank, A, R, R, D] -> should decode to "CARD"
        val sequenceIndices = intArrayOf(1, 1, 0, 2, 3, 3, 4)
        val numClasses = dictionary.size

        val logits = Array(sequenceIndices.size) { t ->
            val timestep = FloatArray(numClasses) { 0.0f }
            val chosenIdx = sequenceIndices[t]
            timestep[chosenIdx] = 10.0f // high confidence for chosen index
            timestep
        }

        val sb = StringBuilder()
        var prevIndex = -1

        for (timestep in logits) {
            var maxIdx = 0
            var maxVal = Float.NEGATIVE_INFINITY
            for (i in timestep.indices) {
                if (timestep[i] > maxVal) {
                    maxVal = timestep[i]
                    maxIdx = i
                }
            }

            if (maxIdx != 0 && maxIdx != prevIndex) {
                if (maxIdx < dictionary.size) {
                    sb.append(dictionary[maxIdx])
                }
            }
            prevIndex = maxIdx
        }

        assertEquals("CARD", sb.toString())
    }

    @Test
    fun `test default model manager constants are valid URLs`() {
        assertTrue(PaddleOcrModelManager.DEFAULT_DET_MODEL_URL.startsWith("https://"))
        assertTrue(PaddleOcrModelManager.DEFAULT_REC_MODEL_URL.startsWith("https://"))
        assertTrue(PaddleOcrModelManager.DEFAULT_KEYS_URL.startsWith("https://"))
        assertEquals("det.onnx", PaddleOcrModelManager.DET_FILENAME)
        assertEquals("rec.onnx", PaddleOcrModelManager.REC_FILENAME)
        assertEquals("keys.txt", PaddleOcrModelManager.KEYS_FILENAME)
    }

    @Test
    fun `test unclip expansion increases bounding box perimeter`() {
        val bw = 100
        val bh = 30
        val unclipRatio = 1.6f
        val area = bw * bh
        val perimeter = (bw + bh) * 2
        val distance = (area * unclipRatio / perimeter).toInt()

        assertTrue(distance > 0)
        assertEquals(18, distance)

        val minX = 50
        val maxX = 150
        val expandedLeft = kotlin.math.max(0, minX - distance)
        val expandedRight = maxX + distance

        assertTrue(expandedLeft < minX)
        assertTrue(expandedRight > maxX)
        assertEquals(136, expandedRight - expandedLeft)
    }

    @Test
    fun `test script resolution and multi-language endpoints`() {
        assertEquals("devanagari", PaddleOcrModelManager.resolveScriptForLanguage("mr"))
        assertEquals("devanagari", PaddleOcrModelManager.resolveScriptForLanguage("marathi"))
        assertEquals("devanagari", PaddleOcrModelManager.resolveScriptForLanguage("hi"))
        assertEquals("latin", PaddleOcrModelManager.resolveScriptForLanguage("en"))
        assertEquals("latin", PaddleOcrModelManager.resolveScriptForLanguage("fr"))
        assertEquals("arabic", PaddleOcrModelManager.resolveScriptForLanguage("ar"))
        assertEquals("cyrillic", PaddleOcrModelManager.resolveScriptForLanguage("ru"))
        assertEquals("ch", PaddleOcrModelManager.resolveScriptForLanguage("zh"))
        assertEquals("tamil", PaddleOcrModelManager.resolveScriptForLanguage("ta"))
        assertEquals("telugu", PaddleOcrModelManager.resolveScriptForLanguage("te"))

        assertTrue(PaddleOcrModelManager.getDefaultRecModelUrl("mr").contains("hindi/rec.onnx"))
        assertTrue(PaddleOcrModelManager.getDefaultKeysUrl("mr").contains("hindi/dict.txt"))

        assertTrue(PaddleOcrModelManager.getDefaultRecModelUrl("latin").contains("latin/rec.onnx"))
        assertTrue(PaddleOcrModelManager.getDefaultKeysUrl("latin").contains("latin/dict.txt"))
    }

    @Test
    fun `test logo hallucinations and non-text noise filtering`() {
        val engine = PaddleOcrEngine
        val normalBox = android.graphics.Rect(10, 10, 200, 40) // W=190, H=30 (typical text line)
        val squareBox = android.graphics.Rect(50, 50, 250, 250) // W=200, H=200 (square logo)
        val imageW = 1000
        val imageH = 600

        // Real text should be accepted
        assertTrue(engine.isValidTextLine("साहु मोटर्स", 0.85f, normalBox, imageW, imageH))
        assertTrue(engine.isValidTextLine("Mob. 8888832104", 0.90f, normalBox, imageW, imageH))
        assertTrue(engine.isValidTextLine("MAYURI", 0.95f, normalBox, imageW, imageH))

        // Pure symbol noise or logo hallucinations should be rejected
        org.junit.Assert.assertFalse(engine.isValidTextLine("~|*", 0.20f, normalBox, imageW, imageH))
        org.junit.Assert.assertFalse(engine.isValidTextLine("©", 0.15f, normalBox, imageW, imageH))
        org.junit.Assert.assertFalse(engine.isValidTextLine("///", 0.30f, normalBox, imageW, imageH))
        org.junit.Assert.assertFalse(engine.isValidTextLine("■", 0.40f, normalBox, imageW, imageH))

        // Low confidence tiny noise should be rejected
        org.junit.Assert.assertFalse(engine.isValidTextLine("ab", 0.20f, normalBox, imageW, imageH))
    }
}

