/* global jest */

jest.mock('./src/NativeCardLens', () => ({
  __esModule: true,
  default: {
    scanCard: jest.fn().mockResolvedValue({}),
    scanCardPages: jest.fn().mockResolvedValue({}),
    scanDocument: jest.fn().mockResolvedValue({}),
    startScanner: jest.fn().mockResolvedValue({}),
    scanBill: jest.fn().mockResolvedValue({}),
    refineCardWithThinkingModule: jest.fn().mockResolvedValue({}),
    executeSlmInference: jest.fn().mockResolvedValue('{}'),
    downloadModelWithProgress: jest.fn().mockResolvedValue(''),
    deleteDownloadedModel: jest.fn().mockResolvedValue(true),
    checkModelDownloadStatus: jest.fn().mockResolvedValue(false),
    listDownloadedModels: jest.fn().mockResolvedValue([]),
    recognizeText: jest.fn().mockResolvedValue({ rawText: '', blocks: [] }),
    recognizeTextPaddle: jest
      .fn()
      .mockResolvedValue({ rawText: '', blocks: [] }),
    isPaddleOcrReady: jest.fn().mockResolvedValue(false),
    downloadPaddleOcrModels: jest.fn().mockResolvedValue(true),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}));
