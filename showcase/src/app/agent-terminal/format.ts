/**
 * Shared display formatting for the desk and its instruments. One source of
 * truth for money, token amounts, durations and hop chain labels, so the
 * dossier, the quote table, the activity log and the receipt can never
 * disagree about the same value.
 */

/** Parse a possibly-stringly number; null when it isn't one. */
export const num = (v: string | number | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v ?? Number.NaN);
  return Number.isFinite(n) ? n : null;
};

export function fmtAmount(value: string | null | undefined): string {
  const n = Number.parseFloat(value ?? '');
  if (!Number.isFinite(n)) return value ?? '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function fmtUsd(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return n >= 1000
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: n < 1 ? 4 : 2,
      })}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  if (seconds <= 0) return '<1s';
  return seconds < 90 ? `${Math.round(seconds)}s` : `~${Math.round(seconds / 60)} min`;
}

/** What a route leg does, in one word: a Li.Fi 'cross' step is a relay. */
export const hopVerb = (type: string): string =>
  type === 'cross' ? 'relay' : type === 'swap' ? 'swap' : type;

/** 'base → arbitrum' when a hop crosses chains, else the chain itself. */
export const hopChainLabel = (
  fromChain: string | null | undefined,
  toChain: string | null | undefined,
): string =>
  fromChain && toChain && fromChain !== toChain
    ? `${fromChain} → ${toChain}`
    : (fromChain ?? '');
