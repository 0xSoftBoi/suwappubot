export interface OrderBookLevel {
  price: number
  size: number
  total: number
}

export interface OrderBookData {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
  spreadPercent: number
  midPrice: number
}

export type OrderBookViewMode = 'both' | 'bids' | 'asks'
export type PrecisionStep = 0.01 | 0.1 | 1 | 10

const EMPTY_BOOK: OrderBookData = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  midPrice: 0,
}

export function useOrderBook(_precision: PrecisionStep = 0.01) {
  return {
    book: EMPTY_BOOK,
    isConnected: false,
    maxTotal: 0,
  }
}
