import assert from 'node:assert/strict';
import test from 'node:test';

let dependenciesAvailable = true;
try {
  await import('cborg');
  await import('qr');
  await import('qr/decode.js');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    dependenciesAvailable = false;
  } else {
    throw error;
  }
}

const protocol = dependenciesAvailable ? await import('../dist/index.js') : undefined;
const qr = dependenciesAvailable ? await import('../dist/qr.js') : undefined;
const { SignalingError } = await import('../dist/core/errors.js');

test(
  'QR encoder renders bounded versioned fragment frames',
  { skip: !dependenciesAvailable },
  async () => {
    const envelope = await protocol.encodeEnvelope({
      kind: 'custom',
      contentType: 'text/plain',
      createdAt: 1_700_000_000_000,
      payload: new TextEncoder().encode('QR exchange preview'),
    });
    const frames = await qr.encodeQrFrames(envelope, { errorCorrectionLevel: 'H' });
    assert.equal(frames.length, 1);
    assert.equal(frames[0].index, 0);
    assert.equal(frames[0].count, 1);
    assert.match(frames[0].dataUrl, /^data:image\/svg\+xml;charset=utf-8,/u);
  },
);

test(
  'QR encoder rejects fragment sizes outside the QR budget',
  { skip: !dependenciesAvailable },
  async () => {
    const envelope = await protocol.encodeEnvelope({
      kind: 'custom',
      contentType: 'text/plain',
      payload: Uint8Array.of(1),
    });
    await assert.rejects(
      qr.encodeQrFrames(envelope, { maxFragmentDataBytes: 851 }),
      SignalingError,
    );
  },
);
