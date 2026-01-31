/**
 * Hook for fetching wallet balances across chains
 */
import { useQuery } from '@tanstack/react-query'

// Query keys
export const balanceKeys = {
  all: ['balances'] as const,
  list: (options?: { chain?: string; wallet?: string }) =>
    [...balanceKeys.all, 'list', options] as const,
  wallet: (address: string, chain?: string) =>
    [...balanceKeys.all, 'wallet', address, chain] as const,
}

export interface TokenChainBalance {
  chain: string
  balance: string
  usdValue: number
  walletAddress: string
}

export interface AggregatedToken {
  symbol: string
  name: string
  balance: string
  usdValue: number
  decimals: number
  logoUrl?: string
  chains: TokenChainBalance[]
}

export interface WalletSummary {
  address: string
  name: string | null
  chainType: 'evm' | 'solana'
}

export interface BalancesResponse {
  totalUsdValue: number
  tokens: AggregatedToken[]
  wallets: WalletSummary[]
  lastUpdated: string
}

export interface WalletBalanceResponse {
  wallet: WalletSummary
  tokens: Array<{
    symbol: string
    name: string
    address: string
    chain: string
    balance: string
    usdValue: number
    decimals: number
    logoUrl?: string
  }>
  totalUsdValue: number
  lastUpdated: string
}

/**
 * Hook to get aggregated balances across all wallets
 */
export function useBalances(options?: { chain?: string; wallet?: string }) {
  const queryParams = new URLSearchParams()
  if (options?.chain) queryParams.set('chain', options.chain)
  if (options?.wallet) queryParams.set('wallet', options.wallet)
  const queryString = queryParams.toString()

  return useQuery({
    queryKey: balanceKeys.list(options),
    queryFn: async (): Promise<BalancesResponse> => {
      const url = `${import.meta.env.VITE_API_URL || ''}/webapp/balances${queryString ? `?${queryString}` : ''}`
      const response = await fetch(url, {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch balances')
      return response.json()
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refresh every minute
    refetchOnWindowFocus: true,
  })
}

/**
 * Hook to get balances for a specific wallet
 */
export function useWalletBalances(address: string, chain?: string) {
  const queryParams = new URLSearchParams()
  if (chain) queryParams.set('chain', chain)
  const queryString = queryParams.toString()

  return useQuery({
    queryKey: balanceKeys.wallet(address, chain),
    queryFn: async (): Promise<WalletBalanceResponse> => {
      const url = `${import.meta.env.VITE_API_URL || ''}/webapp/balances/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`
      const response = await fetch(url, {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch wallet balances')
      return response.json()
    },
    enabled: !!address,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Hook to get total portfolio value
 */
export function usePortfolioValue() {
  const { data, isLoading, error } = useBalances()

  return {
    totalUsdValue: data?.totalUsdValue ?? 0,
    formattedValue: data?.totalUsdValue
      ? `$${data.totalUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$0.00',
    isLoading,
    error,
    lastUpdated: data?.lastUpdated,
  }
}

// Helper to get auth headers
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}

  // Get Telegram initData
  const initData = window.Telegram?.WebApp?.initData
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData
  }

  // Get JWT from localStorage if available
  const token = localStorage.getItem('suwappu_auth_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

// Telegram types are declared in src/lib/telegram.ts
