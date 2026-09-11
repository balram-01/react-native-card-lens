I have an empty React Native library module (TurboModule/native module setup 
already scaffolded, no business logic yet). Build a 100% on-device, zero-cost 
document field extraction library for Android (Kotlin) with a JS bridge API.

GOAL: Extract structured fields from photos of business cards and bills/invoices 
using ONLY on-device ML Kit — no network calls, no LLM API, no paid services.

Build this in strict phases. Complete and verify each phase before starting the 
next. After each phase, show me the file list and a summary of what's testable.

=====================================================
PHASE 1 — Native module skeleton + dependencies
=====================================================
- Add ML Kit dependencies to the Android module's build.gradle:
  - com.google.mlkit:text-recognition (Latin)
  - com.google.mlkit:text-recognition-devanagari
  - com.google.mlkit:barcode-scanning
- Create the TurboModule spec (Codegen) exposing these JS-callable methods:
  - recognizeText(imageUri: string, script: 'latin' | 'devanagari'): Promise<RawOcrResult>
  - scanBarcodes(imageUri: string): Promise<BarcodeResult[]>
- RawOcrResult must preserve TextBlock structure: text, boundingBox (left/top/right/bottom), 
  confidence if available — DO NOT flatten to a single string. Downstream phases need 
  bounding boxes.
- Wire up image loading from a content:// or file:// URI to ML Kit's InputImage.
- Deliverable: I can call recognizeText from JS and get back raw blocks + boxes in 
  the console. No parsing logic yet.

=====================================================
PHASE 2 — Regex field extractors (script-agnostic fields)
=====================================================
Create a Kotlin object FieldExtractor with pure functions, each taking the full 
OCR text string:
  - extractPhoneNumbers(text): List<String>   // Indian mobile pattern + optional +91
  - extractEmails(text): List<String>
  - extractWebsites(text): List<String>
  - extractGstin(text): List<String>          // 15-char Indian GSTIN pattern
  - extractPincodes(text): List<String>       // 6-digit, avoid false positives from phone numbers
Write unit tests for each using the OCR text I'll paste from my sample cards 
(I'll provide 7 sample card texts after Phase 1 output). 
Deliverable: Kotlin unit tests passing, exposed via one bridge method 
extractContactFields(text: string): ContactFields for JS-side testing.

=====================================================
PHASE 3 — Layout-based heuristics (company name, person, role, address)
=====================================================
Using the bounding-box data from Phase 1's TextBlocks (not flattened text):
  - guessCompanyName: tallest bounding-box text block, excluding blocks that 
    matched phone/email/website regex
  - guessPersonAndRole: pairs of adjacent lines where the second line matches a 
    role keyword list (CEO, FOUNDER, PROPRIETOR, DIRECTOR, MANAGING DIRECTOR, 
    and Devanagari equivalents like डायरेक्टर, संचालक)
  - guessAddressLines: remaining unmatched lines containing location keywords 
    (Road, Nagar, Chowk, Square, Colony, Layout, रोड, नगर, चौक — configurable 
    keyword list, not hardcoded)
  - guessTagline: remaining unmatched line(s) between company name and address, 
    if short and non-numeric
Deliverable: bridge method extractCardLayout(rawOcrResult): CardLayoutFields, 
callable from JS with Phase 1's raw output as input.

=====================================================
PHASE 4 — Script detection & dual-recognizer routing
=====================================================
- Add logic to detect whether an image likely contains Devanagari script BEFORE 
  choosing which ML Kit recognizer to run (to avoid running both every time — 
  cost isn't $ here but is latency/battery).
- Strategy: run Latin recognizer first; if resulting confidence/text density is 
  low OR Unicode Devanagari codepoints are detected in a quick sample pass, 
  re-run with Devanagari recognizer and prefer that result.
- Expose combined method: scanCard(imageUri: string): Promise<BusinessCard> 
  that internally: runs OCR (with script routing) → runs Phase 2 regex → runs 
  Phase 3 layout heuristics → runs barcode scan → merges into the BusinessCard 
  JS object (share this exact interface):

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
    rawText: string; // always include fallback
  }

Deliverable: single JS call NativeModule.scanCard(uri) returns the above shape 
end-to-end on a real card image.

=====================================================
PHASE 5 — Bill/invoice table reconstruction
=====================================================
- New extractor path for tabular documents: use bounding box Y-coordinates to 
  cluster text blocks into rows, and X-coordinates to cluster into columns 
  (column boundaries inferred from header row block positions).
- Detect header row by matching keywords: "PROCEDURE", "CODE", "BILLED", 
  "AMOUNT", "CHARGES", "SERVICE/DATE", etc. — case-insensitive, configurable list.
- Build LineItem[] by mapping each subsequent row's blocks to nearest column 
  by X-overlap with header column.
- Extract document-level fields via regex: invoice number, invoice date, 
  due date, amount due, subtotal (currency-aware: $, ₹).
- Expose: scanBill(imageUri: string): Promise<BillDocument> matching the 
  interface:

  interface BillDocument {
    documentType?: string;
    issuerName?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    dueDate?: string;
    lineItems: { description: string; code?: string; billedAmount?: number; 
                  insurancePaid?: number; patientResponsibility?: number }[];
    subtotal?: number;
    amountDue?: number;
    rawText: string;
  }

Deliverable: scanBill() correctly reconstructs line items on a real invoice 
photo — verify against the 3 bill images I'll test with.

=====================================================
PHASE 6 — Document type auto-routing + public API surface
=====================================================
- Add a lightweight classifier (rule-based, not ML): if OCR text contains 
  billing keywords (INVOICE, BILL, AMOUNT DUE, CLAIM, SUBTOTAL) → route to 
  scanBill(); else → route to scanCard().
- Expose single top-level JS API: 
    scanDocument(imageUri: string): Promise<{ type: 'card' | 'bill', data: BusinessCard | BillDocument }>
- Write a README for the library module documenting: installation, permissions 
  required (CAMERA, READ_MEDIA_IMAGES), API surface, accuracy limitations 
  (state clearly: company-name/tagline disambiguation and multi-branch 
  addresses are heuristic best-effort, not guaranteed).
- Add a JS-side example screen (React Native) showing camera capture → 
  scanDocument() → rendered JSON result, for manual QA.

=====================================================
CONSTRAINTS THROUGHOUT ALL PHASES
=====================================================
- No network calls anywhere in this module. No API keys. No LLM calls.
- All ML Kit models must be on-device (unbundled or bundled — confirm which 
  and document the APK size tradeoff).
- Every regex/heuristic must be unit-testable in isolation, independent of 
  camera/UI.
- Confirm at the end of Phase 6: does any dependency added introduce a network 
  requirement? Flag explicitly if so.

Start with Phase 1 only. Show me the file structure and bridge method 
signatures before writing implementation.