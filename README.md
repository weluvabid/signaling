# SEE — Signaling Exchange

SEE is a TypeScript library for encoding, compressing, validating, fragmenting and reconstructing application data across different exchange channels.

## Origin

SEE started with a small problem: WebRTC offers, answers and ICE candidates are commonly represented as large JSON or text payloads. I wanted a friendlier way to exchange that information between devices using QR images, clipboard text and files, instead of asking people to copy and paste unwieldy payloads.

That led to a versioned binary envelope, deterministic CBOR encoding, compression, fragmentation and reassembly. As those pieces took shape, the envelope became transport-independent and the payload model expanded beyond WebRTC signaling.

The binary wire container is the **Signaling Exchange Envelope**. SEE is the library built around it.

## Capabilities

- Deterministic CBOR envelope encoding and decoding.
- SHA-256 integrity verification.
- Optional zlib-wrapped DEFLATE compression with a prefix-probe heuristic.
- Bounded fragmentation and out-of-order reassembly.
- File, clipboard and QR image transports.
- WebRTC offer, answer and ICE-candidate payload mapping.
- Application-defined binary payloads through the `custom` message kind.
- Configurable resource limits with protocol hard ceilings.
- Typed errors and explicit buffer ownership.

## Package entry points

| Entry point                      | Purpose                                                | Runtime requirements                                              |
| -------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `@weluvabid/signaling`           | Envelope, fragmentation, reassembly, limits and errors | Web Crypto; Compression Streams when compression is used          |
| `@weluvabid/signaling/file`      | Blob/File import and export                            | `Blob` and `Blob.arrayBuffer()`                                   |
| `@weluvabid/signaling/clipboard` | Versioned base64url clipboard representation           | Consumer-supplied `ClipboardPort`                                 |
| `@weluvabid/signaling/qr`        | QR frame encoding and image decoding                   | Optional `qr` peer dependency; browser image element for decoding |
| `@weluvabid/signaling/webrtc`    | SDP/ICE payload mapping and ICE gathering observer     | WebRTC browser types/runtime                                      |

Install the QR peer dependency when using the QR entry point:

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

const telemetryChunk = new Uint8Array([0x01, 0x02, 0x03]);

const envelopeBytes = await encodeEnvelope({
  kind: 'custom',
  contentType: 'application/vnd.example.telemetry-chunk',
  payload: telemetryChunk,
  expiresAt: Date.now() + 10 * 60_000,
  compression: 'deflate',
});

const frames = await fragmentEnvelope(envelopeBytes);
const reassembler = new FragmentReassembler();
let completeEnvelope: Uint8Array | undefined;

for (const frame of frames) {
  const result = await reassembler.add(frame);
  if (result.status === 'complete') completeEnvelope = result.bytes;
}

if (!completeEnvelope) throw new Error('Transfer is incomplete');

const message = await decodeEnvelope(completeEnvelope);
console.log(message.contentType, message.payload.byteLength);
```

For WebRTC, create the offer or answer with the application's `RTCPeerConnection`, optionally wait for ICE gathering to complete, and map the resulting description with the WebRTC adapter. The receiving application applies the decoded description to its own peer connection.

## Resource limits

Defaults are configurable within protocol hard ceilings.

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

The general fragmenter defaults to 16 KiB payloads. The QR adapter caps fragment payloads at 850 bytes. With the default 1,024-frame limit, a QR transfer can carry approximately 850 KiB of envelope data. QR frames are SVG data URLs.

## Documentation

- [Overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [API guide](docs/api.md)
- [Protocol specification](docs/protocol.md)
- [Security model](docs/security.md)
- [Benchmarks](docs/benchmarks.md)
- [Applications and future directions](docs/applications.md)
- [Glossary](docs/glossary.md)

## Development

Requirements:

- Node.js 26.13.0 (`.node-version`)
- pnpm 12.18.0 (`packageManager`)

```sh
pnpm install --no-frozen-lockfile
pnpm check
pnpm format:check
pnpm benchmark
pnpm browsers:install
pnpm test:browser
```

## License

Apache-2.0. See [LICENSE](LICENSE).
