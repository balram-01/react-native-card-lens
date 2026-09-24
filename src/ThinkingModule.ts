import { DeviceEventEmitter } from 'react-native';
import NativeCardLens from './NativeCardLens';
import type { BusinessCard } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// ThinkingModule — GGUF Inference via llama.rn
//
// The inference layer has moved to llama.rn (llama.cpp) in the example app.
// These stubs are kept for library API compatibility and for the native
// Semantic Thinking Reasoner fallback (pure-Kotlin, zero dependencies).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an llama.rn context is loaded and ready for inference.
 * NOTE: Actual state is managed in JS via llama.rn's LlamaContext.
 * This always returns false from native; check the JS-side context reference instead.
 */
export async function isThinkingModelReady(): Promise<boolean> {
  return (await NativeCardLens.isThinkingModelReady()) as boolean;
}

/**
 * Refine and extract structured business card fields from raw OCR text using the
 * deterministic Semantic Thinking Reasoner (pure-Kotlin, zero dependencies, instant).
 *
 * When llama.rn GGUF inference is loaded in the app, use `refineCardWithLlama()`
 * from the example app instead — this is the offline fallback.
 *
 * @param cardOrRawText A BusinessCard object (using its rawText) or a raw OCR text string.
 * @returns Refined BusinessCard with structured persons, labeled phones, addresses, and slogans.
 */
export async function refineCardWithThinkingModule(
  cardOrRawText: BusinessCard | string
): Promise<BusinessCard> {
  const text =
    typeof cardOrRawText === 'string'
      ? cardOrRawText
      : cardOrRawText.rawText || '';
  return (await NativeCardLens.refineCardWithThinkingModule(
    text
  )) as BusinessCard;
}

/**
 * Progress details during model download.
 */
export interface ThinkingModelDownloadProgress {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

/**
 * Downloads a GGUF model file to local internal storage with native streaming progress.
 *
 * Supports completely free, non-gated models from HuggingFace (bartowski, TheBloke, etc.)
 * as well as gated models (pass authToken for those).
 *
 * @param url         Public HTTPS URL to download the GGUF model from.
 * @param fileName    Target filename (e.g. 'SmolLM2-360M-Instruct-Q4_K_M.gguf').
 * @param onProgress  Optional callback providing live percentage and byte progress.
 * @param authToken   Optional HuggingFace Bearer token (only needed for gated models).
 * @returns           Absolute local filesystem path to the downloaded model file.
 */
export async function downloadThinkingModel(
  url: string,
  fileName: string,
  onProgress?: (progress: ThinkingModelDownloadProgress) => void,
  authToken?: string
): Promise<string> {
  const subscription = onProgress
    ? DeviceEventEmitter.addListener(
        'onThinkingModelDownloadProgress',
        (event: ThinkingModelDownloadProgress) => {
          if (event.fileName === fileName) {
            onProgress(event);
          }
        }
      )
    : null;

  try {
    const localPath = await NativeCardLens.downloadThinkingModel(
      url,
      fileName,
      authToken
    );
    return localPath;
  } finally {
    subscription?.remove();
  }
}

/**
 * Deletes a downloaded Thinking Module GGUF model file from disk storage to free up space.
 *
 * @param fileName  Filename to remove (e.g. 'qwen2.5-1.5b-instruct-q4_k_m.gguf').
 * @returns         Boolean indicating whether file was deleted.
 */
export async function deleteThinkingModel(fileName: string): Promise<boolean> {
  return await NativeCardLens.deleteThinkingModel(fileName);
}
