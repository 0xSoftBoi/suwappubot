export interface Trade {
  id: string
  price: number
  size: number
  side: 'buy' | 'sell'
  time: number
  isNew?: boolean
}

export function useRecentTrades() {
  return {
    trades: [] as Trade[],
    isConnected: false,
  }
}
