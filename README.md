# Signaling Exchange

A transport-agnostic, serverless signaling exchange library for peer-to-peer applications.

Signaling Exchange (protocol working name **SEE**) packages application signaling messages into a versioned, integrity-checked envelope, fragments the envelope for constrained transports, and reconstructs it on the receiving side. Its first protocol adapter targets WebRTC. It does not require a signaling server.

## Design boundaries

The library owns:

- Deterministic CBOR envelope encoding and decoding.
- SHA-256 corruption detection and optional zlib-wrapped DEFLATE compression.
- Bounded fragmentation and out-of-order reassembly.
- File, clipboard, and QR image adapters.
- WebRTC description and ICE-candidate payload mapping.

The consuming application owns:

- `RTCPeerConnection` creation and lifecycle.
- Offer/answer state transitions and remote-description application.
- ICE policy, candidate delivery order, STUN/TURN configuration, and connectivity.
- Peer identity, authorization, authentication, encryption policy, and replay state.
- UI, peer management, and delivery through third-party messaging applications.

**Serverless signaling does not eliminate NAT traversal requirements.** STUN may still be needed for address discovery, and TURN may be needed when a direct path cannot be established.

## Package entry points

| Entry point                      | Purpose                                               | Runtime requirements                                            |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `@weluvabid/signaling`           | Envelope, fragmentation, reassembly, limits, errors   | Web Crypto, Blob/Compression Streams when compression is used   |
| `@weluvabid/signaling/file`      | Blob/File import and export                           | Blob and `Blob.arrayBuffer()`                                   |
| `@weluvabid/signaling/clipboard` | Versioned base64url clipboard representation          | A Clipboard API-compatible port supplied by the consumer        |
| `@weluvabid/signaling/qr`        | QR frame encoding and image decoding                  | Optional peer dependency `qr`; browser image element for decode |
| `@weluvabid/signaling/webrtc`    | SDP/ICE payload mapping and ICE gathering wait helper | WebRTC browser types/runtime                                    |

```sh
pnpm add qr
```

## Quick start

```ts
import {
  encodeEnvelope,
  decodeEnvelope,
  fragmentEnvelope,
  FragmentReassembler,
} from '@weluvabid/signaling';

const envelopeBytes = await encodeEnvelope({
  kind: 'custom',
  contentType: 'application/vnd.example.signal+json',
  payload: new TextEncoder().encode(JSON.stringify({ action: 'hello' })),
  expiresAt: Date.now() + 10 * 60_000,
  compression: 'deflate',
});

// Export as bounded transport frames (for QR, radio, or another carrier).
const frames = await fragmentEnvelope(envelopeBytes);

// On the receiver, add frames in any order to an explicitly owned reassembler.
const reassembler = new FragmentReassembler();
let completeEnvelope: Uint8Array | undefined;
for (const frame of frames) {
  const result = await reassembler.add(frame);
  if (result.status === 'complete') completeEnvelope = result.bytes;
}
if (!completeEnvelope) throw new Error('Transfer is incomplete');

const message = await decodeEnvelope(completeEnvelope);
console.log(message.kind, new TextDecoder().decode(message.payload));
```

For a WebRTC flow, the application creates an offer, waits for ICE gathering to complete when using a non-trickle exchange, then maps the resulting `RTCSessionDescriptionInit` with the WebRTC adapter. The consumer applies the decoded description to its own `RTCPeerConnection`.

Start with the [overview](docs/overview.md) and [glossary](docs/glossary.md). For implementation details, see the [API guide](docs/api.md), [architecture](docs/architecture.md), [protocol specification](docs/protocol.md), [security model](docs/security.md), [benchmark methodology](docs/benchmarks.md), and [browser benchmark harness](examples/browser-benchmarks.html).

## Resource limits

Defaults are finite and configurable within protocol hard ceilings. The current defaults are:

| Resource                           |   Default |
| ---------------------------------- | --------: |
| Serialized envelope                |     4 MiB |
| Decompressed payload               |     4 MiB |
| CBOR nesting depth                 |         8 |
| CBOR map/array entries             |        64 |
| CBOR total decoded items           |    50,000 |
| Fragment data                      |    16 KiB |
| Fragment count                     |     1,024 |
| Concurrent incomplete transfers    |         4 |
| Aggregate in-flight fragments      |     4,096 |
| Aggregate in-flight fragment bytes |     8 MiB |
| Incomplete transfer lifetime       | 5 minutes |
| Maximum message lifetime           |  24 hours |
| Accepted clock skew                | 5 minutes |

The general fragmenter defaults to 16 KiB payloads. The QR adapter separately caps fragment payload at 850 bytes. Under the default 1,024-frame ceiling, that allows up to roughly 850 KiB of envelope data per QR transfer. QR frames are SVG data URLs.

## Development

Requirements:

- Node.js 26.13.0 (`.node-version`).
- pnpm 12.18.0 (`packageManager`).

```sh
pnpm install --no-frozen-lockfile
pnpm check
pnpm format:check
pnpm benchmark
```


## License

Apache-2.0. See [LICENSE](LICENSE).
