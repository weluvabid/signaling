import { fail } from './errors.js';

export const HARD_LIMITS = Object.freeze({
  maxEnvelopeBytes: 16 * 1024 * 1024,
  maxFragmentCount: 16_384,
  maxFragmentDataBytes: 64 * 1024,
  maxDecompressedBytes: 16 * 1024 * 1024,
  maxCborDepth: 32,
  maxCborCollectionEntries: 256,
  maxCborTotalItems: 250_000,
  maxConcurrentTransfers: 64,
  maxInFlightFragments: 65_536,
  maxInFlightBytes: 64 * 1024 * 1024,
  transferTtlMs: 60 * 60 * 1_000,
  maxMessageLifetimeMs: 7 * 24 * 60 * 60 * 1_000,
  maxClockSkewMs: 10 * 60 * 1_000,
});

export interface SignalingLimits {
  maxEnvelopeBytes: number;
  maxFragmentCount: number;
  maxFragmentDataBytes: number;
  maxConcurrentTransfers: number;
  maxInFlightFragments: number;
  maxInFlightBytes: number;
  transferTtlMs: number;
  maxDecompressedBytes: number;
  maxCborDepth: number;
  maxCborCollectionEntries: number;
  maxCborTotalItems: number;
  maxMessageLifetimeMs: number;
  maxClockSkewMs: number;
}

export const DEFAULT_LIMITS: Readonly<SignalingLimits> = Object.freeze({
  maxEnvelopeBytes: 4 * 1024 * 1024,
  maxFragmentCount: 1_024,
  maxFragmentDataBytes: 16 * 1024,
  maxConcurrentTransfers: 4,
  maxInFlightFragments: 4_096,
  maxInFlightBytes: 8 * 1024 * 1024,
  transferTtlMs: 5 * 60 * 1_000,
  maxDecompressedBytes: 4 * 1024 * 1024,
  maxCborDepth: 8,
  maxCborCollectionEntries: 64,
  maxCborTotalItems: 50_000,
  maxMessageLifetimeMs: 24 * 60 * 60 * 1_000,
  maxClockSkewMs: 5 * 60 * 1_000,
});

export type LimitsOverride = Partial<SignalingLimits>;

export function resolveLimits(overrides: LimitsOverride = {}): SignalingLimits {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    fail('INVALID_ARGUMENT', 'Limits override must be a plain object');
  }
  const allowedKeys = new Set(Object.keys(DEFAULT_LIMITS));
  for (const key of Object.keys(overrides)) {
    if (!allowedKeys.has(key)) {
      fail('INVALID_ARGUMENT', `Unknown limit override: ${key}`);
    }
  }
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail('INVALID_ARGUMENT', `Limit ${key} must be a positive safe integer`, {
        limit: key,
      });
    }
  }

  for (const key of [
    'maxEnvelopeBytes',
    'maxFragmentCount',
    'maxFragmentDataBytes',
    'maxDecompressedBytes',
    'maxCborDepth',
    'maxCborCollectionEntries',
    'maxCborTotalItems',
    'maxConcurrentTransfers',
    'maxInFlightFragments',
    'maxInFlightBytes',
    'transferTtlMs',
    'maxMessageLifetimeMs',
    'maxClockSkewMs',
  ] as const) {
    if (limits[key] > HARD_LIMITS[key]) {
      fail('RESOURCE_LIMIT', `Limit ${key} exceeds the protocol hard ceiling`, {
        limit: key,
        maximum: HARD_LIMITS[key],
      });
    }
  }

  if (limits.maxInFlightBytes < limits.maxFragmentDataBytes) {
    fail('INVALID_ARGUMENT', 'maxInFlightBytes must be at least maxFragmentDataBytes');
  }
  return Object.freeze(limits);
}
