/**
 * Public JS API surface for react-native-card-lens.
 *
 * Wraps the raw Codegen bridge with proper TypeScript types so callers
 * always work with `RawOcrResult` / `BarcodeResult` — not `UnsafeObject`.
 */
import NativeCardLens from './NativeCardLens';
import type {
  RawOcrResult,
  BarcodeResult,
  OcrScript,
  DocumentScannerOptions,
  ScanResult,
  ContactFields,
  CardLayoutFields,
  BusinessCard,
  BillDocument,
  DocumentScanResult,
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
  ScanResult,
  ContactFields,
  ContactPerson,
  CardLayoutFields,
  BusinessCard,
  LineItem,
  BillDocument,
  DocumentType,
  DocumentScanResult,
} from './types';

// ─── typed bridge wrappers ────────────────────────────────────────────────────

/**
 * Run on-device ML Kit OCR on an image and return the full TextBlock hierarchy
 * including bounding boxes.  No text is sent to any network endpoint.
 *
 * @param imageUri  `file://` or `content://` URI of the image to process.
 * @param script    Which script recognizer to use. Defaults to `'latin'`.
 *
 * @example
 * ```ts
 * const result = await recognizeText('file:///data/.../card.jpg', 'latin');
 * console.log(result.blocks[0].text);      // first paragraph
 * console.log(result.blocks[0].boundingBox); // { left, top, right, bottom }
 * ```
 */
export async function recognizeText(
  imageUri: string,
  script: OcrScript = 'latin'
): Promise<RawOcrResult> {
  const raw = await NativeCardLens.recognizeText(imageUri, script);
  // The native layer already serialises into the correct shape; we just cast.
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
    script: options.script ?? 'latin',
  };
  const raw = await NativeCardLens.startScanner(config);
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
 * @param imageUri  `file://` or `content://` URI of the business card image.
 * @returns         Unified `BusinessCard` object.
 *
 * @example
 * ```ts
 * const card = await scanCard('file:///data/user/0/.../card.jpg');
 * console.log('Company:', card.companyName);
 * console.log('Phones:', card.phoneNumbers);
 * console.log('Email:', card.email);
 * console.log('Persons:', card.contactPersons);
 * ```
 */
export async function scanCard(imageUri: string): Promise<BusinessCard> {
  const raw = await NativeCardLens.scanCard(imageUri);
  return raw as unknown as BusinessCard;
}

/**
 * End-to-end bill & invoice tabular data extractor.
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
 * @param imageUri  `file://` or `content://` URI of the bill or invoice image.
 * @returns         Structured `BillDocument` object.
 *
 * @example
 * ```ts
 * const bill = await scanBill('file:///data/user/0/.../invoice.jpg');
 * console.log('Issuer:', bill.issuerName);
 * console.log('Invoice #:', bill.invoiceNumber);
 * console.log('Total Due:', bill.amountDue);
 * console.log('Items:', bill.lineItems);
 * ```
 */
export async function scanBill(imageUri: string): Promise<BillDocument> {
  const raw = await NativeCardLens.scanBill(imageUri);
  return raw as unknown as BillDocument;
}

/**
 * Universal auto-routing document scanner (Phase 6).
 *
 * Automatically detects whether the scanned document is a Business Card
 * or a Bill/Invoice using on-device rule heuristics, and routes to the
 * appropriate specialized extraction engine:
 *  - If invoice/bill keywords found -> runs `scanBill()` -> returns `{ type: 'bill', data: BillDocument }`
 *  - Otherwise -> runs `scanCard()` -> returns `{ type: 'card', data: BusinessCard }`
 *
 * @param imageUri  `file://` or `content://` URI of the image to scan.
 * @returns         `DocumentScanResult` containing the detected document type and structured data.
 *
 * @example
 * ```ts
 * const result = await scanDocument(scan.imageUri);
 * if (result.type === 'bill') {
 *   console.log('Bill line items:', result.data.lineItems);
 * } else {
 *   console.log('Card contact persons:', result.data.contactPersons);
 * }
 * ```
 */
export async function scanDocument(
  imageUri: string
): Promise<DocumentScanResult> {
  const raw = await NativeCardLens.scanDocument(imageUri);
  return raw as unknown as DocumentScanResult;
}
