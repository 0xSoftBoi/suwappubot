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
  walletId: number
  protocol: string
  chain: string
  token: string
  balance: string
  balanceUsd: number
  apy: number
}

export interface EarnIdleBalance {
  walletId: number
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

/** 200: the tx landed and confirmed. `approximate` is set on a max-withdraw,
 * where the amount reported is the pre-execution read and the live on-chain
 * amount (principal + interest accrued since) can be marginally higher. */
export interface EarnActionSuccess {
  ok: true
  txHash: string
  amount: string
  approximate?: boolean
}

/** 202: broadcast but confirmation timed out. Not an error — the tx may
 * still land. Client should show a pending state and re-poll, never retry
 * the write itself (a retry could double-submit on top of a tx that lands). */
export interface EarnActionPending {
  ok: false
  status: 'pending'
  txHash: string
}

export type EarnActionResponse = EarnActionSuccess | EarnActionPending
