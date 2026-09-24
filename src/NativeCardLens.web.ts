import type { Spec } from './NativeCardLens';

const webMock: Spec = {
  recognizeText: async () => ({ rawText: '', blocks: [] }),
  scanBarcodes: async () => [],
  startScanner: async () => ({ pages: [], pageCount: 0, status: 'canceled' }),
  pickDocument: async () => ({ imageUri: '', imageUris: [] }),
  extractContactFields: async () => ({
    phoneNumbers: [],
    emails: [],
    websites: [],
    gstin: [],
    pincodes: [],
  }),
  extractCardLayout: async () => ({
    companyName: undefined,
    tagline: undefined,
    contactPersons: [],
    addressLines: [],
  }),
  scanCard: async () => ({
    companyName: undefined,
    contactPersons: [],
    phoneNumbers: [],
    emails: [],
    websites: [],
    addressLines: [],
  }),
  scanBill: async () => ({
    issuerName: undefined,
    lineItems: [],
    totalAmount: undefined,
  }),
  scanDocument: async () => ({
    type: 'card',
    data: {},
  }),
  scanCardPages: async () => ({
    companyName: undefined,
    contactPersons: [],
    phoneNumbers: [],
    emails: [],
    websites: [],
    addressLines: [],
  }),
  scanBillPages: async () => ({
    issuerName: undefined,
    lineItems: [],
    totalAmount: undefined,
  }),
  scanDocumentPages: async () => ({
    type: 'card',
    data: {},
  }),
  loadThinkingModel: async () => false,
  isThinkingModelReady: async () => false,
  refineCardWithThinkingModule: async (rawText: string) => ({ rawText }),
  unloadThinkingModel: async () => {},
  downloadThinkingModel: async () => '/models/mock.task',
  deleteThinkingModel: async () => true,
  recognizeTextPaddle: async () => ({ rawText: '', blocks: [] }),
  isPaddleOcrReady: async () => false,
  downloadPaddleOcrModels: async () => false,
};

export default webMock;
