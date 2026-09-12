import { describe, it, expect } from '@jest/globals';
import { toCardFlowApiResponse } from '../cardFlowAdapter';
import type { BusinessCard } from '../types';

describe('CardFlowAI Adapter (existin_app_mehtods.md compatibility)', () => {
  const sampleCard: BusinessCard = {
    companyName: 'TechNova Solutions',
    tagline: 'Enterprise Software & Cloud Migration',
    contactPersons: [
      {
        name: 'Rahul Sharma',
        role: 'Chief Technology Officer',
      },
    ],
    phoneNumbers: ['+91 98765 43210', '+91 22 2876 5432'],
    emails: ['rahul.sharma@technova.io'],
    websites: ['https://www.technova.io'],
    addressLines: ['102, Innovation Hub, BKC, Mumbai, Maharashtra - 400051'],
    pincode: '400051',
    rawText:
      'Rahul Sharma\nChief Technology Officer\nTechNova Solutions\n+91 98765 43210',
  };

  it('transforms BusinessCard to CardFlowAI exact response envelope', () => {
    const response = toCardFlowApiResponse(sampleCard);

    expect(response.success).toBe(true);
    expect(response.code).toBe('SUCCESS');
    expect(response.message).toBe('Extraction completed.');
    expect(response.errors).toBeNull();
    expect(response.data).toBeDefined();

    const data = response.data!;
    expect(data.documentType).toBe('business_card');
    expect(data.status).toBe('completed');
    expect(data.needsHumanReview).toBe(false);
    expect(typeof data.jobId).toBe('string');
    expect(data.overallConfidence).toBeGreaterThan(0.8);
  });

  it('produces the exact field contract for data.result.data', () => {
    const response = toCardFlowApiResponse(sampleCard);
    const cardData = response.data!.result.data;

    expect(cardData.fullName).toBe('Rahul Sharma');
    expect(cardData.jobTitle).toBe('Chief Technology Officer');
    expect(cardData.companyName).toBe('TechNova Solutions');
    expect(cardData.email).toBe('rahul.sharma@technova.io');
    expect(cardData.phonePrimary).toBe('+91 98765 43210');
    expect(cardData.phoneSecondary).toBe('+91 22 2876 5432');
    expect(cardData.website).toBe('https://www.technova.io');
    expect(cardData.city).toBe('Mumbai');
    expect(cardData.state).toBe('Maharashtra');
    expect(cardData.providedServices).toEqual([
      'Enterprise Software & Cloud Migration',
    ]);

    // Check contacts array
    expect(cardData.contacts).toHaveLength(1);
    expect(cardData.contacts[0]?.name).toBe('Rahul Sharma');
    expect(cardData.contacts[0]?.role).toBe('Chief Technology Officer');
    expect(cardData.contacts[0]?.phones).toHaveLength(2);
    expect(cardData.contacts[0]?.phones[0]).toEqual({
      type: 'primary',
      number: '+91 98765 43210',
      numberType: 'mobile',
    });
    expect(cardData.contacts[0]?.phones[1]).toEqual({
      type: 'secondary',
      number: '+91 22 2876 5432',
      numberType: 'work',
    });
  });

  it('matches client-side mapping from existin_app_mehtods.md Section 7', () => {
    const response = toCardFlowApiResponse(sampleCard);
    const resData = response.data!.result.data;
    const contactPerson = resData.contacts?.[0];
    const allPhones = contactPerson?.phones || [];

    // Exact logic from CardFlowAI (src/screens/CardPreviewOCR/hooks.ts):
    const fullName = contactPerson?.name || resData.fullName || '';
    const company = resData.companyName || '';
    const designation = contactPerson?.role || resData.jobTitle || '';
    const primaryPhone =
      allPhones.find((p) => p.type === 'primary')?.number ||
      resData.phonePrimary ||
      '';
    const secondaryPhone =
      allPhones.find((p) => p.type === 'secondary')?.number ||
      resData.phoneSecondary ||
      '';
    const email = resData.email || contactPerson?.email || '';
    const website = resData.website || '';
    const city = resData.city || '';
    const state = resData.state || '';
    const address = resData.address || '';
    const category = resData.category || resData.providedServices?.[0] || '';

    expect(fullName).toBe('Rahul Sharma');
    expect(company).toBe('TechNova Solutions');
    expect(designation).toBe('Chief Technology Officer');
    expect(primaryPhone).toBe('+91 98765 43210');
    expect(secondaryPhone).toBe('+91 22 2876 5432');
    expect(email).toBe('rahul.sharma@technova.io');
    expect(website).toBe('https://www.technova.io');
    expect(city).toBe('Mumbai');
    expect(state).toBe('Maharashtra');
    expect(address).toContain('102, Innovation Hub');
    expect(category).toBeTruthy();
  });

  it('flags needsHumanReview when essential fields are missing', () => {
    const incompleteCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: 'Blah blah incomplete',
    };

    const response = toCardFlowApiResponse(incompleteCard);
    const data = response.data!;

    expect(data.status).toBe('needs_review');
    expect(data.needsHumanReview).toBe(true);
    expect(data.result.needsReview).toContain('fullName');
    expect(data.result.needsReview).toContain('companyName');
    expect(data.result.needsReview).toContain('phonePrimary');
  });

  it('includes complete auditTrail and extractionMeta', () => {
    const response = toCardFlowApiResponse(sampleCard);
    const data = response.data!;

    expect(data.auditTrail.length).toBe(5);
    expect(data.auditTrail.map((a) => a.node)).toEqual([
      'preprocess',
      'classify',
      'extract_business_card',
      'validate',
      'finalize',
    ]);
    expect(data.extractionMeta).toEqual({
      totalPages: 1,
      detectedLanguage: 'en',
      needsHumanReview: false,
      needsReviewFields: [],
      retryCount: 0,
    });
  });

  it('handles async job flow with 202 Accepted and real-time polling statuses', async () => {
    const { startAsyncExtraction, getJobStatus, pollJobUntilComplete } =
      await import('../cardFlowAdapter');

    // 1. Start async extraction
    const initRes = await startAsyncExtraction('file:///test_card.jpg');
    expect(initRes.success).toBe(true);
    expect(initRes.code).toBe('PROCESSING');
    expect(initRes.data?.status).toBe('processing');

    const jobId = initRes.data!.jobId;
    expect(typeof jobId).toBe('string');

    // 2. Poll immediate status
    const statusRes = getJobStatus(jobId);
    expect(statusRes.success).toBe(true);
    expect(['processing', 'completed', 'needs_review']).toContain(
      statusRes.data?.status
    );

    // 3. Poll until completion
    const finalRes = await pollJobUntilComplete(jobId, {
      intervalMs: 100,
      timeoutMs: 5000,
    });
    expect(finalRes.success).toBe(true);
    expect(['completed', 'needs_review']).toContain(finalRes.data?.status);
    expect(finalRes.data?.result).toBeDefined();
  });

  it('returns unlimited on-device quota for checkExtractionQuota', async () => {
    const { checkExtractionQuota } = await import('../cardFlowAdapter');
    const quota = await checkExtractionQuota();

    expect(quota.success).toBe(true);
    expect(quota.code).toBe('SUCCESS');
    expect(quota.data?.isUnlimited).toBe(true);
    expect(quota.data?.scansRemaining).toBeGreaterThan(10000);
  });
});
