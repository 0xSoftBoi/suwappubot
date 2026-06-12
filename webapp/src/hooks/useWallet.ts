/**
 * Simple unified wallet hook.
 * Combines Turnkey session data with viem for chain interactions.
 */

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPublicClient, http, formatEther, type Address, type Chain } from 'viem'
import { mainnet, polygon, arbitrum, optimism, base, bsc, sepolia } from 'viem/chains'
import { getCurrentSession } from '../lib/turnkey-client'
import { getTurnkeyWallets, hasTurnkeySession } from '../lib/turnkey-passkey'

// Supported chains
export const chains: Chain[] = [mainnet, polygon, arbitrum, optimism, base, bsc, sepolia]

// Chain metadata for UI
export const chainMeta: Record<number, { icon: string; color: string }> = {
  1: { icon: 'Ξ', color: 'bg-blue-500' },
  137: { icon: '⬡', color: 'bg-purple-500' },
  42161: { icon: '◆', color: 'bg-blue-400' },
  10: { icon: '⚡', color: 'bg-red-500' },
  8453: { icon: '🔵', color: 'bg-blue-600' },
  56: { icon: '⬡', color: 'bg-yellow-500' },
  11155111: { icon: 'Ξ', color: 'bg-gray-400' },
}

// Get RPC URL for chain
function getRpcUrl(chainId: number): string {
  const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY

  const rpcUrls: Record<number, string> = {
    1: alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://eth.drpc.org',
    137: alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://polygon.drpc.org',
    42161: alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://arbitrum.drpc.org',
    10: alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://optimism.drpc.org',
    8453: alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://base.drpc.org',
    56: 'https://bsc-dataseed.binance.org',
    11155111: alchemyKey ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}` : 'https://sepolia.drpc.org',
  }

  return rpcUrls[chainId] || rpcUrls[1]
}

// Query keys
export const walletKeys = {
  all: ['wallet'] as const,
  session: () => [...walletKeys.all, 'session'] as const,
  balance: (address: string, chainId: number) => [...walletKeys.all, 'balance', address, chainId] as const,
}

interface WalletSession {
  address: Address | null
  organizationId: string | null
  isConnected: boolean
}

/**
 * Main wallet hook - use this throughout the app
 */
export function useWallet() {
  const queryClient = useQueryClient()
  const [chainId, setChainId] = useState<number>(1) // Default to mainnet

  // Get Turnkey session and wallet address
  const { data: session, isLoading: isSessionLoading, refetch: refetchSession } = useQuery({
    queryKey: walletKeys.session(),
    queryFn: async (): Promise<WalletSession> => {
      const hasSession = await hasTurnkeySession()
      if (!hasSession) {
        return { address: null, organizationId: null, isConnected: false }
      }

      const turnkeySession = await getCurrentSession()
      if (!turnkeySession) {
        return { address: null, organizationId: null, isConnected: false }
      }

      const wallets = await getTurnkeyWallets()
      const evmWallet = wallets.find(w => w.chainType === 'evm')

      return {
        address: evmWallet?.address as Address || null,
        organizationId: turnkeySession.organizationId,
        isConnected: !!evmWallet,
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  const address = session?.address || null
  const isConnected = session?.isConnected || false

  // Get balance for current chain
  const { data: balance, isLoading: isBalanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: walletKeys.balance(address || '', chainId),
    queryFn: async () => {
      if (!address) return null

      const chain = chains.find(c => c.id === chainId) || mainnet
      const client = createPublicClient({
        chain,
        transport: http(getRpcUrl(chainId)),
      })

      const balanceWei = await client.getBalance({ address })
      return {
        value: balanceWei,
        formatted: formatEther(balanceWei),
        symbol: chain.nativeCurrency.symbol,
      }
    },
    enabled: !!address,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })

  // Get current chain object
  const chain = chains.find(c => c.id === chainId) || mainnet
  const meta = chainMeta[chainId] || { icon: '?', color: 'bg-gray-500' }

  // Switch chain
  const switchChain = useCallback((newChainId: number) => {
    setChainId(newChainId)
    // Invalidate balance query for new chain
    if (address) {
      queryClient.invalidateQueries({ queryKey: walletKeys.balance(address, newChainId) })
    }
  }, [address, queryClient])

  // Truncate address for display
  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null

  // Copy address to clipboard
  const copyAddress = useCallback(async () => {
    if (address) {
      await navigator.clipboard.writeText(address)
      return true
    }
    return false
  }, [address])

  return {
    // Connection state
    address,
    truncatedAddress,
    isConnected,
    isLoading: isSessionLoading,
    organizationId: session?.organizationId || null,

    // Chain state
    chainId,
    chain,
    chainIcon: meta.icon,
    chainColor: meta.color,
    chains,
    switchChain,

    // Balance
    balance: balance?.value || BigInt(0),
    balanceFormatted: balance?.formatted || '0',
    balanceSymbol: balance?.symbol || 'ETH',
    isBalanceLoading,

    // Actions
    copyAddress,
    refetchSession,
    refetchBalance,
  }
}

/**
 * Hook to just get wallet address (lighter weight)
 */
export function useWalletAddress() {
  const { address, truncatedAddress, isConnected, isLoading } = useWallet()
  return { address, truncatedAddress, isConnected, isLoading }
}

/**
 * Hook to just get balance for a specific chain
 */
export function useChainBalance(chainId: number) {
  const { address } = useWallet()

  return useQuery({
    queryKey: walletKeys.balance(address || '', chainId),
    queryFn: async () => {
      if (!address) return null

      const chain = chains.find(c => c.id === chainId) || mainnet
      const client = createPublicClient({
        chain,
        transport: http(getRpcUrl(chainId)),
      })

      const balanceWei = await client.getBalance({ address })
      return {
        value: balanceWei,
        formatted: formatEther(balanceWei),
        symbol: chain.nativeCurrency.symbol,
      }
    },
    enabled: !!address,
    staleTime: 15 * 1000,
  })
}
