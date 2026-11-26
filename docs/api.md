# API Guide

## Core envelope

`encodeEnvelope(input, options?)` accepts an `EnvelopeInput`:

- `kind`: `offer`, `answer`, `candidate`, or `custom`.
- `contentType`: non-empty UTF-8 media type or reverse-DNS identifier, up to 128 bytes.
- `payload`: caller-owned `Uint8Array`; the encoder snapshots it before asynchronous work.
- `sessionId` and `messageId`: optional 16-byte identifiers generated with Web Crypto when omitted.
- `createdAt` and `expiresAt`: Unix milliseconds. Expiration follows creation and is bounded by the configured maximum message lifetime.
- `inReplyTo`: optional 16-byte message identifier.
- `compression`: `none` or `deflate`.

The DEFLATE heuristic skips payloads below 4 KiB. For larger payloads it compresses a 1 KiB prefix and continues with full compression when the prefix saves at least 10%. The complete compressed and uncompressed envelope encodings are compared; compression is retained only when the compressed envelope is smaller.

`decodeEnvelope(bytes, options?)` validates the envelope schema, rejects unknown fields and non-deterministic CBOR, verifies SHA-256 before decompression, enforces payload limits, and returns copied metadata and payload buffers. `allowExpired` bypasses expiration rejection while retaining timestamp validation and integrity verification.

Public failures use `SignalingError` with a stable `code`, safe `details`, and a preserved `cause` when an underlying operation fails.

## Fragmentation and reassembly

`fragmentEnvelope(envelopeBytes, options?)` produces deterministic CBOR fragments. The default fragment payload is 16 KiB. The QR adapter uses an 850-byte maximum.

```ts
const reassembler = new FragmentReassembler();
const result = await reassembler.add(fragmentBytes);

if (result.status === 'pending') {
  // Continue collecting fragments.
} else if (result.status === 'complete') {
  // result.bytes contains the verified envelope bytes.
} else {
  // The transfer ID has already completed.
}
```

`FragmentReassembler` owns its state. Its methods are:

- `add(fragmentBytes)` — accept a fragment and return `pending`, `complete`, or `duplicate`.
- `abort(transferId)` — discard one transfer.
- `expireStale()` — expire transfers and completed-transfer entries by TTL.
- `clear()` — release retained fragment buffers and completed-transfer entries.

The reassembler exposes `activeTransfers`, `inFlightBytes`, and `inFlightFragments` accounting getters. During digest verification, identical duplicates remain idempotent. A new fragment for a verifying transfer returns `TRANSFER_VERIFYING`; conflicting duplicates reject the transfer.

## File transport

- `createEnvelopeBlob(bytes, options?)` creates an `application/vnd.see.envelope` Blob.
- `readEnvelopeFile(blob, options?)` reads a bounded Blob/File into a new `Uint8Array`.

File transport preserves the serialized envelope bytes.

## Clipboard transport

The clipboard representation is `SEE1:` followed by unpadded base64url of the complete serialized envelope.

- `encodeClipboardText(envelope, options?)`
- `decodeClipboardText(text, options?)`
- `writeClipboard(clipboard, envelope, options?)`
- `readClipboard(clipboard, options?)`

The adapter accepts a `ClipboardPort` with `readText()` and `writeText()` methods.

## QR transport

- `encodeQrFrames(bytes, options?)` fragments an envelope and renders each fragment as an SVG data URL.
- `decodeQrImage(image, options?)` decodes one QR frame from a loaded `HTMLImageElement`.
- `reassembleQrFrames(images, options?)` decodes and reassembles a set of images for one transfer.

Encoding options include error-correction level `L`, `M`, `Q`, or `H`, scale (default `6`), and margin (default `4`). The fragment payload is capped at 850 bytes. Decoding supports a configurable pixel limit, retry budget (default `500` ms, maximum `5,000` ms), and injected decoder.

The default decoder reads image pixels through a bounded canvas. Applications own file selection, object-URL lifecycle, image loading, and UI.

## WebRTC adapter

- `createDescriptionPayload(description)` maps an offer or answer to the WebRTC payload model.
- `parseDescriptionPayload(payload, options?)` decodes a description payload.
- `createDescriptionEnvelopeInput(sessionId, description, options?)` creates an envelope input for an offer or answer.
- `createCandidatesPayload(candidates)` maps ICE candidates and the end-of-candidates marker.
- `parseCandidatesPayload(payload, options?)` decodes an ICE candidate payload.
- `createCandidatesEnvelopeInput(sessionId, candidates, options?)` creates an envelope input for a candidate batch.
- `decodeWebRtcPayload(envelope, options?)` validates the WebRTC content type and message kind, then returns the decoded description or candidate payload.
- `waitForIceGatheringComplete(peerConnection, options?)` resolves when ICE gathering reaches `complete`; it supports `AbortSignal` and a timeout (default `30,000` ms, maximum `600,000` ms).

Description payloads support complete `offer` and `answer` SDP, with a 2 MiB SDP limit. Candidate payloads contain up to 64 candidates; candidate lines are limited to 4,096 characters and candidate metadata strings to 256 characters. A `null` candidate or empty candidate string sets `endOfCandidates`.

## Ownership and mutation

Input byte arrays are copied before retention across asynchronous boundaries. Fragment and reassembly objects own their internal buffers. No global transfer registry is used. Returned byte arrays are mutable copies and can be changed without affecting retained reassembler state or source envelope bytes.
