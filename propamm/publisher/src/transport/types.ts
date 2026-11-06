import type { Hex } from "viem";

export interface OutgoingQuote {
  raw: Hex; // signed raw tx
  hash: Hex;
  blockNumber: bigint; // block the quote targets (head+1)
}

export interface Transport {
  readonly name: string;
  /** Fire a quote. Must not block on acks. Resolves false if it was dropped (e.g. socket down). */
  send(q: OutgoingQuote): Promise<boolean>;
  /** Withdraw every outstanding quote (Titan: empty tx, same uuid, higher seq). Idempotent. */
  cancel(reason: string, blockNumber: bigint | null, opts?: { final?: boolean }): Promise<void>;
  /** Lift a non-final cancel latch (prices recovered). Never lifts a final (halt) latch. */
  rearm?(): void;
  /** Do not send quotes for target blocks <= this value (set after a reconnect). */
  quietThroughBlock?(): bigint;
  connected(): boolean;
  close(): Promise<void>;
}
