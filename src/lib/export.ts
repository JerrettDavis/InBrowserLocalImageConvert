import type { OcrResult, ExportFormat, ReceiptData } from './ocr-types';

export interface ExportOptions {
  combined?: boolean;
  receiptMode?: boolean;
}

export interface ExportArtifact {
  blob: Blob;
  fileName: string;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Strip extension, trim whitespace, replace characters that are illegal in
 * common filesystems (Windows + POSIX) with underscores.
 * Illegal: \ / : * ? " < > |  and control characters.
 */
function sanitizeBase(name: string): string {
  // Strip extension
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  return base.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'file';
}

/**
 * Produce a valid XLSX sheet name:
 *  - Replace characters illegal in sheet names: [ ] : * ? / \ and quotes
 *  - Trim to 31 characters (XLSX hard limit)
 *  - Deduplicate: if the name already exists in `used`, append (1), (2), …
 */
function sanitizeSheetName(name: string, used: Set<string>): string {
  // Replace illegal sheet-name chars
  let safe = name.replace(/[\[\]:*?/\\'"]/g, '_').slice(0, 31);
  if (!safe) safe = 'Sheet';

  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  let n = 1;
  while (true) {
    const suffix = `(${n})`;
    // Trim base so the whole thing stays ≤ 31 chars
    const candidate = safe.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n++;
  }
}

/**
 * RFC 4180 CSV cell escaping.
 * Wrap in double-quotes if the value contains comma, newline, or double-quote.
 * Double up any embedded double-quotes.
 */
function csvEscape(cell: string | number | undefined | null): string {
  const s = cell == null ? '' : String(cell);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsvRow(cells: (string | number | undefined | null)[]): string {
  return cells.map(csvEscape).join(',');
}

// ── TXT export ────────────────────────────────────────────────────────────────

function buildTxt(results: OcrResult[], combined: boolean): ExportArtifact[] {
  if (combined) {
    const parts = results.map(r => `=== ${r.fileName} ===\n${r.text}`);
    const content = parts.join('\n\n');
    return [{
      blob: new Blob([content], { type: 'text/plain' }),
      fileName: 'ocr-results.txt',
    }];
  }

  return results.map(r => ({
    blob: new Blob([r.text], { type: 'text/plain' }),
    fileName: sanitizeBase(r.fileName) + '.txt',
  }));
}

// ── CSV free-form export ──────────────────────────────────────────────────────

const CSV_FREEFORM_HEADER = ['fileName', 'confidence', 'text'];

function resultToCsvRow(r: OcrResult): string {
  return buildCsvRow([r.fileName, r.confidence, r.text]);
}

function buildCsvFreeform(results: OcrResult[], combined: boolean): ExportArtifact[] {
  const headerLine = buildCsvRow(CSV_FREEFORM_HEADER);

  if (combined) {
    const lines = [headerLine, ...results.map(resultToCsvRow)];
    return [{
      blob: new Blob([lines.join('\n')], { type: 'text/csv' }),
      fileName: 'ocr-results.csv',
    }];
  }

  return results.map(r => {
    const lines = [headerLine, resultToCsvRow(r)];
    return {
      blob: new Blob([lines.join('\n')], { type: 'text/csv' }),
      fileName: sanitizeBase(r.fileName) + '.csv',
    };
  });
}

// ── CSV receipt export ────────────────────────────────────────────────────────

const CSV_RECEIPT_HEADER = [
  'fileName', 'merchant', 'date', 'currency',
  'description', 'quantity', 'unitPrice', 'lineTotal',
  'subtotal', 'tax', 'total',
];

/**
 * Convert one OcrResult into receipt CSV rows.
 *
 * Convention (case 11): If a result has no `parsed`, emit a single row
 * with fileName populated and all other fields empty. This is more useful
 * than silently skipping — it preserves the file in the output so the user
 * can see which files failed to parse.
 *
 * For results with items: the first row per result carries subtotal/tax/total;
 * subsequent item rows leave those columns empty.
 */
function resultToReceiptRows(r: OcrResult): (string | number | undefined | null)[][] {
  if (!r.parsed) {
    // Emit one empty row so the file is represented
    return [[r.fileName, '', '', '', '', '', '', '', '', '', '']];
  }

  const { parsed } = r;
  const { merchant, date, currency, items, subtotal, tax, total } = parsed;

  if (items.length === 0) {
    // No items but has parsed metadata
    return [[r.fileName, merchant ?? '', date ?? '', currency ?? '', '', '', '', '', subtotal ?? '', tax ?? '', total ?? '']];
  }

  return items.map((item, idx) => {
    const isFirst = idx === 0;
    return [
      r.fileName,
      isFirst ? (merchant ?? '') : '',
      isFirst ? (date ?? '') : '',
      isFirst ? (currency ?? '') : '',
      item.description,
      item.quantity ?? '',
      item.unitPrice ?? '',
      item.total,
      isFirst ? (subtotal ?? '') : '',
      isFirst ? (tax ?? '') : '',
      isFirst ? (total ?? '') : '',
    ];
  });
}

function buildCsvReceipt(results: OcrResult[], combined: boolean): ExportArtifact[] {
  const headerLine = buildCsvRow(CSV_RECEIPT_HEADER);

  if (combined) {
    const dataLines = results.flatMap(r => resultToReceiptRows(r).map(row => buildCsvRow(row)));
    const lines = [headerLine, ...dataLines];
    return [{
      blob: new Blob([lines.join('\n')], { type: 'text/csv' }),
      fileName: 'ocr-results.csv',
    }];
  }

  return results.map(r => {
    const dataLines = resultToReceiptRows(r).map(row => buildCsvRow(row));
    const lines = [headerLine, ...dataLines];
    return {
      blob: new Blob([lines.join('\n')], { type: 'text/csv' }),
      fileName: sanitizeBase(r.fileName) + '.csv',
    };
  });
}

// ── XLSX free-form ────────────────────────────────────────────────────────────

async function buildXlsxFreeform(results: OcrResult[], combined: boolean): Promise<ExportArtifact[]> {
  // Lazy import to keep the main bundle slim
  const XLSX = await import('xlsx');

  function makeSheet(result: OcrResult) {
    const rows: (string | number)[][] = [
      ['fileName', 'confidence', 'text'],
      [result.fileName, result.confidence, result.text],
    ];
    return XLSX.utils.aoa_to_sheet(rows);
  }

  function wbToBlob(wb: ReturnType<typeof XLSX.utils.book_new>): Blob {
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  if (combined) {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    for (const r of results) {
      const sheetName = sanitizeSheetName(sanitizeBase(r.fileName), usedNames);
      XLSX.utils.book_append_sheet(wb, makeSheet(r), sheetName);
    }
    return [{
      blob: wbToBlob(wb),
      fileName: 'ocr-results.xlsx',
    }];
  }

  return results.map(r => {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    const sheetName = sanitizeSheetName(sanitizeBase(r.fileName), usedNames);
    XLSX.utils.book_append_sheet(wb, makeSheet(r), sheetName);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return {
      blob: new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName: sanitizeBase(r.fileName) + '.xlsx',
    };
  });
}

// ── XLSX receipt helpers ──────────────────────────────────────────────────────

/**
 * Builds the top header block for receipt XLSX sheets.
 * Returns array-of-arrays: [label, value] pairs for merchant/date/currency/subtotal/tax/total.
 */
function buildReceiptHeaderRows(parsed: ReceiptData): (string | number | undefined)[][] {
  return [
    ['Merchant', parsed.merchant ?? ''],
    ['Date', parsed.date ?? ''],
    ['Currency', parsed.currency ?? ''],
    ['Subtotal', parsed.subtotal ?? ''],
    ['Tax', parsed.tax ?? ''],
    ['Total', parsed.total ?? ''],
  ];
}

/**
 * Builds the item rows for receipt XLSX sheets.
 * Returns: [Description, Quantity, Unit Price, Line Total]
 */
function buildItemRows(parsed: ReceiptData): (string | number | undefined)[][] {
  return parsed.items.map(item => [
    item.description,
    item.quantity ?? '',
    item.unitPrice ?? '',
    item.total,
  ]);
}

// ── XLSX receipt export ───────────────────────────────────────────────────────

async function buildXlsxReceipt(results: OcrResult[], combined: boolean): Promise<ExportArtifact[]> {
  const XLSX = await import('xlsx');

  function makeReceiptSheet(result: OcrResult) {
    const rows: (string | number | undefined)[][] = [];

    if (!result.parsed) {
      // No parsed data — emit a minimal sheet with just the filename
      rows.push(['File', result.fileName]);
      rows.push(['(no receipt data parsed)']);
      return XLSX.utils.aoa_to_sheet(rows);
    }

    // Header block: rows 1–6 (0-indexed 0–5)
    const headerRows = buildReceiptHeaderRows(result.parsed);
    rows.push(...headerRows);

    // Blank row (row 7, 0-indexed 6)
    rows.push([]);

    // Item table header (row 8, 0-indexed 7)
    rows.push(['Description', 'Quantity', 'Unit Price', 'Line Total']);

    // Item data rows
    const itemRows = buildItemRows(result.parsed);
    rows.push(...itemRows);

    return XLSX.utils.aoa_to_sheet(rows);
  }

  function wbToBlob(wb: ReturnType<typeof XLSX.utils.book_new>): Blob {
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  if (combined) {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    for (const r of results) {
      const sheetName = sanitizeSheetName(sanitizeBase(r.fileName), usedNames);
      XLSX.utils.book_append_sheet(wb, makeReceiptSheet(r), sheetName);
    }
    return [{
      blob: wbToBlob(wb),
      fileName: 'ocr-results.xlsx',
    }];
  }

  return results.map(r => {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    const sheetName = sanitizeSheetName(sanitizeBase(r.fileName), usedNames);
    XLSX.utils.book_append_sheet(wb, makeReceiptSheet(r), sheetName);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return {
      blob: new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName: sanitizeBase(r.fileName) + '.xlsx',
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildExport(
  results: OcrResult[],
  format: ExportFormat,
  opts?: ExportOptions
): Promise<ExportArtifact[]> {
  const combined = opts?.combined ?? false;
  const receiptMode = opts?.receiptMode ?? false;

  switch (format) {
    case 'txt':
      return buildTxt(results, combined);

    case 'csv':
      return receiptMode
        ? buildCsvReceipt(results, combined)
        : buildCsvFreeform(results, combined);

    case 'xlsx':
      return receiptMode
        ? buildXlsxReceipt(results, combined)
        : buildXlsxFreeform(results, combined);

    default:
      throw new Error(`Unknown export format: ${format as string}`);
  }
}
