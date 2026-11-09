import { fail, wrapError } from '../core/errors.js';
import { toArrayBuffer } from '../core/bytes.js';
import { resolveLimits, type LimitsOverride } from '../core/limits.js';

export interface FileImportOptions {
  limits?: LimitsOverride;
}

export function createEnvelopeBlob(bytes: Uint8Array, options: FileImportOptions = {}): Blob {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'File export options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail('INVALID_ARGUMENT', 'Envelope bytes must be a non-empty Uint8Array');
  }
  if (bytes.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Envelope exceeds the configured file size limit', {
      maximum: limits.maxEnvelopeBytes,
      actual: bytes.byteLength,
    });
  }
  return new Blob([toArrayBuffer(bytes)], { type: 'application/vnd.see.envelope' });
}

export async function readEnvelopeFile(
  file: Blob,
  options: FileImportOptions = {},
): Promise<Uint8Array> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'File import options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (!(file instanceof Blob)) {
    fail('INVALID_ARGUMENT', 'Input must be a Blob or File');
  }
  if (file.size === 0) {
    fail('INVALID_ARGUMENT', 'Selected envelope file is empty');
  }
  if (file.size > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Selected file exceeds the configured envelope limit', {
      maximum: limits.maxEnvelopeBytes,
      actual: file.size,
    });
  }
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (cause) {
    throw wrapError('TRANSPORT_ERROR', 'Could not read the selected envelope file', cause);
  }
}
