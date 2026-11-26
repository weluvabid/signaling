# Architecture

## 1. Components

SEE separates protocol encoding, transfer framing, and transport representations.

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
  - cancellation and expiration
        |
Transport adapters
  - file
  - clipboard
  - QR
        |
WebRTC adapter
  - description mapping
  - ICE candidate mapping
  - ICE gathering observer
```

The dependency direction is inward. Core modules are independent of transport adapters, DOM APIs, filesystem APIs, clipboard APIs, and WebRTC APIs.

## 2. Package entry points

The package exposes independent ESM entry points:

- `@weluvabid/signaling` — envelope, fragmentation, reassembly, limits, and typed errors.
- `@weluvabid/signaling/file` — Blob/File import and export.
- `@weluvabid/signaling/clipboard` — clipboard adapter using an injected `ClipboardPort`.
- `@weluvabid/signaling/qr` — QR frame encoding and image decoding using the optional `qr` peer dependency.
- `@weluvabid/signaling/webrtc` — WebRTC description and ICE payload mapping, plus an ICE gathering observer.

The QR dependency is an optional peer. Consumers of the core entry point do not load QR functionality.

## 3. Runtime strategy

The core uses Web Crypto for secure identifiers and SHA-256. Compression uses the standard Compression Streams API with the `deflate` format. Runtime requirements are Web Crypto, `Blob`, and stream support for the operations that use them.

The core contains no Node-only built-ins, implicit filesystem access, implicit network access, or global mutable transfer registry. QR image decoding runs in a browser and accepts an already loaded `HTMLImageElement`.

## 4. Ownership and concurrency

Each `FragmentReassembler` instance owns its transfer state. Transfers are isolated by transfer ID and bounded by per-transfer and aggregate resource limits.

Input byte arrays are copied before they are retained across asynchronous work. The reassembler owns fragment buffers and releases them on completion, failure, expiration, abort, and clear. Completed transfer IDs are retained in a bounded cache to prevent duplicate completion events.

## 5. Error handling

Public failures use `SignalingError` with a stable error code, safe details, and the original cause where an underlying operation failed. Malformed input, unsupported states, invalid transitions, and resource-limit violations produce explicit errors.

## 6. Dependencies

SEE uses maintained libraries for CBOR serialization and QR encoding/decoding. The project also uses property-based testing and browser tooling for validation and measurement.

## 7. Build and exports

The package publishes ESM entry points with TypeScript declarations. Export targets point to generated `dist` artifacts. The package file list includes `dist`, documentation, README, license, and security information; `scripts/verify-package.mjs` checks the package contents and export targets.
