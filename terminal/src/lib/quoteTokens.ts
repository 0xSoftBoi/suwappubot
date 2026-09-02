import type { SwapToken } from '../types/api'

// Canonical USDC contract per chain, used as the default quote token when a user
// picks a base token from a list (watchlist, pulse feed, search) that doesn't
// carry a pair. Addresses mirror bot/config/tokens.py — keep them in sync.
// USDC is 6 decimals everywhere except BSC, where the BEP-20 bridge uses 18.
const USDC: Record<string, { address: string; decimals: number }> = {
  ethereum: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  arbitrum: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  base: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  optimism: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  polygon: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  bsc: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  avalanche: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
  solana: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
}

// Canonical EIP-55 native-coin placeholder (40 hex chars). This constant used
// to be two characters short, so every chain switch produced a pair whose
// native leg python-api rejected ("Unsupported token … on base") and whose
// chart could not resolve — the desk looked dead on any chain but Ethereum.
export const EVM_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const NATIVE: Record<string, { symbol: string; name: string; address: string; decimals: number }> = {
  ethereum: { symbol: 'ETH', name: 'Ethereum', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  arbitrum: { symbol: 'ETH', name: 'Ethereum', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  base: { symbol: 'ETH', name: 'Ethereum', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  optimism: { symbol: 'ETH', name: 'Ethereum', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  polygon: { symbol: 'POL', name: 'POL', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  bsc: { symbol: 'BNB', name: 'BNB', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  avalanche: { symbol: 'AVAX', name: 'Avalanche', address: EVM_NATIVE_ADDRESS, decimals: 18 },
  solana: {
    symbol: 'SOL',
    name: 'Solana',
    address: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
}

/**
 * Build the canonical USDC quote token for a chain. Falls back to the Ethereum
 * USDC contract for unknown chains so the UI never renders a broken pair.
 */
export function usdcFor(chain: string): SwapToken {
  const entry = USDC[chain] ?? USDC.ethereum
  return {
    symbol: 'USDC',
    name: 'USD Coin',
    address: entry.address,
    chain,
    decimals: entry.decimals,
  }
}

/** Build the chain's canonical native-token leg for a fresh pair. */
export function nativeTokenFor(chain: string): SwapToken {
  const entry = NATIVE[chain] ?? NATIVE.ethereum
  return { ...entry, chain }
}

/**
 * Build a base/quote pair from a single token, quoting it against the chain's
 * USDC. Used by every "click a token to trade it" surface so the chart, order
 * book and swap panel all load the same token.
 */
export function pairFromToken(token: SwapToken): { base: SwapToken; quote: SwapToken } {
  return { base: token, quote: usdcFor(token.chain) }
}
