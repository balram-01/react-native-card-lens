/**
 * react-native-card-lens — Unified Document & Card Scanner Studio
 *
 * Single-screen automatic scanner that:
 *  1. Scans cards and documents with real-time auto edge detection & perspective correction
 *  2. Automatically classifies behind the scenes whether it is a Business Card or Bill/Invoice
 *  3. Seamlessly renders structured contact fields or financial line-item tables
 *  4. Provides a 100% real, dynamic On-Device LLM (llama.rn / GGUF) manager with live progress
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LogBox,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';

LogBox.ignoreAllLogs();

import {
  startScanner,
  pickDocument,
  scanDocument,
  refineCardWithThinkingModule,
  downloadThinkingModel,
  BUSINESS_CARD_GBNF_GRAMMAR,
  extractDeterministicUniversal,
  extractHybridUniversalCard,
  parseFallbackLocalBill,
} from 'react-native-card-lens';
import type {
  RawOcrResult,
  ScanResult,
  BusinessCard,
  BillDocument,
  DocumentScanResult,
  ThinkingModelDownloadProgress,
} from 'react-native-card-lens';

// ─── Free, Non-Gated GGUF Models (llama.rn / llama.cpp) ─────────────────────
// Keeping exclusively the Universal 1.5B model we are fine-tuning for all 8 Indian languages
const AVAILABLE_SLM_MODELS = [
  {
    id: 'qwen25-15b-universal-card-q4',
    name: 'Qwen2.5-1.5B Universal Indic Edition',
    tag: 'Universal (8 Languages)',
    sizeMB: 986,
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    description:
      'Universal Indic card SLM fine-tuned for all 8 Indian languages (Marathi, Hindi, Gujarati, Tamil, Telugu, Kannada, Bengali, English). High capacity 1.5B parameters.',
  },
];

// ─── Realistic Samples (Cards & Invoices) ──────────────────────────────────
const SAMPLE_DOCUMENTS = [
  {
    title: '🛋️ वैष्णवी (Marathi Furniture & Steel)',
    type: 'card' as const,
    subtitle: 'Devanagari numerals, Popat Jamdade, Pandharpur',
    text: `पोपट जमदाडे  !! श्री जानूबाई देवी प्रसन्न !!
मो. ८६०५७७०२९२
     ८६०५७७०२९६

वैष्णवी
स्टील, फर्निचर अॅन्ड इलेक्ट्रॉनिक्स
लग्न बस्त्याचे माहेरघर

आमच्याकडे सोफासेट, डायनिंग टेबल, कपाट,
स्टिल, फर्निचर, ऑफीस टेबल, फ्रिज, कुलर,
एल ई डी सर्व इलेक्ट्रॉनिक्स वस्तु व लग्नकार्यासाठी
लागणाऱ्या सर्व वस्तु व भांडी होलसेल दरात मिळतील.

पंढरपूर टेंभुर्णी रोड, भोसे (क), HP पेट्रोलपंपा शेजारी ता. पंढरपूर`,
  },
  {
    title: '🏏 Bharat Sports (Wholesale & Retail)',
    type: 'card' as const,
    subtitle: 'Ayyaz Bhai, 4 Mobiles, Sitabuldi Nagpur',
    text: `AYYAZ BHAI : 8484940121
9373129250
8446077757
7775066777

CARROM BOARD
Shop No. 29 Maharaj Bag Road, Variety
Sqaure, Sitabuldi, Nagpur - 440012

BHARAT
SPORTS

Whiole Seller & Rehailer of High :
Quality of All Sports Goods

Email : bharatsports29@gmail.com
www. bahratsportsnagpur.com`,
  },
  {
    title: '💻 Hesten Solutions (IT Services)',
    type: 'card' as const,
    subtitle: 'Hemlata Jawanjal CEO, Nagpur & Amsterdam',
    text: `Hemlata Jawanjal
CEO & FOUNDER
+91 7385067604, 9588488259
hemlata@hestensolutions.com
www.hestensolutions.com

32/1, RMS. Collony Durga Nagar Old Subhedar Layout Nagpur, India - 440024
336, Bos en Lommerweg, 1061 DJ, Amsterdam Netherland

Hesten Solutions Pvt. Ltd.
• Web & Mobile App Development Software Solutions
• Billing Software • Website Designing • Digital Marketing
• Advertising with Meta Ads • Google Listing • Google Adds`,
  },
  {
    title: '📱 Mahakal Telecom (Mobile Spares)',
    type: 'card' as const,
    subtitle: 'Patel, 2 Mobiles, Sitabuldi Nagpur',
    text: `।। श्री गणेशाय नमः ।।
Patel : 9983032493
9881199533

MAHAKAL TELECOM
ALL MOBILE SPARE PARTS, FOLDER, LCD & TOUCH (WHOLESALE)
Shop No. G.F-13A, Rahul Bazar Complex, Main Road, Beside Sonchala Jewellers, Sitabuldi, Nagpur.`,
  },
  {
    title: '👗 गुरुगोविंद सिंग फॅशन साडी',
    type: 'card' as const,
    subtitle: 'Amar & Jatin Jiwnani, Badkas Chowk Nagpur, GSTIN',
    text: `GSTIN : 27ADIPJ3019R1Z4
गुभुगीबिंद शिंग
फॅशन साडी
राम भंडार होटल के सामने, बडकस चौक, नागपूर
Amar Jiwnani : 9370002379  Jatin Jiwnani : 9373783433
कम्पलीट फॅमिली शॉप`,
  },
  {
    title: '📈 राजस मार्केटींग (Marathi Marketing)',
    type: 'card' as const,
    subtitle: 'Mr. Rajesh T. Bokade, 3 Mobiles, New Diamond Nagar',
    text: `॥ परमात्मा एक ॥
Mr. Rajesh T. Bokade
M.: 9146496994
राजस
9373662998
राजस मार्केटींग ॲन्ड सेल्स प्रा. लि.
एक नई सोच जो आपकी जिंदगी बदल दे.....
ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खर्बी रोड, माता मंदीर के पास, नागपूर. M. No: (Off) 8888120511
Res Add : १०, न्यु डायमंड नगर, खर्बी रोड, नागपूर.`,
  },
  {
    title: '🔮 Rashidham Astrological (Consultancy)',
    type: 'card' as const,
    subtitle: 'Vedic Astrology & Vastu, Dharampeth Nagpur',
    text: `RASHIDHAM ASTROLOGICAL CONSULTANCY
NEAR ZENDA CHOWK, GAJANAN TEMPLE ROAD, DHARAMPETH, NAGPUR- 440010 (MH). MOB: -91 77760 72277, 8767375280
CONTACT@RASHIDHAM.COM
WWW.RASHIDHAM.COM
VEDIC ASTROLOGY, ASTRO NUMEROLOGY, TAROT, HEALING, VASTU, GEMSTONES & PUJA RITUALS`,
  },
  {
    title: '🎂 Cakes Inn (5 Branches & 5 Phones)',
    type: 'card' as const,
    subtitle: 'Bakery chain across Nagpur with branch phones',
    text: `Cakes Inn
www.cakesinn.com

265-A, Shivkripa Appartment, Laxmi Nagar Square | 95270 00045
Plot No. 21/22/23/24, Center One Complex Near NMC Octroi Naka, Hingna Road | 95279 00033
Opp. Saraf Chambers, Mount Road, Sadar | 95270 00204
Naga Putla Square, Post Office Road, Gandhibagh | 95270 00012
Plot No. 1 Near Epicure Food Plaza Under Pass Road Manish Nagar | 95270 00773`,
  },
  {
    title: '🏍️ साहु मोटर्स (Marathi EV Dealership)',
    type: 'card' as const,
    subtitle: 'Mayuri E-Rickshaw & E-Bike, Manewada Chowk Nagpur',
    text: `साहु मोटर्स
सेल्स सर्व्हिस अँड स्पेअर्स
MAYURI
Mob. 8888832104
9921563630
0712-2233445
■ ई-रिक्षा
■ ई-बाईक
पत्ता : श्री नगर, मानेवाडा चौक, नागपूर - ४४००२४
GSTIN: 27AAPFU0939F1ZV`,
  },
  {
    title: '🏆 Variety Sports (Two-Sided Card)',
    type: 'card' as const,
    subtitle: 'Sagar Panjwani, GSTIN, Sitabuldi Nagpur',
    text: `VARIETY SPORTS
SAGAR PANJWANI
• 7769020832
• 9890774044
GST No. 27BZLPP6133N2ZN
• varietysports.nagpur@gmail.com
• 9 & 10, Maharaj Bagh Road, Sitabuldi, Nagpur - 440 001`,
  },
  {
    title: '🏥 Southwestern Vermont Medical Center (Bill)',
    type: 'bill' as const,
    subtitle: 'Medical Hospital Invoice with $1,892.00 Due',
    text: `SOUTHWESTERN VERMONT MEDICAL CENTER
BILL TO: Patient
Invoice #: INV-883842
Invoice Date: May 27, 2025
Due Date: Jun 26, 2025
AMOUNT DUE $1,892.00
Subtotal $1,892.00
Call our Patient Financial Services at (802) 885-7531
PO Box 2000, Bennington, VT 05201`,
  },
  {
    title: '🩺 Good Faith Estimate (GFE Medical)',
    type: 'bill' as const,
    subtitle: 'Colonoscopy GFE, Total $3,450, Amount Owed $2,200',
    text: `Good Faith Estimate (GFE) - Colonoscopy
Patient Name: John Doe
Provider / Facility Information:
ABC Gastroenterology Associates
XYZ Endoscopy Center
123 Medical Plaza, Suite 100
Total Estimated Cost: $3,450
Amount Owed: $2,200`,
  },
  {
    title: '📄 Highmark Copley Hospital (Insurance)',
    type: 'bill' as const,
    subtitle: 'Health Insurance Claim, Vedansh Chopkar, $252.00',
    text: `HIGHMARK
Provider: COPLEY HOSPITAL
Member: VEDANSH C CHOPKAR
Date (s) of Service: 04/27/26
TOTALS: $252.00
Claim # 22681147071
Pediatrics Phone: 302-478-2613`,
  },
];

// ─── Safe Rendering & Normalization Helpers ──────────────────────────────────
function safeText(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if (typeof val.number === 'string') return val.number;
    if (typeof val.phone === 'string') return val.phone;
    if (typeof val.name === 'string') return val.name;
    if (typeof val.value === 'string') return val.value;
    if (typeof val.text === 'string') return val.text;
    try {
      return JSON.stringify(val);
    } catch {
      return '';
    }
  }
  return String(val);
}

function normalizeBusinessCard(raw: any): BusinessCard {
  if (!raw || typeof raw !== 'object') {
    return {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: '',
    };
  }

  let companyName: string | undefined;
  if (typeof raw.companyName === 'string') {
    companyName = raw.companyName.trim();
  } else if (raw.companyName && typeof raw.companyName === 'object') {
    companyName = safeText(raw.companyName).trim();
  }

  const tagline =
    typeof raw.tagline === 'string' ? raw.tagline.trim() : undefined;
  const slogan = typeof raw.slogan === 'string' ? raw.slogan.trim() : undefined;

  const contactPersons: { name: string; role?: string }[] = [];
  const rawPersons = Array.isArray(raw.contactPersons)
    ? raw.contactPersons
    : [];
  for (const p of rawPersons) {
    if (typeof p === 'string' && p.trim()) {
      contactPersons.push({ name: p.trim() });
    } else if (p && typeof p === 'object') {
      const name = safeText(p.name || p.person || p.contact).trim();
      const role =
        safeText(p.role || p.title || p.designation).trim() || undefined;
      if (name) {
        contactPersons.push({ name, role });
      }
    }
  }

  const phoneNumbers: string[] = [];
  const labeledPhones: { number: string; label?: string }[] = [];

  const rawPhones = Array.isArray(raw.phoneNumbers)
    ? raw.phoneNumbers
    : Array.isArray(raw.phones)
      ? raw.phones
      : typeof raw.phone === 'string'
        ? [raw.phone]
        : [];

  for (const item of rawPhones) {
    if (typeof item === 'string' && item.trim()) {
      phoneNumbers.push(item.trim());
    } else if (item && typeof item === 'object') {
      const num = safeText(item.number || item.phone || item.value).trim();
      const label = safeText(item.label || item.type).trim() || undefined;
      if (num) {
        phoneNumbers.push(num);
        labeledPhones.push({ number: num, label });
      }
    }
  }

  if (Array.isArray(raw.labeledPhones)) {
    for (const lp of raw.labeledPhones) {
      if (lp && typeof lp === 'object') {
        const num = safeText(lp.number || lp.phone || lp.value).trim();
        const label = safeText(lp.label || lp.type).trim() || undefined;
        if (num && !phoneNumbers.includes(num)) {
          phoneNumbers.push(num);
          labeledPhones.push({ number: num, label });
        }
      }
    }
  }

  const emails: string[] = [];
  const rawEmails = Array.isArray(raw.emails)
    ? raw.emails
    : raw.email
      ? [raw.email]
      : [];
  for (const e of rawEmails) {
    if (typeof e === 'string' && e.trim()) {
      emails.push(e.trim());
    } else if (e && typeof e === 'object') {
      const val = safeText(e.email || e.value).trim();
      if (val) emails.push(val);
    }
  }

  const websites: string[] = [];
  const rawWebs = Array.isArray(raw.websites)
    ? raw.websites
    : raw.website
      ? [raw.website]
      : [];
  for (const w of rawWebs) {
    if (typeof w === 'string' && w.trim()) {
      websites.push(w.trim());
    } else if (w && typeof w === 'object') {
      const val = safeText(w.website || w.url || w.value).trim();
      if (val) websites.push(val);
    }
  }

  const addressLines: string[] = [];
  const rawAddresses = Array.isArray(raw.addressLines)
    ? raw.addressLines
    : Array.isArray(raw.addresses)
      ? raw.addresses
      : typeof raw.address === 'string'
        ? [raw.address]
        : [];

  for (const a of rawAddresses) {
    if (typeof a === 'string' && a.trim()) {
      addressLines.push(a.trim());
    } else if (a && typeof a === 'object') {
      const parts = [
        a.street,
        a.city,
        a.state,
        a.pincode,
        a.zip,
        a.country,
        a.address,
        a.line,
        a.value,
      ].filter((part) => typeof part === 'string' && part.trim().length > 0);
      if (parts.length > 0) {
        addressLines.push(parts.join(', '));
      } else {
        const str = Object.values(a)
          .filter((v) => typeof v === 'string')
          .join(', ');
        if (str) addressLines.push(str);
      }
    }
  }

  const pincode = typeof raw.pincode === 'string' ? raw.pincode : undefined;
  const gstin = typeof raw.gstin === 'string' ? raw.gstin : undefined;

  const providedServices: string[] = [];
  const rawServices = Array.isArray(raw.providedServices)
    ? raw.providedServices
    : Array.isArray(raw.services)
      ? raw.services
      : [];
  for (const s of rawServices) {
    if (typeof s === 'string' && s.trim()) {
      providedServices.push(s.trim());
    }
  }

  return {
    companyName,
    tagline,
    slogan,
    contactPersons,
    phoneNumbers,
    labeledPhones: labeledPhones.length > 0 ? labeledPhones : undefined,
    emails,
    email: emails[0],
    websites,
    website: websites[0],
    addressLines,
    pincode,
    gstin,
    providedServices:
      providedServices.length > 0 ? providedServices : undefined,
    rawText: typeof raw.rawText === 'string' ? raw.rawText : '',
  };
}

/**
 * Robust JSON extractor and repairer for on-device Small Language Models.
 * Handles markdown wrapping, unclosed quotes, and trailing unclosed brackets.
 */
function tryExtractAndParseJson(rawResponse: string): any | null {
  if (!rawResponse) return null;
  let text = rawResponse.trim();

  // Strip markdown code fences if present (e.g. ```json ... ```)
  text = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Ensure text starts at the first '{'
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) {
    text = '{' + text;
  } else if (firstBrace > 0) {
    text = text.substring(firstBrace);
  }

  // First quick attempt: if closing brace exists, try parsing up to last '}'
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace !== -1) {
    try {
      return JSON.parse(text.substring(0, lastBrace + 1));
    } catch {
      // If parsing fails (e.g. trailing comma or unclosed string), proceed to repair
    }
  }

  // Resilient repair for truncated outputs (e.g. unexpected end of input)
  try {
    let repaired = text;

    // Remove any trailing commas before brackets/braces
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // Balance unclosed quotes
    let inString = false;
    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
        inString = !inString;
      }
    }
    if (inString) {
      repaired += '"';
    }

    // Balance open brackets and braces
    let openBraces = 0;
    let openBrackets = 0;
    inString = false;
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (char === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
        inString = !inString;
      }
      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }
    }

    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }

    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

export default function App() {
  // Navigation & UI Toggles
  const [showLlmManager, setShowLlmManager] = useState(false);
  const [showRawOcr, setShowRawOcr] = useState(false);
  const [forceViewType, setForceViewType] = useState<'card' | 'bill' | null>(
    null
  );

  // Scanning State
  const [pageLimit, setPageLimit] = useState<number>(1);
  const [scannedImageUri, setScannedImageUri] = useState<string | null>(null);
  const [scannedImageUris, setScannedImageUris] = useState<string[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extraction Results
  const [detectedType, setDetectedType] = useState<'card' | 'bill' | null>(
    null
  );
  const [businessCard, setBusinessCard] = useState<BusinessCard | null>(null);
  const [billDocument, setBillDocument] = useState<BillDocument | null>(null);
  const [ocrResult, setOcrResult] = useState<RawOcrResult | null>(null);
  const [thinkingLoading, setThinkingLoading] = useState(false);

  // SLM / llama.rn State
  const [selectedModelIdx, setSelectedModelIdx] = useState<number>(0);
  const [downloadedModels, setDownloadedModels] = useState<
    Record<string, string>
  >({});
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(
    null
  );
  const [downloadProgress, setDownloadProgress] =
    useState<ThinkingModelDownloadProgress | null>(null);
  const [slmLoading, setSlmLoading] = useState(false);

  const llamaContextRef = useRef<LlamaContext | null>(null);

  // Clear all current results
  const clearResults = () => {
    setDetectedType(null);
    setForceViewType(null);
    setBusinessCard(null);
    setBillDocument(null);
    setOcrResult(null);
    setSelectedPageIndex(0);
    setError(null);
    setStatusMessage(null);
    setHybridResult(null);
    setIsHybridActive(false);
    setShowResidualModal(false);
  };

  // Build the structured extraction prompt for SLM
  const buildExtractionPrompt = (rawText: string) => {
    return `<|im_start|>system
You are an expert business card extractor. Extract structured contact fields from the OCR text into valid JSON only. Output raw JSON directly without markdown formatting.
Crucial Extraction Rules:
1. Multi-branch Outlets: If the card lists multiple store branches (e.g. separated by '|' and phone numbers), extract each branch address into the 'addresses' array and separate each branch phone number into 'phoneNumbers'.
2. Brand vs Persons: Store brand names (e.g. "Cakes Inn") belong in "companyName". Do NOT extract building or landmark names (e.g. apartments, complexes, chambers, plazas) as contact persons. If no personal name is present on a brand/retail card, set "contactPersons": [].
3. Strip embedded phone numbers from the address strings.
<|im_end|>
<|im_start|>user
OCR Text:
${rawText}

Return this JSON format:
{
  "companyName": "Company or null",
  "tagline": "Tagline or null",
  "contactPersons": [{"name": "Name", "role": "Title"}],
  "phoneNumbers": ["Phone"],
  "emails": ["Email"],
  "websites": ["Website"],
  "addresses": ["Address"],
  "pincode": "PIN or null",
  "gstin": "GSTIN or null"
}
<|im_end|>
<|im_start|>assistant
{`;
  };

  // Launch live camera scanner or gallery import
  const handleLaunchScanner = async () => {
    clearResults();
    setLoading(true);
    setStatusMessage('📷 Opening CameraX Document Scanner...');

    try {
      const scan: ScanResult = await startScanner({
        pageLimit: pageLimit,
        scannerMode: 'FULL',
        allowGalleryImport: true,
        autoOcr: false,
        script: 'auto',
      });

      setScannedImageUri(scan.imageUri);
      const allUris =
        scan.imageUris && scan.imageUris.length > 0
          ? scan.imageUris
          : scan.imageUri
            ? [scan.imageUri]
            : [];
      setScannedImageUris(allUris);
      setSelectedPageIndex(0);
      if (scan.ocrResult) setOcrResult(scan.ocrResult);

      const targetToScan = allUris.length > 1 ? allUris : scan.imageUri;

      if (scan.imageUri) {
        setStatusMessage('⚡ Auto-detecting document type (Card vs Bill)...');
        const res: DocumentScanResult = await scanDocument(targetToScan);
        setDetectedType(res.type);

        if (res.type === 'card') {
          const card = normalizeBusinessCard(res.data as BusinessCard);
          setBusinessCard(card);
          setStatusMessage('✅ Auto-Detected: Business Card');
        } else {
          const bill = res.data as BillDocument;
          setBillDocument(bill);
          setStatusMessage(
            `✅ Auto-Detected: Bill / Invoice (${bill.lineItems?.length || 0} line items)`
          );
        }
      }
    } catch (e: any) {
      if (e.code === 'CARDLENS_SCAN_CANCELED') {
        setStatusMessage('Scan cancelled by user.');
      } else {
        setError(e.message || 'Scan failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Open system storage file picker for Images or Multi-page PDFs
  const handlePickDocument = async () => {
    clearResults();
    setLoading(true);
    setStatusMessage('📂 Opening system file picker (Images & PDFs)...');

    try {
      const pick: ScanResult = await pickDocument({
        allowPdf: true,
        autoOcr: false,
      });

      setScannedImageUri(pick.imageUri);
      const allUris =
        pick.imageUris && pick.imageUris.length > 0
          ? pick.imageUris
          : pick.imageUri
            ? [pick.imageUri]
            : [];
      setScannedImageUris(allUris);
      setSelectedPageIndex(0);

      const targetToScan = allUris.length > 1 ? allUris : pick.imageUri;

      if (pick.imageUri) {
        const isMultiPage = allUris.length > 1;
        setStatusMessage(
          isMultiPage
            ? `📄 Imported ${allUris.length} pages from PDF! Auto-analyzing...`
            : '⚡ Auto-analyzing imported file...'
        );
        const res: DocumentScanResult = await scanDocument(targetToScan);
        setDetectedType(res.type);

        if (res.type === 'card') {
          const card = normalizeBusinessCard(res.data as BusinessCard);
          setBusinessCard(card);
          setStatusMessage(
            `✅ Auto-Detected: Business Card (${card.companyName || 'Card'}${isMultiPage ? ` • ${allUris.length} pages` : ''})`
          );
        } else {
          const bill = res.data as BillDocument;
          setBillDocument(bill);
          setStatusMessage(
            `✅ Auto-Detected: Bill / Invoice (${bill.lineItems?.length || 0} items)`
          );
        }
      }
    } catch (e: any) {
      if (e.code === 'CARDLENS_PICK_CANCELED') {
        setStatusMessage('File selection cancelled by user.');
      } else {
        setError(e.message || 'File picking failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Test realistic samples
  const handleLoadSample = async (sample: (typeof SAMPLE_DOCUMENTS)[0]) => {
    clearResults();
    setLoading(true);
    setStatusMessage(`⚡ Auto-classifying "${sample.title}"...`);

    try {
      setOcrResult({ blocks: [], rawText: sample.text });

      if (sample.type === 'bill') {
        // Dynamically parse sample as Bill using semantic bill extractor
        setDetectedType('bill');
        const parsed = parseFallbackLocalBill(sample.text);
        setBillDocument(parsed);
        setStatusMessage(
          `✅ Auto-Detected: ${parsed.documentType || 'Bill'} (${parsed.issuerName || 'Vendor'})`
        );
      } else {
        // Parse sample as Card using Native Thinking / Semantic Reasoner
        console.log(
          '[CardLensTest] Starting sample card refinement:',
          sample.title
        );
        setDetectedType('card');
        try {
          const refined = await refineCardWithThinkingModule(sample.text);
          console.log(
            '[CardLensTest] Refined successfully:',
            JSON.stringify(refined)
          );
          let card: BusinessCard = normalizeBusinessCard(refined);
          const det = extractDeterministicUniversal(sample.text);
          setHybridResult(det);
          card = extractHybridUniversalCard(sample.text, card);
          setIsHybridActive(true);
          console.log('[CardLensTest] Normalized card:', JSON.stringify(card));
          setBusinessCard(card);
          setStatusMessage(
            `✅ Auto-Detected: Business Card (${card.companyName || 'Card'})`
          );
        } catch (err: any) {
          console.error('[CardLensTest] Refinement error:', err);
          setError(err.message || String(err));
        }
      }
    } catch (e: any) {
      console.error('[CardLensTest] Top error:', e);
      setError(e.message || 'Failed to process sample');
    } finally {
      setLoading(false);
    }
  };

  // Refine Business Card with On-Device LLM or Semantic Reasoner
  const handleRefineWithThinking = async () => {
    if (!businessCard && !ocrResult) return;
    setThinkingLoading(true);
    setError(null);
    try {
      const ctx = llamaContextRef.current;
      const activeModel = AVAILABLE_SLM_MODELS.find(
        (m) => m.id === activeModelId
      );

      // Prioritize original OCR raw text so no multi-branch lines or phones are lost
      const rawText =
        ocrResult?.rawText ||
        businessCard?.rawText ||
        [
          businessCard?.companyName,
          businessCard?.tagline,
          businessCard?.contactPersons
            ?.map((p) => `${p.name} ${p.role || ''}`)
            .join(' '),
          businessCard?.addressLines?.join('\n'),
          businessCard?.phoneNumbers?.join(' '),
          businessCard?.emails?.join(' '),
          businessCard?.websites?.join(' '),
        ]
          .filter(Boolean)
          .join('\n');

      if (ctx) {
        setStatusMessage(
          `🧠 Running Local GGUF (${activeModel?.name || 'llama.rn'})...`
        );
        try {
          const prompt = buildExtractionPrompt(rawText);
          const result = await ctx.completion({
            prompt,
            n_predict: 250,
            temperature: 0.1,
            grammar: BUSINESS_CARD_GBNF_GRAMMAR,
            stop: ['<|im_end|>', '</s>', '<|endoftext|>'],
          });

          const parsed = tryExtractAndParseJson(result.text);
          if (parsed && typeof parsed === 'object') {
            let card = normalizeBusinessCard(parsed);
            const det = extractDeterministicUniversal(rawText);
            setHybridResult(det);
            card = extractHybridUniversalCard(rawText, card);
            setIsHybridActive(true);
            setBusinessCard(card);
            setStatusMessage(
              `✨ Card refined by ${activeModel?.name || 'llama.rn GGUF'}!`
            );
            return;
          }
        } catch (llmErr: any) {
          console.warn(
            'Local LLM inference encountered error, falling back to Semantic Reasoner:',
            llmErr
          );
        }
      }

      // Fallback: Deterministic Semantic Thinking Reasoner
      setStatusMessage('⚡ Running Universal Semantic Thinking Engine...');
      const refined = await refineCardWithThinkingModule(rawText);
      let card = normalizeBusinessCard(refined);
      const det = extractDeterministicUniversal(rawText);
      setHybridResult(det);
      card = extractHybridUniversalCard(rawText, card);
      setIsHybridActive(true);
      setBusinessCard(card);
      setStatusMessage(
        '✨ Card refined by Universal Semantic Thinking Reasoner!'
      );
    } catch (e: any) {
      setError(e.message || 'Refinement failed');
    } finally {
      setThinkingLoading(false);
    }
  };

  // Download GGUF Model with chunked streaming progress
  const handleDownloadModel = async (modelIdx: number) => {
    const model = AVAILABLE_SLM_MODELS[modelIdx]!;
    setSelectedModelIdx(modelIdx);
    setDownloadingModelId(model.id);
    setError(null);
    setDownloadProgress({
      fileName: model.filename,
      downloadedBytes: 0,
      totalBytes: model.sizeMB * 1024 * 1024,
      percentage: 0,
    });
    setStatusMessage(`Downloading ${model.name}...`);
    try {
      const localPath = await downloadThinkingModel(
        model.url,
        model.filename,
        (prog) => setDownloadProgress(prog)
      );
      setDownloadedModels((prev) => ({ ...prev, [model.id]: localPath }));
      setStatusMessage(`✅ Downloaded: ${model.name}`);
    } catch (e: any) {
      setError(e.message || 'Model download failed');
    } finally {
      setDownloadingModelId(null);
      setDownloadProgress(null);
    }
  };

  // Load Model into RAM via llama.rn
  const handleLoadModel = async (modelIdx: number) => {
    const model = AVAILABLE_SLM_MODELS[modelIdx]!;
    setSelectedModelIdx(modelIdx);
    const targetPath = downloadedModels[model.id];
    if (!targetPath) {
      setError('Please download this model first.');
      return;
    }
    setSlmLoading(true);
    setStatusMessage(`Loading ${model.name} into RAM via llama.rn...`);
    try {
      if (llamaContextRef.current) {
        await llamaContextRef.current.release();
        llamaContextRef.current = null;
        setActiveModelId(null);
      }
      const ctx = await initLlama({
        model: `file://${targetPath}`,
        n_ctx: 1024,
        n_threads: 4,
      });
      llamaContextRef.current = ctx;
      setActiveModelId(model.id);
      setStatusMessage(`🟢 ${model.name} is Active & Ready in RAM!`);
    } catch (e: any) {
      setError(e.message || 'Failed to load GGUF model');
      setActiveModelId(null);
    } finally {
      setSlmLoading(false);
    }
  };

  // Unload Model from RAM
  const handleUnloadModel = async () => {
    try {
      if (llamaContextRef.current) {
        await llamaContextRef.current.release();
        llamaContextRef.current = null;
      }
      setActiveModelId(null);
      setStatusMessage('Model unloaded from RAM.');
    } catch (e: any) {
      setError(e.message || 'Failed to unload model');
    }
  };

  const selectedModel = AVAILABLE_SLM_MODELS[selectedModelIdx]!;
  const isSelectedDownloaded = !!downloadedModels[selectedModel.id];
  const isSelectedActive = activeModelId === selectedModel.id;
  const isSelectedDownloading = downloadingModelId === selectedModel.id;
  const activeModelObj = AVAILABLE_SLM_MODELS.find(
    (m) => m.id === activeModelId
  );

  // Resolved document type (allows user manual override)
  const currentViewType = forceViewType || detectedType;

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0D17" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.appTitle}>CardLens Studio</Text>
              <Text style={styles.appSubtitle}>
                Auto-Detecting Card & Bill Scanner
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 6 }}>
              {/* On-Device LLM Status Toggle Pill (Qwen2.5-1.5B Universal) */}
              <TouchableOpacity
                style={[
                  styles.llmHeaderPill,
                  activeModelId ? styles.llmHeaderPillActive : null,
                ]}
                onPress={() => setShowLlmManager(!showLlmManager)}
              >
                <Text style={styles.llmHeaderPillDot}>
                  {activeModelId ? '🟢' : '🧠'}
                </Text>
                <Text style={styles.llmHeaderPillText}>
                  {activeModelObj
                    ? activeModelObj.name
                        .replace('Universal Indic Edition', '')
                        .trim()
                    : 'Qwen 1.5B (Trained)'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Dynamic On-Device LLM (GGUF) Manager (Collapsible) */}
        {showLlmManager && (
          <View style={styles.llmManagerCard}>
            <View style={styles.llmManagerHeader}>
              <View>
                <Text style={styles.llmManagerTitle}>
                  🧠 On-Device SLM Intelligence
                </Text>
                <Text style={styles.llmManagerSubtitle}>
                  100% Free • Offline llama.rn GGUF • Zero Tokens • Zero API
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLlmManager(false)}
                style={styles.llmCloseBtn}
              >
                <Text style={styles.llmCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 3 Real GGUF Model Options */}
            {AVAILABLE_SLM_MODELS.map((model, idx) => {
              const isDownloaded = !!downloadedModels[model.id];
              const isActive = activeModelId === model.id;
              const isThisDownloading = downloadingModelId === model.id;
              const isSelected = selectedModelIdx === idx;

              return (
                <TouchableOpacity
                  key={model.id}
                  style={[
                    styles.modelCard,
                    isSelected && styles.modelCardSelected,
                    isActive && styles.modelCardActive,
                  ]}
                  onPress={() => setSelectedModelIdx(idx)}
                >
                  <View style={styles.modelHeaderRow}>
                    <View style={styles.modelRadioRow}>
                      <Text
                        style={[
                          styles.modelRadio,
                          isSelected && styles.modelRadioActive,
                        ]}
                      >
                        {isSelected ? '●' : '○'}
                      </Text>
                      <Text style={styles.modelNameText}>{model.name}</Text>
                    </View>
                    <View style={styles.modelTagBadge}>
                      <Text style={styles.modelTagText}>{model.sizeMB} MB</Text>
                    </View>
                  </View>

                  <Text style={styles.modelDescText}>{model.description}</Text>

                  {/* Status Badges */}
                  <View style={styles.modelStatusRow}>
                    {isActive ? (
                      <View style={[styles.statusBadge, styles.statusActive]}>
                        <Text style={styles.statusActiveText}>
                          🟢 Active in RAM
                        </Text>
                      </View>
                    ) : isThisDownloading ? (
                      <View
                        style={[styles.statusBadge, styles.statusDownloading]}
                      >
                        <Text style={styles.statusDownloadingText}>
                          ⏳ Downloading ({downloadProgress?.percentage ?? 0}%)
                        </Text>
                      </View>
                    ) : isDownloaded ? (
                      <View
                        style={[styles.statusBadge, styles.statusDownloaded]}
                      >
                        <Text style={styles.statusDownloadedText}>
                          💾 Ready on Device
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[styles.statusBadge, styles.statusNotDownloaded]}
                      >
                        <Text style={styles.statusNotDownloadedText}>
                          ☁️ Free HuggingFace Model
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Dynamic Action Area for Selected Model */}
            <View style={styles.llmActionArea}>
              {isSelectedDownloading ? (
                <View style={styles.progressContainer}>
                  <View style={styles.progressHeaderRow}>
                    <ActivityIndicator
                      size="small"
                      color="#6366F1"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.progressTitle}>
                      Downloading {selectedModel.name}... (
                      {downloadProgress?.percentage ?? 0}%)
                    </Text>
                  </View>
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.max(3, downloadProgress?.percentage ?? 0)}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressStats}>
                    {downloadProgress?.downloadedBytes != null
                      ? `${(downloadProgress.downloadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(downloadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB`
                      : 'Starting streaming download...'}
                  </Text>
                </View>
              ) : isSelectedActive ? (
                <View style={styles.activeModelRow}>
                  <View style={styles.activeNotice}>
                    <Text style={styles.activeNoticeText}>
                      🟢 Ready for live card inference
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.unloadBtn}
                    onPress={handleUnloadModel}
                  >
                    <Text style={styles.unloadBtnText}>⏹️ Unload from RAM</Text>
                  </TouchableOpacity>
                </View>
              ) : isSelectedDownloaded ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[
                      styles.primaryActionBtn,
                      slmLoading && styles.btnDisabled,
                    ]}
                    onPress={() => handleLoadModel(selectedModelIdx)}
                    disabled={slmLoading}
                  >
                    {slmLoading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryActionBtnText}>
                        🚀 Load {selectedModel.name.split(' ')[0]} into RAM
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reDownloadBtn}
                    onPress={() => handleDownloadModel(selectedModelIdx)}
                  >
                    <Text style={styles.reDownloadBtnText}>⬇️</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.primaryActionBtn}
                  onPress={() => handleDownloadModel(selectedModelIdx)}
                >
                  <Text style={styles.primaryActionBtnText}>
                    ⬇️ Download {selectedModel.name.split(' ')[0]} (
                    {selectedModel.sizeMB} MB) — Free
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Primary Singular Scanner Section */}
        <View style={styles.scannerHeroCard}>
          <TouchableOpacity
            style={[styles.scanHeroBtn, loading && styles.btnDisabled]}
            onPress={handleLaunchScanner}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="large" />
            ) : (
              <View style={styles.scanHeroContent}>
                <Text style={styles.scanHeroIcon}>📷</Text>
                <Text style={styles.scanHeroTitle}>Scan Card or Document</Text>
                <Text style={styles.scanHeroSubtitle}>
                  CameraX Live Outline Detection • Real-time Auto-Crop • Offline
                  ML Kit
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* File Picker Option (Images & Multi-page PDFs) */}
          <TouchableOpacity
            style={[styles.pickHeroBtn, loading && styles.btnDisabled]}
            onPress={handlePickDocument}
            disabled={loading}
          >
            <View style={styles.pickHeroContent}>
              <Text style={styles.pickHeroIcon}>📂</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.pickHeroTitle}>
                  Import from Storage (Image / Multi-Page PDF)
                </Text>
                <Text style={styles.pickHeroSubtitle}>
                  Select card image or multi-page PDF • Instant native page
                  rendering
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Multi-Page PDF Navigation Bar */}
          {scannedImageUris.length > 1 && (
            <View style={styles.multiPageBar}>
              <Text style={styles.multiPageLabel}>
                📑 Imported PDF Pages ({scannedImageUris.length} total):
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 6 }}
              >
                {scannedImageUris.map((uri, pIdx) => (
                  <TouchableOpacity
                    key={pIdx}
                    style={[
                      styles.multiPageChip,
                      selectedPageIndex === pIdx && styles.multiPageChipActive,
                    ]}
                    onPress={() => {
                      setSelectedPageIndex(pIdx);
                      setScannedImageUri(uri);
                      setStatusMessage(`Viewing Page ${pIdx + 1}`);
                    }}
                  >
                    <Text
                      style={[
                        styles.multiPageChipText,
                        selectedPageIndex === pIdx &&
                          styles.multiPageChipTextActive,
                      ]}
                    >
                      {pIdx === 0
                        ? '📄 Page 1 (Front)'
                        : pIdx === 1
                          ? '📄 Page 2 (Back)'
                          : `📄 Page ${pIdx + 1}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Page Limit Selector */}
          <View style={styles.pageLimitRow}>
            <Text style={styles.pageLimitLabel}>Camera Pages:</Text>
            {[
              { label: '1 Page', value: 1 },
              { label: '2 Pages (Front & Back)', value: 2 },
              { label: '5 Pages (Multi)', value: 5 },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.pageChip,
                  pageLimit === opt.value && styles.pageChipActive,
                ]}
                onPress={() => setPageLimit(opt.value)}
              >
                <Text
                  style={[
                    styles.pageChipText,
                    pageLimit === opt.value && styles.pageChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quick Realistic Samples Row */}
          <View style={styles.sampleSection}>
            <Text style={styles.sampleSectionLabel}>
              Or test with sample documents:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.sampleScroll}
            >
              {SAMPLE_DOCUMENTS.map((sample, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.sampleChip}
                  onPress={() => handleLoadSample(sample)}
                >
                  <Text style={styles.sampleChipTitle}>{sample.title}</Text>
                  <Text style={styles.sampleChipSub}>{sample.subtitle}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {/* Status Message & Error Banner */}
        {statusMessage && (
          <View style={styles.statusBox}>
            <Text style={styles.statusBoxText}>{statusMessage}</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxText}>⚠️ {error}</Text>
          </View>
        )}

        {/* Thumbnail Preview if Scanned */}
        {scannedImageUri && (
          <View style={styles.thumbnailBox}>
            <Image
              source={{ uri: scannedImageUri }}
              style={styles.thumbnailImage}
              resizeMode="cover"
            />
            <View style={styles.thumbnailInfo}>
              <Text style={styles.thumbnailTitle}>
                Scanned Image (Perspective Corrected)
              </Text>
              <Text style={styles.thumbnailSub}>
                {scannedImageUris.length > 1
                  ? `${scannedImageUris.length} pages captured`
                  : '1 page captured'}
              </Text>
            </View>
          </View>
        )}

        {/* Detection Result Card */}
        {currentViewType && (businessCard || billDocument) && (
          <View style={styles.resultContainer}>
            {/* Auto-Detection Banner with Manual Toggle */}
            <View style={styles.detectionBanner}>
              <View style={styles.detectionBadge}>
                <Text style={styles.detectionBadgeText}>
                  {currentViewType === 'card'
                    ? '🏷️ AUTO-DETECTED: BUSINESS CARD'
                    : '🧾 AUTO-DETECTED: BILL / INVOICE'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.switchViewBtn}
                onPress={() =>
                  setForceViewType(currentViewType === 'card' ? 'bill' : 'card')
                }
              >
                <Text style={styles.switchViewBtnText}>
                  🔄 View as {currentViewType === 'card' ? 'Bill' : 'Card'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* View 1: Business Card Representation */}
            {currentViewType === 'card' && businessCard && (
              <View style={styles.cardViewBox}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.companyNameText}>
                    {safeText(businessCard.companyName) || 'Business Card'}
                  </Text>
                  {businessCard.confidence !== undefined && (
                    <View
                      style={[
                        styles.confidencePill,
                        businessCard.confidence >= 0.8
                          ? styles.confidenceHigh
                          : businessCard.confidence >= 0.65
                            ? styles.confidenceMed
                            : styles.confidenceLow,
                      ]}
                    >
                      <Text style={styles.confidencePillText}>
                        {businessCard.confidence >= 0.8
                          ? '● High'
                          : businessCard.confidence >= 0.65
                            ? '● Med'
                            : '● Low'}{' '}
                        {Math.round(businessCard.confidence * 100)}%
                      </Text>
                    </View>
                  )}
                </View>

                {businessCard.requiresSlmReasoning && (
                  <TouchableOpacity
                    style={styles.slmPromptBanner}
                    onPress={handleRefineWithThinking}
                    disabled={thinkingLoading}
                  >
                    <Text style={styles.slmPromptBannerText}>
                      ⚡ Ambiguous layout detected (
                      {Math.round(businessCard.confidence! * 100)}% confidence).
                      Tap for Local AI Reasoning.
                    </Text>
                  </TouchableOpacity>
                )}

                {businessCard.tagline ? (
                  <Text style={styles.taglineText}>
                    "{safeText(businessCard.tagline)}"
                  </Text>
                ) : null}

                {businessCard.slogan ? (
                  <Text style={styles.sloganText}>
                    💭 "{safeText(businessCard.slogan)}"
                  </Text>
                ) : null}

                {/* Contact Persons */}
                {businessCard.contactPersons &&
                  businessCard.contactPersons.length > 0 && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionLabel}>
                        👤 CONTACT PERSONS
                      </Text>
                      {businessCard.contactPersons.map((p, idx) => (
                        <Text key={idx} style={styles.personRowText}>
                          • {safeText(p.name)}{' '}
                          {p.role ? `(${safeText(p.role)})` : ''}
                        </Text>
                      ))}
                    </View>
                  )}

                {/* Phones */}
                {((businessCard.labeledPhones &&
                  businessCard.labeledPhones.length > 0) ||
                  businessCard.phoneNumbers.length > 0) && (
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionLabel}>
                      📞 PHONE NUMBERS
                    </Text>
                    <View style={styles.chipRow}>
                      {businessCard.labeledPhones &&
                      businessCard.labeledPhones.length > 0
                        ? businessCard.labeledPhones.map((lp, idx) => (
                            <View key={idx} style={styles.phoneChip}>
                              <Text style={styles.phoneChipText}>
                                {lp.label ? `[${safeText(lp.label)}] ` : ''}
                                {safeText(lp.number)}
                              </Text>
                            </View>
                          ))
                        : businessCard.phoneNumbers.map((phone, idx) => (
                            <View key={idx} style={styles.phoneChip}>
                              <Text style={styles.phoneChipText}>
                                {safeText(phone)}
                              </Text>
                            </View>
                          ))}
                    </View>
                  </View>
                )}

                {/* Email & Web */}
                {((businessCard.emails && businessCard.emails.length > 0) ||
                  (businessCard.websites &&
                    businessCard.websites.length > 0)) && (
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionLabel}>
                      🌐 DIGITAL CONTACTS
                    </Text>
                    <View style={styles.chipRow}>
                      {businessCard.emails?.map((em, idx) => (
                        <View key={`em-${idx}`} style={styles.digitalChip}>
                          <Text style={styles.digitalChipText}>
                            ✉️ {safeText(em)}
                          </Text>
                        </View>
                      ))}
                      {businessCard.websites?.map((w, idx) => (
                        <View key={`w-${idx}`} style={styles.digitalChip}>
                          <Text style={styles.digitalChipText}>
                            🌐 {safeText(w)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Addresses */}
                {businessCard.addressLines &&
                  businessCard.addressLines.length > 0 && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionLabel}>📍 ADDRESS</Text>
                      {businessCard.addressLines.map((addr, idx) => (
                        <Text key={idx} style={styles.addressText}>
                          • {safeText(addr)}
                        </Text>
                      ))}
                    </View>
                  )}

                {/* Pincode & GSTIN */}
                {(businessCard.pincode || businessCard.gstin) && (
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionLabel}>🏷️ IDENTIFIERS</Text>
                    <View style={styles.chipRow}>
                      {businessCard.pincode ? (
                        <View style={styles.idChip}>
                          <Text style={styles.idChipText}>
                            PIN: {safeText(businessCard.pincode)}
                          </Text>
                        </View>
                      ) : null}
                      {businessCard.gstin ? (
                        <View style={styles.idChip}>
                          <Text style={styles.idChipText}>
                            GSTIN: {safeText(businessCard.gstin)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}

                {/* Provided Services & Products */}
                {businessCard.providedServices &&
                  businessCard.providedServices.length > 0 && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionLabel}>
                        📦 PRODUCTS & SERVICES
                      </Text>
                      <View style={styles.chipRow}>
                        {businessCard.providedServices.map((srv, idx) => (
                          <View
                            key={idx}
                            style={[
                              styles.idChip,
                              { backgroundColor: '#1E3A8A' },
                            ]}
                          >
                            <Text
                              style={[styles.idChipText, { color: '#93C5FD' }]}
                            >
                              {safeText(srv)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                {/* Unified Hybrid AI Extraction Button */}
                <TouchableOpacity
                  style={[
                    styles.refineBtn,
                    {
                      backgroundColor: '#6366F1',
                      marginTop: 14,
                      marginBottom: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    },
                    thinkingLoading && styles.btnDisabled,
                  ]}
                  onPress={handleRefineWithThinking}
                  disabled={thinkingLoading}
                >
                  {thinkingLoading ? (
                    <>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={styles.refineBtnText}>
                        Refining with{' '}
                        {activeModelObj
                          ? activeModelObj.name.split(' ')[0]
                          : 'Hybrid AI'}
                        ...
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.refineBtnText}>
                      ⚡ Scan & Refine with Hybrid AI (
                      {activeModelObj
                        ? activeModelObj.name.split(' ')[0]
                        : 'Deterministic + Semantic'}
                      )
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Hybrid Extraction Breakdown Banner */}
                {isHybridActive && hybridResult && (
                  <View style={styles.hybridBox}>
                    <View style={styles.hybridBoxHeader}>
                      <Text style={styles.hybridBoxTitle}>
                        ⚡ Deterministic Extraction Engine
                      </Text>
                      <View style={styles.zeroErrorTag}>
                        <Text style={styles.zeroErrorTagText}>
                          0% Hallucination Guarantee
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.hybridItem}>
                      📱 Mobiles:{' '}
                      {hybridResult.mobiles.length > 0
                        ? hybridResult.mobiles.join(', ')
                        : 'None'}
                    </Text>
                    <Text style={styles.hybridItem}>
                      ☎️ Landlines (STD):{' '}
                      {hybridResult.landlines.length > 0
                        ? hybridResult.landlines.join(', ')
                        : 'None'}
                    </Text>
                    <Text style={styles.hybridItem}>
                      🏛️ GSTIN:{' '}
                      {hybridResult.gstin
                        ? `${hybridResult.gstin} (Modulo-36 Valid)`
                        : 'None'}
                    </Text>
                    <Text style={styles.hybridItem}>
                      📮 Pincodes:{' '}
                      {hybridResult.pincodes.length > 0
                        ? hybridResult.pincodes.join(', ')
                        : 'None'}
                    </Text>

                    <TouchableOpacity
                      style={styles.residualToggle}
                      onPress={() => setShowResidualModal(!showResidualModal)}
                    >
                      <Text style={styles.residualToggleText}>
                        {showResidualModal
                          ? '▲ Hide SLM Residual Text'
                          : '▼ Inspect Residual Text (Input to SLM)'}
                      </Text>
                    </TouchableOpacity>

                    {showResidualModal && (
                      <View style={styles.residualContainer}>
                        <Text style={styles.residualPromptExplain}>
                          The deterministic engine blacks out extracted numbers
                          and GSTIN below before feeding into the SLM so the
                          neural model cannot hallucinate contact numbers:
                        </Text>
                        <ScrollView
                          style={styles.residualScroll}
                          nestedScrollEnabled
                        >
                          <Text style={styles.residualCodeText} selectable>
                            {hybridResult.residualText}
                          </Text>
                        </ScrollView>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* View 2: Bill / Invoice Representation */}
            {currentViewType === 'bill' && billDocument && (
              <View style={styles.billViewBox}>
                <View style={styles.billHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.merchantNameText}>
                      {safeText(billDocument.issuerName) || 'Invoice / Bill'}
                    </Text>
                    {billDocument.invoiceNumber ? (
                      <Text style={styles.sampleChipSub}>
                        Invoice #{billDocument.invoiceNumber}
                        {billDocument.invoiceDate
                          ? ` • ${billDocument.invoiceDate}`
                          : ''}
                      </Text>
                    ) : null}
                  </View>
                  {billDocument.amountDue != null && (
                    <Text style={styles.totalAmountText}>
                      ${Number(billDocument.amountDue).toFixed(2)}
                    </Text>
                  )}
                </View>

                {/* Line Items Table */}
                <View style={styles.tableCard}>
                  <Text style={styles.tableTitle}>
                    RECONSTRUCTED LINE ITEMS
                  </Text>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.th, { flex: 3.5 }]}>DESCRIPTION</Text>
                    <Text
                      style={[styles.th, { flex: 1.5, textAlign: 'center' }]}
                    >
                      CODE
                    </Text>
                    <Text style={[styles.th, { flex: 2, textAlign: 'right' }]}>
                      AMOUNT
                    </Text>
                  </View>

                  {billDocument.lineItems &&
                  billDocument.lineItems.length > 0 ? (
                    billDocument.lineItems.map((item, idx) => (
                      <View key={idx} style={styles.tableDataRow}>
                        <Text style={[styles.td, { flex: 3.5 }]}>
                          {safeText(item.description)}
                        </Text>
                        <Text
                          style={[
                            styles.td,
                            { flex: 1.5, textAlign: 'center' },
                          ]}
                        >
                          {item.code || '—'}
                        </Text>
                        <Text
                          style={[
                            styles.tdBold,
                            { flex: 2, textAlign: 'right' },
                          ]}
                        >
                          $
                          {Number(
                            item.billedAmount ?? item.patientResponsibility ?? 0
                          ).toFixed(2)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyTableText}>
                      No line items recognized.
                    </Text>
                  )}

                  {/* Financial Summary */}
                  <View style={styles.tableFooter}>
                    {billDocument.subtotal != null && (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Subtotal</Text>
                        <Text style={styles.summaryVal}>
                          ${Number(billDocument.subtotal).toFixed(2)}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.summaryRow, styles.grandTotalRow]}>
                      <Text style={styles.grandTotalLabel}>
                        TOTAL AMOUNT DUE
                      </Text>
                      <Text style={styles.grandTotalVal}>
                        $
                        {Number(
                          billDocument.amountDue ?? billDocument.subtotal ?? 0
                        ).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* Expandable Raw OCR Text */}
            <TouchableOpacity
              style={styles.ocrAccordionHeader}
              onPress={() => setShowRawOcr(!showRawOcr)}
            >
              <Text style={styles.ocrAccordionTitle}>
                {showRawOcr ? '▼ Hide Raw OCR Text' : '▶ View Raw OCR Text'}
              </Text>
            </TouchableOpacity>

            {showRawOcr && ocrResult && (
              <View style={styles.rawOcrBox}>
                <Text style={styles.rawOcrContent}>{ocrResult.rawText}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Stylesheet ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 24,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  llmHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2340',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  llmHeaderPillActive: {
    backgroundColor: '#064E3B44',
    borderColor: '#059669',
  },
  llmHeaderPillDot: {
    fontSize: 10,
    marginRight: 6,
  },
  llmHeaderPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },

  // LLM Manager Card
  llmManagerCard: {
    backgroundColor: '#13182E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  llmManagerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  llmManagerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  llmManagerSubtitle: {
    fontSize: 11,
    color: '#A5B4FC',
    marginTop: 2,
  },
  llmCloseBtn: {
    padding: 4,
  },
  llmCloseBtnText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '700',
  },
  modelCard: {
    backgroundColor: '#0F1326',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  modelCardSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#171D3D',
  },
  modelCardActive: {
    borderColor: '#10B981',
  },
  modelHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modelRadio: {
    fontSize: 14,
    color: '#6B7280',
    marginRight: 8,
  },
  modelRadioActive: {
    color: '#6366F1',
  },
  modelNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  modelTagBadge: {
    backgroundColor: '#1E2548',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modelTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A5B4FC',
  },
  modelDescText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    marginLeft: 22,
  },
  modelStatusRow: {
    marginTop: 8,
    marginLeft: 22,
    flexDirection: 'row',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: '#064E3B',
  },
  statusActiveText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
  },
  statusDownloading: {
    backgroundColor: '#312E81',
  },
  statusDownloadingText: {
    color: '#A5B4FC',
    fontSize: 10,
    fontWeight: '700',
  },
  statusDownloaded: {
    backgroundColor: '#1E3A8A',
  },
  statusDownloadedText: {
    color: '#93C5FD',
    fontSize: 10,
    fontWeight: '700',
  },
  statusNotDownloaded: {
    backgroundColor: '#1E2340',
  },
  statusNotDownloadedText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },

  // LLM Action Area
  llmActionArea: {
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryActionBtn: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  reDownloadBtn: {
    backgroundColor: '#1E2340',
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  reDownloadBtnText: {
    fontSize: 14,
  },
  activeModelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  activeNotice: {
    flex: 1,
  },
  activeNoticeText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '600',
  },
  unloadBtn: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  unloadBtnText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  progressContainer: {
    backgroundColor: '#0B0D17',
    padding: 12,
    borderRadius: 8,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1E2340',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366F1',
  },
  progressStats: {
    color: '#94A3B8',
    fontSize: 10,
  },

  // Scanner Hero Card
  scannerHeroCard: {
    backgroundColor: '#13182E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  scanHeroBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanHeroContent: {
    alignItems: 'center',
  },
  scanHeroIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  scanHeroTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  scanHeroSubtitle: {
    color: '#E0E7FF',
    fontSize: 11,
    marginTop: 3,
    textAlign: 'center',
  },
  pageLimitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  pageLimitLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 8,
  },
  pageChip: {
    backgroundColor: '#1E2340',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
  },
  pageChipActive: {
    backgroundColor: '#3730A3',
  },
  pageChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  pageChipTextActive: {
    color: '#FFFFFF',
  },
  sampleSection: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E2340',
    paddingTop: 12,
  },
  sampleSectionLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
  },
  sampleScroll: {
    flexDirection: 'row',
  },
  sampleChip: {
    backgroundColor: '#1E2340',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sampleChipTitle: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
  },
  sampleChipSub: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },

  // Status & Error Boxes
  statusBox: {
    backgroundColor: '#064E3B33',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  statusBoxText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#7F1D1D33',
    borderColor: '#DC2626',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  errorBoxText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
  },

  // Thumbnail
  thumbnailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#13182E',
    borderRadius: 10,
    padding: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  thumbnailImage: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 10,
  },
  thumbnailInfo: {
    flex: 1,
  },
  thumbnailTitle: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
  },
  thumbnailSub: {
    color: '#94A3B8',
    fontSize: 11,
  },

  // Result Section
  resultContainer: {
    marginBottom: 20,
  },
  detectionBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E2340',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  detectionBadge: {
    backgroundColor: '#3730A3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  detectionBadgeText: {
    color: '#E0E7FF',
    fontSize: 11,
    fontWeight: '800',
  },
  switchViewBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  switchViewBtnText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },

  // Card View
  cardViewBox: {
    backgroundColor: '#13182E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  confidencePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  confidenceHigh: {
    backgroundColor: '#064E3B',
  },
  confidenceMed: {
    backgroundColor: '#78350F',
  },
  confidenceLow: {
    backgroundColor: '#7F1D1D',
  },
  confidencePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  slmPromptBanner: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  slmPromptBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#38BDF8',
  },
  companyNameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  taglineText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#94A3B8',
    marginTop: 2,
  },
  sloganText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#FCD34D',
    marginTop: 4,
  },
  fieldSection: {
    marginTop: 14,
  },
  fieldSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  personRowText: {
    color: '#F1F5F9',
    fontSize: 13,
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  phoneChip: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  phoneChipText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  digitalChip: {
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  digitalChipText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
  },
  addressText: {
    color: '#CBD5E1',
    fontSize: 12,
    marginBottom: 3,
  },
  idChip: {
    backgroundColor: '#312E81',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  idChipText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '700',
  },
  refineBtn: {
    backgroundColor: '#7C3AED',
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  refineBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Bill View
  billViewBox: {
    backgroundColor: '#13182E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  billHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  merchantNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
  },
  totalAmountText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#34D399',
  },
  tableCard: {
    backgroundColor: '#0F1326',
    borderRadius: 10,
    padding: 12,
  },
  tableTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2340',
    paddingBottom: 6,
    marginBottom: 6,
  },
  th: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
  },
  tableDataRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    alignItems: 'center',
  },
  td: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  tdBold: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  emptyTableText: {
    color: '#64748B',
    fontSize: 11,
    paddingVertical: 8,
    textAlign: 'center',
  },
  tableFooter: {
    borderTopWidth: 1,
    borderTopColor: '#1E2340',
    marginTop: 8,
    paddingTop: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#94A3B8',
  },
  summaryVal: {
    fontSize: 11,
    color: '#E2E8F0',
  },
  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    marginTop: 4,
    paddingTop: 4,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  grandTotalVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#34D399',
  },

  // Accordion
  ocrAccordionHeader: {
    backgroundColor: '#13182E',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#242B46',
  },
  ocrAccordionTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  rawOcrBox: {
    backgroundColor: '#0F1326',
    borderRadius: 8,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#1E2340',
  },
  rawOcrContent: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
  },

  // PaddleOCR Multilingual Studio Styles
  paddleHeaderPillActive: {
    backgroundColor: '#0284C722',
    borderColor: '#0284C7',
  },
  paddleManagerCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#0284C7',
  },
  paddleManagerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#38BDF8',
  },
  paddleStatusCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  paddleStatusRow: {
    marginBottom: 6,
  },
  paddleStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  paddleStatusSub: {
    fontSize: 11,
  },
  paddleLatencyTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  paddleConsoleSubtitle: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 3,
  },
  paddleFieldsBox: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  paddleFieldsHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paddleFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  paddleFieldKey: {
    width: 80,
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  paddleFieldVal: {
    flex: 1,
    fontSize: 11,
    color: '#F8FAFC',
    fontWeight: '600',
  },
  paddlePhoneBadge: {
    backgroundColor: '#064E3B',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#059669',
  },
  paddlePhoneText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '700',
  },
  paddleRawConsoleBox: {
    backgroundColor: '#030712',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
  },
  paddleRawConsoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  paddleRawConsoleTitle: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '700',
  },
  paddleMiniToggleBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  paddleMiniToggleText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '700',
  },
  paddleRawScrollView: {
    maxHeight: 140,
  },
  paddleRawTextStream: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#38BDF8',
    lineHeight: 16,
  },

  /* Storage File Picker Hero Button */
  pickHeroBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    padding: 14,
    marginTop: 10,
  },
  pickHeroContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickHeroIcon: {
    fontSize: 26,
  },
  pickHeroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.3,
  },
  pickHeroSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },

  /* Multi-Page PDF Navigation Bar */
  multiPageBar: {
    backgroundColor: '#082F49',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0284C7',
    padding: 10,
    marginTop: 12,
  },
  multiPageLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7DD3FC',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  multiPageChip: {
    backgroundColor: '#0C4A6E',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#0369A1',
  },
  multiPageChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  multiPageChipText: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '600',
  },
  multiPageChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  /* Quick Import Button inside PaddleOCR Studio */
  paddleImportBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paddleImportBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },

  btnDisabled: {
    opacity: 0.6,
  },
  hybridBox: {
    backgroundColor: '#064E3B22',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  hybridBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  hybridBoxTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  zeroErrorTag: {
    backgroundColor: '#064E3B',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  zeroErrorTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6EE7B7',
  },
  hybridItem: {
    fontSize: 11,
    color: '#E2E8F0',
    marginBottom: 4,
    fontWeight: '500',
  },
  residualToggle: {
    marginTop: 8,
    paddingVertical: 4,
  },
  residualToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5EEAD4',
  },
  residualContainer: {
    marginTop: 6,
    backgroundColor: '#020617',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 8,
  },
  residualPromptExplain: {
    fontSize: 10,
    color: '#94A3B8',
    marginBottom: 6,
    lineHeight: 14,
  },
  residualScroll: {
    maxHeight: 110,
  },
  residualCodeText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#CBD5E1',
    lineHeight: 14,
  },
});
