# SEE overview

## In one sentence

**SEE encodes, compresses, validates and transfers application data through portable, transport-independent envelopes.**

## Origin and evolution

SEE began as a way to make WebRTC signaling easier to exchange. Offers, answers and ICE candidates commonly appear as large JSON or text payloads. I wanted to replace manual copy-and-paste with friendlier exchanges through QR images, clipboard text and files.

The first implementation focused on that workflow. Solving its constraints led to a deterministic binary envelope, compression, fragmentation, bounded reassembly and integrity verification. The envelope then became independent of WebRTC and gained support for application-defined payloads.

The binary wire container is the **Signaling Exchange Envelope**. SEE is the library built around it.

## How it works

1. **Package:** application data is encoded into a versioned envelope.
2. **Integrity:** the envelope includes a SHA-256 digest covering its metadata and payload bytes.
3. **Compress:** DEFLATE is retained when it makes the complete encoded envelope smaller.
4. **Fragment:** envelopes are split into numbered fragments sized for the selected transport.
5. **Exchange:** file, clipboard or QR adapters represent the envelope or its fragments.
6. **Reassemble:** the receiver collects fragments in any order, handles identical duplicates and verifies the reconstructed transfer digest.
7. **Decode:** the receiver validates the envelope and returns its payload and metadata.

## Original WebRTC exchange

One device creates a WebRTC offer. SEE packages the offer, splits the envelope into QR frames, and lets another device scan them. The receiving device reconstructs and decodes the offer, then applies it during WebRTC negotiation. The answer can travel back through the same exchange format.

The same envelope can be transferred through a file or clipboard instead of QR. The WebRTC adapter maps complete offer/answer descriptions and ICE candidate batches.

## Application-defined data

The `custom` message kind carries application-defined bytes with a caller-supplied content type. This allows applications to use SEE's envelope, compression, integrity, fragmentation and reassembly without adopting the WebRTC payload model.

## Responsibilities

| SEE                                             | Consuming application                             |
| ----------------------------------------------- | ------------------------------------------------- |
| Encode and decode exchange envelopes            | Define the application payload schema             |
| Compress payloads and verify integrity          | Manage application state and interpretation       |
| Fragment and reassemble envelopes               | Select and operate the delivery channel           |
| Provide file, clipboard, QR and WebRTC adapters | Authenticate peers and authorize exchanges        |
| Enforce configurable resource limits            | Manage durable storage, retries and replay policy |

## Further reading

- [Architecture](architecture.md)
- [Protocol](protocol.md)
- [API guide](api.md)
- [Security](security.md)
- [Benchmarks](benchmarks.md)
- [Applications and future directions](applications.md)
