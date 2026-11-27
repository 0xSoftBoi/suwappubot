/**
 * BankCardService (M6) — cards on a stablecoin (or credit) balance.
 *
 * Money model
 * - Authorization request: rules engine -> funds check (ledger balance - active holds, or
 *   undrawn credit) -> hold row, all under a row lock on the funding account.
 * - Capture (issuing_transaction): hold -> captured, ledger debit + queued onchain settlement
 *   transfer (type 'card') to the program settlement address via BankTransferService.
 * - Reversal/expiry: hold released. Refund: ledger credit from the `external` system account.
 * Amounts: `amountMinor` = asset minor units (ledger); `providerAmountMinor` = card-currency
 * minor units (cents). No PAN/CVC is ever stored or logged.
 */
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Either, Layer, Option } from 'effect'
import { EnvService } from '../../config/EnvService'
import {
	type BankAccount,
	type BankCard,
	type BankCardAuthorization,
	type BankCardTransaction,
	bankAccounts,
	bankCardAuthorizations,
	bankCardHolds,
	bankCardholders,
	bankCards,
	bankCardTransactions,
	bankTransfers,
	type DrizzleService,
} from '../../db'
import { findAsset } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import type {
	AuthorizationDecision,
	AuthorizationRequest,
	CardholderInput,
	CardProvider,
	CardProviderName,
	ProviderTransaction,
	WebhookEvent,
	WebhookHttpResponse,
} from './cards/CardProvider'
import { makeRainProvider } from './cards/RainProvider'
import {
	type NormalizedRules,
	type RuleDecision,
	type Spend,
	evaluateAuthorization,
	parseRules,
	serializeRules,
	shouldAutoFreeze,
	toNativeControls,
} from './cards/rules'
import { makeStripeIssuingProvider } from './cards/StripeIssuingProvider'
import { type BankOwner, bankDb, newId } from './db'
import { BankError, bankErr } from './errors'

export type CardDeps = BankDeps | BankTransferService | EnvService
type Fx<A> = Effect.Effect<A, BankError, CardDeps>

const HOLD_TTL_MS = 7 * 24 * 3600 * 1000
const HISTORY_MS = 40 * 24 * 3600 * 1000
const MAX_CARDS_PER_OWNER = 50
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF'])

// -------------------------------------------------------------------- credit hook (M3, optional)

/** Tiny local view of M3's BankCreditService; looked up by tag key at runtime (may not exist). */
export interface CardCreditHook {
	readonly undrawnLimit: (lineId: string) => Effect.Effect<bigint, BankError, DrizzleService>
	readonly drawForCard: (
		lineId: string,
		amountMinor: bigint,
		ctx: { cardId: string; providerTransactionId: string },
	) => Effect.Effect<unknown, BankError, DrizzleService>
	readonly repayForRefund?: (
		lineId: string,
		amountMinor: bigint,
		ctx: { cardId: string; providerTransactionId: string },
	) => Effect.Effect<unknown, BankError, DrizzleService>
}
const CreditHookTag = Context.GenericTag<CardCreditHook>('BankCreditService')

const creditHook = (): Effect.Effect<CardCreditHook, BankError> =>
	Effect.map(Effect.serviceOption(CreditHookTag), Option.getOrNull).pipe(
		Effect.flatMap((svc) =>
			svc && typeof svc.drawForCard === 'function' && typeof svc.undrawnLimit === 'function'
				? Effect.succeed(svc)
				: Effect.fail(
						bankErr('NOT_CONFIGURED', 'BANK_CREDIT_SERVICE_UNAVAILABLE: BankCreditService.drawForCard/undrawnLimit not registered (M3)', {
							missing: 'BankCreditService',
						}),
					),
		),
	)
const lineIdOf = (a: BankAccount): string => String((a.metadata as Record<string, unknown>)?.creditLineId ?? a.id)

// -------------------------------------------------------------------- helpers

const fiatDecimals = (cur: string) => (ZERO_DECIMAL.has(cur.toUpperCase()) ? 0 : 2)
/** Card-currency minor units -> asset minor units (ledger). Rounds UP when the asset has fewer decimals. */
export function providerToAssetMinor(providerMinor: bigint, currency: string, assetDecimals: number): bigint {
	const diff = assetDecimals - fiatDecimals(currency)
	if (diff >= 0) return providerMinor * 10n ** BigInt(diff)
	const d = 10n ** BigInt(-diff)
	return (providerMinor + d - 1n) / d
}
const mkId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '')}`
const big = (v: unknown): bigint => BigInt(typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' ? v : '0')
const familyOf = (chain: string): 'evm' | 'solana' => (chain === 'solana' ? 'solana' : 'evm')
const sanitizeMeta = (o: Record<string, string | null | undefined>): Record<string, string> =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [k, String(v).slice(0, 480)]))

const providerFor = (name: CardProviderName): Effect.Effect<CardProvider, BankError, EnvService> =>
	Effect.gen(function* () {
		const env = yield* EnvService
		if (name === 'rain') return makeRainProvider({ apiKey: env.RAIN_API_KEY, baseUrl: env.RAIN_API_BASE_URL })
		return makeStripeIssuingProvider({
			secretKey: env.STRIPE_SECRET_KEY,
			enabled: env.STRIPE_ISSUING_ENABLED,
			webhookSecret: env.STRIPE_ISSUING_WEBHOOK_SECRET,
		})
	})

const settlementAddress = (chain: string): Effect.Effect<string, BankError, EnvService> =>
	Effect.gen(function* () {
		const env = yield* EnvService
		const fam = familyOf(chain)
		const v = fam === 'solana' ? env.BANK_CARD_SETTLEMENT_ADDRESS_SOLANA : env.BANK_CARD_SETTLEMENT_ADDRESS_EVM
		const key = fam === 'solana' ? 'BANK_CARD_SETTLEMENT_ADDRESS_SOLANA' : 'BANK_CARD_SETTLEMENT_ADDRESS_EVM'
		if (!v) return yield* Effect.fail(bankErr('NOT_CONFIGURED', `PROVIDER_NOT_CONFIGURED: ${key}`, { missing: key }))
		return v
	})

// -------------------------------------------------------------------- types

export interface IssueCardInput {
	accountId: string
	idempotencyKey: string
	type: 'virtual' | 'physical'
	provider?: CardProviderName | undefined
	label?: string | undefined
	rules?: unknown
	orgId?: string | undefined
	memberId?: string | undefined
	teamId?: string | undefined
	expenseCategory?: string | undefined
	memo?: string | undefined
	cardholder?: CardholderInput | undefined
	/** Client IP, captured server-side for the issuer's terms-acceptance record. */
	clientIp?: string | undefined
	termsAccepted?: boolean | undefined
	shipping?: NonNullable<Parameters<CardProvider['issueCard']>[0]['shipping']> | undefined
}

export interface SimulateInput {
	amountMinor: string
	merchantName?: string | undefined
	mcc?: string | undefined
	country?: string | undefined
	/** ISO instant; defaults to now. Lets callers dry-run "what if I swipe on 2026-12-03". */
	at?: string | undefined
	/** Evaluate these rules instead of the stored ones (preview before saving). */
	rules?: unknown
}

export interface CardView extends Omit<BankCard, never> {
	availableMinor?: string
}

export interface BankCardServiceInterface {
	readonly issueCard: (owner: BankOwner, input: IssueCardInput) => Fx<{ card: BankCard; created: boolean }>
	readonly listCards: (owner: BankOwner, f: { accountId?: string | undefined; memberId?: string | undefined; orgId?: string | undefined }) => Fx<BankCard[]>
	readonly getCard: (owner: BankOwner, cardId: string) => Fx<{ card: BankCard; availableMinor: string | null }>
	readonly setStatus: (owner: BankOwner, cardId: string, status: 'active' | 'frozen' | 'canceled') => Fx<BankCard>
	readonly updateRules: (owner: BankOwner, cardId: string, rules: unknown) => Fx<BankCard>
	readonly simulate: (owner: BankOwner, cardId: string, input: SimulateInput) => Fx<Record<string, unknown>>
	readonly revealKey: (owner: BankOwner, cardId: string, nonce: string) => Fx<{ ephemeralKeySecret: string; expiresAt: number | null; providerCardId: string; provider: string }>
	readonly listTransactions: (owner: BankOwner, cardId: string, limit: number) => Fx<BankCardTransaction[]>
	readonly listAuthorizations: (owner: BankOwner, cardId: string, limit: number) => Fx<BankCardAuthorization[]>
	readonly addReceipt: (owner: BankOwner, authorizationId: string, receipt: Record<string, unknown>) => Fx<BankCardAuthorization>
	readonly setExpense: (owner: BankOwner, authorizationId: string, e: { expenseCategory?: string | undefined; memo?: string | undefined }) => Fx<BankCardAuthorization>
	readonly retrySettlements: (owner: BankOwner) => Fx<{ attempted: number; settled: number; failed: number }>
	/** Provider webhook entry. Returns the HTTP reply (sync auth decision or ack). */
	readonly handleWebhook: (provider: CardProviderName, rawBody: string, signature: string | undefined) => Fx<WebhookHttpResponse>
}

export class BankCardService extends Context.Tag('BankCardService')<BankCardService, BankCardServiceInterface>() {}

// -------------------------------------------------------------------- queries

const loadCard = (owner: BankOwner, cardId: string): Fx<BankCard> =>
	bankDb(async (db) => {
		const [c] = await db
			.select()
			.from(bankCards)
			.where(and(eq(bankCards.id, cardId), eq(bankCards.ownerType, owner.ownerType), eq(bankCards.ownerId, owner.ownerId)))
			.limit(1)
		if (!c) throw bankErr('NOT_FOUND', 'Card not found')
		return c
	})

const normalizeRules = (raw: unknown): Effect.Effect<NormalizedRules, BankError> => {
	const r = parseRules(raw)
	return Either.isLeft(r) ? Effect.fail(bankErr('VALIDATION', r.left)) : Effect.succeed(r.right)
}

interface Ctx {
	cardHistory: Spend[]
	memberHistory: Spend[]
	teamHistory: Spend[]
	priorUseCount: number
}

/** Real spend history (active holds + captures - refunds) for the card and its member/team peers. */
const loadHistory = (card: BankCard, rules: NormalizedRules, now: number): Fx<Ctx> =>
	bankDb(async (db) => {
		const since = new Date(now - HISTORY_MS)
		const peers = async (col: 'memberId' | 'teamId', val: string | null): Promise<string[]> => {
			if (!val) return [card.id]
			const rows = await db
				.select({ id: bankCards.id })
				.from(bankCards)
				.where(and(eq(bankCards.ownerType, card.ownerType), eq(bankCards.ownerId, card.ownerId), eq(bankCards[col], val), eq(bankCards.currency, card.currency)))
			return rows.map((r) => r.id)
		}
		const memberIds = rules.memberCaps ? await peers('memberId', card.memberId) : []
		const teamIds = rules.teamCaps ? await peers('teamId', card.teamId) : []
		const all = [...new Set([card.id, ...memberIds, ...teamIds])]
		const holds = await db
			.select({ cardId: bankCardHolds.cardId, at: bankCardHolds.createdAt, amt: bankCardAuthorizations.providerAmountMinor })
			.from(bankCardHolds)
			.innerJoin(bankCardAuthorizations, eq(bankCardAuthorizations.id, bankCardHolds.authorizationId))
			.where(and(inArray(bankCardHolds.cardId, all), eq(bankCardHolds.status, 'active'), gt(bankCardHolds.expiresAt, new Date(now)), gt(bankCardHolds.createdAt, since)))
		const txns = await db
			.select({ cardId: bankCardTransactions.cardId, at: bankCardTransactions.createdAt, type: bankCardTransactions.type, amt: bankCardTransactions.providerAmountMinor })
			.from(bankCardTransactions)
			.where(and(inArray(bankCardTransactions.cardId, all), gt(bankCardTransactions.createdAt, since)))
		const spends: Array<{ cardId: string; s: Spend }> = [
			...holds.map((h) => ({ cardId: h.cardId, s: { at: h.at.getTime(), amountMinor: big(h.amt) } })),
			...txns.map((t) => ({ cardId: t.cardId, s: { at: t.at.getTime(), amountMinor: t.type === 'capture' ? big(t.amt) : -big(t.amt) } })),
		]
		const pick = (ids: string[]) => spends.filter((x) => ids.includes(x.cardId)).map((x) => x.s)
		const [used] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(bankCardAuthorizations)
			.where(and(eq(bankCardAuthorizations.cardId, card.id), eq(bankCardAuthorizations.decision, 'approved'), inArray(bankCardAuthorizations.status, ['pending', 'captured'])))
		return { cardHistory: pick([card.id]), memberHistory: pick(memberIds), teamHistory: pick(teamIds), priorUseCount: used?.n ?? 0 }
	})

/** Ledger balance minus active (unexpired) holds. */
const availableOf = (account: BankAccount): Fx<bigint> =>
	Effect.gen(function* () {
		const held = yield* bankDb(async (db) => {
			const r = await db.execute(
				sql`select coalesce(sum(amount_minor),0)::text as s from bank_card_holds where account_id = ${account.id} and status = 'active' and expires_at > now()`,
			)
			return big((r as unknown as Array<{ s: string }>)[0]?.s ?? '0')
		})
		if (account.kind === 'credit') {
			const hook = yield* creditHook()
			const undrawn = yield* hook.undrawnLimit(lineIdOf(account))
			return undrawn - held
		}
		const ledger = yield* BankLedgerService
		return (yield* ledger.balance(account.id)) - held
	})

// -------------------------------------------------------------------- authorization decision

interface Decided {
	decision: 'approved' | 'declined'
	decidedBy: string
	reason: string
}

const decideAuthorization = (provider: CardProvider, req: AuthorizationRequest): Fx<AuthorizationDecision> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const found = yield* bankDb(async (db) => {
			const [c] = await db
				.select()
				.from(bankCards)
				.where(and(eq(bankCards.provider, provider.name), eq(bankCards.providerCardId, req.providerCardId)))
				.limit(1)
			if (!c) return null
			const [a] = await db.select().from(bankCardAuthorizations).where(eq(bankCardAuthorizations.providerAuthorizationId, req.providerAuthorizationId)).limit(1)
			return { card: c, existing: a ?? null }
		})
		if (!found) return { approved: false } // unknown card: nothing to attribute the decision to
		const { card, existing } = found
		if (existing) return { approved: existing.decision === 'approved' } // provider retry: replay recorded decision

		const account = yield* ledger.getAccountById(card.accountId)
		const asset = findAsset(account.asset, account.chain)
		const now = Date.now()

		let verdict: Decided = { decision: 'approved', decidedBy: 'approved', reason: 'All rules passed' }
		let rules: NormalizedRules | null = null
		const declineWith = (decidedBy: string, reason: string) => {
			verdict = { decision: 'declined', decidedBy, reason }
		}
		const parsed = parseRules(card.rules)
		if (Either.isRight(parsed)) rules = parsed.right

		let assetAmount = 0n
		if (card.status !== 'active') declineWith('card_status', `Card is ${card.status}`)
		else if (account.status !== 'active') declineWith('account_status', `Funding account is ${account.status}`)
		else if (!asset) declineWith('asset', 'Funding asset unsupported')
		else if (req.currency !== card.currency.toUpperCase()) declineWith('currency', `Authorization currency ${req.currency} != card currency ${card.currency}`)
		else if (!rules) declineWith('rules_invalid', 'Stored card rules are invalid; failing closed')
		else {
			assetAmount = providerToAssetMinor(req.amountMinor, req.currency, asset.decimals)
			const ctx = yield* loadHistory(card, rules, now)
			const d: RuleDecision = evaluateAuthorization(rules, {
				now,
				amountMinor: req.amountMinor,
				merchantName: req.merchantName,
				mcc: req.mcc,
				country: req.merchantCountry,
				...ctx,
			})
			if (!d.approved) declineWith(d.decidedBy, d.reason)
		}

		// Credit-funded: undrawn limit is looked up outside the DB transaction (typed failure -> decline).
		let creditBase: bigint | null = null
		if (verdict.decision === 'approved' && account.kind === 'credit') {
			const r = yield* Effect.either(
				Effect.flatMap(creditHook(), (h) => h.undrawnLimit(lineIdOf(account))),
			)
			if (Either.isLeft(r)) declineWith('credit_unavailable', r.left.message)
			else creditBase = r.right
		}

		const authId = mkId('auth')
		const out = yield* bankDb(async (db) =>
			db.transaction(async (tx) => {
				let v: Decided = verdict
				let holdId: string | null = null
				// Serialize concurrent authorizations on this funding account.
				const locked = (await tx.execute(sql`select balance_minor::text as b from bank_accounts where id = ${account.id} for update`)) as unknown as Array<{ b: string }>
				if (v.decision === 'approved') {
					const held = big(
						((await tx.execute(
							sql`select coalesce(sum(amount_minor),0)::text as s from bank_card_holds where account_id = ${account.id} and status = 'active' and expires_at > now()`,
						)) as unknown as Array<{ s: string }>)[0]?.s ?? '0',
					)
					const base = creditBase ?? big(locked[0]?.b ?? '0')
					if (base - held < assetAmount)
						v = { decision: 'declined', decidedBy: 'balance', reason: `Insufficient available balance (${base - held} < ${assetAmount})` }
				}
				const ins = await tx
					.insert(bankCardAuthorizations)
					.values({
						id: authId,
						cardId: card.id,
						providerAuthorizationId: req.providerAuthorizationId,
						amountMinor: assetAmount.toString(),
						providerAmountMinor: req.amountMinor.toString(),
						currency: req.currency,
						merchantAmountMinor: req.merchantAmountMinor?.toString() ?? null,
						merchantCurrency: req.merchantCurrency,
						merchantName: req.merchantName?.slice(0, 200) ?? null,
						mcc: req.mcc,
						merchantCountry: req.merchantCountry,
						decision: v.decision,
						decidedBy: v.decidedBy,
						reason: v.reason,
						status: v.decision === 'approved' ? 'pending' : 'declined',
						memberId: card.memberId,
						orgId: card.orgId,
						teamId: card.teamId,
						expenseCategory: card.expenseCategory,
						memo: card.memo,
					})
					.onConflictDoNothing()
					.returning({ id: bankCardAuthorizations.id })
				if (ins.length === 0) {
					const [ex] = await tx.select().from(bankCardAuthorizations).where(eq(bankCardAuthorizations.providerAuthorizationId, req.providerAuthorizationId)).limit(1)
					return { approved: ex?.decision === 'approved', freeze: false }
				}
				if (v.decision === 'approved') {
					holdId = mkId('hold')
					await tx.insert(bankCardHolds).values({
						id: holdId,
						cardId: card.id,
						accountId: account.id,
						authorizationId: authId,
						amountMinor: assetAmount.toString(),
						expiresAt: new Date(now + HOLD_TTL_MS),
					})
					await tx.update(bankCardAuthorizations).set({ holdId }).where(eq(bankCardAuthorizations.id, authId))
					await tx.update(bankCards).set({ declineStreak: 0, updatedAt: new Date() }).where(eq(bankCards.id, card.id))
					return { approved: true, freeze: false }
				}
				const [upd] = await tx
					.update(bankCards)
					.set({ declineStreak: sql`${bankCards.declineStreak} + 1`, updatedAt: new Date() })
					.where(eq(bankCards.id, card.id))
					.returning({ streak: bankCards.declineStreak })
				const freeze = !!rules && shouldAutoFreeze(rules, upd?.streak ?? 0) && card.status === 'active'
				if (freeze) await tx.update(bankCards).set({ status: 'frozen', updatedAt: new Date() }).where(eq(bankCards.id, card.id))
				return { approved: false, freeze }
			}),
		)
		if (out.freeze) {
			// Best effort: DB is already frozen (we decline anyway); mirror at the provider.
			yield* Effect.ignore(provider.setStatus(card.providerCardId, 'frozen'))
		}
		return { approved: out.approved }
	})

// -------------------------------------------------------------------- authorization updates

const handleAuthUpdate = (e: Extract<WebhookEvent, { kind: 'authorization_update' }>): Fx<void> =>
	bankDb(async (db) => {
		const terminal = ['closed', 'reversed', 'expired'].includes(e.status)
		const releasing = e.status === 'reversed' || e.status === 'expired' || (terminal && !e.approved)
		if (!releasing) return
		await db.transaction(async (tx) => {
			const [a] = await tx.select().from(bankCardAuthorizations).where(eq(bankCardAuthorizations.providerAuthorizationId, e.providerAuthorizationId)).limit(1)
			if (!a) return
			const reason = e.status === 'closed' ? 'provider_declined' : e.status
			if (a.holdId) {
				await tx
					.update(bankCardHolds)
					.set({ status: 'released', releaseReason: reason, updatedAt: new Date() })
					.where(and(eq(bankCardHolds.id, a.holdId), eq(bankCardHolds.status, 'active')))
			}
			if (a.status === 'pending')
				await tx
					.update(bankCardAuthorizations)
					.set({
						status: e.status === 'expired' ? 'expired' : e.status === 'reversed' ? 'reversed' : 'declined',
						...(e.status === 'closed' && a.decision === 'approved' ? { decision: 'declined' as const, decidedBy: 'provider', reason: 'Provider declined (e.g. webhook timeout)' } : {}),
						updatedAt: new Date(),
					})
					.where(eq(bankCardAuthorizations.id, a.id))
		})
	})

// -------------------------------------------------------------------- transactions (capture / refund)

const settleCapture = (card: BankCard, txn: BankCardTransaction): Fx<void> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const account = yield* ledger.getAccountById(card.accountId)
		const amount = big(txn.amountMinor)
		const owner: BankOwner = { ownerType: card.ownerType as BankOwner['ownerType'], ownerId: card.ownerId }

		if (txn.type === 'capture') {
			// MONEY-PATH: debit the funding account and queue the onchain settlement transfer.
			if (account.kind === 'credit') {
				const hook = yield* creditHook()
				yield* hook.drawForCard(lineIdOf(account), amount, { cardId: card.id, providerTransactionId: txn.providerTransactionId })
			}
			const addr = yield* settlementAddress(account.chain)
			const transfers = yield* BankTransferService
			const t = yield* transfers.transfer({
				owner,
				idempotencyKey: `card_cap_${txn.providerTransactionId}`.slice(0, 128),
				type: 'card',
				fromAccountId: account.id,
				toExternal: { address: addr },
				amountMinor: amount.toString(),
				memo: `Card ${txn.merchantName ?? ''}`.slice(0, 280),
				metadata: { cardId: card.id, cardTransactionId: txn.id, providerTransactionId: txn.providerTransactionId },
			})
			yield* bankDb((db) =>
				db.update(bankCardTransactions).set({ transferId: t.id, settlementStatus: 'queued', settlementError: null }).where(eq(bankCardTransactions.id, txn.id)),
			)
			return
		}

		// MONEY-PATH: refund credits the account from the `external` system account (idempotent per provider txn).
		if (account.kind === 'credit') {
			const hook = yield* creditHook()
			if (!hook.repayForRefund)
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'BANK_CREDIT_SERVICE_UNAVAILABLE: repayForRefund hook missing (M3)', { missing: 'BankCreditService.repayForRefund' }))
			yield* hook.repayForRefund(lineIdOf(account), amount, { cardId: card.id, providerTransactionId: txn.providerTransactionId })
		} else {
			const external = yield* ledger.ensureSystemAccount('external', account.asset, account.chain)
			const tid = yield* bankDb(async (db) => {
				const key = `card_ref_${txn.providerTransactionId}`.slice(0, 128)
				const [row] = await db
					.insert(bankTransfers)
					.values({
						id: newId('xfer'),
						ownerType: owner.ownerType,
						ownerId: owner.ownerId,
						idempotencyKey: key,
						requestHash: key,
						type: 'card',
						toAccount: account.id,
						amountMinor: amount.toString(),
						asset: account.asset,
						chain: account.chain,
						status: 'confirmed',
						confirmedAt: new Date(),
						memo: `Card refund ${txn.merchantName ?? ''}`.slice(0, 280),
						metadata: { refund: true, cardId: card.id, providerTransactionId: txn.providerTransactionId },
					})
					.onConflictDoNothing()
					.returning({ id: bankTransfers.id })
				if (row) return row.id
				const [ex] = await db.select({ id: bankTransfers.id }).from(bankTransfers).where(and(eq(bankTransfers.ownerType, owner.ownerType), eq(bankTransfers.ownerId, owner.ownerId), eq(bankTransfers.idempotencyKey, key))).limit(1)
				return ex!.id
			})
			yield* ledger.post({
				transferId: tid,
				phase: 'card_refund',
				legs: [
					{ accountId: external.id, direction: 'debit', amountMinor: amount },
					{ accountId: account.id, direction: 'credit', amountMinor: amount },
				],
			})
			yield* bankDb((db) => db.update(bankCardTransactions).set({ transferId: tid }).where(eq(bankCardTransactions.id, txn.id)))
		}
		yield* bankDb((db) => db.update(bankCardTransactions).set({ settlementStatus: 'settled', settlementError: null }).where(eq(bankCardTransactions.id, txn.id)))
	})

const settleSafely = (card: BankCard, txn: BankCardTransaction): Fx<boolean> =>
	Effect.matchEffect(settleCapture(card, txn), {
		onSuccess: () => Effect.succeed(true),
		onFailure: (e) =>
			Effect.as(
				bankDb((db) =>
					db.update(bankCardTransactions).set({ settlementStatus: 'failed', settlementError: `${e.code}: ${e.message}`.slice(0, 500) }).where(eq(bankCardTransactions.id, txn.id)),
				),
				false,
			),
	})

const handleTransaction = (provider: CardProvider, t: ProviderTransaction): Fx<void> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const card = yield* bankDb(async (db) => (await db.select().from(bankCards).where(and(eq(bankCards.provider, provider.name), eq(bankCards.providerCardId, t.providerCardId))).limit(1))[0] ?? null)
		if (!card) return
		const account = yield* ledger.getAccountById(card.accountId)
		const asset = findAsset(account.asset, account.chain)
		if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${account.asset} on ${account.chain}`))
		const assetAmount = providerToAssetMinor(t.amountMinor, t.currency, asset.decimals)

		const txn = yield* bankDb(async (db) =>
			db.transaction(async (tx) => {
				const [auth] = t.providerAuthorizationId
					? await tx.select().from(bankCardAuthorizations).where(eq(bankCardAuthorizations.providerAuthorizationId, t.providerAuthorizationId)).limit(1)
					: []
				const [row] = await tx
					.insert(bankCardTransactions)
					.values({
						id: mkId('ctxn'),
						cardId: card.id,
						authorizationId: auth?.id ?? null,
						providerTransactionId: t.providerTransactionId,
						type: t.type,
						amountMinor: assetAmount.toString(),
						providerAmountMinor: t.amountMinor.toString(),
						currency: t.currency,
						merchantName: t.merchantName?.slice(0, 200) ?? null,
						mcc: t.mcc,
						merchantCountry: t.merchantCountry,
						memberId: auth?.memberId ?? card.memberId,
						orgId: auth?.orgId ?? card.orgId,
						teamId: auth?.teamId ?? card.teamId,
						expenseCategory: auth?.expenseCategory ?? card.expenseCategory,
						memo: auth?.memo ?? card.memo,
					})
					.onConflictDoNothing()
					.returning()
				if (!row) {
					// Replay: only re-drive settlement if a previous attempt never finished.
					const [ex] = await tx.select().from(bankCardTransactions).where(eq(bankCardTransactions.providerTransactionId, t.providerTransactionId)).limit(1)
					return ex && (ex.settlementStatus === 'pending' || ex.settlementStatus === 'failed') ? ex : null
				}
				if (t.type === 'capture' && auth) {
					if (auth.holdId)
						await tx.update(bankCardHolds).set({ status: 'captured', updatedAt: new Date() }).where(and(eq(bankCardHolds.id, auth.holdId), eq(bankCardHolds.status, 'active')))
					await tx.update(bankCardAuthorizations).set({ status: 'captured', updatedAt: new Date() }).where(eq(bankCardAuthorizations.id, auth.id))
				}
				return row
			}),
		)
		if (!txn) return
		const ok = yield* settleSafely(card, txn)
		// Single-use cards die after their first capture (best effort at the provider).
		if (ok && txn.type === 'capture' && card.singleUse && card.status === 'active') {
			yield* bankDb((db) => db.update(bankCards).set({ status: 'canceled', updatedAt: new Date() }).where(eq(bankCards.id, card.id)))
			yield* Effect.ignore(provider.setStatus(card.providerCardId, 'canceled'))
		}
		// Settlement failure is recorded (status 'failed') and retryable; never throw back at the provider.
	})

// -------------------------------------------------------------------- implementation

const impl: BankCardServiceInterface = {
	issueCard: (owner, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const providerName: CardProviderName = input.provider ?? 'stripe'
			const provider = yield* providerFor(providerName)
			const account = yield* ledger.getAccount(owner, input.accountId)
			if (account.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Account is ${account.status}`))
			if (!['checking', 'credit', 'treasury'].includes(account.kind))
				return yield* Effect.fail(bankErr('VALIDATION', `Cards cannot be funded from a ${account.kind} account`))
			const asset = findAsset(account.asset, account.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${account.asset}`))
			if (input.type === 'physical' && !input.shipping) return yield* Effect.fail(bankErr('VALIDATION', 'shipping is required for physical cards'))
			const rules = yield* normalizeRules(input.rules ?? {})
			if (account.kind === 'credit') yield* creditHook() // typed error up front when M3 is absent

			const existing = yield* bankDb(async (db) => {
				const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(bankCards).where(and(eq(bankCards.ownerType, owner.ownerType), eq(bankCards.ownerId, owner.ownerId), sql`${bankCards.status} <> 'canceled'`))
				return n?.n ?? 0
			})
			if (existing >= MAX_CARDS_PER_OWNER) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Max ${MAX_CARDS_PER_OWNER} active cards`))

			// Cardholder: one per (owner, provider, member).
			const memberKey = input.memberId ?? ''
			let holder = yield* bankDb(async (db) => (await db.select().from(bankCardholders).where(and(eq(bankCardholders.ownerType, owner.ownerType), eq(bankCardholders.ownerId, owner.ownerId), eq(bankCardholders.provider, providerName), sql`coalesce(${bankCardholders.memberId}, '') = ${memberKey}`)).limit(1))[0] ?? null)
			if (!holder) {
				const ch = input.cardholder
				if (!ch) return yield* Effect.fail(bankErr('VALIDATION', 'cardholder details are required for the first card of this owner/member'))
				if (!input.termsAccepted) return yield* Effect.fail(bankErr('VALIDATION', 'termsAccepted must be true (issuer cardholder terms)'))
				const created = yield* provider.createCardholder({
					...ch,
					termsAcceptance: { date: Math.floor(Date.now() / 1000), ip: input.clientIp ?? '0.0.0.0' },
					metadata: sanitizeMeta({ owner_type: owner.ownerType, owner_id: owner.ownerId, member_id: input.memberId }),
				})
				holder = yield* bankDb(async (db) => {
					const [row] = await db
						.insert(bankCardholders)
						.values({ id: mkId('chld'), ownerType: owner.ownerType, ownerId: owner.ownerId, memberId: input.memberId ?? null, provider: providerName, providerCardholderId: created.providerCardholderId })
						.onConflictDoNothing()
						.returning()
					if (row) return row
					const [ex] = await db.select().from(bankCardholders).where(and(eq(bankCardholders.provider, providerName), eq(bankCardholders.providerCardholderId, created.providerCardholderId))).limit(1)
					return ex!
				})
			}

			const cardId = mkId('card')
			const pc = yield* provider.issueCard({
				providerCardholderId: holder.providerCardholderId,
				type: input.type,
				currency: asset.currency,
				status: 'active',
				controls: toNativeControls(rules),
				shipping: input.shipping,
				metadata: sanitizeMeta({ bank_card_id: cardId, owner_type: owner.ownerType, owner_id: owner.ownerId, account_id: account.id, member_id: input.memberId, org_id: input.orgId }),
				idempotencyKey: `bank_card_${owner.ownerType}_${owner.ownerId}_${input.idempotencyKey}`.slice(0, 255),
			})
			const saved = yield* Effect.either(
				bankDb(async (db) => {
					const [row] = await db
						.insert(bankCards)
						.values({
							id: cardId,
							ownerType: owner.ownerType,
							ownerId: owner.ownerId,
							accountId: account.id,
							provider: providerName,
							providerCardId: pc.providerCardId,
							cardholderId: holder!.id,
							type: input.type,
							status: pc.status === 'inactive' ? 'pending' : pc.status,
							currency: asset.currency,
							brand: pc.brand,
							last4: pc.last4,
							expMonth: pc.expMonth,
							expYear: pc.expYear,
							label: input.label ?? null,
							rules: serializeRules(rules),
							singleUse: rules.singleUse,
							orgId: input.orgId ?? null,
							memberId: input.memberId ?? null,
							teamId: input.teamId ?? null,
							expenseCategory: input.expenseCategory ?? null,
							memo: input.memo ?? null,
						})
						.onConflictDoNothing()
						.returning()
					if (row) return { card: row, created: true }
					const [ex] = await db.select().from(bankCards).where(and(eq(bankCards.provider, providerName), eq(bankCards.providerCardId, pc.providerCardId))).limit(1)
					return { card: ex!, created: false }
				}),
			)
			if (Either.isLeft(saved)) {
				// Don't leave a live card at the provider that we cannot account for.
				yield* Effect.ignore(provider.setStatus(pc.providerCardId, 'canceled'))
				return yield* Effect.fail(saved.left)
			}
			return saved.right
		}),

	listCards: (owner, f) =>
		bankDb((db) =>
			db
				.select()
				.from(bankCards)
				.where(
					and(
						eq(bankCards.ownerType, owner.ownerType),
						eq(bankCards.ownerId, owner.ownerId),
						f.accountId ? eq(bankCards.accountId, f.accountId) : undefined,
						f.memberId ? eq(bankCards.memberId, f.memberId) : undefined,
						f.orgId ? eq(bankCards.orgId, f.orgId) : undefined,
					),
				)
				.orderBy(desc(bankCards.createdAt))
				.limit(200),
		),

	getCard: (owner, cardId) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			const ledger = yield* BankLedgerService
			const account = yield* ledger.getAccountById(card.accountId)
			const avail = yield* Effect.either(availableOf(account))
			return { card, availableMinor: Either.isRight(avail) ? avail.right.toString() : null }
		}),

	setStatus: (owner, cardId, status) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			if (card.status === 'canceled') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Card is canceled (terminal)'))
			if (card.status === status) return card
			const provider = yield* providerFor(card.provider)
			yield* provider.setStatus(card.providerCardId, status)
			return yield* bankDb(async (db) => {
				const [row] = await db.update(bankCards).set({ status, declineStreak: status === 'active' ? 0 : card.declineStreak, updatedAt: new Date() }).where(eq(bankCards.id, card.id)).returning()
				if (status === 'canceled') {
					// Release every open hold so the funds are spendable again.
					await db.update(bankCardHolds).set({ status: 'released', releaseReason: 'card_canceled', updatedAt: new Date() }).where(and(eq(bankCardHolds.cardId, card.id), eq(bankCardHolds.status, 'active')))
				}
				return row!
			})
		}),

	updateRules: (owner, cardId, raw) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			if (card.status === 'canceled') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Card is canceled'))
			const rules = yield* normalizeRules(raw)
			const provider = yield* providerFor(card.provider)
			yield* provider.updateSpendingControls(card.providerCardId, toNativeControls(rules), card.currency)
			return yield* bankDb(async (db) => {
				const [row] = await db.update(bankCards).set({ rules: serializeRules(rules), singleUse: rules.singleUse, updatedAt: new Date() }).where(eq(bankCards.id, card.id)).returning()
				return row!
			})
		}),

	simulate: (owner, cardId, input) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			if (!/^\d{1,30}$/.test(input.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a non-negative integer string (card-currency minor units)'))
			const rules = yield* normalizeRules(input.rules ?? card.rules)
			const at = input.at ? Date.parse(input.at) : Date.now()
			if (Number.isNaN(at)) return yield* Effect.fail(bankErr('VALIDATION', 'at must be an ISO date-time'))
			const ctx = yield* loadHistory(card, rules, at)
			const amount = BigInt(input.amountMinor)
			const d = evaluateAuthorization(rules, { now: at, amountMinor: amount, merchantName: input.merchantName, mcc: input.mcc, country: input.country, ...ctx })
			const ledger = yield* BankLedgerService
			const account = yield* ledger.getAccountById(card.accountId)
			const asset = findAsset(account.asset, account.chain)
			let funds: Record<string, unknown> = { checked: false }
			if (asset) {
				const avail = yield* Effect.either(availableOf(account))
				const need = providerToAssetMinor(amount, card.currency, asset.decimals)
				funds = Either.isRight(avail)
					? { checked: true, availableMinor: avail.right.toString(), requiredMinor: need.toString(), sufficient: avail.right >= need }
					: { checked: false, reason: avail.left.message }
			}
			const fundsOk = funds.checked !== true || funds.sufficient === true
			return {
				dryRun: true,
				cardStatus: card.status,
				approved: d.approved && fundsOk && card.status === 'active',
				decidedBy: card.status !== 'active' ? 'card_status' : d.approved && !fundsOk ? 'balance' : d.decidedBy,
				reason: card.status !== 'active' ? `Card is ${card.status}` : d.approved && !fundsOk ? 'Insufficient available balance' : d.reason,
				violations: d.violations,
				funds,
				evaluatedAt: new Date(at).toISOString(),
			}
		}),

	revealKey: (owner, cardId, nonce) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			if (card.status === 'canceled') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Card is canceled'))
			if (!nonce || nonce.length > 256) return yield* Effect.fail(bankErr('VALIDATION', 'nonce (from the provider client SDK) is required'))
			const provider = yield* providerFor(card.provider)
			const k = yield* provider.ephemeralKey({ providerCardId: card.providerCardId, nonce })
			return { ...k, providerCardId: card.providerCardId, provider: card.provider }
		}),

	listTransactions: (owner, cardId, limit) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			return yield* bankDb((db) => db.select().from(bankCardTransactions).where(eq(bankCardTransactions.cardId, card.id)).orderBy(desc(bankCardTransactions.createdAt)).limit(Math.min(Math.max(limit, 1), 200)))
		}),

	listAuthorizations: (owner, cardId, limit) =>
		Effect.gen(function* () {
			const card = yield* loadCard(owner, cardId)
			return yield* bankDb((db) => db.select().from(bankCardAuthorizations).where(eq(bankCardAuthorizations.cardId, card.id)).orderBy(desc(bankCardAuthorizations.createdAt)).limit(Math.min(Math.max(limit, 1), 200)))
		}),

	addReceipt: (owner, authorizationId, receipt) =>
		bankDb(async (db) => {
			const [row] = await db
				.select({ a: bankCardAuthorizations })
				.from(bankCardAuthorizations)
				.innerJoin(bankCards, eq(bankCards.id, bankCardAuthorizations.cardId))
				.where(and(eq(bankCardAuthorizations.id, authorizationId), eq(bankCards.ownerType, owner.ownerType), eq(bankCards.ownerId, owner.ownerId)))
				.limit(1)
			if (!row) throw bankErr('NOT_FOUND', 'Authorization not found')
			if (row.a.receipts.length >= 20) throw bankErr('LIMIT_EXCEEDED', 'Max 20 receipts per authorization')
			const [u] = await db
				.update(bankCardAuthorizations)
				.set({ receipts: [...row.a.receipts, { ...receipt, id: randomUUID(), addedAt: new Date().toISOString() }], updatedAt: new Date() })
				.where(eq(bankCardAuthorizations.id, authorizationId))
				.returning()
			return u!
		}),

	setExpense: (owner, authorizationId, e) =>
		bankDb(async (db) => {
			const [row] = await db
				.select({ id: bankCardAuthorizations.id })
				.from(bankCardAuthorizations)
				.innerJoin(bankCards, eq(bankCards.id, bankCardAuthorizations.cardId))
				.where(and(eq(bankCardAuthorizations.id, authorizationId), eq(bankCards.ownerType, owner.ownerType), eq(bankCards.ownerId, owner.ownerId)))
				.limit(1)
			if (!row) throw bankErr('NOT_FOUND', 'Authorization not found')
			const set: Partial<typeof bankCardAuthorizations.$inferInsert> = { updatedAt: new Date() }
			if (e.expenseCategory !== undefined) set.expenseCategory = e.expenseCategory
			if (e.memo !== undefined) set.memo = e.memo
			const [u] = await db.update(bankCardAuthorizations).set(set).where(eq(bankCardAuthorizations.id, authorizationId)).returning()
			if (e.expenseCategory !== undefined || e.memo !== undefined) {
				const ts: Partial<typeof bankCardTransactions.$inferInsert> = {}
				if (e.expenseCategory !== undefined) ts.expenseCategory = e.expenseCategory
				if (e.memo !== undefined) ts.memo = e.memo
				await db.update(bankCardTransactions).set(ts).where(eq(bankCardTransactions.authorizationId, authorizationId))
			}
			return u!
		}),

	retrySettlements: (owner) =>
		Effect.gen(function* () {
			const rows = yield* bankDb((db) =>
				db
					.select({ t: bankCardTransactions, c: bankCards })
					.from(bankCardTransactions)
					.innerJoin(bankCards, eq(bankCards.id, bankCardTransactions.cardId))
					.where(and(eq(bankCards.ownerType, owner.ownerType), eq(bankCards.ownerId, owner.ownerId), inArray(bankCardTransactions.settlementStatus, ['pending', 'failed'])))
					.limit(50),
			)
			let settled = 0
			let failed = 0
			for (const r of rows) {
				if (yield* settleSafely(r.c, r.t)) settled++
				else failed++
			}
			return { attempted: rows.length, settled, failed }
		}),

	handleWebhook: (providerName, rawBody, signature) =>
		Effect.gen(function* () {
			const provider = yield* providerFor(providerName)
			const evt = yield* provider.verifyWebhook(rawBody, signature)
			switch (evt.kind) {
				case 'authorization_request': {
					// Fail closed on ANY error: a thrown decision must never become an approval.
					const d = yield* Effect.catchAll(decideAuthorization(provider, evt.request), () => Effect.succeed<AuthorizationDecision>({ approved: false }))
					return provider.webhookResponse(d)
				}
				case 'authorization_update':
					yield* handleAuthUpdate(evt)
					break
				case 'transaction':
					yield* handleTransaction(provider, evt.transaction)
					break
				default:
					break
			}
			return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) }
		}),
}

export const BankCardServiceLive = Layer.succeed(BankCardService, impl)
