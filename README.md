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

| Method                                                                      | Permissions Required                                                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startScanner()`                                                            | **None!** The camera viewfinder runs out-of-process inside Google Play Services. No camera or storage permissions need to be requested in your app's `AndroidManifest.xml`. |
| `scanCard()`, `scanBill()`, `scanDocument()` (with local gallery/file URIs) | `READ_MEDIA_IMAGES` (Android 13+) or `READ_EXTERNAL_STORAGE` (Android 12 and below) if accessing shared storage files.                                                      |

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

## CardFlowAI Integration (Seamless 1:1 Backend Replacement)

If your existing application expects the extraction response contract specified in `existin_app_mehtods.md`, you can use `extractCardFlow` as a drop-in replacement for `POST /api/v1/extract`:

```ts
import { extractCardFlow, startCardFlowScanner } from 'react-native-card-lens';

// 1. Direct drop-in extraction from an image URI or payload
const response = await extractCardFlow('file:///data/.../card.jpg');

if (response.success && response.data) {
  // Matches exact CardFlowAI backend contract:
  console.log(response.data.result.data.fullName); // Primary cardholder name
  console.log(response.data.result.data.companyName); // Company / Business name
  console.log(response.data.result.data.phonePrimary); // Primary phone
  console.log(response.data.result.data.contacts); // Full structured contacts array
  console.log(response.data.result.confidence); // Field confidence scores
  console.log(response.data.needsHumanReview); // Confidence review flag
}

// 2. Launch Camera Scanner UI + return CardFlowAI response directly
const { scanResult, cardFlowResponse } = await startCardFlowScanner();
```

### Thinking Module & Realtime Async Polling (existin_app_mehtods.md Lifecycle)

When using the Thinking Module or emulating the backend queue workflow, you can trigger asynchronous extraction that emits exact progress states (`18% preprocess` -> `38% classify` -> `62% extract_business_card` -> `82% validate` -> `98% finalize` -> `100% completed`):

```ts
import {
  startAsyncExtraction,
  getJobStatus,
  pollJobUntilComplete,
  checkExtractionQuota,
  extractCardFlowWithThinking,
} from 'react-native-card-lens';

// 1. Pre-scan Quota Check (matches GET /api/v1/cards/extract/check)
const quota = await checkExtractionQuota();
console.log('Unlimited on-device scans:', quota.data.isUnlimited); // true

// 2. Start Async Job (matches HTTP 202 Accepted)
const { data } = await startAsyncExtraction('file:///card.jpg', {
  useThinkingModule: true,
});
console.log('Job ID:', data.jobId); // e.g. "163d5c3b-..."

// 3. Poll Job Status (matches GET /api/v1/jobs/{jobId}/status)
const status = getJobStatus(data.jobId);
console.log(status.data.currentNode); // "extract_business_card"
console.log(status.data.currentStepMessage); // "Running On-Device Thinking Module reasoning..."
console.log(status.data.progressPercentage); // 62

// 4. Or use the automated polling helper:
const finalResult = await pollJobUntilComplete(data.jobId, {
  intervalMs: 1500,
  onProgress: (stage) => {
    console.log(`[${stage.progressPercentage}%] ${stage.currentStepMessage}`);
  },
});

// 5. Or one-line high-level helper with live stage callback:
const result = await extractCardFlowWithThinking(
  'file:///card.jpg',
  (stage) => {
    console.log(
      `UI Stage: ${stage.currentStepMessage} (${stage.progressPercentage}%)`
    );
  }
);
```

---

## On-Device Local LLM Engine (Free GGUF Small Language Models)

`react-native-card-lens` includes complete model management for 100% on-device open-weights SLMs (GGUF via llama.rn / llama.cpp):

```ts
import {
  AVAILABLE_LOCAL_MODELS,
  fetchRemoteModelSize,
  downloadLocalModel,
  checkLocalModelStatus,
  deleteLocalModel,
  onModelDownloadProgress,
  refineCardWithThinkingModule,
} from 'react-native-card-lens';

// 1. Inspect Available Models
AVAILABLE_LOCAL_MODELS.forEach((m) => {
  console.log(`${m.name} (${m.sizeMB} MB) - ${m.tag}`);
});
// SmolLM2-360M Q4_K_M (231 MB) - Fastest (<1s)
// Qwen2.5-0.5B Q4_K_M (340 MB) - Balanced (Multilingual)
// TinyLlama-1.1B Q4_K_M (669 MB) - High Quality

// 2. Query Exact Remote Download Size before downloading
const remoteInfo = await fetchRemoteModelSize(
  AVAILABLE_LOCAL_MODELS[0].downloadUrl
);
console.log('Actual Server File Size:', remoteInfo.totalMB, 'MB');

// 3. Download Model with Real-Time Streaming Progress, Speed (MB/s), & ETA
const { localPath } = await downloadLocalModel(
  AVAILABLE_LOCAL_MODELS[0],
  (prog) => {
    console.log(
      `Downloaded: ${prog.downloadedMB} / ${prog.totalMB} MB (${prog.percentage}%)`
    );
    console.log(
      `Speed: ${prog.speedMBps} MB/s, ETA: ${prog.estimatedRemainingSeconds}s`
    );
  }
);

// 4. Check If Cached on Disk
const status = await checkLocalModelStatus(AVAILABLE_LOCAL_MODELS[0]);
console.log('Is Cached Locally:', status.isDownloaded);

// 5. Instant Zero-Setup Native Semantic Reasoner
const refinedCard = await refineCardWithThinkingModule(rawOcrText);
```

---

## Accuracy Limitations & Best Practices

> [!IMPORTANT]
> Because `react-native-card-lens` operates **100% on-device without cloud LLMs or generative AI models**, layout inferences are rule- and geometry-based:
>
> - **Company Name & Tagline**: Inferred via font height (tallest non-contact text block) and vertical positioning. Unusual artistic layouts (e.g. diagonal logos or vertical stylized text) may require manual review.
> - **Multi-Branch Addresses**: Address extraction groups lines containing location keywords (Road, Nagar, Chowk, Sector, Plot, etc.). If a card lists 3 different city branches, all matched address lines will be returned in `addressLines[]`.
> - **Table Columns**: Column alignment works best when photos are taken with flat perspective. The included `startScanner()` viewfinder handles auto-flattening and perspective correction automatically.
> - **Image Quality**: Glare, extreme blur, or clipped card borders will degrade OCR precision.

---

## Architecture & Processing Guides

For an in-depth breakdown of how the extraction pipeline works under the hood:

- 📖 **[Step-by-Step Processing Mechanism](docs/PROCESSING_MECHANISM_STEP_BY_STEP.md)**: End-to-end walkthrough of OCR fusion, layout parsing, deterministic regex, semantic reasoning, and GBNF local SLM decoding.
- 🧠 **[Local LLM Architecture & Engine Guide](docs/LLM_ARCHITECTURE_AND_ENGINE_GUIDE.md)**: Offline SLM model benchmarks (Qwen2.5, SmolLM2) and GBNF grammars.
- 🌐 **[Universal Multilingual Pipeline Guide](docs/UNIVERSAL_PIPELINE_GUIDE.md)**: Details on regional Devanagari script processing and edge cases.

---

## Network & Privacy Guarantee

- **Zero Network Calls**: No HTTP, REST, GraphQL, or WebSocket requests are made by this library.
- **Zero Third-Party Telemetry**: No tracking SDKs, Firebase Analytics, or external logging.
- **Zero Paid Subscriptions / No API Keys**: Everything runs locally using Google ML Kit on-device binaries.

---

## License

MIT © balram shejal
