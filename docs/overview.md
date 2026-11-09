# SEE overview

## In one sentence

**Signaling Exchange (SEE) packages connection information into a portable message so two
applications can exchange it without depending on one particular delivery method.**

## Why does it exist?

Before two devices can make a peer-to-peer connection, they need to exchange some connection
information. With WebRTC, this commonly includes an offer or answer and, depending on the connection
flow, ICE candidate information.

Applications often send that information through their own signaling server. SEE provides a
serverless exchange format and a set of ways to move the data between people or devices instead:
files, clipboard text, and QR images.

SEE moves the signaling information. It does not create the peer-to-peer connection by itself.
The application still owns the WebRTC connection and its lifecycle. STUN or TURN may still be
needed for network address discovery or connectivity.

## How it works

1. **Package:** SEE puts the application data into a versioned envelope.
2. **Protect against accidental corruption:** the envelope includes a SHA-256 digest so the
   receiver can detect changed or damaged data. This digest does not prove who sent the message.
3. **Optionally compress:** supported payloads can be compressed when compression is useful.
4. **Split when needed:** large envelopes are divided into numbered fragments that fit the chosen
   transport.
5. **Exchange:** the application transfers the envelope or fragments using a file, clipboard, or
   QR adapter.
6. **Rebuild:** the receiver collects fragments, accepts out-of-order arrival, checks duplicates,
   and reconstructs the original envelope.
7. **Read:** the receiver validates and decodes the envelope, then passes the signaling payload to
   its own application logic.

## A simple example

Imagine one device has created a WebRTC offer. SEE can package that offer, split it into QR frames,
and let another device scan those frames. The second device reconstructs the offer and can use it
when performing its own WebRTC negotiation. The answer can travel back using the same approach.

The QR code is just the delivery method. The same exchange format can be carried by a file or
clipboard text instead.

## What SEE does and does not do

| SEE does | The application still does |
|---|---|
| Encode and decode the exchange envelope | Create and manage `RTCPeerConnection` |
| Optionally compress and verify message integrity | Apply remote descriptions and manage offer/answer state |
| Split envelopes into bounded fragments | Choose ICE, STUN, and TURN policy |
| Reassemble fragments in any arrival order | Authenticate peers and authorize an exchange |
| Provide file, clipboard, QR, and WebRTC adapters | Decide how and when to deliver data to another person |
| Enforce configurable resource limits | Provide confidentiality and durable replay protection |

## Who is it for?

SEE is a library for developers building peer-to-peer applications that need to exchange setup
information through different channels. It is especially useful when a server-mediated signaling
path is unavailable, undesirable, or not the right fit for the user experience.

## Where to go next

- [Architecture](architecture.md) explains the internal components and their boundaries.
- [Protocol](protocol.md) specifies the wire format.
- [API guide](api.md) explains how to use the package.
- [Security](security.md) describes the security model.
- [Benchmarks](benchmarks.md) explains how performance is measured.
- [Glossary](glossary.md) explains protocol terminology.
