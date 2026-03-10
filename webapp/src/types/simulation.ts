/**
 * Transaction simulation types for swap preview
 */

export interface SimulationBalanceChange {
  token: string
  symbol: string
  amount: string
  amountUsd: number
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
