# API Guide

## Core envelope

`encodeEnvelope(input, options?)` accepts:

- `kind`: `offer`, `answer`, `candidate`, or `custom`.
- `contentType`: non-empty media type or reverse-DNS identifier, at most 128 UTF-8 bytes.
- `payload`: caller-owned `Uint8Array`; the encoder snapshots it before asynchronous work.
- `sessionId` / `messageId`: optional 16-byte IDs. Omitted IDs are generated with Web Crypto.
- `createdAt` / `expiresAt`: Unix milliseconds. Expiration must follow creation and stay within the configured maximum lifetime.
- `inReplyTo`: optional 16-byte message ID.
- `compression`: optional `none` or `deflate`. Deflate is retained only if the serialized base envelope becomes smaller. If the compressed stream exceeds the original payload length, encoding falls back to uncompressed bytes.

`decodeEnvelope(bytes, options?)` validates the envelope schema, rejects unknown fields and non-deterministic CBOR, verifies SHA-256 before decompression, enforces payload limits, and returns copied metadata/payload buffers. `allowExpired` only bypasses expiration rejection; it does not bypass timestamp sanity checks or integrity verification.

All public failures are `SignalingError` instances with a stable `code`, safe `details`, and a preserved `cause` where an underlying operation failed.

## Fragmentation

`fragmentEnvelope(envelopeBytes, options?)` produces independently encoded CBOR fragments. The default fragment data size is 16 KiB; the receiver may provide them in any order. The QR adapter uses a smaller 850-byte cap.

```ts
const reassembler = new FragmentReassembler();
const result = await reassembler.add(fragmentBytes);

if (result.status === 'pending') {
  // Continue collecting. Duplicate identical frames are idempotent.
} else if (result.status === 'complete') {
  // result.bytes is a verified copy of the original envelope bytes.
} else {
  // status === 'duplicate': this transfer ID was already completed recently.
}
```

`FragmentReassembler` owns its own state. Call `abort(transferId)` to discard one transfer, `expireStale()` to evict old transfers, or `clear()` to release all retained fragment buffers. If digest verification is already in progress, Web Crypto cannot be cancelled; the pending `add()` is invalidated and rejects when the digest operation settles, so its temporary contiguous copy may remain alive briefly. `add()` is asynchronous because the completed transfer digest is verified using Web Crypto. Identical duplicate fragments remain idempotent during verification and return `pending`; a new non-duplicate fragment in that state fails with `TRANSFER_VERIFYING`, while conflicting duplicates reject the transfer.

## File transport

`createEnvelopeBlob(bytes)` creates an `application/vnd.see.envelope` Blob. `readEnvelopeFile(blob)` reads a bounded Blob/File into a new byte array. These functions do not serialize JSON or reinterpret the envelope.

## Clipboard transport

The clipboard representation is `SEE1:` followed by unpadded base64url of the complete serialized envelope. The adapter accepts a `ClipboardPort` rather than accessing `navigator.clipboard` implicitly. The application must request clipboard permissions and provide the browser clipboard object.

## QR transport

`encodeQrFrames(bytes, options?)` fragments an envelope and renders each fragment as an SVG data URL. `decodeQrImage(image)` decodes one QR frame from a loaded `HTMLImageElement` using the optional `qr` peer and a bounded canvas readback. `retryBudgetMs` caps optional retries in the default decoder; it is not a hard wall-clock timeout for mandatory synchronous work. Consumers may inject a different synchronous or asynchronous `decoder` when they need a different quality/performance trade-off. `reassembleQrFrames(images)` is a convenience for a single transfer's image set.

The application owns file selection, object-URL lifecycle, image loading, and UI. Revoke object URLs after use. The QR adapter checks image dimensions before allocating its canvas, but the browser has already decoded the source image into the `HTMLImageElement`. For hostile image files, keep import UX constrained and consider a separate image-processing boundary. The QR decoder's optional retry effort is capped by a finite retry budget; this does not impose a hard wall-clock limit on mandatory synchronous work.

## WebRTC adapter

`createDescriptionEnvelopeInput(sessionId, description, options?)` maps an offer/answer SDP object into an `EnvelopeInput`. It does not create an offer or set a remote description.

`createCandidatesEnvelopeInput(sessionId, candidates, options?)` maps a batch of ICE candidates. A `null` candidate or empty candidate string marks end-of-candidates.

`decodeWebRtcPayload(envelope, options?)` validates the content type and message kind and returns the parsed description/candidate payload. These WebRTC payloads are deterministic CBOR maps, so the same bounded CBOR tokenizer/resource limits apply inside the payload. The consuming application applies it to its own `RTCPeerConnection` and validates the negotiation state before doing so.

`waitForIceGatheringComplete(peerConnection, options?)` only observes `icegatheringstatechange`; it does not mutate the connection. It supports an `AbortSignal` and finite timeout.

## Ownership and mutation

Input byte arrays are copied before being retained or returned across async boundaries. Fragment/reassembly objects own their internal buffers. No global transfer registry is used. Returned byte arrays are mutable copies; callers may mutate them without affecting the reassembler or the source envelope.
