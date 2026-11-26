import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('compiled package encodes and decodes an envelope in the browser', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(16_384);
    const bytes = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'deflate',
    });
    const decoded = await window.SEE.decodeEnvelope(bytes);
    return {
      inputBytes: payload.byteLength,
      outputBytes: bytes.byteLength,
      decodedBytes: decoded.payload.byteLength,
      equal: window.SEE.equalBytes(payload, decoded.payload),
      compression: decoded.compression,
    };
  });

  expect(result.equal).toBe(true);
  expect(result.decodedBytes).toBe(result.inputBytes);
  expect(result.outputBytes).toBeGreaterThan(0);
  expect(result.compression).toBe('deflate');
});

test('file transport exports and imports a real browser Blob', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(8_192);
    const envelope = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    const blob = window.SEE.createEnvelopeBlob(envelope);
    const imported = await window.SEE.readEnvelopeFile(blob);
    return {
      type: blob.type,
      size: blob.size,
      equal: window.SEE.equalBytes(envelope, imported),
    };
  });

  expect(result.type).toBe('application/vnd.see.envelope');
  expect(result.size).toBeGreaterThan(0);
  expect(result.equal).toBe(true);
});
