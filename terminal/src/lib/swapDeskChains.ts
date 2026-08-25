// The chains wagmi carries a public client for — the intersection where a
// venue panel's "Trade" prefill can actually load a pair into the swap desk.
// Single source of truth: Aave's and Compound's panels each used to hand-roll
// their own chainId/name -> slug map and had already drifted (different
// chain sets, one keyed by id, the other by display name).
export interface SwapDeskChain {
  chainId: number
  slug: string
  name: string
}

export const SWAP_DESK_CHAINS: SwapDeskChain[] = [
  { chainId: 1, slug: 'ethereum', name: 'Ethereum' },
  { chainId: 42161, slug: 'arbitrum', name: 'Arbitrum' },
  { chainId: 10, slug: 'optimism', name: 'Optimism' },
  { chainId: 137, slug: 'polygon', name: 'Polygon' },
  { chainId: 8453, slug: 'base', name: 'Base' },
  { chainId: 43114, slug: 'avalanche', name: 'Avalanche' },
  { chainId: 56, slug: 'bsc', name: 'BSC' },
]

export function swapDeskSlugForChainId(chainId: number): string | undefined {
  return SWAP_DESK_CHAINS.find((c) => c.chainId === chainId)?.slug
}

export function swapDeskSlugForChainName(name: string): string | undefined {
  return SWAP_DESK_CHAINS.find((c) => c.name === name)?.slug
}
