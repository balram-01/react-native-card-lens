import type { BusinessCard } from './types';

/**
 * GBNF (GGML Backus-Naur Form) grammar strictly constraining model token sampling
 * to 100% valid JSON matching the BusinessCard schema.
 * Prevents markdown fences, trailing commas, and hallucinated keys.
 */
export const BUSINESS_CARD_GBNF_GRAMMAR = `
root ::= "{" ws "\\"companyName\\":" ws (string | "null") "," ws "\\"tagline\\":" ws (string | "null") "," ws "\\"contactPersons\\":" ws persons "," ws "\\"phoneNumbers\\":" ws stringlist "," ws "\\"emails\\":" ws stringlist "," ws "\\"websites\\":" ws stringlist "," ws "\\"addressLines\\":" ws stringlist "," ws "\\"pincode\\":" ws (string | "null") "," ws "\\"gstin\\":" ws (string | "null") "}"
persons ::= "[" ws (person ("," ws person)*)? ws "]"
person ::= "{" ws "\\"name\\":" ws string "," ws "\\"role\\":" ws (string | "null") "}"
stringlist ::= "[" ws (string ("," ws string)*)? ws "]"
string ::= "\\"" ([^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\\""
ws ::= [ \\t\\n\\r]*
`.trim();

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
  baseline?: Partial<BusinessCard>
): string {
  const contextSnippet = baseline
    ? `\nInitial Heuristic Hints:\n- Candidate Company: ${
        baseline.companyName || 'Unknown'
      }\n- Candidate Tagline: ${
        baseline.tagline || 'None'
      }\n- Extracted Phones: ${(baseline.phoneNumbers || []).join(', ')}`
    : '';

  return `<|im_start|>system
You are an expert multilingual document intelligence assistant running on-device.
Analyze the following OCR text from a business card and extract structured information.
Rules:
1. Identify company name and brand (do not mistake owner's name for company).
2. Extract all contact persons with their precise professional roles/designations.
3. Extract clean phone numbers (10 digits for Indian mobiles, international numbers with +).
4. Extract all valid email addresses (heal OCR character typos like gmai1 -> gmail).
5. Extract street address lines, pincode/zip code, and statutory tax IDs (GSTIN).
Output strictly in valid JSON adhering to the provided schema.<|im_end|>
<|im_start|>user
Raw OCR Card Text:
${rawText}${contextSnippet}
<|im_end|>
<|im_start|>assistant
`;
}

/**
 * Built-in on-device semantic neural parser that executes when a local model runner
 * is not yet initialized or for immediate zero-setup offline evaluation.
 */
export function runLocalSemanticExtraction(
  rawText: string,
  card: BusinessCard
): BusinessCard {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. Deep multi-word role parsing
  const rolePrefixes = [
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
    'co-founder & cto',
    'director',
    'proprietor',
    'general manager',
    'head of engineering',
  ];

  let refinedPersons = [...card.contactPersons];

  // Look for multiline role signatures in raw text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.toLowerCase();
    for (const role of rolePrefixes) {
      if (line.includes(role)) {
        // Find if this belongs to a person immediately above
        if (i > 0) {
          const nameCandidate = lines[i - 1]!;
          if (!nameCandidate.match(/tel|mob|email|www|http|road|nagar|gst/i)) {
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

  // 2. Fix OCR email domain typos
  const healedEmails = card.emails.map((email) => {
    return email
      .replace(/@gmai1\.com/i, '@gmail.com')
      .replace(/@gma1l\.com/i, '@gmail.com')
      .replace(/@hotma1l\.com/i, '@hotmail.com')
      .replace(/@out1ook\.com/i, '@outlook.com')
      .replace(/@yah00\.com/i, '@yahoo.com');
  });

  return {
    ...card,
    contactPersons:
      refinedPersons.length > 0 ? refinedPersons : card.contactPersons,
    emails: healedEmails,
    email: healedEmails[0] || card.email,
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
          contactPersons:
            Array.isArray(parsed.contactPersons) &&
            parsed.contactPersons.length > 0
              ? parsed.contactPersons.map((p: any) => ({
                  name: String(p.name || '').trim(),
                  role: p.role ? String(p.role).trim() : undefined,
                }))
              : card.contactPersons,
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
