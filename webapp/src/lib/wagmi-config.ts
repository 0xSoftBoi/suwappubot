/**
 * Wagmi configuration with MetaMask support.
 */

import { http, createConfig, createStorage } from 'wagmi'
import { mainnet, polygon, arbitrum, optimism, base, bsc, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Supported chains
export const supportedChains = [
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc,
  sepolia,
] as const

// Chain metadata for UI
export const chainMeta: Record<number, { icon: string; color: string; name: string }> = {
  1: { icon: 'Ξ', color: 'bg-blue-500', name: 'Ethereum' },
  137: { icon: '⬡', color: 'bg-purple-500', name: 'Polygon' },
  42161: { icon: '◆', color: 'bg-blue-400', name: 'Arbitrum' },
  10: { icon: '⚡', color: 'bg-red-500', name: 'Optimism' },
  8453: { icon: '🔵', color: 'bg-blue-600', name: 'Base' },
  56: { icon: '⬡', color: 'bg-yellow-500', name: 'BSC' },
  11155111: { icon: 'Ξ', color: 'bg-gray-400', name: 'Sepolia' },
}

// Alchemy API key
const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY || ''

// RPC transports
const transports = {
  [mainnet.id]: alchemyKey
    ? http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
  [polygon.id]: alchemyKey
    ? http(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
  [arbitrum.id]: alchemyKey
    ? http(`https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
  [optimism.id]: alchemyKey
    ? http(`https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
  [base.id]: alchemyKey
    ? http(`https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
  [bsc.id]: http('https://bsc-dataseed.binance.org'),
  [sepolia.id]: alchemyKey
    ? http(`https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`)
    : http(),
}

// Wagmi config with MetaMask (injected) connector
export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: [
    injected({ target: 'metaMask' }),
  ],
  transports,
  storage: createStorage({ storage: localStorage }),
})

export function getChainMeta(chainId: number) {
  return chainMeta[chainId] || { icon: '?', color: 'bg-gray-500', name: 'Unknown' }
}

export function getChainById(chainId: number) {
  return supportedChains.find(c => c.id === chainId)
}
