import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('independent WebRTC peer pairs exchange messages concurrently', async ({ page }) => {
  await openSeePage(page);
  const results = await page.evaluate(async () =>
    Promise.all([window.SEE.runPeerExchange(), window.SEE.runPeerExchange()]),
  );

  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.response).toBe('SEE_PONG');
    expect(result.dataChannelState).toBe('open');
  }
});
