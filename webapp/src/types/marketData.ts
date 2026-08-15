/**
 * Types for the market-data store (`/webapp/data/*`).
 * Numeric fields arrive from the API as strings (Postgres numeric) — callers
 * must parse them before formatting or charting.
 */

export interface DatasetHealth {
  count: number
  latest_ts: string | null
  age_seconds: number | null
  healthy: boolean
}

export interface MarketDataStatus {
  success: boolean
  timeframes: Record<string, unknown>
  venue_datasets: {
    perps: DatasetHealth
    predictions: DatasetHealth
    lend: DatasetHealth
    [key: string]: DatasetHealth
  }
}

export interface OhlcvCandle {
  ts: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  source: string
}

export interface OhlcvResponse {
  success: boolean
  symbol: string
  chain: string
  timeframe: string
  source: string
  candles: OhlcvCandle[]
}

export interface PerpMarket {
  venue: string
  symbol: string
  ts: string
  funding_rate: string
  open_interest: string
  mark_price: string
  index_price: string
  volume_24h: string
}

export interface PerpMarketsResponse {
  success: boolean
  markets: PerpMarket[]
}

export interface PerpMetric {
  ts: string
  funding_rate: string
  open_interest: string
  mark_price: string
  index_price: string
  volume_24h: string
}

export interface PerpHistoryResponse {
  success: boolean
  symbol: string
  venue: string
  metrics: PerpMetric[]
}

export interface PredictionMarketRow {
  venue: string
  market_id: string
  condition_id: string
  question: string
  outcome: string
  ts: string
  price: string
  volume: string
  liquidity: string
  end_date: string | null
}

export interface PredictionMarketsResponse {
  success: boolean
  markets: PredictionMarketRow[]
}

export interface PredictionHistoryPoint {
  ts: string
  price: string
  volume: string
  liquidity: string
}

export interface PredictionHistoryResponse {
  success: boolean
  market_id: string
  outcomes: Record<string, PredictionHistoryPoint[]>
}

export interface LendMarket {
  venue: string
  market_id: string
  chain_id: string
  loan_symbol: string
  collateral_symbol: string
  ts: string
  supply_apy: string
  borrow_apy: string
  tvl: string
  utilization: string
}

export interface LendMarketsResponse {
  success: boolean
  markets: LendMarket[]
}
