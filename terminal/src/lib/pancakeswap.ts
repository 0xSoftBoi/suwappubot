// PancakeSwap V3 protocol config for the shared `v3Amm` on-chain discovery
// engine — PancakeSwap's own public markets API is dead (the legacy
// api.pancakeswap.info proxies to a since-shut-down thegraph.com hosted
// endpoint and 500s) with no documented public replacement, so pool
// identity comes from PancakeSwap's own V3 Factory on-chain, the same as
// Uniswap. Addresses live-verified (2026-08-25) against BSC's public RPC —
// both curated pairs resolve to real, non-zero pools, across all four fee
// tiers PancakeSwap V3 actually uses (0.01/0.05/0.25/1%, not Uniswap's
// 0.01/0.05/0.3/1%).
import type { V3AmmConfig } from './v3Amm'

export const PANCAKESWAP_CONFIG: V3AmmConfig = {
  key: 'pancakeswap',
  label: 'PancakeSwap',
  dexScreenerDexId: 'pancakeswap',
  feeTiers: [100, 500, 2500, 10000],
  pairKeys: [
    ['WBNB', 'USDT'],
    ['WBNB', 'USDC'],
  ],
  chains: [
    {
      slug: 'bsc',
      label: 'BSC',
      chainId: 56,
      dexScreenerChainId: 'bsc',
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      tokens: {
        WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        USDT: '0x55d398326f99059fF775485246999027B3197955',
        USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      },
    },
  ],
  poolUrl: (chainSlug, poolAddress) => `https://pancakeswap.finance/info/v3/${chainSlug}/pairs/${poolAddress}`,
}
