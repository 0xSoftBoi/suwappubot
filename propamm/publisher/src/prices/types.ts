export const E18 = 10n ** 18n;

export interface PriceTick {
  /** quote-per-base, 1e18 fixed point */
  price: bigint;
  /** unix ms of the observation (source time where trustworthy, else receive time) */
  ts: number;
}

export interface PriceSource {
  readonly name: string;
  start(): void;
  stop(): void;
  latest(): PriceTick | null;
}

/** Parse a non-negative decimal string ("3500.12") to 1e18 bigint. No floats. */
export function parseDecimal18(s: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`bad decimal: ${s}`);
  const frac = (m[2] ?? "").slice(0, 18).padEnd(18, "0");
  return BigInt(m[1]!) * E18 + BigInt(frac);
}

/** int * 10^expo -> 1e18 fixed point. */
export function scaleExpo18(int: bigint, expo: number): bigint {
  const shift = 18 + expo;
  return shift >= 0 ? int * 10n ** BigInt(shift) : int / 10n ** BigInt(-shift);
}

export function bpsDiff(a: bigint, b: bigint): number {
  // |a-b|/b in bps as a number (display / threshold compare only; never in signing path)
  const d = a > b ? a - b : b - a;
  return Number((d * 100_000_000n) / b) / 10_000;
}
