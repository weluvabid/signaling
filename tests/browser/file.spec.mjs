import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('selected browser file is read and decoded as an SEE envelope', async ({ page }) => {
  await openSeePage(page);
  const envelope = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(8_192);
    const bytes = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    return Array.from(bytes);
  });

  await page.locator('#envelope-file').setInputFiles({
    name: 'transfer.see',
    mimeType: 'application/vnd.see.envelope',
    buffer: Buffer.from(envelope),
  });
  const result = await page.evaluate(async () => {
    const file = document.querySelector('#envelope-file').files?.[0];
    if (!file) {
      throw new Error('File input did not receive a File');
    }
    const bytes = await window.SEE.readEnvelopeFile(file);
    const decoded = await window.SEE.decodeEnvelope(bytes);
    return {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      payloadSize: decoded.payload.byteLength,
    };
  });

  expect(result.fileName).toBe('transfer.see');
  expect(result.fileType).toBe('application/vnd.see.envelope');
  expect(result.fileSize).toBeGreaterThan(0);
  expect(result.payloadSize).toBe(8_192);
});
