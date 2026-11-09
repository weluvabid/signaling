// @ts-ignore -- qr is declared as an optional peer and a development dependency.
import encodeQR from 'qr';
// @ts-ignore -- qr/decode.js is an optional subpath of the same QR dependency.
import decodeQR from 'qr/decode.js';
import { decodeBase64Url, encodeBase64Url } from '../core/bytes.js';
import { fail, wrapError } from '../core/errors.js';
import { fragmentEnvelope, type FragmentOptions } from '../core/fragments.js';
import { resolveLimits, type LimitsOverride } from '../core/limits.js';
import { FragmentReassembler } from '../core/reassembler.js';

const PREFIX = 'SEF1:';
const MAX_IMAGE_DIMENSION = 4_096;
const MAX_IMAGE_PIXELS = 4_000_000;
const MAX_QR_FRAGMENT_BYTES = 850;
const MAX_DECODE_RETRY_BUDGET_MS = 5_000;

export interface QrFrame {
  index: number;
  count: number;
  dataUrl: string;
}

export interface QrEncodeOptions extends FragmentOptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  scale?: number;
  margin?: number;
}

export interface QrDecodeOptions {
  limits?: LimitsOverride;
  maxImagePixels?: number;
  retryBudgetMs?: number;
  decoder?: (imageData: ImageData) => string | Promise<string>;
}

const ECC_LEVELS = {
  L: 'low',
  M: 'medium',
  Q: 'quartile',
  H: 'high',
} as const;

export async function encodeQrFrames(
  envelope: Uint8Array,
  options: QrEncodeOptions = {},
): Promise<QrFrame[]> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'QR encode options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (
    options.maxFragmentDataBytes !== undefined &&
    options.maxFragmentDataBytes > MAX_QR_FRAGMENT_BYTES
  ) {
    fail('RESOURCE_LIMIT', `QR frame payload cannot exceed ${MAX_QR_FRAGMENT_BYTES} bytes`);
  }
  const level = options.errorCorrectionLevel ?? 'M';
  if (!Object.hasOwn(ECC_LEVELS, level)) {
    fail('INVALID_ARGUMENT', 'Unknown QR error-correction level');
  }
  const scale = options.scale ?? 6;
  const margin = options.margin ?? 4;
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 16) {
    fail('INVALID_ARGUMENT', 'QR scale must be an integer between 1 and 16');
  }
  if (!Number.isSafeInteger(margin) || margin < 0 || margin > 16) {
    fail('INVALID_ARGUMENT', 'QR margin must be an integer between 0 and 16');
  }
  const fragmentSize =
    options.maxFragmentDataBytes ?? Math.min(MAX_QR_FRAGMENT_BYTES, limits.maxFragmentDataBytes);
  const fragments = await fragmentEnvelope(envelope, {
    ...options,
    maxFragmentDataBytes: fragmentSize,
  });
  const frames: QrFrame[] = [];
  for (let index = 0; index < fragments.length; index += 1) {
    const text = PREFIX + encodeBase64Url(fragments[index]!);
    try {
      const svg = encodeQR(text, 'svg', {
        ecc: ECC_LEVELS[level],
        scale,
        border: margin,
      });
      if (typeof svg !== 'string' || !svg.includes('<svg')) {
        fail('TRANSPORT_ERROR', 'QR encoder returned an invalid SVG image');
      }
      frames.push({
        index,
        count: fragments.length,
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      });
    } catch (cause) {
      throw wrapError('TRANSPORT_ERROR', 'QR encoder failed to render a transfer frame', cause);
    }
  }
  return frames;
}

export async function decodeQrImage(
  image: HTMLImageElement,
  options: QrDecodeOptions = {},
): Promise<Uint8Array> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'QR decode options must be an object');
  }
  if (options.decoder !== undefined && typeof options.decoder !== 'function') {
    fail('INVALID_ARGUMENT', 'QR decoder override must be a function');
  }
  const limits = resolveLimits(options.limits);
  if (!image || image.tagName !== 'IMG') {
    fail('INVALID_ARGUMENT', 'QR input must be an HTML image element');
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  const pixels = width * height;
  const maxImagePixels = options.maxImagePixels ?? MAX_IMAGE_PIXELS;
  if (
    !Number.isSafeInteger(maxImagePixels) ||
    maxImagePixels < 1 ||
    maxImagePixels > MAX_IMAGE_PIXELS
  ) {
    fail('INVALID_ARGUMENT', `maxImagePixels must be between 1 and ${MAX_IMAGE_PIXELS}`);
  }
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    pixels > maxImagePixels
  ) {
    fail('RESOURCE_LIMIT', 'QR image dimensions exceed the configured image limits', {
      width,
      height,
      pixels,
    });
  }
  const retryBudgetMs = options.retryBudgetMs ?? 500;
  if (
    !Number.isSafeInteger(retryBudgetMs) ||
    retryBudgetMs < 1 ||
    retryBudgetMs > MAX_DECODE_RETRY_BUDGET_MS
  ) {
    fail('INVALID_ARGUMENT', `retryBudgetMs must be between 1 and ${MAX_DECODE_RETRY_BUDGET_MS}`);
  }

  if (!image.ownerDocument) {
    fail('INVALID_ARGUMENT', 'QR image has no owning document');
  }
  const canvas = image.ownerDocument.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let text: string;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      fail('UNSUPPORTED_RUNTIME', 'Canvas 2D context is unavailable for QR decoding');
    }
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    text = options.decoder
      ? await options.decoder(imageData)
      : decodeQR(imageData, { effort: Number.POSITIVE_INFINITY, timeLimit: retryBudgetMs });
  } catch (cause) {
    throw wrapError(
      'INVALID_ENCODING',
      'No decodable QR code was found in the supplied image',
      cause,
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  if (typeof text !== 'string') {
    fail('INVALID_ENCODING', 'QR decoder did not return text');
  }
  if (!text.startsWith(PREFIX)) {
    fail('INVALID_ENCODING', 'QR code does not contain a supported SEE fragment');
  }
  return decodeBase64Url(
    text.slice(PREFIX.length),
    Math.min(limits.maxFragmentDataBytes, MAX_QR_FRAGMENT_BYTES) + 256,
  );
}

export async function reassembleQrFrames(
  images: readonly HTMLImageElement[],
  options: QrDecodeOptions = {},
): Promise<Uint8Array> {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_ARGUMENT', 'QR reassembly options must be an object');
  }
  const limits = resolveLimits(options.limits);
  if (!Array.isArray(images) || images.length === 0) {
    fail('INVALID_ARGUMENT', 'QR image set must be a non-empty array');
  }
  if (images.length > limits.maxFragmentCount) {
    fail('RESOURCE_LIMIT', 'QR image set exceeds the configured fragment count', {
      maximum: limits.maxFragmentCount,
      actual: images.length,
    });
  }
  const reassembler = new FragmentReassembler({ limits });
  let complete: Uint8Array | undefined;
  for (const image of images) {
    if (complete) {
      fail('INVALID_FRAGMENT', 'QR input contains frames after a complete transfer');
    }
    const encoded = await decodeQrImage(image, options);
    const result = await reassembler.add(encoded);
    if (result.status === 'complete') {
      complete = result.bytes;
    }
  }
  if (!complete) {
    fail('INVALID_FRAGMENT', 'QR image set is incomplete', {
      activeTransfers: reassembler.activeTransfers,
    });
  }
  return complete;
}
