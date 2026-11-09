# Security Model

## 1. Assets

The library handles:

- SDP and ICE information.
- Application-defined signaling payloads.
- Session and message identifiers.
- Serialized and compressed payload bytes.
- Incomplete fragment buffers.
- Imported QR images and files.

Signaling payloads can disclose local/public network addresses, device capabilities, and other connection metadata. Treat them as sensitive application data.

## 2. Trust boundaries

Every external representation is untrusted:

- QR images and decoded symbols.
- Files selected by a user.
- Clipboard content.
- Fragments received from another process or application.
- Serialized envelopes from unknown peers.

The library validates syntax, bounds, integrity, and protocol semantics. It does not decide whether a sender is an authorized person.

## 3. Threats and mitigations

| Threat                          | Current mitigation / status                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Malformed CBOR                  | Maintained `cborg` parser, strict integer forms, indefinite-length rejection, duplicate-key rejection, canonical re-encode comparison |
| Deeply nested CBOR              | `cborg` tokenizer wrapper enforces a pre-allocation depth cap                                                                          |
| Oversized CBOR collections      | `cborg` tokenizer wrapper enforces pre-allocation map/array entry and total-item caps                                                   |
| Oversized envelope              | Byte limit checked before CBOR decode                                                                                                 |
| Decompression bomb              | Streaming decompression stops at the advertised exact output length and configured maximum                                            |
| Corrupt payload                 | SHA-256 digest checked before decompression                                                                                           |
| Fragment injection              | Transfer ID and consistent metadata validation                                                                                        |
| Duplicate/conflicting fragments | Identical duplicates are idempotent; conflicting duplicates reject and release transfer state                                         |
| Reassembly exhaustion           | Per-transfer fragment size/count, aggregate in-flight fragment-count/byte, concurrent-transfer, and TTL limits                        |
| Replay                          | Expiration plus consumer-owned replay state; no cryptographic replay protection                                                       |
| Session confusion               | Session/message correlation; consumer state validation                                                                                |
| Malicious image                 | Dimension/pixel checks before canvas allocation; the browser's initial image decode has already occurred                              |
| Information leakage             | No payload logging by default                                                                                                         |
| Weak identifiers                | Web Crypto CSPRNG only; no insecure fallback                                                                                          |

## 4. Integrity is not authentication

The V1 SHA-256 digest detects accidental corruption and binds the encoded metadata to the payload. It is not a MAC or signature. An attacker can construct a new envelope and matching digest.

Sender authentication requires a MAC or digital signature with a defined key establishment and identity model. Confidentiality requires authenticated encryption and key management. These are not implied by WebRTC DTLS because signaling occurs before the WebRTC transport is established.

An authenticated signaling profile is deferred and must be specified separately.

## 5. Resource management

All resource limits must be enforced before allocation or expensive processing. Defaults are finite, and caller overrides are capped by hard ceilings.

The implementation currently:

- Rejects advertised envelope and decompressed lengths above configured limits.
- Does not allocate a complete transfer buffer from untrusted `total_length` alone.
- Bounds fragment count, fragment size, concurrent transfers, aggregate in-flight fragment count/bytes, and transfer lifetime.
- Releases fragment buffers on completion, failure, expiration, abort, and clear. A Web Crypto digest already in progress cannot be cancelled; its temporary contiguous copy remains until the digest promise settles, but its result is invalidated.
- Bounds QR image dimensions/pixel count before canvas allocation; the browser has already decoded the source image; decoder retry budget does not hard-timeout mandatory synchronous work.
- Streams decompression and aborts output as soon as the expected payload length is exceeded.

## 6. Logging and diagnostics

Payload bytes, SDP, ICE candidates, clipboard content, and imported file content MUST NOT be logged by default.

Errors may include:

- Error category.
- Operation.
- Protocol version.
- Transfer/message identifier, where safe.
- Expected and observed lengths.
- A non-sensitive reason.

Applications control their own telemetry and retention.
