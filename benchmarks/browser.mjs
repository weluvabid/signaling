import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';

const browserTypes = { chromium, firefox, webkit };
const browserNames = (process.env.SEE_BROWSERS ?? 'chromium')
  .split(',')
  .map((name) => name.trim());
if (browserNames.length === 0 || browserNames.some((name) => !Object.hasOwn(browserTypes, name))) {
  throw new Error('SEE_BROWSERS must contain chromium, firefox, or webkit');
}

const server = await createServer({
  configFile: './vite.config.mjs',
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
const timestamp = new Date().toISOString().replaceAll(':', '-');
const sizes = (process.env.SEE_BROWSER_BENCH_SIZES ?? '1024,16384,65536')
  .split(',')
  .map(Number)
  .filter((value) => Number.isSafeInteger(value) && value > 0);
const iterations = Number(process.env.SEE_BROWSER_BENCH_ITERATIONS ?? 1_000);
const qrIterations = Number(process.env.SEE_BROWSER_QR_ITERATIONS ?? 3);
const compressionIterations = Number(process.env.SEE_BROWSER_COMPRESSION_ITERATIONS ?? 100);
const transferIterations = Number(process.env.SEE_BROWSER_TRANSFER_ITERATIONS ?? 100);

if (
  sizes.length === 0 ||
  [iterations, qrIterations, compressionIterations, transferIterations].some(
    (value) => !Number.isSafeInteger(value) || value < 1,
  )
) {
  throw new Error('Benchmark sizes and iteration counts must be positive integers');
}

try {
  await server.listen();
  for (const browserName of browserNames) {
    const browserType = browserTypes[browserName];
    const browser = await browserType.launch({ headless: true });
    let context;
    try {
      context = await browser.newContext();
      const page = await context.newPage();
      const outputPath = `benchmarks/results/see-browser-${browserName}-${timestamp}.jsonl`;
      const records = await page.goto('http://127.0.0.1:4173/tests/browser/fixture.html').then(async () => {
        await page.waitForFunction(() => window.__SEE_READY__ === true);
        return page.evaluate(async ({ sizes, iterations, qrIterations, compressionIterations, transferIterations }) => {
          const see = window.SEE;
          const createdAt = 1_700_000_000_000;
          const createPayload = (size) => {
            const bytes = new Uint8Array(size);
            let state = 0x51_47_4e;
            for (let index = 0; index < size; index += 1) {
              state ^= state << 13;
              state ^= state >>> 17;
              state ^= state << 5;
              bytes[index] = state & 0xff;
            }
            return bytes;
          };
          const summarize = (samples) => {
            const sorted = [...samples].sort((left, right) => left - right);
            const percentile = (fraction) => Number(sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)].toFixed(3));
            const total = samples.reduce((sum, value) => sum + value, 0);
            return {
              iterations: samples.length,
              p50Ms: percentile(0.5),
              ...(samples.length >= 100
                ? { p95Ms: percentile(0.95), p99Ms: percentile(0.99) }
                : {}),
              meanMs: Number((total / samples.length).toFixed(3)),
              maxMs: Number(sorted.at(-1).toFixed(3)),
            };
          };
          const records = [{
            recordType: 'browser-metadata',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemoryGiB: navigator.deviceMemory ?? null,
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            iterations,
            qrIterations,
            compressionIterations,
            transferIterations,
          }];

          for (const payloadBytes of sizes) {
            const payload = createPayload(payloadBytes);
            const input = {
              kind: 'custom',
              contentType: 'application/octet-stream',
              createdAt,
              payload,
              compression: 'none',
            };
            const encodeSamples = [];
            const decodeSamples = [];
            let envelope;
            for (let index = 0; index < iterations; index += 1) {
              const start = performance.now();
              envelope = await see.encodeEnvelope(input);
              encodeSamples.push(performance.now() - start);
            }
            for (let index = 0; index < iterations; index += 1) {
              const start = performance.now();
              const decoded = await see.decodeEnvelope(envelope, { now: () => createdAt });
              if (!see.equalBytes(payload, decoded.payload)) {
                throw new Error('Browser decode mismatch');
              }
              decodeSamples.push(performance.now() - start);
            }

            const compressionSamples = [];
            let compressionAppliedCount = 0;
            for (let index = 0; index < compressionIterations; index += 1) {
              const start = performance.now();
              const compressed = await see.encodeEnvelope({ ...input, compression: 'deflate' });
              compressionSamples.push(performance.now() - start);
              const decoded = await see.decodeEnvelope(compressed, { now: () => createdAt });
              if (!see.equalBytes(payload, decoded.payload)) {
                throw new Error('Browser compression mismatch');
              }
              if (decoded.compression === 'deflate') {
                compressionAppliedCount += 1;
              }
            }

            const fragmentSamples = [];
            const reassemblySamples = [];
            let fragmentCount = 0;
            for (let index = 0; index < transferIterations; index += 1) {
              const start = performance.now();
              const fragments = await see.fragmentEnvelope(envelope);
              fragmentSamples.push(performance.now() - start);
              fragmentCount = fragments.length;
              const reassembler = new see.FragmentReassembler();
              const reassemblyStart = performance.now();
              let result;
              for (const fragment of fragments) result = await reassembler.add(fragment);
              if (result?.status !== 'complete' || !see.equalBytes(result.bytes, envelope)) {
                throw new Error('Browser fragment reassembly mismatch');
              }
              reassemblySamples.push(performance.now() - reassemblyStart);
            }

            const qrEncodeSamples = [];
            const imageLoadSamples = [];
            const qrDecodeSamples = [];
            const endToEndSamples = [];
            let qrFrameCount = 0;
            let svgCharacters = 0;
            for (let index = 0; index < qrIterations; index += 1) {
              const endToEndStart = performance.now();
              let start = performance.now();
              const frames = await see.encodeQrFrames(envelope, { errorCorrectionLevel: 'M' });
              qrEncodeSamples.push(performance.now() - start);
              qrFrameCount = frames.length;
              svgCharacters = frames.reduce((sum, frame) => sum + frame.dataUrl.length, 0);
              start = performance.now();
              const images = await Promise.all(frames.map((frame) => see.imageFromDataUrl(frame.dataUrl)));
              imageLoadSamples.push(performance.now() - start);
              start = performance.now();
              const reconstructed = await see.reassembleQrFrames(images);
              qrDecodeSamples.push(performance.now() - start);
              if (!see.equalBytes(envelope, reconstructed)) {
                throw new Error('Browser QR round-trip mismatch');
              }
              endToEndSamples.push(performance.now() - endToEndStart);
            }

            records.push({
              recordType: 'browser-case',
              payloadBytes,
              envelopeBytes: envelope.byteLength,
              encode: summarize(encodeSamples),
              decode: summarize(decodeSamples),
              compressionRequestedEncode: summarize(compressionSamples),
              compressionAppliedCount,
              compressionIterations,
              fragmentation: summarize(fragmentSamples),
              reassembly: summarize(reassemblySamples),
              fragmentCount,
              transferIterations,
              qrEncode: summarize(qrEncodeSamples),
              imageLoad: summarize(imageLoadSamples),
              qrDecodeAndReassembly: summarize(qrDecodeSamples),
              endToEnd: summarize(endToEndSamples),
              qrIterations,
              qrFrameCount,
              totalSvgDataUrlCharacters: svgCharacters,
            });
          }
          return records;
        }, { sizes, iterations, qrIterations, compressionIterations, transferIterations });
      });
      records[0].browserName = browserName;
      records[0].browserVersion = browser.version();
      await mkdir('benchmarks/results', { recursive: true });
      await writeFile(outputPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
      process.stdout.write(`${outputPath}\n`);
    } finally {
      await context?.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
}
