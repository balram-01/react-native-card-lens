/**
 * react-native-card-lens — Comprehensive Example & QA App
 *
 * Demonstrates 100% on-device, zero-cost document extraction across all phases:
 *  - Phase 1: Live Document Scanner Camera UI with auto-crop & edge detection
 *  - Phase 2: Script-agnostic regex contact extractors (phone, email, web, GSTIN, PIN)
 *  - Phase 3: Layout heuristics (company, contact persons, roles, address, tagline)
 *  - Phase 4: Script detection & end-to-end Business Card engine (`scanCard`)
 *  - Phase 5: Bill & Invoice table reconstruction & metadata parser (`scanBill`)
 *  - Phase 6: Automatic Document Classifier & Auto-Routing (`scanDocument`)
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  startScanner,
  recognizeText,
  scanBarcodes,
  extractContactFields,
  extractCardLayout,
  scanCard,
  scanBill,
  scanDocument,
} from 'react-native-card-lens';
import type {
  RawOcrResult,
  BarcodeResult,
  ScanResult,
  ContactFields,
  CardLayoutFields,
  BusinessCard,
  BillDocument,
  DocumentScanResult,
} from 'react-native-card-lens';

type ActiveTab = 'auto' | 'card' | 'bill' | 'inspect';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('auto');
  const [uri, setUri] = useState('');
  const [scannedImageUri, setScannedImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Result States
  const [autoResult, setAutoResult] = useState<DocumentScanResult | null>(null);
  const [businessCard, setBusinessCard] = useState<BusinessCard | null>(null);
  const [billDocument, setBillDocument] = useState<BillDocument | null>(null);
  const [ocrResult, setOcrResult] = useState<RawOcrResult | null>(null);
  const [contactFields, setContactFields] = useState<ContactFields | null>(
    null
  );
  const [layoutFields, setLayoutFields] = useState<CardLayoutFields | null>(
    null
  );
  const [barcodes, setBarcodes] = useState<BarcodeResult[] | null>(null);

  const clearResults = () => {
    setError(null);
    setAutoResult(null);
    setBusinessCard(null);
    setBillDocument(null);
    setOcrResult(null);
    setContactFields(null);
    setLayoutFields(null);
    setBarcodes(null);
  };

  /**
   * Launch ML Kit Live Document Scanner UI
   */
  const handleLaunchCameraScanner = async () => {
    clearResults();
    setLoading(true);
    setStatusMessage('Opening live camera scanner...');

    try {
      const scan: ScanResult = await startScanner({
        pageLimit: 1,
        scannerMode: 'FULL',
        allowGalleryImport: true,
        autoOcr: true,
        script: 'latin',
      });

      setScannedImageUri(scan.imageUri);
      if (scan.ocrResult) setOcrResult(scan.ocrResult);

      if (scan.imageUri) {
        if (activeTab === 'auto') {
          setStatusMessage('Auto-classifying document...');
          const res = await scanDocument(scan.imageUri);
          setAutoResult(res);
          if (res.type === 'card') setBusinessCard(res.data as BusinessCard);
          else setBillDocument(res.data as BillDocument);
          setStatusMessage(`Auto-detected as: ${res.type.toUpperCase()}`);
        } else if (activeTab === 'card') {
          setStatusMessage('Extracting business card fields...');
          const card = await scanCard(scan.imageUri);
          setBusinessCard(card);
          setStatusMessage('Card scan complete.');
        } else if (activeTab === 'bill') {
          setStatusMessage('Reconstructing invoice table & fields...');
          const bill = await scanBill(scan.imageUri);
          setBillDocument(bill);
          setStatusMessage('Bill table reconstruction complete.');
        } else {
          // Inspect mode
          if (scan.ocrResult) {
            const [contacts, layout] = await Promise.all([
              extractContactFields(scan.ocrResult.rawText),
              extractCardLayout(scan.ocrResult),
            ]);
            setContactFields(contacts);
            setLayoutFields(layout);
          }
          setStatusMessage('Inspected raw OCR & heuristics.');
        }
      }
    } catch (e: any) {
      if (e.code === 'CARDLENS_SCAN_CANCELED') {
        setStatusMessage('Scanner was cancelled by user.');
      } else {
        setError(e.message ?? 'Scanner failed');
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Run specific action on image URI
   */
  const handleRunActiveTabAction = async () => {
    const targetUri = uri.trim() || scannedImageUri;
    if (!targetUri) {
      setError('Please provide a file/content URI or capture a scan first.');
      return;
    }

    clearResults();
    setLoading(true);

    try {
      if (activeTab === 'auto') {
        setStatusMessage('Running auto-routing scanDocument()...');
        const res = await scanDocument(targetUri);
        setAutoResult(res);
        if (res.type === 'card') setBusinessCard(res.data as BusinessCard);
        else setBillDocument(res.data as BillDocument);
        setStatusMessage(`Auto-detected as: ${res.type.toUpperCase()}`);
      } else if (activeTab === 'card') {
        setStatusMessage('Running scanCard() pipeline...');
        const card = await scanCard(targetUri);
        setBusinessCard(card);
        setStatusMessage('Card extraction complete.');
      } else if (activeTab === 'bill') {
        setStatusMessage('Running scanBill() table reconstruction...');
        const bill = await scanBill(targetUri);
        setBillDocument(bill);
        setStatusMessage(`Found ${bill.lineItems.length} line item(s).`);
      } else {
        setStatusMessage('Running OCR & low-level inspectors...');
        const ocr = await recognizeText(targetUri, 'latin');
        setOcrResult(ocr);
        const [contacts, layout, codeList] = await Promise.all([
          extractContactFields(ocr.rawText),
          extractCardLayout(ocr),
          scanBarcodes(targetUri),
        ]);
        setContactFields(contacts);
        setLayoutFields(layout);
        setBarcodes(codeList);
        setStatusMessage('Inspection complete.');
      }
    } catch (e: any) {
      setError(e.message ?? 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* App Title */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>CardLens Studio</Text>
          <Text style={styles.appSubtitle}>
            100% On-Device ML Kit Document & Card Intelligence
          </Text>
        </View>

        {/* Feature Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'auto' && styles.tabActive]}
            onPress={() => setActiveTab('auto')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'auto' && styles.tabTextActive,
              ]}
            >
              Auto-Route
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'card' && styles.tabActive]}
            onPress={() => setActiveTab('card')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'card' && styles.tabTextActive,
              ]}
            >
              Card (P4)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'bill' && styles.tabActive]}
            onPress={() => setActiveTab('bill')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'bill' && styles.tabTextActive,
              ]}
            >
              Bill/Inv (P5)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'inspect' && styles.tabActive]}
            onPress={() => setActiveTab('inspect')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'inspect' && styles.tabTextActive,
              ]}
            >
              Inspect (P1-3)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Primary Action Button: Live Document Camera */}
        <TouchableOpacity
          style={styles.primaryScanBtn}
          onPress={handleLaunchCameraScanner}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryScanIcon}>📷</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.primaryScanTitle}>
              {activeTab === 'auto' && 'Scan Any Document (Auto-Route)'}
              {activeTab === 'card' && 'Scan Business Card'}
              {activeTab === 'bill' && 'Scan Bill or Invoice'}
              {activeTab === 'inspect' && 'Scan & Inspect Raw OCR'}
            </Text>
            <Text style={styles.primaryScanSubtitle}>
              Edge detection • Perspective crop • ML Kit OCR
            </Text>
          </View>
        </TouchableOpacity>

        {/* Scanned Image Preview */}
        {scannedImageUri && (
          <View style={styles.previewBox}>
            <Text style={styles.previewLabel}>Current Cropped Image:</Text>
            <Image
              source={{ uri: scannedImageUri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Secondary URI Input */}
        <View style={styles.manualInputSection}>
          <TextInput
            style={styles.input}
            value={uri}
            onChangeText={setUri}
            placeholder="file:///... or content://... (optional)"
            placeholderTextColor="#6B7280"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.runUriBtn}
            onPress={handleRunActiveTabAction}
            disabled={loading}
          >
            <Text style={styles.runUriBtnText}>
              ⚡ Run on URI ({activeTab.toUpperCase()})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress & Errors */}
        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>
              {statusMessage || 'Processing...'}
            </Text>
          </View>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        {statusMessage && !loading && !error && (
          <Text style={styles.statusText}>{statusMessage}</Text>
        )}

        {/* Auto-Route Badge */}
        {autoResult && (
          <View style={styles.routeBadge}>
            <Text style={styles.routeBadgeLabel}>CLASSIFICATION RESULT:</Text>
            <Text style={styles.routeBadgeValue}>
              {autoResult.type === 'bill'
                ? '🧾 INVOICE / BILL'
                : '📇 BUSINESS CARD'}
            </Text>
          </View>
        )}

        {/* ── Bill & Invoice Display (Phase 5) ─────────────────────────────── */}
        {billDocument && (
          <View style={styles.cardContainer}>
            <View style={styles.cardHeader}>
              <View style={[styles.badge, { backgroundColor: '#059669' }]}>
                <Text style={styles.badgeText}>PHASE 5 BILL ENGINE</Text>
              </View>
              <Text style={styles.cardHeaderTitle}>
                {billDocument.documentType || 'INVOICE / BILL'}
              </Text>
            </View>

            {/* Issuer Name */}
            {billDocument.issuerName && (
              <View style={styles.issuerBox}>
                <Text style={styles.issuerLabel}>ISSUER / PROVIDER</Text>
                <Text style={styles.issuerName}>{billDocument.issuerName}</Text>
              </View>
            )}

            {/* Invoice Metadata Grid */}
            <View style={styles.metaGrid}>
              <View style={styles.metaCol}>
                <Text style={styles.metaKey}>Invoice No:</Text>
                <Text style={styles.metaVal}>
                  {billDocument.invoiceNumber || '—'}
                </Text>
              </View>
              <View style={styles.metaCol}>
                <Text style={styles.metaKey}>Invoice Date:</Text>
                <Text style={styles.metaVal}>
                  {billDocument.invoiceDate || '—'}
                </Text>
              </View>
              {billDocument.dueDate && (
                <View style={styles.metaCol}>
                  <Text style={styles.metaKey}>Due Date:</Text>
                  <Text style={styles.metaVal}>{billDocument.dueDate}</Text>
                </View>
              )}
            </View>

            {/* Financial Highlights */}
            <View style={styles.financialRow}>
              {billDocument.subtotal != null && (
                <View style={styles.financialBox}>
                  <Text style={styles.finLabel}>SUBTOTAL</Text>
                  <Text style={styles.finValue}>
                    ₹ / $ {billDocument.subtotal.toFixed(2)}
                  </Text>
                </View>
              )}
              {billDocument.amountDue != null && (
                <View style={[styles.financialBox, styles.finHighlight]}>
                  <Text style={styles.finLabel}>TOTAL AMOUNT DUE</Text>
                  <Text style={[styles.finValue, styles.finValueHighlight]}>
                    ₹ / $ {billDocument.amountDue.toFixed(2)}
                  </Text>
                </View>
              )}
            </View>

            {/* Reconstructed Line Items Table */}
            <Text style={styles.sectionHeader}>
              📋 Reconstructed Table ({billDocument.lineItems.length} items):
            </Text>
            {billDocument.lineItems.length > 0 ? (
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { flex: 2 }]}>DESCRIPTION</Text>
                  <Text
                    style={[styles.thCell, { flex: 1, textAlign: 'center' }]}
                  >
                    CODE
                  </Text>
                  <Text
                    style={[styles.thCell, { flex: 1, textAlign: 'right' }]}
                  >
                    AMOUNT
                  </Text>
                </View>
                {billDocument.lineItems.map((item, idx) => (
                  <View key={idx} style={styles.tableRow}>
                    <Text style={[styles.tdCell, { flex: 2 }]}>
                      {item.description}
                    </Text>
                    <Text
                      style={[
                        styles.tdCell,
                        { flex: 1, textAlign: 'center', color: '#9CA3AF' },
                      ]}
                    >
                      {item.code || '—'}
                    </Text>
                    <Text
                      style={[
                        styles.tdCell,
                        {
                          flex: 1,
                          textAlign: 'right',
                          fontWeight: '700',
                          color: '#10B981',
                        },
                      ]}
                    >
                      {item.billedAmount != null
                        ? item.billedAmount.toFixed(2)
                        : '—'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyNote}>
                No tabular line items detected.
              </Text>
            )}
          </View>
        )}

        {/* ── Business Card Display (Phase 4) ─────────────────────────────── */}
        {businessCard && (
          <View style={styles.cardContainer}>
            <View style={styles.cardHeader}>
              <View style={[styles.badge, { backgroundColor: '#4F46E5' }]}>
                <Text style={styles.badgeText}>PHASE 4 BUSINESS CARD</Text>
              </View>
              <Text style={styles.cardHeaderTitle}>
                {businessCard.companyName || 'Business Card'}
              </Text>
            </View>

            {businessCard.tagline && (
              <Text style={styles.cardTagline}>"{businessCard.tagline}"</Text>
            )}

            {/* Contact Persons */}
            {businessCard.contactPersons.length > 0 && (
              <View style={styles.cardFieldBlock}>
                <Text style={styles.cardFieldLabel}>👤 CONTACT PERSONS</Text>
                {businessCard.contactPersons.map((p, idx) => (
                  <View key={idx} style={styles.personItem}>
                    <Text style={styles.personName}>{p.name}</Text>
                    {p.role && (
                      <Text style={styles.personRole}> • {p.role}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Phones */}
            {businessCard.phoneNumbers.length > 0 && (
              <View style={styles.cardFieldBlock}>
                <Text style={styles.cardFieldLabel}>📞 PHONES</Text>
                <View style={styles.chipRow}>
                  {businessCard.phoneNumbers.map((phone, idx) => (
                    <View key={idx} style={styles.chip}>
                      <Text style={styles.chipText}>{phone}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Email & Website */}
            {(businessCard.email || businessCard.website) && (
              <View style={styles.cardFieldBlock}>
                <Text style={styles.cardFieldLabel}>🌐 DIGITAL CONTACTS</Text>
                <View style={styles.chipRow}>
                  {businessCard.email && (
                    <View style={[styles.chip, styles.emailChip]}>
                      <Text style={styles.chipText}>
                        ✉️ {businessCard.email}
                      </Text>
                    </View>
                  )}
                  {businessCard.website && (
                    <View style={[styles.chip, styles.webChip]}>
                      <Text style={styles.chipText}>
                        🌐 {businessCard.website}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Address */}
            {businessCard.addressLines.length > 0 && (
              <View style={styles.cardFieldBlock}>
                <Text style={styles.cardFieldLabel}>📍 ADDRESS</Text>
                {businessCard.addressLines.map((addr, idx) => (
                  <Text key={idx} style={styles.addressLine}>
                    {addr}
                  </Text>
                ))}
              </View>
            )}

            {/* Tax & Identifiers */}
            {(businessCard.pincode ||
              businessCard.gstin ||
              businessCard.qrCodeData) && (
              <View style={styles.cardFieldBlock}>
                <Text style={styles.cardFieldLabel}>
                  🏷️ IDENTIFIERS & CODES
                </Text>
                <View style={styles.chipRow}>
                  {businessCard.pincode && (
                    <View style={[styles.chip, styles.pinChip]}>
                      <Text style={styles.chipText}>
                        PIN: {businessCard.pincode}
                      </Text>
                    </View>
                  )}
                  {businessCard.gstin && (
                    <View style={[styles.chip, styles.gstChip]}>
                      <Text style={styles.chipText}>
                        GSTIN: {businessCard.gstin}
                      </Text>
                    </View>
                  )}
                  {businessCard.qrCodeData && (
                    <View style={[styles.chip, styles.qrChip]}>
                      <Text style={styles.chipText}>
                        QR: {businessCard.qrCodeData}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Low-Level Heuristics & OCR Inspection (Phase 1–3) ─────────────── */}
        {contactFields && (
          <View style={styles.inspectSection}>
            <Text style={styles.inspectHeader}>
              ⚡ Contact Regex Extractors (Phase 2):
            </Text>
            <Text style={styles.inspectRow}>
              Phones: {contactFields.phoneNumbers.join(', ') || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              Emails: {contactFields.emails.join(', ') || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              Websites: {contactFields.websites.join(', ') || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              GSTIN: {contactFields.gstin.join(', ') || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              PIN Codes: {contactFields.pincodes.join(', ') || 'None'}
            </Text>
          </View>
        )}

        {layoutFields && (
          <View style={styles.inspectSection}>
            <Text style={styles.inspectHeader}>
              📐 Layout Bounding-Box Heuristics (Phase 3):
            </Text>
            <Text style={styles.inspectRow}>
              Tallest Header: {layoutFields.companyName || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              Tagline: {layoutFields.tagline || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              Persons:{' '}
              {layoutFields.contactPersons
                .map((p) => `${p.name} (${p.role || '—'})`)
                .join('; ') || 'None'}
            </Text>
            <Text style={styles.inspectRow}>
              Address: {layoutFields.addressLines.join(', ') || 'None'}
            </Text>
          </View>
        )}

        {barcodes && barcodes.length > 0 && (
          <View style={styles.inspectSection}>
            <Text style={styles.inspectHeader}>
              🏁 Barcodes & QR Codes ({barcodes.length}):
            </Text>
            {barcodes.map((b, i) => (
              <Text key={i} style={styles.inspectRow}>
                [{b.format}] {b.rawValue}
              </Text>
            ))}
          </View>
        )}

        {ocrResult && (
          <View style={styles.inspectSection}>
            <Text style={styles.inspectHeader}>
              🔤 Raw OCR Output ({ocrResult.blocks.length} blocks):
            </Text>
            <Text style={styles.rawTextPreview}>{ocrResult.rawText}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9FAFB',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#161824',
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#4F46E5',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  primaryScanBtn: {
    flexDirection: 'row',
    backgroundColor: '#4338CA',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#6366F1',
    gap: 12,
  },
  primaryScanIcon: {
    fontSize: 28,
  },
  primaryScanTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryScanSubtitle: {
    color: '#C7D2FE',
    fontSize: 11,
    marginTop: 2,
  },
  previewBox: {
    marginBottom: 12,
  },
  previewLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  previewImage: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2E3247',
  },
  manualInputSection: {
    marginBottom: 14,
  },
  input: {
    backgroundColor: '#161824',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#F9FAFB',
    fontSize: 12,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: '#2E3247',
    marginBottom: 8,
  },
  runUriBtn: {
    backgroundColor: '#1E2235',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  runUriBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingBox: {
    alignItems: 'center',
    marginVertical: 12,
  },
  loadingText: {
    color: '#A5B4FC',
    fontSize: 12,
    marginTop: 6,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginVertical: 6,
    textAlign: 'center',
  },
  statusText: {
    color: '#10B981',
    fontSize: 12,
    marginVertical: 4,
    textAlign: 'center',
    fontWeight: '600',
  },
  routeBadge: {
    backgroundColor: '#1E2235',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#38BDF8',
  },
  routeBadgeLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  routeBadgeValue: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  cardContainer: {
    backgroundColor: '#131520',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#374151',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  cardTagline: {
    color: '#9CA3AF',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  issuerBox: {
    backgroundColor: '#1E2235',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  issuerLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
  },
  issuerName: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  metaGrid: {
    flexDirection: 'row',
    backgroundColor: '#161824',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  metaCol: {
    flex: 1,
  },
  metaKey: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '600',
  },
  metaVal: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  financialRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  financialBox: {
    flex: 1,
    backgroundColor: '#161824',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2E3247',
  },
  finHighlight: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B20',
  },
  finLabel: {
    color: '#9CA3AF',
    fontSize: 9,
    fontWeight: '700',
  },
  finValue: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
  },
  finValueHighlight: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionHeader: {
    color: '#D1D5DB',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  table: {
    backgroundColor: '#161824',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2E3247',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#1E2235',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2E3247',
  },
  thCell: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2436',
    alignItems: 'center',
  },
  tdCell: {
    color: '#F3F4F6',
    fontSize: 11,
  },
  emptyNote: {
    color: '#6B7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  cardFieldBlock: {
    marginBottom: 10,
  },
  cardFieldLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  personItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  personName: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '700',
  },
  personRole: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '500',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  emailChip: { borderColor: '#10B981' },
  webChip: { borderColor: '#8B5CF6' },
  pinChip: { borderColor: '#EC4899' },
  gstChip: { borderColor: '#F59E0B' },
  qrChip: { borderColor: '#14B8A6' },
  chipText: {
    color: '#F9FAFB',
    fontSize: 11,
    fontWeight: '500',
  },
  addressLine: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  inspectSection: {
    backgroundColor: '#161824',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2E3247',
  },
  inspectHeader: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  inspectRow: {
    color: '#D1D5DB',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  rawTextPreview: {
    color: '#9CA3AF',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 15,
    backgroundColor: '#0F111A',
    padding: 8,
    borderRadius: 6,
  },
});
