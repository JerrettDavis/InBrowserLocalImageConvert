import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { buildExport } from './export';
import type { OcrResult } from './ocr-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const r1: OcrResult = {
  id: '1',
  fileName: 'photo one.jpg',
  text: 'Hello World',
  confidence: 0.95,
};

const r2: OcrResult = {
  id: '2',
  fileName: 'photo_two.png',
  text: 'Line1\nLine2',
  confidence: 0.88,
};

const r3: OcrResult = {
  id: '3',
  fileName: 'scan, third.jpg',
  text: 'Text with "quotes" and, commas',
  confidence: 0.72,
};

const rReceipt1: OcrResult = {
  id: 'r1',
  fileName: 'receipt1.jpg',
  text: 'ACME Store\n2025-01-15\nApples 2 x 1.50 3.00\nBread 2.50\nSubtotal 5.50\nTax 0.45\nTotal 5.95',
  confidence: 0.9,
  parsed: {
    merchant: 'ACME Store',
    date: '2025-01-15',
    currency: 'USD',
    items: [
      { description: 'Apples', quantity: 2, unitPrice: 1.5, total: 3.0 },
      { description: 'Bread', total: 2.5 },
    ],
    subtotal: 5.5,
    tax: 0.45,
    total: 5.95,
  },
};

const rReceipt2: OcrResult = {
  id: 'r2',
  fileName: 'receipt2.jpg',
  text: 'Corner Deli\n2025-03-10\nCoffee 1.80\nTotal 1.80',
  confidence: 0.85,
  parsed: {
    merchant: 'Corner Deli',
    date: '2025-03-10',
    currency: 'USD',
    items: [
      { description: 'Coffee', total: 1.8 },
    ],
    total: 1.8,
  },
};

const rNoParsed: OcrResult = {
  id: 'np',
  fileName: 'no-parse.jpg',
  text: 'Some unrecognized text',
  confidence: 0.5,
  // no parsed field
};

// ── TXT tests ─────────────────────────────────────────────────────────────────

describe('buildExport — TXT', () => {
  it('case 1: single result combined=false → 1 artifact with base filename', async () => {
    const artifacts = await buildExport([r1], 'txt', { combined: false });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].fileName).toBe('photo one.txt');
    const text = await blobText(artifacts[0].blob);
    expect(text).toBe(r1.text);
  });

  it('case 2: three results combined=true → 1 artifact with === headers', async () => {
    const artifacts = await buildExport([r1, r2, r3], 'txt', { combined: true });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].fileName).toBe('ocr-results.txt');
    const text = await blobText(artifacts[0].blob);
    expect(text).toContain('=== photo one.jpg ===\n');
    expect(text).toContain('=== photo_two.png ===\n');
    expect(text).toContain('=== scan, third.jpg ===\n');
    expect(text).toContain(r1.text);
    expect(text).toContain(r2.text);
    expect(text).toContain(r3.text);
  });

  it('case 3: three results combined=false → 3 artifacts', async () => {
    const artifacts = await buildExport([r1, r2, r3], 'txt', { combined: false });
    expect(artifacts).toHaveLength(3);
  });

  it('case 4: sanitizes weird filenames (spaces, colons)', async () => {
    const weirdResult: OcrResult = {
      id: 'w',
      fileName: 'C:\\My File: Test?.jpg',
      text: 'abc',
      confidence: 0.9,
    };
    const artifacts = await buildExport([weirdResult], 'txt', { combined: false });
    expect(artifacts[0].fileName).not.toContain(':');
    expect(artifacts[0].fileName).not.toContain('\\');
    expect(artifacts[0].fileName).not.toContain('?');
    expect(artifacts[0].fileName).toMatch(/\.txt$/);
  });
});

// ── CSV free-form tests ───────────────────────────────────────────────────────

describe('buildExport — CSV (free-form)', () => {
  it('case 5: header row equals fileName,confidence,text', async () => {
    const artifacts = await buildExport([r1], 'csv', { combined: true });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<string[]>(text, { header: false });
    expect(parsed.data[0]).toEqual(['fileName', 'confidence', 'text']);
  });

  it('case 6: multi-line text is quoted and preserves newlines', async () => {
    const artifacts = await buildExport([r2], 'csv', { combined: false });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    expect(parsed.data[0].text).toBe('Line1\nLine2');
  });

  it('case 7: cells with commas are quoted', async () => {
    const commaResult: OcrResult = {
      id: 'c',
      fileName: 'file.jpg',
      text: 'hello, world',
      confidence: 0.8,
    };
    const artifacts = await buildExport([commaResult], 'csv', { combined: false });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    expect(parsed.data[0].text).toBe('hello, world');
  });

  it('case 8: embedded double-quotes get doubled (RFC 4180)', async () => {
    const quotedResult: OcrResult = {
      id: 'q',
      fileName: 'file.jpg',
      text: 'say "hello"',
      confidence: 0.8,
    };
    const artifacts = await buildExport([quotedResult], 'csv', { combined: false });
    const raw = await blobText(artifacts[0].blob);
    // The raw CSV must contain doubled quotes
    expect(raw).toContain('""');
    // Round-trip must recover the original
    const parsed = Papa.parse<Record<string, string>>(raw, { header: true });
    expect(parsed.data[0].text).toBe('say "hello"');
  });

  it('case 9a: combined=true → 1 artifact ocr-results.csv', async () => {
    const artifacts = await buildExport([r1, r2], 'csv', { combined: true });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].fileName).toBe('ocr-results.csv');
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    expect(parsed.data).toHaveLength(2);
  });

  it('case 9b: combined=false → 1 artifact per file, single-row CSV', async () => {
    const artifacts = await buildExport([r1, r2, r3], 'csv', { combined: false });
    expect(artifacts).toHaveLength(3);
    for (const artifact of artifacts) {
      expect(artifact.fileName).toMatch(/\.csv$/);
      const text = await blobText(artifact.blob);
      const parsed = Papa.parse<Record<string, string>>(text, { header: true });
      expect(parsed.data).toHaveLength(1);
      expect(parsed.meta.fields).toEqual(['fileName', 'confidence', 'text']);
    }
  });
});

// ── CSV receipt mode tests ────────────────────────────────────────────────────

describe('buildExport — CSV (receipt mode)', () => {
  const RECEIPT_COLUMNS = [
    'fileName', 'merchant', 'date', 'currency',
    'description', 'quantity', 'unitPrice', 'lineTotal',
    'subtotal', 'tax', 'total',
  ];

  it('case 10: columns match receipt schema, one row per line item', async () => {
    const artifacts = await buildExport([rReceipt1], 'csv', { combined: true, receiptMode: true });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    expect(parsed.meta.fields).toEqual(RECEIPT_COLUMNS);
    // rReceipt1 has 2 items → 2 rows
    expect(parsed.data).toHaveLength(2);
    // First row carries subtotal/tax/total
    expect(parsed.data[0].subtotal).toBe('5.5');
    expect(parsed.data[0].tax).toBe('0.45');
    expect(parsed.data[0].total).toBe('5.95');
    // Second row leaves those empty
    expect(parsed.data[1].subtotal).toBe('');
    expect(parsed.data[1].tax).toBe('');
    expect(parsed.data[1].total).toBe('');
  });

  it('case 11: result with no parsed → emit single row with empty item fields', async () => {
    const artifacts = await buildExport([rNoParsed], 'csv', { combined: true, receiptMode: true });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].fileName).toBe('no-parse.jpg');
    expect(parsed.data[0].description).toBe('');
    expect(parsed.data[0].total).toBe('');
  });

  it('case 12: round-trip parse → one row per item across all results', async () => {
    const artifacts = await buildExport([rReceipt1, rReceipt2], 'csv', {
      combined: true,
      receiptMode: true,
    });
    const text = await blobText(artifacts[0].blob);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true });
    // rReceipt1 has 2 items, rReceipt2 has 1 item → 3 rows total
    expect(parsed.data).toHaveLength(3);
    const descriptions = parsed.data.map(r => r.description);
    expect(descriptions).toContain('Apples');
    expect(descriptions).toContain('Bread');
    expect(descriptions).toContain('Coffee');
  });
});

// ── XLSX tests ────────────────────────────────────────────────────────────────

describe('buildExport — XLSX', () => {
  async function readWorkbook(blob: Blob) {
    const XLSX = await import('xlsx');
    const buf = await blobBytes(blob);
    return XLSX.read(buf, { type: 'array' });
  }

  it('case 13: free-form single result → 1 sheet, cells match', async () => {
    const artifacts = await buildExport([r1], 'xlsx', { combined: false });
    expect(artifacts).toHaveLength(1);
    const wb = await readWorkbook(artifacts[0].blob);
    expect(wb.SheetNames).toHaveLength(1);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = (await import('xlsx')).utils.sheet_to_json<string[]>(ws, { header: 1 });
    // Header row
    expect(rows[0]).toEqual(['fileName', 'confidence', 'text']);
    // Data row
    expect(rows[1][0]).toBe(r1.fileName);
    expect(rows[1][2]).toBe(r1.text);
  });

  it('case 14: three results → 3 sheets, name collisions get numeric suffix', async () => {
    // Two results with same base name after sanitization
    const dup1: OcrResult = { id: 'd1', fileName: 'receipt.jpg', text: 'a', confidence: 0.9 };
    const dup2: OcrResult = { id: 'd2', fileName: 'receipt.png', text: 'b', confidence: 0.8 };
    const dup3: OcrResult = { id: 'd3', fileName: 'other.jpg', text: 'c', confidence: 0.7 };
    const artifacts = await buildExport([dup1, dup2, dup3], 'xlsx', { combined: true });
    expect(artifacts).toHaveLength(1);
    const wb = await readWorkbook(artifacts[0].blob);
    expect(wb.SheetNames).toHaveLength(3);
    expect(wb.SheetNames[0]).toBe('receipt');
    expect(wb.SheetNames[1]).toBe('receipt(1)');
    expect(wb.SheetNames[2]).toBe('other');
  });

  it('case 14b: sheet names are ≤31 chars', async () => {
    const longName: OcrResult = {
      id: 'l',
      fileName: 'this_is_a_very_long_filename_that_exceeds_31_characters.jpg',
      text: 'x',
      confidence: 0.9,
    };
    const artifacts = await buildExport([longName], 'xlsx', { combined: false });
    const wb = await readWorkbook(artifacts[0].blob);
    for (const name of wb.SheetNames) {
      expect(name.length).toBeLessThanOrEqual(31);
    }
  });

  it('case 15: receipt mode → header block then item table', async () => {
    const artifacts = await buildExport([rReceipt1], 'xlsx', {
      combined: false,
      receiptMode: true,
    });
    expect(artifacts).toHaveLength(1);
    const wb = await readWorkbook(artifacts[0].blob);
    const XLSX = await import('xlsx');
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, { header: 1 });

    // Header block: A col labels, B col values
    const headerLabels = rows.slice(0, 6).map(r => r[0]);
    expect(headerLabels).toContain('Merchant');
    expect(headerLabels).toContain('Date');
    expect(headerLabels).toContain('Currency');
    expect(headerLabels).toContain('Subtotal');
    expect(headerLabels).toContain('Tax');
    expect(headerLabels).toContain('Total');

    // Find item table header
    const tableHeaderIdx = rows.findIndex(r =>
      r[0] === 'Description' &&
      r[1] === 'Quantity' &&
      r[2] === 'Unit Price' &&
      r[3] === 'Line Total'
    );
    expect(tableHeaderIdx).toBeGreaterThan(6);

    // Items follow after the header
    const itemRows = rows.slice(tableHeaderIdx + 1).filter(r => r[0]);
    expect(itemRows).toHaveLength(2);
    expect(itemRows[0][0]).toBe('Apples');
    expect(itemRows[1][0]).toBe('Bread');
  });

  it('case 16: combined=true → 1 xlsx artifact; combined=false → 1 per result', async () => {
    const combined = await buildExport([r1, r2, r3], 'xlsx', { combined: true });
    expect(combined).toHaveLength(1);
    expect(combined[0].fileName).toBe('ocr-results.xlsx');
    const wb = await readWorkbook(combined[0].blob);
    expect(wb.SheetNames).toHaveLength(3);

    const separate = await buildExport([r1, r2, r3], 'xlsx', { combined: false });
    expect(separate).toHaveLength(3);
    for (const art of separate) {
      expect(art.fileName).toMatch(/\.xlsx$/);
      const wbSingle = await readWorkbook(art.blob);
      expect(wbSingle.SheetNames).toHaveLength(1);
    }
  });
});
