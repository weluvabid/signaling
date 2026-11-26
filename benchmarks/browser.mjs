import { appendFile, mkdir, writeFile } from 'node:fs/promises';
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
const iterations = Number(process.env.SEE_BROWSER_BENCH_ITERATIONS ?? 30);
const qrIterations = Number(process.env.SEE_BROWSER_QR_ITERATIONS ?? 20);
const warmupIterations = Number(process.env.SEE_BROWSER_WARMUP ?? 5);
const qrWarmupIterations = Number(process.env.SEE_BROWSER_QR_WARMUP ?? 1);
const compressionIterations = Number(process.env.SEE_BROWSER_COMPRESSION_ITERATIONS ?? 10);
const transferIterations = Number(process.env.SEE_BROWSER_TRANSFER_ITERATIONS ?? 20);

if (
  sizes.length === 0 ||
  [iterations, qrIterations, compressionIterations, transferIterations, warmupIterations, qrWarmupIterations].some(
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
      const browserVersion = browser.version();
      await mkdir('benchmarks/results', { recursive: true });
      await writeFile(outputPath, '');
      await page.exposeFunction('__SEE_REPORT__', async (record) => {
        if (record.recordType === 'browser-progress') {
          process.stdout.write(`[${browserName}] ${record.message}\n`);
          return;
        }
        await appendFile(outputPath, `${JSON.stringify({ ...record, browserName, browserVersion })}\n`);
        if (record.recordType === 'browser-case') {
          process.stdout.write(
            `[${browserName}] ${record.payloadBytes} B complete ` +
            `(encode p50 ${record.encode.p50Ms} ms, decode p50 ${record.decode.p50Ms} ms, ` +
            `QR encode ${record.qrEncode.iterations} samples, ` +
            `QR decode ${record.qrDecodeAndReassembly.iterations} sample(s))\n`,
          );
        }
      });
      await page.goto('http://127.0.0.1:4173/tests/browser/fixture.html');
      await page.waitForFunction(() => window.__SEE_READY__ === true);
      await page.evaluate(async ({ sizes, iterations, warmupIterations, qrIterations, qrWarmupIterations, compressionIterations, transferIterations }) => {
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
            const percentile = (fraction) => Number(sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)].toFixed(4));
            const total = samples.reduce((sum, value) => sum + value, 0);
            return {
              iterations: samples.length,
              p50Ms: percentile(0.5),
              ...(samples.length >= 20 ? { p95Ms: percentile(0.95) } : {}),
              ...(samples.length >= 100 ? { p99Ms: percentile(0.99) } : {}),
              meanMs: Number((total / samples.length).toFixed(4)),
              maxMs: Number(sorted.at(-1).toFixed(4)),
            };
          };
          const records = [{
            recordType: 'browser-metadata',
            benchmark: 'SEE browser performance suite',
            benchmarkVersion: 2,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemoryGiB: navigator.deviceMemory ?? null,
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            iterations,
            warmupIterations,
            qrIterations,
            qrWarmupIterations,
            compressionIterations,
            transferIterations,
          }];
          await window.__SEE_REPORT__(records[0]);

          for (const payloadBytes of sizes) {
            const payload = createPayload(payloadBytes);
            const input = {
              kind: 'custom',
              contentType: 'application/octet-stream',
              createdAt,
              payload,
              compression: 'none',
            };
            // Warm each library path before collecting samples. Validation stays
            // outside timed regions so the measurements represent the API calls.
            let warmEnvelope;
            for (let index = 0; index < warmupIterations; index += 1) {
              warmEnvelope = await see.encodeEnvelope(input);
              await see.decodeEnvelope(warmEnvelope, { now: () => createdAt });
            }
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
              const elapsed = performance.now() - start;
              if (!see.equalBytes(payload, decoded.payload)) {
                throw new Error('Browser decode mismatch');
              }
              decodeSamples.push(elapsed);
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
              const reassemblyElapsed = performance.now() - reassemblyStart;
              if (result?.status !== 'complete' || !see.equalBytes(result.bytes, envelope)) {
                throw new Error('Browser fragment reassembly mismatch');
              }
              reassemblySamples.push(reassemblyElapsed);
            }

            // QR cost scales with frame count. Keep the full configured sample
            // count for small transfers, but bound large transfers so one browser
            // engine does not repeatedly decode the same 78 images.
            const qrFragmentCount = (
              await see.fragmentEnvelope(envelope, { maxFragmentDataBytes: 850 })
            ).length;
            const largeQrCase = qrFragmentCount >= 64;
            const effectiveQrEncodeIterations = largeQrCase
              ? Math.min(qrIterations, 3)
              : qrIterations;
            const effectiveQrDecodeIterations = largeQrCase ? 1 : qrIterations;
            const effectiveQrWarmupIterations = largeQrCase ? 0 : qrWarmupIterations;

            await window.__SEE_REPORT__({
              recordType: 'browser-progress',
              message: `${payloadBytes} B: QR workload ${qrFragmentCount} frames; ` +
                `encode ${effectiveQrEncodeIterations} samples, ` +
                `decode/reassembly ${effectiveQrDecodeIterations} sample(s)`,
            });
            for (let index = 0; index < effectiveQrWarmupIterations; index += 1) {
              const warmQrFrames = await see.encodeQrFrames(envelope, { errorCorrectionLevel: 'M' });
              const warmQrImages = await Promise.all(
                warmQrFrames.map((frame) => see.imageFromDataUrl(frame.dataUrl)),
              );
              await see.reassembleQrFrames(warmQrImages);
            }

            const qrEncodeSamples = [];
            const qrDecodeSamples = [];
            let frames;
            let qrFrameCount = 0;
            let svgCharacters = 0;
            for (let index = 0; index < effectiveQrEncodeIterations; index += 1) {
              await window.__SEE_REPORT__({
                recordType: 'browser-progress',
                message: `${payloadBytes} B: QR encode ${index + 1}/${effectiveQrEncodeIterations}`,
              });
              const start = performance.now();
              frames = await see.encodeQrFrames(envelope, { errorCorrectionLevel: 'M' });
              qrEncodeSamples.push(performance.now() - start);
              qrFrameCount = frames.length;
              svgCharacters = frames.reduce((sum, frame) => sum + frame.dataUrl.length, 0);
            }

            // Load each generated QR image once. Reuse the decoded image objects
            // for library-only reconstruction samples so browser image decoding
            // is never charged to the signaling library or repeated needlessly.
            await window.__SEE_REPORT__({
              recordType: 'browser-progress',
              message: `${payloadBytes} B: loading ${qrFrameCount} QR images once`,
            });
            const imageLoadStart = performance.now();
            const images = await Promise.all(
              frames.map((frame) => see.imageFromDataUrl(frame.dataUrl)),
            );
            const imageLoadSamples = [performance.now() - imageLoadStart];
            for (let index = 0; index < effectiveQrDecodeIterations; index += 1) {
              await window.__SEE_REPORT__({
                recordType: 'browser-progress',
                message: `${payloadBytes} B: QR decode/reassembly ${index + 1}/${effectiveQrDecodeIterations}`,
              });
              const start = performance.now();
              const reconstructed = await see.reassembleQrFrames(images);
              qrDecodeSamples.push(performance.now() - start);
              if (!see.equalBytes(envelope, reconstructed)) {
                throw new Error('Browser QR round-trip mismatch');
              }
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
              qrIterations,
              qrEncodeIterations: effectiveQrEncodeIterations,
              qrDecodeIterations: effectiveQrDecodeIterations,
              qrWarmupIterations: effectiveQrWarmupIterations,
              qrFrameCount,
              totalSvgDataUrlCharacters: svgCharacters,
            });
            await window.__SEE_REPORT__(records.at(-1));
          }
        }, { sizes, iterations, warmupIterations, qrIterations, qrWarmupIterations, compressionIterations, transferIterations });
      process.stdout.write(`${outputPath}\n`);
    } finally {
      await context?.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
}
