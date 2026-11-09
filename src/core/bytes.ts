import { fail, wrapError, type SignalingErrorCode } from './errors.js';

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export function concatBytes(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  if (!Number.isSafeInteger(totalLength) || totalLength < 0) {
    fail('INVALID_ARGUMENT', 'Concatenated byte length must be a non-negative safe integer');
  }
  let actualLength = 0;
  for (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      fail('INVALID_ARGUMENT', 'Every concatenation chunk must be a Uint8Array');
    }
    actualLength += chunk.byteLength;
    if (!Number.isSafeInteger(actualLength)) {
      fail('RESOURCE_LIMIT', 'Concatenated byte length exceeds the safe integer range');
    }
  }
  if (actualLength !== totalLength) {
    fail('INVALID_FRAGMENT', 'Reassembled data does not match the declared transfer length', {
      expected: totalLength,
      actual: actualLength,
    });
  }
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function toHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, '0');
  }
  return output;
}

export function copyBytes(bytes: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(bytes);
  } catch (cause) {
    throw wrapError('INVALID_ARGUMENT', 'Could not snapshot the supplied byte array', cause);
  }
}

export function assertBytes(
  value: unknown,
  name: string,
  length?: number,
  code: SignalingErrorCode = 'INVALID_ARGUMENT',
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.byteLength !== length)) {
    fail(
      code,
      `${name} must be a ${length === undefined ? 'valid' : `${length}-byte`} Uint8Array`,
      {
        field: name,
      },
    );
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  assertBytes(bytes, 'Base64url input');
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  try {
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  } catch (cause) {
    throw wrapError(
      'UNSUPPORTED_RUNTIME',
      'Base64url encoding is unavailable in this runtime',
      cause,
    );
  }
}

export function decodeBase64Url(value: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    fail('INVALID_ARGUMENT', 'Base64url input and maximum byte length are invalid');
  }
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    fail('INVALID_ENCODING', 'Clipboard or QR payload is not valid base64url');
  }
  const estimatedLength = Math.floor((value.length * 3) / 4);
  if (estimatedLength > maxBytes) {
    fail('RESOURCE_LIMIT', 'Encoded transport payload exceeds the configured limit', {
      maximum: maxBytes,
      estimated: estimatedLength,
    });
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch (cause) {
    throw wrapError('INVALID_ENCODING', 'Transport payload could not be base64-decoded', cause);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeBase64Url(bytes) !== value) {
    fail('INVALID_ENCODING', 'Base64url input is not in canonical unpadded form');
  }
  if (bytes.byteLength > maxBytes) {
    fail('RESOURCE_LIMIT', 'Decoded transport payload exceeds the configured limit');
  }
  return bytes;
}

/** Copy bytes into an owned ArrayBuffer accepted by DOM BufferSource APIs. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
