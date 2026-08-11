import { formatUnits, parseUnits } from 'viem';

const WAD = 10n ** 18n;

/** Format a token amount with sensible significant digits (no scientific notation). */
export function fmt(
  value: bigint | undefined | null,
  decimals = 18,
  opts: { dp?: number; compact?: boolean } = {},
): string {
  if (value === undefined || value === null) return '—';
  const { dp, compact } = opts;
  const n = Number(formatUnits(value, decimals));
  if (!Number.isFinite(n)) return '—';
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001';
  if (compact && Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  }
  if (compact && Math.abs(n) >= 1_000) {
    return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}k`;
  }
  const maximumFractionDigits = dp ?? (Math.abs(n) >= 1 ? 4 : 6);
  return n.toLocaleString(undefined, { maximumFractionDigits });
}

/** WAD-scaled ratio (1e18 = 100%) → "12.50%" */
export function fmtPct(value: bigint | undefined | null, dp = 2): string {
  if (value === undefined || value === null) return '—';
  return `${(Number(formatUnits(value, 18)) * 100).toFixed(dp)}%`;
}

/** Per-second WAD rate → approximate nominal APR string. */
export function fmtRatePerSecondAsApr(perSecond: bigint | undefined | null, dp = 2): string {
  if (perSecond === undefined || perSecond === null) return '—';
  const yearly = perSecond * 31_536_000n; // 365d
  return `${(Number(formatUnits(yearly, 18)) * 100).toFixed(dp)}%/yr`;
}

/** Signed per-second WAD rate → e.g. "-5.00%/yr" (curve decay). */
export function fmtSignedRateApr(perSecond: bigint | undefined | null, dp = 2): string {
  if (perSecond === undefined || perSecond === null) return '—';
  const neg = perSecond < 0n;
  const mag = neg ? -perSecond : perSecond;
  const pct = Number(formatUnits(mag * 31_536_000n, 18)) * 100;
  return `${neg ? '−' : '+'}${pct.toFixed(dp)}%/yr`;
}

/** Parse user input; returns null when the string isn't a valid positive amount. */
export function parseAmount(input: string, decimals = 18): bigint | null {
  const s = input.trim();
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  try {
    const v = parseUnits(s as `${number}`, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** LTV = debt / collateralValue, as a WAD ratio. */
export function computeLtv(debt: bigint, collateralValue: bigint): bigint | null {
  if (collateralValue === 0n) return debt > 0n ? null : 0n;
  return (debt * WAD) / collateralValue;
}

export type HealthTone = 'safe' | 'warn' | 'danger';

export function healthTone(ltv: bigint | null, maxLtv: bigint, liqLtv: bigint): HealthTone {
  if (ltv === null) return 'danger';
  if (ltv >= liqLtv) return 'danger';
  if (ltv >= maxLtv) return 'warn';
  return 'safe';
}

export function shortAddress(a?: string | null): string {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function isAddressish(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

export function secondsToHuman(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
