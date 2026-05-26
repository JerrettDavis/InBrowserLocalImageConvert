import type { OcrResult, ExportFormat } from './ocr-types';

export interface ExportOptions {
  combined?: boolean;
  receiptMode?: boolean;
}

export interface ExportArtifact {
  blob: Blob;
  fileName: string;
}

export async function buildExport(
  _results: OcrResult[],
  _format: ExportFormat,
  _opts?: ExportOptions
): Promise<ExportArtifact[]> {
  throw new Error('not implemented');
}
