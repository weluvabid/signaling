# Glossary

| Term                   | Meaning                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Signaling              | Information exchanged before devices establish a peer-to-peer connection.                                          |
| Peer                   | A device or application instance participating in a connection.                                                    |
| WebRTC                 | Browser and application technology for real-time peer-to-peer audio, video, and data.                              |
| SDP                    | A text format describing media and connection parameters for a WebRTC session.                                     |
| ICE                    | The process WebRTC uses to discover and test possible network paths between peers.                                 |
| ICE candidate          | A possible network address and route a peer can use when connecting.                                               |
| STUN                   | A service that helps a device discover its public-facing network address.                                          |
| TURN                   | A relay service that forwards traffic when a direct peer-to-peer path cannot be established.                       |
| Envelope               | SEE's versioned container for an application payload and its metadata.                                             |
| CBOR                   | A compact binary format for representing structured data.                                                          |
| Deterministic encoding | Encoding supported data into a canonical byte representation.                                                      |
| Digest                 | A fixed-size value calculated from data. SEE uses a digest to verify integrity.                                    |
| SHA-256                | A cryptographic hash function that produces a 32-byte digest.                                                      |
| Compression            | Representing data using fewer bytes when its content allows it.                                                    |
| DEFLATE                | The compression format used by SEE, wrapped in the zlib format.                                                    |
| Fragment               | One numbered piece of an envelope split for transport.                                                             |
| Fragmentation          | Splitting an envelope into smaller pieces.                                                                         |
| Reassembly             | Collecting fragments and reconstructing the original envelope.                                                     |
| Out-of-order delivery  | Fragments arriving in an order different from their original sequence.                                             |
| Duplicate fragment     | A fragment that has already been received and arrives again.                                                       |
| Resource limit         | A configured maximum for a resource such as message size or incomplete transfer count.                             |
| In-flight bytes        | Fragment payload bytes retained while transfers are incomplete.                                                    |
| Transport              | A method of carrying data between applications or devices, such as a file, clipboard, QR image or network channel. |
| Replay protection      | A policy that prevents a previously accepted message from being accepted again.                                    |

| Application payload | Bytes defined and interpreted by the consuming application. |
| Telemetry chunk | A bounded time window of measurements and associated metadata. |
| Store-and-forward | Retaining completed data units until a delivery channel becomes available. |
| Backpressure | A mechanism that slows or bounds production when downstream capacity is limited. |
