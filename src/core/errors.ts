export type SignalingErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_ENCODING'
  | 'NON_CANONICAL_ENCODING'
  | 'INVALID_ENVELOPE'
  | 'INVALID_INTEGRITY'
  | 'UNSUPPORTED_COMPRESSION'
  | 'RESOURCE_LIMIT'
  | 'EXPIRED_MESSAGE'
  | 'INVALID_FRAGMENT'
  | 'TRANSFER_CONFLICT'
  | 'TRANSFER_VERIFYING'
  | 'TRANSFER_EXPIRED'
  | 'TRANSFER_ABORTED'
  | 'UNSUPPORTED_RUNTIME'
  | 'TRANSPORT_ERROR'
  | 'INVALID_WEBRTC_PAYLOAD';

export class SignalingError extends Error {
  readonly code: SignalingErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: SignalingErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: Record<string, string | number | boolean>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SignalingError';
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }
}

export function fail(
  code: SignalingErrorCode,
  message: string,
  details?: Record<string, string | number | boolean>,
): never {
  throw new SignalingError(code, message, details === undefined ? {} : { details });
}

export function wrapError(
  code: SignalingErrorCode,
  message: string,
  cause: unknown,
): SignalingError {
  if (cause instanceof SignalingError) {
    return cause;
  }
  return new SignalingError(code, message, { cause });
}
