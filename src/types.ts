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

export interface PaddleOcrOptions {
  /** Confidence threshold for text box detection (0.0 - 1.0). Default: 0.3 */
  boxThresh?: number;
  /** DBNet polygon expansion factor (unclip ratio). Default: 1.6 */
  unclipRatio?: number;
  /** Max image side length for detection resize. Default: 960 */
  maxSideLen?: number;
}

export interface PaddleOcrModelConfig {
  detModelUrl?: string;
  recModelUrl?: string;
  keysUrl?: string;
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
}

export interface CardLayoutFields {
  companyName?: string;
  tagline?: string;
  contactPersons: ContactPerson[];
  addressLines: string[];
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
  contactPersons: { name: string; role?: string }[];
  phoneNumbers: string[];
  labeledPhones?: LabeledPhone[];
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
