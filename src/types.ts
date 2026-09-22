// ─── Geometry ────────────────────────────────────────────────────────────────

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ─── OCR (Text Recognition) ──────────────────────────────────────────────────

/**
 * Finest granularity: a single word/symbol cluster recognised by ML Kit.
 */
export interface TextElement {
  text: string;
  boundingBox: BoundingBox;
}

/**
 * A single line of text within a block.
 */
export interface TextLine {
  text: string;
  boundingBox: BoundingBox;
  elements: TextElement[];
}

/**
 * A paragraph-like region of text. ML Kit groups nearby lines into blocks.
 * Bounding boxes are essential for Phase 3 layout heuristics — do NOT flatten.
 */
export interface TextBlock {
  text: string;
  boundingBox: BoundingBox;
  lines: TextLine[];
}

/**
 * Full result returned by recognizeText().
 *
 * - `blocks`   — structured hierarchy (Block → Line → Element) with bounding boxes
 * - `rawText`  — convenience full-text concat; useful as a fallback but loses layout
 */
export interface RawOcrResult {
  blocks: TextBlock[];
  rawText: string;
}

// ─── Barcode / QR ────────────────────────────────────────────────────────────

export type BarcodeFormat =
  | 'QR_CODE'
  | 'DATA_MATRIX'
  | 'PDF417'
  | 'AZTEC'
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_39'
  | 'CODE_93'
  | 'CODE_128'
  | 'CODABAR'
  | 'ITF'
  | 'UNKNOWN';

export interface BarcodeResult {
  rawValue: string;
  format: BarcodeFormat;
  boundingBox: BoundingBox;
}

// ─── Script & Engine selectors ───────────────────────────────────────────────

export type OcrScript = 'latin' | 'devanagari' | 'auto';

export type OcrEngine = 'mlkit' | 'paddleocr' | 'auto';

export type SupportedOcrLanguage =
  // Devanagari script (Marathi, Hindi, Nepali, Sanskrit, Konkani, Bhojpuri)
  | 'mr'
  | 'hi'
  | 'ne'
  | 'sa'
  | 'kok'
  | 'bho'
  // Latin script (English, Spanish, French, German, Italian, Portuguese, Vietnamese, etc.)
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'nl'
  | 'id'
  | 'ms'
  | 'tr'
  | 'vi'
  | 'pl'
  | 'sv'
  // Chinese / Japanese / East Asian
  | 'zh'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  // Korean
  | 'ko'
  // Arabic script (Arabic, Urdu, Persian)
  | 'ar'
  | 'fa'
  | 'ur'
  // Cyrillic script (Russian, Ukrainian, Belarusian, Bulgarian, Serbian)
  | 'ru'
  | 'uk'
  | 'be'
  | 'bg'
  | 'sr'
  // Indic regional scripts
  | 'ta' // Tamil
  | 'te' // Telugu
  | 'kn' // Kannada
  | 'ml' // Malayalam
  | 'bn' // Bengali / Assamese
  | 'gu' // Gujarati
  | 'pa' // Punjabi
  // Thai
  | 'th'
  // Greek
  | 'el';

export type OcrScriptFamily =
  | 'devanagari'
  | 'latin'
  | 'ch'
  | 'arabic'
  | 'cyrillic'
  | 'korean'
  | 'tamil'
  | 'telugu'
  | 'thai'
  | 'greek';

export interface ScriptModelEndpoints {
  recModelUrl: string;
  keysUrl: string;
}

/** Universal shared DBNet detection model (language-agnostic) */
export const DEFAULT_PADDLE_DET_URL =
  'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx';

/**
 * Public high-speed ONNX model mirrors and dictionary files per script family.
 */
export const SCRIPT_MODEL_REGISTRY: Record<
  OcrScriptFamily,
  ScriptModelEndpoints
> = {
  devanagari: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/hindi/dict.txt',
  },
  latin: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/dict.txt',
  },
  ch: {
    recModelUrl:
      'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx',
    keysUrl:
      'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.8/ppocr/utils/ppocr_keys_v1.txt',
  },
  arabic: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/arabic/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/arabic/dict.txt',
  },
  cyrillic: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/eslav/dict.txt',
  },
  korean: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt',
  },
  tamil: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/tamil/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/tamil/dict.txt',
  },
  telugu: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/telugu/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/telugu/dict.txt',
  },
  thai: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/dict.txt',
  },
  greek: {
    recModelUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/greek/rec.onnx',
    keysUrl:
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/greek/dict.txt',
  },
};

/**
 * Maps ISO language codes and alias names to their corresponding PaddleOCR script family.
 */
export const LANGUAGE_TO_SCRIPT: Record<string, OcrScriptFamily> = {
  // Marathi / Hindi / Devanagari
  'mr': 'devanagari',
  'marathi': 'devanagari',
  'hi': 'devanagari',
  'hindi': 'devanagari',
  'ne': 'devanagari',
  'nepali': 'devanagari',
  'sa': 'devanagari',
  'sanskrit': 'devanagari',
  'kok': 'devanagari',
  'konkani': 'devanagari',
  'bho': 'devanagari',
  'bhojpuri': 'devanagari',
  'devanagari': 'devanagari',

  // Latin
  'en': 'latin',
  'english': 'latin',
  'es': 'latin',
  'spanish': 'latin',
  'fr': 'latin',
  'french': 'latin',
  'de': 'latin',
  'german': 'latin',
  'it': 'latin',
  'italian': 'latin',
  'pt': 'latin',
  'portuguese': 'latin',
  'nl': 'latin',
  'dutch': 'latin',
  'id': 'latin',
  'indonesian': 'latin',
  'ms': 'latin',
  'malay': 'latin',
  'tr': 'latin',
  'turkish': 'latin',
  'vi': 'latin',
  'vietnamese': 'latin',
  'pl': 'latin',
  'polish': 'latin',
  'sv': 'latin',
  'swedish': 'latin',
  'latin': 'latin',

  // Chinese & Japanese
  'zh': 'ch',
  'zh-Hans': 'ch',
  'zh-Hant': 'ch',
  'cn': 'ch',
  'chinese': 'ch',
  'ja': 'ch',
  'japanese': 'ch',
  'japan': 'ch',
  'ch': 'ch',

  // Korean
  'ko': 'korean',
  'korean': 'korean',

  // Arabic
  'ar': 'arabic',
  'arabic': 'arabic',
  'fa': 'arabic',
  'persian': 'arabic',
  'ur': 'arabic',
  'urdu': 'arabic',

  // Cyrillic / Slavic
  'ru': 'cyrillic',
  'russian': 'cyrillic',
  'uk': 'cyrillic',
  'ukrainian': 'cyrillic',
  'be': 'cyrillic',
  'belarusian': 'cyrillic',
  'bg': 'cyrillic',
  'bulgarian': 'cyrillic',
  'sr': 'cyrillic',
  'serbian': 'cyrillic',
  'cyrillic': 'cyrillic',
  'eslav': 'cyrillic',

  // Indic scripts
  'ta': 'tamil',
  'tamil': 'tamil',
  'te': 'telugu',
  'telugu': 'telugu',

  // Thai
  'th': 'thai',
  'thai': 'thai',

  // Greek
  'el': 'greek',
  'greek': 'greek',
};

/**
 * Resolves a given language code or script family name into a valid OcrScriptFamily.
 * Defaults to 'devanagari' if unrecognized or empty.
 */
export function resolveOcrScriptFamily(
  languageOrScript?: string
): OcrScriptFamily {
  if (!languageOrScript) return 'devanagari';
  const clean = languageOrScript.trim().toLowerCase();
  return LANGUAGE_TO_SCRIPT[clean] ?? 'devanagari';
}

export interface PaddleOcrOptions {
  /** Target language code ('mr', 'hi', 'en', 'fr', 'ar', etc.) or script ('devanagari', 'latin'). Default: 'devanagari' */
  language?: SupportedOcrLanguage | string;
  /** Explicit script family name if known. */
  script?: OcrScriptFamily | string;
  /** Confidence threshold for text box detection (0.0 - 1.0). Default: 0.3 */
  boxThresh?: number;
  /** DBNet polygon expansion factor (unclip ratio). Default: 1.6 (boosted to 1.85 for Devanagari to preserve matras). */
  unclipRatio?: number;
  /** Max image side length for detection resize. Default: 1280 */
  maxSideLen?: number;
}

export interface PaddleOcrModelConfig {
  /** Target language to download ('mr', 'hi', 'en', 'fr', 'ar', etc.). */
  language?: SupportedOcrLanguage | string;
  /** Explicit script family ('devanagari', 'latin', 'arabic', etc.). */
  script?: OcrScriptFamily | string;
  /** Custom detection ONNX model URL (optional override) */
  detModelUrl?: string;
  /** Custom recognition ONNX model URL (optional override) */
  recModelUrl?: string;
  /** Custom character dictionary URL (optional override) */
  keysUrl?: string;
  /** Optional Bearer token for private HuggingFace mirrors */
  authToken?: string;
}

export interface PaddleOcrDownloadProgress {
  file: 'det' | 'rec' | 'keys';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface RecognizeTextOptions {
  /** OCR engine to use ('mlkit' | 'paddleocr' | 'auto'). Default: 'mlkit' */
  engine?: OcrEngine;
  /** Which OCR script to use for ML Kit ('latin' | 'devanagari' | 'auto'). Default: 'auto' */
  script?: OcrScript;
  /** Options specific to PaddleOCR engine */
  paddleOptions?: PaddleOcrOptions;
}

// ─── Document Scanner (Live Camera UI) ───────────────────────────────────────

export type ScannerMode = 'FULL' | 'BASE' | 'BASE_WITH_FILTER';

export interface DocumentScannerOptions {
  /** Maximum number of pages to scan. Default: 1 */
  pageLimit?: number;
  /**
   * FULL: includes automated edge detection, auto-capture, cropping, and image cleanup filters.
   * BASE: basic capture without cleanup filters.
   * BASE_WITH_FILTER: basic capture plus cleanup filters.
   * Default: 'FULL'
   */
  scannerMode?: ScannerMode;
  /** Whether user can pick an image from gallery within the scanner UI. Default: true */
  allowGalleryImport?: boolean;
  /** Whether to automatically run OCR on the scanned image immediately. Default: true */
  autoOcr?: boolean;
  /** Which OCR script to use if autoOcr is enabled ('latin' | 'devanagari' | 'auto'). Default: 'auto' */
  script?: OcrScript;
  /** Which OCR engine to use for text recognition ('mlkit' | 'paddleocr' | 'auto'). Default: 'mlkit' */
  ocrEngine?: OcrEngine;
  /** Options specific to PaddleOCR if chosen */
  paddleOptions?: PaddleOcrOptions;
}

export interface PickDocumentOptions {
  /** Whether to allow selecting PDF files in addition to images. Default: true */
  allowPdf?: boolean;
  /** Whether to automatically run OCR on the first page immediately. Default: false */
  autoOcr?: boolean;
  /** Which OCR script to use if autoOcr is enabled ('latin' | 'devanagari' | 'auto'). Default: 'auto' */
  script?: OcrScript;
}

export interface ScanResult {
  /** The primary scanned & cropped image URI (file://). */
  imageUri: string;
  /** All scanned image URIs if pageLimit > 1. */
  imageUris: string[];
  /** PDF URI if generated. */
  pdfUri?: string;
  /** Automatically extracted OCR result if autoOcr was enabled (default). */
  ocrResult?: RawOcrResult;
}
// ─── Contact Fields (Phase 2 Regex Extractors) ───────────────────────────────

export interface ContactFields {
  phoneNumbers: string[];
  emails: string[];
  websites: string[];
  gstin: string[];
  pincodes: string[];
}

// ─── Card Layout Fields (Phase 3 Layout Heuristics) ──────────────────────────

export interface ContactPerson {
  name: string;
  role?: string;
  phones?: string[];
  email?: string;
  isPrimary?: boolean;
}

export interface StructuredAddress {
  type?:
    | 'head_office'
    | 'branch'
    | 'factory'
    | 'residence'
    | 'chamber'
    | 'general'
    | string;
  label?: string;
  fullAddress: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  dedicatedPhone?: string;
}

export interface CardLayoutFields {
  companyName?: string;
  tagline?: string;
  contactPersons: ContactPerson[];
  addressLines: string[];
  addresses?: StructuredAddress[];
}

export interface LabeledPhone {
  number: string;
  label?: string;
}

// ─── Business Card (Phase 4 Unified Card Object) ────────────────────────────

export interface BusinessCard {
  companyName?: string;
  tagline?: string;
  slogan?: string;
  providedServices?: string[];
  contactPersons: ContactPerson[];
  phoneNumbers: string[];
  labeledPhones?: LabeledPhone[];
  addresses?: StructuredAddress[];
  /**
   * All extracted email addresses (primary is emails[0]).
   * Cards can have multiple emails (e.g. personal + work).
   */
  emails: string[];
  /**
   * Backwards-compat alias for emails[0].
   * @deprecated Use `emails[0]` instead.
   */
  email?: string;
  /**
   * All extracted website URLs (primary is websites[0]).
   * Cards can have multiple websites.
   */
  websites: string[];
  /**
   * Backwards-compat alias for websites[0].
   * @deprecated Use `websites[0]` instead.
   */
  website?: string;
  addressLines: string[];
  pincode?: string;
  gstin?: string;
  qrCodeData?: string;
  rawText: string;
  /**
   * Overall extraction confidence score (0.0 to 1.0, e.g. 0.85 = 85%).
   */
  confidence?: number;
  /**
   * True if heuristic confidence is < 0.75 or key fields are ambiguous,
   * indicating that on-device SLM deep reasoning is recommended.
   */
  requiresSlmReasoning?: boolean;
}

export interface ConfidenceAssessment {
  confidence: number;
  requiresSlmReasoning: boolean;
  reasons: string[];
}

// ─── Bill & Invoice Documents (Phase 5) ──────────────────────────────────────

export interface LineItem {
  description: string;
  code?: string;
  billedAmount?: number;
  insurancePaid?: number;
  patientResponsibility?: number;
}

export interface BillDocument {
  documentType?: string;
  issuerName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  lineItems: LineItem[];
  subtotal?: number;
  amountDue?: number;
  rawText: string;
}

// ─── Document Auto-Routing (Phase 6) ─────────────────────────────────────────

export type DocumentType = 'card' | 'bill';

export interface DocumentScanResult {
  type: DocumentType;
  data: BusinessCard | BillDocument;
}

// ─── Scanner Engine Options ──────────────────────────────────────────────────

export interface ScanCardOptions {
  /**
   * OCR engine to use for text extraction.
   * - 'mlkit' (default): Google ML Kit concurrent dual-pass (Latin + Devanagari).
   * - 'paddleocr': High-efficiency on-device PaddleOCR (DBNet + CTC sequence recognition).
   */
  engine?: 'mlkit' | 'paddleocr';
  /**
   * Optional inference parameters when engine is 'paddleocr'.
   */
  paddleOptions?: PaddleOcrOptions;
}

export interface ScanDocumentOptions {
  /**
   * OCR engine to use for text extraction.
   * - 'mlkit' (default): Google ML Kit concurrent dual-pass (Latin + Devanagari).
   * - 'paddleocr': High-efficiency on-device PaddleOCR (DBNet + CTC sequence recognition).
   */
  engine?: 'mlkit' | 'paddleocr';
  /**
   * Optional inference parameters when engine is 'paddleocr'.
   */
  paddleOptions?: PaddleOcrOptions;
}

export interface ScanBillOptions {
  /**
   * OCR engine to use for text extraction.
   * - 'mlkit' (default): Google ML Kit concurrent dual-pass (Latin + Devanagari).
   * - 'paddleocr': High-efficiency on-device PaddleOCR (DBNet + CTC sequence recognition).
   */
  engine?: 'mlkit' | 'paddleocr';
  /**
   * Optional inference parameters when engine is 'paddleocr'.
   */
  paddleOptions?: PaddleOcrOptions;
}

// ─── Simple ML Kit to LLM Flow Options & Results ───────────────────────────

export interface ExtractCardMlKitToLLMOptions {
  /**
   * Script to use for Google ML Kit OCR ('auto', 'latin', 'devanagari'). Defaults to 'auto'.
   */
  script?: OcrScript;
  /**
   * Custom LLM inference handler (e.g. llama.rn completion or local Ollama).
   * If not provided, CardLens uses its built-in on-device Semantic Thinking Reasoner.
   */
  inferenceHandler?: (prompt: string, grammar?: string) => Promise<string>;
}

export interface MlKitToLLMResult {
  /**
   * Total raw OCR data extracted directly from the image by Google ML Kit.
   */
  rawOcr: RawOcrResult;
  /**
   * Exact raw output string returned by the efficient LLM / Thinking module.
   */
  rawLlmOutput: string;
  /**
   * Refined and structured BusinessCard object.
   */
  card: BusinessCard;
  /**
   * Latency breakdown in milliseconds.
   */
  latencyMs?: {
    ocr: number;
    llm: number;
    total: number;
  };
}
