import { vi } from 'vitest';

// Global mock so no test ever loads the real WASM
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({
      data: {
        text: 'MOCKED OCR TEXT',
        confidence: 95,
        words: [
          { text: 'MOCKED', confidence: 95, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
          { text: 'OCR', confidence: 95, bbox: { x0: 12, y0: 0, x1: 20, y1: 10 } },
        ],
      },
    })),
    terminate: vi.fn(async () => {}),
    setParameters: vi.fn(async () => {}),
    reinitialize: vi.fn(async () => {}),
  })),
}));
