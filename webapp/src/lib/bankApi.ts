/**
 * Typed client for Suwappu Bank (`/webapp/bank/*`, Telegram-authed).
 *
 * - Reuses the app's auth headers via `api.rawRequest` (no second auth path).
 * - Amounts are integer minor-unit strings. Use formatMinor/parseToMinor (bigint math) — never parseFloat.
 * - Every money-moving POST takes an idempotency key that the caller generates once per user
 *   intent (see hooks/bank/useIdempotencyKey) and reuses on retry.
 */
import { api } from './api'

const BASE = '/webapp/bank'

// ---------------------------------------------------------------- errors

export class BankApiError extends Error {
  readonly status: number
  readonly code: string
  readonly missing?: string
  readonly fields?: Record<string, string>
  constructor(message: string, status: number, code: string, extra?: { missing?: string; fields?: Record<string, string> }) {
    super(message)
    this.name = 'BankApiError'
    this.status = status
    this.code = code
    this.missing = extra?.missing
    this.fields = extra?.fields
  }
}

/** Typed codes that mean "the capability is not switched on yet", not "you did something wrong". */
const NOT_AVAILABLE_CODES = new Set([
  'NOT_CONFIGURED',
  'PROVIDER_NOT_CONFIGURED',
  'LENDER_POOL_UNFUNDED',
  'RAIL_NO_PROVIDER',
  'SIGNING_UNAVAILABLE',
  'UNSUPPORTED',
  'WALLET_UNAVAILABLE',
  'POOL_UNFUNDED',
  'RAMP_UNAVAILABLE',
  'ISSUER_NOT_CONFIGURED',
])

/**
 * Per-endpoint transfer-id accessors. Each one mirrors the exact api-ts service return type
 * (see the file:line notes); endpoints that return no transfer id have none here on purpose.
 */
export const transferIdOf = {
  /** BankFxService.execute -> { transfer, quote } */
  fx: (r: FxExecuteResult): string => r.transfer.id,
  /** BankRampService.offramp -> { rampTransfer, quote }; the ledger transfer id is rampTransfer.bankTransferId (null until the debit is booked). */
  offramp: (r: OfframpResult): string | null => r.rampTransfer.bankTransferId ?? null,
  /** BankRemittanceService.send -> { remittance, ... }; remittance.bankTransferId. */
  remittance: (r: { remittance: Remittance }): string | null => r.remittance.bankTransferId ?? null,
  /** BankApprovalService.transfer -> { approvalRequired:false, transfer } | { approvalRequired:true, request } */
  orgTransfer: (r: OrgTransferResult): string | null => (r.approvalRequired ? null : r.transfer.id),
  /** BankEarnService.deposit/withdraw -> { operation } (operation.transferId). */
  earn: (r: { operation: EarnOp }): string | null => r.operation.transferId ?? null,
  /** BankCreditService.draw/repay -> { line, transferId, txHash, status }. */
  credit: (r: { transferId: string | null }): string | null => r.transferId,
  /** BankPaymentsService.payInvoice -> { invoice, payment, transferStatus }; payment.transferId. */
  invoicePay: (r: InvoicePayResult): string | null => r.payment.transferId ?? null,
  /** Payroll executeRun/retryFailed -> { run, items[] }; one transferId per paid item (fxTransferId when converted). */
  payrollItems: (r: PayrollRunResult): string[] => r.items.map((i) => i.transferId).filter((x): x is string => typeof x === 'string'),
  /** advanceWages / advanceScheduleWages -> { ..., transferId } */
  ewa: (r: { transferId: string | null }): string | null => r.transferId,
  /** POST /transfers -> { transfer } */
  transfer: (r: { transfer: BankTransfer }): string => r.transfer.id,
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

export function isNotAvailable(e: unknown): boolean {
  return e instanceof BankApiError && (NOT_AVAILABLE_CODES.has(e.code) || e.status === 503)
}

/** Plain-language line for every typed bank error code (api-ts services/bank/errors.ts). Falls back to the API's own message. */
export function describeBankError(code: string, message?: string): string {
  switch (code) {
    case 'INSUFFICIENT_AVAILABLE': return 'Not enough available balance. Part of your balance is on hold or already committed, so only the available amount can be used.'
    case 'INSUFFICIENT_FUNDS': return 'Your balance is too low for this amount plus fees.'
    case 'PROVIDER_NOT_CONFIGURED': return 'This payment provider is not switched on yet. Nothing was sent.'
    case 'PROVIDER_DOCS_REQUIRED': return 'The provider needs more documents from you before this can go ahead. Finish verification first.'
    case 'RAIL_NO_PROVIDER': return 'No provider is available for this payment route yet. Try another route or currency.'
    case 'LENDER_POOL_UNFUNDED': return 'The lending pool has no funds available right now, so credit cannot be drawn. Try again later.'
    case 'POOL_UNFUNDED': return 'The payout pool has no funds available right now, so instant payouts are paused.'
    case 'EXPOSURE_LIMIT': return 'This would go over the exposure limit. Try a smaller amount or repay something first.'
    case 'RAMP_UNAVAILABLE': return 'Bank on and off ramps are unavailable right now. Nothing was sent. Try again later.'
    case 'RECEIVABLES_UNAVAILABLE': return 'Invoice financing is not available right now.'
    case 'ISSUER_NOT_CONFIGURED': return 'Card issuing is not switched on yet.'
    case 'NOT_CONFIGURED': return message ? `Not available yet: ${message}` : 'This feature is not switched on yet.'
    case 'SIGNING_UNAVAILABLE': return 'Signing is temporarily unavailable. Nothing was sent. Try again shortly.'
    case 'WALLET_UNAVAILABLE': return 'The wallet for this account is not ready yet.'
    case 'LIMIT_EXCEEDED': return message || 'This is over your limit.'
    case 'POLICY_BLOCKED': return message || 'A policy blocked this. An approval may be needed.'
    case 'ACCOUNT_STATE': return message || 'This account cannot do that in its current state.'
    case 'ASSET_UNSUPPORTED': return message || 'That asset or network is not supported.'
    case 'FORBIDDEN': return message || 'You do not have permission to do this.'
    case 'NOT_FOUND': return message || 'We could not find that.'
    case 'CONFLICT': return message || 'This conflicts with something that already exists.'
    case 'UPSTREAM': return 'A partner service did not respond properly. Nothing was lost; try again shortly.'
    default: return message || 'Something went wrong. Try again.'
  }
}

/** Plain-language text for any thrown value. */
export function bankErrorText(e: unknown): string {
  if (e instanceof BankApiError) {
    if (e.fields && Object.keys(e.fields).length) return Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join('; ')
    const t = describeBankError(e.code, e.message)
    return e.missing && !t.includes(e.missing) ? `${t} (needs ${e.missing})` : t
  }
  if (e instanceof DOMException && e.name === 'TimeoutError') return 'The request timed out. Check your connection and try again.'
  if (e instanceof TypeError) return 'Could not reach the server. Check your connection and try again.'
  return e instanceof Error ? e.message : 'Something went wrong'
}

// ---------------------------------------------------------------- transport

type Query = Record<string, string | number | boolean | undefined | null>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

interface ReqOpts {
  query?: Query
  body?: unknown
  idempotencyKey?: string
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toError(res: Response, body: unknown): BankApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const code = String(b.error_code ?? b.code ?? (typeof b.error === 'string' ? b.error : '') ?? '') || `HTTP_${res.status}`
  const fields = b.fields && typeof b.fields === 'object' ? (b.fields as Record<string, string>) : undefined
  const message =
    (typeof b.message === 'string' && b.message) ||
    (typeof b.detail === 'string' && b.detail) ||
    (typeof b.error === 'string' && b.error) ||
    (res.status === 401 ? 'You are signed out. Reopen the app from Telegram.' : `Request failed (${res.status})`)
  return new BankApiError(message, res.status, code, { missing: typeof b.missing === 'string' ? b.missing : undefined, fields })
}

async function req<T>(method: string, path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.idempotencyKey ? { ...(opts.body as object), idempotencyKey: opts.idempotencyKey } : opts.body)
  const res = await api.rawRequest(`${BASE}${path}${qs(opts.query)}`, { method, headers, body })
  const parsed = await parse(res)
  if (!res.ok) throw toError(res, parsed)
  if (parsed && typeof parsed === 'object' && (parsed as { success?: boolean }).success === false) throw toError(res, parsed)
  return parsed as T
}

/** Plain-text download (CSV export). */
async function reqText(path: string, query?: Query): Promise<string> {
  const res = await api.rawRequest(`${BASE}${path}${qs(query)}`)
  const text = await res.text()
  if (!res.ok) {
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* plain text */ }
    throw toError(res, parsed)
  }
  return text
}

const get = <T>(path: string, query?: Query) => req<T>('GET', path, { query })
const post = <T>(path: string, body?: unknown, idempotencyKey?: string) => req<T>('POST', path, { body: body ?? {}, idempotencyKey })
const put = <T>(path: string, body?: unknown) => req<T>('PUT', path, { body: body ?? {} })
const patch = <T>(path: string, body?: unknown) => req<T>('PATCH', path, { body: body ?? {} })
const del = <T>(path: string) => req<T>('DELETE', path)

// ---------------------------------------------------------------- idempotency + money

/** One key per user intent. Generate once, reuse on retry, discard after a terminal result. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  const id = c && 'randomUUID' in c ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `ui_${id}`
}

const MINOR_RE = /^\d+$/

export function isMinor(v: unknown): v is string {
  return typeof v === 'string' && MINOR_RE.test(v)
}

/** Integer minor-unit string -> grouped decimal string, bigint math only. */
export function formatMinor(minor: string | null | undefined, decimals: number | null | undefined, opts: { maxFrac?: number; minFrac?: number } = {}): string {
  if (!isMinor(minor) || decimals === null || decimals === undefined) return '—'
  const neg = false
  const v = BigInt(minor)
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  let frac = (v % base).toString().padStart(decimals, '0')
  const minFrac = opts.minFrac ?? Math.min(2, decimals)
  const maxFrac = Math.max(opts.maxFrac ?? Math.min(decimals, 6), minFrac)
  frac = frac.slice(0, maxFrac).replace(/0+$/, '')
  while (frac.length < minFrac) frac += '0'
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${frac ? `${w}.${frac}` : w}`
}

/** Signed variant for ledger deltas (strings like "-1500"). */
export function formatSignedMinor(minor: string | null | undefined, decimals: number | null | undefined): string {
  if (typeof minor !== 'string' || !/^-?\d+$/.test(minor)) return '—'
  return minor.startsWith('-') ? `-${formatMinor(minor.slice(1), decimals)}` : formatMinor(minor, decimals)
}

/** Decimal text typed by a user -> minor units. Returns null when invalid or too precise. */
export function parseToMinor(input: string, decimals: number): string | null {
  const t = input.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const [w, f = ''] = t.split('.')
  if (f.length > decimals) return null
  const v = BigInt(w + f.padEnd(decimals, '0'))
  return v > 0n ? v.toString() : null
}

// ---------------------------------------------------------------- fiat minor units

/**
 * ISO 4217 minor-unit exponents for currencies that are NOT 2. The API returns fiat amounts in minor
 * units but not the exponent (api-ts ramps/rails.ts FIAT_DECIMALS is server-side only), so the client
 * must carry a correct table. Anything absent here is 2 (USD, EUR, GBP, MXN, BRL, COP, INR, NGN, ...).
 */
const ISO_ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const ISO_THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])
const ISO_FOUR = new Set(['CLF', 'UYW'])
const ISO_TWO = /^[A-Z]{3}$/

/** Minor-unit exponent for an ISO-4217 fiat code; null when the code is not a 3-letter fiat code. */
export function fiatDecimals(code: string | null | undefined): number | null {
  const c = (code ?? '').toUpperCase()
  if (!ISO_TWO.test(c)) return null
  return ISO_ZERO.has(c) ? 0 : ISO_THREE.has(c) ? 3 : ISO_FOUR.has(c) ? 4 : 2
}

/** Decimals for a ramp currency: a bank asset (stablecoin) wins over the fiat table; null if unknown. */
export function currencyDecimals(code: string | null | undefined, assets?: BankAsset[]): number | null {
  const c = (code ?? '').toUpperCase()
  const a = assets?.find((x) => x.symbol.toUpperCase() === c)
  if (a) return a.decimals
  return fiatDecimals(c)
}

/** Sum minor strings of the same decimals with bigint math. */
export function sumMinor(values: Array<string | null | undefined>): string {
  return values.reduce<bigint>((a, v) => (isMinor(v) ? a + BigInt(v) : a), 0n).toString()
}

export function cmpMinor(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x === y ? 0 : x > y ? 1 : -1
}

// ---------------------------------------------------------------- types (shapes mirror api-ts rows; unknown extras tolerated)

export type Json = Record<string, unknown>

export interface BankAsset { symbol: string; chain: string; family: string; decimals: number; currency: string; name: string; address: string }
export interface BankAccount {
  id: string
  kind: string
  asset: string
  chain: string
  currency?: string
  address?: string | null
  status: string
  balanceMinor: string
  balance: string | null
  decimals: number | null
  label?: string | null
  segmentProfile?: string | null
  createdAt?: string
}
export interface BankTransfer {
  id: string
  type: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'reversed' | string
  amountMinor: string
  asset: string
  chain: string
  fromAccount?: string | null
  toAccount?: string | null
  toExternal?: { address?: string } | null
  txHash?: string | null
  failureReason?: string | null
  memo?: string | null
  createdAt: string
  confirmedAt?: string | null
}
/** api-ts db/schema/bank.ts: direction is 'debit' | 'credit' (debit reduces this account). */
export type LedgerDirection = 'debit' | 'credit'
export interface LedgerEntry { id: string; transferId: string; accountId: string; direction: LedgerDirection; amountMinor: string; asset: string; balanceAfter?: string | null; phase?: string; createdAt: string; cursor: string }
export interface StatementPage { entries: LedgerEntry[]; nextCursor: string | null }
export interface ReconcileReport {
  accountId: string; chain: string; asset: string; address: string | null; accountsInGroup: string[]
  ledgerMinor: string; onchainMinor: string; deltaMinor: string; inFlightTransfers: number
  status: 'in_sync' | 'pending_settlement' | 'drift'
}
export interface FxQuote {
  fromAccountId: string; toAccountId: string; fromAsset: string; toAsset: string; chain: string
  fromAmountMinor: string; expectedToMinor: string; minToMinor: string
  fromAmount: string; expectedTo: string; minTo: string
  rate: string; route: string; steps: string[]; direct: boolean; estimatedGasUsd: string; slippage: number
}
export interface Vault {
  address: string; name: string; symbol: string; chain: string; asset: string; assetAddress: string; decimals: number
  /** PERCENT, not a fraction (api-ts BankEarnService: Morpho apy * 100). 4.2 means 4.2%. */
  apy: number; netApy: number; feePct: number; totalAssetsMinor: string; totalAssetsUsd: number | null; listed: boolean
}
export interface EarnPosition {
  savingsAccountId: string; checkingAccountId: string; vault: string; chain: string; asset: string
  sharesMinor: string; pledgedSharesMinor: string; principalMinor: string; valueMinor: string; yieldMinor: string; realizedYieldMinor: string; /** percent (netApy), or null when the vault lookup failed */ apy: number | null
}
export interface EarnOp { id: string; kind: string; status: string; vault: string; txHash?: string | null; transferId?: string | null; failureReason?: string | null; createdAt?: string }
export interface EarnSetting { accountId: string; enabled: boolean; vault: string; metadata?: Json | null }
export interface CreditMarket {
  marketId: string; chain: string
  loanAsset: { address: string; symbol: string; decimals: number }
  collateralAsset: { address: string; symbol: string; decimals: number }
  /** borrowApy / supplyApy are PERCENT (api-ts BankCreditService multiplies the Morpho fraction by 100). */
  lltvBps: number; borrowApy: number; supplyApy: number; liquidityUsd: number | null; utilizationPct: number
}
export interface CreditLine {
  id: string; kind: string; status: string; chain: string; loanAsset: string; accountId: string; marketId?: string | null
  collateralToken?: string | null; collateralDecimals?: number | null; aprBps?: number | null; lastLevel?: string | null
}
export interface CreditLineView {
  line: CreditLine
  health: (Json & { ltvBps?: number; healthFactorBps?: number; liquidationPriceHuman: string | null; level: 'ok' | 'warn' | 'critical' }) | null
  owed: { principalMinor: string; accruedInterestMinor: string; totalMinor: string } | null
}
export interface CreditEvent { id: string; lineId: string; type: string; level?: string | null; ltvBps?: number | null; healthFactorBps?: number | null; createdAt: string }
export interface CreditScore { id?: string; asset: string; chain: string; score: number; tier: string; aprBps?: number | null; factors?: Json | null; computedAt?: string }
export interface RampQuote {
  provider: string; quoteId: string | null; expiresAt: string | null; sourceCurrency: string; destCurrency: string
  sendAmountMinor: string; receiveAmountMinor: string; feeMinor: string | null; rate: string; etaSeconds: number | null; indicative: boolean; route: string[]
}
export interface RoutedQuotes { best: RampQuote; quotes: RampQuote[]; failures: Array<{ provider: string; error: string }> }
export interface RailRow { rail: string; sourceProviders: string[]; destinationProviders: string[]; unconfigured: Array<{ provider: string; missing: string }> }
export interface ProviderRow { id: string; configured: boolean; missing: string | null; capabilities: Json }
export interface RampCustomer { id: string; provider: string; kycStatus: string; kycLink?: string | null; tosLink?: string | null }
export interface ExternalAccount { id: string; provider: string; rail: string; currency: string; label?: string | null; details?: Json | null }
export interface VirtualAccount { id: string; provider: string; sourceCurrency: string; destAccountId: string; destAsset?: string; destChain?: string; instructions?: Json | null; status: string }
export interface RampTransfer { id: string; provider: string; direction: string; status: string; providerState?: string | null; sourceCurrency?: string; destCurrency?: string; amountMinor?: string; receiveMinor?: string | null; feeMinor?: string | null; bankTransferId?: string | null; createdAt: string }
export interface PayoutRequest { rail: string; currency: string; destination: string; amountMinor: string | null; payeeName: string | null; reference: string | null; brCode?: string }
export interface Remittance {
  id: string; status: string; mode: string; corridor?: string | null; sendAsset: string; sendChain: string; sendCurrency?: string | null
  amountMinor: string; receiveCurrency?: string | null; receiveMinor?: string | null; feeMinor?: string | null
  recipientType?: string | null; recipientRef?: string | null; claimExpiresAt?: string | null; memo?: string | null; bankTransferId?: string | null; createdAt: string
}
export interface Card {
  id: string; accountId: string; provider: string; type: string; status: string; currency: string; brand?: string | null
  expMonth?: number | null; expYear?: number | null; label?: string | null; rules?: CardRules | null; singleUse?: boolean
}
export interface CardRules {
  perTxCapMinor?: string; dailyCapMinor?: string; weeklyCapMinor?: string; monthlyCapMinor?: string
  mccAllow?: string[]; mccBlock?: string[]; merchantAllow?: string[]; merchantBlock?: string[]
  countryAllow?: string[]; countryBlock?: string[]; validFrom?: string; validUntil?: string
  [k: string]: unknown
}
export interface CardAuth { id: string; cardId: string; amountMinor: string; currency: string; merchantName?: string | null; mcc?: string | null; merchantCountry?: string | null; decision: string; reason?: string | null; status: string; createdAt: string }
export interface CardTx { id: string; cardId: string; type: string; amountMinor: string; currency: string; merchantName?: string | null; settlementStatus?: string | null; createdAt: string }
export interface Invoice { id: string; slug?: string | null; status: string; asset: string; chain: string; reference?: string | null; memo?: string | null; lineItems?: unknown; amountMinor?: string; paidMinor?: string; payeeAccountId: string; dueAt?: string | null; createdAt?: string }
export interface Escrow {
  id: string; status: string; asset: string; chain: string; description?: string | null
  payerOwnerType: string; payerOwnerId: string; payeeOwnerType: string; payeeOwnerId: string; arbiterOwnerType?: string | null; arbiterOwnerId?: string | null
  payerAccountId: string; payeeAccountId: string; amountMinor: string; releasedMinor: string; refundedMinor: string; autoReleaseSeconds: number; createdAt?: string
}
export interface EscrowSettlement { kind: 'release' | 'refund'; transferId: string; amountMinor: string; attempt: number; state: string }
export interface EscrowMilestone {
  id: string; escrowId: string; seq: number; status: string; description?: string | null; amountMinor: string; releasedMinor: string; refundedMinor: string
  deliveryProof?: string | null; deliveredAt?: string | null; deliverBy?: string | null; autoReleaseAt?: string | null; settlement?: EscrowSettlement[] | null
}
export interface EscrowEvent { id: string; escrowId: string; milestoneId: string | null; actor: string; action: string; fromStatus: string | null; toStatus: string | null; createdAt: string }
/** GET /escrows/:id and every escrow action: BankEscrowService EscrowView. The funding transfer id is NOT returned. */
export interface EscrowView { escrow: Escrow; milestones: EscrowMilestone[]; events: EscrowEvent[] }
export interface Stream {
  id: string; status: string; kind: 'rate' | 'metered' | string; asset: string; chain: string; payerAccountId: string; payeeAccountId: string
  periodSeconds?: number | null; rateMinor?: string | null; unitPriceMinor?: string | null; capMinor: string; dustMinor?: string; units?: string; settledMinor: string; pendingMinor?: string | null; lastError?: string | null
}
/** BankStreamService StreamView (get/list/pause/resume/cancel/settle/usage). settle returns no transfer id. */
export interface StreamView { stream: Stream; accruedMinor: string; unsettledMinor: string; advanceAvailableMinor: string }
export interface Payee { id: string; kind: string; name: string; method: string; currency: string; status: string; address?: string | null; chain?: string | null }
export interface PayrollRun { id: string; status: string; label?: string | null; fundingAccountId: string; asset: string; chain: string; createdAt?: string }
export interface PayrollItem { id: string; runId?: string; lineNo: number; payeeId: string; status: 'pending' | 'converting' | 'paid' | 'failed' | string; amountMinor: string; transferId?: string | null; fxTransferId?: string | null; paidAmountMinor?: string | null; paidAsset?: string | null; error?: string | null; memo?: string | null }
export interface PayrollRunExt extends PayrollRun { totalMinor: string; poolId?: string | null; scheduleId?: string | null; executedAt?: string | null }
/** executeRun / retryFailed */
export interface PayrollRunResult { run: PayrollRunExt; items: PayrollItem[] }
/** GET /payroll/runs/:id (BankPayrollService RunPreview) */
export interface PayrollPreview {
  run: PayrollRunExt
  items: Array<{ item: PayrollItem; payee: { id: string; name: string; method: string; currency: string }; conversion: { needed: boolean; to?: string }; routable: boolean; issue?: string }>
  totalMinor: string; fundingBalanceMinor: string; sufficientFunds: boolean; usesPool: boolean; approvalRequired: boolean
}
export interface FxExecuteResult { transfer: BankTransfer; quote: FxQuote }
export interface OfframpResult { rampTransfer: RampTransfer; quote: RampQuote | null }
export type OrgTransferResult = { approvalRequired: false; transfer: BankTransfer } | { approvalRequired: true; reason: string; request: ApprovalRequest }
export interface InvoicePayment { id: string; invoiceId?: string; amountMinor?: string; transferId?: string | null; status?: string }
export interface InvoicePayResult { invoice: Invoice; payment: InvoicePayment; transferStatus: string }
export interface InvoiceLineItem { description: string; quantity: number; unitAmountMinor: string }
/** payment request the API builds for an invoice (BankPaymentsService PaymentRequest). */
export interface PaymentRequest { family: 'evm' | 'solana'; uri: string; qrPayload: string; payTo: string; payAmountMinor: string; asset: string; chain: string; reference: string | null }
/** GET /public/bank/invoices/:slug (PublicInvoiceView), unauthenticated. */
export interface PublicInvoice { slug: string; status: string; amountMinor: string; paidMinor: string; asset: string; chain: string; lineItems: InvoiceLineItem[]; memo: string | null; dueAt: string | null; paymentRequest: PaymentRequest }
export interface InvoiceView { invoice: Invoice; paymentRequest: PaymentRequest; payments: InvoicePayment[] }
export interface Vendor { id: string; orgId?: string; name: string; email?: string | null; payAddress?: string | null; payChain?: string | null }
/** bank_org_bills. Bills carry their own asset/chain, so decimals come from /assets, not the org reporting currency. */
export interface Bill { id: string; orgId: string; vendorId: string; reference?: string | null; amountMinor: string; asset: string; chain: string; dueDate: string; status: 'unpaid' | 'scheduled' | 'pending_approval' | 'paying' | 'paid' | 'failed' | 'cancelled'; payFromAccountId?: string | null; scheduledFor?: string | null; transferId?: string | null; lastError?: string | null }
export interface ApprovalPolicy { id: string; orgId: string; ruleType: 'transfer_over' | 'new_payee' | 'payroll_run'; thresholdMinor?: string | null; requiredApprovals: number; approverRoles: string[]; expiryHours: number }
export interface CardBudget { id?: string; orgId?: string; scope: 'member' | 'team'; scopeId: string; monthlyCapMinor?: string | null; perTxCapMinor?: string | null; categoryBudgets?: Record<string, string> | null }
export interface FeeModelEntry { chain?: string; [k: string]: unknown }
export interface PayrollSchedule { id: string; name: string; status: string; frequency: string; timezone: string; fundingAccountId: string; localTime?: string | null; dayOfWeek?: number | null; dayOfMonth?: number | null; autoApprove?: boolean }
export interface Org { id: string; name: string; reportingCurrency: string; role?: string }
export interface OrgMember { id?: string; userId: number; role: string; team?: string | null }
export interface OrgInvite { id: string; role: string; email?: string | null; expiresAt?: string; token?: string }
export interface ApprovalRequest { id: string; orgId: string; action: string; status: string; requiredApprovals: number; expiresAt?: string; payload?: Json; createdAt?: string }
export interface Mandate { id: string; accountId: string; allowedHosts?: string[]; allowedPayees?: string[]; allowedAssets?: string[]; expiresAt?: string | null; status: string }
export interface AgentResource { id: string; slug: string; title: string; description?: string | null; asset: string; chain: string; status: string; priceMinor?: string; upstreamUrl?: string }
export interface SegmentProfile { segment: string; title: string; defaultCurrencies: string[]; features: Record<string, boolean>; limits: { perTxMinor: string; dailyMinor: string }; onboardingChecklist: string[]; notes?: string }
export interface EffectiveFeatures { accountId: string; segment: string | null; features: Record<string, boolean>; limits: { perTxMinor: string; dailyMinor: string } | null; profile: SegmentProfile | null }

type Ok<T> = T & { success: true }

// ---------------------------------------------------------------- endpoints

export const bank = {
  assets: (q?: { chain?: string; currency?: string }) => get<Ok<{ assets: BankAsset[] }>>('/assets', q),

  // core
  accounts: () => get<Ok<{ accounts: BankAccount[] }>>('/accounts'),
  openAccount: (b: { kind?: string; asset: string; chain: string; label?: string; segmentProfile?: string }) => post<Ok<{ account: BankAccount }>>('/accounts', b),
  account: (id: string) => get<Ok<{ account: BankAccount }>>(`/accounts/${id}`),
  statement: (id: string, q: { limit?: number; cursor?: string }) => get<Ok<StatementPage>>(`/accounts/${id}/statement`, q),
  reconcile: (id: string) => get<Ok<ReconcileReport>>(`/accounts/${id}/reconcile`),
  syncDeposit: (id: string) => post<Ok<Json>>(`/accounts/${id}/sync-deposit`),
  transfer: (b: { fromAccountId: string; toAccountId?: string; toExternal?: { address: string }; amountMinor: string; memo?: string }, key: string) =>
    post<Ok<{ transfer: BankTransfer }>>('/transfers', b, key),
  getTransfer: (id: string) => get<Ok<{ transfer: BankTransfer }>>(`/transfers/${id}`),
  transfers: (q?: { accountId?: string; status?: string; limit?: number; before?: string }) => get<Ok<{ transfers: BankTransfer[] }>>('/transfers', q),

  // fx
  fxQuote: (b: { fromAccountId: string; toAccountId: string; amountMinor: string; slippage?: number }) => post<Ok<{ quote: FxQuote }>>('/fx/quote', b),
  fxExecute: (b: { fromAccountId: string; toAccountId: string; amountMinor: string; slippage?: number; minToMinor?: string }, key: string) => post<Ok<FxExecuteResult>>('/fx/execute', b, key),

  // earn
  vaults: (q: { asset: string; chain: string }) => get<Ok<{ vaults: Vault[] }>>('/earn/vaults', q),
  positions: () => get<Ok<{ positions: EarnPosition[] }>>('/earn/positions'),
  earnHistory: (q?: { accountId?: string; limit?: number }) => get<Ok<{ snapshots: unknown[]; operations: EarnOp[] }>>('/earn/history', q),
  earnDeposit: (b: { accountId: string; vault: string; amountMinor: string }, key: string) => post<Ok<{ operation: EarnOp }>>('/earn/deposit', b, key),
  earnWithdraw: (b: { accountId: string; vault: string; amountMinor?: string; all?: boolean }, key: string) => post<Ok<{ operation: EarnOp }>>('/earn/withdraw', b, key),
  earnSettings: () => get<Ok<{ settings: EarnSetting[] }>>('/earn/settings'),
  setEarnSettings: (b: { accountId: string; vault: string; enabled: boolean; floorMinor: string; minSweepMinor?: string }) => put<Ok<{ settings: EarnSetting }>>('/earn/settings', b),

  // credit
  creditMarkets: (q?: { chain?: string; asset?: string; collateral?: string }) => get<Ok<{ markets: CreditMarket[] }>>('/credit/markets', q),
  creditLines: () => get<Ok<{ lines: CreditLineView[] }>>('/credit/lines'),
  creditLine: (id: string) => get<Ok<{ line: CreditLineView }>>(`/credit/lines/${id}`),
  openLine: (b: { accountId: string; marketId: string; collateral: { source: 'wallet' | 'vault_shares'; amountMinor: string; savingsAccountId?: string } }, key: string) => post<Ok<{ line: CreditLineView }>>('/credit/lines', b, key),
  draw: (b: { lineId: string; amountMinor: string }, key: string) => post<Ok<{ line: CreditLineView; transferId: string | null; txHash: string | null; status: string }>>('/credit/draw', b, key),
  repay: (b: { lineId: string; amountMinor?: string; all?: boolean }, key: string) => post<Ok<{ line: CreditLineView; transferId: string | null; txHash: string | null; status: string }>>('/credit/repay', b, key),
  withdrawCollateral: (b: { lineId: string; amountMinor?: string; all?: boolean }, key: string) => post<Ok<{ line: CreditLineView; txHash: string }>>('/credit/withdraw-collateral', b, key),
  creditEvents: (q?: { lineId?: string; limit?: number }) => get<Ok<{ events: CreditEvent[] }>>('/credit/events', q),
  creditScore: (q?: { asset?: string; chain?: string }) => get<Ok<{ score: CreditScore }>>('/credit/score', q),
  financeReceivable: (b: { accountId: string; invoiceId: string }, key: string) => post<Ok<{ line: CreditLineView; advanceMinor: string }>>('/credit/receivables/finance', b, key),
  unsecuredLine: (b: { accountId: string }, key: string) => post<Ok<{ line: CreditLineView }>>('/credit/unsecured', b, key),

  // ramps
  rails: () => get<Ok<{ rails: RailRow[] }>>('/ramps/rails'),
  providers: () => get<Ok<{ providers: ProviderRow[] }>>('/ramps/providers'),
  rampQuote: (b: { direction: 'offramp' | 'onramp'; rail: string; asset: string; amountMinor: string; currency?: string }) => post<Ok<{ routed: RoutedQuotes }>>('/ramps/quote', b),
  startKyc: (b: { provider: 'bridge' | 'due'; email: string; fullName: string; type: 'individual' | 'business' }) => post<Ok<{ customer: RampCustomer }>>('/ramps/kyc', b),
  kycStatus: (provider: string) => get<Ok<{ customer: RampCustomer }>>(`/ramps/kyc/${provider}`),
  externalAccounts: () => get<Ok<{ externalAccounts: ExternalAccount[] }>>('/ramps/external-accounts'),
  addExternalAccount: (b: Json) => post<Ok<{ externalAccount: ExternalAccount }>>('/ramps/external-accounts', b),
  virtualAccounts: () => get<Ok<{ virtualAccounts: VirtualAccount[] }>>('/ramps/virtual-accounts'),
  createVirtualAccount: (b: { provider: 'bridge' | 'due'; accountId: string; sourceCurrency: string }) => post<Ok<{ virtualAccount: VirtualAccount }>>('/ramps/virtual-accounts', b),
  offramp: (b: { provider?: string; fromAccountId: string; externalAccountId: string; amountMinor: string }, key: string) => post<Ok<OfframpResult>>('/ramps/offramp', b, key),
  rampTransfers: (limit = 50) => get<Ok<{ transfers: RampTransfer[] }>>('/ramps/transfers', { limit }),
  rampTransfer: (id: string) => get<Ok<{ transfer: RampTransfer }>>(`/ramps/transfers/${id}`),
  parseQr: (text: string) => post<Ok<{ payout: PayoutRequest }>>('/ramps/qr/parse', { text }),

  // remittance
  remitQuote: (b: { fromAccountId: string; amountMinor: string; rail?: string; currency?: string }) => post<Ok<Json>>('/remittance/quote', b),
  remitSend: (b: Json, key: string) => post<Ok<{ remittance: Remittance; claimToken?: string; claimLink?: string; claimPath?: string; quote?: unknown }>>('/remittance/send', b, key),
  claimPreview: (token: string) => get<Ok<{ claim: Json }>>(`/remittance/claim/${encodeURIComponent(token)}`),
  claim: (token: string, b: { accountId?: string; choice: 'keep' | 'cashout'; externalAccountId?: string }) => post<Ok<{ remittance: Remittance; cashout?: { rampTransferId?: string; error?: string } }>>(`/remittance/claim/${encodeURIComponent(token)}`, b),
  cancelRemit: (id: string) => post<Ok<{ remittance: Remittance }>>(`/remittance/${id}/cancel`),
  remittances: (limit = 50) => get<Ok<{ sent: Remittance[]; received: Remittance[] }>>('/remittance', { limit }),
  remittance: (id: string) => get<Ok<{ remittance: Remittance }>>(`/remittance/${id}`),
  corridors: () => get<Ok<{ corridors: Json[] }>>('/remittance/corridors'),

  // cards
  cards: (q?: { accountId?: string }) => get<Ok<{ cards: Card[] }>>('/cards', q),
  card: (id: string) => get<Ok<Json>>(`/cards/${id}`),
  issueCard: (b: Json, key: string) => post<Ok<{ card: Card; created?: boolean }>>('/cards', b, key),
  revealKey: (id: string, nonce: string) => post<Ok<{ ephemeralKeySecret: string; expiresAt: number | null; providerCardId: string; provider: string }>>(`/cards/${id}/reveal-key`, { nonce }),
  retryCardSettlements: () => post<Ok<{ attempted: number; settled: number; failed: number }>>('/cards/settlements/retry'),
  cardAction: (id: string, action: 'freeze' | 'unfreeze' | 'cancel') => post<Ok<{ card: Card }>>(`/cards/${id}/${action}`),
  setCardRules: (id: string, rules: CardRules) => put<Ok<{ card: Card }>>(`/cards/${id}/rules`, { rules }),
  simulateCard: (id: string, b: { amountMinor: string; merchantName?: string; mcc?: string; country?: string; at?: string; rules?: CardRules }) => post<Ok<{ simulation: Json }>>(`/cards/${id}/simulate`, b),
  cardTransactions: (id: string, limit = 50) => get<Ok<{ transactions: CardTx[] }>>(`/cards/${id}/transactions`, { limit }),
  cardAuthorizations: (id: string, limit = 50) => get<Ok<{ authorizations: CardAuth[] }>>(`/cards/${id}/authorizations`, { limit }),

  // payments
  invoices: (q?: { role?: 'payer' | 'payee'; status?: string }) => get<Ok<{ invoices: Invoice[] }>>('/payments/invoices', q),
  createInvoice: (b: Json, key: string) => post<Ok<InvoiceView>>('/payments/invoices', b, key),
  publishInvoice: (id: string) => post<Ok<Json>>(`/payments/invoices/${id}/publish`),
  voidInvoice: (id: string) => post<Ok<Json>>(`/payments/invoices/${id}/void`),
  payInvoice: (b: { invoiceId?: string; slug?: string; fromAccountId: string; amountMinor?: string }, key: string) => post<Ok<InvoicePayResult>>('/payments/invoices/pay', b, key),
  escrows: (role?: 'payer' | 'payee' | 'arbiter') => get<Ok<{ escrows: Escrow[] }>>('/escrows', { role }),
  escrow: (id: string) => get<Ok<EscrowView>>(`/escrows/${id}`),
  createEscrow: (b: Json, key: string) => post<Ok<EscrowView>>('/escrows', b, key),
  escrowAction: (id: string, seq: number, action: 'deliver' | 'confirm' | 'dispute' | 'resolve' | 'refund', body?: Json) => post<Ok<EscrowView>>(`/escrows/${id}/milestones/${seq}/${action}`, body),
  streams: (role?: 'payer' | 'payee') => get<Ok<{ streams: StreamView[] }>>('/streams', { role }),
  stream: (id: string) => get<Ok<StreamView>>(`/streams/${id}`),
  createStream: (b: Json, key: string) => post<Ok<StreamView>>('/streams', b, key),
  streamAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'settle') => post<Ok<StreamView>>(`/streams/${id}/${action}`),
  streamUsage: (id: string, units: string, key: string) => post<Ok<StreamView>>(`/streams/${id}/usage`, { units }, key),
  streamAdvance: (id: string, amountMinor: string, key: string) => post<Ok<{ stream: StreamView; advanceId: string; transferId: string | null }>>(`/payroll/ewa/streams/${id}/advance`, { amountMinor }, key),

  // payroll
  payees: () => get<Ok<{ payees: Payee[] }>>('/payroll/payees'),
  createPayee: (b: Json) => post<Ok<Json>>('/payroll/payees', b),
  archivePayee: (id: string) => post<Ok<Json>>(`/payroll/payees/${id}/archive`),
  payrollRuns: () => get<Ok<{ runs: PayrollRun[] }>>('/payroll/runs'),
  createRun: (b: Json) => post<Ok<Json>>('/payroll/runs', b),
  previewRun: (id: string) => get<Ok<PayrollPreview>>(`/payroll/runs/${id}`),
  approveRun: (id: string, approvalToken?: string) => post<Ok<{ run: PayrollRun }>>(`/payroll/runs/${id}/approve`, approvalToken ? { approvalToken } : {}),
  executeRun: (id: string) => post<Ok<PayrollRunResult>>(`/payroll/runs/${id}/execute`),
  retryRun: (id: string) => post<Ok<PayrollRunResult>>(`/payroll/runs/${id}/retry`),
  schedules: () => get<Ok<{ schedules: PayrollSchedule[] }>>('/payroll/schedules'),
  createSchedule: (b: Json) => post<Ok<Json>>('/payroll/schedules', b),
  setScheduleStatus: (id: string, status: string) => post<Ok<Json>>(`/payroll/schedules/${id}/status`, { status }),
  myPayouts: () => get<Ok<{ payouts: Json[] }>>('/payroll/my-payouts'),
  scheduleAdvanceAvailable: (id: string, payeeId: string) => get<Ok<Json>>(`/payroll/ewa/schedules/${id}/${payeeId}`),
  scheduleAdvance: (id: string, payeeId: string, amountMinor: string, key: string) => post<Ok<{ transferId: string | null } & Json>>(`/payroll/ewa/schedules/${id}/${payeeId}/advance`, { amountMinor }, key),

  // business
  orgs: () => get<Ok<{ orgs?: Org[] } & Json>>('/orgs'),
  createOrg: (b: { name: string; reportingCurrency?: string }) => post<Ok<Json>>('/orgs', b),
  org: (id: string) => get<Ok<Json>>(`/orgs/${id}`),
  members: (id: string) => get<Ok<Json>>(`/orgs/${id}/members`),
  invite: (id: string, b: { role: string; team?: string; email?: string; ttlHours?: number }) => post<Ok<Json>>(`/orgs/${id}/invites`, b),
  revokeInvite: (id: string, inviteId: string) => del<Ok<Json>>(`/orgs/${id}/invites/${inviteId}`),
  removeMember: (id: string, userId: number) => del<Ok<Json>>(`/orgs/${id}/members/${userId}`),
  acceptInvite: (token: string) => post<Ok<Json>>('/org-invites/accept', { token }),
  orgAccounts: (id: string) => get<Ok<{ accounts?: BankAccount[] } & Json>>(`/orgs/${id}/accounts`),
  approvals: (id: string, status?: string) => get<Ok<{ requests?: ApprovalRequest[] } & Json>>(`/orgs/${id}/approval-requests`, { status }),
  approve: (reqId: string, comment?: string) => post<Ok<Json>>(`/approval-requests/${reqId}/approve`, comment ? { comment } : {}),
  reject: (reqId: string, comment?: string) => post<Ok<Json>>(`/approval-requests/${reqId}/reject`, comment ? { comment } : {}),
  treasury: (id: string) => get<Ok<Json>>(`/orgs/${id}/treasury`),
  runway: (id: string) => get<Ok<Json>>(`/orgs/${id}/treasury/runway`),
  fxExposure: (id: string) => get<Ok<Json>>(`/orgs/${id}/treasury/fx-exposure`),
  vendors: (id: string) => get<Ok<{ vendors: Vendor[] }>>(`/orgs/${id}/vendors`),
  createVendor: (id: string, b: { name: string; email?: string; payAddress?: string; payChain?: string }) => post<Ok<{ vendor: Vendor }>>(`/orgs/${id}/vendors`, b),
  bills: (id: string, status?: string) => get<Ok<{ bills: Bill[] }>>(`/orgs/${id}/bills`, { status }),
  createBill: (id: string, b: { vendorId: string; reference?: string; amountMinor: string; asset: string; chain: string; dueDate: string }) => post<Ok<{ bill: Bill }>>(`/orgs/${id}/bills`, b),
  scheduleBill: (id: string, billId: string, b: { payFromAccountId: string; scheduledFor: string }) => post<Ok<{ bill: Bill; approvalRequired: boolean }>>(`/orgs/${id}/bills/${billId}/schedule`, b),
  cancelBill: (id: string, billId: string) => post<Ok<Json>>(`/orgs/${id}/bills/${billId}/cancel`),
  booksCsv: (id: string, q?: { from?: string; to?: string }) => reqText(`/orgs/${id}/books/export.csv`, q),

  policies: (id: string) => get<Ok<{ policies: ApprovalPolicy[] }>>(`/orgs/${id}/approval-policies`),
  createPolicy: (id: string, b: { ruleType: 'transfer_over' | 'new_payee' | 'payroll_run'; thresholdMinor?: string; requiredApprovals: number; approverRoles: string[]; expiryHours: number }) => post<Ok<Json>>(`/orgs/${id}/approval-policies`, b),
  deletePolicy: (id: string, policyId: string) => del<Ok<Json>>(`/orgs/${id}/approval-policies/${policyId}`),
  /** payroll_run payload must be exactly { runId, totalMinor }. `required:false` = no policy matches, nothing to approve. */
  requestApproval: (id: string, b: { action: 'payroll_run' | 'new_payee'; payload: Json }) => post<Ok<{ required: false } | { required: true; request: ApprovalRequest }>>(`/orgs/${id}/approval-requests`, b),
  /** Requester only, request must be approved; token lives 15 minutes (expiresInSeconds). */
  approvalToken: (reqId: string) => post<Ok<{ token: string; expiresInSeconds: number; action: string }>>(`/approval-requests/${reqId}/token`),
  cancelApproval: (reqId: string) => post<Ok<Json>>(`/approval-requests/${reqId}/cancel`),
  orgTransfer: (orgId: string, b: { fromAccountId: string; toAccountId?: string; toExternal?: { address: string }; amountMinor: string; memo?: string; approvalToken?: string }, key: string) => post<Ok<OrgTransferResult>>(`/orgs/${orgId}/transfers`, b, key),
  cardBudgets: (id: string) => get<Ok<{ budgets: CardBudget[] }>>(`/orgs/${id}/card-budgets`),
  setCardBudget: (id: string, b: { scope: 'member' | 'team'; scopeId: string; monthlyCapMinor?: string | null; perTxCapMinor?: string | null }) => put<Ok<Json>>(`/orgs/${id}/card-budgets`, b),

  // chains / privacy / network / platform
  feeModel: (b: { asset: string; amountMinor: string; chains: string[] }) => post<Ok<{ model: Json }>>('/chains/fee-model', b),
  metaAddress: () => post<Ok<{ keys: Json; warning: string }>>('/privacy/meta-address'),
  privatePayout: (b: { payeeMetaAddress: string; payoutRef: string }) => post<Ok<{ payout: Json }>>('/privacy/payout-address', b),
  privacyScan: (b: { chain: string; fromBlock: string; viewPrivateKey: string; spendPublicKey: string }) => post<Ok<Json>>('/privacy/scan', b),
  complianceExport: () => get<Ok<{ export: Json }>>('/privacy/compliance-export'),
  setNetworkAddress: (b: Json) => put<Ok<Json>>('/network/address', b),
  platformConfig: () => get<Ok<{ partner: Json }>>('/platform/config'),
  setPlatformConfig: (b: { feeBpsTransfer?: number; feeBpsFx?: number; webhookUrl?: string | null }) => put<Ok<Json>>('/platform/config', b),
  platformCustomers: () => get<Ok<{ customers: Json[] }>>('/platform/customers'),
  createPlatformCustomer: (b: { externalRef: string; displayName?: string; email?: string; country?: string }) => post<Ok<{ customer: Json }>>('/platform/customers', b),
  platformUsage: () => get<Ok<{ usage: Json }>>('/platform/usage'),

  // agents
  mandates: () => get<Ok<{ mandates: Mandate[] }>>('/agents/mandates'),
  revokeMandate: (id: string) => del<Ok<Json>>(`/agents/mandates/${id}`),
  openAgentAccount: (b: Json) => post<Ok<Json>>('/agents/accounts', b),
  resources: () => get<Ok<{ resources: AgentResource[] }>>('/agents/resources'),
  registerResource: (b: Json) => post<Ok<Json>>('/agents/resources', b),
  setResource: (id: string, action: 'enable' | 'disable') => post<Ok<Json>>(`/agents/resources/${id}/${action}`),
  directory: (q?: { asset?: string; limit?: number }) => get<Ok<{ resources: AgentResource[] }>>('/agents/directory', q),

  // segments
  segments: () => get<Ok<{ segments: SegmentProfile[] }>>('/segments'),
  features: (accountId: string) => get<Ok<{ effective: EffectiveFeatures }>>(`/accounts/${accountId}/features`),
  setSegment: (accountId: string, segment: string | null) => put<Ok<{ effective: EffectiveFeatures }>>(`/accounts/${accountId}/segment`, { segment }),
  patch,
}

/**
 * Public, unauthenticated invoice lookup (api-ts routes/bank/payments.ts bankPublicRoutes, mounted at
 * `/public/bank/invoices/:slug` on the API host). Deliberately bypasses `api.rawRequest` so no auth header is sent.
 */
export async function fetchPublicInvoice(slug: string): Promise<PublicInvoice> {
  const base = import.meta.env.VITE_API_URL || ''
  const res = await fetch(`${base}/public/bank/invoices/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } })
  const parsed = await parse(res)
  if (!res.ok) throw toError(res, parsed)
  const inv = (parsed as { invoice?: PublicInvoice } | null)?.invoice
  if (!inv) throw new BankApiError('Invoice not found', 404, 'NOT_FOUND')
  return inv
}

/** Link a payer opens in the app: a real page, not the JSON endpoint. */
export function invoicePayLink(slug: string): string {
  return `${window.location.origin}/pay/${encodeURIComponent(slug)}`
}
