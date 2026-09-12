import { describe, it, expect, jest } from '@jest/globals';
import {
  AVAILABLE_LOCAL_MODELS,
  fetchRemoteModelSize,
  checkLocalModelStatus,
  onModelDownloadProgress,
  getModelDownloadProgress,
  buildCardExtractionPrompt,
  BUSINESS_CARD_GBNF_GRAMMAR,
  runLocalSemanticExtraction,
} from '../LocalCardLLM';
import type { BusinessCard } from '../types';

describe('LocalCardLLM Engine & Model Manager', () => {
  it('exposes all available local open-weight GGUF models with exact sizes', () => {
    expect(AVAILABLE_LOCAL_MODELS.length).toBeGreaterThanOrEqual(3);

    const smol = AVAILABLE_LOCAL_MODELS.find((m) => m.id === 'smollm2-360m-q4');
    expect(smol).toBeDefined();
    expect(smol?.sizeMB).toBe(231);
    expect(smol?.downloadUrl).toContain('.gguf');

    const qwen = AVAILABLE_LOCAL_MODELS.find((m) => m.id === 'qwen25-05b-q4');
    expect(qwen).toBeDefined();
    expect(qwen?.sizeMB).toBe(340);

    const tiny = AVAILABLE_LOCAL_MODELS.find((m) => m.id === 'tinyllama-q4');
    expect(tiny).toBeDefined();
    expect(tiny?.sizeMB).toBe(669);
  });

  it('provides GBNF grammar and prompt builder', () => {
    expect(BUSINESS_CARD_GBNF_GRAMMAR).toContain('root ::=');
    expect(BUSINESS_CARD_GBNF_GRAMMAR).toContain('companyName');

    const prompt = buildCardExtractionPrompt('Bharat Sports 9876543210');
    expect(prompt).toContain('<|im_start|>system');
    expect(prompt).toContain('Bharat Sports');
  });

  it('checks local model status on device disk', async () => {
    const status = await checkLocalModelStatus(AVAILABLE_LOCAL_MODELS[0]!);
    expect(status.modelId).toBe(AVAILABLE_LOCAL_MODELS[0]!.id);
    expect(typeof status.isDownloaded).toBe('boolean');
    expect(status.sizeMB).toBe(AVAILABLE_LOCAL_MODELS[0]!.sizeMB);
  });

  it('inspects download progress and remote size queries', async () => {
    const initialProg = getModelDownloadProgress(AVAILABLE_LOCAL_MODELS[0]!.id);
    expect(initialProg === null || typeof initialProg === 'object').toBe(true);

    const remoteInfo = await fetchRemoteModelSize(
      'https://example.com/model.gguf'
    );
    expect(remoteInfo).toBeDefined();
    expect(typeof remoteInfo.totalBytes).toBe('number');
  });

  it('supports subscription to model download progress', () => {
    const listener = jest.fn();
    const unsubscribe = onModelDownloadProgress(listener);

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('runs local semantic neural reasoning on OCR card text', () => {
    const baseline: BusinessCard = {
      contactPersons: [],
      phoneNumbers: ['9876543210'],
      emails: ['test@gmai1.com'], // Typo in OCR
      websites: [],
      addressLines: [],
      rawText:
        'Dr. Priya Deshmukh\nManaging Director\nApex Tech\ntest@gmai1.com',
    };

    const refined = runLocalSemanticExtraction(baseline.rawText, baseline);

    // Should heal OCR typo @gmai1.com -> @gmail.com
    expect(refined.emails[0]).toBe('test@gmail.com');
    // Should extract person and role
    expect(refined.contactPersons.length).toBeGreaterThan(0);
    expect(refined.contactPersons[0]?.role?.toLowerCase()).toContain(
      'director'
    );
  });
});
