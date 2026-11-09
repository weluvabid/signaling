import assert from 'node:assert/strict';
import test from 'node:test';

const { compressDeflate, decompressDeflate } = await import('../dist/core/compression.js');
const { SignalingError } = await import('../dist/core/errors.js');

test('zlib-wrapped DEFLATE compression round-trips bounded payloads', async () => {
  const payload = new TextEncoder().encode('p2p-signaling-data-'.repeat(1_000));
  const compressed = await compressDeflate(payload, 1_000_000);
  const restored = await decompressDeflate(compressed, payload.length, payload.length);
  assert.deepEqual(restored, payload);
});

test('decompression stops when output exceeds the advertised length', async () => {
  const payload = new TextEncoder().encode('A'.repeat(100_000));
  const compressed = await compressDeflate(payload, 1_000_000);
  await assert.rejects(decompressDeflate(compressed, 32, 32), SignalingError);
});

test('compression policy skips small payloads and incompressible large payloads', async () => {
  const { encodeEnvelope, decodeEnvelope } = await import('../dist/index.js');
  const createdAt = 1_700_000_000_000;
  const small = new TextEncoder().encode('repeatable signaling data '.repeat(20));
  const smallEnvelope = await encodeEnvelope({
    kind: 'custom',
    contentType: 'text/plain',
    createdAt,
    payload: small,
    compression: 'deflate',
  });
  const smallDecoded = await decodeEnvelope(smallEnvelope, { now: () => createdAt });
  assert.equal(smallDecoded.compression, 'none');
  assert.deepEqual(smallDecoded.payload, small);

  const random = new Uint8Array(1_048_576);
  let state = 0x51_47_4e;
  for (let index = 0; index < random.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    random[index] = state & 0xff;
  }
  const randomEnvelope = await encodeEnvelope({
    kind: 'custom',
    contentType: 'application/octet-stream',
    createdAt,
    payload: random,
    compression: 'deflate',
  });
  const randomDecoded = await decodeEnvelope(randomEnvelope, { now: () => createdAt });
  assert.equal(randomDecoded.compression, 'none');
  assert.deepEqual(randomDecoded.payload, random);
});

test('compression policy retains DEFLATE for sufficiently compressible payloads', async () => {
  const { encodeEnvelope, decodeEnvelope } = await import('../dist/index.js');
  const createdAt = 1_700_000_000_000;
  const payload = new TextEncoder().encode('v=0\r\na=ice-options:trickle\r\n'.repeat(2_000));
  const envelope = await encodeEnvelope({
    kind: 'custom',
    contentType: 'application/sdp',
    createdAt,
    payload,
    compression: 'deflate',
  });
  const decoded = await decodeEnvelope(envelope, { now: () => createdAt });
  assert.equal(decoded.compression, 'deflate');
  assert.deepEqual(decoded.payload, payload);
});
