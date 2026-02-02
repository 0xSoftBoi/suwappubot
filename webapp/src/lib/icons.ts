/**
 * Shared icon and color mappings for chains and tokens.
 * Centralized to avoid duplication across pages.
 */

export const chainIcons: Record<string, string> = {
  ethereum: 'Ξ',
  eth: 'Ξ',
  solana: '◎',
  sol: '◎',
  polygon: '⬡',
  matic: '⬡',
  arbitrum: '🔵',
  optimism: '🔴',
  base: '🔷',
  bsc: '🟡',
}

export const chainColors: Record<string, string> = {
  ethereum: 'bg-gray-600',
  eth: 'bg-gray-600',
  solana: 'bg-purple-500',
  sol: 'bg-purple-500',
  polygon: 'bg-indigo-500',
  matic: 'bg-indigo-500',
  arbitrum: 'bg-sky-500',
  optimism: 'bg-red-500',
  base: 'bg-blue-400',
  bsc: 'bg-yellow-500',
}

export const tokenIcons: Record<string, string> = {
  ETH: 'Ξ',
  USDC: '💵',
  USDT: '💵',
  DAI: '◇',
  MATIC: '⬡',
  BNB: '🔶',
  ARB: '🔷',
  PEPE: '🐸',
  SOL: '◎',
}

/**
 * Get an icon for a token, falling back to chain icon then first letter.
 */
export function getTokenIcon(symbolOrToken: string | { symbol: string; chain: string }): string {
  if (typeof symbolOrToken === 'string') {
    return tokenIcons[symbolOrToken.toUpperCase()] || '●'
  }

  const { symbol, chain } = symbolOrToken
  const symbolLower = symbol.toLowerCase()
  const chainLower = chain.toLowerCase()

  if (symbolLower === 'eth') return 'Ξ'
  if (symbolLower === 'sol') return '◎'
  if (symbolLower === 'usdc' || symbolLower === 'usdt') return '$'
  if (symbolLower === 'matic') return '⬡'

  return chainIcons[chainLower] || symbol.charAt(0).toUpperCase()
}

/**
 * Get the background color class for a chain.
 */
export function getChainColor(chain: string): string {
  return chainColors[chain.toLowerCase()] || 'bg-gray-400'
}
