# SEE overview

## In one sentence

**Signaling Exchange (SEE) packages connection information into a portable message that applications can exchange through files, clipboard text, or QR images.**

## Purpose

Before two devices establish a peer-to-peer connection, they exchange connection information. In WebRTC, this commonly includes an offer or answer and ICE candidate information.

SEE provides a versioned exchange format and transport adapters for moving that information between people or devices. The same envelope can be transferred as a file, clipboard text, or a sequence of QR frames.

## How it works

1. **Package:** application data is encoded into a versioned envelope.
2. **Integrity:** the envelope includes a SHA-256 digest covering its metadata and payload bytes.
3. **Compress:** DEFLATE is selected when the compression heuristic identifies a useful prefix and the complete encoded envelope is smaller.
4. **Fragment:** envelopes are split into numbered fragments sized for the selected transport.
5. **Exchange:** file, clipboard, or QR adapters represent the envelope or its fragments.
6. **Reassemble:** the receiver collects fragments in any order, handles identical duplicates, and verifies the reconstructed transfer digest.
7. **Decode:** the receiver validates the envelope and returns its signaling payload and metadata.

## Example exchange

One device creates a WebRTC offer. SEE packages the offer, splits the envelope into QR frames, and lets another device scan them. The receiving device reconstructs and decodes the offer, then applies it during its WebRTC negotiation. The answer can travel back through the same exchange format.

The same envelope can be transferred through a file or clipboard instead of QR.

## Responsibilities

| SEE | Consuming application |
| --- | --- |
| Encode and decode exchange envelopes | Create and manage `RTCPeerConnection` |
| Compress payloads and verify integrity | Apply remote descriptions and manage offer/answer state |
| Fragment and reassemble envelopes | Choose ICE, STUN, and TURN policy |
| Provide file, clipboard, QR, and WebRTC adapters | Authenticate peers and authorize exchanges |
| Enforce configurable resource limits | Manage peer state and transport delivery |

## Audience

SEE is for developers building peer-to-peer applications that exchange setup information through different channels.

## Further reading

- [Architecture](architecture.md)
- [Protocol](protocol.md)
- [API guide](api.md)
- [Security](security.md)
- [Benchmarks](benchmarks.md)
- [Glossary](glossary.md)
