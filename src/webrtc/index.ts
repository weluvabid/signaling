import { asCborMap, assertAllowedKeys, decodeCanonical, encodeCanonical } from '../core/cbor.js';
import {
  CONTENT_TYPE_WEBRTC_CANDIDATES,
  CONTENT_TYPE_WEBRTC_DESCRIPTION,
} from '../core/constants.js';
import { fail } from '../core/errors.js';
import type { EnvelopeInput, EnvelopeMetadata } from '../core/envelope.js';
import { resolveLimits, type LimitsOverride } from '../core/limits.js';

const MAX_SDP_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATES = 64;
const MAX_CANDIDATE_CHARACTERS = 4_096;
const MAX_CANDIDATE_METADATA_CHARACTERS = 256;

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function containsSdpForbiddenControls(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

export interface WebRtcDescriptionPayload {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface WebRtcCandidatesPayload {
  candidates: RTCIceCandidateInit[];
  endOfCandidates: boolean;
}

function encodeDescriptionPayload(value: WebRtcDescriptionPayload): Uint8Array {
  return encodeCanonical(
    new Map<number, unknown>([
      [0, value.type === 'offer' ? 0 : 1],
      [1, value.sdp],
    ]),
  );
}

function encodeCandidatesPayload(value: WebRtcCandidatesPayload): Uint8Array {
  const candidates = value.candidates.map(
    (candidate) =>
      new Map<number, unknown>([
        [0, candidate.candidate],
        [1, candidate.sdpMid ?? null],
        [2, candidate.sdpMLineIndex ?? null],
        [3, candidate.usernameFragment ?? null],
      ]),
  );
  return encodeCanonical(
    new Map<number, unknown>([
      [0, candidates],
      [1, value.endOfCandidates],
    ]),
  );
}

function getText(map: Map<number, unknown>, key: number, name: string): string {
  const value = map.get(key);
  if (typeof value !== 'string') {
    fail('INVALID_WEBRTC_PAYLOAD', `${name} must be text`);
  }
  return value;
}

function validateSdp(sdp: string, code: 'INVALID_ARGUMENT' | 'INVALID_WEBRTC_PAYLOAD'): void {
  if (
    sdp.length === 0 ||
    new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES ||
    containsSdpForbiddenControls(sdp)
  ) {
    fail(code, 'SDP is empty, contains invalid control characters, or exceeds the supported size');
  }
}

function validateCandidateMetadata(
  value: unknown,
  name: string,
  code: 'INVALID_ARGUMENT' | 'INVALID_WEBRTC_PAYLOAD',
): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_CANDIDATE_METADATA_CHARACTERS ||
    containsControlCharacters(value)
  ) {
    fail(code, `${name} must be null or a bounded string`);
  }
  return value;
}

export function createDescriptionPayload(
  description: RTCSessionDescriptionInit,
): WebRtcDescriptionPayload {
  if (typeof description !== 'object' || description === null) {
    fail('INVALID_ARGUMENT', 'WebRTC description must be an object');
  }
  if (description.type !== 'offer' && description.type !== 'answer') {
    fail('INVALID_ARGUMENT', 'Only complete WebRTC offer and answer descriptions are supported');
  }
  if (typeof description.sdp !== 'string') {
    fail('INVALID_ARGUMENT', 'WebRTC SDP must be text');
  }
  validateSdp(description.sdp, 'INVALID_ARGUMENT');
  return { type: description.type, sdp: description.sdp };
}

export function parseDescriptionPayload(
  payload: Uint8Array,
  options: { limits?: LimitsOverride } = {},
): WebRtcDescriptionPayload {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'WebRTC parse options must be an object');
  }
  const limits = resolveLimits(options.limits);
  const map = asCborMap(decodeCanonical(payload, limits), 'WebRTC description');
  assertAllowedKeys(map, [0, 1], [0, 1], 'WebRTC description');
  const typeCode = map.get(0);
  if (typeCode !== 0 && typeCode !== 1) {
    fail('INVALID_WEBRTC_PAYLOAD', 'WebRTC description type code is invalid');
  }
  const sdp = getText(map, 1, 'SDP');
  validateSdp(sdp, 'INVALID_WEBRTC_PAYLOAD');
  return { type: typeCode === 0 ? 'offer' : 'answer', sdp };
}

export function createDescriptionEnvelopeInput(
  sessionId: Uint8Array,
  description: RTCSessionDescriptionInit,
  options: {
    expiresAt?: number;
    inReplyTo?: Uint8Array;
    createdAt?: number;
    compression?: 'none' | 'deflate';
  } = {},
): EnvelopeInput {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'WebRTC envelope options must be an object');
  }
  const value = createDescriptionPayload(description);
  return {
    sessionId,
    kind: value.type,
    contentType: CONTENT_TYPE_WEBRTC_DESCRIPTION,
    payload: encodeDescriptionPayload(value),
    ...options,
  };
}

export function createCandidatesPayload(
  candidates: readonly (RTCIceCandidateInit | null)[],
): WebRtcCandidatesPayload {
  if (!Array.isArray(candidates)) {
    fail('INVALID_ARGUMENT', 'ICE candidates must be an array');
  }
  if (candidates.length > MAX_CANDIDATES) {
    fail('RESOURCE_LIMIT', 'Too many ICE candidates in one payload');
  }
  let endOfCandidates = false;
  const normalized: RTCIceCandidateInit[] = [];
  for (const candidate of candidates) {
    if (candidate === null) {
      endOfCandidates = true;
      continue;
    }
    if (typeof candidate !== 'object') {
      fail('INVALID_ARGUMENT', 'ICE candidate entry must be an object or null');
    }
    if (
      typeof candidate.candidate !== 'string' ||
      candidate.candidate.length > MAX_CANDIDATE_CHARACTERS ||
      containsControlCharacters(candidate.candidate)
    ) {
      fail('INVALID_ARGUMENT', 'ICE candidate string is invalid or too long');
    }
    validateCandidateMetadata(candidate.sdpMid ?? null, 'sdpMid', 'INVALID_ARGUMENT');
    validateCandidateMetadata(
      candidate.usernameFragment ?? null,
      'usernameFragment',
      'INVALID_ARGUMENT',
    );
    if (
      candidate.sdpMLineIndex !== undefined &&
      candidate.sdpMLineIndex !== null &&
      (!Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0)
    ) {
      fail('INVALID_ARGUMENT', 'ICE candidate sdpMLineIndex must be a non-negative safe integer');
    }
    if (candidate.candidate.length === 0) {
      endOfCandidates = true;
      continue;
    }
    normalized.push({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    });
  }
  return { candidates: normalized, endOfCandidates };
}

export function parseCandidatesPayload(
  payload: Uint8Array,
  options: { limits?: LimitsOverride } = {},
): WebRtcCandidatesPayload {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'WebRTC parse options must be an object');
  }
  const limits = resolveLimits(options.limits);
  const map = asCborMap(decodeCanonical(payload, limits), 'WebRTC candidates');
  assertAllowedKeys(map, [0, 1], [0, 1], 'WebRTC candidates');
  const rawCandidates = map.get(0);
  const endOfCandidates = map.get(1);
  if (
    !Array.isArray(rawCandidates) ||
    rawCandidates.length > MAX_CANDIDATES ||
    typeof endOfCandidates !== 'boolean'
  ) {
    fail('INVALID_WEBRTC_PAYLOAD', 'ICE candidate payload has an invalid shape');
  }
  const candidates = rawCandidates.map((item): RTCIceCandidateInit => {
    const candidate = asCborMap(item, 'ICE candidate');
    assertAllowedKeys(candidate, [0, 1, 2, 3], [0, 1, 2, 3], 'ICE candidate');
    const candidateLine = getText(candidate, 0, 'candidate');
    if (
      candidateLine.length === 0 ||
      candidateLine.length > MAX_CANDIDATE_CHARACTERS ||
      containsControlCharacters(candidateLine)
    ) {
      fail('INVALID_WEBRTC_PAYLOAD', 'ICE candidate string is invalid or too long');
    }
    const sdpMid = validateCandidateMetadata(candidate.get(1), 'sdpMid', 'INVALID_WEBRTC_PAYLOAD');
    const sdpMLineIndex = candidate.get(2);
    if (
      sdpMLineIndex !== null &&
      (!Number.isSafeInteger(sdpMLineIndex) || (sdpMLineIndex as number) < 0)
    ) {
      fail(
        'INVALID_WEBRTC_PAYLOAD',
        'ICE candidate sdpMLineIndex must be null or a non-negative safe integer',
      );
    }
    const usernameFragment = validateCandidateMetadata(
      candidate.get(3),
      'usernameFragment',
      'INVALID_WEBRTC_PAYLOAD',
    );
    return {
      candidate: candidateLine,
      sdpMid,
      sdpMLineIndex: sdpMLineIndex as number | null,
      usernameFragment,
    };
  });
  return { candidates, endOfCandidates };
}

export function createCandidatesEnvelopeInput(
  sessionId: Uint8Array,
  candidates: readonly (RTCIceCandidateInit | null)[],
  options: {
    expiresAt?: number;
    inReplyTo?: Uint8Array;
    createdAt?: number;
    compression?: 'none' | 'deflate';
  } = {},
): EnvelopeInput {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'WebRTC envelope options must be an object');
  }
  const value = createCandidatesPayload(candidates);
  return {
    sessionId,
    kind: 'candidate',
    contentType: CONTENT_TYPE_WEBRTC_CANDIDATES,
    payload: encodeCandidatesPayload(value),
    ...options,
  };
}

export function decodeWebRtcPayload(
  envelope: EnvelopeMetadata,
  options: { limits?: LimitsOverride } = {},
): WebRtcDescriptionPayload | WebRtcCandidatesPayload {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'WebRTC decode options must be an object');
  }
  if (typeof envelope !== 'object' || envelope === null) {
    fail('INVALID_ARGUMENT', 'Envelope metadata must be an object');
  }
  if (envelope.contentType === CONTENT_TYPE_WEBRTC_DESCRIPTION) {
    const description = parseDescriptionPayload(envelope.payload, options);
    if (envelope.kind !== description.type) {
      fail('INVALID_WEBRTC_PAYLOAD', 'Envelope kind does not match description type');
    }
    return description;
  }
  if (envelope.contentType === CONTENT_TYPE_WEBRTC_CANDIDATES) {
    if (envelope.kind !== 'candidate') {
      fail('INVALID_WEBRTC_PAYLOAD', 'Envelope kind does not match candidate payload');
    }
    return parseCandidatesPayload(envelope.payload, options);
  }
  fail('INVALID_WEBRTC_PAYLOAD', 'Envelope content type is not a supported WebRTC payload');
}

export { waitForIceGatheringComplete } from './ice.js';
