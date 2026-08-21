/**
 * Transaction simulation types for swap preview
 */

export interface SimulationBalanceChange {
  token: string
  symbol: string
  amount: string
  // Optional: the quote-derived fallback (buildSimulationFromQuote) can
  // leave this unset when no real USD price is derivable for the token —
  // never a lie (e.g. a token amount reported as USD), so callers must
  // null-check before formatting.
  amountUsd?: number
  direction: 'in' | 'out'
}

export interface SimulationGasEstimate {
  amount: string
  amountUsd: number
  network: string
}

export interface RouteStep {
  from: string
  to: string
  dex: string
  percentage?: number
}

export interface SimulationWarning {
  severity: 'low' | 'medium' | 'high'
  message: string
}

export interface SimulationResult {
  balanceChanges: SimulationBalanceChange[]
  gasEstimate: SimulationGasEstimate
  priceImpact: number
  route: RouteStep[]
  warnings: SimulationWarning[]
}
