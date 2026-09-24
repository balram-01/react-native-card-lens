/**
 * react-native-card-lens — Simple 2-Stage Flow: ML Kit ➔ Efficient LLM
 *
 * 1. Extract card text using Google ML Kit on-device OCR (Total Raw OCR).
 * 2. Display total raw OCR data with instant copy-to-clipboard.
 * 3. User taps "Send to Efficient LLM" (Universal Indic Module).
 * 4. Display raw output directly from the LLM with instant copy-to-clipboard.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LogBox,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

LogBox.ignoreAllLogs();

import {
  startScanner,
  pickDocument,
  recognizeText,
  downloadThinkingModel,
} from 'react-native-card-lens';
import type {
  RawOcrResult,
  ScanResult,
  ThinkingModelDownloadProgress,
} from 'react-native-card-lens';

// ─── System Bar Insets for Android Notch, Edge-to-Edge & Navigation Bar ────
const ANDROID_STATUS_BAR =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0;
const STATUS_BAR_TOP_PADDING =
  Platform.OS === 'android' ? Math.max(ANDROID_STATUS_BAR, 36) + 10 : 20;
const BOTTOM_NAV_PADDING = Platform.OS === 'android' ? 64 : 36;

// ─── Free, Non-Gated GGUF Model (Universal Indic Edition Only) ───────────────
const AVAILABLE_SLM_MODELS = [
  {
    id: 'qwen25-15b-universal-card-q4',
    name: 'Qwen2.5-1.5B Universal Indic',
    tag: 'Universal Indic Edition (1.0 GB)',
    sizeMB: 986,
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    description:
      'Universal 1.5B model specialized for multilingual Indian business cards (Hindi, Marathi, Gujarati, Tamil, Telugu, Bengali, Kannada, English).',
  },
];

const UNIVERSAL_MODEL = AVAILABLE_SLM_MODELS[0]!;
const DOWNLOADED_MODELS_STORAGE_KEY = '@cardlens_downloaded_models';

// ─── User Editable Prompt Template & Storage ────────────────────────────────
const PROMPT_STORAGE_KEY = '@cardlens_user_llm_prompt';

const DEFAULT_PROMPT_TEMPLATE = `<|im_start|>system
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
{{OCR_TEXT}}

Return JSON:
<|im_end|>
<|im_start|>assistant
{`;

/**
 * Apply the user's custom or default prompt template to the raw OCR text.
 * Replaces {{OCR_TEXT}} or ${rawText} if present, or appends the OCR text cleanly.
 */
function applyUserPrompt(template: string, ocrText: string): string {
  const safeTemplate =
    typeof template === 'string' && template.trim()
      ? template
      : DEFAULT_PROMPT_TEMPLATE;
  const safeOcrText = typeof ocrText === 'string' ? ocrText : '';

  if (safeTemplate.includes('{{OCR_TEXT}}')) {
    return safeTemplate.replace('{{OCR_TEXT}}', safeOcrText);
  }
  if (safeTemplate.includes('${rawText}')) {
    return safeTemplate.replace('${rawText}', safeOcrText);
  }
  return `${safeTemplate.trim()}\n\nOCR Text:\n${safeOcrText}\n\nReturn JSON:\n<|im_end|>\n<|im_start|>assistant\n{`;
}

// ─── Every Customizable LLM Setting for Selected Universal Indic Model ───────
export interface LlmSettings {
  // 1. Sampling & Creativity
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  typical_p: number;
  seed: number;

  // 2. Output Limits & Penalties
  n_predict: number;
  penalty_repeat: number;
  penalty_freq: number;
  penalty_present: number;
  penalty_last_n: number;
  stopSequences: string;

  // 3. Structured Grammar & Thinking
  enable_grammar: boolean;
  grammar_text: string;
  enable_thinking: boolean;
  thinking_budget_tokens: number;

  // 4. Hardware & Memory Allocation (initLlama)
  n_threads: number;
  n_ctx: number;
  n_batch: number;
  n_ubatch: number;
  use_mlock: boolean;
  use_mmap: boolean;
  flash_attn: boolean;
  cache_type_k: 'f16' | 'q8_0' | 'q4_0';
  cache_type_v: 'f16' | 'q8_0' | 'q4_0';
  cpu_mask: string;
  no_extra_bufts: boolean;
}

export const DEFAULT_STANDARD_JSON_GRAMMAR = `root ::= object
object ::= "{" ws (entry ("," ws entry)*)? ws "}"
entry ::= string ":" ws value
value ::= string | number | object | array | "true" | "false" | "null"
array ::= "[" ws (value ("," ws value)*)? ws "]"
string ::= "\\"" ([^"\\\\] | "\\\\" ["\\\\/bfnrt])* "\\""
number ::= "-"? [0-9]+ ("." [0-9]+)?
ws ::= [ \\t\\n\\r]*`;

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  temperature: 0.1,
  top_p: 0.95,
  top_k: 40,
  min_p: 0.05,
  typical_p: 1.0,
  seed: -1,

  n_predict: 400,
  penalty_repeat: 1.0,
  penalty_freq: 0.0,
  penalty_present: 0.0,
  penalty_last_n: 64,
  stopSequences: '<|im_end|>, </s>, <|endoftext|>',

  enable_grammar: false,
  grammar_text: DEFAULT_STANDARD_JSON_GRAMMAR,
  enable_thinking: false,
  thinking_budget_tokens: 0,

  n_threads: 4,
  n_ctx: 1024,
  n_batch: 256,
  n_ubatch: 64,
  use_mlock: false,
  use_mmap: true,
  flash_attn: false,
  cache_type_k: 'f16',
  cache_type_v: 'f16',
  cpu_mask: '',
  no_extra_bufts: false,
};

const LLM_SETTINGS_STORAGE_KEY = '@cardlens_llm_settings_v4';

export default function App() {
  // Universal Indic Model is the sole model
  const universalModel = UNIVERSAL_MODEL;

  // OCR & Image State
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scannedImageUris, setScannedImageUris] = useState<string[]>([]);
  const [rawOcrResult, setRawOcrResult] = useState<RawOcrResult | null>(null);
  const [ocrDurationMs, setOcrDurationMs] = useState<number | null>(null);

  // LLM Inference State
  const [rawLlmOutput, setRawLlmOutput] = useState<string | null>(null);
  const [llmDurationMs, setLlmDurationMs] = useState<number | null>(null);
  const [isLlmLoading, setIsLlmLoading] = useState(false);

  // User Prompt State & Persistence
  const [userPrompt, setUserPrompt] = useState<string>(DEFAULT_PROMPT_TEMPLATE);
  const [promptDraft, setPromptDraft] = useState<string>(
    DEFAULT_PROMPT_TEMPLATE
  );
  const [showPromptEditor, setShowPromptEditor] = useState<boolean>(false);
  const [isCustomPrompt, setIsCustomPrompt] = useState<boolean>(false);

  // Model & Inference Settings State & Persistence
  const [llmSettings, setLlmSettings] =
    useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [tempSettings, setTempSettings] =
    useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [activeEngineInfo, setActiveEngineInfo] = useState<{
    engineName: string;
    badgeText: string;
    details: string;
    badgeType: 'green' | 'indigo' | 'amber';
  } | null>(null);

  // Clipboard Copied State
  const [copiedSection, setCopiedSection] = useState<'ocr' | 'llm' | null>(
    null
  );

  // Fullscreen Modal State
  const [fullscreenModal, setFullscreenModal] = useState<{
    title: string;
    subtitle: string;
    badge: string;
    badgeType: 'green' | 'indigo';
    content: string;
    type: 'ocr' | 'llm';
  } | null>(null);

  // SLM / GGUF Download & Manager State
  const [showLlmManager, setShowLlmManager] = useState(false);
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

  const isModelDownloaded = !!downloadedModels[universalModel.id];
  const isModelActive = activeModelId === universalModel.id;
  const isModelDownloading = downloadingModelId === universalModel.id;

  // Load persisted prompt and settings from AsyncStorage on mount
  useEffect(() => {
    // Check persisted downloaded models cache or check on disk
    AsyncStorage.getItem(DOWNLOADED_MODELS_STORAGE_KEY)
      .then((saved) => {
        if (saved && typeof saved === 'string') {
          try {
            const parsed = JSON.parse(saved);
            if (
              parsed &&
              typeof parsed === 'object' &&
              parsed[universalModel.id]
            ) {
              setDownloadedModels(parsed);
              return;
            }
          } catch {}
        }
        // Fallback: Check if the Universal Indic model is already downloaded on disk
        downloadThinkingModel(universalModel.url, universalModel.filename)
          .then((path) => {
            if (path) {
              const updated = { [universalModel.id]: path };
              setDownloadedModels(updated);
              AsyncStorage.setItem(
                DOWNLOADED_MODELS_STORAGE_KEY,
                JSON.stringify(updated)
              ).catch(() => {});
            }
          })
          .catch(() => {
            // Not downloaded yet or first launch
          });
      })
      .catch(() => {});

    AsyncStorage.getItem(PROMPT_STORAGE_KEY)
      .then((saved) => {
        if (saved && typeof saved === 'string' && saved.trim()) {
          setUserPrompt(saved);
          setPromptDraft(saved);
          setIsCustomPrompt(saved.trim() !== DEFAULT_PROMPT_TEMPLATE.trim());
        }
      })
      .catch((err) => {
        console.warn('Failed to load saved prompt', err);
      });

    AsyncStorage.getItem(LLM_SETTINGS_STORAGE_KEY)
      .then((saved) => {
        if (saved && typeof saved === 'string' && saved.trim()) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
              const merged: LlmSettings = {
                ...DEFAULT_LLM_SETTINGS,
                ...parsed,
                cpu_mask:
                  typeof parsed.cpu_mask === 'string'
                    ? parsed.cpu_mask
                    : DEFAULT_LLM_SETTINGS.cpu_mask,
                grammar_text:
                  typeof parsed.grammar_text === 'string'
                    ? parsed.grammar_text
                    : DEFAULT_LLM_SETTINGS.grammar_text,
                stopSequences:
                  typeof parsed.stopSequences === 'string'
                    ? parsed.stopSequences
                    : DEFAULT_LLM_SETTINGS.stopSequences,
              };
              setLlmSettings(merged);
              setTempSettings(merged);
            }
          } catch {}
        }
      })
      .catch((err) => {
        console.warn('Failed to load saved settings', err);
      });
  }, [universalModel.url, universalModel.filename, universalModel.id]);

  const handleSavePrompt = async () => {
    setError(null);
    try {
      const cleanDraft =
        typeof promptDraft === 'string'
          ? promptDraft.trim()
          : DEFAULT_PROMPT_TEMPLATE;
      await AsyncStorage.setItem(PROMPT_STORAGE_KEY, promptDraft);
      setUserPrompt(promptDraft);
      setIsCustomPrompt(cleanDraft !== DEFAULT_PROMPT_TEMPLATE.trim());
      setShowPromptEditor(false);
      setStatusMessage(
        '💾 Custom prompt saved! LLM will strictly use this prompt.'
      );
    } catch (e: any) {
      setError(`Failed to save prompt: ${e.message || String(e)}`);
    }
  };

  const handleResetPrompt = async () => {
    setError(null);
    try {
      await AsyncStorage.removeItem(PROMPT_STORAGE_KEY);
      setUserPrompt(DEFAULT_PROMPT_TEMPLATE);
      setPromptDraft(DEFAULT_PROMPT_TEMPLATE);
      setIsCustomPrompt(false);
      setStatusMessage('🔄 Restored default prompt template.');
    } catch (e: any) {
      setError(`Failed to reset prompt: ${e.message || String(e)}`);
    }
  };

  const handleSaveSettings = async () => {
    setError(null);
    try {
      await AsyncStorage.setItem(
        LLM_SETTINGS_STORAGE_KEY,
        JSON.stringify(tempSettings)
      );
      const hardwareChanged =
        tempSettings.n_threads !== llmSettings.n_threads ||
        tempSettings.n_ctx !== llmSettings.n_ctx ||
        tempSettings.n_batch !== llmSettings.n_batch ||
        tempSettings.n_ubatch !== llmSettings.n_ubatch ||
        tempSettings.use_mlock !== llmSettings.use_mlock ||
        tempSettings.use_mmap !== llmSettings.use_mmap ||
        tempSettings.flash_attn !== llmSettings.flash_attn ||
        tempSettings.cache_type_k !== llmSettings.cache_type_k ||
        tempSettings.cache_type_v !== llmSettings.cache_type_v ||
        tempSettings.no_extra_bufts !== llmSettings.no_extra_bufts ||
        tempSettings.cpu_mask !== llmSettings.cpu_mask;

      setLlmSettings(tempSettings);
      setShowSettingsModal(false);

      if (hardwareChanged && isModelActive) {
        setStatusMessage(
          '🔄 Hardware settings updated. Reloading model into RAM with new configuration...'
        );
        await handleLoadModel(tempSettings);
      } else {
        setStatusMessage('⚙️ Model & inference settings saved!');
      }
    } catch (e: any) {
      setError(`Failed to save settings: ${e.message || String(e)}`);
    }
  };

  const handleResetSettings = async () => {
    setError(null);
    try {
      await AsyncStorage.removeItem(LLM_SETTINGS_STORAGE_KEY);
      setTempSettings(DEFAULT_LLM_SETTINGS);
      setLlmSettings(DEFAULT_LLM_SETTINGS);
      setStatusMessage('🔄 Restored default model & inference settings.');
    } catch (e: any) {
      setError(`Failed to reset settings: ${e.message || String(e)}`);
    }
  };

  // Clear current flow
  const handleClear = () => {
    setScannedImageUris([]);
    setRawOcrResult(null);
    setOcrDurationMs(null);
    setRawLlmOutput(null);
    setLlmDurationMs(null);
    setStatusMessage(null);
    setError(null);
    setCopiedSection(null);
    setFullscreenModal(null);
  };

  // Copy to clipboard helper
  const handleCopyToClipboard = (text: string, section: 'ocr' | 'llm') => {
    try {
      Clipboard.setString(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (e: any) {
      setError(`Clipboard error: ${e.message || String(e)}`);
    }
  };

  // ─── Stage 1: Google ML Kit Extraction Handlers ────────────────────────────

  // Scan with Camera (Multi-page allowed up to 10 pages)
  const handleScanWithCamera = async () => {
    handleClear();
    setLoading(true);
    setStatusMessage('📷 Opening CameraX Document Scanner (Multi-Page)...');

    const t0 = Date.now();
    try {
      const scan: ScanResult = await startScanner({
        pageLimit: 10,
        scannerMode: 'FULL',
        allowGalleryImport: true,
        autoOcr: false,
        script: 'auto',
      });

      const allUris =
        scan.imageUris && scan.imageUris.length > 0
          ? scan.imageUris
          : scan.imageUri
            ? [scan.imageUri]
            : [];

      if (allUris.length === 0) {
        throw new Error('No image captured');
      }

      setScannedImageUris(allUris);

      setStatusMessage(
        allUris.length > 1
          ? `⚡ Running Google ML Kit OCR on ${allUris.length} pages...`
          : '⚡ Running Google ML Kit OCR on captured card...'
      );

      const ocrResults = await Promise.all(
        allUris.map((uri) => recognizeText(uri, 'auto'))
      );

      const combinedRawText =
        ocrResults.length === 1
          ? ocrResults[0]!.rawText
          : ocrResults
              .map((r, i) => `--- Page ${i + 1} ---\n${r.rawText}`)
              .join('\n\n');

      const combinedBlocks = ocrResults.flatMap((r) => r.blocks || []);

      const dur = Date.now() - t0;
      setRawOcrResult({
        blocks: combinedBlocks,
        rawText: combinedRawText,
      });
      setOcrDurationMs(dur);
      setStatusMessage(`✅ Extracted raw OCR with Google ML Kit in ${dur}ms!`);
    } catch (e: any) {
      if (e.code === 'CARDLENS_SCAN_CANCELED') {
        setStatusMessage('Scan cancelled by user.');
      } else {
        setError(e.message || 'ML Kit scan failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Pick Any Document or Image (PDFs, multi-page PDFs, images)
  const handlePickDocument = async () => {
    handleClear();
    setLoading(true);
    setStatusMessage('📂 Opening file picker for Document (PDF) or Image...');

    const t0 = Date.now();
    try {
      const pick: ScanResult = await pickDocument({
        allowPdf: true,
        autoOcr: false,
        script: 'auto',
      });

      const allUris =
        pick.imageUris && pick.imageUris.length > 0
          ? pick.imageUris
          : pick.imageUri
            ? [pick.imageUri]
            : [];

      if (allUris.length === 0) {
        throw new Error('No document or image selected');
      }

      setScannedImageUris(allUris);

      setStatusMessage(
        allUris.length > 1
          ? `⚡ Running Google ML Kit OCR on ${allUris.length} pages...`
          : '⚡ Running Google ML Kit OCR on selected document...'
      );

      const ocrResults = await Promise.all(
        allUris.map((uri) => recognizeText(uri, 'auto'))
      );

      const combinedRawText =
        ocrResults.length === 1
          ? ocrResults[0]!.rawText
          : ocrResults
              .map((r, i) => `--- Page ${i + 1} ---\n${r.rawText}`)
              .join('\n\n');

      const combinedBlocks = ocrResults.flatMap((r) => r.blocks || []);

      const dur = Date.now() - t0;
      setRawOcrResult({
        blocks: combinedBlocks,
        rawText: combinedRawText,
      });
      setOcrDurationMs(dur);
      setStatusMessage(`✅ Extracted raw OCR with Google ML Kit in ${dur}ms!`);
    } catch (e: any) {
      if (e.code === 'CARDLENS_PICK_CANCELED') {
        setStatusMessage('Selection cancelled by user.');
      } else {
        setError(e.message || 'Document selection failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Stage 2: Send Untouched Raw OCR directly to Efficient LLM ─────────────
  const handleSendToEfficientLlm = async () => {
    if (!rawOcrResult?.rawText?.trim()) return;
    setIsLlmLoading(true);
    setRawLlmOutput(null);
    setError(null);

    const rawText = rawOcrResult.rawText;
    const t0 = Date.now();

    try {
      const ctx = llamaContextRef.current;

      if (!ctx) {
        setError(
          `Please load ${universalModel.name} into RAM first (tap the Universal Indic pill at the top, then tap "Load into RAM").`
        );
        setShowLlmManager(true);
        return;
      }

      setStatusMessage(
        `🧠 Running ${universalModel.name} (${llmSettings.n_threads} Threads, T=${llmSettings.temperature})...`
      );
      // Strictly use the user-feeded prompt template
      const prompt = applyUserPrompt(userPrompt, rawText);

      const stopTokens = (
        typeof llmSettings.stopSequences === 'string'
          ? llmSettings.stopSequences
          : DEFAULT_LLM_SETTINGS.stopSequences
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const completionParams: any = {
        prompt,
        n_predict: llmSettings.n_predict,
        temperature: llmSettings.temperature,
        top_p: llmSettings.top_p,
        top_k: llmSettings.top_k,
        min_p: llmSettings.min_p,
        typical_p: llmSettings.typical_p,
        penalty_repeat: llmSettings.penalty_repeat,
        penalty_freq: llmSettings.penalty_freq,
        penalty_present: llmSettings.penalty_present,
        penalty_last_n: llmSettings.penalty_last_n,
        stop:
          stopTokens.length > 0
            ? stopTokens
            : ['<|im_end|>', '</s>', '<|endoftext|>'],
        enable_thinking: llmSettings.enable_thinking,
      };

      if (llmSettings.seed >= 0) {
        completionParams.seed = llmSettings.seed;
      }
      if (llmSettings.thinking_budget_tokens > 0) {
        completionParams.thinking_budget_tokens =
          llmSettings.thinking_budget_tokens;
      }
      if (
        llmSettings.enable_grammar &&
        typeof llmSettings.grammar_text === 'string' &&
        llmSettings.grammar_text.trim()
      ) {
        completionParams.grammar = llmSettings.grammar_text.trim();
      }

      const result = await ctx.completion(completionParams);

      const dur = Date.now() - t0;
      setLlmDurationMs(dur);
      setActiveEngineInfo({
        engineName: universalModel.name,
        badgeText: `🤖 ${universalModel.name}`,
        details: `${llmSettings.n_threads} Threads • T=${llmSettings.temperature} • max=${llmSettings.n_predict}${
          llmSettings.enable_grammar ? ' • GBNF' : ''
        }${llmSettings.seed >= 0 ? ` • Seed=${llmSettings.seed}` : ''}`,
        badgeType: 'indigo',
      });
      const trimmed = result.text.trim();
      const fullOutput = trimmed.startsWith('{') ? trimmed : `{\n  ${trimmed}`;
      setRawLlmOutput(fullOutput);
      setStatusMessage(
        `✨ Raw LLM output generated using ${isCustomPrompt ? 'user-feeded' : 'configured'} prompt in ${dur}ms!`
      );
    } catch (err: any) {
      setError(err.message || 'LLM extraction failed');
    } finally {
      setIsLlmLoading(false);
    }
  };

  // ─── GGUF Model Management (Universal Indic Model Only) ───────────────────
  const handleDownloadModel = async () => {
    setDownloadingModelId(universalModel.id);
    setError(null);
    setDownloadProgress({
      fileName: universalModel.filename,
      downloadedBytes: 0,
      totalBytes: universalModel.sizeMB * 1024 * 1024,
      percentage: 0,
    });
    setStatusMessage(`Downloading ${universalModel.name}...`);
    try {
      const localPath = await downloadThinkingModel(
        universalModel.url,
        universalModel.filename,
        (prog) => setDownloadProgress(prog)
      );
      const updatedModels = { [universalModel.id]: localPath };
      setDownloadedModels(updatedModels);
      try {
        await AsyncStorage.setItem(
          DOWNLOADED_MODELS_STORAGE_KEY,
          JSON.stringify(updatedModels)
        );
      } catch {}
      setStatusMessage(`✅ Downloaded: ${universalModel.name}`);
    } catch (e: any) {
      setError(e.message || 'Model download failed');
    } finally {
      setDownloadingModelId(null);
      setDownloadProgress(null);
    }
  };

  const handleLoadModel = async (overrideSettings?: LlmSettings) => {
    setError(null);

    // If called directly from an event handler or with incomplete settings, fall back to llmSettings
    const isValidSettings =
      overrideSettings &&
      typeof overrideSettings === 'object' &&
      typeof overrideSettings.n_threads === 'number' &&
      !('nativeEvent' in overrideSettings) &&
      !('_dispatchInstances' in overrideSettings);

    const rawSettings = isValidSettings ? overrideSettings : llmSettings;

    const settings: LlmSettings = {
      ...DEFAULT_LLM_SETTINGS,
      ...(rawSettings || {}),
    };
    const targetPath = downloadedModels[universalModel.id];

    if (!targetPath) {
      setError(`Model file for ${universalModel.name} not found on device.`);
      return;
    }

    const cpuMask =
      typeof settings?.cpu_mask === 'string' ? settings.cpu_mask.trim() : '';

    setSlmLoading(true);
    setStatusMessage(
      `Loading ${universalModel.name} into RAM via llama.rn (${settings.n_threads}T, ${settings.n_ctx} ctx)...`
    );
    try {
      if (llamaContextRef.current) {
        await llamaContextRef.current.release();
        llamaContextRef.current = null;
      }

      const ctx = await initLlama({
        model: targetPath,
        use_mlock: Boolean(settings.use_mlock),
        use_mmap: settings.use_mmap ?? true,
        n_ctx: settings.n_ctx || 1024,
        n_threads: settings.n_threads || 4,
        n_batch: settings.n_batch || 256,
        n_ubatch: settings.n_ubatch || 64,
        flash_attn: Boolean(settings.flash_attn),
        cache_type_k: settings.cache_type_k || 'f16',
        cache_type_v: settings.cache_type_v || 'f16',
        no_extra_bufts: Boolean(settings.no_extra_bufts),
        ...(cpuMask ? { cpu_mask: cpuMask } : {}),
      });
      llamaContextRef.current = ctx;
      setActiveModelId(universalModel.id);
      setStatusMessage(
        `🟢 Active in RAM: ${universalModel.name}! (${settings.n_threads} threads, ${settings.n_ctx} ctx)`
      );
      setShowLlmManager(false);
    } catch (e: any) {
      setError(
        `Failed to load ${universalModel.name}: ${e.message || String(e)}`
      );
      setActiveModelId(null);
    } finally {
      setSlmLoading(false);
    }
  };

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

  return (
    <View style={styles.safeArea}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.appTitle}>CardLens</Text>
              <Text style={styles.appSubtitle}>
                ML Kit Total Raw OCR ➔ Universal Indic LLM
              </Text>
            </View>

            {/* Universal Indic Model Pill Button */}
            <TouchableOpacity
              style={[
                styles.llmHeaderPill,
                isModelActive ? styles.llmHeaderPillActive : null,
              ]}
              onPress={() => setShowLlmManager(!showLlmManager)}
              activeOpacity={0.7}
            >
              <Text style={styles.llmHeaderPillDot}>
                {isModelActive ? '🟢' : '🧠'}
              </Text>
              <Text style={styles.llmHeaderPillText}>
                {isModelActive ? 'Universal Indic (Active)' : 'Universal Indic'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Model Manager Dropdown (Collapsible) */}
        {showLlmManager && (
          <View style={styles.llmManagerCard}>
            <View style={styles.llmManagerHeader}>
              <View>
                <Text style={styles.llmManagerTitle}>
                  🧠 Universal Indic Module
                </Text>
                <Text style={styles.llmManagerSubtitle}>
                  Offline on-device inference via llama.rn
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLlmManager(false)}
                style={styles.llmCloseBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.llmCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.modelCard,
                styles.modelCardSelected,
                isModelActive && styles.modelCardActive,
              ]}
            >
              <View style={styles.modelHeaderRow}>
                <Text style={styles.modelNameText}>{universalModel.name}</Text>
                <View style={styles.modelTagBadge}>
                  <Text style={styles.modelTagText}>
                    {universalModel.sizeMB} MB
                  </Text>
                </View>
              </View>
              <Text style={styles.modelDescText}>
                {universalModel.description}
              </Text>
              <View style={styles.modelStatusRow}>
                {isModelActive ? (
                  <Text style={styles.statusActiveText}>
                    🟢 Loaded in RAM (Ready)
                  </Text>
                ) : isModelDownloading ? (
                  <Text style={styles.statusDownloadingText}>
                    ⏳ Downloading ({downloadProgress?.percentage ?? 0}%)
                  </Text>
                ) : isModelDownloaded ? (
                  <Text style={styles.statusDownloadedText}>
                    💾 Ready on Device Storage
                  </Text>
                ) : (
                  <Text style={styles.statusNotDownloadedText}>
                    ☁️ Available to Download (1.0 GB)
                  </Text>
                )}
              </View>
            </View>

            {/* Model Actions */}
            <View style={styles.modelActionRow}>
              {isModelActive ? (
                <TouchableOpacity
                  style={styles.modelActionBtnDanger}
                  onPress={handleUnloadModel}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modelActionBtnText}>Unload from RAM</Text>
                </TouchableOpacity>
              ) : isModelDownloaded ? (
                <TouchableOpacity
                  style={styles.modelActionBtnPrimary}
                  onPress={() => handleLoadModel()}
                  disabled={slmLoading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modelActionBtnText}>
                    {slmLoading
                      ? 'Loading into RAM...'
                      : 'Load into RAM (llama.rn)'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.modelActionBtnPrimary}
                  onPress={handleDownloadModel}
                  disabled={isModelDownloading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modelActionBtnText}>
                    {isModelDownloading
                      ? `Downloading (${downloadProgress?.percentage ?? 0}%)...`
                      : `Download Universal Indic Model (${universalModel.sizeMB} MB)`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Active Settings Summary Chips */}
            <View style={styles.modelSettingsSummaryRow}>
              <View style={styles.settingsSummaryChip}>
                <Text style={styles.settingsSummaryChipText}>
                  {llmSettings.n_threads} Threads • {llmSettings.n_ctx} Ctx
                </Text>
              </View>
              <View style={styles.settingsSummaryChip}>
                <Text style={styles.settingsSummaryChipText}>
                  T={llmSettings.temperature} • max={llmSettings.n_predict}
                </Text>
              </View>
            </View>

            {/* Configure Extraction Prompt & Model Settings Buttons */}
            <View style={styles.modelConfigButtonsRow}>
              <TouchableOpacity
                style={styles.modelPromptConfigBtn}
                onPress={() => {
                  setPromptDraft(userPrompt);
                  setShowPromptEditor(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.modelPromptConfigBtnText}>
                  {isCustomPrompt ? '✏️ Custom Prompt' : '✏️ Prompt'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modelSettingsConfigBtn}
                onPress={() => {
                  setTempSettings({ ...llmSettings });
                  setShowSettingsModal(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.modelSettingsConfigBtnText}>
                  ⚙️ Settings
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Status Message & Error */}
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

        {/* ─── STAGE 1: CARD EXTRACTION WITH GOOGLE ML KIT ─────────────────────── */}
        <View style={styles.sectionContainer}>
          <Text style={styles.stepTitle}>
            Stage 1: Extract Card with Google ML Kit
          </Text>
          <Text style={styles.stepSub}>
            Total Raw OCR • Multi-Page Cards (Front & Back) & Documents (PDF /
            Images)
          </Text>

          <View style={styles.actionButtonRow}>
            <TouchableOpacity
              style={[styles.primaryActionBtn, loading && styles.btnDisabled]}
              onPress={handleScanWithCamera}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.actionBtnIcon}>📷</Text>
              <Text style={styles.actionBtnTitle}>Scan Card</Text>
              <Text style={styles.actionBtnSub}>Multi-Page (up to 10)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionBtn, loading && styles.btnDisabled]}
              onPress={handlePickDocument}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.actionBtnIcon}>📂</Text>
              <Text style={styles.actionBtnTitle}>Pick Document</Text>
              <Text style={styles.actionBtnSub}>PDFs & All Images</Text>
            </TouchableOpacity>
          </View>

          {/* Scanned Image / Multi-Page Preview */}
          {scannedImageUris.length > 0 && (
            <View style={styles.imagePreviewBox}>
              <Text style={styles.imagePreviewLabel}>
                {scannedImageUris.length === 1
                  ? 'Captured Card Page:'
                  : `Captured Pages (${scannedImageUris.length} pages):`}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 8 }}
              >
                {scannedImageUris.map((uri, idx) => (
                  <View key={idx} style={styles.multiThumbCard}>
                    <Image
                      source={{ uri }}
                      style={styles.multiThumbImg}
                      resizeMode="cover"
                    />
                    <Text style={styles.multiThumbText}>Page {idx + 1}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* ─── TOTAL RAW OCR DATA DISPLAY ────────────────────────────────────── */}
        {rawOcrResult && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.stepTitle}>📄 Total Raw OCR Data</Text>
                <Text style={styles.stepSub}>
                  Pure untouched text extracted directly from Google ML Kit
                </Text>
              </View>
              <View style={styles.badgeRow}>
                <TouchableOpacity
                  style={styles.expandHeaderBtn}
                  onPress={() =>
                    setFullscreenModal({
                      title: '📄 Total Raw OCR Data',
                      subtitle: 'Google ML Kit • Pure untouched text tokens',
                      badge: 'Google ML Kit',
                      badgeType: 'green',
                      content: rawOcrResult.rawText,
                      type: 'ocr',
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.expandHeaderBtnIcon}>⛶</Text>
                  <Text style={styles.expandHeaderBtnText}>Expand</Text>
                </TouchableOpacity>

                <View style={styles.greenBadge}>
                  <Text style={styles.greenBadgeText}>Google ML Kit</Text>
                </View>
                {ocrDurationMs != null && (
                  <View style={styles.purpleBadge}>
                    <Text style={styles.purpleBadgeText}>
                      {ocrDurationMs}ms
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Complete Raw OCR Box */}
            <View style={styles.codeBox}>
              <ScrollView
                nestedScrollEnabled
                style={styles.codeScroll}
                contentContainerStyle={styles.codeScrollContent}
              >
                <Text style={styles.codeText} selectable={true}>
                  {rawOcrResult.rawText}
                </Text>
              </ScrollView>
            </View>

            {/* Actions Bar: Stats + Expand + Copy Button + Clear */}
            <View style={styles.ocrMetaRow}>
              <Text style={styles.ocrMetaText}>
                {rawOcrResult.rawText.length} chars •{' '}
                {
                  rawOcrResult.rawText
                    .split('\n')
                    .filter((l) => l.trim().length > 0).length
                }{' '}
                lines
              </Text>

              <View style={styles.metaActionsRow}>
                <TouchableOpacity
                  style={styles.expandBtn}
                  onPress={() =>
                    setFullscreenModal({
                      title: '📄 Total Raw OCR Data',
                      subtitle: 'Google ML Kit • Pure untouched text tokens',
                      badge: 'Google ML Kit',
                      badgeType: 'green',
                      content: rawOcrResult.rawText,
                      type: 'ocr',
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.expandBtnText}>⛶ Expand</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.copyBtn,
                    copiedSection === 'ocr' && styles.copyBtnSuccess,
                  ]}
                  onPress={() =>
                    handleCopyToClipboard(rawOcrResult.rawText, 'ocr')
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.copyBtnText}>
                    {copiedSection === 'ocr' ? '✅ Copied!' : '📋 Copy'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={handleClear}
                  activeOpacity={0.7}
                >
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Prompt Config Banner with Edit Button */}
            <View style={styles.promptConfigCard}>
              <View style={styles.promptConfigHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Text style={styles.promptConfigTitle}>
                      {isCustomPrompt
                        ? '✏️ Custom Prompt'
                        : '⚙️ Extraction Prompt'}
                    </Text>
                    {isCustomPrompt && (
                      <View style={styles.customPromptBadge}>
                        <Text style={styles.customPromptBadgeText}>
                          User Feeded
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.promptConfigSub}>
                    {isCustomPrompt
                      ? 'LLM will strictly execute your custom saved prompt'
                      : 'Universal Indic default prompt template'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.promptEditBtn}
                  onPress={() => {
                    setPromptDraft(userPrompt);
                    setShowPromptEditor(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.promptEditBtnText}>✏️ Edit Prompt</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ─── STAGE 2: BUTTON TO SEND TO UNIVERSAL INDIC LLM ─────────────── */}
            <View style={styles.sendButtonArea}>
              <TouchableOpacity
                style={[
                  styles.sendLlmButton,
                  isLlmLoading && styles.btnDisabled,
                ]}
                onPress={handleSendToEfficientLlm}
                disabled={isLlmLoading}
                activeOpacity={0.8}
              >
                {isLlmLoading ? (
                  <View style={styles.buttonLoadingRow}>
                    <ActivityIndicator
                      color="#FFFFFF"
                      size="small"
                      style={{ marginRight: 10 }}
                    />
                    <Text style={styles.sendLlmButtonText}>
                      Extracting with Universal Indic LLM...
                    </Text>
                  </View>
                ) : (
                  <View style={styles.buttonReadyRow}>
                    <Text style={styles.sendLlmIcon}>🚀</Text>
                    <Text style={styles.sendLlmButtonText}>
                      Send to Universal Indic LLM
                    </Text>
                    <Text style={styles.sendLlmArrow}>➔</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.engineHintText}>
                Model:{' '}
                <Text style={{ fontWeight: '700', color: '#A5B4FC' }}>
                  {isModelActive
                    ? `${universalModel.name} (Active in RAM • ${llmSettings.n_threads}T • T=${llmSettings.temperature})`
                    : `${universalModel.name} (Not Loaded in RAM)`}
                </Text>
              </Text>
            </View>
          </View>
        )}

        {/* ─── RAW OUTPUT FROM LLM ───────────────────────────────────────────── */}
        {rawLlmOutput && (
          <View style={[styles.sectionContainer, styles.llmSectionHighlight]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.stepTitle}>🤖 Raw LLM Output</Text>
                <Text style={styles.stepSub}>
                  {activeEngineInfo
                    ? activeEngineInfo.details
                    : 'Direct unadulterated output from extraction engine'}
                </Text>
              </View>
              <View style={styles.badgeRow}>
                <TouchableOpacity
                  style={styles.expandHeaderBtn}
                  onPress={() =>
                    setFullscreenModal({
                      title: '🤖 Raw LLM Output',
                      subtitle: activeEngineInfo
                        ? `${activeEngineInfo.engineName} • ${activeEngineInfo.details}`
                        : 'Direct unadulterated output',
                      badge: activeEngineInfo
                        ? activeEngineInfo.badgeText
                        : 'Universal Indic',
                      badgeType:
                        activeEngineInfo?.badgeType === 'green'
                          ? 'green'
                          : 'indigo',
                      content: rawLlmOutput,
                      type: 'llm',
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.expandHeaderBtnIcon}>⛶</Text>
                  <Text style={styles.expandHeaderBtnText}>Expand</Text>
                </TouchableOpacity>

                <View
                  style={
                    activeEngineInfo?.badgeType === 'green'
                      ? styles.greenBadge
                      : activeEngineInfo?.badgeType === 'amber'
                        ? styles.amberBadge
                        : styles.indigoBadge
                  }
                >
                  <Text
                    style={
                      activeEngineInfo?.badgeType === 'green'
                        ? styles.greenBadgeText
                        : activeEngineInfo?.badgeType === 'amber'
                          ? styles.amberBadgeText
                          : styles.indigoBadgeText
                    }
                  >
                    {activeEngineInfo
                      ? activeEngineInfo.badgeText
                      : 'Universal Indic'}
                  </Text>
                </View>
                {llmDurationMs != null && (
                  <View style={styles.greenBadge}>
                    <Text style={styles.greenBadgeText}>
                      ⚡ {llmDurationMs}ms
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Raw Model Output Text Box */}
            <View style={[styles.codeBox, styles.llmCodeBox]}>
              <ScrollView
                nestedScrollEnabled
                style={styles.codeScroll}
                contentContainerStyle={styles.codeScrollContent}
              >
                <Text
                  style={[styles.codeText, styles.llmCodeText]}
                  selectable={true}
                >
                  {rawLlmOutput}
                </Text>
              </ScrollView>
            </View>

            {/* LLM Meta & Expand + Copy Buttons */}
            <View style={styles.ocrMetaRow}>
              <Text style={styles.ocrMetaText}>
                {rawLlmOutput.length} characters
              </Text>

              <View style={styles.metaActionsRow}>
                <TouchableOpacity
                  style={styles.expandBtn}
                  onPress={() =>
                    setFullscreenModal({
                      title: '🤖 Raw LLM Output',
                      subtitle:
                        'Universal Indic LLM • Direct unadulterated output',
                      badge: 'Universal Indic',
                      badgeType: 'indigo',
                      content: rawLlmOutput,
                      type: 'llm',
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.expandBtnText}>⛶ Expand</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.copyBtn,
                    copiedSection === 'llm' && styles.copyBtnSuccess,
                  ]}
                  onPress={() => handleCopyToClipboard(rawLlmOutput, 'llm')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.copyBtnText}>
                    {copiedSection === 'llm' ? '✅ Copied!' : '📋 Copy Output'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ─── FULLSCREEN EXPAND MODAL ────────────────────────────────────────── */}
      {fullscreenModal && (
        <Modal
          visible={true}
          animationType="slide"
          onRequestClose={() => setFullscreenModal(null)}
          statusBarTranslucent={true}
        >
          <View style={styles.fullscreenModalContainer}>
            <StatusBar
              barStyle="light-content"
              backgroundColor="transparent"
              translucent={true}
            />
            <SafeAreaView style={styles.fullscreenSafeArea}>
              {/* Top Navigation Bar */}
              <View style={styles.fullscreenHeader}>
                <TouchableOpacity
                  style={styles.fullscreenCloseBtn}
                  onPress={() => setFullscreenModal(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.fullscreenCloseBtnText}>✕ Close</Text>
                </TouchableOpacity>

                <View style={styles.fullscreenTitleContainer}>
                  <Text style={styles.fullscreenTitle} numberOfLines={1}>
                    {fullscreenModal.title}
                  </Text>
                  <Text style={styles.fullscreenSubtitle} numberOfLines={1}>
                    {fullscreenModal.subtitle}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.copyBtn,
                    copiedSection === fullscreenModal.type &&
                      styles.copyBtnSuccess,
                  ]}
                  onPress={() =>
                    handleCopyToClipboard(
                      fullscreenModal.content,
                      fullscreenModal.type
                    )
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.copyBtnText}>
                    {copiedSection === fullscreenModal.type
                      ? '✅ Copied!'
                      : '📋 Copy'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Stats & Badge Bar */}
              <View style={styles.fullscreenStatsBar}>
                <View style={styles.badgeRow}>
                  <View
                    style={
                      fullscreenModal.badgeType === 'green'
                        ? styles.greenBadge
                        : styles.indigoBadge
                    }
                  >
                    <Text
                      style={
                        fullscreenModal.badgeType === 'green'
                          ? styles.greenBadgeText
                          : styles.indigoBadgeText
                      }
                    >
                      {fullscreenModal.badge}
                    </Text>
                  </View>
                </View>

                <Text style={styles.fullscreenStatsText}>
                  {fullscreenModal.content.length} characters •{' '}
                  {
                    fullscreenModal.content
                      .split('\n')
                      .filter((l) => l.trim().length > 0).length
                  }{' '}
                  lines
                </Text>
              </View>

              {/* Fullscreen Monospace Scroll Area */}
              <View style={styles.fullscreenContentWrapper}>
                <ScrollView
                  style={styles.fullscreenScrollView}
                  contentContainerStyle={styles.fullscreenScrollContent}
                  showsVerticalScrollIndicator={true}
                >
                  <Text
                    style={[
                      styles.codeText,
                      fullscreenModal.type === 'llm' && styles.llmCodeText,
                      styles.fullscreenCodeText,
                    ]}
                    selectable={true}
                  >
                    {fullscreenModal.content}
                  </Text>
                </ScrollView>
              </View>
            </SafeAreaView>
          </View>
        </Modal>
      )}

      {/* ─── FULLSCREEN PROMPT EDITOR MODAL ─────────────────────────────────── */}
      {showPromptEditor && (
        <Modal
          visible={true}
          animationType="slide"
          onRequestClose={() => setShowPromptEditor(false)}
          statusBarTranslucent={true}
        >
          <View style={styles.fullscreenModalContainer}>
            <StatusBar
              barStyle="light-content"
              backgroundColor="transparent"
              translucent={true}
            />
            <SafeAreaView style={styles.fullscreenSafeArea}>
              {/* Top Navigation Bar */}
              <View style={styles.fullscreenHeader}>
                <TouchableOpacity
                  style={styles.fullscreenCloseBtn}
                  onPress={() => setShowPromptEditor(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.fullscreenCloseBtnText}>✕ Cancel</Text>
                </TouchableOpacity>

                <View style={styles.fullscreenTitleContainer}>
                  <Text style={styles.fullscreenTitle} numberOfLines={1}>
                    ✏️ Edit Extraction Prompt
                  </Text>
                  <Text style={styles.fullscreenSubtitle} numberOfLines={1}>
                    Saved to storage • LLM will use this exact prompt
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.savePromptBtn}
                  onPress={handleSavePrompt}
                  activeOpacity={0.7}
                >
                  <Text style={styles.savePromptBtnText}>💾 Save</Text>
                </TouchableOpacity>
              </View>

              {/* Instructions Bar with Reset Button */}
              <View style={styles.promptEditorHelpBar}>
                <Text style={styles.promptEditorHelpText}>
                  Use{' '}
                  <Text style={{ color: '#38BDF8', fontWeight: '700' }}>
                    {'{{OCR_TEXT}}'}
                  </Text>{' '}
                  where the card OCR text should be placed.
                </Text>

                <TouchableOpacity
                  style={styles.resetPromptBtn}
                  onPress={handleResetPrompt}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetPromptBtnText}>
                    🔄 Reset Default
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Multiline TextInput for Prompt */}
              <View style={styles.promptInputWrapper}>
                <TextInput
                  style={styles.promptTextInput}
                  value={promptDraft}
                  onChangeText={setPromptDraft}
                  multiline={true}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textAlignVertical="top"
                  placeholder="Enter your custom prompt template..."
                  placeholderTextColor="#475569"
                />
              </View>
            </SafeAreaView>
          </View>
        </Modal>
      )}

      {/* ─── FULLSCREEN MODEL & INFERENCE SETTINGS MODAL ────────────────────── */}
      {showSettingsModal && (
        <Modal
          visible={true}
          animationType="slide"
          onRequestClose={() => setShowSettingsModal(false)}
          statusBarTranslucent={true}
        >
          <View style={styles.fullscreenModalContainer}>
            <StatusBar
              barStyle="light-content"
              backgroundColor="transparent"
              translucent={true}
            />
            <SafeAreaView style={styles.fullscreenSafeArea}>
              {/* Top Navigation Bar */}
              <View style={styles.fullscreenHeader}>
                <TouchableOpacity
                  style={styles.fullscreenCloseBtn}
                  onPress={() => setShowSettingsModal(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.fullscreenCloseBtnText}>✕ Cancel</Text>
                </TouchableOpacity>

                <View style={styles.fullscreenTitleContainer}>
                  <Text style={styles.fullscreenTitle} numberOfLines={1}>
                    ⚙️ Model & Inference Settings
                  </Text>
                  <Text style={styles.fullscreenSubtitle} numberOfLines={1}>
                    Configure llama.rn hardware & generation parameters
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.savePromptBtn}
                  onPress={handleSaveSettings}
                  activeOpacity={0.7}
                >
                  <Text style={styles.savePromptBtnText}>💾 Save</Text>
                </TouchableOpacity>
              </View>

              {/* Scrollable Settings Body */}
              <ScrollView
                style={styles.settingsScrollView}
                contentContainerStyle={styles.settingsScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* ─── TARGET MODEL INFO ────────────────────────────────────── */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>
                    🧠 Universal Indic Thinking Module
                  </Text>
                  <Text style={styles.settingsSectionSubtitle}>
                    All inference is strictly executed using this selected
                    on-device model
                  </Text>
                  <View style={styles.targetModelInfoBox}>
                    <Text style={styles.targetModelName}>
                      {universalModel.name}
                    </Text>
                    <Text style={styles.targetModelMeta}>
                      Quantization: Q4_K_M • Size: {universalModel.sizeMB} MB •
                      Engine: llama.rn
                    </Text>
                  </View>
                </View>

                {/* ─── SECTION 1: SAMPLING & CREATIVITY ─────────────────────── */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>
                    🎯 Sampling & Creativity (ctx.completion)
                  </Text>
                  <Text style={styles.settingsSectionSubtitle}>
                    Control randomness, probability cutoffs, and token selection
                  </Text>

                  {/* Temperature */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>Temperature</Text>
                      <Text style={styles.settingValueBadge}>
                        T = {tempSettings.temperature}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      0.0–0.1 = deterministic (recommended for OCR). 0.7+ =
                      creative.
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.0, 0.1, 0.2, 0.5, 0.7, 1.0].map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.paramPill,
                            tempSettings.temperature === t &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, temperature: t })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.temperature === t &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {t.toFixed(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Top-P */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Top-P (Nucleus Sampling)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.top_p}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Cumulative probability cutoff for candidate tokens.
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.8, 0.9, 0.95, 1.0].map((p) => (
                        <TouchableOpacity
                          key={p}
                          style={[
                            styles.paramPill,
                            tempSettings.top_p === p &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, top_p: p })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.top_p === p &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {p.toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Top-K */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>Top-K</Text>
                      <Text style={styles.settingValueBadge}>
                        K = {tempSettings.top_k}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Limits token selection to K highest-probability tokens.
                    </Text>
                    <View style={styles.pillRow}>
                      {[20, 40, 60, 100].map((k) => (
                        <TouchableOpacity
                          key={k}
                          style={[
                            styles.paramPill,
                            tempSettings.top_k === k &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, top_k: k })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.top_k === k &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {k}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Min-P */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>Min-P Sampling</Text>
                      <Text style={styles.settingValueBadge}>
                        min_p = {tempSettings.min_p}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Minimum probability relative to prime token (modern
                      alternative to Top-P).
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.0, 0.05, 0.1, 0.2].map((mp) => (
                        <TouchableOpacity
                          key={mp}
                          style={[
                            styles.paramPill,
                            tempSettings.min_p === mp &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, min_p: mp })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.min_p === mp &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {mp.toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Typical-P */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Typical-P Sampling
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.typical_p}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Locally typical sampling (1.0 = disabled).
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.9, 0.95, 1.0].map((tp) => (
                        <TouchableOpacity
                          key={tp}
                          style={[
                            styles.paramPill,
                            tempSettings.typical_p === tp &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, typical_p: tp })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.typical_p === tp &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {tp.toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Random Seed */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Seed (Reproducibility)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.seed === -1
                          ? 'Random (-1)'
                          : `Seed: ${tempSettings.seed}`}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Fixed seed guarantees bit-for-bit identical outputs for
                      benchmarking.
                    </Text>
                    <View style={styles.pillRow}>
                      {[-1, 42, 1337, 2026].map((s) => (
                        <TouchableOpacity
                          key={s}
                          style={[
                            styles.paramPill,
                            tempSettings.seed === s && styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, seed: s })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.seed === s &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {s === -1 ? '🎲 Random' : `🔢 ${s}`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                {/* ─── SECTION 2: OUTPUT LIMITS & PENALTIES ──────────────────── */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>
                    📏 Output Limits & Penalties
                  </Text>
                  <Text style={styles.settingsSectionSubtitle}>
                    Control output length, repetition damping, and stopping
                    tokens
                  </Text>

                  {/* Max Tokens / n_predict */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Max Output Tokens (n_predict)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.n_predict} tokens
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Maximum tokens generated. Typical business card JSON needs
                      200–350 tokens.
                    </Text>
                    <View style={styles.pillRow}>
                      {[200, 300, 400, 600, 800, 1024].map((n) => (
                        <TouchableOpacity
                          key={n}
                          style={[
                            styles.paramPill,
                            tempSettings.n_predict === n &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, n_predict: n })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.n_predict === n &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {n}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Repetition Penalty */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Repetition Penalty
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.penalty_repeat.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      1.0 = disabled. 1.1–1.2 reduces repetitive loops.
                    </Text>
                    <View style={styles.pillRow}>
                      {[1.0, 1.05, 1.1, 1.2, 1.3].map((r) => (
                        <TouchableOpacity
                          key={r}
                          style={[
                            styles.paramPill,
                            tempSettings.penalty_repeat === r &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              penalty_repeat: r,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.penalty_repeat === r &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {r.toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Frequency Penalty */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>Frequency Penalty</Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.penalty_freq.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Penalizes tokens proportionally based on frequency in
                      output.
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.0, 0.1, 0.2, 0.5].map((f) => (
                        <TouchableOpacity
                          key={f}
                          style={[
                            styles.paramPill,
                            tempSettings.penalty_freq === f &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              penalty_freq: f,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.penalty_freq === f &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {f.toFixed(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Presence Penalty */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>Presence Penalty</Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.penalty_present.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Penalizes tokens if they have appeared at least once.
                    </Text>
                    <View style={styles.pillRow}>
                      {[0.0, 0.1, 0.2, 0.5].map((pr) => (
                        <TouchableOpacity
                          key={pr}
                          style={[
                            styles.paramPill,
                            tempSettings.penalty_present === pr &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              penalty_present: pr,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.penalty_present === pr &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {pr.toFixed(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Repeat Penalty Window (penalty_last_n) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Penalty Window (last N tokens)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.penalty_last_n} tokens
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Number of previous tokens to scan for repetition damping.
                    </Text>
                    <View style={styles.pillRow}>
                      {[32, 64, 128, 256].map((pln) => (
                        <TouchableOpacity
                          key={pln}
                          style={[
                            styles.paramPill,
                            tempSettings.penalty_last_n === pln &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              penalty_last_n: pln,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.penalty_last_n === pln &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {pln}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Stop Sequences */}
                  <View style={styles.settingItem}>
                    <Text style={styles.settingLabel}>
                      Stop Sequences (Comma Separated)
                    </Text>
                    <Text style={styles.settingHelpText}>
                      Tokens that immediately halt generation when emitted by
                      the model.
                    </Text>
                    <TextInput
                      style={styles.settingsTextInput}
                      value={tempSettings.stopSequences ?? ''}
                      onChangeText={(val) =>
                        setTempSettings({ ...tempSettings, stopSequences: val })
                      }
                      placeholder="<|im_end|>, </s>, <|endoftext|>"
                      placeholderTextColor="#475569"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                {/* ─── SECTION 3: STRUCTURED GRAMMAR & THINKING ──────────────── */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>
                    📝 Structured Grammar & Reasoning
                  </Text>
                  <Text style={styles.settingsSectionSubtitle}>
                    Enforce mathematical JSON schemas via GBNF and control
                    chain-of-thought
                  </Text>

                  {/* Enable GBNF Grammar */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        GBNF Grammar Constraint
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.enable_grammar
                          ? '🔒 Active'
                          : '🔓 Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Strictly constrains token sampling to 100% valid JSON
                      syntax.
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.enable_grammar === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              enable_grammar: val,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.enable_grammar === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '🔒 Enable GBNF' : '🔓 Disable (Free Text)'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Grammar Editor */}
                  {tempSettings.enable_grammar && (
                    <View style={styles.settingItem}>
                      <Text style={styles.settingLabel}>
                        GBNF Grammar Definition
                      </Text>
                      <Text style={styles.settingHelpText}>
                        GGML Backus-Naur Form grammar rules.
                      </Text>
                      <TextInput
                        style={[styles.settingsTextInput, { minHeight: 100 }]}
                        value={tempSettings.grammar_text ?? ''}
                        onChangeText={(val) =>
                          setTempSettings({
                            ...tempSettings,
                            grammar_text: val,
                          })
                        }
                        multiline={true}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  )}

                  {/* Enable Thinking */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Thinking Blocks (&lt;think&gt; tags)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.enable_thinking ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Allows model to perform internal chain-of-thought
                      reasoning before output.
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.enable_thinking === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              enable_thinking: val,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.enable_thinking === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '💡 Enable Thinking' : '🚫 Disable Thinking'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Thinking Budget */}
                  {tempSettings.enable_thinking && (
                    <View style={styles.settingItem}>
                      <View style={styles.settingLabelRow}>
                        <Text style={styles.settingLabel}>
                          Thinking Budget Tokens
                        </Text>
                        <Text style={styles.settingValueBadge}>
                          {tempSettings.thinking_budget_tokens === 0
                            ? 'Unlimited'
                            : `${tempSettings.thinking_budget_tokens} tokens`}
                        </Text>
                      </View>
                      <Text style={styles.settingHelpText}>
                        Maximum tokens allowed inside &lt;think&gt; block before
                        forcing answer.
                      </Text>
                      <View style={styles.pillRow}>
                        {[0, 100, 250, 500].map((tb) => (
                          <TouchableOpacity
                            key={tb}
                            style={[
                              styles.paramPill,
                              tempSettings.thinking_budget_tokens === tb &&
                                styles.paramPillSelected,
                            ]}
                            onPress={() =>
                              setTempSettings({
                                ...tempSettings,
                                thinking_budget_tokens: tb,
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.paramPillText,
                                tempSettings.thinking_budget_tokens === tb &&
                                  styles.paramPillTextSelected,
                              ]}
                            >
                              {tb === 0 ? '♾️ Unlimited' : `${tb} tk`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                {/* ─── SECTION 4: HARDWARE & MEMORY ALLOCATION ───────────────── */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>
                    ⚡ Hardware, Memory & Accelerators (initLlama)
                  </Text>
                  <Text style={styles.settingsSectionSubtitle}>
                    Parameters used when loading the model into device RAM
                  </Text>

                  {/* CPU Threads */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        CPU Threads (n_threads)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.n_threads} Threads
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Higher = faster generation, but consumes more battery &
                      heat. 4 is optimal.
                    </Text>
                    <View style={styles.pillRow}>
                      {[1, 2, 4, 6, 8].map((th) => (
                        <TouchableOpacity
                          key={th}
                          style={[
                            styles.paramPill,
                            tempSettings.n_threads === th &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, n_threads: th })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.n_threads === th &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {th} Core{th > 1 ? 's' : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Context Size (n_ctx) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Context Window (n_ctx)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.n_ctx} Tokens
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Total memory allocated for prompt + generated tokens in KV
                      cache.
                    </Text>
                    <View style={styles.pillRow}>
                      {[512, 1024, 2048, 4096].map((ctx) => (
                        <TouchableOpacity
                          key={ctx}
                          style={[
                            styles.paramPill,
                            tempSettings.n_ctx === ctx &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, n_ctx: ctx })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.n_ctx === ctx &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {ctx}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Batch Size (n_batch) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Prompt Batch Size (n_batch)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.n_batch}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Batch size for prompt processing. 256 or 512 is standard.
                    </Text>
                    <View style={styles.pillRow}>
                      {[128, 256, 512, 1024].map((b) => (
                        <TouchableOpacity
                          key={b}
                          style={[
                            styles.paramPill,
                            tempSettings.n_batch === b &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, n_batch: b })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.n_batch === b &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {b}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Micro Batch Size (n_ubatch) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Physical Micro-Batch (n_ubatch)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.n_ubatch}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Physical batch size for compute kernels.
                    </Text>
                    <View style={styles.pillRow}>
                      {[32, 64, 128, 256].map((ub) => (
                        <TouchableOpacity
                          key={ub}
                          style={[
                            styles.paramPill,
                            tempSettings.n_ubatch === ub &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, n_ubatch: ub })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.n_ubatch === ub &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {ub}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* KV Cache Quantization - Keys (cache_type_k) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        KV Cache Quantization (Keys)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.cache_type_k.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      q8_0 or q4_0 cuts context RAM usage by 50%–75%.
                    </Text>
                    <View style={styles.pillRow}>
                      {(['f16', 'q8_0', 'q4_0'] as const).map((kType) => (
                        <TouchableOpacity
                          key={kType}
                          style={[
                            styles.paramPill,
                            tempSettings.cache_type_k === kType &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              cache_type_k: kType,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.cache_type_k === kType &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {kType.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* KV Cache Quantization - Values (cache_type_v) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        KV Cache Quantization (Values)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.cache_type_v.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Quantization precision for attention values.
                    </Text>
                    <View style={styles.pillRow}>
                      {(['f16', 'q8_0', 'q4_0'] as const).map((vType) => (
                        <TouchableOpacity
                          key={vType}
                          style={[
                            styles.paramPill,
                            tempSettings.cache_type_v === vType &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              cache_type_v: vType,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.cache_type_v === vType &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {vType.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* RAM Lock (use_mlock) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Lock in RAM (use_mlock)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.use_mlock ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Prevents Android OS from paging model memory to disk.
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.use_mlock === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, use_mlock: val })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.use_mlock === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '🔒 Enabled' : '🔓 Disabled'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Memory Mapping (use_mmap) */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Memory Map File (use_mmap)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.use_mmap ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Maps model directly from storage (reduces physical RAM
                      footprint).
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.use_mmap === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({ ...tempSettings, use_mmap: val })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.use_mmap === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '⚡ mmap Enabled' : '🚫 mmap Disabled'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Flash Attention */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Flash Attention (flash_attn)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.flash_attn ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Accelerated attention kernel (recommended for GPU/NPU).
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.flash_attn === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              flash_attn: val,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.flash_attn === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '⚡ Enabled' : 'Disabled'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* No Extra Buffer Types */}
                  <View style={styles.settingItem}>
                    <View style={styles.settingLabelRow}>
                      <Text style={styles.settingLabel}>
                        Reduce Weight Buffers (no_extra_bufts)
                      </Text>
                      <Text style={styles.settingValueBadge}>
                        {tempSettings.no_extra_bufts ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <Text style={styles.settingHelpText}>
                      Disables extra buffers for weight repacking to conserve
                      RAM.
                    </Text>
                    <View style={styles.pillRow}>
                      {[false, true].map((val) => (
                        <TouchableOpacity
                          key={String(val)}
                          style={[
                            styles.paramPill,
                            tempSettings.no_extra_bufts === val &&
                              styles.paramPillSelected,
                          ]}
                          onPress={() =>
                            setTempSettings({
                              ...tempSettings,
                              no_extra_bufts: val,
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.paramPillText,
                              tempSettings.no_extra_bufts === val &&
                                styles.paramPillTextSelected,
                            ]}
                          >
                            {val ? '💾 Conserve RAM' : 'Standard'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* CPU Core Mask */}
                  <View style={styles.settingItem}>
                    <Text style={styles.settingLabel}>
                      CPU Affinity Mask (cpu_mask)
                    </Text>
                    <Text style={styles.settingHelpText}>
                      Specifies CPU cores (e.g. "4-7" for high-performance
                      cores, empty for OS default).
                    </Text>
                    <TextInput
                      style={styles.settingsTextInput}
                      value={tempSettings.cpu_mask ?? ''}
                      onChangeText={(val) =>
                        setTempSettings({ ...tempSettings, cpu_mask: val })
                      }
                      placeholder="e.g. 4-7 or 0,2,4,6 (Leave empty for default)"
                      placeholderTextColor="#475569"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                {/* Reset to Safe Defaults Button */}
                <View style={styles.settingsFooterSection}>
                  <TouchableOpacity
                    style={styles.resetSettingsBtn}
                    onPress={handleResetSettings}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resetSettingsBtnText}>
                      🔄 Reset All to Defaults
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Stylesheet ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0D17',
    paddingTop: STATUS_BAR_TOP_PADDING,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: BOTTOM_NAV_PADDING,
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
  statusBox: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  statusBoxText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: '#450A0A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  errorBoxText: {
    fontSize: 12,
    color: '#FCA5A5',
  },
  sectionContainer: {
    backgroundColor: '#13182E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  llmSectionHighlight: {
    borderColor: '#6366F1',
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  actionBtnIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  actionBtnTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  actionBtnSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  imagePreviewBox: {
    marginTop: 14,
  },
  imagePreviewLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
    fontWeight: '600',
  },
  multiThumbCard: {
    marginRight: 10,
    alignItems: 'center',
  },
  multiThumbImg: {
    width: 90,
    height: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  multiThumbText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 4,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  greenBadge: {
    backgroundColor: '#05966933',
    borderColor: '#10B981',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  greenBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
  },
  purpleBadge: {
    backgroundColor: '#6366F133',
    borderColor: '#818CF8',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  purpleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A5B4FC',
  },
  indigoBadge: {
    backgroundColor: '#8B5CF633',
    borderColor: '#A78BFA',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  indigoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  codeBox: {
    backgroundColor: '#030712',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 12,
    minHeight: 120,
    maxHeight: 240,
  },
  llmCodeBox: {
    borderColor: '#4338CA',
    minHeight: 160,
    maxHeight: 300,
  },
  codeScroll: {
    flex: 1,
  },
  codeScrollContent: {
    paddingBottom: 4,
  },
  codeText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#E2E8F0',
    lineHeight: 18,
  },
  llmCodeText: {
    color: '#A5B4FC',
  },
  ocrMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  ocrMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  metaActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  copyBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  copyBtnSuccess: {
    backgroundColor: '#064E3B',
    borderColor: '#10B981',
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  clearBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  clearText: {
    fontSize: 11,
    color: '#F87171',
    fontWeight: '600',
  },
  sendButtonArea: {
    marginTop: 4,
    alignItems: 'center',
  },
  sendLlmButton: {
    width: '100%',
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLlmIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  sendLlmButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sendLlmArrow: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 8,
    fontWeight: '800',
  },
  engineHintText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
  },
  llmManagerCard: {
    backgroundColor: '#1E2340',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  llmManagerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  llmManagerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  llmManagerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
  },
  llmCloseBtn: {
    padding: 4,
  },
  llmCloseBtnText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '700',
  },
  modelCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modelCardSelected: {
    borderColor: '#6366F1',
  },
  modelCardActive: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B22',
  },
  modelHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modelTagBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modelTagText: {
    fontSize: 10,
    color: '#CBD5E1',
    fontWeight: '600',
  },
  modelDescText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 4,
  },
  modelStatusRow: {
    marginTop: 6,
  },
  statusActiveText: {
    fontSize: 10,
    color: '#34D399',
    fontWeight: '700',
  },
  statusDownloadingText: {
    fontSize: 10,
    color: '#FBBF24',
    fontWeight: '600',
  },
  statusDownloadedText: {
    fontSize: 10,
    color: '#60A5FA',
    fontWeight: '600',
  },
  statusNotDownloadedText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  modelActionRow: {
    marginTop: 6,
  },
  modelActionBtnPrimary: {
    backgroundColor: '#6366F1',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modelActionBtnDanger: {
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modelActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  expandHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  expandHeaderBtnIcon: {
    fontSize: 11,
    color: '#38BDF8',
    marginRight: 4,
  },
  expandHeaderBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38BDF8',
  },
  expandBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  expandBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
  },
  fullscreenModalContainer: {
    flex: 1,
    backgroundColor: '#13182E',
    paddingTop: STATUS_BAR_TOP_PADDING,
  },
  fullscreenSafeArea: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#13182E',
  },
  fullscreenCloseBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  fullscreenCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F87171',
  },
  fullscreenTitleContainer: {
    flex: 1,
    marginHorizontal: 10,
  },
  fullscreenTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  fullscreenSubtitle: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  fullscreenStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  fullscreenStatsText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  fullscreenContentWrapper: {
    flex: 1,
    backgroundColor: '#030712',
  },
  fullscreenScrollView: {
    flex: 1,
  },
  fullscreenScrollContent: {
    padding: 16,
    paddingBottom: BOTTOM_NAV_PADDING + 24,
  },
  fullscreenCodeText: {
    fontSize: 13,
    lineHeight: 20,
  },
  promptConfigCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  promptConfigHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  promptConfigTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  promptConfigSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  customPromptBadge: {
    backgroundColor: '#38BDF822',
    borderWidth: 1,
    borderColor: '#38BDF8',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  customPromptBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#38BDF8',
  },
  promptEditBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  promptEditBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A5B4FC',
  },
  modelPromptConfigBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6366F1',
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  modelPromptConfigBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A5B4FC',
  },
  savePromptBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  savePromptBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  promptEditorHelpBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  promptEditorHelpText: {
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
    marginRight: 8,
  },
  resetPromptBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  resetPromptBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  promptInputWrapper: {
    flex: 1,
    backgroundColor: '#030712',
    padding: 12,
  },
  promptTextInput: {
    flex: 1,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#E2E8F0',
    lineHeight: 18,
    textAlignVertical: 'top',
  },

  // ─── Settings Modal & Badges ──────────────────────────────────────────────
  amberBadge: {
    backgroundColor: '#F59E0B26',
    borderColor: '#F59E0B',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  amberBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FCD34D',
  },
  modelSettingsSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  settingsSummaryChip: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  settingsSummaryChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  modelConfigButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  modelSettingsConfigBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelSettingsConfigBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
  },
  settingsScrollView: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  settingsScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  settingsSection: {
    backgroundColor: '#131826',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
    marginBottom: 16,
  },
  settingsSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  settingsSectionSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 14,
  },
  engineModeContainer: {
    gap: 10,
  },
  engineOptionCard: {
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
  },
  engineOptionCardSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#1E1B4B4D',
  },
  engineOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  engineOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  checkIcon: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '800',
  },
  engineOptionDesc: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
  settingItem: {
    marginBottom: 16,
  },
  settingLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  settingValueBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  settingHelpText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paramPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  paramPillSelected: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8',
  },
  paramPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  paramPillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  settingsTextInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    color: '#E2E8F0',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  settingsFooterSection: {
    marginTop: 4,
    marginBottom: 20,
    alignItems: 'center',
  },
  targetModelInfoBox: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  targetModelName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38BDF8',
    marginBottom: 4,
  },
  targetModelMeta: {
    fontSize: 11,
    color: '#94A3B8',
  },
  resetSettingsBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#475569',
  },
  resetSettingsBtnText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
});
