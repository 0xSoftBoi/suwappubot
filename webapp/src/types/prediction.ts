/**
 * Prediction market types for Polymarket integration
 */

export interface PredictionMarket {
  conditionId: string
  questionId: string
  question: string
  description: string
  outcomes: string[]
  outcomePrices: string[]
  tokens: { token_id: string; outcome: string }[]
  volume: number
  volume24hr: number
  liquidity: number
  endDate: string
  active: boolean
  closed: boolean
  category: string
  image: string
}

export interface PredictionMarketDetail extends PredictionMarket {
  orderbook: MarketOrderbook
  recentTrades: PredictionTrade[]
}

export interface PredictionEvent {
  id: string
  title: string
  slug: string
  description: string
  markets: PredictionMarket[]
  volume: number
  category: string
  image: string
  endDate: string
}

export interface OrderbookEntry {
  price: string
  size: string
}

export interface OutcomeOrderbook {
  bids: OrderbookEntry[]
  asks: OrderbookEntry[]
}

export interface MarketOrderbook {
  [tokenId: string]: OutcomeOrderbook
}

export interface MarketPrice {
  tokenId: string
  outcome: string
  price: number
  midpoint: number
}

export interface PredictionTrade {
  id: string
  timestamp: string
  side: 'BUY' | 'SELL'
  outcome: string
  price: string
  size: string
  maker: string
}

export interface PredictionPosition {
  marketId: string
  question: string
  tokenId: string
  outcome: string
  shares: number
  avgEntryPrice: number
  currentPrice: number
  totalCost: number
  currentValue: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
}

export interface PredictionOrderRequest {
  tokenId: string
  side: 'BUY' | 'SELL'
  amount: number
  price: number
}

export interface PredictionOrderResult {
  orderId: string
  status: string
  message?: string
}
