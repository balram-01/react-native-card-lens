import { describe, it, expect, jest } from '@jest/globals';
import { extractCardWithMlKitAndLLM } from '../index';
import NativeCardLens from '../NativeCardLens';

describe('extractCardWithMlKitAndLLM', () => {
  it('extracts with ML Kit and feeds directly to default efficient thinking module', async () => {
    jest.spyOn(NativeCardLens, 'recognizeText').mockResolvedValueOnce({
      blocks: [],
      rawText:
        'Shree Ganesh Traders\nSachin Joshi (Director)\nPhone: 9822011223\nPune - 411030',
    } as any);

    jest
      .spyOn(NativeCardLens, 'refineCardWithThinkingModule')
      .mockResolvedValueOnce({
        companyName: 'Shree Ganesh Traders',
        contactPersons: [{ name: 'Sachin Joshi', role: 'Director' }],
        phoneNumbers: ['9822011223'],
        rawText:
          'Shree Ganesh Traders\nSachin Joshi (Director)\nPhone: 9822011223\nPune - 411030',
      } as any);

    const result = await extractCardWithMlKitAndLLM('file:///test_card.jpg');

    expect(result.rawOcr).toBeDefined();
    expect(result.rawOcr.rawText).toContain('Shree Ganesh Traders');
    expect(result.rawLlmOutput).toBeDefined();
    expect(result.rawLlmOutput).toContain('"companyName"');
    expect(result.card.companyName).toBe('Shree Ganesh Traders');
    expect(result.card.phoneNumbers).toContain('9822011223');
    expect(result.latencyMs).toBeDefined();
    expect(result.latencyMs?.ocr).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs?.llm).toBeGreaterThanOrEqual(0);
  });

  it('extracts with ML Kit and feeds to custom LLM inference handler, returning raw LLM output', async () => {
    jest.spyOn(NativeCardLens, 'recognizeText').mockResolvedValueOnce({
      blocks: [],
      rawText: 'Acme Corp\nJohn Doe CEO\nMob: 9876543210',
    } as any);

    const mockInferenceHandler = jest.fn(async (prompt: string) => {
      expect(prompt).toContain('Acme Corp');
      return JSON.stringify({
        companyName: 'Acme Corp',
        contactPersons: [{ name: 'John Doe', role: 'CEO' }],
        phoneNumbers: ['9876543210'],
      });
    });

    const result = await extractCardWithMlKitAndLLM('file:///card2.jpg', {
      inferenceHandler: mockInferenceHandler,
    });

    expect(mockInferenceHandler).toHaveBeenCalledTimes(1);
    expect(result.rawOcr.rawText).toBe(
      'Acme Corp\nJohn Doe CEO\nMob: 9876543210'
    );
    expect(result.rawLlmOutput).toBe(
      JSON.stringify({
        companyName: 'Acme Corp',
        contactPersons: [{ name: 'John Doe', role: 'CEO' }],
        phoneNumbers: ['9876543210'],
      })
    );
    expect(result.card.companyName).toBe('Acme Corp');
  });
});
