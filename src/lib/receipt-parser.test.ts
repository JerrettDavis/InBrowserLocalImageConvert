import { describe, it, expect } from 'vitest';
import { parseReceipt } from './receipt-parser';

describe('parseReceipt', () => {
  // Case 1: Two-column US receipt
  it('parses a full two-column US receipt', () => {
    const text = `
WHOLE FOODS MARKET
123 Main St, Springfield
Date: 03/14/2025

Organic Milk         3.99
Free Range Eggs      5.49
Sourdough Bread      4.25

Subtotal            13.73
Tax                  1.10
Total               14.83
`.trim();
    const r = parseReceipt(text);
    expect(r.merchant).toBe('WHOLE FOODS MARKET');
    expect(r.date).toBeTruthy();
    expect(r.items).toHaveLength(3);
    expect(r.items[0].description).toContain('Organic Milk');
    expect(r.items[0].total).toBeCloseTo(3.99);
    expect(r.items[1].total).toBeCloseTo(5.49);
    expect(r.items[2].total).toBeCloseTo(4.25);
    expect(r.subtotal).toBeCloseTo(13.73);
    expect(r.tax).toBeCloseTo(1.10);
    expect(r.total).toBeCloseTo(14.83);
  });

  // Case 2: European receipt with comma decimals
  it('parses European receipt with comma decimals', () => {
    const text = `
Bäckerei Schmidt
Datum: 14.03.2025

Brot             3,50
Croissant        2,20
Kaffee           1,80

Gesamt           7,50
`.trim();
    const r = parseReceipt(text);
    expect(r.items.length).toBeGreaterThanOrEqual(3);
    const brot = r.items.find(i => i.description.toLowerCase().includes('brot'));
    expect(brot).toBeDefined();
    expect(brot!.total).toBeCloseTo(3.5);
    const croissant = r.items.find(i => i.description.toLowerCase().includes('croissant'));
    expect(croissant!.total).toBeCloseTo(2.2);
  });

  // Case 3: Receipt missing explicit "total" — falls back to sum of items
  it('falls back to sum of items when total line is absent', () => {
    const text = `
Corner Deli
Item A          5.00
Item B          3.00
Item C          2.00
`.trim();
    const r = parseReceipt(text);
    expect(r.total).toBeCloseTo(10.0);
    expect(r.items).toHaveLength(3);
  });

  // Case 4: Quantity prefix lines
  it('parses quantity-prefixed lines', () => {
    const text = `
Cafe Nero
2 x Coffee      6.00
3 x Muffin      7.50
Total          13.50
`.trim();
    const r = parseReceipt(text);
    const coffee = r.items.find(i => i.description.toLowerCase().includes('coffee'));
    expect(coffee).toBeDefined();
    expect(coffee!.quantity).toBe(2);
    expect(coffee!.unitPrice).toBeCloseTo(3.0);
    expect(coffee!.total).toBeCloseTo(6.0);
    const muffin = r.items.find(i => i.description.toLowerCase().includes('muffin'));
    expect(muffin!.quantity).toBe(3);
    expect(muffin!.unitPrice).toBeCloseTo(2.5);
  });

  // Case 5: All-caps merchant
  it('detects all-caps merchant name', () => {
    const text = `
WALMART
2025-01-10
Bananas         0.99
Total           0.99
`.trim();
    const r = parseReceipt(text);
    expect(r.merchant).toBe('WALMART');
  });

  // Case 6: Currency symbol detection and normalization
  it('detects and normalizes currency symbols', () => {
    const usd = parseReceipt(`Store\nItem   $5.00\nTotal  $5.00`);
    expect(usd.currency).toBe('USD');

    const eur = parseReceipt(`Laden\nArtikel   €3,50\nGesamt    €3,50`);
    expect(eur.currency).toBe('EUR');

    const gbp = parseReceipt(`Shop\nItem   £4.99\nTotal  £4.99`);
    expect(gbp.currency).toBe('GBP');
  });

  // Case 7: Date in multiple formats
  it('parses dates in multiple formats', () => {
    const iso = parseReceipt(`Shop\n2025-03-14\nItem  1.00\nTotal 1.00`);
    expect(iso.date).toBe('2025-03-14');

    const slash = parseReceipt(`Shop\n03/14/2025\nItem  1.00\nTotal 1.00`);
    expect(slash.date).toBeTruthy();
    expect(slash.date).toContain('03');

    const wordy = parseReceipt(`Shop\nMar 14, 2025\nItem  1.00\nTotal 1.00`);
    expect(wordy.date).toBeTruthy();
    expect(wordy.date!.toLowerCase()).toContain('mar');
  });

  // Case 8: Tax + subtotal + total trio — never confuse subtotal with total
  it('parses subtotal, tax, and total separately', () => {
    const text = `
Grocery Plus
Apples           2.00
Oranges          3.00
Sub-Total        5.00
Tax              0.40
Total            5.40
`.trim();
    const r = parseReceipt(text);
    expect(r.subtotal).toBeCloseTo(5.0);
    expect(r.tax).toBeCloseTo(0.40);
    expect(r.total).toBeCloseTo(5.40);
    // Ensure total != subtotal
    expect(r.total).not.toEqual(r.subtotal);
  });

  // Case 9: Negative discount line
  it('parses negative discount lines', () => {
    const text = `
Supermart
Pasta            2.50
Discount        -2.00
Total            0.50
`.trim();
    const r = parseReceipt(text);
    const discount = r.items.find(i => i.description.toLowerCase().includes('discount'));
    expect(discount).toBeDefined();
    expect(discount!.total).toBeCloseTo(-2.0);
  });

  // Case 10: Noisy OCR with stray punctuation
  it('extracts amounts despite stray OCR punctuation', () => {
    const text = `
Noisy Store
Item..One....5.99
Another..Item...3,00.
Total...9.99..
`.trim();
    const r = parseReceipt(text);
    expect(r.total).toBeCloseTo(9.99);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
  });

  // Case 11: Empty input
  it('returns empty items for empty input', () => {
    const r = parseReceipt('');
    expect(r.items).toEqual([]);
    expect(r.total).toBeUndefined();
    expect(r.merchant).toBeUndefined();
  });

  // Case 12: Total-only receipt — total set, items empty, total NOT auto-computed
  it('sets total without auto-computing when no items found', () => {
    const text = `Total  42.00`;
    const r = parseReceipt(text);
    expect(r.total).toBeCloseTo(42.0);
    expect(r.items).toHaveLength(0);
  });
});
