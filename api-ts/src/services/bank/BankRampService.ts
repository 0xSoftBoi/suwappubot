/**
 * BankRampService (M5) — fiat on/off ramps over pluggable providers (Bridge, Due).
 *
 * MONEY-PATH. Accounting rules:
 * - Offramp: provider transfer is created first (no funds move), then the stablecoin leaves the
 *   bank account through BankTransferService.transfer (reserve -> clearing -> external). Ramp state
 *   changes never fabricate ledger entries.
 * - Deposits (virtual accounts): fiat arrival (funds_received) only updates state. The ledger is
 *   credited on payment_processed via BankTransferService.syncDeposit, i.e. from the on-chain balance
 *   delta (idempotent, cannot double-credit with the generic deposit sync).
 * - returned / refunded offramps are re-credited the same way (on-chain truth), never from webhook amounts.
 * - Webhooks: signature verified on the raw body, idempotent per event_id.
 */
import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../../config/EnvService'
import {
	type BankRampTransfer,
	bankExternalAccounts,
	bankRampCustomers,
	bankRampEvents,
	bankRampTransfers,
	bankVirtualAccounts,
	type RampStatus,
} from '../../db'
import type { DrizzleService } from '../../db'
import { logger } from '../../lib/logger'
import { BANK_ASSETS, findAsset, fromMinor } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'
import { BridgeProvider } from './ramps/BridgeProvider'
import { DueProvider } from './ramps/DueProvider'
import { FIAT_DECIMALS, RAIL_INFO, type Rail, isRail } from './ramps/rails'
import {
	type ExternalAccountInput,
	type ProviderId,
	RampError,
	type RampProvider,
	type RampQuote,
	type RampQuoteRequest,
	type RampKycInput,
} from './ramps/RampProvider'
import { type RailSupportRow, type RoutedQuotes, bestQuote, railRegistry } from './ramps/router'

type Deps = BankDeps | BankTransferService | EnvService
type Fx<A> = Effect.Effect<A, BankError, Deps>

export interface QuoteInput {
	direction: 'offramp' | 'onramp'
	rail: Rail
	/** Stablecoin symbol (offramp source / onramp destination). */
	asset: string
	amountMinor: string
	/** Fiat currency override; defaults to the rail's currency. */
	currency?: string | undefined
}

export interface OfframpInput {
	owner: BankOwner
	provider?: ProviderId | undefined
	fromAccountId: string
	externalAccountId: string
	amountMinor: string
	idempotencyKey: string
}

export interface BankRampServiceInterface {
	readonly providers: () => Effect.Effect<RampProvider[], never, EnvService>
	readonly rails: () => Effect.Effect<RailSupportRow[], never, EnvService>
	readonly quote: (i: QuoteInput) => Fx<RoutedQuotes>
	readonly startKyc: (owner: BankOwner, provider: ProviderId, i: Omit<RampKycInput, 'idempotencyKey'>) => Fx<typeof bankRampCustomers.$inferSelect>
	readonly refreshKyc: (owner: BankOwner, provider: ProviderId) => Fx<typeof bankRampCustomers.$inferSelect>
	readonly registerExternalAccount: (owner: BankOwner, provider: ProviderId, i: Omit<ExternalAccountInput, 'providerCustomerId' | 'idempotencyKey'> & { label?: string | undefined }) => Fx<typeof bankExternalAccounts.$inferSelect>
	readonly listExternalAccounts: (owner: BankOwner) => Fx<Array<typeof bankExternalAccounts.$inferSelect>>
	readonly createVirtualAccount: (owner: BankOwner, provider: ProviderId, accountId: string, sourceCurrency: string) => Fx<typeof bankVirtualAccounts.$inferSelect>
	readonly listVirtualAccounts: (owner: BankOwner) => Fx<Array<typeof bankVirtualAccounts.$inferSelect>>
	readonly offramp: (i: OfframpInput) => Fx<{ rampTransfer: BankRampTransfer; quote: RampQuote | null }>
	readonly getRampTransfer: (owner: BankOwner, id: string) => Fx<BankRampTransfer>
	readonly listRampTransfers: (owner: BankOwner, limit?: number) => Fx<BankRampTransfer[]>
	readonly handleWebhook: (provider: string, headers: Record<string, string | undefined>, rawBody: string) => Fx<{ duplicate: boolean; handled: string }>
	readonly settleRampTransfers: () => Fx<{ checked: number; credited: number }>
}

export class BankRampService extends Context.Tag('BankRampService')<BankRampService, BankRampServiceInterface>() {}

// ---------------------------------------------------------------- helpers
export const mapBridgeState = (state: string): RampStatus => {
	switch (state) {
		case 'awaiting_funds':
			return 'pending'
		case 'in_review':
		case 'funds_received':
		case 'payment_submitted':
		case 'refund_in_flight':
			return 'processing'
		case 'payment_processed':
			return 'completed'
		case 'returned':
			return 'returned'
		case 'refunded':
			return 'refunded'
		case 'canceled':
		case 'undeliverable':
		case 'refund_failed':
			return 'failed'
		default:
			return 'processing'
	}
}

const toBankErr = (e: unknown): BankError => {
	if (e instanceof RampError) {
		switch (e.code) {
			case 'PROVIDER_NOT_CONFIGURED':
				return bankErr('PROVIDER_NOT_CONFIGURED', e.message, e.extra.missing ? { missing: e.extra.missing } : {})
			case 'AUTH':
				return bankErr('NOT_CONFIGURED', e.message, { missing: e.extra.missing ?? 'provider credentials' })
			case 'RAIL_NO_PROVIDER':
				return bankErr('RAIL_NO_PROVIDER', e.message)
			case 'UNSUPPORTED':
				return bankErr('ASSET_UNSUPPORTED', e.message)
			case 'AML_REJECTED':
				return bankErr('POLICY_BLOCKED', e.message)
			case 'CONFLICT':
				return bankErr('CONFLICT', e.message)
			case 'VALIDATION':
			case 'SIGNATURE':
				return bankErr('VALIDATION', e.message)
			default:
				return bankErr('UPSTREAM', e.message, { cause: e })
		}
	}
	return bankErr('UPSTREAM', String(e), { cause: e })
}

const viaProvider = <A>(f: () => Promise<A>): Effect.Effect<A, BankError> => Effect.tryPromise({ try: f, catch: toBankErr })

const symbolDecimals = (symbol: string): number => {
	const a = BANK_ASSETS.find((x) => x.symbol === symbol.toUpperCase())
	if (!a) throw bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${symbol}`)
	return a.decimals
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const asOwner = (r: { ownerType: string; ownerId: string }): BankOwner => ({ ownerType: r.ownerType as BankOwner['ownerType'], ownerId: r.ownerId })
const mergeMeta = (col: unknown, patch: Record<string, unknown>) => sql`${col} || ${JSON.stringify(patch)}::jsonb`

const buildProviders = (env: EnvService['Type']): RampProvider[] => [
	new BridgeProvider({ apiKey: env.BRIDGE_API_KEY, baseUrl: env.BRIDGE_API_BASE_URL, webhookPublicKey: env.BRIDGE_WEBHOOK_PUBLIC_KEY }),
	new DueProvider({ apiKey: env.DUE_API_KEY, accountId: env.DUE_ACCOUNT_ID, baseUrl: env.DUE_API_BASE_URL, enabledRails: env.DUE_ENABLED_RAILS }),
]

const getProviders = Effect.gen(function* () {
	const env = yield* EnvService
	return buildProviders(env)
})

const pickProvider = (id: ProviderId): Effect.Effect<RampProvider, BankError, EnvService> =>
	Effect.gen(function* () {
		const p = (yield* getProviders).find((x) => x.id === id)
		if (!p) return yield* Effect.fail(bankErr('VALIDATION', `Unknown provider ${id}`))
		const missing = p.missingConfig()
		if (missing) return yield* Effect.fail(bankErr('PROVIDER_NOT_CONFIGURED', `${missing} is not configured`, { missing }))
		return p
	})

const requireCustomer = (owner: BankOwner, provider: ProviderId) =>
	bankDb(async (db) => {
		const [c] = await db
			.select()
			.from(bankRampCustomers)
			.where(and(eq(bankRampCustomers.ownerType, owner.ownerType), eq(bankRampCustomers.ownerId, owner.ownerId), eq(bankRampCustomers.provider, provider)))
			.limit(1)
		if (!c) throw bankErr('NOT_FOUND', `No ${provider} customer: start KYC first (POST /ramps/kyc)`)
		return c
	})

// ---------------------------------------------------------------- impl
export const BankRampServiceLive = Layer.succeed(BankRampService, {
	providers: () => getProviders,
	rails: () => Effect.map(getProviders, railRegistry),

	quote: (i) =>
		Effect.gen(function* () {
			const providers = yield* getProviders
			const info = RAIL_INFO[i.rail]
			const fiat = (i.currency ?? info.currency).toUpperCase()
			const fiatDec = FIAT_DECIMALS[fiat]
			if (fiatDec === undefined) return yield* Effect.fail(bankErr('VALIDATION', `Unsupported fiat currency ${fiat}`))
			const stableDec = yield* Effect.try({ try: () => symbolDecimals(i.asset), catch: (e) => e as BankError })
			const asset = i.asset.toUpperCase()
			const q: RampQuoteRequest =
				i.direction === 'offramp'
					? { sourceRail: 'crypto', sourceCurrency: asset, destRail: i.rail, destCurrency: fiat, amountMinor: i.amountMinor, sourceDecimals: stableDec, destDecimals: fiatDec }
					: { sourceRail: i.rail, sourceCurrency: fiat, destRail: 'crypto', destCurrency: asset, amountMinor: i.amountMinor, sourceDecimals: fiatDec, destDecimals: stableDec }
			return yield* viaProvider(() => bestQuote(providers, i.direction, q))
		}),

	startKyc: (owner, provider, i) =>
		Effect.gen(function* () {
			const p = yield* pickProvider(provider)
			const existing = yield* bankDb(async (db) => {
				const [c] = await db
					.select()
					.from(bankRampCustomers)
					.where(and(eq(bankRampCustomers.ownerType, owner.ownerType), eq(bankRampCustomers.ownerId, owner.ownerId), eq(bankRampCustomers.provider, provider)))
					.limit(1)
				return c
			})
			if (existing) return existing
			// Deterministic idempotency key: a retry after a crash hits Bridge's idempotency, not a second customer.
			const r = yield* viaProvider(() => p.createCustomer({ ...i, idempotencyKey: `kyc-${hash(`${owner.ownerType}:${owner.ownerId}:${provider}`).slice(0, 40)}` }))
			return yield* bankDb(async (db) => {
				const [row] = await db
					.insert(bankRampCustomers)
					.values({
						id: newId('acct').replace('acct_', 'rc_'),
						ownerType: owner.ownerType,
						ownerId: owner.ownerId,
						provider,
						providerCustomerId: r.providerCustomerId,
						kycStatus: r.kycStatus,
						kycLink: r.kycLink,
						tosLink: r.tosLink,
						metadata: { kycLinkId: r.kycLinkId, tosStatus: r.tosStatus },
					})
					.onConflictDoNothing()
					.returning()
				if (row) return row
				const [c] = await db
					.select()
					.from(bankRampCustomers)
					.where(and(eq(bankRampCustomers.ownerType, owner.ownerType), eq(bankRampCustomers.ownerId, owner.ownerId), eq(bankRampCustomers.provider, provider)))
					.limit(1)
				return c as NonNullable<typeof c>
			})
		}),

	refreshKyc: (owner, provider) =>
		Effect.gen(function* () {
			const p = yield* pickProvider(provider)
			const c = yield* requireCustomer(owner, provider)
			const linkId = (c.metadata as { kycLinkId?: string }).kycLinkId
			if (!linkId) return yield* Effect.fail(bankErr('VALIDATION', 'Customer has no kyc link id'))
			const s = yield* viaProvider(() => p.kycStatus(linkId))
			return yield* bankDb(async (db) => {
				const [row] = await db
					.update(bankRampCustomers)
					.set({ kycStatus: s.kycStatus, metadata: mergeMeta(bankRampCustomers.metadata, { tosStatus: s.tosStatus }) as never, updatedAt: new Date() })
					.where(eq(bankRampCustomers.id, c.id))
					.returning()
				return row as NonNullable<typeof row>
			})
		}),

	registerExternalAccount: (owner, provider, i) =>
		Effect.gen(function* () {
			const p = yield* pickProvider(provider)
			const c = yield* requireCustomer(owner, provider)
			const idem = `ext-${hash(`${c.providerCustomerId}:${JSON.stringify(i.account)}`).slice(0, 40)}`
			const r = yield* viaProvider(() => p.registerExternalAccount({ ...i, providerCustomerId: c.providerCustomerId, idempotencyKey: idem }))
			return yield* bankDb(async (db) => {
				const [row] = await db
					.insert(bankExternalAccounts)
					.values({ id: newId('acct').replace('acct_', 'ext_'), ownerType: owner.ownerType, ownerId: owner.ownerId, provider, providerId: r.providerId, rail: r.rail, currency: r.currency, label: i.label ?? null, details: r.details })
					.onConflictDoNothing()
					.returning()
				if (row) return row
				const [e] = await db.select().from(bankExternalAccounts).where(and(eq(bankExternalAccounts.provider, provider), eq(bankExternalAccounts.providerId, r.providerId))).limit(1)
				if (!e || e.ownerId !== owner.ownerId || e.ownerType !== owner.ownerType) throw bankErr('CONFLICT', 'External account already registered to another owner')
				return e
			})
		}),

	listExternalAccounts: (owner) =>
		bankDb((db) => db.select().from(bankExternalAccounts).where(and(eq(bankExternalAccounts.ownerType, owner.ownerType), eq(bankExternalAccounts.ownerId, owner.ownerId))).orderBy(desc(bankExternalAccounts.createdAt))),

	createVirtualAccount: (owner, provider, accountId, sourceCurrency) =>
		Effect.gen(function* () {
			const p = yield* pickProvider(provider)
			const ledger = yield* BankLedgerService
			const acct = yield* ledger.getAccount(owner, accountId)
			if (!acct.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Account has no custody address to receive funds'))
			const c = yield* requireCustomer(owner, provider)
			if (c.kycStatus !== 'approved') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `KYC not approved (status ${c.kycStatus}); complete ${c.kycLink ?? 'the KYC link'}`))
			const idem = `va-${hash(`${c.providerCustomerId}:${acct.id}:${sourceCurrency.toLowerCase()}`).slice(0, 40)}`
			const r = yield* viaProvider(() =>
				p.createVirtualAccount({ providerCustomerId: c.providerCustomerId, sourceCurrency, destCurrency: acct.asset, destRail: acct.chain, destAddress: acct.address as string, idempotencyKey: idem }),
			)
			return yield* bankDb(async (db) => {
				const [row] = await db
					.insert(bankVirtualAccounts)
					.values({ id: newId('acct').replace('acct_', 'va_'), ownerType: owner.ownerType, ownerId: owner.ownerId, provider, providerId: r.providerId, sourceCurrency: sourceCurrency.toUpperCase(), destAccountId: acct.id, destAsset: acct.asset, destChain: acct.chain, destAddress: acct.address as string, instructions: r.instructions, status: r.status })
					.onConflictDoNothing()
					.returning()
				if (row) return row
				const [v] = await db.select().from(bankVirtualAccounts).where(and(eq(bankVirtualAccounts.provider, provider), eq(bankVirtualAccounts.providerId, r.providerId))).limit(1)
				return v as NonNullable<typeof v>
			})
		}),

	listVirtualAccounts: (owner) =>
		bankDb((db) => db.select().from(bankVirtualAccounts).where(and(eq(bankVirtualAccounts.ownerType, owner.ownerType), eq(bankVirtualAccounts.ownerId, owner.ownerId))).orderBy(desc(bankVirtualAccounts.createdAt))),

	// MONEY-PATH
	offramp: (i) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const transfers = yield* BankTransferService
			const acct = yield* ledger.getAccount(i.owner, i.fromAccountId)
			{ const sysErr = assertSpendable(acct); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			const asset = findAsset(acct.asset, acct.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${acct.asset} on ${acct.chain}`))
			if (!/^[1-9][0-9]{0,77}$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
			const ext = yield* bankDb(async (db) => {
				const [e] = await db.select().from(bankExternalAccounts).where(and(eq(bankExternalAccounts.id, i.externalAccountId), eq(bankExternalAccounts.ownerType, i.owner.ownerType), eq(bankExternalAccounts.ownerId, i.owner.ownerId))).limit(1)
				if (!e) throw bankErr('NOT_FOUND', 'External account not found')
				return e
			})
			const providerId = (i.provider ?? ext.provider) as ProviderId
			if (providerId !== ext.provider) return yield* Effect.fail(bankErr('VALIDATION', `External account belongs to ${ext.provider}`))
			if (!isRail(ext.rail)) return yield* Effect.fail(bankErr('VALIDATION', `Unknown rail ${ext.rail}`))
			const p = yield* pickProvider(providerId)
			const cref = `rt_${hash(`${i.owner.ownerType}:${i.owner.ownerId}:${i.idempotencyKey}`).slice(0, 40)}`

			// Idempotent replay: same key returns the existing ramp transfer.
			const prior = yield* bankDb(async (db) => {
				const [r] = await db.select().from(bankRampTransfers).where(and(eq(bankRampTransfers.ownerType, i.owner.ownerType), eq(bankRampTransfers.ownerId, i.owner.ownerId), eq(bankRampTransfers.clientReferenceId, cref))).limit(1)
				return r
			})
			if (prior) return { rampTransfer: prior, quote: null }

			const customer = yield* requireCustomer(i.owner, providerId)
			const fiatDec = FIAT_DECIMALS[ext.currency] ?? 2
			const quote = yield* viaProvider(() =>
				p.quoteOfframp({ sourceRail: 'crypto', sourceCurrency: asset.symbol, destRail: ext.rail as Rail, destCurrency: ext.currency, amountMinor: i.amountMinor, sourceDecimals: asset.decimals, destDecimals: fiatDec }),
			)
			const pt = yield* viaProvider(() =>
				p.createOfframp({
					providerCustomerId: customer.providerCustomerId,
					externalAccountId: ext.providerId,
					destRail: ext.rail as Rail,
					destCurrency: ext.currency,
					sourceChainRail: acct.chain,
					sourceCurrency: asset.symbol.toLowerCase(),
					fromAddress: acct.address as string,
					amountDecimal: fromMinor(BigInt(i.amountMinor), asset.decimals),
					clientReferenceId: cref,
					idempotencyKey: cref,
				}),
			)
			if (!pt.depositAddress) return yield* Effect.fail(bankErr('UPSTREAM', 'Provider transfer has no deposit address; nothing was sent'))
			// Guard: the provider must expect exactly the amount we are about to send.
			if (pt.depositAmountDecimal !== null) {
				const expected = BigInt(pt.depositAmountDecimal.split('.')[0] + (pt.depositAmountDecimal.split('.')[1] ?? '').slice(0, asset.decimals).padEnd(asset.decimals, '0'))
				if (expected !== BigInt(i.amountMinor)) return yield* Effect.fail(bankErr('UPSTREAM', `Provider expects ${pt.depositAmountDecimal} but request is ${fromMinor(BigInt(i.amountMinor), asset.decimals)}; nothing was sent`))
			}
			const row = yield* bankDb(async (db) => {
				const [r] = await db
					.insert(bankRampTransfers)
					.values({ id: newId('xfer').replace('xfer_', 'rt_'), ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, provider: providerId, providerId: pt.providerId, direction: 'offramp', providerState: pt.state, status: mapBridgeState(pt.state), sourceRail: acct.chain, sourceCurrency: asset.symbol, destRail: ext.rail, destCurrency: ext.currency, amountMinor: i.amountMinor, receiveMinor: quote.receiveAmountMinor, feeMinor: quote.feeMinor, accountId: acct.id, externalAccountId: ext.id, clientReferenceId: cref, metadata: { depositAddress: pt.depositAddress, quote } })
					.onConflictDoNothing()
					.returning()
				if (r) return r
				const [e] = await db.select().from(bankRampTransfers).where(and(eq(bankRampTransfers.provider, providerId), eq(bankRampTransfers.providerId, pt.providerId))).limit(1)
				return e as NonNullable<typeof e>
			})
			// Reserve + send the stablecoin to the provider deposit address.
			const bt = yield* transfers
				.transfer({ owner: i.owner, idempotencyKey: `ramp:${cref}`, type: 'payout', fromAccountId: acct.id, toExternal: { address: pt.depositAddress }, amountMinor: i.amountMinor, memo: `offramp ${asset.symbol}->${ext.currency}`, metadata: { rampTransferId: row.id, provider: providerId } })
				.pipe(
					Effect.tapError((e) =>
						bankDb((db) => db.update(bankRampTransfers).set({ status: 'failed', metadata: mergeMeta(bankRampTransfers.metadata, { fundingError: e.message }) as never, updatedAt: new Date() }).where(eq(bankRampTransfers.id, row.id))),
					),
				)
			const updated = yield* bankDb(async (db) => {
				const [r] = await db.update(bankRampTransfers).set({ bankTransferId: bt.id, updatedAt: new Date() }).where(eq(bankRampTransfers.id, row.id)).returning()
				return r as NonNullable<typeof r>
			})
			return { rampTransfer: updated, quote }
		}),

	getRampTransfer: (owner, id) =>
		bankDb(async (db) => {
			const [r] = await db.select().from(bankRampTransfers).where(and(eq(bankRampTransfers.id, id), eq(bankRampTransfers.ownerType, owner.ownerType), eq(bankRampTransfers.ownerId, owner.ownerId))).limit(1)
			if (!r) throw bankErr('NOT_FOUND', 'Ramp transfer not found')
			return r
		}),

	listRampTransfers: (owner, limit = 50) =>
		bankDb((db) => db.select().from(bankRampTransfers).where(and(eq(bankRampTransfers.ownerType, owner.ownerType), eq(bankRampTransfers.ownerId, owner.ownerId))).orderBy(desc(bankRampTransfers.createdAt)).limit(Math.min(limit, 200))),

	// MONEY-PATH
	handleWebhook: (providerName, headers, rawBody) =>
		Effect.gen(function* () {
			if (providerName !== 'bridge' && providerName !== 'due') return yield* Effect.fail(bankErr('NOT_FOUND', `Unknown provider ${providerName}`))
			const providers = yield* getProviders
			const p = providers.find((x) => x.id === providerName) as RampProvider
			yield* viaProvider(async () => p.verifyWebhook(headers, rawBody))
			const ev = yield* viaProvider(async () => p.parseWebhook(rawBody))
			const fresh = yield* bankDb(async (db) => {
				const r = await db.insert(bankRampEvents).values({ id: newId('le').replace('le_', 'ev_'), provider: providerName, eventId: ev.eventId, eventType: `${ev.category}:${ev.type}` }).onConflictDoNothing().returning()
				return r.length > 0
			})
			if (!fresh) return { duplicate: true, handled: 'duplicate' }
			const handled = yield* processEvent(providerName, ev.category, ev.object).pipe(
				Effect.tapError(() => bankDb((db) => db.delete(bankRampEvents).where(and(eq(bankRampEvents.provider, providerName), eq(bankRampEvents.eventId, ev.eventId)))).pipe(Effect.ignore)),
			)
			return { duplicate: false, handled }
		}),

	settleRampTransfers: () =>
		Effect.gen(function* () {
			const rows = yield* bankDb((db) =>
				db
					.select()
					.from(bankRampTransfers)
					.where(and(inArray(bankRampTransfers.status, ['completed', 'returned', 'refunded']), sql`coalesce((${bankRampTransfers.metadata}->>'settled'), 'false') <> 'true'`, sql`${bankRampTransfers.direction} in ('deposit','offramp')`))
					.limit(50),
			)
			let credited = 0
			for (const r of rows) {
				if (r.direction === 'offramp' && r.status === 'completed') continue
				const n = yield* trySettle(r).pipe(Effect.catchAll((e) => Effect.sync(() => { logger.warn({ id: r.id, err: e.message }, 'bank ramp settle failed'); return 0 })))
				if (n > 0) credited++
			}
			return { checked: rows.length, credited }
		}),
} satisfies BankRampServiceInterface)

/** Credit from on-chain truth (see header). Returns 1 when credited. */
const trySettle = (r: BankRampTransfer): Fx<number> =>
	Effect.gen(function* () {
		if (!r.accountId) return 0
		const transfers = yield* BankTransferService
		const res = yield* transfers.syncDeposit(asOwner(r), r.accountId)
		if (res.transfer && BigInt(res.creditedMinor) > 0n) {
			yield* bankDb((db) => db.update(bankRampTransfers).set({ bankTransferId: res.transfer?.id ?? r.bankTransferId, metadata: mergeMeta(bankRampTransfers.metadata, { settled: true, creditedMinor: res.creditedMinor }) as never, updatedAt: new Date() }).where(eq(bankRampTransfers.id, r.id)))
			return 1
		}
		return 0
	})

const processEvent = (provider: ProviderId, category: string, obj: Record<string, any>): Fx<string> =>
	Effect.gen(function* () {
		if (category === 'kyc_link') {
			const cid = String(obj.customer_id ?? '')
			if (!cid) return 'ignored'
			yield* bankDb((db) => db.update(bankRampCustomers).set({ kycStatus: String(obj.kyc_status ?? 'unknown'), metadata: mergeMeta(bankRampCustomers.metadata, { tosStatus: obj.tos_status ?? null }) as never, updatedAt: new Date() }).where(and(eq(bankRampCustomers.provider, provider), eq(bankRampCustomers.providerCustomerId, cid))))
			return 'kyc_updated'
		}
		if (category === 'transfer') {
			const id = String(obj.id ?? '')
			const state = String(obj.state ?? '')
			if (!id || !state) return 'ignored'
			const row = yield* bankDb(async (db) => {
				const [r] = await db.update(bankRampTransfers).set({ providerState: state, status: mapBridgeState(state), updatedAt: new Date() }).where(and(eq(bankRampTransfers.provider, provider), eq(bankRampTransfers.providerId, id))).returning()
				return r
			})
			if (!row) return 'unknown_transfer'
			if (row.status === 'returned' || row.status === 'refunded') yield* trySettle(row)
			return `transfer_${row.status}`
		}
		if (category === 'virtual_account.activity') {
			const vaId = String(obj.virtual_account_id ?? '')
			const type = String(obj.type ?? '')
			const va = yield* bankDb(async (db) => {
				const [v] = await db.select().from(bankVirtualAccounts).where(and(eq(bankVirtualAccounts.provider, provider), eq(bankVirtualAccounts.providerId, vaId))).limit(1)
				return v
			})
			if (!va) return 'unknown_virtual_account'
			const depositId = String(obj.deposit_id ?? obj.id ?? '')
			if (!depositId) return 'ignored'
			const providerTransferId = `va_deposit:${depositId}`
			const srcDec = FIAT_DECIMALS[va.sourceCurrency] ?? 2
			const dstAsset = findAsset(va.destAsset, va.destChain)
			const toMinor = (dec: unknown, d: number): string | null => {
				if (typeof dec !== 'string' || !/^\d+(\.\d+)?$/.test(dec)) return null
				const [i = '0', f = ''] = dec.split('.')
				return BigInt(i + f.slice(0, d).padEnd(d, '0')).toString()
			}
			const state = type === 'refund' ? 'refunded' : type
			const status = mapBridgeState(state)
			if (!['funds_received', 'in_review', 'payment_submitted', 'payment_processed', 'refund', 'refund_in_flight', 'refund_failed', 'funds_scheduled'].includes(type)) return `ignored_${type}`
			const amountMinor = type === 'funds_received' || type === 'in_review' || type === 'funds_scheduled' ? toMinor(obj.amount, srcDec) : null
			const row = yield* bankDb(async (db) => {
				await db
					.insert(bankRampTransfers)
					.values({ id: newId('xfer').replace('xfer_', 'rt_'), ownerType: va.ownerType, ownerId: va.ownerId, provider, providerId: providerTransferId, direction: 'deposit', providerState: state, status, sourceRail: 'deposit', sourceCurrency: va.sourceCurrency, destRail: va.destChain, destCurrency: va.destAsset, amountMinor: amountMinor ?? '0', accountId: va.destAccountId, virtualAccountId: va.id, metadata: { depositId } })
					.onConflictDoNothing()
				const patch: Record<string, unknown> = { providerState: state, status, updatedAt: new Date() }
				if (amountMinor && amountMinor !== '0') patch.amountMinor = amountMinor
				if (type === 'payment_processed' && dstAsset) {
					const rm = toMinor(obj.amount, dstAsset.decimals)
					if (rm) patch.receiveMinor = rm
					if (obj.destination_tx_hash) patch.metadata = mergeMeta(bankRampTransfers.metadata, { destinationTxHash: obj.destination_tx_hash })
				}
				const [r] = await db.update(bankRampTransfers).set(patch as never).where(and(eq(bankRampTransfers.provider, provider), eq(bankRampTransfers.providerId, providerTransferId))).returning()
				return r as NonNullable<typeof r>
			})
			// Credit only when the stablecoin has been delivered (payment_processed), from on-chain truth.
			if (type === 'payment_processed') yield* trySettle(row)
			return `deposit_${type}`
		}
		return `ignored_${category}`
	})
