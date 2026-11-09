import { decodeBase64Url, encodeBase64Url } from '../core/bytes.js';
import { fail, wrapError } from '../core/errors.js';
import { resolveLimits, type LimitsOverride } from '../core/limits.js';

const PREFIX = 'SEE1:';

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

export function encodeClipboardText(
  envelope: Uint8Array,
  options: { limits?: LimitsOverride } = {},
): string {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Clipboard encode options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (!(envelope instanceof Uint8Array) || envelope.byteLength === 0) {
    fail('INVALID_ARGUMENT', 'Clipboard envelope must be a non-empty Uint8Array');
  }
  if (envelope.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Envelope cannot be represented within clipboard limits', {
      maximum: limits.maxEnvelopeBytes,
      actual: envelope.byteLength,
    });
  }
  return PREFIX + encodeBase64Url(envelope);
}

export function decodeClipboardText(
  text: string,
  options: { limits?: LimitsOverride } = {},
): Uint8Array {
  if (typeof text !== 'string') {
    fail('INVALID_ARGUMENT', 'Clipboard text must be a string');
  }
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Clipboard decode options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) {
    fail('INVALID_ENCODING', 'Clipboard content does not contain a supported SEE envelope');
  }
  return decodeBase64Url(text.slice(PREFIX.length), limits.maxEnvelopeBytes);
}

export async function writeClipboard(
  clipboard: ClipboardPort,
  envelope: Uint8Array,
  options: { limits?: LimitsOverride } = {},
): Promise<void> {
  if (
    typeof clipboard !== 'object' ||
    clipboard === null ||
    typeof clipboard.writeText !== 'function'
  ) {
    fail('INVALID_ARGUMENT', 'Clipboard port must implement writeText');
  }
  const text = encodeClipboardText(envelope, options);
  try {
    await clipboard.writeText(text);
  } catch (cause) {
    throw wrapError('TRANSPORT_ERROR', 'Could not write signaling data to the clipboard', cause);
  }
}

export async function readClipboard(
  clipboard: ClipboardPort,
  options: { limits?: LimitsOverride } = {},
): Promise<Uint8Array> {
  if (
    typeof clipboard !== 'object' ||
    clipboard === null ||
    typeof clipboard.readText !== 'function'
  ) {
    fail('INVALID_ARGUMENT', 'Clipboard port must implement readText');
  }
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Clipboard read options must be an object');
  }
  let text: string;
  try {
    text = await clipboard.readText();
  } catch (cause) {
    throw wrapError('TRANSPORT_ERROR', 'Could not read signaling data from the clipboard', cause);
  }
  return decodeClipboardText(text, options);
}
