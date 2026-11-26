# Benchmarks

SEE's benchmark suite measures envelope encoding and decoding, fragmentation, reassembly, transfer ordering, duplicate handling, concurrent transfers, and QR image processing.

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

Each output contains a metadata record followed by one result record for each payload-size and compression combination.

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

Each line is a JSON object with `recordType` set to `metadata` or `case`. Metadata includes runtime, operating system, architecture, CPU model, logical CPU count, memory information, iteration settings, compression policy, fixture corpus, and timestamp.

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
- `operationsPerSecond` and `mebibytesPerSecond` — throughput over the complete measured batch.

## Browser tests and benchmarks

Playwright runs the compiled package in Chromium, Firefox, and WebKit. The browser
suite covers envelope encoding and decoding, file import, clipboard exchange, QR
frame generation and reconstruction, image limits, and WebRTC offer/answer exchange
between independent peers.

Install the browser binaries and run the suite:

```sh
pnpm browsers:install
pnpm test:browser
```

Run the browser benchmark:

```sh
pnpm benchmark:browser
```

The default run uses Chromium, payload sizes of 1 KiB, 16 KiB, and 64 KiB,
30 envelope encode/decode samples, 10 compression samples, 20 transfer samples,
5 warmup encode/decode pairs, and up to 20 QR samples. QR sampling adapts to the
number of generated frames: transfers with at least 64 frames use at most 3 QR encode
samples, 1 full QR decode/reassembly sample, and skip the full-transfer QR warmup.
Smaller transfers retain the configured QR sample and warmup counts. Each case records
its effective QR encode, decode, and warmup counts. This bounds the 64 KiB workload,
which contains 78 QR frames, while retaining a complete full-frame reconstruction
measurement. Results are appended to JSONL as each payload size completes, and
progress is printed for QR encoding, image loading, and QR reconstruction.
Select browser engines and workloads with environment variables:

```sh
SEE_BROWSERS=chromium,firefox,webkit pnpm benchmark:browser
SEE_BROWSER_BENCH_SIZES=1024,16384,65536,262144 pnpm benchmark:browser
SEE_BROWSER_BENCH_ITERATIONS=30 pnpm benchmark:browser
SEE_BROWSER_WARMUP=5 pnpm benchmark:browser
SEE_BROWSER_QR_ITERATIONS=20 pnpm benchmark:browser
SEE_BROWSER_QR_WARMUP=1 pnpm benchmark:browser
```

### Browser timing boundaries

The browser report deliberately keeps library calls and browser integration work
as separate measurements:

- `encode` times only `encodeEnvelope`.
- `decode` times only `decodeEnvelope`. Byte-for-byte correctness verification
  runs after the timer stops.
- `compressionRequestedEncode` times only `encodeEnvelope` with DEFLATE requested.
  The subsequent decode and correctness check are outside that timer.
- `fragmentation` times only `fragmentEnvelope`.
- `reassembly` times fragment ingestion through `FragmentReassembler`; the
  benchmark also verifies the reconstructed bytes.
- `qrEncode` times only `encodeQrFrames`.
- `qrDecodeAndReassembly` times only `reassembleQrFrames` on already-loaded image
  objects. Image construction/loading is not included.
- `imageLoad` is reported separately. It measures browser `Image`/data-URL loading,
  not a signaling-library operation.
The browser harness warms the envelope APIs before sampling. For smaller QR transfers,
it also performs a separate QR warmup, encodes the configured number of samples, loads
the generated images once, and reuses those image objects for repeated
`reassembleQrFrames` samples. For transfers with at least 64 frames, it skips the
full-transfer QR warmup, limits encoding to at most 3 samples, and performs one full
reconstruction. This avoids repeatedly decoding the same 78 images while still
measuring a complete reconstruction. The actual sample counts are stored in each
case as `qrEncodeIterations`, `qrDecodeIterations`, and `qrWarmupIterations`. Image
loading is reported separately with its actual one-sample count.

Timed regions exclude correctness comparisons and reporting work. Browser percentiles
use four decimal places to preserve sub-millisecond values. p95 is emitted when a
measurement has at least 20 samples; p99 is emitted at 100 samples. The default
30-sample envelope and 20-sample QR runs therefore include p50 and p95.

Each run writes newline-delimited JSON under `benchmarks/results/`. The metadata
record is written before sampling, and each payload result is appended immediately
when that payload completes. An interrupted run therefore retains completed records
instead of losing the entire run.


## Recorded browser results

The checked-in browser result files contain one completed run for each browser
engine, recorded on 2026-11-26:

| Browser | Version | Logical CPUs reported | Envelope samples | Transfer samples | QR samples |
|---|---:|---:|---:|---:|---:|
| Chromium | 148.0.7778.96 | 14 | 30 | 20 | 20 for 1/16/64 KiB |
| Firefox | 150.0.2 | 14 | 30 | 20 | 20 for 1/16/64 KiB |
| WebKit | 26.4 | 8 | 30 | 20 | 20 for 1/16 KiB; 3 encode and 1 decode for 64 KiB |

The browser benchmark used 5 envelope warmups, 1 QR warmup for the 1 KiB and
16 KiB cases, 10 compression-request samples, and 20 transfer samples. The
64 KiB WebKit QR case used the actual reduced counts shown above and skipped
the QR warmup. The 64 KiB QR reconstruction still processed all 78 frames.

### Envelope operations

Values are p50 / p95 in milliseconds. Each cell contains the browser's own
reported values; timer precision differs between engines.

| Payload | Chromium encode | Firefox encode | WebKit encode | Chromium decode | Firefox decode | WebKit decode |
|---:|---:|---:|---:|---:|---:|---:|
| 1 KiB | 0 / 0.1 | 0 / 1 | 0 / 1 | 0 / 0.1 | 0 / 1 | 0 / 1 |
| 16 KiB | 0 / 0.1 | 0 / 1 | 0 / 1 | 0 / 0.2 | 0 / 1 | 0 / 1 |
| 64 KiB | 0.1 / 0.1 | 0 / 1 | 0 / 1 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |

Mean encode / decode latencies (milliseconds):

| Payload | Chromium encode / decode | Firefox encode / decode | WebKit encode / decode |
|---:|---:|---:|---:|
| 1 KiB | 0.0500 / 0.0433 | 0.0667 / 0.0667 | 0.1000 / 0.1333 |
| 16 KiB | 0.0267 / 0.0433 | 0.0667 / 0.1000 | 0.0667 / 0.1000 |
| 64 KiB | 0.0567 / 0.1067 | 0.1333 / 0.2333 | 0.1000 / 0.1333 |

### Fragmentation and reassembly

Values are p50 / p95 in milliseconds.

| Payload | Chromium fragmentation | Firefox fragmentation | WebKit fragmentation | Chromium reassembly | Firefox reassembly | WebKit reassembly |
|---:|---:|---:|---:|---:|---:|---:|
| 1 KiB | 0 / 0.1 | 0 / 0 | 0 / 0 | 0 / 0.1 | 0 / 0 | 0 / 0 |
| 16 KiB | 0 / 0.1 | 0 / 0 | 0 / 0 | 0 / 0.1 | 0 / 1 | 0 / 1 |
| 64 KiB | 0.1 / 0.1 | 0 / 1 | 0 / 1 | 0.2 / 0.4 | 0 / 1 | 0 / 1 |

Mean fragmentation / reassembly latencies (milliseconds):

| Payload | Chromium | Firefox | WebKit |
|---:|---:|---:|---:|
| 1 KiB | 0.0150 / 0.0350 | 0 / 0.0500 | 0.0500 / 0.0500 |
| 16 KiB | 0.0450 / 0.0450 | 0 / 0.1500 | 0.0500 / 0.2000 |
| 64 KiB | 0.0750 / 0.2050 | 0.1500 / 0.1000 | 0.2000 / 0.1000 |

Firefox and WebKit report millisecond-granularity values in these runs. A reported
`0` is below the timer's reported resolution, not a claim that the operation takes
literally no time.

### QR frame encoding

Values are p50 / p95 in milliseconds. A dash means the sample count did not meet
the benchmark's 20-sample p95 reporting threshold.

| Payload | Frames | Chromium | Firefox | WebKit |
|---:|---:|---:|---:|---:|
| 1 KiB | 2 | 17 / 20.1 | 14 / 18 | 19 / 20 |
| 16 KiB | 20 | 218.6 / 223.3 | 169 / 178 | 242 / 248 |
| 64 KiB | 78 | 878.8 / 888.1 | 683 / 702 | 1,036 / — |

### QR decoding and reassembly

The timer covers `reassembleQrFrames` on image objects that have already been
loaded. It excludes browser image construction/loading.

Values are p50 / p95 in milliseconds.

| Payload | Frames | Chromium | Firefox | WebKit |
|---:|---:|---:|---:|---:|
| 1 KiB | 2 | 42.1 / 43.6 | 4 / 8 | 46 / 64 |
| 16 KiB | 20 | 547.5 / 564.3 | 50 / 53 | 573 / 621 |
| 64 KiB | 78 | 2,199 / 2,253.8 | 211 / 255 | 9,208 / — |

The 64 KiB WebKit case completed with 3 QR encoding samples and 1 full
78-frame reconstruction sample. Its p50 is the sole measured sample; p95 is
not emitted. The other 64 KiB browser QR cases used 20 samples each.

The raw distributions also preserve the tail behaviour: Firefox's 16 KiB
QR reconstruction has a 50 ms p50, 53 ms p95, 80.35 ms mean, and 647 ms max;
WebKit's corresponding values are 573 ms, 621 ms, 655.2 ms, and 2,064 ms.
Firefox's 64 KiB reconstruction is 211 ms p50, 255 ms p95, 354.95 ms mean,
and 2,991 ms max.

### Browser image loading

`imageLoad` measures loading the generated QR image data URLs into browser image
objects. It is reported separately and is not included in library QR encoding or
reconstruction timings. Each value below is one image-loading measurement.

| Payload | Chromium | Firefox | WebKit |
|---:|---:|---:|---:|
| 1 KiB | 89.6 ms | 266 ms | 195 ms |
| 16 KiB | 1,166.8 ms | 3,753 ms | 2,403 ms |
| 64 KiB | 4,847.5 ms | 15,994 ms | 10,037 ms |

### Compression outcome

Compression was requested for 10 samples per payload and browser. The
`compressionAppliedCount` was zero in every browser/payload case. These runs
therefore measure the requested-compression encode path, but do not demonstrate
retained DEFLATE compression or compression savings. The Node.js benchmark
results above separately exercise the compression heuristic with compressible
and incompressible fixtures.

### Browser result artifacts

Raw browser measurements are checked in alongside the Node.js runs:

- `benchmarks/results/see-browser-chromium-2026-11-26.jsonl`
- `benchmarks/results/see-browser-firefox-2026-11-26.jsonl`
- `benchmarks/results/see-browser-webkit-2026-11-26.jsonl`

Each file contains its browser metadata record followed by the three payload
case records. The recorded sample counts, browser versions, image-loading times,
and QR frame counts are preserved in those JSONL files.
