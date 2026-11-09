# Glossary

Short explanations of terms used throughout SEE's documentation.

| Term | Plain-English meaning |
|---|---|
| Signaling | Information devices exchange before they can establish a peer-to-peer connection. |
| Peer | One of the devices or application instances participating in a connection. |
| WebRTC | Browser and application technology for real-time peer-to-peer audio, video, and data. |
| SDP | A text format used to describe the media and connection parameters for a WebRTC session. |
| ICE | The process WebRTC uses to discover and test possible network paths between peers. |
| ICE candidate | One possible network address and route a peer can try when connecting. |
| STUN | A service that helps a device discover the public-facing address it appears to use. |
| TURN | A relay service that forwards traffic when a direct peer-to-peer path cannot be established. |
| Envelope | SEE's versioned container for one signaling message and its metadata. |
| CBOR | A compact binary format for representing structured data. |
| Deterministic encoding | Encoding the same supported data into the same byte representation each time. |
| Digest | A fixed-size value calculated from data. SEE uses it to detect accidental changes. |
| SHA-256 | A cryptographic hash function that produces a 32-byte digest. In SEE it detects corruption; it does not authenticate the sender. |
| Compression | Representing data using fewer bytes when its content allows it. |
| Fragment | One numbered piece of an envelope that has been split for transport. |
| Fragmentation | Splitting a larger message into smaller pieces. |
| Reassembly | Collecting fragments and rebuilding the original message. |
| Out-of-order delivery | Fragments arriving in a different order from the order in which they were created. |
| Duplicate fragment | A fragment that has already been received and arrives again. |
| Resource limit | A configured ceiling, such as maximum message size or number of incomplete transfers. |
| In-flight bytes | Fragment payload bytes currently retained while transfers are incomplete. This is not total process memory. |
| Transport | The method used to carry data from one person or device to another, such as a file, clipboard, or QR image. |
| Interoperability | Different implementations or browsers being able to exchange and understand the same data. |
| Replay protection | Preventing an old valid message from being accepted again as a new message. SEE leaves durable replay policy to the consuming application. |
