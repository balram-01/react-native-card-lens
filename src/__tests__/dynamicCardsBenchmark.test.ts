import { describe, it, expect } from '@jest/globals';
import {
  extractHybridUniversalCard,
  calculateExtractionConfidence,
} from '../LocalCardLLM';

describe('Dynamic & Unseen Visiting Cards Extraction Benchmark', () => {
  // ─── Test 1: Healthcare & Specialist Clinic ──────────────────────────────────
  it('dynamically extracts Healthcare card without hardcoded overrides', () => {
    const rawText = `
Dr. Sneha Kulkarni
MBBS, DGO (Gynecologist & Obstetrician)
Reg. No. 2014/05/1234

APEX WOMEN'S CLINIC & MATERNITY HOME
Comprehensive Healthcare & Diagnostic Services

Plot 14, Bhandarkar Road, Shivaji Nagar, Pune - 411004
Tel: 020-25671122
Mob: +91 98221 44556
Email: drsneha@apexclinicpune.com
Web: www.apexclinicpune.com
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/APEX/i);
    expect(card.phoneNumbers).toContain('9822144556');
    expect(card.emails).toContain('drsneha@apexclinicpune.com');
    expect(card.websites).toContain('www.apexclinicpune.com');
    expect(card.pincode).toBe('411004');
    expect(card.confidence).toBeGreaterThanOrEqual(0.8);
    expect(card.requiresSlmReasoning).toBe(false);
  });

  // ─── Test 2: Manufacturing & Precision Engineering ───────────────────────────
  it('dynamically extracts Industrial Manufacturing card with GSTIN & Managing Director', () => {
    const rawText = `
VERTEX PRECISION ENGINEERING PVT. LTD.
Manufacturers of CNC Machined Components & Toolings

Rajesh Kulkarni
Managing Director

Works & Office:
Plot No. E-45, MIDC Industrial Area, Hingna Road, Nagpur - 440016
Phone: +91 7104 235678
Mobile: 94221 09876
Email: sales@vertexprecision.in
Web: https://www.vertexprecision.in
GSTIN: 27AABCV1234F1Z1
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/VERTEX/i);
    expect(card.phoneNumbers).toContain('9422109876');
    expect(card.emails).toContain('sales@vertexprecision.in');
    expect(card.pincode).toBe('440016');
    expect(card.gstin).toBe('27AABCV1234F1Z1');
    expect(card.confidence).toBeGreaterThanOrEqual(0.85);
  });

  // ─── Test 3: Legal & Corporate Advisory ──────────────────────────────────────
  it('dynamically extracts Legal Consultancy card with Advocate title', () => {
    const rawText = `
Adv. Prashant Deshmukh
B.Com., LL.M.
Advocate Bombay High Court & Corporate Legal Advisor

DESHMUKH & ASSOCIATES LEGAL CONSULTANTS
Specializing in Arbitration, Property Law & Taxation

Chamber No. 12, High Court Bar Association Building, Civil Lines, Nagpur - 440001
Mobile: +91 98900 12345, 93700 54321
Email: prashant@deshmukhlegal.com
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/DESHMUKH/i);
    expect(card.phoneNumbers).toContain('9890012345');
    expect(card.phoneNumbers).toContain('9370054321');
    expect(card.emails).toContain('prashant@deshmukhlegal.com');
    expect(card.pincode).toBe('440001');
    expect(card.confidence).toBeGreaterThanOrEqual(0.75);
  });

  // ─── Test 4: Real Estate & Infra Developers ──────────────────────────────────
  it('dynamically extracts Real Estate Developers card with Managing Partner', () => {
    const rawText = `
Vikramaditya Rao
Managing Partner

GREEN VALLEY INFRA DEVELOPERS LLP
Premium Residential Townships & Commercial Hubs

Corporate Office:
Road No. 36, Jubilee Hills, Hyderabad - 500033
Call: +91 40 67890123
Direct: 98490 87654
Email: vikram@greenvalleyinfra.com
Visit: www.greenvalleyinfra.com
GSTIN: 36AAACG9876L1Z4
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/GREEN VALLEY/i);
    expect(card.phoneNumbers).toContain('9849087654');
    expect(card.emails).toContain('vikram@greenvalleyinfra.com');
    expect(card.websites).toContain('www.greenvalleyinfra.com');
    expect(card.pincode).toBe('500033');
    expect(card.gstin).toBe('36AAACG9876L1Z4');
    expect(card.confidence).toBeGreaterThanOrEqual(0.85);
  });

  // ─── Test 5: IT & Cloud Computing ────────────────────────────────────────────
  it('dynamically extracts IT & Software Services card with CTO', () => {
    const rawText = `
CLOUDMATRIX TECHNOLOGIES
Next-Gen Cloud Architecture & AI Integration

Ananya Iyer
Chief Technology Officer

2nd Floor, Startup Hub, Sector 2, HSR Layout, Bengaluru - 560102
Tel: +91 80 4123 4567
Mobile: 99800 33221
Email: ananya.iyer@cloudmatrix.io
Website: https://cloudmatrix.io
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/CLOUDMATRIX/i);
    expect(card.phoneNumbers).toContain('9980033221');
    expect(card.emails).toContain('ananya.iyer@cloudmatrix.io');
    expect(card.websites).toContain('https://cloudmatrix.io');
    expect(card.pincode).toBe('560102');
    expect(card.confidence).toBeGreaterThanOrEqual(0.8);
  });

  // ─── Test 6: Retail Wholesale Grocery ────────────────────────────────────────
  it('dynamically extracts Retail Trade card with multiple mobiles & GSTIN', () => {
    const rawText = `
SHREE GANESH TRADERS
Whole Seller of Spices, Grains & Food Products

Mahesh Agrawal : 98224 55667
Dinesh Agrawal : 93731 88990

Shop No. 15, Itwari Grain Market, Nagpur - 440002
GSTIN: 27AATPA4321Q1Z8
Email: shreeganeshtraders@gmail.com
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/SHREE GANESH/i);
    expect(card.phoneNumbers).toContain('9822455667');
    expect(card.phoneNumbers).toContain('9373188990');
    expect(card.emails).toContain('shreeganeshtraders@gmail.com');
    expect(card.pincode).toBe('440002');
    expect(card.gstin).toBe('27AATPA4321Q1Z8');
  });

  // ─── Test 7: Automobile & Multi-Brand Garage ─────────────────────────────────
  it('dynamically extracts Automobile Repair card with Proprietor', () => {
    const rawText = `
OM SAI AUTO CARE
Multi-Brand Car Service, Mechanical, Electrical & AC Repair

Sunil Jadhav
Proprietor
Mob: 98500 77665

Plot No. 8, MIDC Waluj, Chhatrapati Sambhajinagar (Aurangabad) - 431136
Email: omsaiautocare@yahoo.com
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/OM SAI/i);
    expect(card.phoneNumbers).toContain('9850077665');
    expect(card.emails).toContain('omsaiautocare@yahoo.com');
    expect(card.pincode).toBe('431136');
  });

  // ─── Test 8: Devanagari Marathi Agriculture Card ─────────────────────────────
  it('dynamically extracts Devanagari Agriculture card with Marathi numerals', () => {
    const rawText = `
सह्याद्री ऍग्रो एजन्सी
सर्व प्रकारची खते, बियाणे व दर्जेदार कीटकनाशके होलसेल व किरकोळ दरात मिळतील.

संभाजी पाटील
मो. ९८२२१ ३३४४५
फोन: ०२३३-२५४६७८

शेतकरी भवन समोर, स्टेशन रोड, सांगली - ४१६४१६
GSTIN: 27AAAPS5678R1Z3
`;
    const card = extractHybridUniversalCard(rawText);

    expect(card.companyName).toMatch(/सह्याद्री/u);
    // 9822133445 normalized from Marathi numerals ९८२२१ ३३४४५
    expect(card.phoneNumbers).toContain('9822133445');
    expect(card.pincode).toBe('416416');
    expect(card.gstin).toBe('27AAAPS5678R1Z3');
  });

  // ─── Confidence Scoring Unit Verification ────────────────────────────────────
  it('correctly calculates high confidence for complete card and low confidence for sparse text', () => {
    const completeCard = {
      companyName: 'Apex Quantum Technologies Ltd',
      phoneNumbers: ['9822112233', '9822112234'],
      emails: ['info@apexquantum.com'],
      contactPersons: [{ name: 'Rajesh Kulkarni', role: 'Managing Director' }],
      addressLines: ['123 Tech Park, Pune'],
      pincode: '411045',
      gstin: '27AAAAA1234A1Z5',
    };
    const assessmentHigh = calculateExtractionConfidence(completeCard);
    expect(assessmentHigh.confidence).toBeGreaterThanOrEqual(0.85);
    expect(assessmentHigh.requiresSlmReasoning).toBe(false);

    const sparseCard = {
      rawText: 'Just some unclear text without phone or company suffix',
      phoneNumbers: [],
      emails: [],
      contactPersons: [],
      addressLines: [],
    };
    const assessmentLow = calculateExtractionConfidence(sparseCard);
    expect(assessmentLow.confidence).toBeLessThan(0.5);
    expect(assessmentLow.requiresSlmReasoning).toBe(true);
    expect(assessmentLow.reasons.length).toBeGreaterThan(0);
  });
});
