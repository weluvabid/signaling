# Benchmarks

SEE's performance suite measures Node.js library operations only: envelope encoding and decoding, compression, fragmentation, reassembly, transfer ordering, duplicate handling, concurrent transfers, and resource-limit handling.

## Node.js benchmark

Run the core suite with the repository's pinned Node.js and pnpm versions:

```sh
pnpm install --no-frozen-lockfile
pnpm benchmark
```

The benchmark builds the package before running. Configuration is controlled with environment variables:

| Variable | Default | Range |
|---|---:|---:|
| `BENCH_ITERATIONS` | 1,000 | 1,000–10,000 |
| `BENCH_WARMUP` | 100 | 0–1,000 |
| `BENCH_TRANSFER_ITERATIONS` | 1,000 | 100–1,000 |
| `BENCH_THROUGHPUT_BATCH` | 100 | 10–1,000 |

## Running and exporting a benchmark

Run the suite with output captured automatically:

```sh
pnpm benchmark:run
```

Each invocation creates a unique directory under `benchmarks/results/`:

```text
benchmarks/results/<run-id>/
├── results.jsonl
├── metadata.json
└── summary.json
```

`results.jsonl` is the source of truth: it contains the metadata record followed by every case record, including each individual `samplesMs` observation. `metadata.json` exposes the first record separately for convenient inspection. `summary.json` is a compact, deterministic projection of those records for quick inspection. The runner validates the JSONL as it is written, checks the expected 32 cases, verifies sample counts against the configured iteration counts, and refuses to produce a summary for an incomplete or malformed run. If the benchmark process fails, its partial raw output is retained for diagnosis.

The terminal prints only the run ID and output paths. No benchmark records are streamed to the terminal, so shell scrollback limits cannot truncate the saved measurements.

Create a ZIP suitable for sharing:

```sh
pnpm benchmark:archive
```

This archives the latest completed run. To archive a specific run, pass its directory name:

```sh
pnpm benchmark:archive <run-id>
```

The archive contains the complete run directory, including raw measurements and summary. The archive command uses the system `zip` utility.

The low-level runner remains available for piping JSONL manually:

```sh
pnpm build
node benchmarks/run.mjs > benchmarks/results/manual-run.jsonl
```

Each output contains a metadata record followed by one result record for each payload-size and compression combination. Every measured operation includes its individual `samplesMs` values; percentile and throughput fields are derived from those samples.

## Workloads

The current harness covers payload sizes of 1 KiB, 16 KiB, 256 KiB, and 1 MiB, with `none` and `deflate` compression requests.

Payload classes:

- `sdp-like` — structured SDP-style text with session, media, codec, ICE, and fingerprint attributes.
- `ice-heavy` — repeated host, IPv6, server-reflexive, relay, and TCP candidate-line shapes.
- `webrtc-fixtures` — the checked-in Chromium offer, Safari answer, and ICE candidate fixtures.
- `incompressible` — deterministic xorshift bytes.

## Compression heuristic

When DEFLATE is requested, payloads below 4 KiB skip the compression probe. Larger payloads use a 1 KiB prefix probe. Full compression runs when the prefix saves at least 10%. The encoder compares complete compressed and uncompressed envelope encodings and retains compression only when the compressed envelope is smaller.

## Measurements

### Envelope encoding and decoding

`encode` and `decode` report p50, p95, p99, minimum, maximum, total batch duration, operations per second, and MiB/s. Throughput is calculated over the complete measured batch.

### Fragmentation

`fragmentation` measures creation of the default transport fragments. Results include fragment count, total encoded fragment bytes, framing overhead, and fragments per second. Framing overhead is the sum of encoded fragment lengths minus the envelope length.

### Reassembly ordering and duplicates

Reassembly scenarios use smaller fragments to exercise multi-fragment state:

- `ordered` — fragments arrive by index.
- `reverse` — fragments arrive from last to first.
- `shuffled` — fragments arrive in deterministic shuffled order.
- `duplicate-heavy` — each shuffled fragment is delivered twice.

Each scenario reports latency percentiles, transfer throughput, fragments per second, and peak retained fragment payload bytes, fragment count, and active transfers.

### Concurrent transfers

The harness interleaves 1, 2, and 4 independent transfers through one reassembler. It reports throughput and peak reassembly accounting values. A separate scenario opens four incomplete transfers and measures rejection of a fifth under the default concurrent-transfer limit.

### Batched encode throughput

`encodeThroughputBatch` measures a batch of `BENCH_THROUGHPUT_BATCH` envelope encodes. `encodeOperationsPerSecond` is the number of individual encodes divided by the complete batch duration.

## Recorded results

The checked-in historical result files contain three earlier runs. The latest archived run, `benchmarks/results/see-run-4.zip`, was captured on Node.js 26.13.0 and an Apple M4 Max (14 logical CPUs). It records 1,000 encode/decode iterations, 100 warmup iterations, 1,000 transfer iterations and a throughput batch size of 100.

The following values are from the latest archived run (`2026-11-26T16-55-25Z`). Latencies are milliseconds per operation.

### 1 MiB payloads

| Payload | Compression requested | Compression applied | Envelope bytes | Payload reduction | Encode p50 / p95 | Decode p50 / p95 | Fragments |
|---|---|---|---:|---:|---:|---:|---:|
| SDP-like | None | No | 1,048,712 | 0% | 0.427 / 0.615 | 0.852 / 0.924 | 65 |
| SDP-like | DEFLATE | Yes | 4,958 | 99.53% | 1.946 / 2.207 | 0.722 / 1.661 | 1 |
| ICE-heavy | None | No | 1,048,712 | 0% | 0.425 / 0.613 | 0.878 / 1.087 | 65 |
| ICE-heavy | DEFLATE | Yes | 4,927 | 99.53% | 1.979 / 2.239 | 0.714 / 1.287 | 1 |
| WebRTC fixtures | None | No | 1,048,712 | 0% | 0.425 / 0.598 | 4.299 / 4.400 | 65 |
| WebRTC fixtures | DEFLATE | Yes | 6,540 | 99.38% | 2.042 / 2.339 | 0.718 / 0.979 | 1 |
| Incompressible | None | No | 1,048,712 | 0% | 0.425 / 0.603 | 0.856 / 0.929 | 65 |
| Incompressible | DEFLATE | No | 1,048,712 | 0% | 0.517 / 0.953 | 0.870 / 1.089 | 65 |

For structured payloads, DEFLATE reduces a 1 MiB payload to approximately 4.9–6.5 KiB and reduces the envelope from 65 fragments to one. Encoding takes approximately 1.95–2.04 ms at p50, compared with approximately 0.43 ms without compression. The smaller envelope reduces fragmentation p50 from approximately 0.60 ms to 0.02 ms and reassembly p50 from approximately 2.3 ms to 0.11–0.15 ms.

The incompressible workload is retained without compression. At 1 MiB, requesting DEFLATE adds approximately 0.09 ms to encode p50 while leaving the envelope size unchanged.

### Payload-size scaling

| Payload class | Size | DEFLATE envelope bytes | Reduction | Fragments |
|---|---:|---:|---:|---:|
| SDP-like | 16 KiB | 445 | 97.31% | 1 |
| SDP-like | 256 KiB | 1,529 | 99.42% | 1 |
| SDP-like | 1 MiB | 4,958 | 99.53% | 1 |
| ICE-heavy | 16 KiB | 417 | 97.47% | 1 |
| ICE-heavy | 256 KiB | 1,498 | 99.43% | 1 |
| ICE-heavy | 1 MiB | 4,927 | 99.53% | 1 |
| WebRTC fixtures | 16 KiB | 975 | 94.05% | 1 |
| WebRTC fixtures | 256 KiB | 2,349 | 99.10% | 1 |
| WebRTC fixtures | 1 MiB | 6,540 | 99.38% | 1 |

The WebRTC fixture workload is generated by concatenating the checked-in Chromium offer, Safari answer and ICE candidate fixture contents, repeating that corpus and truncating it to the requested payload size. The 256 KiB and 1 MiB cases are fixture-derived stress payloads rather than individual WebRTC messages.

### Reassembly and concurrency

For uncompressed 1 MiB envelopes, ordered, reverse and shuffled reassembly have p50 latency around 2.31–2.33 ms. Duplicate-heavy delivery has p50 around 4.83 ms. At four concurrent transfers, p50 is approximately 9.6 ms and peak retained fragment payload bytes are 4,194,440 bytes, scaling with the four in-flight envelopes.

For compressed 1 MiB structured payloads, one-fragment reassembly has p50 around 0.10–0.15 ms. At four concurrent transfers, retained fragment payload bytes range from approximately 19.5 to 25.7 KiB, depending on the payload.

The uncompressed 1 MiB WebRTC fixture-derived workload has a decode p50 of 4.299 ms, versus 0.852–0.878 ms for the SDP-like and ICE-heavy workloads. Its p95 is 4.400 ms across 1,000 measured iterations. This workload is the repeated fixture corpus described above. Envelope decoding performs canonical CBOR validation, checks the schema and timestamps, recomputes SHA-256 over the envelope, verifies the digest, and returns an owned payload copy. These steps enforce deterministic representation, reject malformed or over-limit input, detect corruption and keep returned buffers independent of the source. The result makes this large fixture-derived workload a useful profiling target; stage-level measurements can identify the cost of each operation while preserving those guarantees.

The complete run, including all individual timing samples, metadata and summary, is archived at `benchmarks/results/see-run-4.zip`.

## Reading JSONL output

Each line is a JSON object with `recordType` set to `metadata` or `case`. Metadata includes runtime, operating system, architecture, CPU model, logical CPU count, memory information, iteration settings, compression policy, fixture corpus, and timestamp. New benchmark runs include the individual timing observations in each measurement's `samplesMs` array; summary statistics are derived from that array. The three currently checked-in historical runs predate per-operation sample retention and contain their aggregate statistics only.

Important fields:

- `payloadBytes` — original application payload size.
- `envelopeBytes` — complete serialized envelope size.
- `encodedPayloadBytes` — payload byte string stored in CBOR field 11.
- `protocolOverheadBytes` — envelope size minus encoded payload bytes.
- `envelopeSizeDeltaBytes` — envelope size minus original payload size.
- `compressionSavingsBytes` and `compressionSavingsPercent` — savings against original payload bytes when DEFLATE is retained.
- `compressionRatio` — original payload bytes divided by encoded payload bytes.
- `compressionApplied` — whether DEFLATE was retained.
- `encodedFragmentBytes` — sum of serialized fragment sizes.
- `fragmentationOverheadBytes` — encoded fragment bytes minus envelope bytes.
- `peakRetainedBytes` — fragment payload bytes tracked by the reassembler.
- `samplesMs` — raw duration of each measured library operation, in milliseconds.
- `totalMs` — sum of the recorded operation durations, excluding outer-loop bookkeeping.
- `operationsPerSecond` and `mebibytesPerSecond` — throughput derived from the sum of recorded operation durations.

## Browser correctness tests

Playwright runs the compiled package in Chromium, Firefox, and WebKit. These are
correctness and compatibility tests, not performance benchmarks. They verify:

- Envelope encoding and decoding round-trips.
- Browser file import and export.
- Clipboard exchange.
- QR frame generation, image decoding, and frame reconstruction.
- QR image dimension limits and malformed input handling.
- WebRTC offer/answer exchange and independent-peer interoperability.

Browser tests do not record or publish timings, throughput, latency percentiles,
or browser-specific performance comparisons. Image loading, canvas allocation,
pixel extraction, QR recognition, and browser scheduling are exercised only to
establish that the browser integrations work correctly.

Install the browser binaries and run the suite:

```sh
pnpm browsers:install
pnpm test:browser
```
