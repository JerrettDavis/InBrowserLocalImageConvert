export type ExportFormat = 'txt' | 'csv' | 'xlsx';

export interface OcrWord {
  text: string;
  confidence: number;
  bbox?: [number, number, number, number];
}

export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
}

export interface ReceiptData {
  merchant?: string;
  date?: string;
  items: LineItem[];
  subtotal?: number;
  tax?: number;
  total?: number;
  currency?: string;
}

export interface OcrResult {
  readonly id: string;
  readonly fileName: string;
  readonly text: string;
  readonly confidence: number;
  readonly words?: OcrWord[];
  readonly parsed?: ReceiptData;
  readonly error?: string;
}

export interface OcrProgress {
  fileId: string;
  phase: string;
  ratio: number;
}

export type OcrProgressFn = (p: OcrProgress) => void;
