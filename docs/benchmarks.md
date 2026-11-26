# Benchmarks

SEE's performance suite measures Node.js library operations only: envelope encoding and decoding, compression, fragmentation, reassembly, transfer ordering, duplicate handling, concurrent transfers, and resource-limit handling. Browser execution is covered by correctness tests, never performance measurements.

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

To write clean JSONL results:

```sh
pnpm build
mkdir -p benchmarks/results
node benchmarks/run.mjs > benchmarks/results/see-$(date +%Y%m%d-%H%M%S).jsonl
```

For three runs with identical settings:

```sh
for run in 1 2 3; do
  node benchmarks/run.mjs > "benchmarks/results/see-run-${run}.jsonl"
done
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

The checked-in result files contain three runs on Node.js 26.13.0 and an Apple M4 Max (14 logical CPUs). Each run records 1,000 encode/decode iterations, 100 warmup iterations, 50 transfer iterations, and a throughput batch size of 100.

The following values are medians across the three recorded runs. Latencies are milliseconds per operation.

| Payload | Compression | Envelope bytes | Payload savings | Encode p50 / p95 | Decode p50 / p95 | Fragments |
|---|---|---:|---:|---:|---:|---:|
| SDP-like, 16 KiB | DEFLATE | 445 B | 97.31% | 0.087 / 0.100 | 0.063 / 0.081 | 1 |
| SDP-like, 1 MiB | DEFLATE | 4,958 B | 99.53% | 1.753 / 2.080 | 0.696 / 1.137 | 1 |
| ICE-heavy, 1 MiB | DEFLATE | 4,927 B | 99.53% | 1.775 / 2.138 | 0.703 / 1.224 | 1 |
| SDP-like, 1 MiB | None | 1,048,712 B | 0% | 0.425 / 0.590 | 0.824 / 4.029 | 65 |
| Incompressible, 1 MiB | DEFLATE requested | 1,048,712 B | 0% | 14.222 / 15.351 | 0.821 / 1.087 | 65 |

The incompressible workload retains the original payload representation when DEFLATE does not reduce the encoded envelope size.

Raw measurements are stored in:

- `benchmarks/results/see-run-1.jsonl`
- `benchmarks/results/see-run-2.jsonl`
- `benchmarks/results/see-run-3.jsonl`

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

## Measurement boundaries

Only `benchmarks/run.mjs` produces performance measurements. Timed operations
are direct calls into the built library APIs and library-level workloads. The
harness records raw samples and derives latency percentiles and throughput from
those samples.

Machine and runtime details are retained in each metadata record so a result
can be reproduced and understood. They are descriptive metadata only: the
benchmark does not normalize, correct, weight, or otherwise adjust measurements
using CPU, memory, operating system, or runtime characteristics. Reported
numbers are the timings observed on the machine that executed the run.

Browser tests and their execution duration are excluded from performance results.
