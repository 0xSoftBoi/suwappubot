// Orders a chain's items by summed TVL desc, so the busiest chain leads the
// picker — the same convention Curve's chain ordering uses, shared here so
// Aave and Compound don't each hand-roll the identical reducer.
export function rankChainsByTvl<T>(items: T[], chainIdOf: (item: T) => number, tvlOf: (item: T) => number): number[] {
  const tvlByChain = new Map<number, number>()
  for (const item of items) {
    const chainId = chainIdOf(item)
    tvlByChain.set(chainId, (tvlByChain.get(chainId) ?? 0) + tvlOf(item))
  }
  return [...tvlByChain.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
