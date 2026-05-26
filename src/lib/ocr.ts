import type { OcrResult, OcrProgressFn } from './ocr-types';

type TesseractWorker = {
  recognize: (img: File | Blob) => Promise<{
    data: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let activeLogger: OcrProgressFn | null = null;
let activeFileId: string | null = null;

async function getWorker(lang: string): Promise<TesseractWorker> {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    workerPromise = createWorker(lang, 1, {
      logger: (m: { status: string; progress: number }) => {
        if (activeLogger && activeFileId) {
          activeLogger({ fileId: activeFileId, phase: m.status, ratio: m.progress });
        }
      },
    }) as unknown as Promise<TesseractWorker>;
  }
  return workerPromise;
}

export async function runOcr(
  file: File,
  fileId: string,
  opts?: { lang?: string; onProgress?: OcrProgressFn; signal?: AbortSignal }
): Promise<OcrResult> {
  const lang = opts?.lang ?? 'eng';
  activeLogger = opts?.onProgress ?? null;
  activeFileId = fileId;
  try {
    if (opts?.signal?.aborted) throw new Error('OCR aborted');
    const worker = await getWorker(lang);
    if (opts?.signal?.aborted) throw new Error('OCR aborted');
    const { data } = await worker.recognize(file);
    const words = (data.words ?? []).map(w => ({
      text: w.text,
      confidence: w.confidence,
      bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] as [number, number, number, number],
    }));
    return {
      id: fileId,
      fileName: file.name,
      text: data.text,
      confidence: data.confidence,
      words,
    };
  } finally {
    activeLogger = null;
    activeFileId = null;
  }
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // ignore termination errors
  } finally {
    workerPromise = null;
  }
}
