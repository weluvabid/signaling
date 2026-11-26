import {
  decodeEnvelope,
  encodeEnvelope,
  fragmentEnvelope,
  FragmentReassembler,
  createEnvelopeBlob,
  readEnvelopeFile,
  encodeQrFrames,
  reassembleQrFrames,
  encodeClipboardText,
  decodeClipboardText,
  readClipboard,
  writeClipboard,
  createDescriptionEnvelopeInput,
  decodeWebRtcPayload,
  waitForIceGatheringComplete,
} from '../../dist/index.js';
import { decodeQrImage } from '../../dist/qr.js';

function createPayload(size) {
  const bytes = new Uint8Array(size);
  let state = 0x51_47_4e;
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function imageFromDataUrl(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

async function reassembleQrFiles(files) {
  if (!files || files.length === 0) {
    throw new Error('Select one or more QR image files');
  }
  const urls = [];
  try {
    const images = await Promise.all(Array.from(files, async (file) => {
      if (!file.type.startsWith('image/')) {
        throw new TypeError(`${file.name} is not an image`);
      }
      const url = URL.createObjectURL(file);
      urls.push(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    }));
    return await reassembleQrFrames(images);
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

async function gatherLocalDescription(peer, description) {
  await peer.setLocalDescription(description);
  await waitForIceGatheringComplete(peer, { timeoutMs: 15_000 });
  if (!peer.localDescription?.sdp) {
    throw new Error('Local SDP was not generated');
  }
  return peer.localDescription;
}

async function runPeerExchange() {
  const offerer = new RTCPeerConnection({ iceServers: [] });
  const answerer = new RTCPeerConnection({ iceServers: [] });
  const channelOpened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DataChannel did not open')), 20_000);
    answerer.addEventListener('datachannel', ({ channel }) => {
      channel.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve(channel);
      }, { once: true });
    }, { once: true });
  });
  const channel = offerer.createDataChannel('see-browser-test');
  const channelOpen = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Offerer DataChannel did not open')), 20_000);
    channel.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });

  try {
    const offer = await offerer.createOffer();
    const localOffer = await gatherLocalDescription(offerer, offer);
    const offerBytes = await encodeEnvelope(createDescriptionEnvelopeInput(
      crypto.getRandomValues(new Uint8Array(16)),
      localOffer,
      { expiresAt: Date.now() + 60_000, compression: 'deflate' },
    ));
    const offerFrames = await encodeQrFrames(offerBytes);
    const offerImages = await Promise.all(offerFrames.map((frame) => imageFromDataUrl(frame.dataUrl)));
    const transferredOffer = await reassembleQrFrames(offerImages);
    const offerEnvelope = await decodeEnvelope(transferredOffer);
    const offerPayload = decodeWebRtcPayload(offerEnvelope);
    await answerer.setRemoteDescription(offerPayload);

    const answer = await answerer.createAnswer();
    const localAnswer = await gatherLocalDescription(answerer, answer);
    const answerBytes = await encodeEnvelope(createDescriptionEnvelopeInput(
      offerEnvelope.sessionId,
      localAnswer,
      {
        inReplyTo: offerEnvelope.messageId,
        expiresAt: Date.now() + 60_000,
        compression: 'deflate',
      },
    ));
    const answerFrames = await encodeQrFrames(answerBytes);
    const answerImages = await Promise.all(answerFrames.map((frame) => imageFromDataUrl(frame.dataUrl)));
    const transferredAnswer = await reassembleQrFrames(answerImages);
    const answerEnvelope = await decodeEnvelope(transferredAnswer);
    if (!equalBytes(answerEnvelope.sessionId, offerEnvelope.sessionId)) {
      throw new Error('Answer session ID did not match offer');
    }
    if (!equalBytes(answerEnvelope.inReplyTo, offerEnvelope.messageId)) {
      throw new Error('Answer inReplyTo did not match offer message ID');
    }
    await offerer.setRemoteDescription(decodeWebRtcPayload(answerEnvelope));

    await Promise.all([channelOpened, channelOpen]);
    const remoteChannel = await channelOpened;
    const pong = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DataChannel response timed out')), 5_000);
      channel.addEventListener('message', ({ data }) => {
        clearTimeout(timeout);
        resolve(data);
      }, { once: true });
    });
    remoteChannel.addEventListener('message', ({ data }) => {
      if (data === 'SEE_PING') {
        remoteChannel.send('SEE_PONG');
      }
    });
    channel.send('SEE_PING');
    const response = await pong;
    if (response !== 'SEE_PONG') {
      throw new Error(`Unexpected DataChannel response: ${response}`);
    }
    return {
      offerBytes: offerBytes.byteLength,
      answerBytes: answerBytes.byteLength,
      offerFrameCount: offerFrames.length,
      answerFrameCount: answerFrames.length,
      offerType: offerPayload.type,
      answerType: decodeWebRtcPayload(answerEnvelope).type,
      connectionState: offerer.connectionState,
      dataChannelState: channel.readyState,
      response,
    };
  } finally {
    channel.close();
    offerer.close();
    answerer.close();
  }
}

window.SEE = Object.freeze({
  createPayload,
  equalBytes,
  encodeEnvelope,
  fragmentEnvelope,
  FragmentReassembler,
  decodeEnvelope,
  createEnvelopeBlob,
  readEnvelopeFile,
  encodeQrFrames,
  decodeQrImage,
  reassembleQrFrames,
  imageFromDataUrl,
  reassembleQrFiles,
  encodeClipboardText,
  decodeClipboardText,
  readClipboard,
  writeClipboard,
  runPeerExchange,
});
window.__SEE_READY__ = true;
