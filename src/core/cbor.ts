// @ts-ignore -- cborg is declared as a runtime dependency; local checks run offline without node_modules.
import { decode, encode, rfc8949EncodeOptions, Tokenizer, Type } from 'cborg';
import { assertBytes, equalBytes } from './bytes.js';
import { fail, wrapError } from './errors.js';
import type { SignalingLimits } from './limits.js';

const DECODE_OPTIONS = Object.freeze({
  strict: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowNaN: false,
  allowInfinity: false,
  allowBigInt: false,
  retainStringBytes: true,
  rejectDuplicateMapKeys: true,
  useMaps: true,
});

export type CborMap = Map<number, unknown>;

interface ContainerFrame {
  remainingItems: number;
}

/**
 * Wrap cborg's tokenizer to enforce nesting and collection limits before the
 * decoder materializes arrays or maps. This is a resource guard, not a CBOR
 * parser; tokenization and CBOR syntax remain owned by cborg.
 */
function createBoundedTokenizer(
  bytes: Uint8Array,
  options: typeof DECODE_OPTIONS,
  limits: Pick<SignalingLimits, 'maxCborDepth' | 'maxCborCollectionEntries' | 'maxCborTotalItems'>,
) {
  const tokenizer = new Tokenizer(bytes, options);
  const containers: ContainerFrame[] = [];
  let totalItems = 0;
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  return {
    data: bytes,
    next() {
      while (containers.at(-1)?.remainingItems === 0) {
        containers.pop();
      }

      const token = tokenizer.next();
      totalItems += 1;
      if (totalItems > limits.maxCborTotalItems) {
        fail('RESOURCE_LIMIT', 'CBOR total item count exceeds the configured limit', {
          maximum: limits.maxCborTotalItems,
        });
      }
      if (Type.equals(token.type, Type.tag) || Type.equals(token.type, Type.float)) {
        fail('INVALID_ENCODING', 'CBOR tags and floating-point values are not permitted by SEE v1');
      }
      if (Type.equals(token.type, Type.string)) {
        if (token.byteValue !== undefined) {
          token.value = utf8.decode(token.byteValue);
        } else if (token.value !== '' || token.encodedLength !== 1) {
          fail('INVALID_ENCODING', 'CBOR text bytes were unavailable for strict UTF-8 validation');
        }
      }
      const parent = containers.at(-1);
      if (parent) {
        parent.remainingItems -= 1;
      }
      const isMap = Type.equals(token.type, Type.map);
      const isArray = Type.equals(token.type, Type.array);
      if (!isMap && !isArray) {
        return token;
      }

      const entries = token.value;
      if (!Number.isSafeInteger(entries) || (entries as number) < 0) {
        fail('INVALID_ENCODING', 'CBOR collection length is not a non-negative safe integer');
      }
      if ((entries as number) > limits.maxCborCollectionEntries) {
        fail('RESOURCE_LIMIT', 'CBOR collection exceeds the configured entry limit', {
          maximum: limits.maxCborCollectionEntries,
          actual: entries as number,
        });
      }

      const depth = containers.length + 1;
      if (depth > limits.maxCborDepth) {
        fail('RESOURCE_LIMIT', 'CBOR nesting depth exceeds the configured limit', {
          maximum: limits.maxCborDepth,
          actual: depth,
        });
      }

      const remainingItems = (entries as number) * (isMap ? 2 : 1);
      if (remainingItems > bytes.byteLength) {
        fail(
          'INVALID_ENCODING',
          'CBOR collection declares more child items than the input can contain',
        );
      }
      if (remainingItems > 0) {
        containers.push({ remainingItems });
      }
      return token;
    },
    done() {
      return tokenizer.done();
    },
    pos() {
      return tokenizer.pos();
    },
  };
}

export function encodeCanonical(value: unknown): Uint8Array {
  try {
    return encode(value, rfc8949EncodeOptions);
  } catch (cause) {
    throw wrapError('INVALID_ENCODING', 'CBOR encoding failed', cause);
  }
}

export function decodeCanonical(bytes: Uint8Array, limits: SignalingLimits): unknown {
  assertBytes(bytes, 'CBOR input', undefined, 'INVALID_ENCODING');
  if (bytes.byteLength === 0) {
    fail('INVALID_ENCODING', 'CBOR input is empty');
  }
  if (bytes.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'CBOR input exceeds the configured maximum', {
      maximum: limits.maxEnvelopeBytes,
      actual: bytes.byteLength,
    });
  }
  let value: unknown;
  let tokenizer: ReturnType<typeof createBoundedTokenizer>;
  try {
    tokenizer = createBoundedTokenizer(bytes, DECODE_OPTIONS, limits);
    value = decode(bytes, { ...DECODE_OPTIONS, tokenizer });
  } catch (cause) {
    throw wrapError('INVALID_ENCODING', 'CBOR decoding failed', cause);
  }
  if (tokenizer.pos() !== bytes.byteLength) {
    fail('INVALID_ENCODING', 'CBOR input contains trailing bytes', {
      trailingBytes: bytes.byteLength - tokenizer.pos(),
    });
  }
  const canonical = encodeCanonical(value);
  if (!equalBytes(canonical, bytes)) {
    fail('NON_CANONICAL_ENCODING', 'CBOR input is not RFC 8949 deterministic encoding');
  }
  return value;
}

export function asCborMap(value: unknown, name: string): CborMap {
  if (!(value instanceof Map)) {
    fail('INVALID_ENVELOPE', `${name} must be a CBOR map`);
  }
  for (const key of value.keys()) {
    if (!Number.isSafeInteger(key) || (key as number) < 0) {
      fail('INVALID_ENVELOPE', `${name} contains a non-integer or negative map key`);
    }
  }
  return value as CborMap;
}

export function assertAllowedKeys(
  map: CborMap,
  allowed: readonly number[],
  required: readonly number[],
  name: string,
): void {
  for (const key of map.keys()) {
    if (!allowed.includes(key)) {
      fail('INVALID_ENVELOPE', `${name} contains an unknown field`, { key });
    }
  }
  for (const key of required) {
    if (!map.has(key)) {
      fail('INVALID_ENVELOPE', `${name} is missing a required field`, { key });
    }
  }
}
