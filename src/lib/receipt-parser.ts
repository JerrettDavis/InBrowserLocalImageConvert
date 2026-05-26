import type { LineItem, ReceiptData } from './ocr-types';

// ── Constants ────────────────────────────────────────────────────────────────

const CURRENCY_MAP: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

// Matches optional leading minus, digits with optional thousand-groups, decimal part
const AMOUNT_RE = /-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}/g;

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
  /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\b/i,
];

const TOTAL_KEYS    = /\b(?:grand\s*total|total\s*due|amount\s*due|total|balance)\b/i;
const SUBTOTAL_KEYS = /\b(?:sub[-\s]?total)\b/i;
const TAX_KEYS      = /\b(?:tax|vat|gst|hst)\b/i;
const QTY_PREFIX    = /^(\d+)\s*[xX@]\s+/;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseAmount(raw: string): number {
  const lastComma = raw.lastIndexOf(',');
  const lastDot   = raw.lastIndexOf('.');

  let normalised: string;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastDot > lastComma) {
      normalised = raw.replace(/,/g, '');
    } else {
      normalised = raw.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    normalised = raw.replace(',', '.');
  } else {
    normalised = raw;
  }

  return parseFloat(normalised);
}

function extractLastAmount(line: string): number | null {
  AMOUNT_RE.lastIndex = 0;
  const matches = line.match(AMOUNT_RE);
  if (!matches || matches.length === 0) return null;
  const raw = matches[matches.length - 1];
  const val = normaliseAmount(raw);
  return isFinite(val) ? val : null;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function parseReceipt(text: string): ReceiptData {
  if (!text || !text.trim()) return { items: [] };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Detect currency
  let currency: string | undefined;
  const symbolMatch = text.match(/[$€£]/);
  if (symbolMatch) {
    currency = CURRENCY_MAP[symbolMatch[0]];
  } else {
    const codeMatch = text.match(/\b(USD|EUR|GBP|CAD|AUD)\b/);
    if (codeMatch) currency = codeMatch[1];
  }

  // 2. Detect merchant: first line with >=3 chars containing a letter,
  //    not starting with a digit, not a date/total/subtotal/tax line
  let merchant: string | undefined;
  for (const line of lines) {
    if (
      line.length >= 3 &&
      /[a-zA-Z]/.test(line) &&
      !/^\d/.test(line) &&
      !DATE_PATTERNS.some(p => p.test(line)) &&
      !TOTAL_KEYS.test(line) &&
      !SUBTOTAL_KEYS.test(line) &&
      !TAX_KEYS.test(line)
    ) {
      merchant = line.slice(0, 60);
      break;
    }
  }

  // 3. Detect date
  let date: string | undefined;
  outer:
  for (const line of lines) {
    for (let i = 0; i < DATE_PATTERNS.length; i++) {
      const m = DATE_PATTERNS[i].exec(line);
      if (m) {
        date = m[0];
        break outer;
      }
    }
  }

  // 4. Process lines
  const items: LineItem[] = [];
  let subtotal: number | undefined;
  let tax: number | undefined;
  let total: number | undefined;

  for (const rawLine of lines) {
    // Strip currency symbols for amount parsing, keep for description extraction
    const line = rawLine.replace(/[$€£]/g, '').trim();

    const amount = extractLastAmount(line);
    if (amount === null) continue;

    if (SUBTOTAL_KEYS.test(line)) {
      subtotal = amount;
      continue;
    }
    if (TAX_KEYS.test(line)) {
      tax = amount;
      continue;
    }
    if (TOTAL_KEYS.test(line)) {
      total = amount; // last wins
      continue;
    }

    // It's a line item — extract description
    AMOUNT_RE.lastIndex = 0;
    const amountMatches = line.match(AMOUNT_RE);
    if (!amountMatches) continue;

    const lastMatch  = amountMatches[amountMatches.length - 1];
    const matchIndex = line.lastIndexOf(lastMatch);
    let description  = line.slice(0, matchIndex).trim();

    if (!description) continue;
    if (TOTAL_KEYS.test(description) || SUBTOTAL_KEYS.test(description) || TAX_KEYS.test(description)) continue;
    if (merchant && description.toLowerCase() === merchant.toLowerCase()) continue;

    // Strip trailing dots/periods from description (OCR noise)
    description = description.replace(/[.\s]+$/, '').trim();
    if (!description) continue;

    let quantity: number | undefined;
    let unitPrice: number | undefined;
    const qtyMatch = QTY_PREFIX.exec(description);
    if (qtyMatch) {
      quantity    = parseInt(qtyMatch[1], 10);
      description = description.slice(qtyMatch[0].length).trim();
      unitPrice   = Math.round((amount / quantity) * 100) / 100;
    }

    const item: LineItem = { description, total: amount };
    if (quantity  !== undefined) item.quantity  = quantity;
    if (unitPrice !== undefined) item.unitPrice = unitPrice;

    items.push(item);
  }

  // 5. Fall back: compute total from items if missing and items exist
  if (total === undefined && items.length > 0) {
    const sum = items.reduce((acc, i) => acc + i.total, 0);
    total = Math.round(sum * 100) / 100;
  }

  // 6. Assemble result
  const result: ReceiptData = { items };
  if (merchant  !== undefined) result.merchant  = merchant;
  if (date      !== undefined) result.date      = date;
  if (currency  !== undefined) result.currency  = currency;
  if (subtotal  !== undefined) result.subtotal  = subtotal;
  if (tax       !== undefined) result.tax       = tax;
  if (total     !== undefined) result.total     = total;

  return result;
}
