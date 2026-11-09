# Benchmarks

SEE's benchmark suite measures the cost of turning an application payload into an exchangeable
message, splitting it into transport frames, and rebuilding it at the receiving side. It uses
Node.js for the core protocol measurements. Browser image, canvas, and QR decoding costs are measured separately in the browser harness.

## Run

Use Node.js 26.13.0 and pnpm 12.18.0. Install dependencies with:

```sh
pnpm install --no-frozen-lockfile
pnpm benchmark
```

The benchmark builds the package before executing. Useful controls are:

```sh
# Keep the normal encode/decode sample count, but reduce the transfer scenarios.
BENCH_ITERATIONS=1000 BENCH_WARMUP=25 BENCH_TRANSFER_ITERATIONS=100 pnpm benchmark

# Use the default 1,000 transfer repetitions for report-quality percentiles.
BENCH_TRANSFER_ITERATIONS=1000 pnpm benchmark

# Change the number of operations in each batched encode-throughput sample.
BENCH_THROUGHPUT_BATCH=200 pnpm benchmark
```

`BENCH_ITERATIONS` accepts 1,000–10,000, `BENCH_WARMUP` accepts 0–1,000,
`BENCH_TRANSFER_ITERATIONS` accepts 100–1,000 and defaults to 1,000. The 1,000-sample default gives p95 and p99 transfer percentiles a minimally useful tail sample. Use 100 only for smoke runs; do not publish p95/p99 from reduced samples.

To preserve clean JSONL output, build first and invoke the benchmark script directly. This keeps
build-tool status messages out of the results file:

```sh
pnpm build
mkdir -p benchmarks/results
node benchmarks/run.mjs > benchmarks/results/see-$(date +%Y%m%d-%H%M%S).jsonl
```

For three comparable full runs, keep the settings identical and give each output a distinct name:

```sh
for run in 1 2 3; do
  BENCH_TRANSFER_ITERATIONS=1000 node benchmarks/run.mjs \
    > "benchmarks/results/see-run-${run}.jsonl"
done
```

Keep raw result files as run artifacts. Do not hand-edit measurements. Summaries and charts should
be generated from these records.

## Workloads

The suite covers four payload sizes (1 KiB, 16 KiB, 256 KiB, and 1 MiB), four payload classes,
and both `none` and `deflate` compression requests:

- `sdp-like`: structured SDP-style text with session, media, codec, ICE, and fingerprint attributes.
- `ice-heavy`: repeated host, IPv6, server-reflexive, relay, and TCP candidate-line shapes.
- `webrtc-fixtures`: the checked-in Chromium offer, Safari answer, and ICE candidate fixtures. These use TEST-NET addresses and placeholder ICE credentials.
- `incompressible`: deterministic xorshift bytes, used as a worst-case compression control.

The benchmark emits one metadata record followed by one result record for each payload/compression
combination.

## Measurements

### Envelope operations

`encode` and `decode` include p50, p95, p99, minimum, maximum, total batch duration, operations per
second, and MiB/s. Throughput is calculated over the complete measured batch, not by taking the
inverse of a latency percentile.

### Fragmentation

`fragmentation` measures the time required to create the default transport fragments. The result
also reports the default fragment count, total encoded fragment bytes, framing overhead, and
fragments per second.
Framing overhead is `sum(encoded fragment byte lengths) - envelope byte length`.

### Reassembly ordering and duplicates

Reassembly stress cases use a smaller fragment payload (selected to produce up to approximately
256 fragments) so small inputs also exercise multi-fragment state. The scenarios are:

- `ordered`: fragments arrive in index order.
- `reverse`: fragments arrive from last to first.
- `shuffled`: fragments arrive in a deterministic shuffled order.
- `duplicate-heavy`: each shuffled fragment is delivered twice.

Each result includes latency distribution, transfer throughput, delivered fragments per second,
and the peak values observed from the reassembler's public accounting getters: retained fragment payload bytes, retained fragments,
and active transfers. The resource counters report retained fragment payload bytes, retained fragment count, and active transfers.

### Concurrent transfers and resource limits

The suite interleaves 1, 2, and 4 independent transfers through one reassembler. It reports aggregate
throughput and the same peak logical resource counters. A separate case opens four incomplete
transfers and measures the rejection of a fifth under the default concurrent-transfer limit. The
benchmark checks that the rejection is a `RESOURCE_LIMIT` error.

### Batched encode throughput

`encodeThroughputBatch` measures a batch of `BENCH_THROUGHPUT_BATCH` envelope encodes. Its
`encodeOperationsPerSecond` is the number of individual encodes divided by the complete batch time.
This is a separate throughput measurement from per-operation latency samples.

## Reading the output

Every line is valid JSON. Records have `recordType: "metadata"` or `recordType: "case"`.
Metadata includes Node version, OS and release, architecture, CPU model, logical CPU count,
total/free memory at start, iteration settings, and timestamp.

Important distinctions:

- `envelopeBytes` is the encoded envelope size, not the original application payload size.
- `encodedPayloadBytes` is the byte-string payload stored in CBOR field 11.
- `protocolOverheadBytes` is `envelopeBytes - encodedPayloadBytes`; this includes CBOR fields, digest, and byte-string framing.
- `envelopeSizeDeltaBytes` is `envelopeBytes - payloadBytes`. It is a size delta, not protocol overhead, and may be negative when compression savings exceed protocol metadata.
- `encodedFragmentBytes` includes each serialized fragment's framing metadata.
- `fragmentationOverheadBytes` is the additional encoded size introduced by fragment framing.
- `peakRetainedBytes` is the reassembler's tracked fragment payload bytes. It is not total heap usage.
- `operationsPerSecond` and `mebibytesPerSecond` are measured over the complete operation batch.
- `compressionSavingsBytes` and `compressionSavingsPercent` compare the original application payload with the encoded payload bytes, and are zero when compression is not retained. `compressionRatio` is original payload bytes divided by encoded payload bytes. `compressionApplied` reports whether DEFLATE was retained.
- Compression requests use a 1 KiB prefix probe for payloads of at least 4 KiB. Full compression is attempted only when the probe saves at least 10%. This CPU-saving heuristic can decline compression when the prefix is atypical of the remainder of the payload.

## Collection procedure

For a report intended for publication:

1. Use the repository's pinned Node and pnpm versions.
2. Run on an otherwise idle machine, connected to power where applicable.
3. Run the full suite at least three times with identical settings.
4. Preserve each raw JSONL file and its metadata record.
5. Compare matching payload class, size, and compression mode.
6. Report p50, p95, and p99 across each run; include run-to-run variation rather than hiding it.
7. Record browser/device/network details separately for browser tests.


## Memory measurement

The benchmark reports peak retained fragment payload bytes, retained fragment count, and active transfer count from the reassembler accounting counters.

## Browser benchmarks

The core Node harness does not measure QR image generation or decoding. Build the package and
start the existing Vite server:

```sh
pnpm build
pnpm dev:interop
```

Open `http://127.0.0.1:4173/examples/browser-benchmarks.html`. The page measures core envelope encode/decode (1,000 samples each), DEFLATE-requested encode/round-trip checks (100 samples), fragmentation/reassembly (100 samples each), and QR SVG frame generation, image loading, QR image decoding plus reassembly, and total end-to-end time for 1 KiB, 16 KiB, and 64 KiB payloads. A 256 KiB QR workload is available as an opt-in because it can create hundreds of frames and take considerably longer. QR image operations run three times and report p50, mean, and maximum only. Core operations report p50/p95/p99. The page exports
newline-delimited JSON.

Run the page separately in each target browser/device. Record browser name and version, OS/device,
image dimensions, frame count, and whether the source images were loaded from generated data URLs.
The page measures generated-image decoding. It exports newline-delimited JSON for analysis.
