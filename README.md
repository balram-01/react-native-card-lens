# react-native-card-lens 🔍📇

> **100% On-Device, Zero-Cost Document & Business Card Field Extraction for React Native.**  
> Powered by Google ML Kit — Zero Network Calls, Zero LLM APIs, Zero Paid Services, No API Keys Required.

---

## Highlights

- 📷 **Live Document Scanner UI (1-Tap Capture)**: Real-time document/card outline detection, auto-capture, auto-crop, perspective correction, shadow removal, and contrast enhancement (via Google Play Services).
- 📇 **Business Card Engine (`scanCard`)**: Extracts company name, tagline, contact persons, job roles, phones, emails, websites, physical addresses, Indian PIN codes, GSTIN, and QR codes into a structured `BusinessCard` object.
- 🧾 **Bill & Invoice Engine (`scanBill`)**: Reconstructs tabular line items (`LineItem[]`) using bounding-box row/column clustering, identifies header columns (Description, Code, Billed Amount, Insurance Paid, Patient Responsibility), and parses invoice numbers, dates, due dates, subtotal, and total amount due.
- 🤖 **Lightweight Auto-Router (`scanDocument`)**: Heuristically classifies whether an image is a business card or a bill/invoice, routing automatically to the specialized parser.
- 🇮🇳 **Multilingual & Devanagari Support**: Dual-recognizer routing (Latin & Devanagari) with automatic script detection for Hindi, Marathi, Sanskrit, Konkani, and Nepali text.
- 🔒 **100% On-Device & Private**: Zero data leaves the device. Complete GDPR and HIPAA compliance by design.

---

## Installation

```sh
npm install react-native-card-lens
# or
yarn add react-native-card-lens
```

### Android Configuration

This library uses the **New Architecture (TurboModules)** by default.

#### ML Kit Model Strategy (Unbundled vs Bundled)

By default, `react-native-card-lens` uses **unbundled Google Play Services ML Kit models** (~0 MB APK footprint). The models download dynamically once via Google Play Services on first launch:

```groovy
// android/build.gradle (default unbundled)
implementation "com.google.mlkit:text-recognition:16.0.1"
implementation "com.google.mlkit:text-recognition-devanagari:16.0.1"
implementation "com.google.mlkit:barcode-scanning:17.3.0"
implementation "com.google.android.gms:play-services-mlkit-document-scanner:16.0.0-beta1"
```

If you require offline deployment on devices without Google Play Services (e.g. AOSP / China builds), switch to bundled models in `android/build.gradle`:
- `com.google.mlkit:text-recognition-bundled-latin:16.0.1` (+3 MB APK size)
- `com.google.mlkit:text-recognition-bundled-devanagari:16.0.1` (+13 MB APK size)

---

## Permissions

| Method | Permissions Required |
|---|---|
| `startScanner()` | **None!** The camera viewfinder runs out-of-process inside Google Play Services. No camera or storage permissions need to be requested in your app's `AndroidManifest.xml`. |
| `scanCard()`, `scanBill()`, `scanDocument()` (with local gallery/file URIs) | `READ_MEDIA_IMAGES` (Android 13+) or `READ_EXTERNAL_STORAGE` (Android 12 and below) if accessing shared storage files. |

---

## Quick Start

### 1. Direct Live Document Scanner + Auto-Route

Launch Google's document scanner camera flow, capture a cropped image, and extract structured data automatically:

```ts
import { startScanner, scanDocument } from 'react-native-card-lens';

const scan = await startScanner({
  pageLimit: 1,
  scannerMode: 'FULL',
  allowGalleryImport: true,
});

// Auto-detects whether the document is a bill/invoice or a business card:
const result = await scanDocument(scan.imageUri);

if (result.type === 'bill') {
  console.log('Invoice #:', result.data.invoiceNumber);
  console.log('Total Due:', result.data.amountDue);
  console.log('Line Items:', result.data.lineItems);
} else {
  console.log('Company:', result.data.companyName);
  console.log('Phones:', result.data.phoneNumbers);
  console.log('Contact Persons:', result.data.contactPersons);
}
```

---

## API Reference

### `startScanner(options?: DocumentScannerOptions): Promise<ScanResult>`
Directly launches the Google ML Kit Document Scanner viewfinder with edge detection, auto-capture, and auto-cropping.

**Options:**
- `pageLimit?: number` (default: `1`)
- `scannerMode?: 'FULL' | 'BASE' | 'BASE_WITH_FILTER'` (default: `'FULL'`)
- `allowGalleryImport?: boolean` (default: `true`)
- `autoOcr?: boolean` (default: `true`)
- `script?: 'latin' | 'devanagari'` (default: `'latin'`)

---

### `scanDocument(imageUri: string): Promise<DocumentScanResult>`
Top-level auto-router. Runs on-device OCR, classifies whether the document is a bill/invoice or a business card, and returns structured data.

```ts
interface DocumentScanResult {
  type: 'card' | 'bill';
  data: BusinessCard | BillDocument;
}
```

---

### `scanCard(imageUri: string): Promise<BusinessCard>`
End-to-end business card pipeline:
1. Runs dual-recognizer OCR with smart Devanagari detection
2. Runs regex extractors (phones, emails, websites, GSTIN, pincodes)
3. Runs layout heuristics (company name, tagline, person & role, address)
4. Scans for QR codes concurrently
5. Returns a unified `BusinessCard`:

```ts
interface BusinessCard {
  companyName?: string;
  tagline?: string;
  contactPersons: { name: string; role?: string }[];
  phoneNumbers: string[];
  email?: string;
  website?: string;
  addressLines: string[];
  pincode?: string;
  gstin?: string;
  qrCodeData?: string;
  rawText: string;
}
```

---

### `scanBill(imageUri: string): Promise<BillDocument>`
End-to-end bill/invoice table reconstructor:
1. Clusters text bounding boxes horizontally by Y-coordinate into table rows
2. Clusters header blocks vertically by X-coordinate into columns
3. Aligns cells into `LineItem[]`
4. Extracts invoice number, invoice date, due date, subtotal, and total amount due

```ts
interface LineItem {
  description: string;
  code?: string;
  billedAmount?: number;
  insurancePaid?: number;
  patientResponsibility?: number;
}

interface BillDocument {
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
```

---

### Low-Level Modular APIs

- `recognizeText(imageUri: string, script?: 'latin' | 'devanagari'): Promise<RawOcrResult>`
- `scanBarcodes(imageUri: string): Promise<BarcodeResult[]>`
- `extractContactFields(text: string): Promise<ContactFields>`
- `extractCardLayout(rawOcrResult: RawOcrResult): Promise<CardLayoutFields>`

---

## Accuracy Limitations & Best Practices

> [!IMPORTANT]
> Because `react-native-card-lens` operates **100% on-device without cloud LLMs or generative AI models**, layout inferences are rule- and geometry-based:
> - **Company Name & Tagline**: Inferred via font height (tallest non-contact text block) and vertical positioning. Unusual artistic layouts (e.g. diagonal logos or vertical stylized text) may require manual review.
> - **Multi-Branch Addresses**: Address extraction groups lines containing location keywords (Road, Nagar, Chowk, Sector, Plot, etc.). If a card lists 3 different city branches, all matched address lines will be returned in `addressLines[]`.
> - **Table Columns**: Column alignment works best when photos are taken with flat perspective. The included `startScanner()` viewfinder handles auto-flattening and perspective correction automatically.
> - **Image Quality**: Glare, extreme blur, or clipped card borders will degrade OCR precision.

---

## Network & Privacy Guarantee

- **Zero Network Calls**: No HTTP, REST, GraphQL, or WebSocket requests are made by this library.
- **Zero Third-Party Telemetry**: No tracking SDKs, Firebase Analytics, or external logging.
- **Zero Paid Subscriptions / No API Keys**: Everything runs locally using Google ML Kit on-device binaries.

---

## License

MIT © balram shejal
