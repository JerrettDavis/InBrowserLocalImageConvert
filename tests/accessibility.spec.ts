import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sampleImagePath = path.resolve(currentDir, '../src/assets/hero.png');
const themes = ['dark', 'light'] as const;

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${label} violations:\n${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
}

for (const theme of themes) {
  test.describe(`${theme} theme WCAG coverage`, () => {
    test.use({ colorScheme: theme });

    test(`passes WCAG checks across empty, uploaded, and converted states`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /simple image conversion that never leaves your browser/i })).toBeVisible();
      await expect(page.locator('#file-input')).toBeAttached();

      await expectNoViolations(page, `${theme} empty`);

      await page.locator('#file-input').setInputFiles([sampleImagePath, sampleImagePath]);
      await expect(page.locator('.card')).toHaveCount(2);
      await expect(page.getByRole('button', { name: /convert to jpg/i })).toBeEnabled();

      await expectNoViolations(page, `${theme} uploaded`);

      await page.getByRole('button', { name: /convert to jpg/i }).click();
      await expect(page.locator('.badge--success')).toHaveCount(2);
      await expect(page.getByRole('button', { name: /download zip/i })).toBeEnabled();

      await expectNoViolations(page, `${theme} converted`);
    });
  });
}
