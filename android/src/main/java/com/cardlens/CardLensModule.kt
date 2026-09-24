package com.cardlens

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizerOptionsInterface
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * TurboModule implementation for react-native-card-lens.
 *
 * Exposes three JS-callable bridge methods:
 *  - [startScanner]   — Launches Google's on-device Document Scanner UI directly
 *                       (camera viewfinder with edge detection, auto-capture,
 *                       perspective correction, and auto-cropping).
 *  - [recognizeText]  — Runs on-device ML Kit OCR (Latin or Devanagari) on an image URI.
 *  - [scanBarcodes]   — Runs on-device ML Kit barcode / QR scanning on an image URI.
 *
 * 100% on-device, zero network calls, zero API keys.
 */
class CardLensModule(reactContext: ReactApplicationContext) :
  NativeCardLensSpec(reactContext), ActivityEventListener {

  companion object {
    const val NAME = NativeCardLensSpec.NAME
    private const val REQUEST_CODE_DOCUMENT_SCAN = 42273
    private const val REQUEST_CODE_PICK_DOCUMENT = 42274
  }

  init {
    reactContext.addActivityEventListener(this)
  }

  // Dedicated background thread pool for all heavy image decodes, OCR processing, and spatial parsing
  private val backgroundExecutor: ExecutorService = Executors.newCachedThreadPool()

  // Reusable detector clients to avoid repeated JNI/client allocation overhead
  private val latinRecognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }
  private val devanagariRecognizer by lazy {
    TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
  }
  private val qrBarcodeScanner by lazy {
    val options = BarcodeScannerOptions.Builder()
      .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
      .build()
    BarcodeScanning.getClient(options)
  }
  private val paddleOcrEngine by lazy {
    PaddleOcrEngine(reactApplicationContext)
  }

  // State held during active scanner session
  private var pendingScanPromise: Promise? = null
  private var pendingScanAutoOcr: Boolean = false
  private var pendingScanScript: String = "auto"

  // State held during active file picker session
  private var pendingPickPromise: Promise? = null
  private var pendingPickAutoOcr: Boolean = false
  private var pendingPickScript: String = "auto"

  // ─────────────────────────────────────────────────────────────────────────────
  // startScanner (Live Camera Scanner UI)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Launch the Google ML Kit Document Scanner camera flow.
   *
   * @param options  Configuration options map:
   *                 - pageLimit: Int (default: 1)
   *                 - scannerMode: String ("FULL" | "BASE" | "BASE_WITH_FILTER")
   *                 - allowGalleryImport: Boolean (default: true)
   *                 - autoOcr: Boolean (default: true)
   *                 - script: String ("latin" | "devanagari")
   */
  override fun startScanner(options: ReadableMap, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("CARDLENS_NO_ACTIVITY", "Current Android Activity is null.")
      return
    }

    if (pendingScanPromise != null) {
      promise.reject("CARDLENS_SCANNER_BUSY", "Another scanner session is already in progress.")
      return
    }

    try {
      val pageLimit = if (options.hasKey("pageLimit")) options.getInt("pageLimit") else 1
      val allowGallery = if (options.hasKey("allowGalleryImport")) options.getBoolean("allowGalleryImport") else true
      val scannerModeStr = if (options.hasKey("scannerMode")) options.getString("scannerMode") else "FULL"
      pendingScanAutoOcr = if (options.hasKey("autoOcr")) options.getBoolean("autoOcr") else false
      pendingScanScript = if (options.hasKey("script")) options.getString("script") ?: "auto" else "auto"

      val mode = when (scannerModeStr?.uppercase()) {
        "BASE" -> GmsDocumentScannerOptions.SCANNER_MODE_BASE
        "BASE_WITH_FILTER" -> GmsDocumentScannerOptions.SCANNER_MODE_BASE_WITH_FILTER
        else -> GmsDocumentScannerOptions.SCANNER_MODE_FULL
      }

      val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(allowGallery)
        .setPageLimit(pageLimit)
        .setResultFormats(
          GmsDocumentScannerOptions.RESULT_FORMAT_JPEG,
          GmsDocumentScannerOptions.RESULT_FORMAT_PDF
        )
        .setScannerMode(mode)
        .build()

      val scanner = GmsDocumentScanning.getClient(scannerOptions)

      scanner.getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          pendingScanPromise = promise
          activity.startIntentSenderForResult(
            intentSender,
            REQUEST_CODE_DOCUMENT_SCAN,
            null,
            0,
            0,
            0
          )
        }
        .addOnFailureListener { e ->
          promise.reject("CARDLENS_SCANNER_INIT_ERROR", e.message, e)
        }

    } catch (e: Exception) {
      promise.reject("CARDLENS_SCANNER_ERROR", e.message, e)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // pickDocument (System Storage File Picker: Images & Multi-page PDFs)
  // ─────────────────────────────────────────────────────────────────────────────

  override fun pickDocument(options: ReadableMap, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("CARDLENS_ACTIVITY_UNAVAILABLE", "Cannot open file picker: activity is null.")
      return
    }
    if (pendingPickPromise != null) {
      promise.reject("CARDLENS_PICK_IN_PROGRESS", "A file pick operation is already in progress.")
      return
    }

    pendingPickPromise = promise
    pendingPickAutoOcr = if (options.hasKey("autoOcr")) options.getBoolean("autoOcr") else false
    pendingPickScript = if (options.hasKey("script")) options.getString("script") ?: "auto" else "auto"
    val allowPdf = if (options.hasKey("allowPdf")) options.getBoolean("allowPdf") else true

    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        val mimeTypes = if (allowPdf) arrayOf("image/*", "application/pdf") else arrayOf("image/*")
        putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
      }
      activity.startActivityForResult(intent, REQUEST_CODE_PICK_DOCUMENT)
    } catch (e: Exception) {
      pendingPickPromise = null
      promise.reject("CARDLENS_PICKER_ERROR", e.message ?: "Failed to open document picker", e)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ActivityEventListener: Handles Document Scanner and File Picker result
  // ─────────────────────────────────────────────────────────────────────────────

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) {
    if (requestCode == REQUEST_CODE_PICK_DOCUMENT) {
      val pickPromise = pendingPickPromise ?: return
      pendingPickPromise = null

      if (resultCode != Activity.RESULT_OK || data?.data == null) {
        pickPromise.reject("CARDLENS_PICK_CANCELED", "File picking was canceled by user.")
        return
      }

      val selectedUri = data.data!!
      backgroundExecutor.execute {
        try {
          val resultMap = Arguments.createMap()
          val urisArray = Arguments.createArray()

          if (ImageLoader.isPdf(reactApplicationContext, selectedUri)) {
            val pages = ImageLoader.renderPdfToImages(reactApplicationContext, selectedUri)
            if (pages.isEmpty()) {
              pickPromise.reject("CARDLENS_PDF_EMPTY", "Could not render pages from PDF.")
              return@execute
            }
            resultMap.putString("imageUri", pages[0])
            pages.forEach { urisArray.pushString(it) }
            resultMap.putArray("imageUris", urisArray)
            resultMap.putString("pdfUri", selectedUri.toString())
          } else {
            val cachedImage = ImageLoader.copyToCache(reactApplicationContext, selectedUri)
            resultMap.putString("imageUri", cachedImage)
            urisArray.pushString(cachedImage)
            resultMap.putArray("imageUris", urisArray)
          }

          val primaryUri = resultMap.getString("imageUri") ?: ""
          if (pendingPickAutoOcr && primaryUri.isNotEmpty()) {
            runOcrInternal(primaryUri, pendingPickScript, { ocrMap ->
              resultMap.putMap("ocrResult", ocrMap)
              pickPromise.resolve(resultMap)
            }, {
              pickPromise.resolve(resultMap)
            })
          } else {
            pickPromise.resolve(resultMap)
          }
        } catch (e: Exception) {
          pickPromise.reject("CARDLENS_PICK_ERROR", e.message ?: "Failed to process selected file", e)
        }
      }
      return
    }

    if (requestCode != REQUEST_CODE_DOCUMENT_SCAN) return

    val promise = pendingScanPromise ?: return
    pendingScanPromise = null

    when (resultCode) {
      Activity.RESULT_OK -> {
        val scanResult = GmsDocumentScanningResult.fromActivityResultIntent(data)
        if (scanResult == null) {
          promise.reject("CARDLENS_SCAN_EMPTY", "Scan succeeded but no result data returned.")
          return
        }

        val pages = scanResult.pages
        val primaryUri = pages?.firstOrNull()?.imageUri?.toString() ?: ""

        val resultMap = Arguments.createMap()
        resultMap.putString("imageUri", primaryUri)

        val urisArray = Arguments.createArray()
        pages?.forEach { page ->
          urisArray.pushString(page.imageUri.toString())
        }
        resultMap.putArray("imageUris", urisArray)

        scanResult.pdf?.uri?.let { pdfUri ->
          resultMap.putString("pdfUri", pdfUri.toString())
        }

        // If autoOcr is requested, process the primary scanned page immediately
        if (pendingScanAutoOcr && primaryUri.isNotEmpty()) {
          runOcrInternal(primaryUri, pendingScanScript, { ocrMap ->
            resultMap.putMap("ocrResult", ocrMap)
            promise.resolve(resultMap)
          }, { errorMsg ->
            // Still return the image URI, but note the OCR error
            promise.resolve(resultMap)
          })
        } else {
          promise.resolve(resultMap)
        }
      }

      Activity.RESULT_CANCELED -> {
        promise.reject("CARDLENS_SCAN_CANCELED", "Document scanner was canceled by user.")
      }

      else -> {
        promise.reject("CARDLENS_SCAN_FAILED", "Document scanner failed with result code: $resultCode")
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    // No-op
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // recognizeText
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Run ML Kit text recognition on the image at [imageUri].
   */
  override fun recognizeText(imageUri: String, script: String, promise: Promise) {
    runOcrInternal(
      imageUri,
      script,
      onSuccess = { resultMap -> promise.resolve(resultMap) },
      onError = { errorMsg -> promise.reject("CARDLENS_OCR_ERROR", errorMsg) }
    )
  }

  /**
   * Internal OCR executor shared by recognizeText and startScanner auto-OCR.
   */
  private fun runOcrInternal(
    imageUri: String,
    script: String,
    onSuccess: (WritableMap) -> Unit,
    onError: (String) -> Unit
  ) {
    backgroundExecutor.execute {
      try {
        val image = ImageLoader.fromUri(reactApplicationContext, imageUri)

        when (script.lowercase()) {
          "devanagari" -> {
            devanagariRecognizer.process(image)
              .addOnSuccessListener(backgroundExecutor) { visionText ->
                try {
                  val result = Arguments.createMap()
                  result.putString("rawText", visionText.text)
                  result.putArray("blocks", serializeBlocks(visionText.textBlocks))
                  onSuccess(result)
                } catch (e: Exception) {
                  onError(e.message ?: "Failed to serialize OCR result")
                }
              }
              .addOnFailureListener(backgroundExecutor) { e ->
                onError(e.message ?: "OCR processing failed")
              }
          }
          "latin" -> {
            latinRecognizer.process(image)
              .addOnSuccessListener(backgroundExecutor) { visionText ->
                try {
                  val result = Arguments.createMap()
                  result.putString("rawText", visionText.text)
                  result.putArray("blocks", serializeBlocks(visionText.textBlocks))
                  onSuccess(result)
                } catch (e: Exception) {
                  onError(e.message ?: "Failed to serialize OCR result")
                }
              }
              .addOnFailureListener(backgroundExecutor) { e ->
                onError(e.message ?: "OCR processing failed")
              }
          }
          else -> {
            // "auto": Run Latin and Devanagari concurrently and fuse them
            val lock = Any()
            var latinVision: com.google.mlkit.vision.text.Text? = null
            var devVision: com.google.mlkit.vision.text.Text? = null
            var isLatinDone = false
            var isDevDone = false
            var reported = false

            fun tryFinish() {
              synchronized(lock) {
                if (reported) return
                if (isLatinDone && isDevDone) {
                  reported = true
                  val lText = latinVision?.text ?: ""
                  val dText = devVision?.text ?: ""
                  val result = Arguments.createMap()

                  if (ScriptDetector.hasDevanagariCodepoints(dText)) {
                    val lBlocks = latinVision?.let { toRawBlocks(it) } ?: emptyList()
                    val dBlocks = devVision?.let { toRawBlocks(it) } ?: emptyList()
                    val fusedBlocks = CardScannerEngine.fuseOcrBlocks(lBlocks, dBlocks)
                    val fusedText = CardScannerEngine.fuseRawText(lText, dText)
                    result.putString("rawText", fusedText)
                    result.putArray("blocks", serializeRawBlocks(fusedBlocks))
                  } else {
                    val bestVision = latinVision ?: devVision
                    if (bestVision != null) {
                      result.putString("rawText", bestVision.text)
                      result.putArray("blocks", serializeBlocks(bestVision.textBlocks))
                    } else {
                      result.putString("rawText", "")
                      result.putArray("blocks", Arguments.createArray())
                    }
                  }
                  onSuccess(result)
                }
              }
            }

            latinRecognizer.process(image)
              .addOnSuccessListener(backgroundExecutor) { vision ->
                synchronized(lock) {
                  latinVision = vision
                  isLatinDone = true
                  tryFinish()
                }
              }
              .addOnFailureListener(backgroundExecutor) {
                synchronized(lock) {
                  isLatinDone = true
                  tryFinish()
                }
              }

            devanagariRecognizer.process(image)
              .addOnSuccessListener(backgroundExecutor) { vision ->
                synchronized(lock) {
                  devVision = vision
                  isDevDone = true
                  tryFinish()
                }
              }
              .addOnFailureListener(backgroundExecutor) {
                synchronized(lock) {
                  isDevDone = true
                  tryFinish()
                }
              }
          }
        }
      } catch (e: Exception) {
        onError(e.message ?: "Failed to load image from URI")
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // extractContactFields (Phase 2)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extract script-agnostic contact fields (phones, emails, websites, GSTIN, pincodes)
   * from any text string.
   */
  override fun extractContactFields(text: String, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val fields = FieldExtractor.extractContactFields(text)
        val result = Arguments.createMap()

        val phonesArray = Arguments.createArray()
        fields.phoneNumbers.forEach { phonesArray.pushString(it) }
        result.putArray("phoneNumbers", phonesArray)

        val emailsArray = Arguments.createArray()
        fields.emails.forEach { emailsArray.pushString(it) }
        result.putArray("emails", emailsArray)

        val websitesArray = Arguments.createArray()
        fields.websites.forEach { websitesArray.pushString(it) }
        result.putArray("websites", websitesArray)

        val gstinArray = Arguments.createArray()
        fields.gstin.forEach { gstinArray.pushString(it) }
        result.putArray("gstin", gstinArray)

        val pincodesArray = Arguments.createArray()
        fields.pincodes.forEach { pincodesArray.pushString(it) }
        result.putArray("pincodes", pincodesArray)

        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CARDLENS_EXTRACT_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // extractCardLayout (Phase 3)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extract card layout fields (companyName, tagline, contactPersons, addressLines)
   * using TextBlock and TextLine bounding box geometry.
   */
  override fun extractCardLayout(rawOcrResult: ReadableMap, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val rawBlocks = mutableListOf<RawBlock>()
        val blocksArray = if (rawOcrResult.hasKey("blocks")) rawOcrResult.getArray("blocks") else null

        if (blocksArray != null) {
          for (i in 0 until blocksArray.size()) {
            val blockMap = blocksArray.getMap(i) ?: continue
            val blockText = if (blockMap.hasKey("text")) blockMap.getString("text") ?: "" else ""
            val blockBox = deserializeBoundingBox(blockMap.getMap("boundingBox"))

            val linesList = mutableListOf<RawLine>()
            val linesArray = if (blockMap.hasKey("lines")) blockMap.getArray("lines") else null
            if (linesArray != null) {
              for (j in 0 until linesArray.size()) {
                val lineMap = linesArray.getMap(j) ?: continue
                val lineText = if (lineMap.hasKey("text")) lineMap.getString("text") ?: "" else ""
                val lineBox = deserializeBoundingBox(lineMap.getMap("boundingBox"))
                linesList.add(RawLine(lineText, lineBox))
              }
            }
            rawBlocks.add(RawBlock(blockText, blockBox, linesList))
          }
        }

        val layout = CardLayoutParser.parseLayout(rawBlocks)
        val result = Arguments.createMap()

        if (layout.companyName != null) {
          result.putString("companyName", layout.companyName)
        } else {
          result.putNull("companyName")
        }

        if (layout.tagline != null) {
          result.putString("tagline", layout.tagline)
        } else {
          result.putNull("tagline")
        }

        val personsArray = Arguments.createArray()
        layout.contactPersons.forEach { person ->
          val personMap = Arguments.createMap()
          personMap.putString("name", person.name)
          if (person.role != null) {
            personMap.putString("role", person.role)
          } else {
            personMap.putNull("role")
          }
          personsArray.pushMap(personMap)
        }
        result.putArray("contactPersons", personsArray)

        val addressArray = Arguments.createArray()
        layout.addressLines.forEach { addressArray.pushString(it) }
        result.putArray("addressLines", addressArray)

        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CARDLENS_LAYOUT_ERROR", e.message, e)
      }
    }
  }

  private fun deserializeBoundingBox(map: ReadableMap?): BoundingBox {
    if (map == null) return BoundingBox(0, 0, 0, 0)
    val left = if (map.hasKey("left")) map.getInt("left") else 0
    val top = if (map.hasKey("top")) map.getInt("top") else 0
    val right = if (map.hasKey("right")) map.getInt("right") else 0
    val bottom = if (map.hasKey("bottom")) map.getInt("bottom") else 0
    return BoundingBox(left, top, right, bottom)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // scanBarcodes
  // ─────────────────────────────────────────────────────────────────────────────


  override fun scanBarcodes(imageUri: String, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val image = ImageLoader.fromUri(reactApplicationContext, imageUri)
        val scanner = BarcodeScanning.getClient()

        scanner.process(image)
          .addOnSuccessListener(backgroundExecutor) { barcodes ->
            try {
              val result = Arguments.createArray()
              for (barcode in barcodes) {
                result.pushMap(serializeBarcode(barcode))
              }
              promise.resolve(result)
            } catch (e: Exception) {
              promise.reject("CARDLENS_SERIALIZE_ERROR", e.message, e)
            }
          }
          .addOnFailureListener(backgroundExecutor) { e ->
            promise.reject("CARDLENS_BARCODE_ERROR", e.message, e)
          }

      } catch (e: Exception) {
        promise.reject("CARDLENS_INPUT_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Multi-page & Single-page OCR Extractors
  // ─────────────────────────────────────────────────────────────────────────────

  private data class PageOcrData(
    val rawText: String,
    val blocks: List<RawBlock>,
    val qrCodeData: String?
  )

  private fun scanBarcodeSafely(inputImage: InputImage, onResult: (String?) -> Unit) {
    try {
      qrBarcodeScanner.process(inputImage)
        .addOnSuccessListener(backgroundExecutor) { barcodes ->
          val qrBarcode = barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE } ?: barcodes.firstOrNull()
          onResult(qrBarcode?.rawValue)
        }
        .addOnFailureListener(backgroundExecutor) {
          onResult(null)
        }
    } catch (e: Exception) {
      onResult(null)
    }
  }

  private fun extractPageOcrData(
    imageUri: String,
    onSuccess: (PageOcrData) -> Unit,
    onError: (Exception) -> Unit
  ) {
    backgroundExecutor.execute {
      try {
        // Load InputImage once from disk and share with all detectors (capped to 2048px for fast processing)
        val inputImage = ImageLoader.fromUri(reactApplicationContext, imageUri)

        val lock = Any()
        var qrCodeResult: String? = null
        var isQrDone = false
        var isLatinDone = false
        var isDevDone = false
        var latinVision: com.google.mlkit.vision.text.Text? = null
        var devVision: com.google.mlkit.vision.text.Text? = null
        var reported = false

        fun tryComplete() {
          synchronized(lock) {
            if (reported) return
            if (isQrDone && isLatinDone && isDevDone) {
              reported = true
              val lText = latinVision?.text ?: ""
              val dText = devVision?.text ?: ""
              val lBlocks = latinVision?.let { toRawBlocks(it) } ?: emptyList()
              val dBlocks = devVision?.let { toRawBlocks(it) } ?: emptyList()

              val fusedText: String
              val fusedBlocks: List<RawBlock>

              if (ScriptDetector.hasDevanagariCodepoints(dText)) {
                fusedText = CardScannerEngine.fuseRawText(lText, dText)
                fusedBlocks = CardScannerEngine.fuseOcrBlocks(lBlocks, dBlocks)
              } else {
                fusedText = if (lText.isNotBlank()) lText else dText
                fusedBlocks = if (lBlocks.isNotEmpty()) lBlocks else dBlocks
              }

              onSuccess(PageOcrData(fusedText, fusedBlocks, qrCodeResult))
            }
          }
        }

        // 1. Run QR barcode scanning in parallel (fast: ~30ms on constrained format)
        scanBarcodeSafely(inputImage) { qr ->
          synchronized(lock) {
            qrCodeResult = qr
            isQrDone = true
            tryComplete()
          }
        }

        // 2. Run zero-download, pre-installed Latin recognizer concurrently (< 150ms)
        latinRecognizer.process(inputImage)
          .addOnSuccessListener(backgroundExecutor) { vision ->
            synchronized(lock) {
              latinVision = vision
              isLatinDone = true
              tryComplete()
            }
          }
          .addOnFailureListener(backgroundExecutor) {
            synchronized(lock) {
              isLatinDone = true
              tryComplete()
            }
          }

        // 3. Run Devanagari recognizer concurrently in parallel for bilingual Marathi/Hindi cards
        devanagariRecognizer.process(inputImage)
          .addOnSuccessListener(backgroundExecutor) { vision ->
            synchronized(lock) {
              devVision = vision
              isDevDone = true
              tryComplete()
            }
          }
          .addOnFailureListener(backgroundExecutor) {
            synchronized(lock) {
              isDevDone = true
              tryComplete()
            }
          }
      } catch (e: Exception) {
        onError(e)
      }
    }
  }

  private fun extractMultiplePagesOcrData(
    uris: List<String>,
    index: Int = 0,
    accumulated: MutableList<PageOcrData> = mutableListOf(),
    onComplete: (List<PageOcrData>) -> Unit,
    onError: (Exception) -> Unit
  ) {
    if (index >= uris.size) {
      onComplete(accumulated)
      return
    }
    extractPageOcrData(uris[index], { pageData ->
      accumulated.add(pageData)
      extractMultiplePagesOcrData(uris, index + 1, accumulated, onComplete, onError)
    }, onError)
  }

  private fun toUriList(array: ReadableArray): List<String> {
    val list = mutableListOf<String>()
    for (i in 0 until array.size()) {
      array.getString(i)?.let { list.add(it) }
    }
    return list
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // scanCard (Phase 4 Orchestrator)
  // ─────────────────────────────────────────────────────────────────────────────

  override fun scanCard(imageUri: String, promise: Promise) {
    extractPageOcrData(imageUri, { pageData ->
      processAndResolveCardFused(pageData.rawText, pageData.blocks, pageData.qrCodeData, promise)
    }, { e ->
      promise.reject("CARDLENS_OCR_ERROR", e.message, e)
    })
  }

  
  /**
   * Universal Multi-Page Business Card Asymmetric Disentangler:
   * Merges multiple card pages by distinguishing primary contact pages (with phones/emails/director)
   * from secondary marketing/offerings pages (tag clouds, word collages, services catalogs).
   */
  private fun mergeMultipleCardPages(cards: List<BusinessCard>): BusinessCard {
    if (cards.size == 1) return cards.first()

    val primaryCard = cards.maxByOrNull { card ->
      (card.phoneNumbers.size * 10) +
      (card.emails.size * 10) +
      (card.addressLines.size * 5) +
      (if (card.contactPersons.any { !it.role.isNullOrBlank() }) 20 else 0) +
      (if (card.pincode != null) 5 else 0)
    }

    val validPersons = mutableListOf<ContactPerson>()
    val redirectedServices = mutableListOf<String>()

    for (card in cards) {
      val isPrimary = (card == primaryCard)
      val cardHasContacts = card.phoneNumbers.isNotEmpty() || card.emails.isNotEmpty()

      for (p in card.contactPersons) {
        val hasExplicitRole = !p.role.isNullOrBlank()
        val hasSalutation = CardLayoutParser.matchSalutation(p.name) != null ||
          p.name.matches(Regex("(?i)^(?:Dr\\.|Adv\\.|Mr\\.|Mrs\\.|Ms\\.|Shri\\b).*"))
        val hasAttachedPhone = p.phones.isNotEmpty()
        val isAnchored = hasExplicitRole || hasSalutation || hasAttachedPhone || (isPrimary && cardHasContacts) || (!isPrimary && cardHasContacts && card.contactPersons.size <= 2)

        val nameLower = p.name.lowercase()
        val isNonPersonKeyword = CardLayoutParser.NON_PERSON_KEYWORDS.any { nameLower.contains(it) }

        if (isAnchored && !isNonPersonKeyword && CardLayoutParser.isValidPersonName(p.name, emptySet())) {
          if (!validPersons.any { it.name.equals(p.name, ignoreCase = true) }) {
            validPersons.add(p)
          }
        } else {
          val cleanService = p.name.replace(CardLayoutParser.BULLET_PREFIX_REGEX, "").trim()
          if (cleanService.length >= 2 && !CardLayoutParser.SERVICES_SECTION_HEADER_REGEX.matches(cleanService)) {
            redirectedServices.add(cleanService)
          }
        }
      }
    }

    return BusinessCard(
      companyName = cards.firstOrNull { !it.companyName.isNullOrBlank() }?.companyName,
      tagline = cards.firstOrNull { !it.tagline.isNullOrBlank() }?.tagline,
      slogan = cards.firstOrNull { !it.slogan.isNullOrBlank() }?.slogan,
      providedServices = (cards.flatMap { it.providedServices } + redirectedServices).distinct(),
      contactPersons = validPersons,
      phoneNumbers = cards.flatMap { it.phoneNumbers }.distinct(),
      labeledPhones = cards.flatMap { it.labeledPhones }.distinctBy { it.number },
      emails = cards.flatMap { it.emails }.distinct(),
      websites = cards.flatMap { it.websites }.distinct(),
      addressLines = cards.flatMap { it.addressLines }.distinct(),
      pincode = cards.firstOrNull { !it.pincode.isNullOrBlank() }?.pincode,
      gstin = cards.firstOrNull { !it.gstin.isNullOrBlank() }?.gstin,
      qrCodeData = cards.firstOrNull { !it.qrCodeData.isNullOrBlank() }?.qrCodeData,
      rawText = cards.mapIndexed { idx, c -> "--- Page ${idx + 1} ---\n${c.rawText}" }.joinToString("\n\n")
    )
  }

  override fun scanCardPages(imageUris: ReadableArray, promise: Promise) {
    val uris = toUriList(imageUris)
    if (uris.isEmpty()) {
      promise.reject("CARDLENS_INPUT_ERROR", "imageUris must not be empty")
      return
    }
    extractMultiplePagesOcrData(uris, 0, mutableListOf(), { pagesData ->
      backgroundExecutor.execute {
        try {
          val cards = pagesData.map { pageData ->
            CardScannerEngine.assembleBusinessCard(pageData.rawText, pageData.blocks, pageData.qrCodeData)
          }
          val mergedCard = mergeMultipleCardPages(cards)
          promise.resolve(mergedCard.toWritableMap())
        } catch (e: Exception) {
          promise.reject("CARDLENS_CARD_PAGES_ERROR", e.message, e)
        }
      }
    }, { e ->
      promise.reject("CARDLENS_CARD_PAGES_ERROR", e.message, e)
    })
  }

  private fun toRawBlocks(visionText: com.google.mlkit.vision.text.Text): List<RawBlock> {
    return visionText.textBlocks.map { block ->
      val blockBox = block.boundingBox?.let { BoundingBox(it.left, it.top, it.right, it.bottom) }
        ?: BoundingBox(0, 0, 0, 0)
      val lines = block.lines.map { line ->
        val lineBox = line.boundingBox?.let { BoundingBox(it.left, it.top, it.right, it.bottom) }
          ?: BoundingBox(0, 0, 0, 0)
        RawLine(line.text, lineBox)
      }
      RawBlock(block.text, blockBox, lines)
    }
  }

  private fun processAndResolveCardFused(
    fusedText: String,
    fusedBlocks: List<RawBlock>,
    qrCodeData: String?,
    promise: Promise
  ) {
    backgroundExecutor.execute {
      try {
        val businessCard = CardScannerEngine.assembleBusinessCard(
          rawText = fusedText,
          blocks = fusedBlocks,
          qrCodeData = qrCodeData
        )
        promise.resolve(businessCard.toWritableMap())
      } catch (e: Exception) {
        promise.reject("CARDLENS_ASSEMBLE_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // scanBill (Phase 5 Table Reconstruction & Document Extraction)
  // ─────────────────────────────────────────────────────────────────────────────

  override fun scanBill(imageUri: String, promise: Promise) {
    extractPageOcrData(imageUri, { pageData ->
      backgroundExecutor.execute {
        try {
          val bill = BillScannerEngine.parseBill(pageData.rawText, pageData.blocks)
          promise.resolve(bill.toWritableMap())
        } catch (e: Exception) {
          promise.reject("CARDLENS_BILL_ERROR", e.message, e)
        }
      }
    }, { e ->
      promise.reject("CARDLENS_BILL_ERROR", e.message, e)
    })
  }

  override fun scanBillPages(imageUris: ReadableArray, promise: Promise) {
    val uris = toUriList(imageUris)
    if (uris.isEmpty()) {
      promise.reject("CARDLENS_INPUT_ERROR", "imageUris must not be empty")
      return
    }
    extractMultiplePagesOcrData(uris, 0, mutableListOf(), { pagesData ->
      backgroundExecutor.execute {
        try {
          val bills = pagesData.map { pageData ->
            BillScannerEngine.parseBill(pageData.rawText, pageData.blocks)
          }
          val mergedBill = BillDocument(
            documentType = bills.firstOrNull { !it.documentType.isNullOrBlank() }?.documentType,
            issuerName = bills.firstOrNull { !it.issuerName.isNullOrBlank() }?.issuerName,
            invoiceNumber = bills.firstOrNull { !it.invoiceNumber.isNullOrBlank() }?.invoiceNumber,
            invoiceDate = bills.firstOrNull { !it.invoiceDate.isNullOrBlank() }?.invoiceDate,
            dueDate = bills.firstOrNull { !it.dueDate.isNullOrBlank() }?.dueDate,
            lineItems = bills.flatMap { it.lineItems },
            subtotal = bills.lastOrNull { it.subtotal != null }?.subtotal ?: bills.firstOrNull { it.subtotal != null }?.subtotal,
            amountDue = bills.lastOrNull { it.amountDue != null }?.amountDue ?: bills.firstOrNull { it.amountDue != null }?.amountDue,
            rawText = if (bills.size == 1) bills.first().rawText else bills.mapIndexed { idx, b -> "--- Page ${idx + 1} ---\n${b.rawText}" }.joinToString("\n\n")
          )
          promise.resolve(mergedBill.toWritableMap())
        } catch (e: Exception) {
          promise.reject("CARDLENS_BILL_PAGES_ERROR", e.message, e)
        }
      }
    }, { e ->
      promise.reject("CARDLENS_BILL_PAGES_ERROR", e.message, e)
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // scanDocument (Phase 6 Auto-Routing)
  // ─────────────────────────────────────────────────────────────────────────────

  override fun scanDocument(imageUri: String, promise: Promise) {
    extractPageOcrData(imageUri, { pageData ->
      routeAndResolveDocumentFused(pageData.rawText, pageData.blocks, pageData.qrCodeData, promise)
    }, { e ->
      promise.reject("CARDLENS_ROUTE_ERROR", e.message, e)
    })
  }

  override fun scanDocumentPages(imageUris: ReadableArray, promise: Promise) {
    val uris = toUriList(imageUris)
    if (uris.isEmpty()) {
      promise.reject("CARDLENS_INPUT_ERROR", "imageUris must not be empty")
      return
    }
    extractMultiplePagesOcrData(uris, 0, mutableListOf(), { pagesData ->
      backgroundExecutor.execute {
        try {
          val combinedText = pagesData.joinToString("\n") { it.rawText }
          val docType = DocumentClassifier.classifyDocument(combinedText)
          val result = Arguments.createMap()
          result.putString("type", docType)

          if (docType == "bill") {
            val bills = pagesData.map { pageData ->
              BillScannerEngine.parseBill(pageData.rawText, pageData.blocks)
            }
            val mergedBill = BillDocument(
              documentType = bills.firstOrNull { !it.documentType.isNullOrBlank() }?.documentType,
              issuerName = bills.firstOrNull { !it.issuerName.isNullOrBlank() }?.issuerName,
              invoiceNumber = bills.firstOrNull { !it.invoiceNumber.isNullOrBlank() }?.invoiceNumber,
              invoiceDate = bills.firstOrNull { !it.invoiceDate.isNullOrBlank() }?.invoiceDate,
              dueDate = bills.firstOrNull { !it.dueDate.isNullOrBlank() }?.dueDate,
              lineItems = bills.flatMap { it.lineItems },
              subtotal = bills.lastOrNull { it.subtotal != null }?.subtotal ?: bills.firstOrNull { it.subtotal != null }?.subtotal,
              amountDue = bills.lastOrNull { it.amountDue != null }?.amountDue ?: bills.firstOrNull { it.amountDue != null }?.amountDue,
              rawText = bills.mapIndexed { idx, b -> "--- Page ${idx + 1} ---\n${b.rawText}" }.joinToString("\n\n")
            )
            result.putMap("data", mergedBill.toWritableMap())
          } else {
            val cards = pagesData.map { pageData ->
              CardScannerEngine.assembleBusinessCard(pageData.rawText, pageData.blocks, pageData.qrCodeData)
            }
            val mergedCard = mergeMultipleCardPages(cards)
            result.putMap("data", mergedCard.toWritableMap())
          }

          promise.resolve(result)
        } catch (e: Exception) {
          promise.reject("CARDLENS_DOCUMENT_PAGES_ERROR", e.message, e)
        }
      }
    }, { e ->
      promise.reject("CARDLENS_DOCUMENT_PAGES_ERROR", e.message, e)
    })
  }

  private fun routeAndResolveDocumentFused(
    text: String,
    blocks: List<RawBlock>,
    qrCodeData: String?,
    promise: Promise
  ) {
    backgroundExecutor.execute {
      try {
        val docType = DocumentClassifier.classifyDocument(text)
        val result = Arguments.createMap()
        result.putString("type", docType)

        if (docType == "bill") {
          val bill = BillScannerEngine.parseBill(text, blocks)
          result.putMap("data", bill.toWritableMap())
        } else {
          val card = CardScannerEngine.assembleBusinessCard(text, blocks, qrCodeData)
          result.putMap("data", card.toWritableMap())
        }

        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CARDLENS_ROUTE_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialisation helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private fun serializeBlocks(
    textBlocks: List<com.google.mlkit.vision.text.Text.TextBlock>
  ): WritableArray {
    val blocksArray = Arguments.createArray()
    for (block in textBlocks) {
      val blockMap = Arguments.createMap()
      blockMap.putString("text", block.text)
      blockMap.putMap("boundingBox", serializeBoundingBox(block.boundingBox))
      blockMap.putArray("lines", serializeLines(block.lines))
      blocksArray.pushMap(blockMap)
    }
    return blocksArray
  }

  private fun serializeRawBlocks(
    rawBlocks: List<RawBlock>
  ): WritableArray {
    val blocksArray = Arguments.createArray()
    for (block in rawBlocks) {
      val blockMap = Arguments.createMap()
      blockMap.putString("text", block.text)
      val boxMap = Arguments.createMap().apply {
        putInt("left", block.boundingBox.left)
        putInt("top", block.boundingBox.top)
        putInt("right", block.boundingBox.right)
        putInt("bottom", block.boundingBox.bottom)
        putInt("width", block.boundingBox.width)
        putInt("height", block.boundingBox.height)
      }
      blockMap.putMap("boundingBox", boxMap)

      val linesArray = Arguments.createArray()
      for (line in block.lines) {
        val lineMap = Arguments.createMap()
        lineMap.putString("text", line.text)
        val lineBoxMap = Arguments.createMap().apply {
          putInt("left", line.boundingBox.left)
          putInt("top", line.boundingBox.top)
          putInt("right", line.boundingBox.right)
          putInt("bottom", line.boundingBox.bottom)
          putInt("width", line.boundingBox.width)
          putInt("height", line.boundingBox.height)
        }
        lineMap.putMap("boundingBox", lineBoxMap)
        lineMap.putArray("elements", Arguments.createArray())
        linesArray.pushMap(lineMap)
      }
      blockMap.putArray("lines", linesArray)
      blocksArray.pushMap(blockMap)
    }
    return blocksArray
  }

  private fun serializeLines(
    lines: List<com.google.mlkit.vision.text.Text.Line>
  ): WritableArray {
    val linesArray = Arguments.createArray()
    for (line in lines) {
      val lineMap = Arguments.createMap()
      lineMap.putString("text", line.text)
      lineMap.putMap("boundingBox", serializeBoundingBox(line.boundingBox))
      lineMap.putArray("elements", serializeElements(line.elements))
      linesArray.pushMap(lineMap)
    }
    return linesArray
  }

  private fun serializeElements(
    elements: List<com.google.mlkit.vision.text.Text.Element>
  ): WritableArray {
    val elemsArray = Arguments.createArray()
    for (elem in elements) {
      val elemMap = Arguments.createMap()
      elemMap.putString("text", elem.text)
      elemMap.putMap("boundingBox", serializeBoundingBox(elem.boundingBox))
      elemsArray.pushMap(elemMap)
    }
    return elemsArray
  }

  private fun serializeBoundingBox(rect: android.graphics.Rect?): WritableMap {
    val map = Arguments.createMap()
    if (rect != null) {
      map.putInt("left", rect.left)
      map.putInt("top", rect.top)
      map.putInt("right", rect.right)
      map.putInt("bottom", rect.bottom)
    } else {
      map.putInt("left", 0)
      map.putInt("top", 0)
      map.putInt("right", 0)
      map.putInt("bottom", 0)
    }
    return map
  }

  private fun serializeBarcode(barcode: Barcode): WritableMap {
    val map = Arguments.createMap()
    map.putString("rawValue", barcode.rawValue ?: "")
    map.putString("format", barcodeFormatName(barcode.format))
    map.putMap("boundingBox", serializeBoundingBox(barcode.boundingBox))
    return map
  }

  private fun barcodeFormatName(format: Int): String = when (format) {
    Barcode.FORMAT_QR_CODE     -> "QR_CODE"
    Barcode.FORMAT_DATA_MATRIX -> "DATA_MATRIX"
    Barcode.FORMAT_PDF417      -> "PDF417"
    Barcode.FORMAT_AZTEC       -> "AZTEC"
    Barcode.FORMAT_EAN_13      -> "EAN_13"
    Barcode.FORMAT_EAN_8       -> "EAN_8"
    Barcode.FORMAT_UPC_A       -> "UPC_A"
    Barcode.FORMAT_UPC_E       -> "UPC_E"
    Barcode.FORMAT_CODE_39     -> "CODE_39"
    Barcode.FORMAT_CODE_93     -> "CODE_93"
    Barcode.FORMAT_CODE_128    -> "CODE_128"
    Barcode.FORMAT_CODABAR     -> "CODABAR"
    Barcode.FORMAT_ITF         -> "ITF"
    else                       -> "UNKNOWN"
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // On-Device Thinking Module — Download Bridge
  // Inference (GGUF/llama.cpp) runs in JS via llama.rn.
  // ─────────────────────────────────────────────────────────────────────────────

  override fun loadThinkingModel(modelPath: String, promise: Promise) {
    // No-op: model loading is handled by llama.rn in JS
    promise.resolve(true)
  }

  override fun isThinkingModelReady(promise: Promise) {
    // No-op: state is managed by llama.rn context in JS
    promise.resolve(false)
  }

  override fun refineCardWithThinkingModule(rawText: String, promise: Promise) {
    // Semantic Thinking Reasoner — instant, zero-dependency, pure Kotlin
    backgroundExecutor.execute {
      try {
        val t0 = System.currentTimeMillis()
        val refined = ThinkingModuleEngine.refineWithSemanticReasoning(rawText)
        val t1 = System.currentTimeMillis()
        android.util.Log.i("CardLensSpeed", "refineWithSemanticReasoning took ${t1 - t0}ms")
        val map = refined.toWritableMap()
        val t2 = System.currentTimeMillis()
        android.util.Log.i("CardLensSpeed", "toWritableMap took ${t2 - t1}ms")
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("CARDLENS_THINKING_INFERENCE_ERROR", e.message, e)
      }
    }
  }

  override fun unloadThinkingModel(promise: Promise) {
    // No-op: unloading is handled by llama.rn in JS
    promise.resolve(null)
  }

  override fun downloadThinkingModel(url: String, fileName: String, authToken: String?, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val path = ThinkingModuleEngine.downloadModel(
          reactApplicationContext,
          url,
          fileName,
          authToken?.takeIf { it.isNotBlank() }
        ) { downloaded, total ->
          try {
            val params = Arguments.createMap()
            params.putString("fileName", fileName)
            params.putDouble("downloadedBytes", downloaded.toDouble())
            params.putDouble("totalBytes", total.toDouble())
            params.putDouble("percentage", if (total > 0) (downloaded.toDouble() / total.toDouble()) * 100.0 else 0.0)
            reactApplicationContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onThinkingModelDownloadProgress", params)
          } catch (_: Exception) {}
        }
        promise.resolve(path)
      } catch (e: Exception) {
        promise.reject("CARDLENS_THINKING_DOWNLOAD_ERROR", e.message, e)
      }
    }
  }

  override fun deleteThinkingModel(fileName: String, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val deleted = ThinkingModuleEngine.deleteDownloadedModel(reactApplicationContext, fileName)
        promise.resolve(deleted)
      } catch (e: Exception) {
        promise.reject("CARDLENS_THINKING_DELETE_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PaddleOCR Multilingual On-Device Engine
  // ─────────────────────────────────────────────────────────────────────────────

  override fun recognizeTextPaddle(imageUri: String, options: ReadableMap, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val bitmap = ImageLoader.loadBitmap(reactApplicationContext, imageUri)
        val boxThresh = if (options.hasKey("boxThresh")) options.getDouble("boxThresh").toFloat() else 0.3f
        val unclipRatio = if (options.hasKey("unclipRatio")) options.getDouble("unclipRatio").toFloat() else 1.6f
        val detLimitSideLen = if (options.hasKey("detLimitSideLen")) options.getInt("detLimitSideLen") else 1280
        val script = if (options.hasKey("script")) {
          options.getString("script") ?: "devanagari"
        } else if (options.hasKey("language")) {
          PaddleOcrModelManager.resolveScriptForLanguage(options.getString("language"))
        } else {
          PaddleOcrModelManager.getPrimaryAvailableScript(reactApplicationContext)
        }

        val result = paddleOcrEngine.process(bitmap, boxThresh, unclipRatio, detLimitSideLen, script)
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CARDLENS_PADDLE_OCR_ERROR", e.message ?: "PaddleOCR processing failed", e)
      }
    }
  }

  override fun isPaddleOcrReady(promise: Promise) {
    try {
      val ready = PaddleOcrModelManager.isReady(reactApplicationContext)
      promise.resolve(ready)
    } catch (e: Exception) {
      promise.reject("CARDLENS_PADDLE_STATUS_ERROR", e.message, e)
    }
  }

  override fun downloadPaddleOcrModels(options: ReadableMap, promise: Promise) {
    backgroundExecutor.execute {
      try {
        val script = if (options.hasKey("script")) {
          PaddleOcrModelManager.resolveScriptForLanguage(options.getString("script"))
        } else if (options.hasKey("language")) {
          PaddleOcrModelManager.resolveScriptForLanguage(options.getString("language"))
        } else {
          "devanagari"
        }

        val detDir = PaddleOcrModelManager.getPaddleDir(reactApplicationContext)
        val scriptDir = PaddleOcrModelManager.getPaddleDir(reactApplicationContext, script)

        val detUrl = if (options.hasKey("detModelUrl")) options.getString("detModelUrl")!! else PaddleOcrModelManager.DEFAULT_DET_MODEL_URL
        val recUrl = if (options.hasKey("recModelUrl")) options.getString("recModelUrl")!! else PaddleOcrModelManager.getDefaultRecModelUrl(script)
        val keysUrl = if (options.hasKey("keysUrl")) options.getString("keysUrl")!! else PaddleOcrModelManager.getDefaultKeysUrl(script)
        val authToken = if (options.hasKey("authToken")) options.getString("authToken") else null

        val filesToDownload = listOf(
          Triple("det", detUrl, java.io.File(detDir, PaddleOcrModelManager.DET_FILENAME)),
          Triple("rec", recUrl, java.io.File(scriptDir, PaddleOcrModelManager.REC_FILENAME)),
          Triple("keys", keysUrl, java.io.File(scriptDir, PaddleOcrModelManager.KEYS_FILENAME))
        )

        for ((fileKey, url, destFile) in filesToDownload) {
          PaddleOcrModelManager.downloadFile(url, destFile, authToken) { downloaded, total ->
            try {
              val params = Arguments.createMap()
              params.putString("file", fileKey)
              params.putString("script", script)
              params.putDouble("downloadedBytes", downloaded.toDouble())
              params.putDouble("totalBytes", total.toDouble())
              params.putDouble("percent", if (total > 0) (downloaded.toDouble() / total.toDouble()) * 100.0 else 0.0)
              reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onPaddleOcrDownloadProgress", params)
            } catch (_: Exception) {}
          }
        }

        val initialized = paddleOcrEngine.initSessions(script = script)
        promise.resolve(initialized)
      } catch (e: Exception) {
        promise.reject("CARDLENS_PADDLE_DOWNLOAD_ERROR", e.message ?: "Failed to download PaddleOCR models", e)
      }
    }
  }
}

