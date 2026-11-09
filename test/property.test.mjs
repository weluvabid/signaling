import assert from 'node:assert/strict';
import test from 'node:test';

let fc;
try {
  fc = (await import('fast-check')).default;
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
    throw error;
  }
}

const { encodeBase64Url, decodeBase64Url, concatBytes } = await import('../dist/core/bytes.js');
const { SignalingError } = await import('../dist/core/errors.js');

test('property: canonical base64url round-trips arbitrary byte arrays', { skip: !fc }, () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 8_192 }), (bytes) => {
      const encoded = encodeBase64Url(bytes);
      assert.deepEqual(decodeBase64Url(encoded, 8_192), bytes);
      assert.doesNotMatch(encoded, /[=+/]/u);
    }),
    { numRuns: 500, seed: 0x51_6e_61 },
  );
});

test('property: concatenation preserves arbitrary chunk boundaries', { skip: !fc }, () => {
  fc.assert(
    fc.property(fc.array(fc.uint8Array({ maxLength: 256 }), { maxLength: 32 }), (chunks) => {
      const expectedLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const expected = new Uint8Array(expectedLength);
      let offset = 0;
      for (const chunk of chunks) {
        expected.set(chunk, offset);
        offset += chunk.byteLength;
      }
      assert.deepEqual(concatBytes(chunks, expectedLength), expected);
    }),
    { numRuns: 500, seed: 0x43_6f_6e },
  );
});

test('property: invalid base64url prefixes fail with a typed error', { skip: !fc }, () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 256 }), (suffix) => {
      assert.throws(() => decodeBase64Url(`!${suffix}`, 1_024), SignalingError);
    }),
    { numRuns: 250, seed: 0x42_36_34 },
  );
});

let hasCborg = true;
try {
  await import('cborg');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    hasCborg = false;
  } else {
    throw error;
  }
}
const protocol = fc && hasCborg ? await import('../dist/index.js') : undefined;

test(
  'property: arbitrary bounded byte strings never escape the envelope error contract',
  {
    skip: !fc || !hasCborg,
  },
  async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 512 }), async (bytes) => {
        await assert.rejects(
          protocol.decodeEnvelope(bytes),
          (error) => error instanceof SignalingError,
        );
      }),
      { numRuns: 500, seed: 0x45_4e_56 },
    );
  },
);
