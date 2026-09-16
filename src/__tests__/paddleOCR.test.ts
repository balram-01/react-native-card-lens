import { describe, it, expect, jest } from '@jest/globals';
import {
  recognizeText,
  recognizeTextWithPaddle,
  isPaddleOcrReady,
  downloadPaddleOcrModels,
  PADDLE_OCR_DOWNLOAD_EVENT,
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

  it('calls NativeCardLens.recognizeTextPaddle when recognizeTextWithPaddle is invoked', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'recognizeTextPaddle')
      .mockResolvedValueOnce({
        rawText: 'ACME Corp\nJohn Doe',
        blocks: [],
      });

    const result = await recognizeTextWithPaddle('file:///test.jpg', {
      boxThresh: 0.35,
      unclipRatio: 1.8,
    });

    expect(spy).toHaveBeenCalledWith('file:///test.jpg', {
      boxThresh: 0.35,
      unclipRatio: 1.8,
    });
    expect(result.rawText).toBe('ACME Corp\nJohn Doe');
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
      paddleOptions: { boxThresh: 0.4 },
    });

    expect(spy).toHaveBeenCalledWith('file:///card.jpg', { boxThresh: 0.4 });
    expect(result.rawText).toBe('Multilingual Card');
  });

  it('calls downloadPaddleOcrModels successfully', async () => {
    const spy = jest
      .spyOn(NativeCardLens, 'downloadPaddleOcrModels')
      .mockResolvedValueOnce(true);

    const success = await downloadPaddleOcrModels();
    expect(spy).toHaveBeenCalled();
    expect(success).toBe(true);
  });
});
