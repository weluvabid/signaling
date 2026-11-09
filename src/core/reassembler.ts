import { concatBytes, equalBytes, toHex } from './bytes.js';
import { sha256 } from './crypto.js';
import { decodeFragment } from './fragments.js';
import { fail } from './errors.js';
import { resolveLimits, type LimitsOverride, type SignalingLimits } from './limits.js';

interface TransferState {
  readonly transferId: string;
  readonly count: number;
  readonly totalLength: number;
  readonly digest: Uint8Array;
  readonly createdAt: number;
  readonly fragments: Map<number, Uint8Array>;
  receivedBytes: number;
  status: 'collecting' | 'verifying' | 'aborted' | 'expired' | 'rejected';
}

function assertTransferNotTerminated(transfer: TransferState): void {
  const status = transfer.status as TransferState['status'];
  if (status === 'expired') {
    fail('TRANSFER_EXPIRED', 'Transfer expired during digest verification');
  }
  if (status === 'aborted') {
    fail('TRANSFER_ABORTED', 'Transfer was aborted during digest verification');
  }
  if (status === 'rejected') {
    fail('TRANSFER_CONFLICT', 'Transfer was rejected during digest verification');
  }
}

export type ReassemblyResult =
  | { status: 'pending'; transferId: string; received: number; count: number }
  | { status: 'complete'; transferId: string; bytes: Uint8Array }
  | { status: 'duplicate'; transferId: string };

export interface ReassemblerOptions {
  limits?: LimitsOverride;
  now?: () => number;
}

export class FragmentReassembler {
  readonly #limits: SignalingLimits;
  readonly #now: () => number;
  readonly #transfers = new Map<string, TransferState>();
  readonly #completed = new Map<string, number>();
  #inFlightBytes = 0;
  #inFlightFragments = 0;

  constructor(options: ReassemblerOptions = {}) {
    if (typeof options !== 'object' || options === null) {
      fail('INVALID_ARGUMENT', 'Reassembler options must be an object');
    }
    if (options.now !== undefined && typeof options.now !== 'function') {
      fail('INVALID_ARGUMENT', 'Reassembler clock must be a function');
    }
    this.#limits = resolveLimits(options.limits);
    this.#now = options.now ?? Date.now;
  }

  #currentTime(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0) {
      fail('INVALID_ARGUMENT', 'Reassembler clock must return a non-negative safe integer');
    }
    return now;
  }

  get activeTransfers(): number {
    return this.#transfers.size;
  }
  get inFlightBytes(): number {
    return this.#inFlightBytes;
  }
  get inFlightFragments(): number {
    return this.#inFlightFragments;
  }

  async add(encodedFragment: Uint8Array): Promise<ReassemblyResult> {
    this.expireStale();
    const fragment = decodeFragment(encodedFragment, { limits: this.#limits });
    const id = toHex(fragment.transferId);
    if (this.#completed.has(id)) {
      return { status: 'duplicate', transferId: id };
    }
    let transfer = this.#transfers.get(id);

    if (!transfer) {
      if (this.#transfers.size >= this.#limits.maxConcurrentTransfers) {
        fail('RESOURCE_LIMIT', 'Maximum concurrent incomplete transfers reached');
      }
      transfer = {
        transferId: id,
        count: fragment.count,
        totalLength: fragment.totalLength,
        digest: fragment.transferDigest,
        createdAt: this.#currentTime(),
        fragments: new Map(),
        receivedBytes: 0,
        status: 'collecting',
      };
      this.#transfers.set(id, transfer);
    } else if (
      transfer.count !== fragment.count ||
      transfer.totalLength !== fragment.totalLength ||
      !equalBytes(transfer.digest, fragment.transferDigest)
    ) {
      this.#drop(id, 'rejected');
      fail('TRANSFER_CONFLICT', 'Fragment metadata conflicts with the existing transfer');
    }

    const existing = transfer.fragments.get(fragment.index);
    if (existing) {
      if (!equalBytes(existing, fragment.data)) {
        this.#drop(id, 'rejected');
        fail('TRANSFER_CONFLICT', 'A duplicate fragment has different content');
      }
      return {
        status: 'pending',
        transferId: id,
        received: transfer.fragments.size,
        count: transfer.count,
      };
    }
    if (transfer.status === 'verifying') {
      fail('TRANSFER_VERIFYING', 'Transfer is being verified');
    }

    if (this.#inFlightFragments + 1 > this.#limits.maxInFlightFragments) {
      this.#drop(id, 'rejected');
      fail('RESOURCE_LIMIT', 'Aggregate in-flight fragment count limit exceeded');
    }
    if (this.#inFlightBytes + fragment.data.byteLength > this.#limits.maxInFlightBytes) {
      this.#drop(id, 'rejected');
      fail('RESOURCE_LIMIT', 'Aggregate in-flight reassembly byte limit exceeded');
    }
    if (transfer.receivedBytes + fragment.data.byteLength > transfer.totalLength) {
      this.#drop(id, 'rejected');
      fail('INVALID_FRAGMENT', 'Fragment bytes exceed the declared transfer length');
    }

    transfer.fragments.set(fragment.index, fragment.data);
    transfer.receivedBytes += fragment.data.byteLength;
    this.#inFlightBytes += fragment.data.byteLength;
    this.#inFlightFragments += 1;

    if (transfer.fragments.size !== transfer.count) {
      return {
        status: 'pending',
        transferId: id,
        received: transfer.fragments.size,
        count: transfer.count,
      };
    }

    if (transfer.receivedBytes !== transfer.totalLength) {
      this.#drop(id, 'rejected');
      fail(
        'INVALID_FRAGMENT',
        'Complete fragment count does not match the declared transfer length',
        {
          expected: transfer.totalLength,
          actual: transfer.receivedBytes,
        },
      );
    }

    transfer.status = 'verifying';
    try {
      const ordered: Uint8Array[] = [];
      for (let index = 0; index < transfer.count; index += 1) {
        const chunk = transfer.fragments.get(index);
        if (!chunk) {
          fail('INVALID_FRAGMENT', 'Transfer is missing a fragment despite a complete count');
        }
        ordered.push(chunk);
      }
      const complete = concatBytes(ordered, transfer.totalLength);
      const actualDigest = await sha256(complete);
      if (this.#transfers.get(id) !== transfer) {
        assertTransferNotTerminated(transfer);
        fail('TRANSFER_ABORTED', 'Transfer was removed during digest verification');
      }
      if (!equalBytes(actualDigest, transfer.digest)) {
        fail('INVALID_INTEGRITY', 'Reassembled transfer SHA-256 digest does not match');
      }
      this.#drop(id);
      this.#completed.set(id, this.#currentTime());
      while (this.#completed.size > 256) {
        const oldest = this.#completed.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.#completed.delete(oldest);
      }
      return { status: 'complete', transferId: id, bytes: complete };
    } catch (cause) {
      assertTransferNotTerminated(transfer);
      this.#drop(id, 'rejected');
      throw cause;
    }
  }

  abort(transferId: Uint8Array | string): boolean {
    const id = typeof transferId === 'string' ? transferId.toLowerCase() : toHex(transferId);
    return this.#drop(id, 'aborted');
  }

  expireStale(): string[] {
    const cutoff = this.#currentTime() - this.#limits.transferTtlMs;
    const expired: string[] = [];
    for (const [id, completedAt] of this.#completed) {
      if (completedAt <= cutoff) {
        this.#completed.delete(id);
      }
    }
    for (const [id, transfer] of this.#transfers) {
      if (transfer.createdAt <= cutoff) {
        this.#drop(id, 'expired');
        expired.push(id);
      }
    }
    return expired;
  }

  clear(): void {
    for (const id of [...this.#transfers.keys()]) {
      this.#drop(id, 'aborted');
    }
    this.#completed.clear();
  }

  #drop(id: string, terminalState?: 'aborted' | 'expired' | 'rejected'): boolean {
    const transfer = this.#transfers.get(id);
    if (!transfer) {
      return false;
    }
    if (terminalState) {
      transfer.status = terminalState;
    }
    this.#inFlightBytes -= transfer.receivedBytes;
    this.#inFlightFragments -= transfer.fragments.size;
    this.#transfers.delete(id);
    return true;
  }
}
