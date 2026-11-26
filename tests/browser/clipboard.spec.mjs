import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('clipboard transport round-trips through the browser clipboard', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Clipboard permission support is exercised in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(1_024);
    const envelope = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    await window.SEE.writeClipboard(navigator.clipboard, envelope);
    const decoded = await window.SEE.readClipboard(navigator.clipboard);
    return {
      equal: window.SEE.equalBytes(envelope, decoded),
      text: await navigator.clipboard.readText(),
    };
  });

  expect(result.text.startsWith('SEE1:')).toBe(true);
  expect(result.equal).toBe(true);
});
