import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const FIXTURE_TEXT =
  'WALMART\n2025-03-14\nCoffee  4.50\nMuffin  3.25\nSubtotal  7.75\nTax  0.62\nTotal  8.37';

// Tiny 1×1 PNG bytes (valid PNG, accepted by the image validator)
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function setupTestMode(page: import('@playwright/test').Page, text = FIXTURE_TEXT) {
  await page.addInitScript((t: string) => {
    (window as any).__ocrTestMode = { text: t };
  }, text);
}

function writeFixturePng(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-fixture-'));
  const filePath = path.join(dir, 'receipt.png');
  fs.writeFileSync(filePath, Buffer.from(PIXEL_PNG_B64, 'base64'));
  return filePath;
}

test.describe('OCR workflow', () => {
  test('extracts text from an image and exports TXT', async ({ page }) => {
    await setupTestMode(page);
    await page.goto('/');

    // Switch to OCR mode
    await page.click('[data-action="set-mode"][data-mode="ocr"]');
    await expect(
      page.locator('[data-action="set-mode"][data-mode="ocr"]'),
    ).toHaveAttribute('aria-pressed', 'true');

    // Upload file via hidden file input
    const filePath = writeFixturePng();
    await page.setInputFiles('#file-input', filePath);

    // Wait for file to be loaded (card appears)
    await expect(page.locator('.ocr-card')).toBeVisible({ timeout: 10_000 });

    // Run OCR
    await page.click('[data-action="run-ocr"]');

    // Wait for textarea to be populated with our fixture text
    const textarea = page.locator('[data-action="edit-ocr-text"]').first();
    await expect(textarea).toHaveValue(/WALMART/, { timeout: 15_000 });
    await expect(textarea).toHaveValue(/Total\s+8\.37/);

    // Download TXT — "Download all" button
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="download-ocr-all"]'),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const content = fs.readFileSync(downloadPath!, 'utf8');
    expect(content).toContain('WALMART');
    expect(content).toContain('Total  8.37');
  });

  test('exports CSV in receipt mode with parsed line items', async ({ page }) => {
    await setupTestMode(page);
    await page.goto('/');
    await page.click('[data-action="set-mode"][data-mode="ocr"]');
    await expect(
      page.locator('[data-action="set-mode"][data-mode="ocr"]'),
    ).toHaveAttribute('aria-pressed', 'true');

    // Enable receipt mode via the checkbox
    await page.check('[data-action="toggle-receipt-mode"]');

    // Select CSV format via <select data-action="set-ocr-format">
    await page.selectOption('[data-action="set-ocr-format"]', 'csv');

    // Upload file
    const filePath = writeFixturePng();
    await page.setInputFiles('#file-input', filePath);
    await expect(page.locator('.ocr-card')).toBeVisible({ timeout: 10_000 });

    // Run OCR
    await page.click('[data-action="run-ocr"]');

    // Wait for results
    await expect(
      page.locator('[data-action="edit-ocr-text"]').first(),
    ).toHaveValue(/Total/, { timeout: 15_000 });

    // Download CSV
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="download-ocr-all"]'),
    ]);

    const content = fs.readFileSync((await download.path())!, 'utf8');
    // CSV header row
    expect(content).toContain('fileName');
    // Line items from fixture text
    expect(content).toContain('Coffee');
    // Total value from fixture
    expect(content).toContain('8.37');
  });
});
