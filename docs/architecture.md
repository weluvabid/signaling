# Architecture

## 1. Boundary

Signaling Exchange is a library, not a peer-to-peer application or signaling service.

The core transforms application signaling payloads into versioned envelopes and back. Transfer framing reconstructs envelope bytes from fragments. Adapters translate between bytes and external representations.

The consumer owns connection lifecycle, peer state, transport delivery, and network connectivity policy.

## 2. Layers

```text
Consumer application
        |
Public API
        |
Protocol core
  - envelope model
  - deterministic CBOR codec
  - validation and integrity
  - bounded compression
        |
Transfer engine
  - fragmentation
  - bounded reassembly
  - cancellation / expiration
        |
Transport adapters
  - file
  - clipboard
  - QR
        |
Optional protocol adapter
  - WebRTC description / ICE payload mapping
```

The dependency direction is inward. Core modules MUST NOT import transport, DOM, camera, filesystem, clipboard, or WebRTC APIs.

## 3. Package entry points

The package exposes independent ESM entry points:

- `@weluvabid/signaling` — core envelope, fragmentation, reassembly, limits, and typed errors.
- `@weluvabid/signaling/file` — Blob/File import and export.
- `@weluvabid/signaling/clipboard` — injected clipboard-port adapter.
- `@weluvabid/signaling/qr` — QR image encode/decode adapter; requires optional peer `qr`.
- `@weluvabid/signaling/webrtc` — WebRTC SDP/ICE payload mapping and ICE gathering observer.

The QR dependency is an optional peer so consumers of the core entry point do not load QR code. The QR subpath is expected to fail with a module-resolution error if the consumer imports it without installing `qr`; this is documented behavior.

## 4. Runtime strategy

The core targets modern browser runtimes and supported Node.js LTS releases.

Core code MUST avoid:

- `window`, `document`, `navigator`, DOM element/UI APIs, and DOM-specific element types.
- Node-only built-ins.
- Implicit filesystem or network access.
- Global mutable singleton state.

The core uses Web Crypto for secure identifiers and SHA-256. Compression uses the standard Compression Streams API when requested. Unsupported runtime capabilities fail explicitly; there is no insecure cryptographic fallback.

The QR adapter is browser-only for image decoding. It accepts an already loaded `HTMLImageElement`; applications own file selection, object URLs, image loading, and UI.

## 5. Ownership and concurrency

All stateful reassembly state belongs to an explicitly created `FragmentReassembler` instance. No module-global transfer registry is used.

Input buffers are copied before they are retained across asynchronous work. Reassembly owns fragment buffers and releases them on completion, failure, expiration, abort, and clear. Concurrent transfers are isolated by transfer ID and bounded by resource limits.

## 6. Error handling

Public operations return typed results or throw `SignalingError` consistently, except APIs that intentionally expose platform cancellation semantics through a typed wrapper preserving the original cause.

Unexpected failures preserve their causes. Malformed input, unsupported states, invalid transitions, and resource-limit violations do not fall back silently. Diagnostics identify the failing operation and non-sensitive metadata without logging payload contents.

## 7. Dependency policy

Use maintained dependencies for:

- CBOR serialization.
- QR encoding and decoding.
- Specialist image processing.
- Property-based testing and benchmarking where useful.

Do not implement cryptographic primitives, CBOR, QR detection, Reed-Solomon coding, or compression algorithms from scratch.

## 8. Build and exports

The package publishes ESM first. CommonJS support is not a V1 requirement.

Package exports point only to generated `dist` artifacts and include TypeScript declarations. The package tarball is restricted to `dist`, documentation, README, and license. A package verification script checks that all export targets exist after build.

## 9. Reference consumer

Pairwise is the first integration target, not a dependency of this repository.

Pairwise remains responsible for `RTCPeerConnection`, SDP/ICE lifecycle, DataChannels, UI, STUN/TURN policy, and connection state. SEE provides encoding, exchange, validation, and reconstruction.
