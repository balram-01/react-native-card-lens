import { DeviceEventEmitter, Platform } from 'react-native';
import NativeCardLens from './NativeCardLens';
import {
  DEFAULT_PADDLE_DET_URL,
  SCRIPT_MODEL_REGISTRY,
  resolveOcrScriptFamily,
} from './types';
import type {
  PaddleOcrDownloadProgress,
  PaddleOcrModelConfig,
  PaddleOcrOptions,
  RawOcrResult,
} from './types';

export const PADDLE_OCR_DOWNLOAD_EVENT = 'onPaddleOcrDownloadProgress';

/**
 * Checks if the on-device PaddleOCR models (detection, recognition, and keys)
 * are installed and ready for inference.
 */
export async function isPaddleOcrReady(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await NativeCardLens.isPaddleOcrReady();
  } catch {
    return false;
  }
}

/**
 * Downloads on-device PaddleOCR ONNX models (det, rec, and keys dictionary)
 * to the app's internal sandbox storage with chunked streaming progress.
 *
 * Supports downloading any target language/script (e.g. Marathi 'mr', Hindi 'hi',
 * Latin 'en'/'es'/'fr', Arabic 'ar', CJK 'zh', Cyrillic 'ru', etc.).
 *
 * @param config      Optional custom URLs, language, script, or HF auth token for model weights.
 * @param onProgress  Progress callback receiving `{ file, downloadedBytes, totalBytes, percent }`.
 * @returns           `true` if all models are successfully downloaded and validated.
 *
 * @example
 * ```ts
 * // Download Marathi / Devanagari OCR models
 * const ready = await downloadPaddleOcrModels({ language: 'mr' }, (progress) => {
 *   console.log(`Downloading ${progress.file}: ${progress.percent}%`);
 * });
 * ```
 */
export async function downloadPaddleOcrModels(
  config?: PaddleOcrModelConfig,
  onProgress?: (progress: PaddleOcrDownloadProgress) => void
): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const script = resolveOcrScriptFamily(config?.language || config?.script);
  const endpoints =
    SCRIPT_MODEL_REGISTRY[script] ?? SCRIPT_MODEL_REGISTRY.devanagari;

  const resolvedConfig = {
    ...config,
    script,
    detModelUrl: config?.detModelUrl ?? DEFAULT_PADDLE_DET_URL,
    recModelUrl: config?.recModelUrl ?? endpoints.recModelUrl,
    keysUrl: config?.keysUrl ?? endpoints.keysUrl,
  };

  let subscription: any = null;
  if (onProgress) {
    subscription = DeviceEventEmitter.addListener(
      PADDLE_OCR_DOWNLOAD_EVENT,
      (event: any) => {
        onProgress(event as PaddleOcrDownloadProgress);
      }
    );
  }

  try {
    const success =
      await NativeCardLens.downloadPaddleOcrModels(resolvedConfig);
    return Boolean(success);
  } finally {
    subscription?.remove();
  }
}

/**
 * Runs high-efficiency on-device multilingual PaddleOCR on an image URI.
 *
 * Supports 106 languages across major script families (Devanagari/Marathi, Latin, Arabic, CJK, etc.),
 * artistic and distorted text, vertical margins, and outputs standard `RawOcrResult` with full 2D bounding boxes.
 *
 * @param imageUri  `file://` or `content://` image path.
 * @param options   Optional language/script, detection threshold, and unclip ratio parameters.
 *
 * @example
 * ```ts
 * // Run OCR on a Marathi visiting card
 * const result = await recognizeTextWithPaddle(uri, { language: 'mr' });
 * ```
 */
export async function recognizeTextWithPaddle(
  imageUri: string,
  options?: PaddleOcrOptions
): Promise<RawOcrResult> {
  const script = resolveOcrScriptFamily(options?.language || options?.script);
  const resolvedOptions = {
    ...options,
    script,
  };

  const result = await NativeCardLens.recognizeTextPaddle(
    imageUri,
    resolvedOptions
  );
  return result as unknown as RawOcrResult;
}
