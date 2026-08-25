// Uniswap V3 protocol config for the shared `v3Amm` on-chain discovery
// engine. All addresses below are live-verified (2026-08-25) against public
// RPCs — each curated pair resolves to a real, non-zero pool via the
// factory's own `getPool()`.
import type { V3AmmConfig } from './v3Amm'

export const UNISWAP_CONFIG: V3AmmConfig = {
  key: 'uniswap',
  label: 'Uniswap',
  dexScreenerDexId: 'uniswap',
  feeTiers: [100, 500, 3000, 10000],
  pairKeys: [
    ['WETH', 'USDC'],
    ['WETH', 'USDT'],
    ['WBTC', 'WETH'],
    ['DAI', 'USDC'],
  ],
  chains: [
    {
      slug: 'ethereum',
      label: 'Ethereum',
      chainId: 1,
      dexScreenerChainId: 'ethereum',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      tokens: {
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      },
    },
    {
      slug: 'arbitrum',
      label: 'Arbitrum',
      chainId: 42161,
      dexScreenerChainId: 'arbitrum',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      tokens: {
        WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      },
    },
    {
      slug: 'optimism',
      label: 'Optimism',
      chainId: 10,
      dexScreenerChainId: 'optimism',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      tokens: {
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      },
    },
    {
      slug: 'base',
      label: 'Base',
      chainId: 8453,
      dexScreenerChainId: 'base',
      factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      tokens: {
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
    },
    {
      slug: 'polygon',
      label: 'Polygon',
      chainId: 137,
      dexScreenerChainId: 'polygon',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      tokens: {
        WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      },
    },
  ],
  poolUrl: (chainSlug, poolAddress) => `https://app.uniswap.org/explore/pools/${chainSlug}/${poolAddress}`,
}
