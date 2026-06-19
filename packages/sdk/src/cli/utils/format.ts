/**
 * Display formatters for the CLI. All accept `string | number` so they can
 * be fed either raw API strings or computed numbers.
 */

function toNumber(value: string | number): number {
  if (typeof value === "number") return value;
  // Strip currency symbols / commas / percent signs before parsing.
  const cleaned = value.replace(/[$,%\s]/g, "");
  return parseFloat(cleaned);
}

export function formatUsd(value: string | number): string {
  const n = toNumber(value);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n !== 0 && Math.abs(n) < 0.01 ? 6 : 2,
  });
}

export function formatPercent(value: string | number): string {
  const n = toNumber(value);
  if (Number.isNaN(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatAmount(value: string | number): string {
  const n = toNumber(value);
  if (Number.isNaN(n)) return String(value);
  const decimals = Math.abs(n) > 0 && Math.abs(n) < 1 ? 6 : 4;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatSeconds(value: string | number): string {
  const n = toNumber(value);
  if (Number.isNaN(n) || n <= 0) return "-";
  if (n < 60) return `${Math.round(n)}s`;
  const minutes = Math.floor(n / 60);
  const seconds = Math.round(n % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
