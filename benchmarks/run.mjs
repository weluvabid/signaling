import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import {
  encodeEnvelope,
  decodeEnvelope,
  fragmentEnvelope,
  FragmentReassembler,
} from '../dist/index.js';
import { decodeCanonical } from '../dist/core/cbor.js';
import { DEFAULT_LIMITS } from '../dist/core/limits.js';

const sizes = [1_024, 16_384, 262_144, 1_048_576];
const iterations = Number(process.env.BENCH_ITERATIONS ?? 1_000);
const warmupIterations = Number(process.env.BENCH_WARMUP ?? 100);
const transferIterations = Number(process.env.BENCH_TRANSFER_ITERATIONS ?? 1_000);
const throughputBatchSize = Number(process.env.BENCH_THROUGHPUT_BATCH ?? 100);
const createdAt = 1_700_000_000_000;
const benchmarkVersion = 4;

function assertIntegerInRange(name, value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

assertIntegerInRange('BENCH_ITERATIONS', iterations, 1_000, 10_000);
assertIntegerInRange('BENCH_WARMUP', warmupIterations, 0, 1_000);
assertIntegerInRange('BENCH_TRANSFER_ITERATIONS', transferIterations, 100, 1_000);
assertIntegerInRange('BENCH_THROUGHPUT_BATCH', throughputBatchSize, 10, 1_000);

function createRandomPayload(size, seed = 0x51_47_4e) {
  const bytes = new Uint8Array(size);
  let state = seed >>> 0;
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function createTextPayload(size, mode) {
  const lines =
    mode === 'sdp'
      ? [
          'v=0\r\n',
          'o=- 46117326 2 IN IP4 127.0.0.1\r\n',
          's=-\r\n',
          't=0 0\r\n',
          'a=group:BUNDLE 0\r\n',
          'a=ice-options:trickle renomination\r\n',
          'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\n',
          'm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\n',
          'a=mid:0\r\n',
          'a=rtcp-mux\r\n',
          'a=rtpmap:111 opus/48000/2\r\n',
        ]
      : [
          'a=candidate:1 1 udp 2122260223 192.0.2.10 50000 typ host generation 0 ufrag abc network-id 1\r\n',
          'a=candidate:2 1 udp 1686052607 2001:db8::10 50001 typ host generation 0 ufrag abc network-id 2\r\n',
          'a=candidate:3 1 udp 1686052607 198.51.100.20 62000 typ srflx raddr 192.0.2.10 rport 50000 generation 0 ufrag abc\r\n',
          'a=candidate:4 1 tcp 1518280447 2001:db8::20 9 typ host tcptype active generation 0 ufrag abc\r\n',
        ];
  let output = '';
  let index = 0;
  while (Buffer.byteLength(output) < size) {
    output += lines[index % lines.length];
    index += 1;
  }
  return new TextEncoder().encode(output).subarray(0, size);
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

async function measure(operation, count, bytesPerOperation = 0) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    await operation();
    samples.push(performance.now() - start);
  }
  // Derive aggregate rates from the recorded operation samples, not from the
  // outer harness loop (which also includes iteration and bookkeeping overhead).
  const totalMs = samples.reduce((total, sample) => total + sample, 0);
  const totalBytes = bytesPerOperation * count;
  return {
    iterations: count,
    samplesMs: samples.map((sample) => Number(sample.toFixed(6))),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    totalMs: Number(totalMs.toFixed(3)),
    operationsPerSecond: Number((count / (totalMs / 1_000)).toFixed(2)),
    ...(bytesPerOperation > 0
      ? { mebibytesPerSecond: Number((totalBytes / 1_048_576 / (totalMs / 1_000)).toFixed(2)) }
      : {}),
  };
}

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function sumByteLengths(values) {
  return values.reduce((total, value) => total + value.byteLength, 0);
}

function deterministicShuffle(values, seed = 0x5eed) {
  const output = [...values];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function orderFragments(fragments, order) {
  if (order === 'ordered') {
    return fragments;
  }
  if (order === 'reverse') {
    return [...fragments].reverse();
  }
  if (order === 'shuffled') {
    return deterministicShuffle(fragments);
  }
  throw new RangeError(`Unknown fragment order: ${order}`);
}

async function reassemble(fragments, order, duplicateMode = false) {
  const reassembler = new FragmentReassembler();
  let peakRetainedBytes = 0;
  let peakRetainedFragments = 0;
  let peakActiveTransfers = 0;
  const ordered = orderFragments(fragments, order);

  for (const fragment of ordered) {
    const pending = reassembler.add(fragment);
    peakRetainedBytes = Math.max(peakRetainedBytes, reassembler.inFlightBytes);
    peakRetainedFragments = Math.max(peakRetainedFragments, reassembler.inFlightFragments);
    peakActiveTransfers = Math.max(peakActiveTransfers, reassembler.activeTransfers);
    await pending;
    if (duplicateMode) {
      await reassembler.add(fragment);
    }
  }

  if (
    reassembler.activeTransfers !== 0 ||
    reassembler.inFlightBytes !== 0 ||
    reassembler.inFlightFragments !== 0
  ) {
    throw new Error('Reassembler retained state after successful completion');
  }
  return { peakRetainedBytes, peakRetainedFragments, peakActiveTransfers };
}

async function reassembleConcurrent(fragmentSets) {
  const reassembler = new FragmentReassembler();
  let peakRetainedBytes = 0;
  let peakRetainedFragments = 0;
  let peakActiveTransfers = 0;
  const maximumFragments = Math.max(...fragmentSets.map((set) => set.length));

  for (let index = 0; index < maximumFragments; index += 1) {
    for (const fragments of fragmentSets) {
      const fragment = fragments[index];
      if (fragment) {
        const pending = reassembler.add(fragment);
        peakRetainedBytes = Math.max(peakRetainedBytes, reassembler.inFlightBytes);
        peakRetainedFragments = Math.max(peakRetainedFragments, reassembler.inFlightFragments);
        peakActiveTransfers = Math.max(peakActiveTransfers, reassembler.activeTransfers);
        await pending;
      }
    }
  }

  if (
    reassembler.activeTransfers !== 0 ||
    reassembler.inFlightBytes !== 0 ||
    reassembler.inFlightFragments !== 0
  ) {
    throw new Error('Concurrent reassembly retained state after successful completion');
  }
  return { peakRetainedBytes, peakRetainedFragments, peakActiveTransfers };
}

const chromiumOffer = JSON.parse(
  readFileSync(new URL('../test/fixtures/webrtc/chromium-offer.json', import.meta.url), 'utf8'),
);
const safariAnswer = JSON.parse(
  readFileSync(new URL('../test/fixtures/webrtc/safari-answer.json', import.meta.url), 'utf8'),
);
const iceCandidates = JSON.parse(
  readFileSync(new URL('../test/fixtures/webrtc/ice-candidates.json', import.meta.url), 'utf8'),
);
const fixtureCorpus = [
  chromiumOffer.sdp,
  safariAnswer.sdp,
  ...iceCandidates.map((candidate) => `a=${candidate.candidate}\r\n`),
].join('');

function createFixturePayload(size) {
  let value = '';
  while (value.length < size) {
    value += fixtureCorpus;
  }
  return new TextEncoder().encode(value).subarray(0, size);
}

const payloadFactories = [
  ['sdp-like', (size) => createTextPayload(size, 'sdp')],
  ['ice-heavy', (size) => createTextPayload(size, 'ice')],
  ['webrtc-fixtures', createFixturePayload],
  ['incompressible', (size) => createRandomPayload(size)],
];

emit({
  recordType: 'metadata',
  benchmark: 'SEE performance suite',
  benchmarkVersion,
  node: process.version,
  platform: platform(),
  platformRelease: release(),
  architecture: process.arch,
  cpu: cpus()[0]?.model ?? 'unknown',
  logicalCpuCount: cpus().length,
  totalMemoryBytes: totalmem(),
  freeMemoryBytesAtStart: freemem(),
  iterations,
  warmupIterations,
  transferIterations,
  throughputBatchSize,
  compressionPolicy: {
    minimumInputBytes: 4_096,
    probeBytes: 1_024,
    minimumProbeSavingsRatio: 0.1,
  },
  fixtureCorpus: [
    'test/fixtures/webrtc/chromium-offer.json',
    'test/fixtures/webrtc/safari-answer.json',
    'test/fixtures/webrtc/ice-candidates.json',
  ],
  timestamp: new Date().toISOString(),
  statistic:
    'milliseconds per operation; p50/p95/p99/min/max; throughput measured over complete batches',
});

for (const size of sizes) {
  for (const [payloadClass, createPayload] of payloadFactories) {
    const payload = createPayload(size);
    for (const compression of ['none', 'deflate']) {
      const encodeInput = {
        kind: 'custom',
        contentType: 'application/octet-stream',
        createdAt,
        payload,
        compression,
      };
      let envelope = await encodeEnvelope(encodeInput);

      for (let index = 0; index < warmupIterations; index += 1) {
        envelope = await encodeEnvelope(encodeInput);
      }
      const encode = await measure(
        async () => {
          envelope = await encodeEnvelope(encodeInput);
        },
        iterations,
        payload.byteLength,
      );

      const decoded = await decodeEnvelope(envelope, { now: () => createdAt });
      const envelopeMap = decodeCanonical(envelope, DEFAULT_LIMITS);
      const encodedPayload = envelopeMap.get(11);
      if (!(encodedPayload instanceof Uint8Array)) {
        throw new Error('Benchmark could not inspect the encoded envelope payload');
      }
      const encodedPayloadBytes = encodedPayload.byteLength;
      const fragments = await fragmentEnvelope(envelope);
      const encodedFragmentBytes = sumByteLengths(fragments);
      // Reassembly stress cases use smaller frames so even small payloads exercise
      // multi-fragment state, ordering, duplicate handling, and concurrent transfers.
      const stressFragmentDataBytes = Math.min(
        4_096,
        Math.max(256, Math.ceil(envelope.byteLength / 256)),
      );
      const stressFragments = await fragmentEnvelope(envelope, {
        maxFragmentDataBytes: stressFragmentDataBytes,
      });

      for (let index = 0; index < warmupIterations; index += 1) {
        await decodeEnvelope(envelope, { now: () => createdAt });
        const reassembler = new FragmentReassembler();
        for (const fragment of stressFragments) {
          await reassembler.add(fragment);
        }
      }

      const decode = await measure(
        async () => decodeEnvelope(envelope, { now: () => createdAt }),
        iterations,
        envelope.byteLength,
      );
      const fragmentation = await measure(
        async () => fragmentEnvelope(envelope),
        transferIterations,
        envelope.byteLength,
      );
      const reassembly = await measure(
        async () => reassemble(stressFragments, 'ordered'),
        transferIterations,
        envelope.byteLength,
      );
      reassembly.fragmentsPerSecond = Number(
        (reassembly.operationsPerSecond * stressFragments.length).toFixed(2),
      );
      fragmentation.fragmentsPerSecond = Number(
        (fragmentation.operationsPerSecond * fragments.length).toFixed(2),
      );

      const reassemblyScenarios = [];
      for (const order of ['ordered', 'reverse', 'shuffled', 'duplicate-heavy']) {
        let peak = { peakRetainedBytes: 0, peakRetainedFragments: 0, peakActiveTransfers: 0 };
        const result = await measure(
          async () => {
            peak = await reassemble(
              stressFragments,
              order === 'duplicate-heavy' ? 'shuffled' : order,
              order === 'duplicate-heavy',
            );
          },
          transferIterations,
          envelope.byteLength,
        );
        const deliveredFragmentsPerTransfer =
          stressFragments.length * (order === 'duplicate-heavy' ? 2 : 1);
        reassemblyScenarios.push({
          scenario: order,
          deliveredFragmentsPerTransfer,
          ...result,
          fragmentsPerSecond: Number(
            (result.operationsPerSecond * deliveredFragmentsPerTransfer).toFixed(2),
          ),
          ...peak,
        });
      }

      const concurrentScenarios = [];
      for (const concurrency of [1, 2, 4]) {
        const fragmentSets = await Promise.all(
          Array.from({ length: concurrency }, () =>
            fragmentEnvelope(envelope, { maxFragmentDataBytes: stressFragmentDataBytes }),
          ),
        );
        let peak = { peakRetainedBytes: 0, peakRetainedFragments: 0, peakActiveTransfers: 0 };
        const result = await measure(
          async () => {
            peak = await reassembleConcurrent(fragmentSets);
          },
          transferIterations,
          envelope.byteLength * concurrency,
        );
        concurrentScenarios.push({
          concurrency,
          ...result,
          fragmentsPerSecond: Number(
            (result.operationsPerSecond * stressFragments.length * concurrency).toFixed(2),
          ),
          ...peak,
        });
      }

      for (let warmup = 0; warmup < Math.min(5, warmupIterations); warmup += 1) {
        for (let index = 0; index < throughputBatchSize; index += 1) {
          await encodeEnvelope(encodeInput);
        }
      }
      const limitFragments = await Promise.all(
        Array.from({ length: 5 }, () =>
          fragmentEnvelope(envelope, { maxFragmentDataBytes: stressFragmentDataBytes }),
        ),
      );
      const concurrentLimitRejection = await measure(async () => {
        const reassembler = new FragmentReassembler();
        for (let index = 0; index < 4; index += 1) {
          await reassembler.add(limitFragments[index][0]);
        }
        try {
          await reassembler.add(limitFragments[4][0]);
          throw new Error('Expected the fifth concurrent transfer to be rejected');
        } catch (error) {
          if (error?.code !== 'RESOURCE_LIMIT') {
            throw error;
          }
        }
        reassembler.clear();
      }, transferIterations);

      const throughput = await measure(
        async () => {
          for (let index = 0; index < throughputBatchSize; index += 1) {
            await encodeEnvelope(encodeInput);
          }
        },
        1,
        payload.byteLength * throughputBatchSize,
      );

      throughput.encodeOperationsPerSecond = Number(
        (throughputBatchSize / (throughput.totalMs / 1_000)).toFixed(2),
      );
      throughput.batchSize = throughputBatchSize;

      emit({
        recordType: 'case',
        payloadClass,
        payloadBytes: payload.byteLength,
        envelopeBytes: envelope.byteLength,
        payloadBytes: payload.byteLength,
        encodedPayloadBytes,
        protocolOverheadBytes: envelope.byteLength - encodedPayloadBytes,
        envelopeSizeDeltaBytes: envelope.byteLength - payload.byteLength,
        compressionRequested: compression,
        compressionApplied: decoded.compression === 'deflate',
        compressionSavingsBytes:
          decoded.compression === 'deflate' ? payload.byteLength - encodedPayloadBytes : 0,
        compressionRatio:
          encodedPayloadBytes > 0
            ? Number((payload.byteLength / encodedPayloadBytes).toFixed(4))
            : null,
        compressionSavingsPercent:
          decoded.compression === 'deflate'
            ? Number(((1 - encodedPayloadBytes / payload.byteLength) * 100).toFixed(2))
            : 0,
        fragmentCount: fragments.length,
        reassemblyStressFragmentCount: stressFragments.length,
        reassemblyStressFragmentDataBytes: stressFragmentDataBytes,
        encodedFragmentBytes,
        fragmentationOverheadBytes: encodedFragmentBytes - envelope.byteLength,
        encode,
        decode,
        fragmentation,
        reassembly,
        reassemblyScenarios,
        concurrentScenarios,
        concurrentLimitRejection,
        encodeThroughputBatch: throughput,
      });
    }
  }
}
