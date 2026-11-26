import { expect } from '@playwright/test';

export async function openSeePage(page) {
  await page.goto('/tests/browser/fixture.html');
  await expect.poll(() => page.evaluate(() => window.__SEE_READY__)).toBe(true);
  return page;
}
