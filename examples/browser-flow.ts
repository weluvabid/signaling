import { decodeEnvelope, encodeEnvelope, FragmentReassembler } from '../src/index.js';
import { encodeQrFrames, decodeQrImage } from '../src/qr.js';

// Offerer: create and export a complete signaling envelope.
export async function exportOffer(offer: RTCSessionDescriptionInit): Promise<string[]> {
  const sessionId = crypto.getRandomValues(new Uint8Array(16));
  const envelope = await encodeEnvelope({
    sessionId,
    kind: 'offer',
    contentType: 'application/sdp',
    payload: new TextEncoder().encode(JSON.stringify(offer)),
    expiresAt: Date.now() + 10 * 60_000,
  });
  const frames = await encodeQrFrames(envelope, { errorCorrectionLevel: 'M' });
  return frames.map((frame) => frame.dataUrl);
}

// Answerer: decode an imported image, reassemble all frames, then decode the envelope.
export async function importOffer(
  images: readonly HTMLImageElement[],
): Promise<RTCSessionDescriptionInit> {
  const reassembler = new FragmentReassembler();
  let complete: Uint8Array | undefined;
  for (const image of images) {
    const fragment = await decodeQrImage(image);
    const result = await reassembler.add(fragment);
    if (result.status === 'complete') {
      complete = result.bytes;
    }
  }
  if (!complete) {
    throw new Error('The imported QR set is incomplete');
  }
  const envelope = await decodeEnvelope(complete);
  if (envelope.kind !== 'offer' || envelope.contentType !== 'application/sdp') {
    throw new Error('The imported message is not a WebRTC offer');
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(envelope.payload),
  ) as RTCSessionDescriptionInit;
}
