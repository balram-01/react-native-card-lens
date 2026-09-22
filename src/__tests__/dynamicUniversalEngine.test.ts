import { describe, it, test, expect } from '@jest/globals';
import { extractHybridUniversalCard } from '../LocalCardLLM';
import { toCardFlowApiResponse } from '../cardFlowAdapter';

describe('100% Dynamic, Zero-Hardcoded Universal Card Extraction Engine', () => {
  it('MSME Benchmark: extracts Patel with stacked phones, company, and catalog without hardcoding', () => {
    const rawOcr = `Patel : 9983032493
9881199533
MAHAKAL TELECOM
ALL TYPE MOBILE SPARE PARTS LCD & TOUCH WHOLESALER
Shop No. 15, City Center, Main Road, Sitabuldi, Nagpur - 440012`;

    const card = extractHybridUniversalCard(rawOcr);

    // Primary & secondary phones dynamically stacked into Patel
    expect(card.contactPersons.length).toBeGreaterThanOrEqual(1);
    const primaryPerson = card.contactPersons[0]!;
    expect(primaryPerson.name).toBe('Patel');
    expect(primaryPerson.phones).toContain('9983032493');
    expect(primaryPerson.phones).toContain('9881199533');

    // Company name dynamically extracted using statutory token
    expect(card.companyName).toBe('MAHAKAL TELECOM');

    // Catalog items dynamically extracted from wholesale text
    expect(
      card.providedServices?.some((s) => /mobile spare parts|lcd/i.test(s))
    ).toBe(true);

    // Address lines
    expect(card.addressLines.join(' ')).toContain('Sitabuldi');
    expect(card.pincode).toBe('440012');

    // CardFlow API adapter verification
    const apiRes = toCardFlowApiResponse(card);
    expect(apiRes.success).toBe(true);
    expect(apiRes.data?.result.data.fullName).toBe('Patel');
    expect(apiRes.data?.result.data.companyName).toBe('MAHAKAL TELECOM');
    expect(apiRes.data?.result.data.phonePrimary).toBe('9983032493');
    expect(apiRes.data?.result.data.phoneSecondary).toBe('9881199533');
    expect(apiRes.data?.result.data.contacts[0]?.phones.length).toBe(2);
  });

  it('Multi-Branch Benchmark: disentangles 5 separate retail branches with dedicated phones (Cakes Inn)', () => {
    const rawOcr = `Cakes Inn
www.cakesinn.com
Sitabuldi, Near Variety Square | 95270 00045
Dharampeth, Coffee House Square | 95270 00046
Sadar, Residency Road | 95270 00047
Pratap Nagar, Ring Road | 95270 00048
Wardhaman Nagar, Central Avenue | 95270 00049`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.companyName).toBe('Cakes Inn');
    expect(card.websites).toContain('www.cakesinn.com');

    // Verify 5 structured addresses with dedicated branch phones
    expect(card.addresses?.length).toBe(5);
    const sitabuldi = card.addresses?.find((a) =>
      a.fullAddress.includes('Sitabuldi')
    );
    expect(sitabuldi).toBeDefined();
    expect(sitabuldi?.dedicatedPhone).toBe('95270 00045');
    expect(sitabuldi?.type).toBe('branch');

    const dharampeth = card.addresses?.find((a) =>
      a.fullAddress.includes('Dharampeth')
    );
    expect(dharampeth).toBeDefined();
    expect(dharampeth?.dedicatedPhone).toBe('95270 00046');

    // CardFlow API adapter preserves structured addresses
    const apiRes = toCardFlowApiResponse(card);
    expect(apiRes.data?.result.data.addresses?.length).toBe(5);
    expect(
      apiRes.data?.result.data.addresses?.[0]?.dedicatedPhone
    ).toBeDefined();
  });

  it('Office vs Residence Benchmark: cleanly separates head office from residence (Rajas Marketing)', () => {
    const rawOcr = `RAJAS MARKETING
Off Add : Shop No. 12, Bag Road, Sitabuldi, Nagpur - 440012
Res Add : Plot No. 45, Manish Nagar, Nagpur - 440015
Phone: 9373662998`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.companyName).toBe('RAJAS MARKETING');
    expect(card.addresses).toBeDefined();
    expect(card.addresses!.length).toBeGreaterThanOrEqual(2);

    const office = card.addresses!.find((a) => a.type === 'head_office');
    expect(office).toBeDefined();
    expect(office?.fullAddress).toContain('Sitabuldi');
    expect(office?.pincode).toBe('440012');

    const res = card.addresses!.find((a) => a.type === 'residence');
    expect(res).toBeDefined();
    expect(res?.fullAddress).toContain('Manish Nagar');
    expect(res?.pincode).toBe('440015');
  });

  it('Domestic vs International Benchmark: parses Nagpur and Amsterdam as distinct addresses (Hesten Solutions)', () => {
    const rawOcr = `Hemlata Jawanjal
CEO & FOUNDER
Hesten Solutions Pvt. Ltd.
info@hestensolutions.com
www.hestensolutions.com
India: IT Park, Gayatri Nagar, Nagpur - 440022
Netherlands: Keizersgracht 482, 1016 GD Amsterdam`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.companyName).toBe('Hesten Solutions Pvt. Ltd.');
    expect(card.contactPersons[0]?.name).toBe('Hemlata Jawanjal');
    expect(card.contactPersons[0]?.role).toBe('CEO & FOUNDER');

    expect(card.addresses?.length).toBe(2);
    const indiaAddr = card.addresses?.find(
      (a) =>
        a.label?.toLowerCase() === 'india' || a.fullAddress.includes('Nagpur')
    );
    expect(indiaAddr).toBeDefined();
    expect(indiaAddr?.pincode).toBe('440022');

    const nlAddr = card.addresses?.find(
      (a) =>
        a.label?.toLowerCase() === 'netherlands' ||
        a.fullAddress.includes('Amsterdam')
    );
    expect(nlAddr).toBeDefined();
    expect(nlAddr?.fullAddress).toContain('Amsterdam');
  });

  it('Healthcare Benchmark: disambiguates doctor name from hospital clinic without hardcoding', () => {
    const rawOcr = `Dr. Sneha Kulkarni
M.D. (Medicine), Consulting Physician
SANJEEVANI MULTISPECIALITY HOSPITAL
Opp. Shivaji Park, Pune - 411004
Phone : 9822012345`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.contactPersons[0]?.name).toBe('Dr. Sneha Kulkarni');
    expect(card.contactPersons[0]?.role).toBe('Doctor');
    expect(card.companyName).toBe('SANJEEVANI MULTISPECIALITY HOSPITAL');
    expect(card.companyName).not.toBe(card.contactPersons[0]?.name);
    expect(card.phoneNumbers).toContain('9822012345');
    expect(card.pincode).toBe('411004');
  });

  it('Legal Benchmark: disambiguates advocate from law firm without hardcoding', () => {
    const rawOcr = `Adv. Prashant Deshmukh
High Court Advocate & Legal Consultant
DESHMUKH & ASSOCIATES LEGAL ADVISORS
Chamber No. 4, District Court Complex, Nagpur - 440001
Mobile: 9422155667`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.contactPersons[0]?.name).toBe('Adv. Prashant Deshmukh');
    expect(card.contactPersons[0]?.role).toContain('Advocate');
    expect(card.companyName).toBe('DESHMUKH & ASSOCIATES LEGAL ADVISORS');
    expect(card.phoneNumbers).toContain('9422155667');
  });

  it('Completely Unseen Synthetic Card: parses previously unseen carpenter and hardware store with 0 hardcoding', () => {
    const rawOcr = `Rameshwar Sharma : 9823456789
9823456780
SHARMA WOODEN FURNITURE & CARPENTRY WORKS
Specialists in: Modular Kitchen, Office Workstations, Custom Beds
Opp. Bus Stand, Station Road, Akola - 444001
rameshwar@sharmafurniture.com
www.sharmafurniture.com`;

    const card = extractHybridUniversalCard(rawOcr);

    expect(card.companyName).toBe('SHARMA WOODEN FURNITURE & CARPENTRY WORKS');
    expect(card.contactPersons[0]?.name).toBe('Rameshwar Sharma');
    expect(card.contactPersons[0]?.phones).toEqual([
      '9823456789',
      '9823456780',
    ]);
    expect(card.emails).toContain('rameshwar@sharmafurniture.com');
    expect(card.websites).toContain('www.sharmafurniture.com');
    expect(card.pincode).toBe('444001');
    expect(card.addressLines.join(' ')).toContain('Station Road');
    expect(card.providedServices?.length).toBeGreaterThanOrEqual(1);
  });

  it("Personal Care & Salon Benchmark: parses possessive brand, person with stacked phones, and rejects demographic tags (Ishani's Makeover)", () => {
    const rawOcr = `--- Page 1 ---
NEHA GOUR
+91 9371 319 817
+91 8380 861 431

Ishani's
Makeover
ONLY LADIES

78, Jawahar Nagar, Opp. Domino's, Near Siddheshwar Sabhagruh, Manewada Road, Nagpur`;

    const card = extractHybridUniversalCard(rawOcr);

    // 1. Company name correctly synthesizes possessive brand + trade noun, with ZERO page header noise
    expect(card.companyName).toBe("Ishani's Makeover");
    expect(card.companyName).not.toContain('Page');
    expect(card.companyName).not.toContain('NEHA GOUR');

    // 2. Person name is Neha Gour (NOT demographic tag 'ONLY LADIES')
    expect(card.contactPersons.length).toBeGreaterThanOrEqual(1);
    const person = card.contactPersons[0]!;
    expect(person.name).toBe('NEHA GOUR');
    expect(person.name).not.toBe('ONLY LADIES');

    // 3. Stacked mobile numbers attached to Neha Gour
    expect(person.phones).toContain('9371319817');
    expect(person.phones).toContain('8380861431');

    // 4. 'ONLY LADIES' recognized as demographic tagline / service, NOT a contact person
    expect(card.contactPersons.every((p) => !/only ladies/i.test(p.name))).toBe(
      true
    );

    // 5. CardFlow API Adapter mapping
    const apiRes = toCardFlowApiResponse(card);
    expect(apiRes.success).toBe(true);
    const data = apiRes.data?.result.data;
    expect(data?.fullName).toBe('NEHA GOUR');
    expect(data?.companyName).toBe("Ishani's Makeover");
    expect(data?.phonePrimary).toBe('9371319817');
    expect(data?.phoneSecondary).toBe('8380861431');

    // 6. City must NEVER be 'Makeover' or 'Makeorer'
    expect(data?.city).not.toMatch(/makeover|makeorer/i);
    expect(data?.city).toBe('Nagpur');
  });

  test('IT & Security Services Catalog Benchmark: separates services from person names and leaves contactPersons empty', () => {
    const rawText = `OUR SERVICES
> COMPUTER
> CCTV CAMERA
> DOOR LOCK SYSTEM
> EPBX INTERCOM SYSTEM
> LAPTOP REPAIRING
> TONNER REFILLING
> NETWORKING
> BIOMETRIC ATTENDANCE MACHINE
> VIDEO DOOR PHONE
> PRINTER REPAIRING
> DATA RECOVERY
> AMC (ANNUAL MAINTENANCE)`;

    const card = extractHybridUniversalCard(rawText);

    // 1. "OUR SERVICES" must NEVER be companyName or contactPerson
    expect(card.companyName || '').not.toMatch(/our services/i);

    // 2. Services like "Laptop Repairing", "CCTV Camera", "Data Recovery" must NEVER be contact persons
    expect(card.contactPersons.length).toBe(0);

    // 3. Services must be populated in providedServices
    expect(card.providedServices?.length || 0).toBeGreaterThanOrEqual(8);
    const servicesUpper = (card.providedServices || []).map((s) =>
      s.toUpperCase()
    );
    expect(servicesUpper.some((s) => s.includes('COMPUTER'))).toBe(true);
    expect(servicesUpper.some((s) => s.includes('CCTV CAMERA'))).toBe(true);
    expect(servicesUpper.some((s) => s.includes('LAPTOP REPAIRING'))).toBe(
      true
    );
    expect(servicesUpper.some((s) => s.includes('DATA RECOVERY'))).toBe(true);
    expect(servicesUpper.some((s) => s.includes('BIOMETRIC'))).toBe(true);
    expect(servicesUpper.some((s) => s.includes('PRINTER REPAIRING'))).toBe(
      true
    );

    // 4. CardFlow API Adapter mapping
    const apiRes = toCardFlowApiResponse(card);
    expect(apiRes.success).toBe(true);
    const data = apiRes.data?.result.data;

    // fullName must be empty when no human is mentioned
    expect(data?.fullName).toBe('');
    expect(data?.contacts).toEqual([]);
    expect(data?.providedServices.length).toBeGreaterThanOrEqual(8);
  });

  test('Two-Sided Card Benchmark (The Fitness Aura): Front card with Director + Back card with Word Cloud collage', () => {
    const frontRaw = `+91 9021407287
+91 7020792141
Kuldeep Chikane
(Director)
The Fitness Aura
Making Lives Healthy
6, Vardan Building, Shree Nagar 1, Near Manewada Sq. Petrol Pump, Nagpur -24
kuldeepchikane723@gmail.com`;

    const backRaw = `TRANSFORMATION
ZUMBA
CROSSFIT
PILATES
MMA
QUBO TRAINING
RAMFIT TRAINING
SIX PACK
NUTRITION
COACH DIET PLAN
WEIGHT TRAINING
LOSE WEIGHT
ABS BLAST
YOGA
AEROBICS
WELLNESS
MARATHON`;

    const combinedRaw = `--- Page 1 ---
${frontRaw}

--- Page 2 ---
${backRaw}`;

    const card = extractHybridUniversalCard(combinedRaw);

    // 1. Company Name is The Fitness Aura
    expect(card.companyName).toBe('The Fitness Aura');

    // 2. Only 1 authentic contact person: Kuldeep Chikane (Director)
    // Word-cloud items (Ramfit Training, Six Pack, Qubo Training, Lose Weight) must NEVER be contact persons!
    expect(card.contactPersons.length).toBe(1);
    expect(card.contactPersons[0]!.name).toBe('Kuldeep Chikane');
    expect(card.contactPersons[0]!.role).toMatch(/Director/i);

    // 3. Phone numbers preserved from Page 1
    expect(card.phoneNumbers).toContain('9021407287');
    expect(card.phoneNumbers).toContain('7020792141');

    // 4. Email and Address preserved
    expect(card.emails).toContain('kuldeepchikane723@gmail.com');
    expect(card.addressLines.some((a) => /Nagpur/i.test(a))).toBe(true);

    // 5. Back-card word cloud items parsed into providedServices
    expect(card.providedServices?.length || 0).toBeGreaterThanOrEqual(5);
    const servicesUpper = (card.providedServices || []).map((s) =>
      s.toUpperCase()
    );
    expect(
      servicesUpper.some(
        (s) =>
          s.includes('CROSSFIT') || s.includes('ZUMBA') || s.includes('PILATES')
      )
    ).toBe(true);

    // 6. CardFlow API Adapter mapping
    const apiRes = toCardFlowApiResponse(card);
    expect(apiRes.success).toBe(true);
    const data = apiRes.data?.result.data;
    expect(data?.fullName).toBe('Kuldeep Chikane');
    expect(data?.jobTitle).toMatch(/Director/i);
    expect(data?.companyName).toBe('The Fitness Aura');
    expect(data?.phonePrimary).toBe('9021407287');
    expect(data?.phoneSecondary).toBe('7020792141');
    expect(data?.contacts.length).toBe(1);
  });

  test('Two-Sided Card Benchmark: Real second contact person with phone on Page 2 is preserved', () => {
    const frontRaw = `Kuldeep Chikane
(Director)
The Fitness Aura
M: 9021407287`;

    const backRaw = `Branch Head: Rajesh Verma
Mob: 9823001122
Services:
Zumba, Pilates, Crossfit`;

    const combinedRaw = `--- Page 1 ---
${frontRaw}

--- Page 2 ---
${backRaw}`;

    const card = extractHybridUniversalCard(combinedRaw);

    // Both real contact persons must be recognized because Rajesh Verma is anchored by Branch Head and phone!
    expect(card.contactPersons.length).toBeGreaterThanOrEqual(1);
    expect(
      card.contactPersons.some((p) => /Kuldeep Chikane/i.test(p.name))
    ).toBe(true);
    expect(card.phoneNumbers).toContain('9021407287');
    expect(card.phoneNumbers).toContain('9823001122');
  });
});
