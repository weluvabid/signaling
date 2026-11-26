import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(path.join(root, 'fixtures', 'webrtc', name));
const protocol = hasCborg ? await import('../dist/index.js') : undefined;
const webRtc = hasCborg ? await import('../dist/webrtc.js') : undefined;

async function assertFragmentRoundTrip(envelopeBytes) {
  const fragments = await protocol.fragmentEnvelope(envelopeBytes, {
    maxFragmentDataBytes: 96,
  });
  assert.ok(fragments.length > 1, 'fixture should exercise multi-fragment reassembly');
  const reassembler = new protocol.FragmentReassembler();
  let complete;
  for (const fragment of [...fragments].reverse()) {
    const result = await reassembler.add(fragment);
    if (result.status === 'complete') {
      complete = result.bytes;
    }
  }
  assert.ok(complete, 'all fragments should produce a completed transfer');
  assert.deepEqual(complete, envelopeBytes, 'reassembly must be byte-exact');
  return complete;
}

test(
  'representative Chromium and Safari SDP fixtures survive envelope and fragment round trips',
  {
    skip: !hasCborg,
  },
  async () => {
    const cases = ['chromium-offer.json', 'safari-answer.json'];
    for (const filename of cases) {
      const description = JSON.parse((await fixture(filename)).toString('utf8'));
      const { type, sdp } = description;
      const input = webRtc.createDescriptionEnvelopeInput(
        new Uint8Array(16).fill(7),
        { type, sdp },
        { createdAt: 1_700_000_000_000, compression: 'deflate' },
      );
      const encoded = await protocol.encodeEnvelope(input);
      const reconstructed = await assertFragmentRoundTrip(encoded);
      const envelope = await protocol.decodeEnvelope(reconstructed, {
        now: () => 1_700_000_000_001,
      });
      const decoded = webRtc.decodeWebRtcPayload(envelope);
      assert.deepEqual(decoded, { type, sdp }, `${filename} SDP must be preserved exactly`);
    }
  },
);

test(
  'IPv4, IPv6, srflx, relay and TCP ICE candidates survive envelope round trips',
  {
    skip: !hasCborg,
  },
  async () => {
    const candidates = JSON.parse((await fixture('ice-candidates.json')).toString('utf8'));
    const input = webRtc.createCandidatesEnvelopeInput(
      new Uint8Array(16).fill(9),
      [...candidates, null],
      { createdAt: 1_700_000_000_000, compression: 'deflate' },
    );
    const encoded = await protocol.encodeEnvelope(input);
    const envelope = await protocol.decodeEnvelope(encoded, {
      now: () => 1_700_000_000_001,
    });
    const decoded = webRtc.decodeWebRtcPayload(envelope);
    assert.deepEqual(decoded.candidates, candidates);
    assert.equal(decoded.endOfCandidates, true);
  },
);
