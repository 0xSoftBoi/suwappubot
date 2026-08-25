// Compact USD / percent formatters shared by the venue panels (Curve, Lido,
// Aave, Balancer, Compound, the v3Amm-based Uniswap/PancakeSwap panels).
// Not the same convention as `marketDataFormat.ts`'s `formatCompactUsd` —
// that one is scoped to the proprietary market-data store panel (uppercase
// B/M/K, nullable string input); this one matches what Curve's panel has
// used since it shipped (lowercase t/b/m/k, plain number input).

export function compactUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}t`
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}b`
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(2)}m`
  if (magnitude >= 1e3) return `${sign}$${(magnitude / 1e3).toFixed(2)}k`
  if (magnitude === 0) return '$0'
  return `${sign}$${magnitude.toFixed(2)}`
}

export function percent(value: number): string {
  return `${value.toFixed(2)}%`
}
