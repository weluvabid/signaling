import { fail, wrapError } from './errors.js';
import { toArrayBuffer } from './bytes.js';

async function transform(
  input: Uint8Array,
  format: 'deflate',
  mode: 'compress' | 'decompress',
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  const Constructor =
    mode === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Constructor !== 'function') {
    fail(
      'UNSUPPORTED_RUNTIME',
      `${mode}ion via Compression Streams is unavailable in this runtime`,
    );
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const stream = new Blob([toArrayBuffer(input)]).stream().pipeThrough(new Constructor(format));
    reader = stream.getReader();
  } catch (cause) {
    throw wrapError('UNSUPPORTED_RUNTIME', `${mode}ion stream could not be initialized`, cause);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > maximumOutputBytes) {
        try {
          await reader.cancel('Output limit exceeded');
        } catch (cause) {
          throw wrapError(
            'RESOURCE_LIMIT',
            `${mode}ion output exceeded its limit and stream cancellation failed`,
            cause,
          );
        }
        fail('RESOURCE_LIMIT', `${mode}ion output exceeds the configured limit`, {
          maximum: maximumOutputBytes,
        });
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'SignalingError') {
      throw cause;
    }
    throw wrapError('INVALID_ENCODING', `${mode}ion stream failed`, cause);
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function compressDeflate(
  input: Uint8Array,
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  return transform(input, 'deflate', 'compress', maximumOutputBytes);
}

export function decompressDeflate(
  input: Uint8Array,
  expectedLength: number,
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  if (expectedLength > maximumOutputBytes) {
    fail('RESOURCE_LIMIT', 'Advertised decompressed length exceeds the configured limit', {
      expected: expectedLength,
      maximum: maximumOutputBytes,
    });
  }
  return transform(input, 'deflate', 'decompress', expectedLength).then((output) => {
    if (output.byteLength !== expectedLength) {
      fail('INVALID_ENVELOPE', 'Decompressed payload length does not match the envelope', {
        expected: expectedLength,
        actual: output.byteLength,
      });
    }
    return output;
  });
}
