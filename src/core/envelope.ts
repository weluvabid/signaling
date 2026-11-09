import { assertBytes, copyBytes, equalBytes } from './bytes.js';
import { compressDeflate, decompressDeflate } from './compression.js';
import { randomBytes, sha256 } from './crypto.js';
import { asCborMap, assertAllowedKeys, encodeCanonical, decodeCanonical } from './cbor.js';
import { fail, SignalingError } from './errors.js';
import {
  CONTENT_TYPE_WEBRTC_CANDIDATES,
  CONTENT_TYPE_WEBRTC_DESCRIPTION,
  ENVELOPE_VERSION,
} from './constants.js';
export { CONTENT_TYPE_WEBRTC_CANDIDATES, CONTENT_TYPE_WEBRTC_DESCRIPTION, ENVELOPE_VERSION };
import { resolveLimits, type LimitsOverride } from './limits.js';

export type MessageKind = 'offer' | 'answer' | 'candidate' | 'custom';
export type MessageKindCode = 0 | 1 | 2 | 3;

const KIND_TO_CODE: Record<MessageKind, MessageKindCode> = {
  offer: 0,
  answer: 1,
  candidate: 2,
  custom: 3,
};
const CODE_TO_KIND: Record<MessageKindCode, MessageKind> = {
  0: 'offer',
  1: 'answer',
  2: 'candidate',
  3: 'custom',
};

export interface EnvelopeInput {
  sessionId?: Uint8Array;
  messageId?: Uint8Array;
  kind: MessageKind;
  createdAt?: number;
  expiresAt?: number;
  inReplyTo?: Uint8Array;
  contentType: string;
  payload: Uint8Array;
  compression?: 'none' | 'deflate';
}

export interface EnvelopeMetadata {
  version: 1;
  sessionId: Uint8Array;
  messageId: Uint8Array;
  kind: MessageKind;
  createdAt: number;
  expiresAt?: number;
  inReplyTo?: Uint8Array;
  contentType: string;
  compression: 'none' | 'deflate';
  originalLength: number;
  payload: Uint8Array;
}

export interface DecodeEnvelopeOptions {
  limits?: LimitsOverride;
  now?: () => number;
  allowExpired?: boolean;
}

function validateTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_ENVELOPE', `${name} must be a non-negative safe integer`);
  }
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function validateContentType(value: string): void {
  if (typeof value !== 'string') {
    fail('INVALID_ENVELOPE', 'contentType must be text');
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength < 1 || byteLength > 128 || containsControlCharacters(value)) {
    fail('INVALID_ENVELOPE', 'contentType must be 1–128 UTF-8 bytes without control characters');
  }
}

function createBaseMap(input: {
  sessionId: Uint8Array;
  messageId: Uint8Array;
  kind: MessageKind;
  createdAt: number;
  expiresAt?: number | undefined;
  inReplyTo?: Uint8Array | undefined;
  contentType: string;
  compression: 0 | 1;
  originalLength: number;
  data: Uint8Array;
}): Map<number, unknown> {
  const map = new Map<number, unknown>([
    [0, 'SEE'],
    [1, ENVELOPE_VERSION],
    [2, input.sessionId],
    [3, input.messageId],
    [4, KIND_TO_CODE[input.kind]],
    [5, input.createdAt],
  ]);
  if (input.expiresAt !== undefined) {
    map.set(6, input.expiresAt);
  }
  if (input.inReplyTo !== undefined) {
    map.set(7, input.inReplyTo);
  }
  map.set(8, input.contentType);
  map.set(9, input.compression);
  map.set(10, input.originalLength);
  map.set(11, input.data);
  return map;
}

export async function encodeEnvelope(
  input: EnvelopeInput,
  options: { limits?: LimitsOverride } = {},
): Promise<Uint8Array> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Encode options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (typeof input !== 'object' || input === null) {
    fail('INVALID_ARGUMENT', 'Envelope input must be an object');
  }
  if (!Object.hasOwn(KIND_TO_CODE, input.kind)) {
    fail('INVALID_ARGUMENT', 'Unknown message kind');
  }
  if (
    input.compression !== undefined &&
    input.compression !== 'none' &&
    input.compression !== 'deflate'
  ) {
    fail('INVALID_ARGUMENT', 'Unknown compression selection');
  }
  assertBytes(input.payload, 'payload');
  if (input.payload.byteLength > limits.maxDecompressedBytes) {
    fail('RESOURCE_LIMIT', 'Payload exceeds the configured maximum', {
      maximum: limits.maxDecompressedBytes,
    });
  }
  validateContentType(input.contentType);
  const createdAt = input.createdAt ?? Date.now();
  validateTimestamp(createdAt, 'createdAt');
  if (input.expiresAt !== undefined) {
    validateTimestamp(input.expiresAt, 'expiresAt');
    if (input.expiresAt <= createdAt) {
      fail('INVALID_ARGUMENT', 'expiresAt must be later than createdAt');
    }
    if (input.expiresAt - createdAt > limits.maxMessageLifetimeMs) {
      fail('INVALID_ARGUMENT', 'expiresAt exceeds the configured maximum message lifetime');
    }
  }
  if (input.inReplyTo !== undefined) {
    assertBytes(input.inReplyTo, 'inReplyTo', 16);
  }

  if (input.sessionId !== undefined) {
    assertBytes(input.sessionId, 'sessionId', 16);
  }
  if (input.messageId !== undefined) {
    assertBytes(input.messageId, 'messageId', 16);
  }
  const sessionId = input.sessionId === undefined ? randomBytes(16) : copyBytes(input.sessionId);
  const messageId = input.messageId === undefined ? randomBytes(16) : copyBytes(input.messageId);
  const originalPayload = copyBytes(input.payload);

  let data = originalPayload;
  let compression: 0 | 1 = 0;
  // A small prefix probe avoids spending O(n) compression work on payloads
  // that are effectively incompressible. Small messages skip compression
  // entirely because stream setup and envelope metadata dominate their size.
  const compressionProbeBytes = 1_024;
  const minimumCompressionInputBytes = 4_096;
  const minimumProbeSavingsRatio = 0.1;
  if (
    input.compression === 'deflate' &&
    originalPayload.byteLength >= minimumCompressionInputBytes
  ) {
    const probe = originalPayload.subarray(0, compressionProbeBytes);
    let shouldCompress = false;
    try {
      const compressedProbe = await compressDeflate(probe, probe.byteLength);
      shouldCompress =
        compressedProbe.byteLength <= probe.byteLength * (1 - minimumProbeSavingsRatio);
    } catch (error) {
      if (!(error instanceof SignalingError) || error.code !== 'RESOURCE_LIMIT') {
        throw error;
      }
    }
    let compressed: Uint8Array | undefined;
    if (shouldCompress) {
      try {
        compressed = await compressDeflate(
          originalPayload,
          Math.min(limits.maxEnvelopeBytes, originalPayload.byteLength),
        );
      } catch (error) {
        if (!(error instanceof SignalingError) || error.code !== 'RESOURCE_LIMIT') {
          throw error;
        }
      }
    }
    const uncompressedMap = createBaseMap({
      sessionId,
      messageId,
      kind: input.kind,
      createdAt,
      expiresAt: input.expiresAt,
      inReplyTo: input.inReplyTo,
      contentType: input.contentType,
      compression: 0,
      originalLength: originalPayload.byteLength,
      data,
    });
    if (compressed !== undefined) {
      const compressedMap = createBaseMap({
        sessionId,
        messageId,
        kind: input.kind,
        createdAt,
        expiresAt: input.expiresAt,
        inReplyTo: input.inReplyTo,
        contentType: input.contentType,
        compression: 1,
        originalLength: originalPayload.byteLength,
        data: compressed,
      });
      if (encodeCanonical(compressedMap).byteLength < encodeCanonical(uncompressedMap).byteLength) {
        data = compressed;
        compression = 1;
      }
    }
  }

  const base = createBaseMap({
    sessionId,
    messageId,
    kind: input.kind,
    createdAt,
    expiresAt: input.expiresAt,
    inReplyTo: input.inReplyTo,
    contentType: input.contentType,
    compression,
    originalLength: originalPayload.byteLength,
    data,
  });
  const digest = await sha256(encodeCanonical(base));
  base.set(
    12,
    new Map<number, unknown>([
      [0, 1],
      [1, digest],
    ]),
  );
  const encoded = encodeCanonical(base);
  if (encoded.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Serialized envelope exceeds the configured maximum', {
      maximum: limits.maxEnvelopeBytes,
      actual: encoded.byteLength,
    });
  }
  return encoded;
}

function getNumber(map: Map<number, unknown>, key: number, name: string): number {
  const value = map.get(key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_ENVELOPE', `${name} must be a non-negative safe integer`, { key });
  }
  return value;
}

function getBytes(
  map: Map<number, unknown>,
  key: number,
  name: string,
  length?: number,
): Uint8Array {
  const value = map.get(key);
  assertBytes(value, name, length, 'INVALID_ENVELOPE');
  return value;
}

export async function decodeEnvelope(
  bytes: Uint8Array,
  options: DecodeEnvelopeOptions = {},
): Promise<EnvelopeMetadata> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'Decode options must be an object');
  }
  if (options.allowExpired !== undefined && typeof options.allowExpired !== 'boolean') {
    fail('INVALID_ARGUMENT', 'allowExpired must be a boolean');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    fail('INVALID_ARGUMENT', 'now must be a clock function');
  }
  const limits = resolveLimits(options.limits);
  assertBytes(bytes, 'envelope', undefined, 'INVALID_ENVELOPE');
  if (bytes.byteLength === 0) {
    fail('INVALID_ENVELOPE', 'Envelope is empty');
  }
  if (bytes.byteLength > limits.maxEnvelopeBytes) {
    fail('RESOURCE_LIMIT', 'Envelope exceeds the configured maximum', {
      maximum: limits.maxEnvelopeBytes,
      actual: bytes.byteLength,
    });
  }
  const inputBytes = copyBytes(bytes);
  const decoded = asCborMap(decodeCanonical(inputBytes, limits), 'envelope');
  assertAllowedKeys(
    decoded,
    Array.from({ length: 13 }, (_, index) => index),
    [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12],
    'envelope',
  );
  if (decoded.get(0) !== 'SEE') {
    fail('INVALID_ENVELOPE', 'Envelope magic is invalid');
  }
  if (getNumber(decoded, 1, 'version') !== ENVELOPE_VERSION) {
    fail('UNSUPPORTED_VERSION', 'Envelope wire version is not supported');
  }

  const sessionId = getBytes(decoded, 2, 'sessionId', 16);
  const messageId = getBytes(decoded, 3, 'messageId', 16);
  const kindCode = getNumber(decoded, 4, 'kind');
  if (!(kindCode in CODE_TO_KIND)) {
    fail('INVALID_ENVELOPE', 'Envelope message kind is unknown');
  }
  const createdAt = getNumber(decoded, 5, 'createdAt');
  const expiresAt = decoded.has(6) ? getNumber(decoded, 6, 'expiresAt') : undefined;
  if (expiresAt !== undefined && expiresAt <= createdAt) {
    fail('INVALID_ENVELOPE', 'expiresAt must be later than createdAt');
  }
  const inReplyTo = decoded.has(7) ? getBytes(decoded, 7, 'inReplyTo', 16) : undefined;
  const contentType = decoded.get(8);
  if (typeof contentType !== 'string') {
    fail('INVALID_ENVELOPE', 'contentType must be text');
  }
  validateContentType(contentType);
  const compressionCode = getNumber(decoded, 9, 'compression');
  if (compressionCode !== 0 && compressionCode !== 1) {
    fail('UNSUPPORTED_COMPRESSION', 'Compression algorithm is not supported');
  }
  const originalLength = getNumber(decoded, 10, 'originalLength');
  if (originalLength > limits.maxDecompressedBytes) {
    fail('RESOURCE_LIMIT', 'Advertised payload length exceeds the configured maximum', {
      maximum: limits.maxDecompressedBytes,
      actual: originalLength,
    });
  }
  const data = getBytes(decoded, 11, 'data');
  const integrity = asCborMap(decoded.get(12), 'integrity');
  assertAllowedKeys(integrity, [0, 1], [0, 1], 'integrity');
  if (getNumber(integrity, 0, 'integrity.algorithm') !== 1) {
    fail('INVALID_INTEGRITY', 'Integrity algorithm is not supported');
  }
  const receivedDigest = getBytes(integrity, 1, 'integrity.digest', 32);
  const preimage = new Map(decoded);
  preimage.delete(12);
  const now = (options.now ?? Date.now)();
  validateTimestamp(now, 'clock');
  if (createdAt - now > limits.maxClockSkewMs) {
    fail('INVALID_ENVELOPE', 'Envelope creation time is too far in the future');
  }
  if (expiresAt !== undefined) {
    if (expiresAt - createdAt > limits.maxMessageLifetimeMs) {
      fail('INVALID_ENVELOPE', 'Envelope lifetime exceeds the configured maximum');
    }
    if (!options.allowExpired && now - limits.maxClockSkewMs > expiresAt) {
      fail('EXPIRED_MESSAGE', 'Envelope has expired');
    }
  }

  const expectedDigest = await sha256(encodeCanonical(preimage));
  if (!equalBytes(receivedDigest, expectedDigest)) {
    fail('INVALID_INTEGRITY', 'Envelope SHA-256 digest does not match');
  }

  if (compressionCode === 0 && data.byteLength !== originalLength) {
    fail('INVALID_ENVELOPE', 'Uncompressed payload length does not match originalLength');
  }
  const payload =
    compressionCode === 0
      ? copyBytes(data)
      : await decompressDeflate(data, originalLength, limits.maxDecompressedBytes);

  return {
    version: 1,
    sessionId: copyBytes(sessionId),
    messageId: copyBytes(messageId),
    kind: CODE_TO_KIND[kindCode as MessageKindCode],
    createdAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(inReplyTo === undefined ? {} : { inReplyTo: copyBytes(inReplyTo) }),
    contentType,
    compression: compressionCode === 0 ? 'none' : 'deflate',
    originalLength,
    payload,
  };
}
