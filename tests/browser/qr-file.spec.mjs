import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('selected QR image files are decoded and reassembled in the browser', async ({ page }) => {
  await openSeePage(page);
  const files = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(2_048);
    const envelope = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    const frames = await window.SEE.encodeQrFrames(envelope);
    return frames.map((frame, index) => ({
      name: `see-frame-${index + 1}.svg`,
      content: decodeURIComponent(frame.dataUrl.slice(frame.dataUrl.indexOf(',') + 1)),
    }));
  });

  await page.locator('#qr-files').setInputFiles(files.map((file) => ({
    name: file.name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(file.content),
  })));
  const result = await page.evaluate(async () => {
    const input = document.querySelector('#qr-files');
    const bytes = await window.SEE.reassembleQrFiles(input.files);
    const envelope = await window.SEE.decodeEnvelope(bytes);
    return {
      selectedFiles: input.files.length,
      payloadBytes: envelope.payload.byteLength,
    };
  });

  expect(result.selectedFiles).toBeGreaterThan(1);
  expect(result.payloadBytes).toBe(2_048);
});
