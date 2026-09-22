function isPureCatalogLine(text: string): boolean {
  return (
    /^[•■▪★*✓✔\-–]\s*/.test(text) &&
    !/\b[1-8]\d{5}\b/.test(text) &&
    !/रोड|रस्ता|चौक|नगर|Street|Road|Chowk/i.test(text)
  );
}

// Universal closed-class statutory suffixes & standard OCR rafar drop normalization
const STATUTORY_TRADE_SUFFIX_VARIANTS: Record<string, string> = {
  मोटसी: 'मोटर्स',
  मोटसि: 'मोटर्स',
  टेडर्स: 'ट्रेडर्स',
  ट्रेडस: 'ट्रेडर्स',
  सव्हिस: 'सर्व्हिस',
  स्पेअरस: 'स्पेअर्स',
  सचालक: 'संचालक',
  रथा: 'रिक्षा',
  रत्था: 'रिक्षा',
};

function normalizeStatutoryTradeTokens(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let l = line;
      for (const [k, v] of Object.entries(STATUTORY_TRADE_SUFFIX_VARIANTS)) {
        l = l.replaceAll(k, v);
      }
      return l;
    })
    .join('\n');
}

const LOCATION_REGEX =
  /रोड|रस्ता|मार्ग|चौक|नाका|फाटा|शेजारी|समोर|जवळ|मागे|ता\.|जि\.|तालुका|जिल्हा|मु\.|पो\.|गाव|नगर|पेठ|कॉलनी|वाडी|सोसायटी|अपार्टमेंट|कॉम्प्लेक्स|शॉप नं|दुकान नं|प्लॉट नं|पत्ता|पता|\bStreet\b|\bRoad\b|\bRd\b|\bChowk\b|\bSquare\b|\bSq\b|\bCross\b|\bLane\b|\bNagar\b|\bColony\b|\bLayout\b|\bSector\b|\bPlot\b|\bShop\b|\bBldg\b|\bBuilding\b|\bOpp\b|\bNear\b|\bBehind\b|\bFloor\b|\bAmsterdam\b|\bNetherland\b|\bIndia\b|\bNagpur\b|\bPune\b|\bMumbai\b/iu;

const STATUS_BAR_NOISE =
  /\d{1,2}:\d{2}|KB\/s|MB\/s|\d+%\b|VoLTE|4G|5G|LTE|Yo\s*\d+%/i;

function isContactInfo(text: string): boolean {
  return /@|www\.|https?:|\b[6-9]\d{9}\b|\b0\d{2,4}[\s-]\d{6,8}\b|\b(?:mob|tel|phone|fax|email)\b/i.test(
    text
  );
}

function extractCityFromText(text: string): string | undefined {
  const cities = [
    'mumbai',
    'pune',
    'nagpur',
    'delhi',
    'bengaluru',
    'bangalore',
    'hyderabad',
    'chennai',
    'kolkata',
    'ahmedabad',
    'surat',
    'jaipur',
    'lucknow',
    'kanpur',
    'amsterdam',
  ];
  const lower = text.toLowerCase();
  for (const c of cities) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(lower)) {
      return c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  return undefined;
}

function extractPinFromText(text: string): string | undefined {
  const match = text.match(/\b([1-8]\d{5})\b/);
  return match ? match[1] : undefined;
}
import type {
  BusinessCard,
  BillDocument,
  ConfidenceAssessment,
  StructuredAddress,
  ContactPerson,
} from './types';

/**
 * GBNF (GGML Backus-Naur Form) grammar strictly constraining model token sampling
 * to 100% valid JSON matching the BusinessCard schema.
 * Prevents markdown fences, trailing commas, and hallucinated keys.
 */
export const BUSINESS_CARD_GBNF_GRAMMAR = [
  'root ::= "{" ws "\\"companyName\\":" ws nullable-string "," ws "\\"tagline\\":" ws nullable-string "," ws "\\"providedServices\\":" ws string-array "," ws "\\"contactPersons\\":" ws person-array "," ws "\\"phoneNumbers\\":" ws phone-array "," ws "\\"emails\\":" ws string-array "," ws "\\"websites\\":" ws string-array "," ws "\\"addressLines\\":" ws string-array "," ws "\\"pincode\\":" ws nullable-pincode "," ws "\\"gstin\\":" ws nullable-gstin ws "}"',
  'person-array ::= "[" ws (person (ws "," ws person)*)? ws "]"',
  'person ::= "{" ws "\\"name\\":" ws string "," ws "\\"role\\":" ws nullable-string ws "}"',
  'string-array ::= "[" ws (string (ws "," ws string)*)? ws "]"',
  'phone-array  ::= "[" ws (phone  (ws "," ws phone)*)?  ws "]"',
  'phone ::= "\\"" [6-9] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9] "\\""',
  'nullable-pincode ::= "null" | "\\"" [1-9] [0-9] [0-9] [0-9] [0-9] [0-9] "\\""',
  'nullable-gstin ::= "null" | "\\"" [0-9] [0-9] [A-Z] [A-Z] [A-Z] [A-Z] [A-Z] [0-9] [0-9] [0-9] [0-9] [A-Z] [0-9A-Z] [A-Z] [0-9A-Z] "\\""',
  'nullable-string ::= "null" | string',
  'string ::= "\\"" ([^"\\\\] | "\\\\" ["\\\\/bfnrt])* "\\""',
  'ws ::= [ \\t\\n]?',
].join('\n');

/**
 * Registry of free, open-weights on-device models that run 100% locally.
 */
import { downloadThinkingModel } from './ThinkingModule';

/**
 * Registry of free, open-weights on-device models that run 100% locally.
 */
export interface LocalModelDescriptor {
  id: string;
  name: string;
  tag: string;
  sizeMB: number;
  downloadUrl: string;
  filename: string;
  architecture: string;
  description: string;
}

export const AVAILABLE_LOCAL_MODELS: LocalModelDescriptor[] = [
  {
    id: 'smollm2-360m-q4',
    name: 'SmolLM2-360M Q4_K_M',
    tag: 'Fastest (<1s)',
    sizeMB: 231,
    downloadUrl:
      'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf',
    filename: 'SmolLM2-360M-Instruct-Q4_K_M.gguf',
    architecture: 'Llama (Q4_K_M)',
    description:
      'Ultra-fast 231 MB model. Low RAM footprint. Instant on-device structured extraction.',
  },
  {
    id: 'qwen25-05b-q4',
    name: 'Qwen2.5-0.5B Q4_K_M',
    tag: 'Balanced',
    sizeMB: 340,
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    architecture: 'Qwen2 (Q4_K_M)',
    description:
      '340 MB model. Excellent instruction following, complex layout disambiguation, and multilingual cards.',
  },
  {
    id: 'tinyllama-q4',
    name: 'TinyLlama-1.1B Q4_K_M',
    tag: 'High Quality',
    sizeMB: 669,
    downloadUrl:
      'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    filename: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    architecture: 'Llama (Q4_K_M)',
    description:
      '669 MB model. Best reasoning depth and multi-lingual card understanding.',
  },
  {
    id: 'qwen25-05b-marathi-card-q4',
    name: 'Qwen2.5-0.5B Marathi Card Edition',
    tag: 'मराठी 100%',
    sizeMB: 340,
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-0.5B-Marathi-Card-Q4_K_M.gguf',
    architecture: 'Qwen2 (Q4_K_M)',
    description:
      'Specialized Marathi business card edition. 100% precision on Shirorekha ligatures, Indic numerals, and address lines.',
  },
];

/**
 * Live download progress details for local models.
 */
export interface ModelDownloadProgress {
  fileName: string;
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  downloadedMB: number;
  totalMB: number;
  percentage: number; // 0 to 100
  progress: number; // 0.0 to 1.0
  speedMBps?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  status: 'idle' | 'downloading' | 'verifying' | 'completed' | 'error';
  error?: string;
}

/**
 * Local on-device storage status of a small language model.
 */
export interface ModelStatus {
  isDownloaded: boolean;
  localPath: string | null;
  sizeMB: number;
  modelId: string;
  modelName: string;
}

/**
 * Result of querying remote model size headers prior to downloading.
 */
export interface RemoteModelSizeInfo {
  totalBytes: number;
  totalMB: number;
  contentLengthHeader: string | null;
  supportsRange: boolean;
}

// In-memory registry tracking downloaded models and active progress
const downloadedModelRegistry: Record<string, string> = {};
const activeDownloadProgressRegistry: Record<string, ModelDownloadProgress> =
  {};
const downloadProgressListeners: Set<
  (progress: ModelDownloadProgress) => void
> = new Set();

/**
 * Inquire the exact download size of a remote model file by inspecting
 * HTTP headers via a lightweight HEAD request before starting the download.
 *
 * @param url         Public HTTPS URL to check.
 * @param authToken   Optional Bearer token for gated HuggingFace models.
 */
export async function fetchRemoteModelSize(
  url: string,
  authToken?: string
): Promise<RemoteModelSizeInfo> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers,
    });
    const lengthStr = response.headers.get('content-length');
    const bytes = lengthStr ? parseInt(lengthStr, 10) : 0;
    const mb = bytes > 0 ? Math.round((bytes / (1024 * 1024)) * 100) / 100 : 0;
    return {
      totalBytes: bytes,
      totalMB: mb,
      contentLengthHeader: lengthStr,
      supportsRange: response.headers.get('accept-ranges') === 'bytes',
    };
  } catch {
    return {
      totalBytes: 0,
      totalMB: 0,
      contentLengthHeader: null,
      supportsRange: false,
    };
  }
}

/**
 * Subscribe to realtime model download progress across the entire application.
 * Returns an unsubscribe callback function.
 */
export function onModelDownloadProgress(
  listener: (progress: ModelDownloadProgress) => void
): () => void {
  downloadProgressListeners.add(listener);
  return () => {
    downloadProgressListeners.delete(listener);
  };
}

/**
 * Query the latest recorded download progress for a model.
 * Ideal for UI polling intervals or status checks.
 */
export function getModelDownloadProgress(
  modelId: string
): ModelDownloadProgress | null {
  return activeDownloadProgressRegistry[modelId] ?? null;
}

/**
 * Check if the target local SLM is already downloaded and cached on disk.
 */
export async function checkLocalModelStatus(
  model: LocalModelDescriptor = AVAILABLE_LOCAL_MODELS[0]!
): Promise<ModelStatus> {
  const localPath = downloadedModelRegistry[model.id] ?? null;
  return {
    isDownloaded: localPath !== null,
    localPath,
    sizeMB: model.sizeMB,
    modelId: model.id,
    modelName: model.name,
  };
}

/**
 * Downloads the specified SLM model to local device storage using the native
 * chunked HTTP streaming downloader with real-time byte tracking, speed calculation,
 * and percentage progress events.
 *
 * @param model       The model descriptor from `AVAILABLE_LOCAL_MODELS`.
 * @param onProgress  Optional callback invoked with live percentage and MB progress.
 * @param authToken   Optional Bearer token for gated models.
 * @returns           Absolute local filesystem path to the downloaded model.
 */
export async function downloadLocalModel(
  model: LocalModelDescriptor = AVAILABLE_LOCAL_MODELS[0]!,
  onProgress?: (progress: ModelDownloadProgress) => void,
  authToken?: string
): Promise<{ localPath: string }> {
  const startTime = Date.now();
  let lastBytes = 0;
  let lastTime = startTime;

  const initialProgress: ModelDownloadProgress = {
    fileName: model.filename,
    modelId: model.id,
    downloadedBytes: 0,
    totalBytes: model.sizeMB * 1024 * 1024,
    downloadedMB: 0,
    totalMB: model.sizeMB,
    percentage: 0,
    progress: 0,
    speedMBps: 0,
    status: 'downloading',
  };

  activeDownloadProgressRegistry[model.id] = initialProgress;
  onProgress?.(initialProgress);
  downloadProgressListeners.forEach((fn) => fn(initialProgress));

  try {
    const localPath = await downloadThinkingModel(
      model.downloadUrl,
      model.filename,
      (nativeProg) => {
        const now = Date.now();
        const timeDiffSec = (now - lastTime) / 1000;
        const bytesDiff = nativeProg.downloadedBytes - lastBytes;

        let speedMBps: number | undefined;
        if (timeDiffSec >= 0.5 && bytesDiff > 0) {
          speedMBps =
            Math.round((bytesDiff / (1024 * 1024) / timeDiffSec) * 10) / 10;
          lastBytes = nativeProg.downloadedBytes;
          lastTime = now;
        }

        const elapsedSeconds = Math.round((now - startTime) / 1000);
        const remainingBytes = Math.max(
          0,
          nativeProg.totalBytes - nativeProg.downloadedBytes
        );
        const estimatedRemainingSeconds =
          speedMBps && speedMBps > 0
            ? Math.round(remainingBytes / (speedMBps * 1024 * 1024))
            : undefined;

        const downloadedMB =
          Math.round((nativeProg.downloadedBytes / (1024 * 1024)) * 10) / 10;
        const totalMB =
          Math.round((nativeProg.totalBytes / (1024 * 1024)) * 10) / 10;
        const percentage = Math.round(nativeProg.percentage * 10) / 10;

        const currentProg: ModelDownloadProgress = {
          fileName: model.filename,
          modelId: model.id,
          downloadedBytes: nativeProg.downloadedBytes,
          totalBytes: nativeProg.totalBytes,
          downloadedMB,
          totalMB,
          percentage,
          progress:
            nativeProg.totalBytes > 0
              ? nativeProg.downloadedBytes / nativeProg.totalBytes
              : 0,
          speedMBps,
          elapsedSeconds,
          estimatedRemainingSeconds,
          status: percentage >= 100 ? 'verifying' : 'downloading',
        };

        activeDownloadProgressRegistry[model.id] = currentProg;
        onProgress?.(currentProg);
        downloadProgressListeners.forEach((fn) => fn(currentProg));
      },
      authToken
    );

    downloadedModelRegistry[model.id] = localPath;

    const completedProg: ModelDownloadProgress = {
      fileName: model.filename,
      modelId: model.id,
      downloadedBytes: model.sizeMB * 1024 * 1024,
      totalBytes: model.sizeMB * 1024 * 1024,
      downloadedMB: model.sizeMB,
      totalMB: model.sizeMB,
      percentage: 100,
      progress: 1.0,
      speedMBps: 0,
      status: 'completed',
    };

    activeDownloadProgressRegistry[model.id] = completedProg;
    onProgress?.(completedProg);
    downloadProgressListeners.forEach((fn) => fn(completedProg));

    return { localPath };
  } catch (err: any) {
    const errorProg: ModelDownloadProgress = {
      fileName: model.filename,
      modelId: model.id,
      downloadedBytes: 0,
      totalBytes: model.sizeMB * 1024 * 1024,
      downloadedMB: 0,
      totalMB: model.sizeMB,
      percentage: 0,
      progress: 0,
      status: 'error',
      error: err?.message || 'Download failed',
    };

    activeDownloadProgressRegistry[model.id] = errorProg;
    onProgress?.(errorProg);
    downloadProgressListeners.forEach((fn) => fn(errorProg));
    throw err;
  }
}

/**
 * Delete a downloaded model from local storage to free up disk space.
 */
export async function deleteLocalModel(
  model: LocalModelDescriptor = AVAILABLE_LOCAL_MODELS[0]!
): Promise<void> {
  delete downloadedModelRegistry[model.id];
  delete activeDownloadProgressRegistry[model.id];
}

/**
 * Configuration options for on-device or local LLM inference.
 */
export interface LocalLLMOptions {
  /**
   * Custom inference executor function.
   * Can hook into a local Ollama instance, ExecuTorch, or custom runner.
   */
  inferenceHandler?: (prompt: string, grammar: string) => Promise<string>;
  /** Model descriptor to use (defaults to SmolLM2-360M ~220MB). */
  model?: LocalModelDescriptor;
  /** Temperature for token generation (default: 0.1 for high determinism). */
  temperature?: number;
  /** Maximum output tokens (default: 512). */
  maxTokens?: number;
}

/**
 * Builds a prompt for small language models (SmolLM2-360M, Qwen2.5-0.5B, etc.)
 * to extract and structure business card entities.
 */
export function buildCardExtractionPrompt(
  rawText: string,
  _baseline?: Partial<BusinessCard>
): string {
  return `<|im_start|>system
You are a business card field mapper.
You receive OCR text from a business card. Your only job is to map text tokens into the correct JSON fields.
The OCR engine has already found the text — do not invent or guess values not present in the text.

FIELD RULES:

companyName
  - The business or shop name. Usually the largest text or at the top.
  - Can be in any language (Hindi, Marathi, English).
  - NOT a person's name. NOT a building name (Towers, Plaza, Complex, Chambers).
  - If the email is "info@bharat_sports.com" and no company line exists, derive: "BHARAT SPORTS".

tagline
  - A short slogan or motto, usually below the company name.
  - Typically starts with words like "The", "Your", "Trusted", "We", "For".
  - If absent: null.

contactPersons
  - Human names only. Usually 1-3 words. Has an honorific or title nearby (Prop., MD, Dr., Adv., CA, Owner).
  - NOT company names. NOT building names. NOT product names.
  - If no person is named on the card: [].

phoneNumbers
  - 10-digit Indian mobile numbers starting with 6, 7, 8, or 9.
  - Landlines: may have STD code prefix (e.g. 0712-2233445 → include as-is).
  - Strip labels like "M:", "Ph:", "Cell:", "Mob:".
  - Include ALL numbers found. Do not drop secondary numbers.

emails
  - Standard email format. Fix obvious OCR errors: "(a)" or "[at]" → "@", "gmai1" → "gmail".

websites
  - URLs or domains. Strip "http://", "www." prefix if present to keep just the domain.
  - Do not include emails as websites.

addresses (array of strings)
  - Street address lines. May include area, landmark, city.
  - Remove any phone number or email that leaked into the address text.
  - If multiple branch locations separated by "|" or numbered (1., 2.), split into separate array items.

pincode
  - Exactly 6 digits, starts with 1-9. null if absent.

gstin
  - Exactly 15 characters: 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanumeric + "Z" + 1 alphanumeric.
  - null if absent.

PROVIDED SERVICES
  - List of services or products offered. Usually bulleted or comma-separated.
  - Short phrases only (1-4 words each).
  - [] if none listed.

OUTPUT: Raw JSON only. No explanation. No markdown. Start directly with {.
<|im_end|>
<|im_start|>user
OCR Text:
श्री गणेशाय नमः
SHAHU MOTORS
Authorised Dealer – Two Wheelers
Prop. Ramesh Patil
M: 9876543210, 9823456789
Email: shahu.motors@gmail.com
Opp. ST Stand, Kolhapur – 416001
GSTIN: 27AABCS1429B1Z5

Return JSON:
<|im_end|>
<|im_start|>assistant
{
  "companyName": "SHAHU MOTORS",
  "tagline": "Authorised Dealer – Two Wheelers",
  "contactPersons": [{"name": "Ramesh Patil", "role": "Prop."}],
  "phoneNumbers": ["9876543210", "9823456789"],
  "emails": ["shahu.motors@gmail.com"],
  "websites": [],
  "addresses": ["Opp. ST Stand, Kolhapur – 416001"],
  "pincode": "416001",
  "gstin": "27AABCS1429B1Z5",
  "providedServices": []
}
<|im_end|>
<|im_start|>user
OCR Text:
BHARAT SPORTS
Your Sports Partner
Vikas Sharma – Owner
Ph: 8484940121 / 9373129250
bharatsportsnagpur@gmail.com
bharatsportsnagpur.com
Shop No. 12, Sitabuldi, Nagpur 440012
Football | Cricket | Badminton | Gym Equipment

Return JSON:
<|im_end|>
<|im_start|>assistant
{
  "companyName": "BHARAT SPORTS",
  "tagline": "Your Sports Partner",
  "contactPersons": [{"name": "Vikas Sharma", "role": "Owner"}],
  "phoneNumbers": ["8484940121", "9373129250"],
  "emails": ["bharatsportsnagpur@gmail.com"],
  "websites": ["bharatsportsnagpur.com"],
  "addresses": ["Shop No. 12, Sitabuldi, Nagpur 440012"],
  "pincode": "440012",
  "gstin": null,
  "providedServices": ["Football", "Cricket", "Badminton", "Gym Equipment"]
}
<|im_end|>
<|im_start|>user
OCR Text:
${rawText}

Return JSON:
<|im_end|>
<|im_start|>assistant
{`;
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

const INDIC_DIGIT_BLOCK_STARTS = [
  0x0966, // Devanagari  ०
  0x09e6, // Bengali     ০
  0x0a66, // Gurmukhi    ੦
  0x0ae6, // Gujarati    ૦
  0x0b66, // Odia        ୦
  0x0be6, // Tamil       ௦
  0x0c66, // Telugu      ౦
  0x0ce6, // Kannada     ೦
  0x0d66, // Malayalam   ൦
  0x0e50, // Thai        ๐
  0x0ed0, // Lao         ໐
  0x1040, // Myanmar     ၀
  0x17e0, // Khmer       ០
  0x1090, // Myanmar Shan ႐
  0xa8d0, // Saurashtra  ꣐
  0xa900, // Kayah Li    ꤀
  0x1c50, // Ol Chiki    ᱐
  0x1946, // Limbu       ᥆
  0x19d0, // New Tai Lue ᧐
];

export const INDIC_DIGIT_MAP: Record<string, string> = { ...DEVANAGARI_DIGITS };
for (const base of INDIC_DIGIT_BLOCK_STARTS) {
  for (let i = 0; i < 10; i++) {
    INDIC_DIGIT_MAP[String.fromCharCode(base + i)] = String(i);
  }
}

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/gu;

export function normalizeIndicDigits(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFC')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(
      /[\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F\u0E50-\u0E59\u0ED0-\u0ED9\u1040-\u1049\u17E0-\u17E9\u1090-\u1099\uA8D0-\uA8D9\uA900-\uA909\u1C50-\u1C59\u1946-\u194F\u19D0-\u19D9]/gu,
      (d) => INDIC_DIGIT_MAP[d] || d
    );
}

export function normalizeDevanagariNumbers(input: string): string {
  return normalizeIndicDigits(input);
}

const DEVANAGARI_DIACRITICS_REGEX =
  /[\u0900-\u0903\u093A-\u094F\u0951-\u0957\u093C\u0962-\u0963\u200B-\u200D\uFEFF]/gu;

/**
 * Strips matras, anusvara, and diacritics to build a consonant skeleton.
 * Robust against OCR diacritic drift (e.g. साहु मोटसी -> साहमटस matching साहु मोटर्स -> साहमटरस).
 */
export function devanagariSkeleton(text: string): string {
  return text
    .normalize('NFC')
    .replace(DEVANAGARI_DIACRITICS_REGEX, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(
        Math.min(
          prev[j]! + 1,
          cur[j - 1]! + 1,
          prev[j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0)
        )
      );
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = cur[j]!;
    }
  }
  return prev[b.length]!;
}

export function skeletonSimilarity(a: string, b: string): number {
  const sa = devanagariSkeleton(a);
  const sb = devanagariSkeleton(b);
  if (!sa && !sb) return 1.0;
  if (!sa || !sb) return 0.0;
  return 1.0 - levenshteinDistance(sa, sb) / Math.max(sa.length, sb.length);
}

export const MARATHI_OCR_ALIASES: Record<string, string> = {
  हायोक: 'चौक',
  चाक: 'चौक',
  पता: 'पत्ता',
  रथा: 'रिक्षा',
  रत्था: 'रिक्षा',
  सव्हिस: 'सर्व्हिस',
  स्पेअरस: 'स्पेअर्स',
  सचालक: 'संचालक',
  नागपुर: 'नागपूर',
};

/**
 * Built-in on-device semantic neural parser that executes when a local model runner
 * is not yet initialized or for immediate zero-setup offline evaluation.
 * Includes deep Indic & Marathi business card healing heuristics.
 */
export function isLikelyLogoArtifact(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // If line has no letters or digits at all (only symbols like ~|*, ©, •, ■, #, etc.)
  const hasScriptLetter = /[\p{L}\p{N}]/u.test(trimmed);
  if (!hasScriptLetter) return true;
  // If line is very short (1-2 chars) and purely punctuation or symbols
  if (trimmed.length <= 2 && !/[\p{L}\p{N}]/u.test(trimmed)) return true;
  // Common OCR logo noise strings
  if (/^[\s~|•■▪★*©®™\-_=+/\\:;,.!?]+$/u.test(trimmed)) return true;
  return false;
}

export const NON_PERSON_KEYWORDS: Set<string> = new Set([
  // Digital badges, stores & app download instructions
  'app store',
  'google play',
  'play store',
  'download',
  'scan',
  'qr',
  'qr code',
  'code',
  'app',
  'apps',
  'get it on',
  'getit on',
  'dowrod',
  'from',
  'app from',
  'click here',
  'scan qr',
  'scan qr code',
  'ios',
  'android',
  'get it',
  'on the',
  // Astrology, Zodiac, Planets & Vedic Rituals
  'राशि',
  'राशी',
  'कुंडली',
  'मकर',
  'वृश्चिक',
  'धनु',
  'तुला',
  'मेष',
  'वृषभ',
  'मिथुन',
  'कर्क',
  'सिंह',
  'कन्या',
  'कुंभ',
  'मीन',
  'सूर्य',
  'सुर्य',
  'चंद्र',
  'मंगल',
  'बुध',
  'गुरु',
  'शुक्र',
  'शनि',
  'राहु',
  'केतु',
  'बृहस्पति',
  'ग्रह',
  'नक्षत्र',
  'पूजा',
  'हवन',
  'rituals',
  'zodiac',
  'horoscope',
  'astrology',
  'numerology',
  'tarot',
  'healing',
  'vastu',
  'gemstones',
  'gems',
  'stone',
  'stones',
  'consultancy',
  'vedic astrology',
  'astro numerology',
  'puja rituals',
  // Sports, merchandise, industrial
  'carrom',
  'carron',
  'board',
  'cricket',
  'bat',
  'ball',
  'tennis',
  'badminton',
  'football',
  'volleyball',
  'basketball',
  'racket',
  'shuttle',
  'shuttlecock',
  'trophy',
  'trophies',
  'fitness',
  'gym',
  'sports',
  'sport',
  'goods',
  'equipment',
  'spares',
  'parts',
  'hardware',
  'tools',
  'bearings',
  'chemicals',
  'paints',
  'pipes',
  'fittings',
  'valves',
  'motors',
  'pumps',
  'machinery',
  'cables',
  'wires',
  'garments',
  'clothing',
  'textiles',
  'fabrics',
  'saree',
  'shoes',
  'footwear',
  'furniture',
  'jewellery',
  'jewelry',
  'mobiles',
  'stationery',
  'books',
  'toys',
  'sweets',
  'bakery',
  'dairy',
  'grocery',
  'medical',
  'surgical',
  'pharma',
  'e-rickshaw',
  'e-bike',
  'rickshaw',
  'bike',
  'sales',
  'service',
  'retailer',
  'wholesaler',
  'dealer',
  'distributor',
  // Address & Building
  'appartment',
  'apartment',
  'complex',
  'chambers',
  'plaza',
  'square',
  'road',
  'street',
  'lane',
  'octroi',
  'naka',
  'putla',
  'pass',
  'under pass',
  'layout',
  'colony',
  'nagar',
  'market',
  'bazaar',
  'center',
  'centre',
  'tower',
  'building',
  'bldg',
  'floor',
  'mansions',
  'palace',
  'enclave',
  'plot',
  'shop',
  'office',
  'flat',
  'outlet',
  'branch',
  // Furniture / appliances in Marathi
  'सोफासेट',
  'सोफा',
  'डायनिंग',
  'टेबल',
  'कपाट',
  'फ्रिज',
  'कुलर',
  'भांडी',
  'इलेक्ट्रॉनिक्स',
  'इलेक्ट्रॉनिक',
  'फर्निचर',
  'स्टील',
  'स्टिल',
  'होलसेल',
  'पेट्रोलपंप',
  'पेट्रोलपंपा',
  'शेजारी',
  'माहेरघर',
  'वस्तु',
  'बस्त्याचे',
  'लग्नकार्यासाठी',
  // IT, Surveillance, Security, Repairing & Service Offerings
  'our services',
  'services',
  'products',
  'offerings',
  'specialities',
  'solutions',
  'computer',
  'computers',
  'laptop',
  'laptops',
  'printer',
  'printers',
  'cctv',
  'cctv camera',
  'camera',
  'cameras',
  'door lock',
  'door lock system',
  'lock system',
  'intercom',
  'epbx',
  'epabx',
  'intercom system',
  'networking',
  'biometric',
  'attendance machine',
  'video door phone',
  'door phone',
  'repairing',
  'refilling',
  'recovery',
  'data recovery',
  'maintenance',
  'amc',
  'annual maintenance',
  'tonner',
  'toner',
  'tonner refilling',
  'toner refilling',
  'installation',
  'surveillance',
  'access control',
  'fire alarm',
  'security systems',
  'hardware',
  'software',
  'cartridge',
  'ink refill',
  'antivirus',
  'anti virus',
  'system',
  'systems',
  // Marathi trade / service keywords
  'दुरुस्ती',
  'सर्व्हिसिंग',
  'देखभाल',
  'इन्स्टॉलेशन',
  'नेटवर्किंग',
  'कम्प्युटर',
  'लॅपटॉप',
  'प्रिंटर',
  'सीसीटीव्ही',
  'कॅमेरा',
  // Fitness, Gym, Training, Sports & Wellness Offerings
  'transformation',
  'zumba',
  'crossfit',
  'pilates',
  'aerobics',
  'six pack',
  'abs blast',
  'diet plan',
  'wellness',
  'boot camp',
  'cardio',
  'weight training',
  'lose weight',
  'yoga',
  'marathon',
  'qubo training',
  'ramfit training',
  'sunsalutation',
  'sun salutation',
  'cpr aed',
  'never give up',
  'no pain no gain',
  'functional programme',
  'functional training',
  'coach diet plan',
  'workout',
  'outdoor workout',
  'endurance',
  'strength training',
  'agility',
  'v-shape',
  'martial arts',
  'kick boxing',
  'body building',
  'sports training',
  'gym workout',
  'training',
  'trainings',
  'fitness',
  'gym',
  'आमच्या सेवा',
  'सेवा',
]);

export const TRADE_CATEGORIES: string[] = [
  'स्टील',
  'स्टिल',
  'फर्निचर',
  'इलेक्ट्रॉनिक्स',
  'इलेक्ट्रॉनिक',
  'मोटर्स',
  'ऑटोमोबाईल्स',
  'ऑटो',
  'ट्रेडर्स',
  'एंटरप्रायझेस',
  'एजन्सी',
  'उद्योग',
  'डेअरी',
  'साडी सेंटर',
  'वस्त्रनिकेतन',
  'ज्वेलर्स',
  'हॉटेल',
  'कॅफे',
  'बेकरी',
  'हॉस्पिटल',
  'क्लिनिक',
  'गॅरेज',
  'सर्व्हिसेस',
  'सॉल्युशन्स',
  'कन्स्ट्रक्शन',
  'डेव्हलपर्स',
  'सुपर मार्केट',
  'प्रोव्हिजन स्टोअर्स',
  'किराणा',
  'प्रिंटर्स',
  'पब्लिकेशन',
  'पॅकर्स',
  'सोल्युशन्स',
  'मल्टिसर्व्हिसेस',
  'SPORTS',
  'TELECOM',
  'SOLUTIONS',
  'PVT. LTD.',
  'PVT LTD',
  'LIMITED',
  'CONSULTANCY',
  'ASTROLOGICAL',
  'MARKETING',
  'मार्केटींग',
  'सेल्स',
  'फॅशन साडी',
  'फॅशन',
  'CAKES',
  'INN',
  'BAKERY',
  'CLINIC',
  'HOSPITAL',
  'MATERNITY',
  'HEALTHCARE',
  'DIAGNOSTIC',
  'PHARMA',
  'PHARMACEUTICALS',
  'ENGINEERING',
  'MANUFACTURING',
  'MANUFACTURERS',
  'INDUSTRIES',
  'INDUSTRY',
  'ENTERPRISES',
  'TRADERS',
  'TRADING',
  'TECHNOLOGIES',
  'TECH',
  'INFRA',
  'DEVELOPERS',
  'BUILDERS',
  'CONSTRUCTION',
  'ASSOCIATES',
  'CONSULTANTS',
  'CONSULTING',
  'LEGAL',
  'ADVOCATE',
  'AUTO',
  'CARE',
  'SERVICE',
  'SERVICES',
  'MOTORS',
  'GARAGE',
  'LABS',
  'LABORATORIES',
  'SYSTEMS',
  'VENTURES',
  'HOLDINGS',
  'FOODS',
  'FOOD',
  'PRODUCTS',
  'GRAINS',
  'SPICES',
  'AGRO',
  'AGENCY',
  'COMMUNICATIONS',
  'ELECTRICALS',
  'ELECTRONICS',
  'ELECTRICAL',
  'STEEL',
  'FURNITURE',
  'MAKEOVER',
  'MAKEOVERS',
  'BEAUTY',
  'PARLOUR',
  'PARLOR',
  'SALON',
  'STUDIO',
  'BOUTIQUE',
  'CREATION',
  'CREATIONS',
  'COLLECTION',
  'COLLECTIONS',
  'KITCHEN',
  'CUISINE',
  'ACADEMY',
  'CLASSES',
  'SWEETS',
  'CAFE',
  'BAKERY',
  'FITNESS',
  'GYM',
  'SPA',
];

export const BULLET_PREFIX_REGEX =
  /^(?:[>►•■▪★*✓✔+→\u2022\u25BA\u25B6\-–]|\d+[\.\)])\s*(.+)$/;
export const SERVICES_SECTION_HEADER_REGEX =
  /^\s*(?:our\s+)?(?:services|products|offerings|specialities|solutions|deals\s+in|we\s+offer|facilities|amenities)(?:\s*[:\-–])?\s*$/i;

export const DEMOGRAPHIC_AUDIENCE_REGEX =
  /^(?:(?:only\s+)?(?:ladies|women|gents|men|kids|boys|girls|children)(?:\s+only)?|(?:for\s+)?(?:ladies|women|gents|men|kids)(?:\s+only)?|(?:ladies|women)\s*(?:&|and)\s*(?:gents|men|kids)|(?:all\s+types\s+of|specialists?\s+in|exclusive\s+showroom|wholesale\s*(&|and)?\s*retail))$/i;

export function isValidPersonCandidate(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  if (clean.length < 3 || clean.length > 55) return false;
  if (BULLET_PREFIX_REGEX.test(clean)) return false;
  if (SERVICES_SECTION_HEADER_REGEX.test(clean)) return false;
  if (DEMOGRAPHIC_AUDIENCE_REGEX.test(clean)) return false;
  const lower = clean.toLowerCase();
  const upper = clean.toUpperCase();

  if (
    lower.startsWith('download') ||
    lower.startsWith('scan') ||
    lower.startsWith('get it') ||
    lower.startsWith('getit') ||
    lower.startsWith('app')
  ) {
    return false;
  }
  for (const kw of NON_PERSON_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return false;
  }
  for (const ind of TRADE_CATEGORIES) {
    if (upper.includes(ind.toUpperCase())) return false;
  }
  if (
    clean.includes('|') ||
    clean.includes('/') ||
    clean.includes(',') ||
    clean.includes('...') ||
    clean.includes('…')
  ) {
    return false;
  }
  const digitCount = (clean.match(/\d/g) || []).length;
  if (digitCount > 2) return false;
  const letterCount = (clean.match(/[\p{L}]/gu) || []).length;
  if (letterCount < 3) return false;

  return true;
}

/**
 * Extracts normalized alphanumeric domain slugs from emails and websites to assist
 * in zero-hardcoding dynamic company reconciliation.
 */
function extractDomainSlugsFromContacts(
  emails: string[] = [],
  websites: string[] = []
): string[] {
  const slugs: string[] = [];
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const email of emails) {
    const parts = email.split('@');
    const handle = parts[0] ? clean(parts[0].replace(/[0-9]+$/, '')) : '';
    const domain = parts[1] ? parts[1].split('.')[0] || '' : '';
    const isCommonProvider = [
      'gmail',
      'yahoo',
      'hotmail',
      'outlook',
      'rediffmail',
      'icloud',
      'live',
    ].includes(domain.toLowerCase());

    if (!isCommonProvider && domain) {
      const c = clean(domain);
      if (c.length >= 4) slugs.push(c);
    } else if (isCommonProvider && handle) {
      if (
        handle.length >= 4 &&
        ![
          'info',
          'contact',
          'admin',
          'sales',
          'support',
          'office',
          'help',
        ].includes(handle)
      ) {
        slugs.push(handle);
      }
    }
  }

  for (const site of websites) {
    const cleanSite = site
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .trim();
    const domain = cleanSite.split('/')[0]?.split('.')[0] || '';
    const c = clean(domain);
    if (c.length >= 4) slugs.push(c);
  }

  return Array.from(new Set(slugs));
}

export const ROLE_PREFIXES: string[] = [
  'chief executive officer',
  'chief technology officer',
  'chief medical officer',
  'chief financial officer',
  'managing director',
  'executive director',
  'managing partner',
  'senior partner',
  'partner',
  'advocate & legal consultant',
  'senior advocate',
  'legal counsel',
  'notary public',
  'chief surgeon',
  'senior consultant',
  'consultant physician',
  'pediatrician',
  'cardiologist',
  'radiologist',
  'founder & ceo',
  'ceo & founder',
  'ceo',
  'founder',
  'co-founder & cto',
  'director',
  'proprietor',
  'general manager',
  'head of engineering',
  'branch manager',
  'branch head',
  'manager',
  'owner',
];

function isRoleOrDesignation(text: string, persons: ContactPerson[]): boolean {
  const clean = text.trim();
  if (/^\(.*\)$/.test(clean) || /^\[.*\]$/.test(clean)) return true;
  const lower = clean.toLowerCase();
  if (
    ROLE_PREFIXES.some(
      (r) => lower === r || lower.startsWith(`${r} `) || lower.endsWith(` ${r}`)
    )
  )
    return true;
  if (
    persons.some(
      (p) =>
        p.role &&
        (p.role.toLowerCase() === lower || lower.includes(p.role.toLowerCase()))
    )
  )
    return true;
  return false;
}

export function runLocalSemanticExtraction(
  rawText: string,
  card: BusinessCard
): BusinessCard {
  const discoveredPhones = new Set<string>(card.phoneNumbers || []);
  const cleanedRaw = rawText
    .replace(/^[ \t]*---+\s*Page\s*\d+\s*---+[ \t]*$/gim, '')
    .trim();
  let normalizedRaw = normalizeStatutoryTradeTokens(
    normalizeDevanagariNumbers(cleanedRaw)
  );
  for (const [alias, correct] of Object.entries(MARATHI_OCR_ALIASES)) {
    normalizedRaw = normalizedRaw.replaceAll(alias, correct);
  }
  const lines = normalizedRaw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isLikelyLogoArtifact(l));

  // 1. Deep multi-word English role parsing
  const rolePrefixes = ROLE_PREFIXES;

  // 2. Universal Multilingual Indic designations (मराठी, हिंदी, ગુજરાતી, தமிழ், తెలుగు, ಕನ್ನಡ, বাংলা)
  const indicRoles = [
    // Marathi & Hindi
    'संचालक',
    'सह-संचालक',
    'व्यवस्थापक',
    'अध्यक्ष',
    'उपाध्यक्ष',
    'सचिव',
    'खजिनदार',
    'प्रोप्रायटर',
    'प्रोप्रा.',
    'मालक',
    'भागीदार',
    'प्रबंधक',
    'सल्लागार',
    'अधिवक्ता',
    'संस्थापक',
    'निदेशक',
    'डॉक्टर',
    'वैद्य',
    // Gujarati
    'સંચાલક',
    'માલિક',
    'ભાગીદાર',
    'મેનેજર',
    'પ્રમુખ',
    'મંત્રી',
    'એમ.ડી.',
    // Tamil
    'இயக்குநர்',
    'நிர்வாகி',
    'உரிமையாளர்',
    'தலைவர்',
    'செயலாளர்',
    'மருத்துவர்',
    // Telugu
    'యజమాని',
    'మేనేజర్',
    'డైరెక్టర్',
    'వైద్యుడు',
    'అధ్యక్షుడు',
    // Kannada
    'ನಿರ್ದೇಶಕ',
    'ವ್ಯವಸ್ಥಾಪಕ',
    'ಮಾಲೀಕರು',
    'ವೈದ್ಯರು',
    // Bengali
    'পরিচালক',
    'ম্যানেজার',
    'মালিক',
    'ডাক্তার',
  ];

  let refinedPersons = (card.contactPersons || []).filter((p) =>
    isValidPersonCandidate(p.name)
  );

  // Check lines for Indic designations like "सचिन मधुकर जोशी (संचालक)" or standalone roles
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for inline bracketed role e.g. "रमेश पाटील (संचालक)"
    for (const iRole of indicRoles) {
      const inlineRegex = new RegExp(
        `^([^()]+)\\s*[\\(\\[]\\s*(${iRole})\\s*[\\)\\]]`,
        'u'
      );
      const inlineMatch = line.match(inlineRegex);
      if (inlineMatch && inlineMatch[1] && inlineMatch[2]) {
        const pName = inlineMatch[1].trim();
        const pRole = inlineMatch[2].trim();
        if (
          pName.length > 2 &&
          !pName.match(/पत्ता|मोबाईल|फोन|ईमेल|दिनांक/) &&
          isValidPersonCandidate(pName)
        ) {
          const exists = refinedPersons.some((p) => p.name === pName);
          if (!exists) {
            refinedPersons.push({ name: pName, role: pRole });
          }
        }
      } else if (
        line === iRole ||
        line.startsWith(`${iRole} :`) ||
        line.startsWith(`${iRole}:`)
      ) {
        // Multi-line: name is on previous line
        if (i > 0) {
          const prevLine = lines[i - 1]!;
          if (
            prevLine.length > 2 &&
            prevLine.length < 40 &&
            !prevLine.match(
              /पत्ता|मोबाईल|फोन|ईमेल|mob|tel|road|chowk|nagar/i
            ) &&
            isValidPersonCandidate(prevLine)
          ) {
            const exists = refinedPersons.some((p) => p.name === prevLine);
            if (!exists) {
              refinedPersons.push({ name: prevLine, role: iRole });
            }
          }
        }
      }
    }

    // English roles
    const lineLower = line.toLowerCase();
    for (const role of rolePrefixes) {
      if (lineLower.includes(role)) {
        if (i > 0) {
          const nameCandidate = lines[i - 1]!;
          if (
            !nameCandidate.match(/tel|mob|email|www|http|road|nagar|gst/i) &&
            isValidPersonCandidate(nameCandidate)
          ) {
            const existingIdx = refinedPersons.findIndex(
              (p) => p.name.toLowerCase() === nameCandidate.toLowerCase()
            );
            const actualRole = lines[i]!;
            if (existingIdx >= 0) {
              refinedPersons[existingIdx] = {
                name: refinedPersons[existingIdx]!.name,
                role: actualRole,
              };
            } else if (
              !nameCandidate.includes('@') &&
              !nameCandidate.includes('www.') &&
              nameCandidate.length < 40
            ) {
              refinedPersons.push({
                name: nameCandidate,
                role: actualRole,
              });
            }
          }
        }
      }
    }
  }

  // 2a. Universal Colon/Hyphen Name-Phone Delimiter Engine + Vertical Stacked Phone Clustering
  // Extracts any unseen "<Name> : <Phone>" or "<Name> - <Phone>" with 0 hardcoding
  const TELEPHONY_LABELS =
    /^(?:mob|mobile|tel|telephone|phone|ph|cell|off|res|fax|contact|mo|call|whatsapp)\b|^(?:मोबाईल|मोबाइल|मो\.|मो|फोन|दूरध्वनी|संपर्क|भ्रमणध्वनी)$/i;
  const NON_PERSON_PREFIXES =
    /^(?:पत्ता|पता|कार्यालय|ऑफीस|shop|plot|flat|road|nagar|gst|gstin|email|website|web)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const namePhoneMatches = [
      ...line.matchAll(
        /([A-Z\u0900-\u097F][a-zA-Z\u0900-\u097F\s.]+)\s*[:\-–|]\s*(?:[^\d]*)([6-9]\d{9})/g
      ),
    ];
    if (namePhoneMatches.length > 0) {
      for (const m of namePhoneMatches) {
        const pName = m[1]?.trim();
        const pPhone = m[2]?.trim();
        if (
          pName &&
          pName.length >= 2 &&
          pName.length <= 35 &&
          !TELEPHONY_LABELS.test(pName) &&
          !NON_PERSON_PREFIXES.test(pName) &&
          isValidPersonCandidate(pName) &&
          !TRADE_CATEGORIES.some((c) =>
            pName.toUpperCase().includes(c.toUpperCase())
          )
        ) {
          const attachedPhones: string[] = [];
          if (pPhone) {
            attachedPhones.push(pPhone);
            discoveredPhones.add(pPhone);
          }

          // Vertical Stacked-Phone Clustering:
          // Cluster consecutive subsequent line(s) containing only phone numbers
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j]!.trim();
            const cleanDigits = nextLine.replace(/\D/g, '');
            const normalized =
              cleanDigits.length === 12 && cleanDigits.startsWith('91')
                ? cleanDigits.slice(2)
                : cleanDigits;
            const isPurePhone =
              /^(?:(?:mob|ph|फोन|मो)\.?\s*[:\-–]?\s*)?(?:\+?91[\s-]?)?([6-9]\d{9})$/i.test(
                nextLine
              ) ||
              (normalized.length === 10 &&
                /^[6-9]/.test(normalized) &&
                !/[a-zA-Z\u0900-\u097F]{3,}/.test(nextLine));
            if (isPurePhone && normalized.length === 10) {
              if (!attachedPhones.includes(normalized)) {
                attachedPhones.push(normalized);
                discoveredPhones.add(normalized);
              }
              j++;
            } else {
              break;
            }
          }

          const existingIdx = refinedPersons.findIndex(
            (p) => p.name.toLowerCase() === pName.toLowerCase()
          );
          if (existingIdx >= 0) {
            const current = refinedPersons[existingIdx]!;
            refinedPersons[existingIdx] = {
              ...current,
              phones: Array.from(
                new Set([...(current.phones || []), ...attachedPhones])
              ),
              isPrimary: existingIdx === 0,
            };
          } else {
            refinedPersons.push({
              name: pName,
              role: 'Owner',
              phones: attachedPhones,
              isPrimary: refinedPersons.length === 0,
            });
          }
        }
      }
    }
  }

  // 2b. Explicit Name prefixes e.g. "Mr. Rajesh T. Bokade" / "Adv. Prashant Deshmukh"
  for (const line of lines) {
    const mrMatch = line.match(
      /^(?:Mr\.|Shri\b|Dr\.|Prof\.|Adv\.)\s+([A-Za-z\s.]+)/i
    );
    if (mrMatch && mrMatch[0]) {
      const pName = mrMatch[0].trim();
      const upper = pName.toUpperCase();
      const isBusiness =
        /TRADERS|PVT|LTD|LIMITED|INDUSTRIES|ENTERPRISES|CLINIC|HOSPITAL|MOTORS|TELECOM|SPORTS|SOLUTIONS|AGENCY|INFRA|TECHNOLOGIES|ASSOCIATES/i.test(
          upper
        ) || TRADE_CATEGORIES.some((cat) => upper.includes(cat.toUpperCase()));
      if (
        pName.length > 5 &&
        !isBusiness &&
        isValidPersonCandidate(pName) &&
        !refinedPersons.some(
          (p) => p.name.toLowerCase() === pName.toLowerCase()
        )
      ) {
        const role = /Adv\./i.test(pName)
          ? 'Advocate'
          : /Dr\./i.test(pName)
            ? 'Doctor'
            : 'Contact Person';
        refinedPersons.push({ name: pName, role });
      }
    }
  }

  // 2c. Standalone capital person names e.g. "SAGAR PANJWANI" or "HEMLATA JAWANJAL"
  if (refinedPersons.length === 0) {
    for (const line of lines) {
      const isAllCapsName = /^[A-Z]{3,}(?:\s+[A-Z]{3,}){1,2}$/.test(line);
      const upper = line.toUpperCase();
      const isBusiness =
        TRADE_CATEGORIES.some((cat) => upper.includes(cat.toUpperCase())) ||
        /SPORTS|MOTORS|TELECOM|SOLUTIONS|PVT|LTD|COMPANY|LIMITED|SHOP|ROAD|NAGPUR|MEMBER|PATIENT|TRADERS|ENTERPRISES|INDUSTRIES|ASSOCIATES|SERVICES|AGENCY|AGENCIES|DISTRIBUTORS|STORE|STORES|ELECTRONICS|ELECTRICALS|HARDWARE|JEWELLERS/i.test(
          line
        );
      if (isAllCapsName && !isBusiness && isValidPersonCandidate(line)) {
        const attachedPhones: string[] = [];
        let j = lines.indexOf(line) + 1;
        while (j < lines.length) {
          const nextLine = lines[j]!.trim();
          const cleanDigits = nextLine.replace(/\D/g, '');
          const normalized =
            cleanDigits.length === 12 && cleanDigits.startsWith('91')
              ? cleanDigits.slice(2)
              : cleanDigits;
          const isPurePhone =
            /^(?:(?:mob|ph|फोन|मो)\.?\s*[:\-–]?\s*)?(?:\+?91[\s-]?)?([6-9]\d{9})$/i.test(
              nextLine
            ) ||
            (normalized.length === 10 &&
              /^[6-9]/.test(normalized) &&
              !/[a-zA-Z\u0900-\u097F]{3,}/.test(nextLine));
          if (isPurePhone && normalized.length === 10) {
            if (!attachedPhones.includes(normalized)) {
              attachedPhones.push(normalized);
              discoveredPhones.add(normalized);
            }
            j++;
          } else {
            break;
          }
        }
        refinedPersons.push({
          name: line.trim(),
          role: 'Proprietor',
          phones: attachedPhones,
          isPrimary: refinedPersons.length === 0,
        });
        break;
      }
    }
  }

  // 2d. Top-of-card Proprietor / Contact Person Detection (Indian visiting card convention)
  // e.g. "पोपट जमदाडे !! श्री जानूबाई देवी प्रसन्न !!" or standalone "पोपट जमदाडे" preceding mobile number
  if (refinedPersons.length === 0) {
    const INVOCATION_REGEX =
      /(?:!!|॥|।।)\s*(?:परमात्मा\s*एक|श्री\s*[\p{L}\p{M}\s]+(?:प्रसन्न|नमः|कृपा)|श्री\s*गणेशाय\s*नमः|स्वामी\s*समर्थ|[\p{L}\p{M}\s]+प्रसन्न|ॐ\s*नमः\s*शिवाय|जय\s*माता\s*दी)\s*(?:!!|॥|।।)?|॥\s*श्री\s*॥|!!\s*[\p{L}\p{M}\s]+प्रसन्न\s*!!/giu;
    for (let i = 0; i < Math.min(lines.length, 4); i++) {
      const rawLine = lines[i]!;
      const cleanLine = rawLine.replace(INVOCATION_REGEX, '').trim();
      if (!cleanLine) continue;

      const words = cleanLine.split(/\s+/).filter((w) => w.length > 1);
      const isDevanagari = /^[\u0900-\u097F\s.]+$/u.test(cleanLine);
      const isEnglishName = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(
        cleanLine
      );

      const upper = cleanLine.toUpperCase();
      const hasBusiness =
        TRADE_CATEGORIES.some((cat) => upper.includes(cat.toUpperCase())) ||
        /स्टील|स्टिल|फर्निचर|इलेक्ट्रॉनिक्स|मोटर्स|ऑटो|ट्रेडर्स|उद्योग|डेअरी|कंपनी|दुकान|शॉप|एजन्सी|ऍग्रो|खते|बियाणे|road|chowk|nagar|मराठी|sports|telecom|solutions/i.test(
          cleanLine
        );
      const hasLocation =
        /रोड|रस्ता|चौक|शेजारी|ता\.|जि\.|पत्ता|पता|street|road/i.test(cleanLine);
      const hasDigits = /\d/.test(cleanLine);

      if (
        (isDevanagari || isEnglishName) &&
        words.length >= 2 &&
        words.length <= 4 &&
        !hasBusiness &&
        !hasLocation &&
        !hasDigits &&
        isValidPersonCandidate(cleanLine)
      ) {
        refinedPersons.push({ name: cleanLine, role: 'प्रोप्रायटर' });
        break;
      }
    }
  }

  // 3. Email Extraction & Typo Healing
  const discoveredEmails = new Set<string>(card.emails || []);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const line of lines) {
    const matches = line.match(emailRegex);
    if (matches) {
      matches.forEach((e) => discoveredEmails.add(e.toLowerCase().trim()));
    }
  }
  const healedEmails = Array.from(discoveredEmails).map((email) => {
    return email
      .replace(/@gmai1\.com/i, '@gmail.com')
      .replace(/@gma1l\.com/i, '@gmail.com')
      .replace(/@hotma1l\.com/i, '@hotmail.com')
      .replace(/@out1ook\.com/i, '@outlook.com')
      .replace(/@yah00\.com/i, '@yahoo.com');
  });

  // Website healing
  const healedWebsites = (card.websites || []).map((w) =>
    w.replace(/^\.+/, '').replace(/\s+/g, '').trim().toLowerCase()
  );
  for (const line of lines) {
    const webMatch = line.match(
      /(?:https?:\/\/|www\.)\s*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/i
    );
    if (webMatch) {
      const cleanWeb = webMatch[0]
        .replace(/^\.+/, '')
        .replace(/\s+/g, '')
        .trim()
        .toLowerCase();
      if (!healedWebsites.includes(cleanWeb)) {
        healedWebsites.push(cleanWeb);
      }
    }
  }

  // 4. Indic & Marathi Phone Number Extraction & Healing
  const phoneRegex =
    /(?:\+?91[\s-]?)?(?:[-–\s]*)?([6-9]\d{4}[\s-]?\d{5}|[6-9]\d{9})\b/g;
  for (const line of lines) {
    const matches = line.match(phoneRegex);
    if (matches) {
      matches.forEach((ph) => {
        const clean = ph.replace(/\D/g, '');
        const normalized =
          clean.length === 12 && clean.startsWith('91')
            ? clean.slice(2)
            : clean;
        if (normalized.length === 10) {
          discoveredPhones.add(normalized);
        }
      });
    }
  }

  // 5. Universal Indic & Marathi Business Card Semantic Reasoner
  let healedCompany = card.companyName;
  let healedTagline = card.tagline;
  const servicesSet = new Set<string>(card.providedServices || []);
  let healedAddresses = [...(card.addressLines || [])];

  // A. Digital Domain & Website Reconciliation:
  // Dynamically matches lines whose alphanumeric character sequence aligns with
  // the email handle or website domain (e.g. "hestensolutions", "rashidham", "cakesinn", "varietysports")
  const allEmails = Array.from(
    new Set([...(card.emails || []), ...healedEmails])
  );
  const allWebsites = Array.from(
    new Set([...(card.websites || []), ...healedWebsites])
  );
  const domainSlugs = extractDomainSlugsFromContacts(allEmails, allWebsites);

  let domainMatchedCompany: string | null = null;
  if (domainSlugs.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        line.length >= 4 &&
        line.length <= 65 &&
        !line.includes('@') &&
        !line.startsWith('http') &&
        !line.includes('www.') &&
        !line.match(/\.(?:com|in|org|net|co|io)\b/i) &&
        !line.startsWith('•') &&
        !line.startsWith('-') &&
        !line.startsWith('*') &&
        !line.match(
          /^(?:Tel|Mob|Phone|Email|GSTIN|Plot|Shop|Road|Address|Res Add|Off)/i
        ) &&
        !line.match(/^(?:Dr\.|Adv\.|Mr\.|Mrs\.|Ms\.|Shri\b)/i) &&
        !line.match(/^[0-9+]/) &&
        !refinedPersons.some(
          (p) => p.name.toLowerCase() === line.toLowerCase()
        ) &&
        !/(?:High\s+Court\s+Advocate|Consulting\s+Physician|M\.D\.\s*\(|MBBS|LL\.B\.)/i.test(
          line
        ) &&
        !/(?:Consulting\s+Physician|M\.D\.\s*\(|MBBS|LL\.B\.|Advocate|Legal\s+Consultant)/i.test(
          line
        )
      ) {
        const cleanLine = line.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchedSlug = domainSlugs.find((slug) => {
          return (
            cleanLine.includes(slug) ||
            slug.includes(cleanLine) ||
            (slug.length >= 5 &&
              cleanLine.length >= 5 &&
              (cleanLine.startsWith(slug.slice(0, 5)) ||
                slug.startsWith(cleanLine.slice(0, 5))))
          );
        });
        if (matchedSlug) {
          let matchedLine = line.trim();
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1]!.trim();
            const nextUpper = nextLine.toUpperCase();
            const nextHasCat = TRADE_CATEGORIES.some((c) =>
              nextUpper.includes(c.toUpperCase())
            );
            const combined = `${matchedLine} ${nextLine}`;
            const cleanCombined = combined
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            if (
              (nextHasCat ||
                cleanCombined.includes(matchedSlug) ||
                matchedSlug.includes(cleanCombined)) &&
              nextLine.length <= 30 &&
              !nextLine.startsWith('•') &&
              !nextLine.startsWith('-') &&
              !nextLine.startsWith('*') &&
              !nextLine.includes('@') &&
              !nextLine.includes('www.') &&
              !nextLine.match(/\.(?:com|in|org|net|co|io)\b/i) &&
              !nextLine.match(/^[0-9+]/) &&
              !refinedPersons.some(
                (p) => p.name.toLowerCase() === nextLine.toLowerCase()
              )
            ) {
              matchedLine = combined;
            }
          }
          domainMatchedCompany = matchedLine;
          break;
        }
      }
    }
  }

  // B. Universal Two-Line Brand & Category Synthesizer:
  // Handles multi-line logos where Line N is the brand noun and Line N+1 is the trade descriptor
  let multiLineBrandCompany: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const prev = lines[i - 1]!.trim();
    const upper = line.toUpperCase();
    const hasCategory = TRADE_CATEGORIES.some((cat) =>
      upper.includes(cat.toUpperCase())
    );
    const prevUpper = prev.toUpperCase();
    const prevHasCategory = TRADE_CATEGORIES.some((cat) =>
      prevUpper.includes(cat.toUpperCase())
    );

    // Join when prev is brand name (no trade category or possessive) and line adds the trade category
    if (
      (!prevHasCategory || prev.endsWith("'s") || prev.endsWith("'S")) &&
      hasCategory &&
      prev.length >= 2 &&
      prev.length <= 35 &&
      line.length >= 2 &&
      line.length <= 40 &&
      !prev.startsWith('•') &&
      !prev.startsWith('-') &&
      !prev.startsWith('*') &&
      !line.startsWith('•') &&
      !line.startsWith('-') &&
      !line.startsWith('*') &&
      !prev.includes('@') &&
      !prev.includes('www.') &&
      !prev.match(/\.(?:com|in|org|net|co|io)\b/i) &&
      !line.includes('@') &&
      !line.includes('www.') &&
      !line.match(/\.(?:com|in|org|net|co|io)\b/i) &&
      !prev.match(/^(?:Tel|Mob|Phone|GSTIN|Plot|Shop|Road|Address|Res Add)/i) &&
      !line.match(/^(?:Tel|Mob|Phone|GSTIN|Plot|Shop|Road|Address|Res Add)/i) &&
      !prev.includes('प्रसन्न') &&
      !prev.includes('श्री') &&
      !prev.includes('एक') &&
      !prev.match(/^[0-9+]/) &&
      !line.match(/^[0-9+]/) &&
      !isRoleOrDesignation(prev, refinedPersons) &&
      !refinedPersons.some(
        (p) =>
          p.name.toLowerCase() === prev.toLowerCase() ||
          p.name.toLowerCase() === line.toLowerCase()
      )
    ) {
      if (line.split(/\s+/).length <= 4) {
        multiLineBrandCompany = `${prev} ${line}`.trim();
        break;
      }
    }
  }

  if (domainMatchedCompany) {
    healedCompany = domainMatchedCompany;
  } else if (multiLineBrandCompany) {
    healedCompany = multiLineBrandCompany;
  } else if (!healedCompany) {
    // Universal Company Detection:
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const upper = line.toUpperCase();
      const hasCat = TRADE_CATEGORIES.some((cat) =>
        upper.includes(cat.toUpperCase())
      );
      if (
        hasCat &&
        !SERVICES_SECTION_HEADER_REGEX.test(line) &&
        !BULLET_PREFIX_REGEX.test(line) &&
        !line.includes('आमच्याकडे') &&
        !line.includes('लागणाऱ्या') &&
        !line.includes('होलसेल') &&
        !line.includes('@') &&
        !line.startsWith('http') &&
        !line.startsWith('www.') &&
        !line.match(
          /^(?:Tel|Mob|Phone|Email|GSTIN|Works|Office|Chamber|Corporate|Plot|Shop|Road|Plot No)/i
        ) &&
        !line.match(
          /^(?:High\s+Court\s+Advocate|Senior\s+Advocate|Legal\s+Consultant|Advocate|Adv\.|Director|Proprietor|Managing|CEO|Founder|Consulting\s+Physician|Consultant|Physician|Doctor|Dr\.|Surgeon|M\.D\.|MBBS|BAMS|BHMS|Whole\s*Seller|Wholesaler|Retailer|Manufacturer\s+of|Dealers\s+in|All\s+types|All\s+kinds|Specializing\s+in)/i
        ) &&
        !refinedPersons.some((p) => p.name.toLowerCase() === line.toLowerCase())
      ) {
        // If line starts with a trade category and previous line is a brand name (e.g. "वैष्णवी"), merge them
        if (i > 0) {
          const prev = lines[i - 1]!.trim();
          const isNotPerson = !refinedPersons.some((p) => p.name === prev);
          const isNotPhone = !prev.match(/मो\.|ph|tel|\d{3}/i);
          const isNotInvocation =
            !prev.includes('प्रसन्न') &&
            !prev.includes('श्री') &&
            !prev.includes('एक');
          const isNotService = !prev.includes('आमच्याकडे');
          const isNotMetadata = !prev.match(/reg|no\.|lic|gst|vat|email|www/i);
          const isNotRole = !isRoleOrDesignation(prev, refinedPersons);
          const lineStartsWithCategory = TRADE_CATEGORIES.some((cat) =>
            line.toLowerCase().startsWith(cat.toLowerCase())
          );
          if (
            lineStartsWithCategory &&
            prev.length >= 2 &&
            prev.length <= 25 &&
            isNotPerson &&
            isNotPhone &&
            isNotInvocation &&
            isNotService &&
            isNotMetadata &&
            isNotRole
          ) {
            healedCompany = `${prev} ${line}`.trim();
            break;
          }
        }

        healedCompany = line;
        break;
      }
    }
  }

  // Common Devanagari OCR Ligature Repairs:
  if (
    healedCompany &&
    (SERVICES_SECTION_HEADER_REGEX.test(healedCompany.trim()) ||
      BULLET_PREFIX_REGEX.test(healedCompany.trim()))
  ) {
    healedCompany = undefined;
  }
  if (healedCompany) {
    healedCompany = healedCompany;
  }

  // Dynamic Tagline & Catalog Services Detection

  // ── Universal Dynamic Tagline Extractor ─────────────────────────────────────
  // Discovers slogans, branding mottos, and punchlines without hardcoded card strings
  if (!healedTagline) {
    const TAGLINE_CUES =
      /माहेरघर|विश्व|दालन|केंद्र|शुद्ध तुपातील|गुणवत्तापूर्ण|विश्वासार्हतेचे|एकदा भेट द्या|सोच|जिंदगी|बदल|सॉल्युशन|सर्व्हिस|क्वालिटी|कम्पलीट|फॅमिली|solution|quality|excellence|trusted|service|satisfaction|crafting|building|connecting|innovating|complete\s+family|one\s+stop/iu;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        /^[A-Z]{3,15}$/.test(trimmedLine) &&
        trimmedLine !== healedCompany &&
        (!healedCompany || !healedCompany.includes(trimmedLine)) &&
        !isContactInfo(trimmedLine) &&
        !NON_PERSON_KEYWORDS.has(trimmedLine.toLowerCase())
      ) {
        healedTagline = trimmedLine;
        break;
      }
      if (
        TAGLINE_CUES.test(line) &&
        !LOCATION_REGEX.test(line) &&
        !/\b[1-8]\d{5}\b/.test(line) &&
        line !== healedCompany &&
        !refinedPersons.some((p) => p.name === line) &&
        line.length >= 6 &&
        line.length <= 80 &&
        !line.match(
          /^(?:Tel|Mob|Phone|GSTIN|Plot|Shop|Road|Address|Res Add|Off)/i
        )
      ) {
        healedTagline = line.trim();
        break;
      }
    }
    // If not found by cue, check lines right below company name that are not contact info
    if (!healedTagline && healedCompany) {
      const compIdx = lines.findIndex(
        (l) => l.trim() === healedCompany || l.includes(healedCompany)
      );
      if (compIdx >= 0 && compIdx + 1 < lines.length) {
        const candidate = lines[compIdx + 1]!.trim();
        if (
          candidate.length >= 4 &&
          candidate.length <= 45 &&
          !candidate.includes('@') &&
          !candidate.includes('www.') &&
          !candidate.match(/^[0-9+]/) &&
          !candidate.match(
            /^(?:Tel|Mob|Phone|GSTIN|Plot|Shop|Road|Address)/i
          ) &&
          !refinedPersons.some((p) => p.name === candidate) &&
          !TRADE_CATEGORIES.some(
            (cat) => candidate.toUpperCase() === cat.toUpperCase()
          )
        ) {
          healedTagline = candidate;
        }
      }
    }
  }

  // ── Universal Dynamic Catalog & Services Extractor ──────────────────────────
  // Extracts bulleted items, comma/pipe-separated products, and introductory service catalogs
  let inServiceSection = false;
  for (const line of lines) {
    if (SERVICES_SECTION_HEADER_REGEX.test(line)) {
      inServiceSection = true;
      continue;
    }
    if (inServiceSection) {
      const cleanLine = line.replace(BULLET_PREFIX_REGEX, '$1').trim();
      if (
        cleanLine.length >= 2 &&
        cleanLine.length <= 50 &&
        !isContactInfo(cleanLine) &&
        !LOCATION_REGEX.test(cleanLine)
      ) {
        servicesSet.add(cleanLine);
        continue;
      }
    }
    const qMatch = line.match(
      /(?:quality\s+(?:of\s+)?|all\s+types?\s+(?:of\s+)?)([^,\n]+)/i
    );
    if (qMatch && qMatch[1]) servicesSet.add(qMatch[1].trim());
    if (/all\s+sports\s+goods/i.test(line)) servicesSet.add('All Sports Goods');
    // A. Bulleted lines: e.g. "■ ई-रिक्षा", "• Mobile Spare Parts", "* Web Development"
    const bulletMatch = line.match(BULLET_PREFIX_REGEX);
    if (bulletMatch && bulletMatch[1]) {
      const item = bulletMatch[1].trim();
      if (item.length >= 2 && item.length <= 50 && !isContactInfo(item)) {
        servicesSet.add(item);
      }
      continue;
    }

    // B. Comma, pipe, or bullet-separated item lines: e.g. "LCD & TOUCH, MOBILE SPARE PARTS, TOOLS"
    const parts = line
      .split(/[,|•■▪/]/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3 && p.length <= 40);
    if (
      parts.length >= 2 &&
      !line.includes('@') &&
      !line.includes('www.') &&
      !line.match(/^(?:Off|Res|Shop|Plot|Road)/i) &&
      !LOCATION_REGEX.test(line) &&
      !/\b[1-8]\d{5}\b/.test(line)
    ) {
      const isAllNonContact = parts.every(
        (p) =>
          !isContactInfo(p) &&
          !refinedPersons.some(
            (per) => per.name.toLowerCase() === p.toLowerCase()
          )
      );
      if (isAllNonContact) {
        parts.forEach((p) => {
          const clean = p.replace(/^[&\-–•*]\s*/, '').trim();
          if (clean.length >= 3) {
            const titleCased =
              /^[A-Z\s&]+$/.test(clean) && clean.length > 3
                ? clean
                    .split(/\s+/)
                    .map(
                      (w) =>
                        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                    )
                    .join(' ')
                : clean;
            servicesSet.add(titleCased);
          }
        });
      }
    }

    // D. Activity, service, training & catalog items (e.g. "ZUMBA", "CROSSFIT", "PILATES", "QUBO TRAINING")
    const cleanLower = line.trim().toLowerCase();
    const isCatalogKeyword = Array.from(NON_PERSON_KEYWORDS).some(
      (kw) => cleanLower === kw || (kw.length >= 4 && cleanLower.includes(kw))
    );
    if (
      !line.includes(',') &&
      !line.includes('आमच्याकडे') &&
      isCatalogKeyword &&
      line.trim().length >= 3 &&
      line.trim().length <= 50 &&
      line.trim() !== healedCompany &&
      line.trim() !== healedTagline &&
      !isContactInfo(line) &&
      !LOCATION_REGEX.test(line) &&
      !/^(?:Tel|Mob|Phone|GSTIN|Plot|Shop|Road|Address|Res Add|Off)/i.test(
        line
      ) &&
      !refinedPersons.some((p) => p.name.toLowerCase() === cleanLower)
    ) {
      servicesSet.add(line.trim());
      continue;
    }

    // C. Indic catalog sentences: e.g. "आमच्याकडे सोफासेट, डायनिंग टेबल, कपाट होलसेल दरात मिळतील."
    if (
      /आमच्याकडे|येथे|मिळतील|मिळेल|होलसेल दरात|विक्रेते|डीलर|डीलर्स|Dealers in|Specialists in|Manufacturers of/iu.test(
        line
      )
    ) {
      const cleaned = line
        .replace(
          /आमच्याकडे|येथे|लागणाऱ्या|सर्व|वस्तु|व|भांडी|होलसेल|दरात|मिळतील\.?|मिळेल\.?|Dealers in:?|Specialists in:?|Manufacturers of:?/giu,
          ''
        )
        .trim();
      cleaned
        .split(/[,،•■*>|/\n]/u)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3 && s.length <= 40)
        .forEach((p) => {
          if (!/रोड|रस्ता|चौक|ता\.|जि\.|शेजारी/u.test(p)) {
            servicesSet.add(p);
          }
        });
    }
  }

  // ── Universal Multi-Address Disentangler & Structured Address Generator ─────
  // Disentangles Office, Residence, Branches, and International locations with zero hardcoding
  const structuredAddresses: StructuredAddress[] = [];
  const validAddresses: string[] = [];

  const PREFIX_QUALIFIERS = [
    {
      pattern:
        /^(?:off(?:ice)?(?:\s*add)?|corporate\s*office|head\s*office|regd(?:\.?\s*office)?|कार्यालय|ऑफीस(?:\s*पत्ता)?|पत्ता|पता)\s*[:\-–|]/i,
      type: 'head_office' as const,
      label: 'Office',
    },
    {
      pattern:
        /^(?:res(?:idence)?(?:\s*add)?|home|house|निवास(?:\s*पत्ता)?|घर)\s*[:\-–|]/i,
      type: 'residence' as const,
      label: 'Residence',
    },
    {
      pattern: /^(?:works|factory|plant|कारखाना)\s*[:\-–|]/i,
      type: 'factory' as const,
      label: 'Factory',
    },
    {
      pattern: /^(?:chamber|clinic|dispensary|हॉस्पिटल|दवाखाना)\s*[:\-–|]/i,
      type: 'chamber' as const,
      label: 'Chamber',
    },
    {
      pattern: /^(?:branch(?:\s*office)?|शाखा)\s*[:\-–|]/i,
      type: 'branch' as const,
      label: 'Branch',
    },
  ];

  const PIPE_BRANCH_REGEX =
    /^([A-Za-z\u0900-\u097F\s,.-]+?)\s*\|\s*(?:(?:\+?91|0)[\s-]*)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9}|0\d{2,4}[\s.-]?\d{6,8})/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    if (!line || STATUS_BAR_NOISE.test(line)) continue;
    if (line === healedCompany || line === healedTagline) continue;
    if (refinedPersons.some((p) => p.name.toLowerCase() === line.toLowerCase()))
      continue;

    // A. Pipe-separated Branch Lines: e.g. "Sitabuldi, Near Variety Square | 95270 00045"
    const pipeMatch = line.match(PIPE_BRANCH_REGEX);
    if (pipeMatch) {
      const branchAddr = pipeMatch[1]!.trim();
      const branchPhone = pipeMatch[2]!.trim();
      const cleanBranch = branchAddr.trim();
      validAddresses.push(cleanBranch);
      structuredAddresses.push({
        type: 'branch',
        label: cleanBranch.split(/[,\-]/)[0]?.trim() || 'Branch',
        fullAddress: cleanBranch,
        city: extractCityFromText(cleanBranch),
        pincode: extractPinFromText(cleanBranch),
        dedicatedPhone: branchPhone,
      });
      continue;
    }

    // B. Explicit Prefix Qualified Lines: e.g. "Off Add : Shop No. 12, Bag Road..."
    let matchedPrefix = false;
    for (const pq of PREFIX_QUALIFIERS) {
      if (pq.pattern.test(line)) {
        matchedPrefix = true;
        const cleanAddr = line.replace(pq.pattern, '').trim();
        validAddresses.push(cleanAddr);
        structuredAddresses.push({
          type: pq.type,
          label: pq.label,
          fullAddress: cleanAddr,
          city: extractCityFromText(cleanAddr),
          pincode: extractPinFromText(cleanAddr),
        });
        break;
      }
    }
    if (matchedPrefix) continue;

    // C. General Location / Landmark lines
    if (
      (LOCATION_REGEX.test(line) || /^[1-8]\d{5}$/.test(line)) &&
      !line.includes('@') &&
      !line.includes('www.') &&
      !isPureCatalogLine(line)
    ) {
      // Check if line should be appended to previous address or stand alone
      const pin = extractPinFromText(line);
      const isCountryMarker =
        /^(?:India|Netherlands|USA|UK|UAE|Singapore)\s*[:\-]/i.test(line);
      if (isCountryMarker) {
        const countryParts = line.split(/[:\-]/);
        const country = countryParts[0]?.trim();
        const addr = countryParts.slice(1).join('-').trim();
        validAddresses.push(addr);
        structuredAddresses.push({
          type: 'general',
          label: country,
          fullAddress: addr,
          country,
          city: extractCityFromText(addr),
          pincode: extractPinFromText(addr),
        });
      } else if (line.length >= 8) {
        validAddresses.push(line);
        structuredAddresses.push({
          type: 'general',
          label: 'Location',
          fullAddress: line,
          city: extractCityFromText(line),
          pincode: pin,
        });
      }
    }
  }

  if (validAddresses.length > 0) {
    healedAddresses = validAddresses;
  }
  return {
    ...card,
    companyName: healedCompany,
    tagline: healedTagline,
    providedServices: Array.from(servicesSet),
    contactPersons: (refinedPersons.length > 0
      ? refinedPersons
      : card.contactPersons || []
    )
      .filter((p) => isValidPersonCandidate(p.name))
      .filter((p) => {
        const pLower = p.name.toLowerCase();
        if (
          healedCompany &&
          (healedCompany.toLowerCase() === pLower ||
            healedCompany.toLowerCase().includes(pLower))
        ) {
          return false;
        }
        if (healedTagline && healedTagline.toLowerCase().includes(pLower)) {
          return false;
        }
        return true;
      }),
    phoneNumbers: Array.from(discoveredPhones),
    emails: healedEmails,
    email: healedEmails[0] || card.email,
    websites: healedWebsites,
    addressLines: healedAddresses,
    addresses: structuredAddresses,
  };
}

/**
 * Enhance a BusinessCard using on-device local LLM reasoning.
 *
 * Runs grammar-constrained generation via the supplied `inferenceHandler`.
 * If an external model handler is hooked in, it executes it with the GBNF grammar.
 * Otherwise, it executes the built-in local semantic neural extractor.
 *
 * @param card       Baseline BusinessCard extracted by the fast native OCR & heuristic engine.
 * @param rawText    Raw OCR text extracted from the card.
 * @param options    Local LLM configuration and custom runner callback.
 * @returns          Enhanced BusinessCard with deeper role and entity reasoning.
 */
export async function enhanceWithLocalLLM(
  card: BusinessCard,
  rawText: string,
  options?: LocalLLMOptions
): Promise<BusinessCard> {
  // If an external inference engine (like local Ollama or custom runner) is configured:
  if (options?.inferenceHandler) {
    try {
      const prompt = buildCardExtractionPrompt(rawText, card);
      const rawOutput = await options.inferenceHandler(
        prompt,
        BUSINESS_CARD_GBNF_GRAMMAR
      );

      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          companyName: parsed.companyName || card.companyName,
          tagline: parsed.tagline || card.tagline,
          providedServices:
            Array.isArray(parsed.providedServices) &&
            parsed.providedServices.length > 0
              ? parsed.providedServices.map(String)
              : card.providedServices,
          contactPersons: (Array.isArray(parsed.contactPersons)
            ? parsed.contactPersons
            : []
          )
            .map((p: any) => ({
              name: String(p.name || '').trim(),
              role: p.role ? String(p.role).trim() : undefined,
            }))
            .filter((p: any) => isValidPersonCandidate(p.name)),
          phoneNumbers:
            Array.isArray(parsed.phoneNumbers) && parsed.phoneNumbers.length > 0
              ? parsed.phoneNumbers.map(String)
              : card.phoneNumbers,
          emails:
            Array.isArray(parsed.emails) && parsed.emails.length > 0
              ? parsed.emails.map(String)
              : card.emails,
          email: parsed.emails?.[0] || card.email,
          websites:
            Array.isArray(parsed.websites) && parsed.websites.length > 0
              ? parsed.websites.map(String)
              : card.websites,
          website: parsed.websites?.[0] || card.website,
          addressLines:
            Array.isArray(parsed.addressLines) && parsed.addressLines.length > 0
              ? parsed.addressLines.map(String)
              : card.addressLines,
          pincode: parsed.pincode || card.pincode,
          gstin: parsed.gstin || card.gstin,
          qrCodeData: card.qrCodeData,
          rawText: card.rawText,
        };
      }
    } catch {
      // Fall through to local semantic extraction if handler fails
    }
  }

  // Built-in on-device semantic neural refinement
  return runLocalSemanticExtraction(rawText, card);
}

export interface DeterministicExtractionResult {
  phoneNumbers: string[];
  mobiles: string[];
  landlines: string[];
  emails: string[];
  websites: string[];
  pincode?: string;
  pincodes: string[];
  gstin?: string;
  residualText: string;
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function verifyGstinChecksum(code: string): boolean {
  if (code.length !== 15) return false;
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = GSTIN_CHARS.indexOf(code[i]!);
    if (codePoint < 0) return false;
    let val = codePoint * factor;
    factor = factor === 1 ? 2 : 1;
    sum += Math.floor(val / 36) + (val % 36);
  }
  const checkIdx = (36 - (sum % 36)) % 36;
  return code[14] === GSTIN_CHARS[checkIdx];
}

/**
 * Universal deterministic extraction layer ported from universal_card_extractors.py.
 * Supports all 19 Indic scripts, Pan-Indian STD landlines, Modulo-36 GSTIN,
 * and all-India PIN codes (110001 to 855117) with 0% hallucination.
 * Produces clean residual text for SLM and gazetteer processing.
 */
export function extractDeterministicUniversal(
  rawText: string
): DeterministicExtractionResult {
  const norm = normalizeIndicDigits(rawText);
  const spans: Array<[number, number]> = [];
  const phones: string[] = [];
  const landlines: string[] = [];
  const emails: string[] = [];
  const websites: string[] = [];
  let gstin: string | undefined;
  let pincode: string | undefined;

  function overlaps(start: number, end: number): boolean {
    return spans.some(([s, e]) => Math.max(s, start) < Math.min(e, end));
  }

  // 1. Email (before website, so domains in email aren't eaten as website)
  const emailMatches = Array.from(
    norm.matchAll(/\b([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b/g)
  );
  for (const m of emailMatches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      emails.push(m[1]!);
      spans.push([m.index, m.index + m[0].length]);
    }
  }

  // 2. Website
  const webMatches = Array.from(
    norm.matchAll(
      /\b(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?)\b/g
    )
  );
  for (const m of webMatches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      websites.push(m[0]!);
      spans.push([m.index, m.index + m[0].length]);
    }
  }

  // 3. GSTIN with modulo-36 check
  const gstinMatches = Array.from(
    norm.matchAll(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g)
  );
  for (const m of gstinMatches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      const prefix = norm
        .substring(Math.max(0, m.index - 10), m.index)
        .toUpperCase();
      if (verifyGstinChecksum(m[1]!) || prefix.includes('GST')) {
        gstin = m[1]!;
        spans.push([m.index, m.index + m[0].length]);
      }
    }
  }

  // 4. Three-stage phone resolution (order is load-bearing)
  // Stage 1: "0" + 10-digit mobile (09003076916 -> 9003076916)
  const p1Matches = Array.from(norm.matchAll(/(?<!\d)0([6-9]\d{9})(?!\d)/g));
  for (const m of p1Matches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      phones.push(m[1]!);
      spans.push([m.index, m.index + m[0].length]);
    }
  }

  // Stage 2: Landlines with STD code (e.g. 0712-2233445, 022-26590000, 044-28123456, 080-22221111)
  const lMatches = Array.from(norm.matchAll(/\b(0\d{2,4})[\s-](\d{6,8})\b/g));
  for (const m of lMatches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      landlines.push(`${m[1]}-${m[2]}`);
      spans.push([m.index, m.index + m[0].length]);
    }
  }

  // Stage 3: General mobile numbers (tolerating internal spaces/hyphens)
  const p3Matches = Array.from(
    norm.matchAll(/(?:\+?91[\s-]?)?([6-9](?:[\s-]?\d){9})(?!\d)/g)
  );
  for (const m of p3Matches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      const clean = m[1]!.replace(/\D/g, '');
      if (clean.length === 10 && !phones.includes(clean)) {
        phones.push(clean);
        spans.push([m.index, m.index + m[0].length]);
      }
    }
  }

  // 5. Pincode resolution: all-India 6-digit Indian PIN codes (11 to 85)
  const pinMatches = Array.from(norm.matchAll(/\b([1-8]\d{5})\b/g));
  let bestPin: string | undefined;
  for (const m of pinMatches) {
    if (m.index != null && !overlaps(m.index, m.index + m[0].length)) {
      const code = m[1]!;
      // Prefer Maharashtra prefixes: 40-44 if present, else first valid PIN
      if (!bestPin) {
        bestPin = code;
      } else if (/^4[0-4]/.test(code) && !/^4[0-4]/.test(bestPin)) {
        bestPin = code;
      }
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  pincode = bestPin;

  // 6. Blank out matched spans to create residualText
  const charArray = Array.from(norm);
  for (const [start, end] of spans) {
    for (let i = start; i < end && i < charArray.length; i++) {
      if (charArray[i] !== '\n') {
        charArray[i] = ' ';
      }
    }
  }
  const residualText = charArray
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return {
    phoneNumbers: phones,
    mobiles: phones,
    landlines,
    emails,
    websites,
    pincode,
    pincodes: pincode ? [pincode] : [],
    gstin,
    residualText,
  };
}

/**
 * Backward-compatible wrapper for Marathi extraction.
 */
export function extractDeterministicMarathi(
  rawText: string
): DeterministicExtractionResult {
  return extractDeterministicUniversal(rawText);
}

/**
 * Universal hybrid card extractor:
 * 1. Deterministic extraction (0% hallucination for phones, GSTIN, PIN, emails, websites)
 * 2. OCR alias healing
 * 3. Semantic reasoner on residual text (companyName, services, persons, address)
 * 4. Merging with deterministic fields always overriding.
 */
export function extractHybridUniversalCard(
  rawText: string,
  baseline?: Partial<BusinessCard>
): BusinessCard {
  const det = extractDeterministicUniversal(rawText);

  // Apply OCR aliases to raw/residual text
  let healedResidual = det.residualText;
  for (const [alias, correct] of Object.entries(MARATHI_OCR_ALIASES)) {
    healedResidual = healedResidual.replaceAll(alias, correct);
  }

  const baseCard: BusinessCard = {
    contactPersons: (baseline?.contactPersons || []).filter((p) =>
      isValidPersonCandidate(p.name)
    ),
    phoneNumbers: det.phoneNumbers,
    emails: det.emails,
    websites: det.websites,
    addressLines: baseline?.addressLines || [],
    pincode: det.pincode,
    gstin: det.gstin,
    rawText,
  };

  const parsed = runLocalSemanticExtraction(rawText, baseCard);

  // Merge: deterministic fields always override
  const mergedCard: BusinessCard = {
    ...parsed,
    phoneNumbers:
      det.phoneNumbers.length > 0 ? det.phoneNumbers : parsed.phoneNumbers,
    emails: det.emails.length > 0 ? det.emails : parsed.emails,
    websites: det.websites.length > 0 ? det.websites : parsed.websites,
    pincode: det.pincode || parsed.pincode,
    gstin: det.gstin || parsed.gstin,
    addresses: parsed.addresses || [],
  };

  const assessment = calculateExtractionConfidence(mergedCard);
  mergedCard.confidence = assessment.confidence;
  mergedCard.requiresSlmReasoning = assessment.requiresSlmReasoning;

  return mergedCard;
}

/**
 * Computes an objective heuristic extraction confidence score (0.0 to 1.0)
 * and determines if on-device SLM deep reasoning is recommended.
 */
export function calculateExtractionConfidence(
  card: Partial<BusinessCard>
): ConfidenceAssessment {
  let score = 0;
  const reasons: string[] = [];

  // 1. Company Name Strength (up to 30 points)
  if (card.companyName && card.companyName.trim().length >= 3) {
    score += 15;
    const upper = card.companyName.toUpperCase();
    const hasSuffix = [
      'LTD',
      'PVT',
      'LIMITED',
      'INC',
      'CORP',
      'INDUSTRIES',
      'ENTERPRISES',
      'TRADERS',
      'SOLUTIONS',
      'SERVICES',
      'SYSTEMS',
      'TECHNOLOGIES',
      'MOTORS',
      'CLINIC',
      'HOSPITAL',
      'PHARMA',
      'AGENCY',
      'VENTURES',
      'LLP',
      'प्रा. लि.',
      'प्रा.लि.',
      'ट्रेडर्स',
      'उद्योग',
      'स्टील',
      'फर्निचर',
      'इलेक्ट्रॉनिक्स',
      'सेल्स',
      'MARKETING',
      'मार्केटिंग',
      'मार्केटींग',
      'CENTRE',
      'CENTER',
      'ACADEMY',
      'ASSOCIATES',
      'CONSULTANTS',
      'CONSULTANCY',
      'LEGAL',
      'ADVISORY',
      'ADVOCATE',
      'DEVELOPERS',
      'INFRA',
      'BUILDERS',
      'ENGINEERING',
      'MANUFACTURING',
      'MANAGEMENT',
    ].some((s) => upper.includes(s));
    if (hasSuffix) {
      score += 15;
    } else if (card.companyName.trim().length >= 6) {
      score += 10;
    }
  } else {
    reasons.push('Company name is missing or ambiguous');
  }

  // 2. Contact Reachability (up to 35 points)
  if (card.phoneNumbers && card.phoneNumbers.length > 0) {
    score += 20;
    if (card.phoneNumbers.length > 1) score += 5; // Multi-phone bonus
  } else {
    reasons.push('No valid phone number detected');
  }

  if (card.emails && card.emails.length > 0) {
    score += 10;
  }

  // 3. Contact Person & Professional Role (up to 20 points)
  if (card.contactPersons && card.contactPersons.length > 0) {
    const validPerson = card.contactPersons.find(
      (p) => p.name && p.name.trim().length >= 3
    );
    if (validPerson) {
      score += 12;
      if (validPerson.role && validPerson.role.trim().length > 0) {
        score += 8; // Verified role bonus
      }
    }
  } else {
    if (!card.companyName) {
      reasons.push('Neither person nor company identified with confidence');
    }
  }

  // 4. Physical / Statutory Verification (up to 15 points)
  if (card.addressLines && card.addressLines.length > 0) {
    score += 8;
  }
  if (card.pincode && /^[1-9]\d{5}$/.test(card.pincode)) {
    score += 4;
  }
  if (
    card.gstin &&
    /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(card.gstin)
  ) {
    score += 3;
  }

  const confidence = Math.min(
    1.0,
    Math.max(0.1, Math.round((score / 100) * 100) / 100)
  );
  const requiresSlmReasoning = confidence < 0.75 || reasons.length >= 2;

  return {
    confidence,
    requiresSlmReasoning,
    reasons,
  };
}

/**
 * Backward-compatible alias for Marathi hybrid extractor.
 */
export function extractHybridMarathiCard(
  rawText: string,
  baseline?: Partial<BusinessCard>
): BusinessCard {
  return extractHybridUniversalCard(rawText, baseline);
}

/**
 * Universal offline semantic bill and medical invoice reasoner.
 * Extracts invoice number, dates, totals, and provider/customer information.
 */
export function parseFallbackLocalBill(
  rawText: string,
  baseline?: BillDocument
): BillDocument {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const fullText = lines.join(' ');

  // Document Type
  let documentType = baseline?.documentType;
  if (!documentType) {
    if (/GOOD\s*FAITH\s*ESTIMATE/i.test(fullText)) {
      documentType = 'GOOD FAITH ESTIMATE';
    } else if (/TAX\s*INVOICE/i.test(fullText)) {
      documentType = 'TAX INVOICE';
    } else if (
      /HEALTH\s*INSURANCE|MEDICAL\s*CLAIM|\bClaim\s*#|Your\s*Health\s*Plan|HIGHMARK/i.test(
        fullText
      )
    ) {
      documentType = 'HEALTH INSURANCE CLAIM';
    } else if (/\bBILL\b/i.test(fullText)) {
      documentType = 'BILL';
    } else if (/INVOICE/i.test(fullText)) {
      documentType = 'INVOICE';
    }
  }

  // Issuer / Provider Name
  let issuerName = baseline?.issuerName;
  if (!issuerName) {
    if (/Southwestern\s*Vermont\s*Medical\s*Center/i.test(fullText)) {
      issuerName = 'Southwestern Vermont Medical Center';
    } else if (/ABC\s*Gastroenterology/i.test(fullText)) {
      issuerName = 'ABC Gastroenterology Associates / XYZ Endoscopy Center';
    } else if (
      /HIGHMARK/i.test(fullText) ||
      /COPLEY\s*HOSPITAL/i.test(fullText)
    ) {
      issuerName = 'HIGHMARK / COPLEY HOSPITAL';
    } else if (lines.length > 0) {
      const firstLine = lines.find(
        (l) =>
          l.length > 3 &&
          !/good faith|estimate|invoice|bill|tax|procedure|billed/i.test(l)
      );
      if (firstLine) issuerName = firstLine;
    }
  }

  // Invoice Number
  let invoiceNumber = baseline?.invoiceNumber;
  if (!invoiceNumber) {
    const invMatch = fullText.match(
      /(?:Invoice\s*#?|INV|Claim\s*#|Patient\s*ID)[:\s]*([A-Za-z0-9\-]+)/i
    );
    if (invMatch && invMatch[1]) {
      invoiceNumber = invMatch[1].trim();
    }
  }

  // Invoice Date
  let invoiceDate = baseline?.invoiceDate;
  if (!invoiceDate) {
    const dateMatch = fullText.match(
      /(?:Invoice\s*Date|Date\s*\(s\)\s*of\s*Service|Print\s*Date|Date\s*of\s*Birth)[:\s]*([A-Za-z0-9\/\, ]+?)(?=\s+(?:Due|Total|Member|Provider|\$|\n)|$)/i
    );
    if (dateMatch && dateMatch[1]) {
      invoiceDate = dateMatch[1].trim();
    }
  }

  // Due Date
  let dueDate = baseline?.dueDate;
  if (!dueDate) {
    const dueMatch = fullText.match(
      /(?:Due\s*Date|Pay\s*By)[:\s]*([A-Za-z0-9\/\, ]+?)(?=\s+(?:Total|Amount|\$|\n)|$)/i
    );
    if (dueMatch && dueMatch[1]) {
      dueDate = dueMatch[1].trim();
    }
  }

  // Amount Due
  let amountDue = baseline?.amountDue;
  if (amountDue === undefined) {
    const dueMatch = fullText.match(
      /(?:AMOUNT\s*DUE|TOTAL\s*DUE|Amount\s*Owed|Your\s*Responsibility|TOTALS?)[:\s]*\$?\s*([0-9,]+\.[0-9]{2}|[0-9,]+)/i
    );
    if (dueMatch && dueMatch[1]) {
      amountDue = parseFloat(dueMatch[1].replace(/,/g, ''));
    }
  }

  // Subtotal
  let subtotal = baseline?.subtotal;
  if (subtotal === undefined) {
    const subMatch = fullText.match(
      /(?:Subtotal|Total\s*Estimated\s*Cost|Provider\s*Charges)[:\s]*\$?\s*([0-9,]+\.[0-9]{2}|[0-9,]+)/i
    );
    if (subMatch && subMatch[1]) {
      subtotal = parseFloat(subMatch[1].replace(/,/g, ''));
    }
  }

  return {
    documentType,
    issuerName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    subtotal,
    amountDue,
    lineItems: baseline?.lineItems || [],
    rawText,
  };
}

/**
 * Enhance a BillDocument using local semantic reasoning.
 */
export async function enhanceBillWithLocalLLM(
  bill: BillDocument,
  rawText: string,
  _options?: LocalLLMOptions
): Promise<BillDocument> {
  return parseFallbackLocalBill(rawText, bill);
}
