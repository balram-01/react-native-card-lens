/**
 * Codegen / TurboModule spec for react-native-card-lens.
 *
 * Codegen type conventions:
 *  - Use `Object` (or `UnsafeObject`) for arbitrary dictionaries / maps.
 *  - Method return types for maps should be `Promise<Object>`.
 *  - Method array return types should be `Promise<Object[]>`.
 */
import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Run ML Kit text recognition on the given image URI.
   *
   * @param imageUri  A `file://` or `content://` URI pointing to the image.
   * @param script    `'latin'` or `'devanagari'` — selects the recognizer.
   * @returns         A `RawOcrResult` map serialised as a plain JS object.
   */
  recognizeText(imageUri: string, script: string): Promise<Object>;

  /**
   * Run ML Kit barcode scanning on the given image URI.
   *
   * @param imageUri  A `file://` or `content://` URI pointing to the image.
   * @returns         Array of BarcodeResult objects.
   */
  scanBarcodes(imageUri: string): Promise<Object[]>;

  /**
   * Directly launch the Google ML Kit Document Scanner camera UI.
   *
   * @param options  Configuration options map.
   * @returns        A ScanResult map.
   */
  startScanner(options: Object): Promise<Object>;

  /**
   * Extract structured contact fields (phones, emails, websites, GSTIN, pincodes)
   * from any text string using pure on-device regex heuristics.
   *
   * @param text  The OCR or document text string to extract from.
   * @returns     A ContactFields map.
   */
  extractContactFields(text: string): Promise<Object>;

  /**
   * Extract card layout fields (companyName, tagline, contactPersons, addressLines)
   * using TextBlock & TextLine bounding box geometry.
   *
   * @param rawOcrResult  The RawOcrResult map containing blocks with bounding boxes.
   * @returns             A CardLayoutFields map.
   */
  extractCardLayout(rawOcrResult: Object): Promise<Object>;

  /**
   * End-to-end business card scanner: runs OCR (with script routing) ->
   * regex extractors -> layout heuristics -> barcode scan -> merges into BusinessCard.
   *
   * @param imageUri  `file://` or `content://` URI of the business card image.
   * @returns         A BusinessCard map.
   */
  scanCard(imageUri: string): Promise<Object>;

  /**
   * End-to-end bill & invoice scanner: runs OCR -> bounding box row/column
   * table reconstruction -> line item parser -> document metadata -> BillDocument.
   *
   * @param imageUri  `file://` or `content://` URI of the bill/invoice image.
   * @returns         A BillDocument map.
   */
  scanBill(imageUri: string): Promise<Object>;

  /**
   * Top-level auto-routing document scanner: runs OCR -> rule-based document
   * classification -> routes to scanBill() or scanCard() automatically.
   *
   * @param imageUri  `file://` or `content://` URI of the image to scan.
   * @returns         A map `{ type: 'card' | 'bill', data: BusinessCard | BillDocument }`.
   */
  scanDocument(imageUri: string): Promise<Object>;

  /**
   * Multi-page business card scanner (e.g. front & back).
   * Aggregates contact details, QR code, and layout from all pages.
   */
  scanCardPages(imageUris: string[]): Promise<Object>;

  /**
   * Multi-page bill & invoice scanner.
   * Aggregates continuous tabular line items across all pages.
   */
  scanBillPages(imageUris: string[]): Promise<Object>;

  /**
   * Multi-page universal auto-routing document scanner.
   */
  scanDocumentPages(imageUris: string[]): Promise<Object>;

  /**
   * Load an on-device model file (.task or .bin format) for the MediaPipe Thinking Module.
   *
   * @param modelPath Absolute file path on the device filesystem.
   * @returns Promise<boolean> indicating whether the model loaded successfully.
   */
  loadThinkingModel(modelPath: string): Promise<boolean>;

  /**
   * Checks if the on-device Thinking Module is initialized and ready for inference.
   */
  isThinkingModelReady(): Promise<boolean>;

  /**
   * Refine and extract high-precision structured business card fields from raw text
   * using the on-device Thinking Module (MediaPipe Tasks GenAI).
   *
   * @param rawText OCR text to extract structured card data from.
   * @returns A BusinessCard map.
   */
  refineCardWithThinkingModule(rawText: string): Promise<Object>;

  /**
   * Unload the on-device Thinking Module model and free native memory.
   */
  unloadThinkingModel(): Promise<void>;

  /**
   * Downloads a MediaPipe model file (.task or .bin) to local internal storage.
   * Emits live progress events via DeviceEventEmitter ('onThinkingModelDownloadProgress').
   *
   * @param url       Public HTTPS URL of the model file.
   * @param fileName  Filename to store as in internal storage.
   * @param authToken Optional Bearer token for HuggingFace gated model downloads.
   * @returns         Absolute local file path on the device.
   */
  downloadThinkingModel(
    url: string,
    fileName: string,
    authToken?: string
  ): Promise<string>;
}

const CardLensModule =
  TurboModuleRegistry.get<Spec>('CardLens') ??
  ((global as any).__turboModuleProxy != null
    ? TurboModuleRegistry.getEnforcing<Spec>('CardLens')
    : ({
        recognizeText: () => Promise.resolve({ blocks: [], rawText: '' }),
        scanBarcodes: () => Promise.resolve([]),
        startScanner: () => Promise.resolve({ imageUri: '', imageUris: [] }),
        extractContactFields: () =>
          Promise.resolve({
            phoneNumbers: [],
            emails: [],
            websites: [],
            gstin: [],
            pincodes: [],
          }),
        extractCardLayout: () =>
          Promise.resolve({
            contactPersons: [],
            addressLines: [],
          }),
        scanCard: () =>
          Promise.resolve({
            contactPersons: [],
            phoneNumbers: [],
            emails: [],
            websites: [],
            addressLines: [],
            rawText: '',
          }),
        scanCardPages: () => Promise.resolve({}),
        scanBill: () => Promise.resolve({ lineItems: [], rawText: '' }),
        scanBillPages: () => Promise.resolve({}),
        scanDocument: () => Promise.resolve({ type: 'card', data: {} }),
        scanDocumentPages: () => Promise.resolve({}),
        isThinkingModelReady: () => Promise.resolve(false),
        refineCardWithThinkingModule: () => Promise.resolve({}),
        downloadThinkingModel: () => Promise.resolve(''),
      } as unknown as Spec));

export default CardLensModule as Spec;
