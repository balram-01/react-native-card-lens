import { describe, it, expect, jest } from '@jest/globals';
import {
  recognizeText,
  recognizeTextWithPaddle,
  isPaddleOcrReady,
  downloadPaddleOcrModels,
  PADDLE_OCR_DOWNLOAD_EVENT,
  resolveOcrScriptFamily,
  LANGUAGE_TO_SCRIPT,
  SCRIPT_MODEL_REGISTRY,
} from '../index';
import NativeCardLens from '../NativeCardLens';

describe('PaddleOCR JavaScript API', () => {
  it('has valid download event name', () => {
    expect(PADDLE_OCR_DOWNLOAD_EVENT).toBe('onPaddleOcrDownloadProgress');
  });

  it('checks if PaddleOCR is ready', async () => {
    const isReady = await isPaddleOcrReady();
    expect(typeof isReady).toBe('boolean');
  });

  it('correctly maps ISO languages to PaddleOCR script families', () => {
    // Direct registry check
    expect(LANGUAGE_TO_SCRIPT.mr).toBe('devanagari');
    expect(LANGUAGE_TO_SCRIPT.hi).toBe('devanagari');
    expect(LANGUAGE_TO_SCRIPT.en).toBe('latin');

    // Marathi and Hindi map to Devanagari
    expect(resolveOcrScriptFamily('mr')).toBe('devanagari');
    expect(resolveOcrScriptFamily('marathi')).toBe('devanagari');
    expect(resolveOcrScriptFamily('hi')).toBe('devanagari');
    expect(resolveOcrScriptFamily('hindi')).toBe('devanagari');

    // European / Latin languages
    expect(resolveOcrScriptFamily('en')).toBe('latin');
    expect(resolveOcrScriptFamily('es')).toBe('latin');
    expect(resolveOcrScriptFamily('fr')).toBe('latin');
    expect(resolveOcrScriptFamily('de')).toBe('latin');

    // Arabic, Cyrillic, CJK, Indic
    expect(resolveOcrScriptFamily('ar')).toBe('arabic');
    expect(resolveOcrScriptFamily('ru')).toBe('cyrillic');
    expect(resolveOcrScriptFamily('zh')).toBe('ch');
    expect(resolveOcrScriptFamily('ja')).toBe('ch');
    expect(resolveOcrScriptFamily('ko')).toBe('korean');
    expect(resolveOcrScriptFamily('ta')).toBe('tamil');
    expect(resolveOcrScriptFamily('te')).toBe('telugu');
    expect(resolveOcrScriptFamily('th')).toBe('thai');

    // Default fallback
    expect(resolveOcrScriptFamily(undefined)).toBe('devanagari');
    expect(resolveOcrScriptFamily('unknown_lang')).toBe('devanagari');
  });

  it('contains valid endpoints in SCRIPT_MODEL_REGISTRY', () => {
    expect(SCRIPT_MODEL_REGISTRY.devanagari.recModelUrl).toContain(
      'hindi/rec.onnx'
    );
    expect(SCRIPT_MODEL_REGISTRY.devanagari.keysUrl).toContain(
      'hindi/dict.txt'
    );

    expect(SCRIPT_MODEL_REGISTRY.latin.recModelUrl).toContain('latin/rec.onnx');
    expect(SCRIPT_MODEL_REGISTRY.latin.keysUrl).toContain('latin/dict.txt');

    expect(SCRIPT_MODEL_REGISTRY.arabic.recModelUrl).toContain(
      'arabic/rec.onnx'
    );
    expect(SCRIPT_MODEL_REGISTRY.ch.recModelUrl).toContain(
      'ch_PP-OCRv4_rec_infer.onnx'
    );
  });

  it('calls NativeCardLens.recognizeTextPaddle with resolved script', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'recognizeTextPaddle')
      .mockResolvedValueOnce({
        rawText: 'गोकुळ दूध संघ\nरमेश पाटील',
        blocks: [],
      });

    const result = await recognizeTextWithPaddle('file:///test.jpg', {
      language: 'mr',
      boxThresh: 0.35,
      unclipRatio: 1.85,
    });

    expect(spy).toHaveBeenCalledWith('file:///test.jpg', {
      language: 'mr',
      script: 'devanagari',
      boxThresh: 0.35,
      unclipRatio: 1.85,
    });
    expect(result.rawText).toBe('गोकुळ दूध संघ\nरमेश पाटील');
  });

  it('routes recognizeText to paddleocr when engine is specified', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'recognizeTextPaddle')
      .mockResolvedValueOnce({
        rawText: 'Multilingual Card',
        blocks: [],
      });

    const result = await recognizeText('file:///card.jpg', {
      engine: 'paddleocr',
      paddleOptions: { language: 'mr', boxThresh: 0.4 },
    });

    expect(spy).toHaveBeenCalledWith('file:///card.jpg', {
      language: 'mr',
      script: 'devanagari',
      boxThresh: 0.4,
    });
    expect(result.rawText).toBe('Multilingual Card');
  });

  it('downloads Marathi / Devanagari models with correct endpoints', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'downloadPaddleOcrModels')
      .mockResolvedValueOnce(true);

    const success = await downloadPaddleOcrModels({ language: 'mr' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'mr',
        script: 'devanagari',
        recModelUrl: expect.stringContaining('hindi/rec.onnx'),
        keysUrl: expect.stringContaining('hindi/dict.txt'),
      })
    );
    expect(success).toBe(true);
  });

  it('downloads Latin models when Latin language requested', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'downloadPaddleOcrModels')
      .mockResolvedValueOnce(true);

    const success = await downloadPaddleOcrModels({ language: 'fr' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'fr',
        script: 'latin',
        recModelUrl: expect.stringContaining('latin/rec.onnx'),
        keysUrl: expect.stringContaining('latin/dict.txt'),
      })
    );
    expect(success).toBe(true);
  });
});
