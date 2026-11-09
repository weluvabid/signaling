import assert from 'node:assert/strict';
import test from 'node:test';
import { Blob } from 'node:buffer';

const { createEnvelopeBlob, readEnvelopeFile } = await import('../dist/file.js');
const { encodeClipboardText, decodeClipboardText, writeClipboard, readClipboard } =
  await import('../dist/clipboard.js');
const { SignalingError } = await import('../dist/core/errors.js');

const sample = Uint8Array.from({ length: 256 }, (_, index) => index);

test('file transport round-trips raw envelope bytes', async () => {
  const blob = createEnvelopeBlob(sample);
  assert.equal(blob.type, 'application/vnd.see.envelope');
  assert.deepEqual(await readEnvelopeFile(blob), sample);
  await assert.rejects(readEnvelopeFile(new Blob([])), SignalingError);
});

test('clipboard transport round-trips using a versioned base64url prefix', () => {
  const text = encodeClipboardText(sample);
  assert.ok(text.startsWith('SEE1:'));
  assert.deepEqual(decodeClipboardText(text), sample);
  assert.throws(() => decodeClipboardText('not-see'), SignalingError);
});

test('clipboard port errors propagate as typed transport errors', async () => {
  let stored = '';
  const clipboard = {
    async writeText(value) {
      stored = value;
    },
    async readText() {
      return stored;
    },
  };
  await writeClipboard(clipboard, sample);
  assert.deepEqual(await readClipboard(clipboard), sample);
  await assert.rejects(
    writeClipboard(
      {
        writeText: async () => {
          throw new Error('denied');
        },
        readText: async () => '',
      },
      sample,
    ),
    (error) => error.code === 'TRANSPORT_ERROR' && error.cause instanceof Error,
  );
});
