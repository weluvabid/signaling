import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import process from 'node:process';

const RESULTS_DIR = join(process.cwd(), 'benchmarks', 'results');
const EXPECTED_CASES = 4 * 4 * 2;

function createRunId(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

function assertMeasurement(measurement, name, expectedIterations) {
  if (!measurement || measurement.iterations !== expectedIterations) {
    throw new Error(`${name}: iteration count does not match the run configuration`);
  }
  if (!Array.isArray(measurement.samplesMs) ||
      measurement.samplesMs.length !== measurement.iterations ||
      measurement.samplesMs.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error(`${name}: missing, malformed, or incomplete samplesMs`);
  }
}

function validateCase(record, metadata) {
  if (record.recordType !== 'case' ||
      !Number.isSafeInteger(record.payloadBytes) ||
      !Number.isSafeInteger(record.envelopeBytes) ||
      typeof record.payloadClass !== 'string' ||
      !['none', 'deflate'].includes(record.compressionRequested)) {
    throw new Error('Malformed benchmark case record');
  }

  assertMeasurement(record.encode, 'encode', metadata.iterations);
  assertMeasurement(record.decode, 'decode', metadata.iterations);
  assertMeasurement(record.fragmentation, 'fragmentation', metadata.transferIterations);
  assertMeasurement(record.reassembly, 'reassembly', metadata.transferIterations);

  for (const scenario of record.reassemblyScenarios ?? []) {
    assertMeasurement(scenario, `reassemblyScenarios.${scenario.scenario}`,
      metadata.transferIterations);
  }
  for (const scenario of record.concurrentScenarios ?? []) {
    assertMeasurement(scenario, `concurrentScenarios.${scenario.concurrency}`,
      metadata.transferIterations);
  }
  assertMeasurement(record.concurrentLimitRejection, 'concurrentLimitRejection',
    metadata.transferIterations);
  assertMeasurement(record.encodeThroughputBatch, 'encodeThroughputBatch', 1);

  if (record.encodeThroughputBatch.batchSize !== metadata.throughputBatchSize) {
    throw new Error('encodeThroughputBatch batch size does not match metadata');
  }
}

function summarize(metadata, cases) {
  return {
    schemaVersion: 1,
    benchmark: metadata.benchmark,
    benchmarkVersion: metadata.benchmarkVersion,
    timestamp: metadata.timestamp,
    configuration: {
      node: metadata.node,
      platform: metadata.platform,
      platformRelease: metadata.platformRelease,
      architecture: metadata.architecture,
      cpu: metadata.cpu,
      logicalCpuCount: metadata.logicalCpuCount,
      iterations: metadata.iterations,
      warmupIterations: metadata.warmupIterations,
      transferIterations: metadata.transferIterations,
      throughputBatchSize: metadata.throughputBatchSize,
    },
    caseCount: cases.length,
    cases: cases.map((record) => ({
      payloadClass: record.payloadClass,
      payloadBytes: record.payloadBytes,
      compressionRequested: record.compressionRequested,
      compressionApplied: record.compressionApplied,
      envelopeBytes: record.envelopeBytes,
      encodedPayloadBytes: record.encodedPayloadBytes,
      fragmentCount: record.fragmentCount,
      encode: {
        p50Ms: record.encode.p50Ms,
        p95Ms: record.encode.p95Ms,
        p99Ms: record.encode.p99Ms,
        operationsPerSecond: record.encode.operationsPerSecond,
      },
      decode: {
        p50Ms: record.decode.p50Ms,
        p95Ms: record.decode.p95Ms,
        p99Ms: record.decode.p99Ms,
        operationsPerSecond: record.decode.operationsPerSecond,
      },
      fragmentation: {
        p50Ms: record.fragmentation.p50Ms,
        p95Ms: record.fragmentation.p95Ms,
        p99Ms: record.fragmentation.p99Ms,
      },
      reassembly: {
        p50Ms: record.reassembly.p50Ms,
        p95Ms: record.reassembly.p95Ms,
        p99Ms: record.reassembly.p99Ms,
      },
      concurrentScenarios: record.concurrentScenarios.map((scenario) => ({
        concurrency: scenario.concurrency,
        p50Ms: scenario.p50Ms,
        p95Ms: scenario.p95Ms,
        mebibytesPerSecond: scenario.mebibytesPerSecond,
        peakRetainedBytes: scenario.peakRetainedBytes,
      })),
    })),
  };
}

const requestedRunId = process.argv[2];
const runId = requestedRunId ?? createRunId();
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
  throw new Error('Run ID may contain only letters, numbers, dots, underscores, and hyphens');
}

const runDir = join(RESULTS_DIR, runId);
await mkdir(runDir, { recursive: false });
const rawPath = join(runDir, 'results.jsonl');
const output = createWriteStream(rawPath, { flags: 'wx' });
const child = spawn(process.execPath, ['benchmarks/run.mjs'], {
  cwd: process.cwd(),
  stdio: ['inherit', 'pipe', 'inherit'],
});

let buffered = '';
let metadata;
const cases = [];
const seenCases = new Set();
let parseError;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  if (parseError) return;
  buffered += chunk;
  let newline;
  while ((newline = buffered.indexOf('\n')) !== -1) {
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (!metadata) {
        if (record.recordType !== 'metadata' || record.benchmarkVersion !== 4) {
          throw new Error('First record must be benchmark v4 metadata');
        }
        metadata = record;
      } else {
        validateCase(record, metadata);
        const key = `${record.payloadClass}:${record.payloadBytes}:${record.compressionRequested}`;
        if (seenCases.has(key)) throw new Error(`Duplicate benchmark case: ${key}`);
        seenCases.add(key);
        cases.push(record);
      }
      if (!output.write(`${line}\n`)) {
        child.stdout.pause();
        output.once('drain', () => child.stdout.resume());
      }
    } catch (error) {
      parseError = error;
      child.kill('SIGTERM');
    }
  }
});

const [exitCode, exitSignal] = await once(child, 'close').then(([code, signal]) => [code, signal]);
output.end();
await once(output, 'close');

if (parseError) throw parseError;
if (buffered.trim()) throw new Error('Benchmark emitted an incomplete trailing JSONL record');
if (exitCode !== 0) throw new Error(`Benchmark process failed (${exitSignal ?? exitCode}); raw output retained at ${rawPath}`);
if (!metadata) throw new Error('Benchmark produced no metadata record');
if (cases.length !== EXPECTED_CASES) {
  throw new Error(`Expected ${EXPECTED_CASES} cases, received ${cases.length}; raw output retained at ${rawPath}`);
}

const summary = summarize(metadata, cases);
await writeFile(join(runDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });

process.stdout.write([
  '',
  'SEE benchmark completed successfully.',
  `  Run:      ${runId}`,
  `  Cases:    ${cases.length}`,
  `  Raw:      ${rawPath}`,
  `  Summary:  ${join(runDir, 'summary.json')}`,
  `  Metadata: ${join(runDir, 'metadata.json')}`,
  '',
].join('\n'));
