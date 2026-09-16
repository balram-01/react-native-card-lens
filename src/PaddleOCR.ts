import { DeviceEventEmitter, Platform } from 'react-native';
import NativeCardLens from './NativeCardLens';
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
 * @param config      Optional custom URLs or HF auth token for model weights.
 * @param onProgress  Progress callback receiving `{ file, downloadedBytes, totalBytes, percent }`.
 * @returns           `true` if all models are successfully downloaded and validated.
 *
 * @example
 * ```ts
 * const ready = await downloadPaddleOcrModels(undefined, (progress) => {
 *   console.log(`Downloading ${progress.file}: ${progress.percent}%`);
 * });
 * ```
 */
export async function downloadPaddleOcrModels(
  config?: PaddleOcrModelConfig,
  onProgress?: (progress: PaddleOcrDownloadProgress) => void
): Promise<boolean> {
  if (Platform.OS === 'web') return false;

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
    const success = await NativeCardLens.downloadPaddleOcrModels(config ?? {});
    return Boolean(success);
  } finally {
    subscription?.remove();
  }
}

/**
 * Runs high-efficiency on-device multilingual PaddleOCR on an image URI.
 *
 * Supports 106 languages, artistic and distorted text, vertical margins,
 * and outputs standard `RawOcrResult` with full 2D bounding boxes compatible
 * with all CardLens downstream reasoners.
 *
 * @param imageUri  `file://` or `content://` image path.
 * @param options   Optional detection threshold and unclip ratio parameters.
 */
export async function recognizeTextWithPaddle(
  imageUri: string,
  options?: PaddleOcrOptions
): Promise<RawOcrResult> {
  const result = await NativeCardLens.recognizeTextPaddle(
    imageUri,
    options ?? {}
  );
  return result as unknown as RawOcrResult;
}
