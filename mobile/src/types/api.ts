/** Response shapes for Gecko's JWT-scoped, read-only mobile surface. */

export interface MoneyHolding {
  symbol: string
  valueUsd: number
  allocationPct: number
}

export interface MoneySource {
  name: string
  valueUsd: number
}

export interface SnapshotHistoryPoint {
  date: string
  valueUsd: number
}

export interface MobileSnapshot {
  totalValueUsd: number
  byToken: MoneyHolding[]
  byChain: MoneySource[]
  history: SnapshotHistoryPoint[]
  lastUpdated: string
  coverage: 'best_effort' | 'complete'
}

/** Activity is intentionally display-only; execution fields are not part of this client contract. */
export interface ActivityEntry {
  id: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount?: string | null
  status: string
  createdAt: string
  completedAt?: string | null
}

export interface AskResponse {
  answer: string
  type?: string
  data?: unknown
  suggestions?: string[]
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error'
  service: string
  timestamp?: string
}

export interface EarnPosition {
  protocol: string
  chain: string
  token: string
  balance: string
  balanceUsd: number
  apy: number
}

export interface EarnIdleBalance {
  chain: string
  token: string
  balance: string
  balanceUsd: number
}

export interface EarnSnapshot {
  apy: number
  positions: EarnPosition[]
  idle: EarnIdleBalance[]
  coverage: 'best_effort' | 'complete'
}

export interface EarnActionResponse {
  ok: true
  txHash: string
  amount: string
}
