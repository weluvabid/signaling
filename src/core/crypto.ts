import { fail, wrapError } from './errors.js';
import { toArrayBuffer } from './bytes.js';

function webCrypto(): Crypto {
  const provider = globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== 'function') {
    fail('UNSUPPORTED_RUNTIME', 'Web Crypto is required for secure identifiers and SHA-256');
  }
  return provider;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 65_536) {
    fail('INVALID_ARGUMENT', 'Random byte length must be between 1 and 65536');
  }
  const bytes = new Uint8Array(length);
  try {
    webCrypto().getRandomValues(bytes);
  } catch (cause) {
    throw wrapError('UNSUPPORTED_RUNTIME', 'Secure random generation failed', cause);
  }
  return bytes;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const digest = await webCrypto().subtle.digest('SHA-256', toArrayBuffer(bytes));
    return new Uint8Array(digest);
  } catch (cause) {
    throw wrapError('INVALID_INTEGRITY', 'SHA-256 digest operation failed', cause);
  }
}
