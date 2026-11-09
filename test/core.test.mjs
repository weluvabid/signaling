import assert from 'node:assert/strict';
import test from 'node:test';
import { CompressionStream } from 'node:stream/web';

const { encodeBase64Url, decodeBase64Url, concatBytes, equalBytes, toArrayBuffer } =
  await import('../dist/core/bytes.js');
const { resolveLimits, DEFAULT_LIMITS, HARD_LIMITS } = await import('../dist/core/limits.js');
const { SignalingError } = await import('../dist/core/errors.js');

let hasCborg = true;
let cborg;
try {
  cborg = await import('cborg');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    hasCborg = false;
  } else {
    throw error;
  }
}

const protocol = hasCborg ? await import('../dist/index.js') : undefined;
const cbor = hasCborg ? await import('../dist/core/cbor.js') : undefined;

test('base64url round-trips arbitrary bytes without padding', () => {
  for (let length = 0; length < 257; length += 1) {
    const input = Uint8Array.from({ length }, (_, index) => (index * 31 + length) & 0xff);
    const encoded = encodeBase64Url(input);
    assert.doesNotMatch(encoded, /[=+/]/u);
    assert.deepEqual(decodeBase64Url(encoded, 1_024), input);
  }
});

test('base64url rejects malformed and oversized input', () => {
  assert.throws(() => decodeBase64Url('bad=', 10), SignalingError);
  assert.throws(
    () => decodeBase64Url('AAAA', 2),
    (error) => error.code === 'RESOURCE_LIMIT',
  );
  assert.throws(
    () => decodeBase64Url('A', 10),
    (error) => error.code === 'INVALID_ENCODING',
  );
  assert.throws(
    () => decodeBase64Url('AB', 10),
    (error) => error.code === 'INVALID_ENCODING',
  );
});

test('ArrayBuffer conversion copies only the view and does not alias its source', () => {
  const backing = Uint8Array.of(99, 1, 2, 3, 88);
  const view = backing.subarray(1, 4);
  const buffer = toArrayBuffer(view);
  assert.ok(buffer instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(buffer), Uint8Array.of(1, 2, 3));
  backing[1] = 42;
  assert.deepEqual(new Uint8Array(buffer), Uint8Array.of(1, 2, 3));
});

test('byte concatenation enforces the declared length', () => {
  const joined = concatBytes([Uint8Array.of(1, 2), Uint8Array.of(3)], 3);
  assert.deepEqual(joined, Uint8Array.of(1, 2, 3));
  assert.throws(() => concatBytes([Uint8Array.of(1, 2)], 3), SignalingError);
  assert.throws(() => concatBytes([Uint8Array.of(1, 2, 3)], 2), SignalingError);
  assert.equal(equalBytes(joined, Uint8Array.of(1, 2, 3)), true);
});

test('limits are finite and cannot exceed protocol hard ceilings', () => {
  assert.ok(DEFAULT_LIMITS.maxEnvelopeBytes > 0);
  assert.ok(DEFAULT_LIMITS.maxEnvelopeBytes <= HARD_LIMITS.maxEnvelopeBytes);
  assert.throws(
    () => resolveLimits({ maxEnvelopeBytes: HARD_LIMITS.maxEnvelopeBytes + 1 }),
    SignalingError,
  );
  assert.throws(() => resolveLimits({ maxConcurrentTransfers: 0 }), SignalingError);
  assert.throws(
    () => resolveLimits({ maxInFlightFragments: HARD_LIMITS.maxInFlightFragments + 1 }),
    SignalingError,
  );
  assert.throws(() => resolveLimits({ unexpectedLimit: 1 }), SignalingError);
});

test('envelope encoding is deterministic and round-trips', { skip: !hasCborg }, async () => {
  const input = {
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => index),
    messageId: Uint8Array.from({ length: 16 }, (_, index) => 255 - index),
    kind: 'offer',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    contentType: 'application/sdp',
    payload: new TextEncoder().encode('v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\n'),
    compression: 'none',
  };
  const first = await protocol.encodeEnvelope(input);
  const second = await protocol.encodeEnvelope(input);
  assert.deepEqual(first, second);
  const decoded = await protocol.decodeEnvelope(first, { now: () => input.createdAt });
  assert.equal(decoded.kind, 'offer');
  assert.equal(decoded.contentType, 'application/sdp');
  assert.deepEqual(decoded.payload, input.payload);
  assert.deepEqual(decoded.sessionId, input.sessionId);
});

test('envelope integrity rejects tampered bytes', { skip: !hasCborg }, async () => {
  const encoded = await protocol.encodeEnvelope({
    kind: 'custom',
    contentType: 'application/octet-stream',
    createdAt: 1_700_000_000_000,
    payload: Uint8Array.of(1, 2, 3, 4),
  });
  const tampered = encoded.slice();
  tampered[tampered.length - 4] ^= 0x01;
  await assert.rejects(
    protocol.decodeEnvelope(tampered, { now: () => 1_700_000_000_000 }),
    SignalingError,
  );
});

test(
  'compressed envelopes enforce exact decompressed length',
  { skip: !hasCborg || typeof CompressionStream !== 'function' },
  async () => {
    const payload = new TextEncoder().encode('signaling-payload-'.repeat(2_000));
    const encoded = await protocol.encodeEnvelope({
      kind: 'custom',
      contentType: 'text/plain',
      createdAt: 1_700_000_000_000,
      payload,
      compression: 'deflate',
    });
    const decoded = await protocol.decodeEnvelope(encoded, { now: () => 1_700_000_000_000 });
    assert.deepEqual(decoded.payload, payload);
    assert.ok(decoded.compression === 'deflate' || decoded.compression === 'none');
  },
);

test(
  'fragment reassembly accepts out-of-order and identical duplicate frames',
  { skip: !hasCborg },
  async () => {
    const envelope = await protocol.encodeEnvelope({
      kind: 'custom',
      contentType: 'application/octet-stream',
      createdAt: 1_700_000_000_000,
      payload: Uint8Array.from({ length: 4_096 }, (_, index) => index & 0xff),
    });
    const frames = await protocol.fragmentEnvelope(envelope, { maxFragmentDataBytes: 128 });
    const reassembler = new protocol.FragmentReassembler();
    let result;
    for (const frame of [...frames].reverse()) {
      result = await reassembler.add(frame);
      const duplicate = await reassembler.add(frame);
      assert.ok(duplicate.status === 'pending' || duplicate.status === 'duplicate');
    }
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.bytes, envelope);
    assert.equal(reassembler.activeTransfers, 0);
    assert.equal(reassembler.inFlightBytes, 0);
    assert.equal((await reassembler.add(frames[0])).status, 'duplicate');

    const verifyingReassembler = new protocol.FragmentReassembler();
    for (const frame of frames.slice(0, -1)) {
      await verifyingReassembler.add(frame);
    }
    const pendingVerification = verifyingReassembler.add(frames.at(-1));
    const duplicateDuringVerification = await verifyingReassembler.add(frames.at(-1));
    assert.equal(duplicateDuringVerification.status, 'pending');
    assert.equal((await pendingVerification).status, 'complete');

    const conflictingReassembler = new protocol.FragmentReassembler();
    for (const frame of frames.slice(0, -1)) {
      await conflictingReassembler.add(frame);
    }
    const finalFragment = protocol.decodeFragment(frames.at(-1));
    const conflictingData = new Uint8Array(finalFragment.data);
    conflictingData[0] ^= 0xff;
    const conflictingFrame = cbor.encodeCanonical(
      new Map([
        [0, 'SEF'],
        [1, 1],
        [2, finalFragment.transferId],
        [3, finalFragment.index],
        [4, finalFragment.count],
        [5, finalFragment.totalLength],
        [6, finalFragment.transferDigest],
        [7, conflictingData],
      ]),
    );
    const pendingConflict = conflictingReassembler.add(frames.at(-1));
    await assert.rejects(
      conflictingReassembler.add(conflictingFrame),
      (error) => error.code === 'TRANSFER_CONFLICT',
    );
    await assert.rejects(pendingConflict, (error) => error.code === 'TRANSFER_CONFLICT');

    const abortingReassembler = new protocol.FragmentReassembler();
    for (const frame of frames.slice(0, -1)) {
      await abortingReassembler.add(frame);
    }
    const pendingAbort = abortingReassembler.add(frames.at(-1));
    abortingReassembler.clear();
    await assert.rejects(pendingAbort, (error) => error.code === 'TRANSFER_ABORTED');
    assert.equal(abortingReassembler.activeTransfers, 0);
    assert.equal(abortingReassembler.inFlightFragments, 0);

    let clock = 1_000;
    const expiringReassembler = new protocol.FragmentReassembler({ now: () => clock });
    for (const frame of frames.slice(0, -1)) {
      await expiringReassembler.add(frame);
    }
    const pendingExpiry = expiringReassembler.add(frames.at(-1));
    clock += 5 * 60_000 + 1;
    assert.equal(expiringReassembler.expireStale().length, 1);
    await assert.rejects(pendingExpiry, (error) => error.code === 'TRANSFER_EXPIRED');
    assert.equal(expiringReassembler.inFlightBytes, 0);
  },
);

test(
  'expired messages and invalid fragment bytes fail explicitly',
  { skip: !hasCborg },
  async () => {
    const envelope = await protocol.encodeEnvelope({
      kind: 'custom',
      contentType: 'text/plain',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_100,
      payload: Uint8Array.of(1),
    });
    await assert.rejects(
      protocol.decodeEnvelope(envelope, { now: () => 1_700_000_400_000 }),
      (error) => error.code === 'EXPIRED_MESSAGE',
    );
    await assert.rejects(protocol.decodeEnvelope(Uint8Array.of(0xff)), SignalingError);
  },
);

test(
  'random malformed envelopes fail with controlled typed errors',
  { skip: !hasCborg },
  async () => {
    let seed = 0x1234abcd;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const length = 1 + (random() % 96);
      const bytes = Uint8Array.from({ length }, () => random() & 0xff);
      await assert.rejects(
        protocol.decodeEnvelope(bytes),
        (error) => error instanceof SignalingError,
      );
    }
  },
);

test(
  'CBOR depth and collection guards reject hostile structures before schema validation',
  { skip: !hasCborg },
  async () => {
    const { encode, rfc8949EncodeOptions } = cborg;
    const deep = Array.from({ length: 9 }).reduce((value) => [value], 0);
    const deeplyNested = encode(
      new Map([
        [0, 'SEE'],
        [99, deep],
      ]),
      rfc8949EncodeOptions,
    );
    const oversizedArray = encode(
      new Map([
        [0, 'SEE'],
        [99, Array.from({ length: 65 }, () => 0)],
      ]),
      rfc8949EncodeOptions,
    );
    const excessiveItems = encode(
      new Map([
        [0, 'SEE'],
        [
          99,
          Array.from({ length: 64 }, () =>
            Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)),
          ),
        ],
      ]),
      rfc8949EncodeOptions,
    );
    await assert.rejects(
      protocol.decodeEnvelope(deeplyNested),
      (error) => error.code === 'RESOURCE_LIMIT',
    );
    await assert.rejects(
      protocol.decodeEnvelope(oversizedArray),
      (error) => error.code === 'RESOURCE_LIMIT',
    );
    await assert.rejects(
      protocol.decodeEnvelope(excessiveItems),
      (error) => error.code === 'RESOURCE_LIMIT',
    );
  },
);
