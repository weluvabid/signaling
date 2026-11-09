# SEE Protocol Specification

**Protocol name:** Signaling Exchange Envelope (SEE)
**Envelope wire version:** 1 (proposed)
**Fragment wire version:** 1 (proposed)

This document defines the proposed binary envelope and transfer-fragment format. It is transport-independent. QR, file, and clipboard adapters carry bytes defined here; they do not change envelope semantics.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## 1. Goals and non-goals

SEE provides a bounded, versioned container for exchanging application signaling messages without requiring a centralized signaling service.

SEE does not establish network connections, discover peers, provide NAT traversal, authenticate a human identity, encrypt payloads, or guarantee that a direct network path exists.

The first application adapter is WebRTC. The core envelope remains usable for other application-defined signaling payloads.

## 2. Encoding profile

The wire encoding is CBOR following the core deterministic encoding requirements from RFC 8949.

Implementations MUST:

- Use shortest valid integer and length encodings.
- Use definite-length maps, arrays, byte strings, and text strings.
- Reject duplicate map keys.
- Reject indefinite-length items in SEE v1.
- Reject trailing bytes after the top-level CBOR item.
- Reject non-deterministic encodings by verifying canonical form.
- Reject tags, floats, undefined, negative integers, and data types not explicitly used by the SEE schema.
- Enforce byte, nesting, and collection limits before materializing unbounded structures.

The implementation MUST use a maintained CBOR library. SEE MUST NOT ship a bespoke CBOR parser or encoder. The current encoder/decoder candidate is `cborg@6.1.3` (Apache-2.0). It supports RFC 8949 deterministic encoding, strict integer decoding, indefinite-length rejection, duplicate-key rejection, and `Map` decoding.

`cborg` exposes a custom tokenizer interface. SEE wraps that tokenizer and counts CBOR tokens and array/map child items, rejecting excessive depth, collection lengths, and total item counts before the decoder materializes those structures.

All integer map keys below are unsigned integers. SEE v1 defines no extension-key semantics. A v1 implementation MUST reject every unknown map key. Future versions may define extension keys and criticality rules explicitly.

## 3. Envelope

The top-level value is a CBOR map.

| Key | Field           | CBOR type        | Required | Meaning                                            |
| --: | --------------- | ---------------- | -------- | -------------------------------------------------- |
|   0 | magic           | text             | yes      | Exact value `SEE`                                  |
|   1 | version         | unsigned integer | yes      | `1` for this draft                                 |
|   2 | session_id      | byte string      | yes      | 16 cryptographically random bytes                  |
|   3 | message_id      | byte string      | yes      | 16 cryptographically random bytes                  |
|   4 | kind            | unsigned integer | yes      | Message kind enum                                  |
|   5 | created_at      | unsigned integer | yes      | Unix time in milliseconds                          |
|   6 | expires_at      | unsigned integer | no       | Unix time in milliseconds                          |
|   7 | in_reply_to     | byte string      | no       | 16-byte message ID being answered                  |
|   8 | content_type    | text             | yes      | Stable media type or reverse-DNS identifier        |
|   9 | compression     | unsigned integer | yes      | Compression algorithm identifier                   |
|  10 | original_length | unsigned integer | yes      | Uncompressed payload length in bytes               |
|  11 | data            | byte string      | yes      | Payload bytes, compressed when field 9 is non-zero |
|  12 | integrity       | map              | yes      | Integrity algorithm and digest                     |

### 3.1 Message kinds

| Value | Kind      | Meaning                                       |
| ----: | --------- | --------------------------------------------- |
|     0 | offer     | Initiates a negotiation                       |
|     1 | answer    | Responds to an offer                          |
|     2 | candidate | Carries incremental ICE candidate information |
|     3 | custom    | Application-defined signaling message         |

A message kind does not authorize an application state transition. Consumers MUST validate negotiation state before applying a message.

### 3.2 Identifiers

`session_id` and `message_id` MUST each be exactly 16 bytes and generated using a cryptographically secure random number generator.

A session may contain multiple messages. Each message ID SHOULD be unique within its session. A response SHOULD populate `in_reply_to` with the message ID it answers.

A session ID is a correlation identifier, not a secret, credential, or proof of peer identity.

### 3.3 Timestamps and expiration

Timestamps are unsigned Unix milliseconds and MUST be representable as JavaScript safe integers. `expires_at`, when present, MUST be greater than `created_at` and MUST NOT exceed the configured maximum message lifetime.

Consumers MUST reject messages created too far in the future. Consumers MUST reject expired messages, allowing only the configured clock-skew tolerance. The default maximum lifetime is 24 hours and default clock-skew tolerance is 5 minutes.

A timestamp does not provide replay protection by itself; replay prevention requires consumer state keyed by session/message identifiers.

### 3.4 Payload and compression

`content_type` MUST be a non-empty UTF-8 string no longer than 128 bytes and MUST NOT contain control characters.

Compression identifiers:

| Value | Meaning                                                                            |
| ----: | ---------------------------------------------------------------------------------- |
|     0 | No compression                                                                     |
|     1 | DEFLATE in the zlib wrapper format (RFC 1950 containing DEFLATE data per RFC 1951) |

V1 MUST support identifier 0. Implementations SHOULD support identifier 1 using the interoperable zlib-wrapped DEFLATE format. A decoder MUST reject unknown compression identifiers.

The implementation uses the Compression Streams API's `deflate` format in supported modern browsers and Node.js runtimes. Decompression MUST be streamed and MUST stop as soon as the advertised `original_length` or configured maximum is exceeded. The final decompressed length MUST equal `original_length`.

The encoder SHOULD retain compressed data only when the complete encoded envelope is smaller than the uncompressed representation. Compression is optional; callers may request an attempt, but the encoder may retain the uncompressed payload if compression is not beneficial.

### 3.5 WebRTC content types

The WebRTC adapter encodes its payload as deterministic CBOR maps. It does not parse JSON inside the envelope.

- `application/vnd.see.webrtc-description+cbor`: map key `0` is type code (`0` offer, `1` answer); key `1` is non-empty SDP text. The envelope kind MUST match the type code.
- `application/vnd.see.webrtc-candidates+cbor`: root map key `0` is an array of at most 64 candidate maps; key `1` is the `endOfCandidates` boolean. Each candidate map has keys `0` candidate text, `1` nullable `sdpMid`, `2` nullable `sdpMLineIndex`, and `3` nullable `usernameFragment`.

An empty candidate string or a `null` candidate supplied to the adapter sets `endOfCandidates`; it is not retained as an ordinary candidate entry. The consuming application remains responsible for applying candidates and the end-of-candidates marker to its `RTCPeerConnection`.

The adapter supports complete offer/answer exchange and candidate batches. It does not create offers, mutate peer connection state, or select trickle versus non-trickle policy.

## 4. Integrity

The integrity map uses:

| Key | Field     | Type             | Value         |
| --: | --------- | ---------------- | ------------- |
|   0 | algorithm | unsigned integer | `1` = SHA-256 |
|   1 | digest    | byte string      | 32 bytes      |

The digest preimage is the deterministic CBOR encoding of the envelope map containing keys `0..11` and excluding key `12` (`integrity`).

`digest = SHA-256(preimage)`

The receiver MUST validate the digest before decompressing or exposing payload bytes.

The digest covers the compressed `data` bytes and all envelope metadata. SHA-256 here detects accidental corruption and binds envelope fields together. It does **not** authenticate the sender, provide confidentiality, or prevent replay. An attacker can replace the payload and its digest.

## 5. Transfer fragmentation

Fragmentation operates on the complete serialized envelope byte sequence. It is a transport framing layer and does not alter the envelope.

Each fragment is a deterministic CBOR map:

| Key | Field           | Type             | Meaning                                       |
| --: | --------------- | ---------------- | --------------------------------------------- |
|   0 | magic           | text             | Exact value `SEF`                             |
|   1 | version         | unsigned integer | `1`                                           |
|   2 | transfer_id     | byte string      | 16 random bytes                               |
|   3 | index           | unsigned integer | Zero-based fragment index                     |
|   4 | count           | unsigned integer | Total fragment count                          |
|   5 | total_length    | unsigned integer | Complete serialized envelope length           |
|   6 | transfer_digest | byte string      | SHA-256 of complete serialized envelope bytes |
|   7 | data            | byte string      | Fragment payload                              |

All fragments in one transfer MUST have identical `transfer_id`, `count`, `total_length`, and `transfer_digest`. `count` and `total_length` MUST be non-zero. `data` MUST be non-empty. `index` MUST be less than `count`. Since each fragment carries at least one byte, `count` MUST NOT exceed `total_length`.

The concatenation of fragment `data` fields in ascending index order MUST have exactly `total_length` bytes and match `transfer_digest`.

A receiver MUST reject zero or excessive fragment counts, out-of-range indices, inconsistent metadata, conflicting duplicates, incorrect reconstructed length, digest mismatch, and transfers exceeding configured limits. Identical duplicate fragments are idempotent. Fragments may arrive in any order.

The receiver MUST NOT allocate `total_length` bytes merely because one untrusted fragment advertises that value. Fragment payloads MUST be retained incrementally under aggregate bounds. A contiguous output buffer MAY be allocated only after all fragments are present and their aggregate byte count exactly matches `total_length`.

### 5.1 Resource limits

The implementation's current defaults and protocol hard ceilings are:

| Resource                             |   Default | Hard ceiling |
| ------------------------------------ | --------: | -----------: |
| Serialized envelope                  |     4 MiB |       16 MiB |
| Decompressed payload                 |     4 MiB |       16 MiB |
| CBOR nesting depth                   |         8 |           32 |
| CBOR map/array entries               |        64 |          256 |
| CBOR total decoded items             |    50,000 |      250,000 |
| Fragment count                       |     1,024 |       16,384 |
| Fragment data bytes                  |    16 KiB |       64 KiB |
| Concurrent incomplete transfers      |         4 |           64 |
| Aggregate in-flight fragments        |     4,096 |       65,536 |
| Aggregate in-flight reassembly bytes |     8 MiB |       64 MiB |
| Transfer lifetime                    | 5 minutes |   60 minutes |
| Message lifetime                     |  24 hours |       7 days |
| Clock skew tolerance                 | 5 minutes |   10 minutes |

The QR adapter limits fragment data to 850 bytes regardless of a larger general fragment limit.

The implementation wraps `cborg`’s tokenizer to enforce nesting-depth, collection-entry, and total-item limits before array/map materialization.

## 6. Reassembly semantics

A reassembler is an explicitly owned stateful object. It supports multiple concurrent transfers without mixing their fragments.

A transfer moves through collecting and verifying states internally. It becomes complete only after all fragments are present, exact length is verified, and the complete transfer digest matches. The reassembler then releases fragment storage and retains a bounded, short-lived completed-transfer tombstone to avoid emitting completion twice for a recently replayed transfer ID.

`add()` returns `pending`, `complete`, or `duplicate`. Metadata conflicts, conflicting duplicates, invalid lengths, and digest failures reject the transfer with a typed error and release retained buffers. `abort()`, `expireStale()`, and `clear()` release resources explicitly.

## 7. Transport representations

- **File:** raw serialized envelope bytes in an `application/vnd.see.envelope` Blob/File. File transport does not add a second wrapper.
- **Clipboard:** `SEE1:` followed by unpadded base64url of the complete serialized envelope. The clipboard adapter accepts an injected clipboard port and does not access browser globals implicitly.
- **QR:** each serialized fragment is represented as `SEF1:` followed by unpadded base64url of the fragment CBOR bytes, then encoded as an SVG-backed QR image. The current default error-correction level is M with a four-module quiet-zone margin. QR frame output is an SVG data URL. QR image decode is browser-only, accepts an already loaded image element, and uses the optional `qr` package over a bounded canvas readback. The retry budget limits optional decode retries, not mandatory synchronous work.

Clipboard carries a whole envelope and does not perform fragmentation. QR uses the fragment protocol.

## 8. Versioning and compatibility

The `version` field versions the envelope wire format. The fragment `version` independently versions fragment framing.

A decoder MUST reject unsupported versions with a typed error. It MUST NOT guess a format or attempt a permissive fallback.

V1 does not define forward-compatible extension fields. A future version may assign extension keys and criticality rules. Until then, unknown keys are rejected.

Wire-format changes that affect interpretation require a new version. Additive public API changes do not automatically require a wire-format version change.

## 9. Security considerations

All imported bytes, images, files, and clipboard content are untrusted. Implementations MUST validate framing and limits before expensive decoding, decompression, or allocation. Error messages MUST NOT include raw signaling payloads or secrets by default.

SEE v1 provides no sender authentication or confidentiality. Applications requiring authenticated signaling MUST add a separately specified authenticated profile with a key-establishment and identity model before trusting peer identity or applying sensitive negotiation state.
