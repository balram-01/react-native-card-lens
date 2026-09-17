/**
 * Public JS API surface for react-native-card-lens.
 *
 * Wraps the raw Codegen bridge with proper TypeScript types so callers
 * always work with `RawOcrResult` / `BarcodeResult` — not `UnsafeObject`.
 */
import NativeCardLens from './NativeCardLens';
import { recognizeTextWithPaddle } from './PaddleOCR';
import type {
  RawOcrResult,
  BarcodeResult,
  OcrScript,
  RecognizeTextOptions,
  DocumentScannerOptions,
  PickDocumentOptions,
  ScanResult,
  ContactFields,
  CardLayoutFields,
  BusinessCard,
  BillDocument,
  DocumentScanResult,
  PaddleOcrOptions,
  ScanCardOptions,
  ScanDocumentOptions,
  ScanBillOptions,
} from './types';

// ─── re-export all types so library consumers can import from one place ───────
export type {
  BoundingBox,
  TextElement,
  TextLine,
  TextBlock,
  RawOcrResult,
  BarcodeResult,
  BarcodeFormat,
  OcrScript,
  ScannerMode,
  DocumentScannerOptions,
  PickDocumentOptions,
  ScanResult,
  ContactFields,
  LabeledPhone,
  ContactPerson,
  CardLayoutFields,
  BusinessCard,
  LineItem,
  BillDocument,
  DocumentType,
  DocumentScanResult,
  OcrEngine,
  SupportedOcrLanguage,
  OcrScriptFamily,
  ScriptModelEndpoints,
  PaddleOcrOptions,
  PaddleOcrModelConfig,
  PaddleOcrDownloadProgress,
  RecognizeTextOptions,
  ScanCardOptions,
  ScanDocumentOptions,
  ScanBillOptions,
  ConfidenceAssessment,
} from './types';

export {
  LANGUAGE_TO_SCRIPT,
  SCRIPT_MODEL_REGISTRY,
  DEFAULT_PADDLE_DET_URL,
  resolveOcrScriptFamily,
} from './types';

export {
  isThinkingModelReady,
  refineCardWithThinkingModule,
  downloadThinkingModel,
} from './ThinkingModule';
export type { ThinkingModelDownloadProgress } from './ThinkingModule';

export {
  isPaddleOcrReady,
  downloadPaddleOcrModels,
  recognizeTextWithPaddle,
  PADDLE_OCR_DOWNLOAD_EVENT,
} from './PaddleOCR';

// ─── typed bridge wrappers ────────────────────────────────────────────────────

/**
 * Run on-device OCR on an image and return the full TextBlock hierarchy
 * including bounding boxes. Supports Google ML Kit (default) or PaddleOCR.
 *
 * @param imageUri         `file://` or `content://` URI of the image to process.
 * @param scriptOrOptions  Script ('latin' | 'devanagari') or full RecognizeTextOptions.
 *
 * @example
 * ```ts
 * // Default ML Kit:
 * const result = await recognizeText('file:///data/.../card.jpg', 'latin');
 *
 * // High-Efficiency Multilingual PaddleOCR:
 * const result = await recognizeText('file:///data/.../card.jpg', { engine: 'paddleocr' });
 * ```
 */
export async function recognizeText(
  imageUri: string,
  scriptOrOptions: OcrScript | RecognizeTextOptions = 'auto'
): Promise<RawOcrResult> {
  if (typeof scriptOrOptions === 'object' && scriptOrOptions !== null) {
    const {
      engine = 'mlkit',
      script = 'auto',
      paddleOptions,
    } = scriptOrOptions;
    if (engine === 'paddleocr') {
      return recognizeTextWithPaddle(imageUri, paddleOptions);
    }
    const raw = await NativeCardLens.recognizeText(imageUri, script);
    return raw as unknown as RawOcrResult;
  }

  const raw = await NativeCardLens.recognizeText(imageUri, scriptOrOptions);
  return raw as unknown as RawOcrResult;
}

/**
 * Run on-device ML Kit barcode scanning on an image.  Detects QR codes and
 * all common 1-D/2-D barcode formats.  No data leaves the device.
 *
 * @param imageUri  `file://` or `content://` URI of the image to process.
 *
 * @example
 * ```ts
 * const barcodes = await scanBarcodes('file:///data/.../card.jpg');
 * barcodes.forEach(b => console.log(b.rawValue, b.format));
 * ```
 */
export async function scanBarcodes(imageUri: string): Promise<BarcodeResult[]> {
  const raw = await NativeCardLens.scanBarcodes(imageUri);
  return raw as unknown as BarcodeResult[];
}

/**
 * Directly launch the on-device camera scanner UI to scan a card or document.
 *
 * Features:
 * - Real-time document/card outline detection
 * - Automatic or manual capture
 * - Automatic edge cropping and perspective correction
 * - Contrast enhancement and shadow removal
 * - No camera permissions required from host app (managed by Google Play Services)
 * - Automatically performs on-device OCR on the scanned card/doc (if autoOcr: true, default)
 *
 * @param options  Configuration options for the scanner.
 * @returns        A `ScanResult` containing the high-quality cropped `imageUri` and `ocrResult`.
 *
 * @example
 * ```ts
 * const scan = await startScanner({ autoOcr: true, scannerMode: 'FULL' });
 * console.log('Cropped Image URI:', scan.imageUri);
 * console.log('Extracted OCR Text:', scan.ocrResult?.rawText);
 * ```
 */
export async function startScanner(
  options: DocumentScannerOptions = {}
): Promise<ScanResult> {
  const config = {
    pageLimit: options.pageLimit ?? 1,
    scannerMode: options.scannerMode ?? 'FULL',
    allowGalleryImport: options.allowGalleryImport ?? true,
    autoOcr: options.autoOcr ?? true,
    script: options.script ?? 'auto',
  };
  const raw = await NativeCardLens.startScanner(config);
  return raw as unknown as ScanResult;
}

/**
 * Open the native system storage / document picker to select a card image or PDF (including multi-page PDF).
 *
 * Automatically converts multi-page PDFs into high-resolution PNG page images on-device.
 *
 * @param options  Options for picking documents (allowPdf, autoOcr, script).
 * @returns        A `ScanResult` containing the primary `imageUri`, all `imageUris`, and optional `pdfUri`.
 *
 * @example
 * ```ts
 * const result = await pickDocument({ allowPdf: true, autoOcr: true });
 * console.log('Imported Image:', result.imageUri);
 * console.log('All Pages:', result.imageUris);
 * ```
 */
export async function pickDocument(
  options: PickDocumentOptions = {}
): Promise<ScanResult> {
  const config = {
    allowPdf: options.allowPdf ?? true,
    autoOcr: options.autoOcr ?? false,
    script: options.script ?? 'auto',
  };
  const raw = await NativeCardLens.pickDocument(config);
  return raw as unknown as ScanResult;
}

/**
 * Extract structured contact fields (phones, emails, websites, GSTIN, pincodes)
 * from any text string using pure on-device regex heuristics.
 *
 * @param text  The OCR text or string to parse.
 * @returns     ContactFields containing phoneNumbers, emails, websites, gstin, and pincodes.
 *
 * @example
 * ```ts
 * const fields = await extractContactFields(ocrResult.rawText);
 * console.log('Phones:', fields.phoneNumbers);
 * console.log('Emails:', fields.emails);
 * console.log('GSTIN:', fields.gstin);
 * ```
 */
export async function extractContactFields(
  text: string
): Promise<ContactFields> {
  const raw = await NativeCardLens.extractContactFields(text);
  return raw as unknown as ContactFields;
}

/**
 * Extract structured layout fields (companyName, tagline, contactPersons, addressLines)
 * from an OCR result using TextBlock and TextLine bounding-box geometry.
 *
 * @param rawOcrResult  The result returned by `recognizeText()` or `startScanner()`.
 * @returns             CardLayoutFields with companyName, tagline, contactPersons, addressLines.
 *
 * @example
 * ```ts
 * const ocr = await recognizeText('file:///card.jpg');
 * const layout = await extractCardLayout(ocr);
 * console.log('Company:', layout.companyName);
 * console.log('Tagline:', layout.tagline);
 * console.log('Persons:', layout.contactPersons);
 * console.log('Address:', layout.addressLines);
 * ```
 */
export async function extractCardLayout(
  rawOcrResult: RawOcrResult
): Promise<CardLayoutFields> {
  const raw = await NativeCardLens.extractCardLayout(
    rawOcrResult as unknown as object
  );
  return raw as unknown as CardLayoutFields;
}

/**
 * End-to-end on-device business card scanner.
 * Supports both single card images and multi-page cards (e.g. front & back).
 *
 * Automatically performs:
 *  1. Dual-recognizer OCR with smart script detection (Latin vs Devanagari routing)
 *  2. Script-agnostic regex field extraction (phones, emails, websites, GSTIN, pincodes)
 *  3. Bounding-box layout heuristics (company name, tagline, person & role, address)
 *  4. Barcode/QR scanning
 *  5. Merges into a unified `BusinessCard` object.
 *
 * 100% on-device, zero network calls, zero API keys.
 *
 * @param imageUri  `file://` or `content://` URI of the business card image, or an array of URIs (e.g. [front, back]).
 * @param options   Optional scanner options including OCR engine ('mlkit' or 'paddleocr').
 * @returns         Unified `BusinessCard` object.
 *
 * @example
 * ```ts
 * const card = await scanCard('file:///data/user/0/.../card.jpg');
 * const paddleCard = await scanCard('file:///card.jpg', { engine: 'paddleocr' });
 * const multiCard = await scanCard(['file:///card_front.jpg', 'file:///card_back.jpg']);
 * ```
 */
export async function scanCard(
  imageUri: string | string[],
  options?: ScanCardOptions
): Promise<BusinessCard> {
  if (options?.engine === 'paddleocr') {
    const uris = Array.isArray(imageUri) ? imageUri : [imageUri];
    return scanCardPagesPaddle(uris, options.paddleOptions);
  }
  if (Array.isArray(imageUri)) {
    return scanCardPages(imageUri, options);
  }
  const raw = await NativeCardLens.scanCard(imageUri);
  return raw as unknown as BusinessCard;
}

/**
 * Multi-page business card scanner (e.g. front & back).
 */
export async function scanCardPages(
  imageUris: string[],
  options?: ScanCardOptions
): Promise<BusinessCard> {
  if (!imageUris || imageUris.length === 0) {
    throw new Error('scanCardPages requires at least one image URI');
  }
  if (options?.engine === 'paddleocr') {
    return scanCardPagesPaddle(imageUris, options.paddleOptions);
  }
  if (imageUris.length === 1) {
    const single = await NativeCardLens.scanCard(imageUris[0]!);
    return single as unknown as BusinessCard;
  }
  const raw = await NativeCardLens.scanCardPages(imageUris);
  return raw as unknown as BusinessCard;
}

async function scanCardPagesPaddle(
  uris: string[],
  paddleOptions?: PaddleOcrOptions
): Promise<BusinessCard> {
  const pagesData = await Promise.all(
    uris.map(async (uri) => {
      const ocr = await recognizeTextWithPaddle(uri, paddleOptions);
      const [layout, contacts] = await Promise.all([
        extractCardLayout(ocr),
        extractContactFields(ocr.rawText),
      ]);
      const card: BusinessCard = {
        companyName: layout.companyName,
        tagline: layout.tagline,
        contactPersons: layout.contactPersons,
        phoneNumbers: contacts.phoneNumbers,
        emails: contacts.emails,
        websites: contacts.websites,
        addressLines: layout.addressLines,
        pincode: contacts.pincodes[0],
        gstin: contacts.gstin[0],
        rawText: ocr.rawText,
      };
      return card;
    })
  );

  if (pagesData.length === 1) {
    return pagesData[0]!;
  }

  return {
    companyName: pagesData.find((c) => Boolean(c.companyName?.trim()))
      ?.companyName,
    tagline: pagesData.find((c) => Boolean(c.tagline?.trim()))?.tagline,
    slogan: pagesData.find((c) => Boolean(c.slogan?.trim()))?.slogan,
    providedServices: Array.from(
      new Set(pagesData.flatMap((c) => c.providedServices || []))
    ),
    contactPersons: Array.from(
      new Map(
        pagesData
          .flatMap((c) => c.contactPersons || [])
          .map((p) => [p.name.trim().toLowerCase(), p])
      ).values()
    ),
    phoneNumbers: Array.from(
      new Set(pagesData.flatMap((c) => c.phoneNumbers || []))
    ),
    labeledPhones: Array.from(
      new Map(
        pagesData
          .flatMap((c) => c.labeledPhones || [])
          .map((lp) => [lp.number, lp])
      ).values()
    ),
    emails: Array.from(new Set(pagesData.flatMap((c) => c.emails || []))),
    websites: Array.from(new Set(pagesData.flatMap((c) => c.websites || []))),
    addressLines: Array.from(
      new Set(pagesData.flatMap((c) => c.addressLines || []))
    ),
    pincode: pagesData.find((c) => Boolean(c.pincode?.trim()))?.pincode,
    gstin: pagesData.find((c) => Boolean(c.gstin?.trim()))?.gstin,
    rawText: pagesData
      .map((c, i) => `--- Page ${i + 1} ---\n${c.rawText}`)
      .join('\n\n'),
  };
}

/**
 * End-to-end bill & invoice tabular data extractor.
 * Supports both single page bills and multi-page continuous invoices.
 *
 * Automatically performs:
 *  1. On-device OCR
 *  2. Bounding box Y-clustering into rows and X-clustering into columns
 *  3. Table header detection (Procedure, Description, Code, Billed, Paid, Total)
 *  4. LineItem[] table reconstruction
 *  5. Document-level metadata extraction (Invoice #, Date, Due Date, Subtotal, Amount Due)
 *
 * 100% on-device, zero network calls, zero API keys.
 *
 * @param imageUri  `file://` or `content://` URI of the bill or invoice image, or array of page URIs.
 * @param options   Optional scanner options including OCR engine ('mlkit' or 'paddleocr').
 * @returns         Structured `BillDocument` object.
 *
 * @example
 * ```ts
 * const bill = await scanBill('file:///data/user/0/.../invoice.jpg');
 * const multiBill = await scanBill(['file:///invoice_p1.jpg', 'file:///invoice_p2.jpg']);
 * ```
 */
export async function scanBill(
  imageUri: string | string[],
  options?: ScanBillOptions
): Promise<BillDocument> {
  if (Array.isArray(imageUri)) {
    return scanBillPages(imageUri, options);
  }
  const raw = await NativeCardLens.scanBill(imageUri);
  return raw as unknown as BillDocument;
}

/**
 * Multi-page bill & invoice tabular data extractor.
 */
export async function scanBillPages(
  imageUris: string[],
  _options?: ScanBillOptions
): Promise<BillDocument> {
  if (!imageUris || imageUris.length === 0) {
    throw new Error('scanBillPages requires at least one image URI');
  }
  if (imageUris.length === 1) {
    const single = await NativeCardLens.scanBill(imageUris[0]!);
    return single as unknown as BillDocument;
  }
  const raw = await NativeCardLens.scanBillPages(imageUris);
  return raw as unknown as BillDocument;
}

/**
 * Universal auto-routing document scanner (Phase 6).
 * Supports both single images and multi-page document sequences.
 *
 * Automatically detects whether the scanned document is a Business Card
 * or a Bill/Invoice using on-device rule heuristics, and routes to the
 * appropriate specialized extraction engine:
 *  - If invoice/bill keywords found -> runs `scanBill()` -> returns `{ type: 'bill', data: BillDocument }`
 *  - Otherwise -> runs `scanCard()` -> returns `{ type: 'card', data: BusinessCard }`
 *
 * @param imageUri  `file://` or `content://` URI of the image to scan, or array of page URIs.
 * @param options   Optional scanner options including OCR engine ('mlkit' or 'paddleocr').
 * @returns         `DocumentScanResult` containing the detected document type and structured data.
 *
 * @example
 * ```ts
 * const result = await scanDocument(scan.imageUri);
 * const paddleResult = await scanDocument(scan.imageUri, { engine: 'paddleocr' });
 * const multiResult = await scanDocument(scan.imageUris);
 * ```
 */
export async function scanDocument(
  imageUri: string | string[],
  options?: ScanDocumentOptions
): Promise<DocumentScanResult> {
  if (options?.engine === 'paddleocr') {
    const uris = Array.isArray(imageUri) ? imageUri : [imageUri];
    return scanDocumentPagesPaddle(uris, options.paddleOptions);
  }
  if (Array.isArray(imageUri)) {
    return scanDocumentPages(imageUri, options);
  }
  const raw = await NativeCardLens.scanDocument(imageUri);
  return raw as unknown as DocumentScanResult;
}

/**
 * Multi-page universal auto-routing document scanner.
 */
export async function scanDocumentPages(
  imageUris: string[],
  options?: ScanDocumentOptions
): Promise<DocumentScanResult> {
  if (!imageUris || imageUris.length === 0) {
    throw new Error('scanDocumentPages requires at least one image URI');
  }
  if (options?.engine === 'paddleocr') {
    return scanDocumentPagesPaddle(imageUris, options.paddleOptions);
  }
  if (imageUris.length === 1) {
    const single = await NativeCardLens.scanDocument(imageUris[0]!);
    return single as unknown as DocumentScanResult;
  }
  const raw = await NativeCardLens.scanDocumentPages(imageUris);
  return raw as unknown as DocumentScanResult;
}

async function scanDocumentPagesPaddle(
  uris: string[],
  paddleOptions?: PaddleOcrOptions
): Promise<DocumentScanResult> {
  const ocrResults = await Promise.all(
    uris.map((u) => recognizeTextWithPaddle(u, paddleOptions))
  );
  const combinedText = ocrResults.map((r) => r.rawText).join('\n');
  const isBill =
    /invoice|bill\s*(?:#|no|number)|tax\s*invoice|subtotal|amount\s*due|due\s*date|line\s*items/i.test(
      combinedText
    );

  if (isBill) {
    const bill = await scanBill(uris);
    return { type: 'bill', data: bill };
  } else {
    const card = await scanCardPagesPaddle(uris, paddleOptions);
    return { type: 'card', data: card };
  }
}

// ─── Local Neural LLM Engine (Free On-Device AI) ─────────────────────────────
export {
  AVAILABLE_LOCAL_MODELS,
  BUSINESS_CARD_GBNF_GRAMMAR,
  buildCardExtractionPrompt,
  enhanceWithLocalLLM,
  runLocalSemanticExtraction,
  checkLocalModelStatus,
  downloadLocalModel,
  deleteLocalModel,
  fetchRemoteModelSize,
  onModelDownloadProgress,
  getModelDownloadProgress,
  normalizeDevanagariNumbers,
  normalizeIndicDigits,
  INDIC_DIGIT_MAP,
  devanagariSkeleton,
  levenshteinDistance,
  skeletonSimilarity,
  MARATHI_OCR_ALIASES,
  isLikelyLogoArtifact,
  extractDeterministicMarathi,
  extractDeterministicUniversal,
  extractHybridMarathiCard,
  extractHybridUniversalCard,
  calculateExtractionConfidence,
  parseFallbackLocalBill,
  enhanceBillWithLocalLLM,
} from './LocalCardLLM';
export type {
  LocalLLMOptions,
  LocalModelDescriptor,
  ModelDownloadProgress,
  ModelStatus,
  RemoteModelSizeInfo,
  DeterministicExtractionResult,
} from './LocalCardLLM';

// ─── CardFlowAI Backend Drop-in Compatibility & Polling Pipeline ───────────
export {
  toCardFlowApiResponse,
  extractCardFlow,
  startCardFlowScanner,
  startAsyncExtraction,
  getJobStatus,
  onExtractionJobProgress,
  pollJobUntilComplete,
  cancelExtractionJob,
  checkExtractionQuota,
  extractCardFlowWithThinking,
} from './cardFlowAdapter';
export type {
  CardFlowApiResponse,
  CardFlowExtractionData,
  CardFlowResult,
  CardFlowCardData,
  CardFlowContact,
  CardFlowContactPhone,
  CardFlowConfidence,
  CardFlowAuditNode,
  CardFlowExtractionMeta,
  CardFlowExtractPayload,
  CardFlowAdapterOptions,
  ExtractCardFlowOptions,
  CardFlowNode,
  CardFlowJobProcessingData,
  CardFlowQuotaData,
} from './cardFlowAdapter';
