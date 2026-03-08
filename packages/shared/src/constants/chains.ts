/**
 * Chain configuration constants
 */

export interface ChainInfo {
  id: number
  key: string
  name: string
  displayName: string
  nativeToken: string
  explorerUrl: string
  type: 'evm' | 'solana'
}

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    displayName: 'Ethereum',
    nativeToken: 'ETH',
    explorerUrl: 'https://etherscan.io',
    type: 'evm',
  },
  bsc: {
    id: 56,
    key: 'bsc',
    name: 'BSC',
    displayName: 'BNB Chain',
    nativeToken: 'BNB',
    explorerUrl: 'https://bscscan.com',
    type: 'evm',
  },
  polygon: {
    id: 137,
    key: 'polygon',
    name: 'Polygon',
    displayName: 'Polygon',
    nativeToken: 'MATIC',
    explorerUrl: 'https://polygonscan.com',
    type: 'evm',
  },
  arbitrum: {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    displayName: 'Arbitrum',
    nativeToken: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    type: 'evm',
  },
  optimism: {
    id: 10,
    key: 'optimism',
    name: 'Optimism',
    displayName: 'Optimism',
    nativeToken: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    type: 'evm',
  },
  base: {
    id: 8453,
    key: 'base',
    name: 'Base',
    displayName: 'Base',
    nativeToken: 'ETH',
    explorerUrl: 'https://basescan.org',
    type: 'evm',
  },
  solana: {
    id: 0,
    key: 'solana',
    name: 'Solana',
    displayName: 'Solana',
    nativeToken: 'SOL',
    explorerUrl: 'https://solscan.io',
    type: 'solana',
  },
}

export const CHAIN_LIST = Object.values(CHAINS)

export function getChainByKey(key: string): ChainInfo | undefined {
  return CHAINS[key.toLowerCase()]
}

export function getChainById(id: number): ChainInfo | undefined {
  return CHAIN_LIST.find(c => c.id === id)
}

export function getTxUrl(chain: string, txHash: string): string {
  const info = getChainByKey(chain)
  if (!info) return ''
  if (info.type === 'solana') return `${info.explorerUrl}/tx/${txHash}`
  return `${info.explorerUrl}/tx/${txHash}`
}

export function getAddressUrl(chain: string, address: string): string {
  const info = getChainByKey(chain)
  if (!info) return ''
  if (info.type === 'solana') return `${info.explorerUrl}/account/${address}`
  return `${info.explorerUrl}/address/${address}`
}
