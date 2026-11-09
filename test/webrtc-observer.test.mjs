import assert from 'node:assert/strict';
import test from 'node:test';

const { waitForIceGatheringComplete } = await import('../dist/webrtc/ice.js');

test('ICE gathering observer resolves, aborts, and times out with cleanup-safe errors', async () => {
  const createPeerConnection = () => {
    const target = new EventTarget();
    target.iceGatheringState = 'gathering';
    return target;
  };

  const completePeer = createPeerConnection();
  const completed = waitForIceGatheringComplete(completePeer, { timeoutMs: 100 });
  completePeer.iceGatheringState = 'complete';
  completePeer.dispatchEvent(new Event('icegatheringstatechange'));
  await completed;

  const abortController = new AbortController();
  const abortPeer = createPeerConnection();
  const aborted = waitForIceGatheringComplete(abortPeer, {
    signal: abortController.signal,
    timeoutMs: 100,
  });
  abortController.abort(new Error('caller cancelled'));
  await assert.rejects(
    aborted,
    (error) => error.code === 'TRANSPORT_ERROR' && error.cause.message === 'caller cancelled',
  );

  const timeoutPeer = createPeerConnection();
  await assert.rejects(
    waitForIceGatheringComplete(timeoutPeer, { timeoutMs: 5 }),
    (error) => error.code === 'TRANSPORT_ERROR' && error.cause.name === 'TimeoutError',
  );
});
