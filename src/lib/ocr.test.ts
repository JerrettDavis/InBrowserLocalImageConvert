import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOcr, terminateOcr } from './ocr';

// Pull the mocked module so we can inspect call counts
const tesseract = await import('tesseract.js');
const mockedCreateWorker = vi.mocked(tesseract.createWorker);

function makeFile(name = 'test.png'): File {
  return new File(['fake-image-data'], name, { type: 'image/png' });
}

describe('runOcr', () => {
  beforeEach(async () => {
    await terminateOcr();
    vi.clearAllMocks();
  });

  it('returns OcrResult with text, confidence, words, id, and fileName', async () => {
    const file = makeFile('receipt.png');
    const result = await runOcr(file, 'id-1');

    expect(result.id).toBe('id-1');
    expect(result.fileName).toBe('receipt.png');
    expect(result.text).toBe('MOCKED OCR TEXT');
    expect(result.confidence).toBe(95);
    expect(Array.isArray(result.words)).toBe(true);
  });

  it('calls onProgress at least once with a progress object', async () => {
    const file = makeFile('img.png');
    const progressCalls: Array<{ fileId: string; phase: string; ratio: number }> = [];

    await runOcr(file, 'id-progress', {
      onProgress: (p) => progressCalls.push(p),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    const call = progressCalls[0];
    expect(call.fileId).toBe('id-progress');
    expect(typeof call.phase).toBe('string');
    expect(typeof call.ratio).toBe('number');
  });

  it('maps words with bbox as [x0,y0,x1,y1] tuple', async () => {
    const file = makeFile('img.png');
    const result = await runOcr(file, 'id-words');

    expect(result.words).toBeDefined();
    expect(result.words!.length).toBe(2);

    const firstWord = result.words![0];
    expect(firstWord.text).toBe('MOCKED');
    expect(firstWord.bbox).toEqual([0, 0, 10, 10]);

    const secondWord = result.words![1];
    expect(secondWord.text).toBe('OCR');
    expect(secondWord.bbox).toEqual([12, 0, 20, 10]);
  });

  it('reuses the worker across sequential runOcr calls (createWorker called once)', async () => {
    const file1 = makeFile('a.png');
    const file2 = makeFile('b.png');

    await runOcr(file1, 'id-a');
    await runOcr(file2, 'id-b');

    expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
  });

  it('text passthrough matches mock value', async () => {
    const file = makeFile('pass.png');
    const result = await runOcr(file, 'id-pass');
    expect(result.text).toBe('MOCKED OCR TEXT');
  });
});

describe('terminateOcr', () => {
  beforeEach(async () => {
    await terminateOcr();
    vi.clearAllMocks();
  });

  it('calls worker.terminate() and resets cache so next runOcr re-creates the worker', async () => {
    const file = makeFile('t.png');

    // First run — creates worker
    await runOcr(file, 'id-t1');
    expect(mockedCreateWorker).toHaveBeenCalledTimes(1);

    // Get the worker instance to check terminate was called
    const workerInstance = await mockedCreateWorker.mock.results[0].value;
    const terminateSpy = workerInstance.terminate;

    await terminateOcr();
    expect(terminateSpy).toHaveBeenCalledTimes(1);

    // Second run after terminate — should create a new worker
    vi.clearAllMocks();
    await runOcr(file, 'id-t2');
    expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
  });
});
