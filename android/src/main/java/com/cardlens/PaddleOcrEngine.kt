package com.cardlens

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * High-efficiency on-device PaddleOCR (PP-OCRv5/v4) Inference Engine using Microsoft ONNX Runtime.
 *
 * Implements:
 *  1. DBNet Text Detection (resizing, RGB normalization, probability map thresholding, unclip).
 *  2. Textline Cropping & Rectification (normalized to 3x48xW).
 *  3. CTC Greedy Sequence Recognition (using multilingual character dictionary).
 *  4. Contract Normalization to CardLens standard RawOcrResult (blocks -> lines -> elements).
 */
class PaddleOcrEngine(private val context: Context) {

    private val ortEnv: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private var detSession: OrtSession? = null
    private val recSessionMap = java.util.concurrent.ConcurrentHashMap<String, OrtSession>()
    private val dictionaryMap = java.util.concurrent.ConcurrentHashMap<String, List<String>>()

    @Synchronized
    fun isLoaded(script: String? = null): Boolean {
        val targetScript = PaddleOcrModelManager.resolveScriptForLanguage(script)
        return detSession != null && recSessionMap.containsKey(targetScript) && dictionaryMap[targetScript]?.isNotEmpty() == true
    }

    /**
     * Backward-compatible check: is any recognition session loaded?
     */
    @Synchronized
    fun isAnyLoaded(): Boolean {
        return detSession != null && recSessionMap.isNotEmpty()
    }

    /**
     * Initializes the ONNX sessions for detection and recognition models for a specific script.
     */
    @Synchronized
    fun initSessions(detFile: File? = null, recFile: File? = null, script: String? = null): Boolean {
        val targetScript = PaddleOcrModelManager.resolveScriptForLanguage(script)

        // 1. Initialize universal detection session if not yet loaded
        if (detSession == null) {
            val det = detFile ?: PaddleOcrModelManager.getDetModelFile(context)
            if (det == null || !det.exists()) return false

            val sessionOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(4)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            detSession = ortEnv.createSession(det.absolutePath, sessionOptions)
        }

        // 2. Initialize script recognition session & dictionary if not yet loaded
        if (!recSessionMap.containsKey(targetScript)) {
            val rec = recFile ?: PaddleOcrModelManager.getRecModelFile(context, targetScript)
            if (rec == null || !rec.exists()) return false

            val sessionOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(4)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            val recSession = ortEnv.createSession(rec.absolutePath, sessionOptions)
            val dict = PaddleOcrModelManager.loadDictionary(context, targetScript)
            if (dict.isEmpty()) return false

            recSessionMap[targetScript] = recSession
            dictionaryMap[targetScript] = dict
        }

        return isLoaded(targetScript)
    }

    @Synchronized
    fun close() {
        try {
            detSession?.close()
            recSessionMap.values.forEach { it.close() }
        } catch (_: Exception) {}
        detSession = null
        recSessionMap.clear()
        dictionaryMap.clear()
    }

    data class RecognizedBox(
        val rect: Rect,
        val text: String,
        val confidence: Float
    )

    /**
     * Runs full end-to-end OCR on the provided Bitmap and returns standard RawOcrResult WritableMap.
     *
     * @param script  Target script family ('devanagari', 'latin', 'arabic', 'ch', etc.)
     */
    fun process(
        bitmap: Bitmap,
        boxThresh: Float = 0.3f,
        unclipRatio: Float = 1.6f,
        maxSideLen: Int = 1280,
        script: String? = null
    ): WritableMap {
        val targetScript = PaddleOcrModelManager.resolveScriptForLanguage(script)
        if (!initSessions(script = targetScript)) {
            throw IllegalStateException("PaddleOCR models for script '$targetScript' not ready or failed to load.")
        }

        // For Devanagari (Marathi/Hindi), automatically elevate unclip ratio to 1.85f if default 1.6 was given,
        // preventing top Shirorekha matras (े, ै, ो, औ, ं) and bottom matras (ु, ू, ृ) from getting clipped by DBNet
        val effectiveUnclipRatio = if (targetScript == "devanagari" && unclipRatio <= 1.6f) 1.85f else unclipRatio

        val originalW = bitmap.width
        val originalH = bitmap.height

        // 1. Preprocess for DBNet Detection
        val detInput = preprocessForDetection(bitmap, maxSideLen)
        val tensorShape = longArrayOf(1, 3, detInput.targetH.toLong(), detInput.targetW.toLong())
        val tensor = OnnxTensor.createTensor(ortEnv, detInput.floatBuffer, tensorShape)

        val detOutput = detSession?.run(mapOf(detSession!!.inputNames.iterator().next() to tensor))
        @Suppress("UNCHECKED_CAST")
        val probMap = (detOutput?.get(0)?.value as? Array<Array<Array<FloatArray>>>)?.get(0)?.get(0)
            ?: throw IllegalStateException("Invalid output tensor from DBNet detection model.")

        detOutput.close()
        tensor.close()

        // 2. Extract bounding boxes from probability map with effective unclip expansion
        val rawBoxes = extractBoxesFromProbMap(probMap, detInput.targetW, detInput.targetH, boxThresh, effectiveUnclipRatio)

        // Rescale bounding boxes back to original image dimensions
        val scaleX = originalW.toFloat() / detInput.targetW.toFloat()
        val scaleY = originalH.toFloat() / detInput.targetH.toFloat()

        val scaledBoxes = rawBoxes.mapNotNull { r ->
            val left = max(0, (r.left * scaleX).toInt())
            val top = max(0, (r.top * scaleY).toInt())
            val right = min(originalW, (r.right * scaleX).toInt())
            val bottom = min(originalH, (r.bottom * scaleY).toInt())

            if (right - left > 6 && bottom - top > 6) {
                Rect(left, top, right, bottom)
            } else null
        }

        // Sort boxes top-to-bottom, left-to-right
        val sortedBoxes = scaledBoxes.sortedWith { a, b ->
            val yDiff = a.top - b.top
            if (abs(yDiff) > 15) yDiff else a.left - b.left
        }

        // 3. Crop each box and run sequence recognition with target script
        val recognizedLines = mutableListOf<RecognizedBox>()
        for (box in sortedBoxes) {
            val crop = cropBox(bitmap, box) ?: continue
            val recognizedText = recognizeCrop(crop, targetScript)
            if (isValidTextLine(recognizedText.text, recognizedText.confidence, box, originalW, originalH)) {
                recognizedLines.add(RecognizedBox(box, recognizedText.text.trim(), recognizedText.confidence))
            }
        }

        // 4. Structure into standard CardLens RawOcrResult (blocks -> lines -> elements)
        return serializeToRawOcrResult(recognizedLines, originalW, originalH)
    }

    companion object {
        /**
         * Filters out non-text logo hallucinations, decorative emblems, and noise symbols.
         */
        fun isValidTextLine(text: String, confidence: Float, box: Rect, imageW: Int, imageH: Int): Boolean {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return false

            // 1. Must contain at least one genuine letter (Latin, Devanagari, Arabic, Cyrillic, CJK, etc.) or digit
            val hasValidScriptChar = trimmed.any { ch ->
                (ch in '\u0900'..'\u097F') || // Devanagari (Marathi, Hindi, Sanskrit)
                (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9') ||
                (ch in '\u0600'..'\u06FF') || // Arabic
                (ch in '\u0400'..'\u04FF') || // Cyrillic
                (ch in '\u4E00'..'\u9FFF') || // CJK
                (ch in '\u0B80'..'\u0BFF') || // Tamil
                (ch in '\u0C00'..'\u0C7F')    // Telugu
            }
            if (!hasValidScriptChar) return false

            // 2. Reject single isolated punctuation or symbol noise
            if (trimmed.length == 1 && !trimmed[0].isLetterOrDigit() && trimmed[0] !in '\u0900'..'\u097F') {
                return false
            }

            // 3. Reject low-confidence logo hallucinations
            if (confidence < 0.32f && trimmed.length <= 4) {
                return false
            }

            // 4. Reject disproportionately massive square logo blocks (Area > 15% of image with aspect ratio 0.8..1.25)
            if (imageW > 0 && imageH > 0) {
                val areaRatio = (box.width().toLong() * box.height().toLong()).toFloat() / (imageW.toLong() * imageH.toLong()).toFloat()
                val aspect = box.width().toFloat() / max(1, box.height()).toFloat()
                if (areaRatio > 0.15f && aspect in 0.80f..1.25f && trimmed.length < 10) {
                    return false
                }
            }

            return true
        }
    }

    private data class DetInput(
        val floatBuffer: FloatBuffer,
        val targetW: Int,
        val targetH: Int
    )

    private fun preprocessForDetection(bitmap: Bitmap, maxSideLen: Int = 1280): DetInput {
        val w = bitmap.width
        val h = bitmap.height

        var scale = 1.0f
        val maxSide = max(w, h)
        if (maxSide > maxSideLen) {
            scale = maxSideLen.toFloat() / maxSide.toFloat()
        }

        var targetW = (w * scale).toInt()
        var targetH = (h * scale).toInt()

        // Ensure dimensions are multiples of 32 (required by DBNet backbone)
        targetW = max(32, (targetW / 32) * 32)
        targetH = max(32, (targetH / 32) * 32)

        val scaled = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)
        val pixels = IntArray(targetW * targetH)
        scaled.getPixels(pixels, 0, targetW, 0, 0, targetW, targetH)

        val buffer = FloatBuffer.allocate(3 * targetW * targetH)

        val mean = floatArrayOf(0.485f, 0.456f, 0.406f)
        val std = floatArrayOf(0.229f, 0.224f, 0.225f)

        // CHW format: all Red channel, then Green, then Blue
        for (c in 0..2) {
            val m = mean[c]
            val s = std[c]
            for (i in 0 until (targetW * targetH)) {
                val pixel = pixels[i]
                val channelVal = when (c) {
                    0 -> ((pixel shr 16) and 0xFF) / 255.0f
                    1 -> ((pixel shr 8) and 0xFF) / 255.0f
                    else -> (pixel and 0xFF) / 255.0f
                }
                buffer.put((channelVal - m) / s)
            }
        }
        buffer.rewind()
        return DetInput(buffer, targetW, targetH)
    }

    /**
     * Binarizes the probability map and groups connected regions into bounding rectangles with unclip expansion.
     * Uses 8-connectivity and separate binarization threshold to preserve fine and light-contrast text lines.
     */
    private fun extractBoxesFromProbMap(
        probMap: Array<FloatArray>,
        width: Int,
        height: Int,
        boxThresh: Float,
        unclipRatio: Float
    ): List<Rect> {
        val visited = Array(height) { BooleanArray(width) }
        val boxes = mutableListOf<Rect>()

        // Use a sensitive binarization threshold (0.20) to capture faint/light-grey text strokes
        val binThresh = min(0.20f, boxThresh)
        val minBoxSize = 3

        for (y in 0 until height) {
            for (x in 0 until width) {
                if (probMap[y][x] > binThresh && !visited[y][x]) {
                    // Flood fill connected component using 8-directional connectivity
                    var minX = x
                    var maxX = x
                    var minY = y
                    var maxY = y
                    var count = 0
                    var scoreSum = 0f

                    val queue = ArrayDeque<Pair<Int, Int>>()
                    queue.add(Pair(x, y))
                    visited[y][x] = true

                    while (queue.isNotEmpty()) {
                        val (cx, cy) = queue.removeFirst()
                        count++
                        scoreSum += probMap[cy][cx]

                        if (cx < minX) minX = cx
                        if (cx > maxX) maxX = cx
                        if (cy < minY) minY = cy
                        if (cy > maxY) maxY = cy

                        // 8-way neighbors to bridge diagonal character strokes
                        val neighbors = arrayOf(
                            Pair(cx + 1, cy), Pair(cx - 1, cy),
                            Pair(cx, cy + 1), Pair(cx, cy - 1),
                            Pair(cx + 1, cy + 1), Pair(cx - 1, cy - 1),
                            Pair(cx + 1, cy - 1), Pair(cx - 1, cy + 1)
                        )

                        for ((nx, ny) in neighbors) {
                            if (nx in 0 until width && ny in 0 until height && !visited[ny][nx]) {
                                if (probMap[ny][nx] > binThresh) {
                                    visited[ny][nx] = true
                                    queue.add(Pair(nx, ny))
                                }
                            }
                        }
                    }

                    val bw = maxX - minX + 1
                    val bh = maxY - minY + 1
                    val avgScore = if (count > 0) scoreSum / count else 0f

                    // Accept candidate box if average score exceeds the boxThresh
                    if (bw >= minBoxSize && bh >= minBoxSize && avgScore >= binThresh) {
                        // Apply DBNet unclip expansion
                        val area = bw * bh
                        val perimeter = (bw + bh) * 2
                        val distance = if (perimeter > 0) (area * unclipRatio / perimeter).toInt() else 2

                        val expandedLeft = max(0, minX - distance)
                        val expandedTop = max(0, minY - distance)
                        val expandedRight = min(width, maxX + distance)
                        val expandedBottom = min(height, maxY + distance)

                        boxes.add(Rect(expandedLeft, expandedTop, expandedRight, expandedBottom))
                    }
                }
            }
        }
        return boxes
    }

    private fun cropBox(bitmap: Bitmap, rect: Rect): Bitmap? {
        val safeLeft = max(0, rect.left)
        val safeTop = max(0, rect.top)
        val safeWidth = min(bitmap.width - safeLeft, rect.width())
        val safeHeight = min(bitmap.height - safeTop, rect.height())

        if (safeWidth <= 0 || safeHeight <= 0) return null
        return Bitmap.createBitmap(bitmap, safeLeft, safeTop, safeWidth, safeHeight)
    }

    data class RecResult(val text: String, val confidence: Float)

    /**
     * Resizes cropped text line image to fixed height 48, runs ONNX recognition, and applies CTC greedy decoding.
     */
    private fun recognizeCrop(crop: Bitmap, script: String): RecResult {
        val session = recSessionMap[script] ?: return RecResult("", 0.0f)
        val dict = dictionaryMap[script] ?: return RecResult("", 0.0f)

        val targetH = 48
        val scale = targetH.toFloat() / crop.height.toFloat()
        var targetW = (crop.width * scale).toInt()
        // Ensure width is at least 16 and a multiple of 4
        targetW = max(16, ((targetW + 3) / 4) * 4)
        if (targetW > 960) targetW = 960

        val scaled = Bitmap.createScaledBitmap(crop, targetW, targetH, true)
        val pixels = IntArray(targetW * targetH)
        scaled.getPixels(pixels, 0, targetW, 0, 0, targetW, targetH)

        val buffer = FloatBuffer.allocate(3 * targetW * targetH)
        // Normalize: (val / 255.0 - 0.5) / 0.5
        for (c in 0..2) {
            for (i in 0 until (targetW * targetH)) {
                val pixel = pixels[i]
                val channelVal = when (c) {
                    0 -> ((pixel shr 16) and 0xFF) / 255.0f
                    1 -> ((pixel shr 8) and 0xFF) / 255.0f
                    else -> (pixel and 0xFF) / 255.0f
                }
                buffer.put((channelVal - 0.5f) / 0.5f)
            }
        }
        buffer.rewind()

        val shape = longArrayOf(1, 3, targetH.toLong(), targetW.toLong())
        val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)

        val recOutput = session.run(mapOf(session.inputNames.iterator().next() to tensor))
        @Suppress("UNCHECKED_CAST")
        val logits = (recOutput?.get(0)?.value as? Array<Array<FloatArray>>)?.get(0)
            ?: return RecResult("", 0.0f)

        recOutput.close()
        tensor.close()

        // CTC Greedy Decoding
        return decodeCtc(logits, dict)
    }

    /**
     * Performs CTC Greedy Argmax decoding against the loaded character dictionary.
     */
    fun decodeCtc(logits: Array<FloatArray>, dict: List<String> = emptyList()): RecResult {
        val activeDict = if (dict.isNotEmpty()) dict else (dictionaryMap.values.firstOrNull() ?: emptyList())
        val sb = StringBuilder()
        var prevIndex = -1
        var totalProb = 0.0f
        var count = 0

        for (timestep in logits) {
            var maxIdx = 0
            var maxVal = Float.NEGATIVE_INFINITY

            for (i in timestep.indices) {
                if (timestep[i] > maxVal) {
                    maxVal = timestep[i]
                    maxIdx = i
                }
            }

            // Index 0 is CTC blank token
            if (maxIdx != 0 && maxIdx != prevIndex) {
                if (maxIdx < activeDict.size) {
                    val char = activeDict[maxIdx]
                    sb.append(char)
                    totalProb += maxVal
                    count++
                }
            }
            prevIndex = maxIdx
        }

        val avgConfidence = if (count > 0) (totalProb / count).coerceIn(0.0f, 1.0f) else 0.0f
        return RecResult(sb.toString().trim(), avgConfidence)
    }

    /**
     * Packages recognized boxes into the identical RawOcrResult structure used by Google ML Kit.
     */
    private fun serializeToRawOcrResult(
        recognizedLines: List<RecognizedBox>,
        imageWidth: Int,
        imageHeight: Int
    ): WritableMap {
        val result = Arguments.createMap()
        val blocksArray = Arguments.createArray()
        val fullTextBuilder = StringBuilder()

        if (recognizedLines.isEmpty()) {
            result.putString("rawText", "")
            result.putArray("blocks", blocksArray)
            return result
        }

        // Group lines that are vertically aligned into paragraphs / blocks
        val blocks = mutableListOf<MutableList<RecognizedBox>>()
        var currentBlock = mutableListOf<RecognizedBox>()

        for (line in recognizedLines) {
            if (currentBlock.isEmpty()) {
                currentBlock.add(line)
            } else {
                val lastLine = currentBlock.last()
                val verticalGap = line.rect.top - lastLine.rect.bottom
                val lineHeight = lastLine.rect.height()

                // If gap is small (< 1.5x line height), belong to same block
                if (verticalGap < lineHeight * 1.5 && verticalGap >= -lineHeight * 0.5) {
                    currentBlock.add(line)
                } else {
                    blocks.add(currentBlock)
                    currentBlock = mutableListOf(line)
                }
            }
        }
        if (currentBlock.isNotEmpty()) {
            blocks.add(currentBlock)
        }

        for (block in blocks) {
            val blockMap = Arguments.createMap()
            val blockText = block.joinToString("\n") { it.text }

            if (fullTextBuilder.isNotEmpty()) fullTextBuilder.append("\n\n")
            fullTextBuilder.append(blockText)

            val minLeft = block.minOf { it.rect.left }
            val minTop = block.minOf { it.rect.top }
            val maxRight = block.maxOf { it.rect.right }
            val maxBottom = block.maxOf { it.rect.bottom }

            val blockBox = Arguments.createMap()
            blockBox.putDouble("left", minLeft.toDouble())
            blockBox.putDouble("top", minTop.toDouble())
            blockBox.putDouble("right", maxRight.toDouble())
            blockBox.putDouble("bottom", maxBottom.toDouble())

            blockMap.putString("text", blockText)
            blockMap.putMap("boundingBox", blockBox)

            val linesArray = Arguments.createArray()
            for (line in block) {
                val lineMap = Arguments.createMap()
                val lineBox = Arguments.createMap()
                lineBox.putDouble("left", line.rect.left.toDouble())
                lineBox.putDouble("top", line.rect.top.toDouble())
                lineBox.putDouble("right", line.rect.right.toDouble())
                lineBox.putDouble("bottom", line.rect.bottom.toDouble())

                lineMap.putString("text", line.text)
                lineMap.putMap("boundingBox", lineBox)

                // Sub-split words for elements
                val elementsArray = Arguments.createArray()
                val words = line.text.split(Regex("\\s+")).filter { it.isNotBlank() }
                val wordWidth = if (words.isNotEmpty()) line.rect.width() / words.size else line.rect.width()

                for ((idx, word) in words.withIndex()) {
                    val elemMap = Arguments.createMap()
                    val elemBox = Arguments.createMap()
                    val elemLeft = line.rect.left + (idx * wordWidth)
                    val elemRight = if (idx == words.size - 1) line.rect.right else elemLeft + wordWidth

                    elemBox.putDouble("left", elemLeft.toDouble())
                    elemBox.putDouble("top", line.rect.top.toDouble())
                    elemBox.putDouble("right", elemRight.toDouble())
                    elemBox.putDouble("bottom", line.rect.bottom.toDouble())

                    elemMap.putString("text", word)
                    elemMap.putMap("boundingBox", elemBox)
                    elementsArray.pushMap(elemMap)
                }
                lineMap.putArray("elements", elementsArray)
                linesArray.pushMap(lineMap)
            }

            blockMap.putArray("lines", linesArray)
            blocksArray.pushMap(blockMap)
        }

        result.putString("rawText", fullTextBuilder.toString())
        result.putArray("blocks", blocksArray)
        return result
    }
}
