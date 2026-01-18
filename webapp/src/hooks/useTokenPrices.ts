import { useQuery } from '@tanstack/react-query'

// CoinGecko IDs for common tokens
const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  SOL: 'solana',
  MATIC: 'matic-network',
  BNB: 'binancecoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
}

export interface TokenPrice {
  symbol: string
  usd: number
  usd_24h_change?: number
}

async function fetchTokenPrices(symbols: string[]): Promise<Record<string, TokenPrice>> {
  const ids = symbols
    .map((s) => COINGECKO_IDS[s.toUpperCase()])
    .filter(Boolean)
    .join(',')

  if (!ids) return {}

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch prices')
  }

  const data = await response.json()

  // Map back to symbols
  const prices: Record<string, TokenPrice> = {}
  for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
    if (data[geckoId]) {
      prices[symbol] = {
        symbol,
        usd: data[geckoId].usd,
        usd_24h_change: data[geckoId].usd_24h_change,
      }
    }
  }

  return prices
}

export function useTokenPrices(symbols: string[] = ['ETH', 'SOL', 'USDC']) {
  return useQuery({
    queryKey: ['tokenPrices', symbols.sort().join(',')],
    queryFn: () => fetchTokenPrices(symbols),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Auto-refresh every minute
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export function useTokenPrice(symbol: string) {
  const { data, ...rest } = useTokenPrices([symbol])
  return {
    ...rest,
    data: data?.[symbol.toUpperCase()],
  }
}
