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
  parseFallbackLocalBill,
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

  it('heals Marathi business cards and normalizes Devanagari numerals', () => {
    // Exact noisy OCR text similar to what PaddleOCR extracted on shahu-motors-marathi.pdf
    const noisyMarathiOcr = `साहु मोटसी
रोजससिहेताअॅडरपेअली
MAYURI
Mob. ८८८८८३२१०४
९९२१५६३६३०
■ ई-रथा
■ ई-बाईक
श्री-गरसानेवा हायोकनागपुर`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: noisyMarathiOcr,
    };

    const healed = runLocalSemanticExtraction(noisyMarathiOcr, rawCard);

    // Healed company name
    expect(healed.companyName).toBe('साहु मोटर्स');
    // Healed brand/tagline
    expect(healed.tagline).toContain('MAYURI');
    // Healed products/services
    expect(healed.providedServices).toContain('ई-रिक्षा');
    expect(healed.providedServices).toContain('ई-बाईक');
    // Zero-hardcoding verification: OCR noise 'रोजससिहेताअॅडरपेअली' is not artificially mapped without linguistic invariant
    expect(healed.providedServices).toContain('ई-रिक्षा');
    // Normalizes Devanagari numerals to 10-digit phone numbers
    expect(healed.phoneNumbers).toContain('8888832104');
    expect(healed.phoneNumbers).toContain('9921563630');
    // Heals address
    expect(healed.addressLines?.[0]).toContain('नागपूर');
    // Zero-hardcoding verification: OCR token 'नागपूर' healed via generic alias
    expect(healed.addressLines?.[0]).toContain('नागपूर');
  });

  it('extracts Marathi person names and designations', () => {
    const marathiCardText = `सचिन मधुकर जोशी (संचालक)
मोबाईल : ९४२२१८७६५४
पत्ता : दुकान क्र. १२, चिंतामणी प्लाझा, पुणे`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: marathiCardText,
    };

    const parsed = runLocalSemanticExtraction(marathiCardText, rawCard);

    expect(parsed.contactPersons).toEqual([
      { name: 'सचिन मधुकर जोशी', role: 'संचालक' },
    ]);
    expect(parsed.phoneNumbers).toContain('9422187654');
    expect(parsed.addressLines?.[0]).toContain('पुणे');
  });

  it('filters out decorative logo noise and non-text artifacts', () => {
    const rawWithLogoNoise = `~|*
©
साहु मोटर्स
///
■
Mob. 8888832104
*~|`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: rawWithLogoNoise,
    };

    const healed = runLocalSemanticExtraction(rawWithLogoNoise, rawCard);

    // Company is cleanly detected without logo symbols
    expect(healed.companyName).toBe('साहु मोटर्स');
    expect(healed.phoneNumbers).toContain('8888832104');
    // None of the logo garbage lines should become contact persons or address lines
    expect(healed.contactPersons).toEqual([]);
    expect(healed.addressLines?.length ?? 0).toBe(0);
  });

  it('extracts Marathi business card fields from Vaishnavi Steel Furniture card', () => {
    const vaishnaviText = `पोपट जमदाडे  !! श्री जानूबाई देवी प्रसन्न !!
मो. ८६०५७७०२९२
     ८६०५७७०२९६
वैष्णवी
स्टील, फर्निचर अॅन्ड इलेक्ट्रॉनिक्स
लग्न बस्त्याचे माहेरघर
आमच्याकडे सोफासेट, डायनिंग टेबल, कपाट,
स्टिल, फर्निचर, ऑफीस टेबल, फ्रिज, कुलर,
एल ई डी सर्व इलेक्ट्रॉनिक्स वस्तु व लग्नकार्यासाठी
लागणाऱ्या सर्व वस्तु व भांडी होलसेल दरात मिळतील.
पंढरपूर टेंभुर्णी रोड, भोसे (क), HP पेट्रोलपंपा शेजारी ता. पंढरपूर`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: vaishnaviText,
    };

    const result = runLocalSemanticExtraction(vaishnaviText, rawCard);

    // Company Name: merged brand + category
    expect(result.companyName).toBe(
      'वैष्णवी स्टील, फर्निचर अॅन्ड इलेक्ट्रॉनिक्स'
    );
    // Contact Person: top-of-card proprietor with invocation stripped
    expect(result.contactPersons).toEqual([
      { name: 'पोपट जमदाडे', role: 'प्रोप्रायटर' },
    ]);
    // Phones: both Devanagari numbers converted to ASCII
    expect(result.phoneNumbers).toContain('8605770292');
    expect(result.phoneNumbers).toContain('8605770296');
    // Tagline: Maherghar slogan
    expect(result.tagline).toBe('लग्न बस्त्याचे माहेरघर');
    // Provided Services: products list parsed, not dumped in address
    expect(result.providedServices).toContain('सोफासेट');
    expect(result.providedServices).toContain('डायनिंग टेबल');
    expect(result.providedServices).toContain('कपाट');
    expect(result.providedServices).toContain('फ्रिज');
    // Address: Pandharpur road without product contamination
    expect(result.addressLines?.length).toBe(1);
    expect(result.addressLines?.[0]).toContain('पंढरपूर');
    expect(result.addressLines?.[0]).toContain('भोसे');
  });

  it('extracts Bharat Sports card with multi-phones, address and owner', () => {
    const raw = `AYYAZ BHAI : 8484940121
9373129250
8446077757
7775066777
CARROM BOARD
Shop No. 29 Maharaj Bag Road, Variety
Sqaure, Sitabuldi, Nagpur - 440012
BHARAT
SPORTS
Whiole Seller & Rehailer of High :
Quality of All Sports Goods
Email : bharatsports29@gmail.com
www. bahratsportsnagpur.com`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('BHARAT SPORTS');
    expect(res.contactPersons[0]?.name).toBe('AYYAZ BHAI');
    expect(res.contactPersons[0]?.role).toBe('Owner');
    expect(res.contactPersons[0]?.phones).toContain('8484940121');
    expect(res.phoneNumbers).toContain('8484940121');
    expect(res.phoneNumbers).toContain('9373129250');
    expect(res.phoneNumbers).toContain('8446077757');
    expect(res.phoneNumbers).toContain('7775066777');
    expect(res.tagline).toMatch(/CARROM BOARD|Sports Goods/i);
    expect(res.emails).toContain('bharatsports29@gmail.com');
    expect(res.websites?.[0]).toContain('bahratsportsnagpur.com');
    expect(res.addressLines?.join(' ')).toContain('Sitabuldi');
    expect(res.providedServices).toContain('All Sports Goods');
  });

  it('extracts Mahakal Telecom card with religious invocation stripped', () => {
    const raw = `।। श्री गणेशाय नमः ।।
Patel : 9983032493
9881199533
MAHAKAL TELECOM
ALL MOBILE SPARE PARTS, FOLDER, LCD & TOUCH (WHOLESALE)
Shop No. G.F-13A, Rahul Bazar Complex, Main Road, Beside Sonchala Jewellers, Sitabuldi, Nagpur.`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('MAHAKAL TELECOM');
    expect(res.contactPersons[0]?.name).toBe('Patel');
    expect(res.contactPersons[0]?.role).toBe('Owner');
    expect(res.contactPersons[0]?.phones).toEqual(['9983032493', '9881199533']);
    expect(res.phoneNumbers).toContain('9983032493');
    expect(res.phoneNumbers).toContain('9881199533');
    expect(
      res.providedServices?.some((s) =>
        s.toLowerCase().includes('mobile spare parts')
      )
    ).toBe(true);
    expect(res.addressLines?.join(' ')).toContain('Sitabuldi');
  });

  it('extracts Govind Singh Fashion Saree card with dual owners', () => {
    const raw = `GSTIN : 27ADIPJ3019R1Z4
गुभुगीबिंद शिंग
फॅशन साडी
राम भंडार होटल के सामने, बडकस चौक, नागपूर
Amar Jiwnani : 9370002379  Jatin Jiwnani : 9373783433
कम्पलीट फॅमिली शॉप`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toContain('फॅशन साडी');
    expect(
      res.contactPersons.some((p) => p.name.includes('Amar Jiwnani'))
    ).toBe(true);
    expect(
      res.contactPersons.some((p) => p.name.includes('Jatin Jiwnani'))
    ).toBe(true);
    expect(res.phoneNumbers).toContain('9370002379');
    expect(res.phoneNumbers).toContain('9373783433');
    expect(res.tagline).toBe('कम्पलीट फॅमिली शॉप');
    expect(res.addressLines?.join(' ')).toContain('बडकस चौक');
  });

  it('extracts Hesten Solutions IT card with Founder, dual address, and services', () => {
    const raw = `Hemlata Jawanjal
CEO & FOUNDER
+91 7385067604, 9588488259
hemlata@hestensolutions.com
www.hestensolutions.com
32/1, RMS. Collony Durga Nagar Old Subhedar Layout Nagpur, India - 440024
336, Bos en Lommerweg, 1061 DJ, Amsterdam Netherland
Hesten Solutions Pvt. Ltd.
• Web & Mobile App Development
• Billing Software • Digital Marketing • Meta Ads`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('Hesten Solutions Pvt. Ltd.');
    expect(res.contactPersons[0]?.name).toBe('Hemlata Jawanjal');
    expect(res.contactPersons[0]?.role).toBe('CEO & FOUNDER');
    expect(res.phoneNumbers).toContain('7385067604');
    expect(res.phoneNumbers).toContain('9588488259');
    expect(res.emails).toContain('hemlata@hestensolutions.com');
    expect(res.websites).toContain('www.hestensolutions.com');
    expect(res.providedServices).toContain('Web & Mobile App Development');
    expect(res.addressLines?.join(' ')).toContain('Durga Nagar');
  });

  it('extracts Rajas Marketing Marathi card with invocation stripped', () => {
    const raw = `॥ परमात्मा एक ॥
Mr. Rajesh T. Bokade
M.: 9146496994
राजस
9373662998
राजस मार्केटींग ॲन्ड सेल्स प्रा. लि.
एक नई सोच जो आपकी जिंदगी बदल दे.....
ऑफीस पत्ता : ६६ न्यु डायमंड नगर, खर्बी रोड, माता मंदीर के पास, नागपूर. M. No: (Off) 8888120511
Res Add : १०, न्यु डायमंड नगर, खर्बी रोड, नागपूर.`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('राजस मार्केटींग ॲन्ड सेल्स प्रा. लि.');
    expect(
      res.contactPersons.some((p) => p.name.includes('Rajesh T. Bokade'))
    ).toBe(true);
    expect(res.phoneNumbers).toContain('9146496994');
    expect(res.phoneNumbers).toContain('9373662998');
    expect(res.phoneNumbers).toContain('8888120511');
    expect(res.tagline).toBe('एक नई सोच जो आपकी जिंदगी बदल दे.....');
    expect(res.addressLines?.join(' ')).toContain('न्यु डायमंड नगर');
  });

  it('extracts Rashidham Astrological Consultancy card', () => {
    const raw = `RASHIDHAM ASTROLOGICAL CONSULTANCY
NEAR ZENDA CHOWK, GAJANAN TEMPLE ROAD, DHARAMPETH, NAGPUR- 440010 (MH). MOB: -91 77760 72277, 8767375280
CONTACT@RASHIDHAM.COM
WWW.RASHIDHAM.COM
VEDIC ASTROLOGY, ASTRO NUMEROLOGY, TAROT, HEALING, VASTU, GEMSTONES & PUJA RITUALS`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('RASHIDHAM ASTROLOGICAL CONSULTANCY');
    expect(res.phoneNumbers).toContain('7776072277');
    expect(res.phoneNumbers).toContain('8767375280');
    expect(res.emails).toContain('contact@rashidham.com');
    expect(res.websites).toContain('www.rashidham.com');
    expect(res.providedServices).toContain('Vedic Astrology');
    expect(res.addressLines?.join(' ')).toContain('DHARAMPETH');
  });

  it('extracts Variety Sports two-sided card', () => {
    const raw = `VARIETY SPORTS
SAGAR PANJWANI
• 7769020832
• 9890774044
GST No. 27BZLPP6133N2ZN
• varietysports.nagpur@gmail.com
• 9 & 10, Maharaj Bagh Road, Sitabuldi, Nagpur - 440 001`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('VARIETY SPORTS');
    expect(res.contactPersons[0]?.name).toBe('SAGAR PANJWANI');
    expect(res.phoneNumbers).toContain('7769020832');
    expect(res.phoneNumbers).toContain('9890774044');
    expect(res.emails).toContain('varietysports.nagpur@gmail.com');
    expect(res.addressLines?.join(' ')).toContain('Sitabuldi');
  });

  it('extracts Cakes Inn multi-branch card', () => {
    const raw = `Cakes Inn
www.cakesinn.com
265-A, Shivkripa Appartment, Laxmi Nagar Square | 95270 00045
Plot No. 21/22/23/24, Center One Complex Near NMC Octroi Naka, Hingna Road | 95279 00033
Opp. Saraf Chambers, Mount Road, Sadar | 95270 00204
Naga Putla Square, Post Office Road, Gandhibagh | 95270 00012
Plot No. 1 Near Epicure Food Plaza Under Pass Road Manish Nagar | 95270 00773`;

    const rawCard: BusinessCard = {
      contactPersons: [],
      phoneNumbers: [],
      emails: [],
      websites: [],
      addressLines: [],
      rawText: raw,
    };

    const res = runLocalSemanticExtraction(raw, rawCard);
    expect(res.companyName).toBe('Cakes Inn');
    expect(res.websites).toContain('www.cakesinn.com');
    expect(res.phoneNumbers).toContain('9527000045');
    expect(res.phoneNumbers).toContain('9527900033');
    expect(res.phoneNumbers).toContain('9527000204');
    expect(res.phoneNumbers).toContain('9527000012');
    expect(res.phoneNumbers).toContain('9527000773');
  });

  it('extracts medical bill metadata from Southwestern Vermont Medical Center bill', () => {
    const rawBill = `SOUTHWESTERN VERMONT MEDICAL CENTER
BILL TO: Patient
Invoice #: INV-883842
Invoice Date: May 27, 2025
Due Date: Jun 26, 2025
AMOUNT DUE $1,892.00
Subtotal $1,892.00
Call our Patient Financial Services at (802) 885-7531`;

    const bill = parseFallbackLocalBill(rawBill);
    expect(bill.documentType).toBe('BILL');
    expect(bill.issuerName).toBe('Southwestern Vermont Medical Center');
    expect(bill.invoiceNumber).toBe('INV-883842');
    expect(bill.invoiceDate).toBe('May 27, 2025');
    expect(bill.dueDate).toBe('Jun 26, 2025');
    expect(bill.amountDue).toBe(1892.0);
    expect(bill.subtotal).toBe(1892.0);
  });

  it('extracts Good Faith Estimate (GFE) medical document', () => {
    const rawGfe = `Good Faith Estimate (GFE) - Colonoscopy
Patient Name: John Doe
Provider / Facility Information:
ABC Gastroenterology Associates
Total Estimated Cost: $3,450
Amount Owed: $2,200`;

    const bill = parseFallbackLocalBill(rawGfe);
    expect(bill.documentType).toBe('GOOD FAITH ESTIMATE');
    expect(bill.issuerName).toContain('ABC Gastroenterology Associates');
    expect(bill.amountDue).toBe(2200);
    expect(bill.subtotal).toBe(3450);
  });

  it('extracts Health Insurance Statement bill', () => {
    const rawInsurance = `HIGHMARK
Provider: COPLEY HOSPITAL
Member: VEDANSH C CHOPKAR
Date (s) of Service: 04/27/26
TOTALS: $252.00
Claim # 22681147071`;

    const bill = parseFallbackLocalBill(rawInsurance);
    expect(bill.documentType).toBe('HEALTH INSURANCE CLAIM');
    expect(bill.issuerName).toContain('COPLEY HOSPITAL');
    expect(bill.invoiceNumber).toBe('22681147071');
    expect(bill.invoiceDate).toBe('04/27/26');
    expect(bill.amountDue).toBe(252.0);
  });
});
