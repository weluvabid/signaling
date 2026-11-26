import { expect, test } from '@playwright/test';
import { openSeePage } from './support/fixture.mjs';

test('QR frames round-trip through generated SVG images', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(2_048);
    const envelope = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    const frames = await window.SEE.encodeQrFrames(envelope, { errorCorrectionLevel: 'M' });
    const images = await Promise.all(frames.map((frame) => window.SEE.imageFromDataUrl(frame.dataUrl)));
    const reconstructed = await window.SEE.reassembleQrFrames(images);
    const decoded = await window.SEE.decodeEnvelope(reconstructed);
    return {
      frameCount: frames.length,
      imageCount: images.length,
      equal: window.SEE.equalBytes(envelope, reconstructed),
      payloadEqual: window.SEE.equalBytes(payload, decoded.payload),
    };
  });

  expect(result.frameCount).toBeGreaterThan(1);
  expect(result.imageCount).toBe(result.frameCount);
  expect(result.equal).toBe(true);
  expect(result.payloadEqual).toBe(true);
});

test('QR reassembly accepts frames delivered out of order', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const payload = window.SEE.createPayload(2_048);
    const envelope = await window.SEE.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: Date.now(),
      payload,
      compression: 'none',
    });
    const frames = await window.SEE.encodeQrFrames(envelope);
    const images = await Promise.all(frames.map((frame) => window.SEE.imageFromDataUrl(frame.dataUrl)));
    images.reverse();
    const reconstructed = await window.SEE.reassembleQrFrames(images);
    return window.SEE.equalBytes(envelope, reconstructed);
  });

  expect(result).toBe(true);
});

test('QR decoding enforces image dimension limits before canvas allocation', async ({ page }) => {
  await openSeePage(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4_097;
    canvas.height = 1;
    const image = new Image();
    image.src = canvas.toDataURL();
    await image.decode();
    try {
      await window.SEE.decodeQrImage(image);
      return null;
    } catch (error) {
      return { name: error.name, code: error.code, message: error.message };
    }
  });

  expect(result).not.toBeNull();
  expect(result.code).toBe('RESOURCE_LIMIT');
});
