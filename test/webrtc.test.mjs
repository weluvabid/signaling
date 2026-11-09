import assert from 'node:assert/strict';
import test from 'node:test';

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

const webrtc = hasCborg ? await import('../dist/webrtc.js') : undefined;
const { SignalingError } = await import('../dist/core/errors.js');

test('WebRTC description payload validates offer and answer shapes', { skip: !hasCborg }, () => {
  const description = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };
  const input = webrtc.createDescriptionEnvelopeInput(new Uint8Array(16), description);
  assert.equal(input.kind, 'offer');
  const parsed = webrtc.parseDescriptionPayload(input.payload);
  assert.deepEqual(parsed, description);
  assert.throws(() => webrtc.createDescriptionPayload({ type: 'rollback' }), SignalingError);
});

test('ICE candidates preserve end-of-candidates and validate fields', { skip: !hasCborg }, () => {
  const input = webrtc.createCandidatesEnvelopeInput(new Uint8Array(16), [
    { candidate: 'candidate:1 1 UDP 1 192.0.2.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    null,
  ]);
  const parsed = webrtc.parseCandidatesPayload(input.payload);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.endOfCandidates, true);
  assert.throws(
    () => webrtc.createCandidatesPayload([{ candidate: 'x'.repeat(5_000) }]),
    SignalingError,
  );
});
