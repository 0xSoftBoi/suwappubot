// Proprietary market-data store — GET /webapp/data/* (candles, perp funding/OI,
// prediction-market odds, lending rates). All numeric fields arrive as strings
// (postgres numeric) — components must parse before formatting/charting.

export interface MarketDataDatasetStatus {
  count: number
  latest_ts: string | null
  age_seconds: number | null
  healthy: boolean
}

export interface MarketDataStatus {
  success: boolean
  timeframes: Record<string, MarketDataDatasetStatus>
  venue_datasets: {
    perps: MarketDataDatasetStatus
    predictions: MarketDataDatasetStatus
    lend: MarketDataDatasetStatus
  }
}

export interface MarketDataCandle {
  ts: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  source: string
}

export interface MarketDataOhlcvResponse {
  success: boolean
  symbol: string
  chain: string
  timeframe: string
  source: string
  candles: MarketDataCandle[]
}

export interface MarketDataPerpMarket {
  venue: string
  symbol: string
  ts: string
  funding_rate: string
  open_interest: string
  mark_price: string
  index_price: string
  volume_24h: string
}

export interface MarketDataPerpsMarketsResponse {
  success: boolean
  markets: MarketDataPerpMarket[]
}

export interface MarketDataPerpMetric {
  ts: string
  funding_rate: string
  open_interest: string
  mark_price: string
  index_price: string
  volume_24h: string
}

export interface MarketDataPerpsHistoryResponse {
  success: boolean
  symbol: string
  venue: string
  metrics: MarketDataPerpMetric[]
}

export interface MarketDataPredictionMarket {
  venue: string
  market_id: string
  condition_id: string | null
  question: string
  outcome: string
  ts: string
  price: string
  volume: string
  liquidity: string
  end_date: string | null
}

export interface MarketDataPredictionsMarketsResponse {
  success: boolean
  markets: MarketDataPredictionMarket[]
}

export interface MarketDataPredictionPoint {
  ts: string
  price: string
  volume: string
  liquidity: string
}

export interface MarketDataPredictionsHistoryResponse {
  success: boolean
  market_id: string
  outcomes: Record<string, MarketDataPredictionPoint[]>
}

export interface MarketDataLendMarket {
  venue: string
  market_id: string
  chain_id: string | number
  loan_symbol: string
  collateral_symbol: string
  ts: string
  supply_apy: string
  borrow_apy: string
  tvl: string
  utilization: string
}

export interface MarketDataLendMarketsResponse {
  success: boolean
  markets: MarketDataLendMarket[]
}
