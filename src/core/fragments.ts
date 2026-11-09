import { assertBytes, copyBytes } from './bytes.js';
import { asCborMap, assertAllowedKeys, decodeCanonical, encodeCanonical } from './cbor.js';
import { randomBytes, sha256 } from './crypto.js';
import { fail } from './errors.js';
import { resolveLimits, type LimitsOverride } from './limits.js';

export interface TransferFragment {
  transferId: Uint8Array;
  index: number;
  count: number;
  totalLength: number;
  transferDigest: Uint8Array;
  data: Uint8Array;
}

export interface FragmentOptions {
  maxFragmentDataBytes?: number;
  maxFragmentCount?: number;
  limits?: LimitsOverride;
}

export async function fragmentEnvelope(
  envelope: Uint8Array,
  options: FragmentOptions = {},
): Promise<Uint8Array[]> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Fragment options must be an object');
  }
  const limits = resolveLimits(options.limits);
  assertBytes(envelope, 'envelope');
  if (envelope.byteLength === 0) {
    fail('INVALID_ARGUMENT', 'Cannot fragment an empty envelope');
  }
  if (envelope.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Envelope exceeds the configured fragmentation limit', {
      maximum: limits.maxEnvelopeBytes,
      actual: envelope.byteLength,
    });
  }
  const snapshot = copyBytes(envelope);
  const fragmentSize = options.maxFragmentDataBytes ?? limits.maxFragmentDataBytes;
  const maximumCount = options.maxFragmentCount ?? limits.maxFragmentCount;
  if (
    !Number.isSafeInteger(fragmentSize) ||
    fragmentSize < 1 ||
    fragmentSize > limits.maxFragmentDataBytes
  ) {
    fail('INVALID_ARGUMENT', 'maxFragmentDataBytes must be between 1 and the configured limit');
  }
  if (
    !Number.isSafeInteger(maximumCount) ||
    maximumCount < 1 ||
    maximumCount > limits.maxFragmentCount
  ) {
    fail('INVALID_ARGUMENT', 'maxFragmentCount must be between 1 and the configured limit');
  }

  const count = Math.ceil(snapshot.byteLength / fragmentSize);
  if (count > maximumCount) {
    fail('RESOURCE_LIMIT', 'Envelope requires more fragments than the configured maximum', {
      count,
      maximum: maximumCount,
    });
  }
  const transferId = randomBytes(16);
  const transferDigest = await sha256(snapshot);
  const output: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * fragmentSize;
    const data = snapshot.slice(start, Math.min(start + fragmentSize, snapshot.byteLength));
    output.push(
      encodeCanonical(
        new Map<number, unknown>([
          [0, 'SEF'],
          [1, 1],
          [2, transferId],
          [3, index],
          [4, count],
          [5, snapshot.byteLength],
          [6, transferDigest],
          [7, data],
        ]),
      ),
    );
  }
  return output;
}

export function decodeFragment(
  bytes: Uint8Array,
  options: { limits?: LimitsOverride } = {},
): TransferFragment {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Fragment decode options must be an object');
  }
  const limits = resolveLimits(options.limits);
  assertBytes(bytes, 'fragment', undefined, 'INVALID_FRAGMENT');
  if (bytes.byteLength === 0) {
    fail('INVALID_FRAGMENT', 'Encoded fragment is empty');
  }
  if (bytes.byteLength > limits.maxFragmentDataBytes + 256) {
    fail('RESOURCE_LIMIT', 'Encoded fragment exceeds the configured frame size');
  }
  const map = asCborMap(decodeCanonical(bytes, limits), 'fragment');
  assertAllowedKeys(map, [0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7], 'fragment');
  if (map.get(0) !== 'SEF') {
    fail('INVALID_FRAGMENT', 'Fragment magic is invalid');
  }
  const version = map.get(1);
  if (version !== 1) {
    fail('UNSUPPORTED_VERSION', 'Fragment wire version is not supported');
  }
  const transferId = map.get(2);
  const digest = map.get(6);
  const data = map.get(7);
  if (!(transferId instanceof Uint8Array) || transferId.byteLength !== 16) {
    fail('INVALID_FRAGMENT', 'transferId must contain 16 bytes');
  }
  if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
    fail('INVALID_FRAGMENT', 'transferDigest must contain 32 bytes');
  }
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength === 0 ||
    data.byteLength > limits.maxFragmentDataBytes
  ) {
    fail('RESOURCE_LIMIT', 'Fragment data is empty or exceeds the configured maximum');
  }
  const index = map.get(3);
  const count = map.get(4);
  const totalLength = map.get(5);
  if (
    ![index, count, totalLength].every(
      (value) => typeof value === 'number' && Number.isSafeInteger(value),
    )
  ) {
    fail('INVALID_FRAGMENT', 'Fragment index, count, and totalLength must be safe integers');
  }
  const i = index as number;
  const c = count as number;
  const length = totalLength as number;
  if (
    c < 1 ||
    c > limits.maxFragmentCount ||
    c > length ||
    i < 0 ||
    i >= c ||
    length < 1 ||
    length > limits.maxEnvelopeBytes
  ) {
    fail('RESOURCE_LIMIT', 'Fragment metadata is outside configured limits');
  }
  if (data.byteLength > length) {
    fail('INVALID_FRAGMENT', 'Fragment data exceeds total transfer length');
  }
  return {
    transferId: copyBytes(transferId),
    index: i,
    count: c,
    totalLength: length,
    transferDigest: copyBytes(digest),
    data: copyBytes(data),
  };
}
