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
}

export default TurboModuleRegistry.getEnforcing<Spec>('CardLens');
