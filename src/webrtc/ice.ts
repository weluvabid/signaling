import { fail, SignalingError } from '../core/errors.js';

const MAX_ICE_GATHERING_TIMEOUT_MS = 10 * 60_000;

export function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'ICE gathering options must be an object');
  }
  if (
    options.signal !== undefined &&
    (typeof options.signal !== 'object' ||
      options.signal === null ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
  ) {
    fail('INVALID_ARGUMENT', 'ICE gathering signal must be an AbortSignal');
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_ICE_GATHERING_TIMEOUT_MS
  ) {
    fail(
      'INVALID_ARGUMENT',
      `ICE gathering timeout must be between 1 and ${MAX_ICE_GATHERING_TIMEOUT_MS} milliseconds`,
    );
  }
  if (options.signal?.aborted) {
    return Promise.reject(
      new SignalingError('TRANSPORT_ERROR', 'ICE gathering was aborted', {
        cause: options.signal.reason ?? new DOMException('Operation aborted', 'AbortError'),
      }),
    );
  }
  if (
    typeof peerConnection !== 'object' ||
    peerConnection === null ||
    typeof peerConnection.addEventListener !== 'function' ||
    typeof peerConnection.removeEventListener !== 'function'
  ) {
    fail('INVALID_ARGUMENT', 'peerConnection must be an RTCPeerConnection-like object');
  }
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onStateChange = (): void => {
      if (peerConnection.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const onAbort = (): void => {
      cleanup();
      reject(
        new SignalingError('TRANSPORT_ERROR', 'ICE gathering was aborted', {
          cause: options.signal?.reason ?? new DOMException('Operation aborted', 'AbortError'),
        }),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new SignalingError(
          'TRANSPORT_ERROR',
          `ICE gathering did not complete within ${timeoutMs}ms`,
          {
            cause: new DOMException('ICE gathering timed out', 'TimeoutError'),
          },
        ),
      );
    }, timeoutMs);
    peerConnection.addEventListener('icegatheringstatechange', onStateChange);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    onStateChange();
  });
}
