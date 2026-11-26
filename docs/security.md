# Security Model

## 1. Protected data

SEE handles application payloads, session and message identifiers, serialized payload bytes, incomplete fragment buffers, and imported QR images and files. WebRTC payloads can contain network addresses, device capabilities and connection metadata. Other application payloads may contain operational, diagnostic or measurement data; applications should handle them according to their content.

## 2. Input validation

Files, clipboard content, QR images, fragments, and serialized envelopes are treated as untrusted input. SEE validates CBOR structure, protocol fields, integrity digests, timestamps, payload lengths, fragment metadata, and configured resource limits.

## 3. Integrity

The envelope contains a SHA-256 digest over the deterministic CBOR representation of its metadata and payload bytes. The receiver verifies the digest before decompression and payload exposure.

The fragment format contains a SHA-256 digest over the complete serialized envelope. The reassembler verifies it after collecting all fragments.

## 4. Resource controls

SEE applies configurable limits to:

- Serialized envelope and decompressed payload sizes.
- CBOR nesting depth, collection entries, and total decoded items.
- Fragment payload size and fragment count.
- Concurrent incomplete transfers.
- Aggregate in-flight fragment count and payload bytes.
- Incomplete transfer lifetime and message lifetime.
- QR image dimensions and pixel count.

Decompression is streamed and output is bounded by the advertised payload length and configured maximum. Reassembly retains incoming fragment data incrementally and verifies the complete transfer before returning its bytes.

## 5. Identifiers and message lifecycle

Session IDs and message IDs are generated with Web Crypto when omitted; transfer IDs are generated with Web Crypto. Message timestamps and expiration are validated against the configured clock-skew and lifetime limits. The reassembler maintains a bounded cache of recently completed transfer IDs to avoid emitting completion twice.

The consuming application owns peer identity, sender authentication, authorization, confidentiality, and durable replay policy. The SHA-256 digest provides integrity verification and does not identify the sender.

## 6. Diagnostics

SEE errors use typed codes and safe details. Payload bytes, SDP, ICE candidates, clipboard content, and imported file content are not included in default error diagnostics.
