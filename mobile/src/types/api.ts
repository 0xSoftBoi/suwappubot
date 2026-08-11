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

/** One of the user's persisted wallets. Contract assumed from the existing
 * `POST /v1/mobile/wallets` response shape (address/name/chainType/isDefault)
 * in api/routes/mobile.py — no GET /v1/mobile/wallets exists yet, this is
 * coded ahead of the parallel backend work. */
export interface Wallet {
  address: string
  name: string
  chainType: string
  isDefault: boolean
}

/** 200: the send landed and confirmed. */
export interface SendActionSuccess {
  ok: true
  txHash: string
  amount: string
  to: string
}

/** 202: broadcast but confirmation timed out — same semantics as Earn's
 * pending state. Not an error, never auto-retried. */
export interface SendActionPending {
  ok: false
  status: 'pending'
  txHash: string
}

export type SendActionResponse = SendActionSuccess | SendActionPending

export interface BorrowAsset {
  token: string
  chain: string
  balance: string
  balanceUsd: number
}

export interface BorrowedAsset extends BorrowAsset {
  apr: number
}

export interface BorrowSnapshot {
  collateral: BorrowAsset[]
  borrowed: BorrowedAsset[]
  healthFactor: number | null
  availableToBorrowUsd: number
  coverage: 'best_effort' | 'complete'
}

export interface StatementTransaction {
  date: string
  type: string
  amountUsd: number
  token: string
  txHash: string
  counterparty?: string
}

export interface Statement {
  period: string
  yieldEarnedUsd: number
  depositedUsd: number
  withdrawnUsd: number
  sentUsd: number
  swapVolumeUsd: number
  transactions: StatementTransaction[]
}

export interface EnsResolution {
  name: string
  address: string
}

export interface Goal {
  id: number
  name: string
  targetUsd: number
  createdAt: string
}

export interface GoalsSnapshot {
  goals: Goal[]
}
