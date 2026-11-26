import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('two browser peers exchange SEE offer and answer envelopes over a DataChannel', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(() => window.SEE.runPeerExchange());

  expect(result.offerType).toBe('offer');
  expect(result.answerType).toBe('answer');
  expect(result.offerBytes).toBeGreaterThan(0);
  expect(result.answerBytes).toBeGreaterThan(0);
  expect(result.offerFrameCount).toBeGreaterThan(0);
  expect(result.answerFrameCount).toBeGreaterThan(0);
  expect(result.dataChannelState).toBe('open');
  expect(result.response).toBe('SEE_PONG');
});
