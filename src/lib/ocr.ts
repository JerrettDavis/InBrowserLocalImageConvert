import type { OcrResult, OcrProgressFn } from './ocr-types';

export async function runOcr(
  _file: File,
  _fileId: string,
  _opts?: { lang?: string; onProgress?: OcrProgressFn; signal?: AbortSignal }
): Promise<OcrResult> {
  throw new Error('not implemented');
}

export async function terminateOcr(): Promise<void> {
  // no-op until implemented
}
