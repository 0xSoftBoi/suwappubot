/**
 * M10 Agents: agent accounts with server-enforced spend mandates, x402 client (payForResource),
 * x402 server (priced resources, facilitator settlement, ledger credit), metered agent<->agent
 * settlement wrapper, and an agent directory.
 *
 * MONEY-PATH: payForResource (mandate enforcement, reserve -> sign -> pay -> confirm/reverse) and
 * servePaidResource (facilitator settlement + seller credit).
 */
import { assertAvailable, registerHoldProvider, sumRow } from './holds'
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import { decodeAbiParameters, keccak256, recoverMessageAddress, toHex } from 'viem'
import {
	type BankAccount,
	type BankAgentMandate,
	type BankAgentResource,
	type BankTransfer,
	type DrizzleService,
	bankAgentMandates,
	bankAgentResourceSales,
	bankAgentResources,
	bankAgentSpend,
	bankTransfers,
} from '../../db'
import { assertUrlSafeForFetch } from '../../routes/ssrfGuard'
import { EnvService } from '../../config/EnvService'
import { facilitatorVerifyAndSettle, isFacilitatorEnabled } from '../FacilitatorService'
import type { PolicyService } from '../PolicyService'
import type { TurnkeyService } from '../TurnkeyService'
import { type BankAsset, findAsset } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService } from './BankTransferService'
import { jsonRpc, rpcUrlFor } from './chainRpc'
import { registerBankJob } from './jobs'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'
import { guardedFetch } from './ssrfFetch'
import { signDigestForAccount } from './typedSigning'
import { type X402Requirement, authorizationDigest, buildChallenge, decodePayment, decodeSettlement, encodePayment, encodeSettlement, parsePaymentRequired, validatePaymentForResource } from './x402Codec'

type Deps = DrizzleService | BankLedgerService | TurnkeyService | PolicyService | EnvService | BankTransferService
type Fx<A> = Effect.Effect<A, BankError, Deps>

export interface MandateInput {
	perCallMaxMinor: string
	dailyCapMinor: string
	allowedHosts?: string[]
	allowedPayees?: string[]
	allowedAssets: string[]
	expiresAt?: string | undefined
}

export interface PayResult {
	paid: boolean
	status: number
	body: string
	contentType: string | null
	settlement?: { success: boolean; transaction?: string | undefined; network?: string | undefined; payer?: string | undefined } | undefined
	transfer?: BankTransfer | undefined
	spendId?: string
	note?: string
	/** MONEY-PATH: false when no idempotency key was supplied (a client retry may pay again); true when keyed; replayed when the stored original result is returned. */
	idempotent?: boolean
	replayed?: boolean
}

/** Minimal local view of the payments module's BankStreamService (resolved by tag key, optional). */
interface BankStreamLike {
	openStream?: (input: Record<string, unknown>) => Effect.Effect<unknown, unknown, never>
	reportUsage?: (input: Record<string, unknown>) => Effect.Effect<unknown, unknown, never>
}
const StreamTag = Context.GenericTag<BankStreamLike>('BankStreamService')

export interface BankAgentPayServiceInterface {
	readonly openAgentAccount: (owner: BankOwner, i: { asset: string; chain: string; label?: string; mandate: MandateInput }) => Fx<{ account: BankAccount; mandate: BankAgentMandate }>
	readonly listMandates: (owner: BankOwner) => Fx<BankAgentMandate[]>
	readonly revokeMandate: (owner: BankOwner, id: string) => Fx<BankAgentMandate>
	readonly payForResource: (owner: BankOwner, i: { mandateId: string; url: string; method?: string; body?: string; headers?: Record<string, string>; idempotencyKey?: string | undefined }) => Fx<PayResult>
	readonly registerResource: (owner: BankOwner, i: { accountId: string; title: string; description?: string; upstreamUrl: string; priceMinor: string; slug?: string }) => Fx<BankAgentResource>
	readonly listMyResources: (owner: BankOwner) => Fx<BankAgentResource[]>
	readonly setResourceStatus: (owner: BankOwner, id: string, status: 'active' | 'disabled') => Fx<BankAgentResource>
	readonly directory: (q?: { asset?: string; limit?: number }) => Fx<Array<Record<string, unknown>>>
	readonly servePaidResource: (slug: string, req: { method: string; url: string; headers: Record<string, string>; body?: string }) => Fx<{ status: number; headers: Record<string, string>; body: string }>
	readonly creditSales: (owner: BankOwner) => Fx<{ credited: number }>
	readonly openMeteredStream: (owner: BankOwner, i: { payerAccountId: string; payeeAccountId: string; unitPriceMinor: string; unit: string; idempotencyKey: string }) => Fx<{ stream: unknown }>
	readonly reportMeteredUsage: (owner: BankOwner, i: { streamId: string; units: string; idempotencyKey: string }) => Fx<{ usage: unknown }>
}

export class BankAgentPayService extends Context.Tag('BankAgentPayService')<BankAgentPayService, BankAgentPayServiceInterface>() {}

// ------------------------------------------------------------ helpers

const UINT = /^[1-9][0-9]{0,77}$/
// MONEY-PATH: must be a typed Effect failure (a sync throw inside Effect.gen is a defect -> HTTP 500, not 403).
const requireAgent = (o: BankOwner) =>
	o.ownerType !== 'agent' ? Effect.fail(bankErr('FORBIDDEN', 'Agent payments require an agent bearer token')) : Effect.void
const hostOf = (url: string): string => {
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		throw bankErr('VALIDATION', 'Invalid URL')
	}
}
// MONEY-PATH: '*.example.com' matches only a proper subdomain label boundary ('.example.com' suffix), never the bare
// parent, never 'evilexample.com'; a wildcard must keep at least two labels after '*.' (no '*.com').
const hostAllowed = (host0: string, allowed: string[]) => {
	const host = host0.replace(/\.$/, '')
	return allowed.some((a) => {
		const x = a.toLowerCase().replace(/\.$/, '')
		if (x.startsWith('*.')) {
			const suffix = x.slice(1)
			if (x.slice(2).split('.').length < 2) return false
			return host.length > suffix.length && host.endsWith(suffix)
		}
		return host === x
	})
}

const validateMandate = (m: MandateInput) => {
	if (!UINT.test(m.perCallMaxMinor) || !UINT.test(m.dailyCapMinor)) throw bankErr('VALIDATION', 'perCallMaxMinor and dailyCapMinor must be positive integer strings')
	if (BigInt(m.perCallMaxMinor) > BigInt(m.dailyCapMinor)) throw bankErr('VALIDATION', 'perCallMaxMinor exceeds dailyCapMinor')
	if (!(m.allowedHosts?.length || m.allowedPayees?.length)) throw bankErr('VALIDATION', 'Mandate needs at least one allowed host or payee address (empty = deny all)')
	if (!m.allowedAssets.length) throw bankErr('VALIDATION', 'Mandate needs at least one allowed asset symbol')
	if (m.expiresAt && Number.isNaN(Date.parse(m.expiresAt))) throw bankErr('VALIDATION', 'expiresAt is not a valid date')
}

const loadMandate = (owner: BankOwner, id: string) =>
	bankDb(async (db) => {
		const [m] = await db.select().from(bankAgentMandates).where(and(eq(bankAgentMandates.id, id), eq(bankAgentMandates.agentId, owner.ownerId))).limit(1)
		if (!m) throw bankErr('NOT_FOUND', 'Mandate not found')
		return m
	})

const domainCache = new Map<string, { name: string; version: string }>()
const readString = async (chain: string, to: string, selector: string): Promise<string> => {
	const out = await jsonRpc<string>(rpcUrlFor(chain), 'eth_call', [{ to, data: selector }, 'latest'])
	return decodeAbiParameters([{ type: 'string' }], out as `0x${string}`)[0]
}
/** EIP-712 domain (name, version) read on-chain from the token. */
export const readTokenDomain = (asset: BankAsset): Effect.Effect<{ name: string; version: string }, BankError> =>
	Effect.tryPromise({
		try: async () => {
			const k = `${asset.chain}:${asset.address.toLowerCase()}`
			const hit = domainCache.get(k)
			if (hit) return hit
			const name = await readString(asset.chain, asset.address, '0x06fdde03')
			const version = await readString(asset.chain, asset.address, '0x54fd4d50')
			const d = { name, version }
			domainCache.set(k, d)
			return d
		},
		catch: (e) => (e && typeof e === 'object' && 'code' in e ? (e as BankError) : bankErr('UPSTREAM', `Could not read EIP-712 domain (name()/version()) of ${asset.symbol} on ${asset.chain}: ${String(e)}`)),
	})

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'resource'

// ------------------------------------------------------------ MONEY-PATH: spend reservation

// MONEY-PATH: a 'reserved' spend with no transfer row yet is a hold on the account; once the transfer row exists the
// ledger debit (account -> clearing) is the reserve, so it is excluded to avoid double counting.
registerHoldProvider('agent-pay', async (accountId, tx, excludeId) =>
	sumRow(
		await tx.execute(
			sql`select coalesce(sum(amount_minor),0)::text as s from bank_agent_spend where account_id = ${accountId} and status = 'reserved' and not exists (select 1 from bank_transfers t where t.metadata->>'spendId' = bank_agent_spend.id) and (${excludeId ?? null}::text is null or id <> ${excludeId ?? null}::text)`,
		),
	),
)

/** MONEY-PATH: atomically enforce per-call max + daily cap under an advisory lock, then insert a 'reserved' spend row. */
const reserveSpend = (m: BankAgentMandate, a: { host: string; payee: string; asset: string; chain: string; amountMinor: bigint; url: string }, idem?: { key: string; hash: string }) =>
	bankDb(async (db) =>
		db.transaction(async (tx): Promise<{ id: string; existing?: typeof bankAgentSpend.$inferSelect }> => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${m.id}))`)
			// MONEY-PATH: re-check the key under the per-mandate lock so a concurrent retry can never reserve twice.
			if (idem) {
				const [ex] = await tx.select().from(bankAgentSpend).where(and(eq(bankAgentSpend.agentId, m.agentId), eq(bankAgentSpend.idemKey, idem.key))).limit(1)
				if (ex) return { id: ex.id, existing: ex }
			}
			// MONEY-PATH: lock the funding account row and check unified availability (ledger - cards/escrow/streams/other spend holds).
			await tx.execute(sql`select 1 from bank_accounts where id = ${m.accountId} for update`)
			await assertAvailable(m.accountId, tx, a.amountMinor)
			const since = new Date(Date.now() - 24 * 3600_000)
			const [row] = await tx
				.select({ total: sql<string>`coalesce(sum(${bankAgentSpend.amountMinor}), 0)` })
				.from(bankAgentSpend)
				.where(and(eq(bankAgentSpend.mandateId, m.id), inArray(bankAgentSpend.status, ['reserved', 'settled', 'auth_unsettled']), gte(bankAgentSpend.createdAt, since)))
			const spent = BigInt(row?.total ?? '0')
			if (spent + a.amountMinor > BigInt(m.dailyCapMinor))
				throw bankErr('LIMIT_EXCEEDED', `Daily mandate cap exceeded (spent ${spent} + ${a.amountMinor} > ${m.dailyCapMinor})`)
			const id = newId('xfer').replace('xfer_', 'spend_')
			await tx.insert(bankAgentSpend).values({ id, mandateId: m.id, agentId: m.agentId, accountId: m.accountId, host: a.host, payee: a.payee, asset: a.asset, chain: a.chain, amountMinor: a.amountMinor.toString(), status: 'reserved', resourceUrl: a.url, ...(idem ? { idemKey: idem.key, idemHash: idem.hash } : {}) })
			return { id }
		}),
	)

const patchSpend = (id: string, patch: Partial<typeof bankAgentSpend.$inferInsert>) =>
	bankDb((db) => db.update(bankAgentSpend).set({ ...patch, updatedAt: new Date() }).where(eq(bankAgentSpend.id, id)).returning().then((r) => r[0]!))

const requestHash = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex')

// MONEY-PATH: same key + same terms -> stored original result; different terms -> CONFLICT; no stored result -> outcome pending/unknown.
const replayPay = (row: typeof bankAgentSpend.$inferSelect, hash: string): Effect.Effect<PayResult, BankError> => {
	if (row.idemHash !== hash) return Effect.fail(bankErr('CONFLICT', 'idempotencyKey was already used with different terms'))
	if (row.idemResult) return Effect.succeed({ ...(JSON.parse(row.idemResult) as PayResult), idempotent: true, replayed: true })
	return Effect.fail(bankErr('CONFLICT', `A payment with this idempotencyKey is in progress or its outcome is pending reconciliation (spend ${row.id}); do not retry with a new key`))
}

export const BankAgentPayServiceLive = Layer.succeed(BankAgentPayService, {
	openAgentAccount: (owner, i) =>
		Effect.gen(function* () {
			yield* requireAgent(owner)
			const asset = findAsset(i.asset, i.chain)
			if (!asset || asset.family !== 'evm') return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'x402 agent accounts need an EVM bank asset'))
			yield* Effect.try({ try: () => validateMandate(i.mandate), catch: (e) => e as BankError })
			if (!i.mandate.allowedAssets.map((s) => s.toUpperCase()).includes(asset.symbol))
				return yield* Effect.fail(bankErr('VALIDATION', `allowedAssets must include the account asset ${asset.symbol}`))
			const ledger = yield* BankLedgerService
			const wallet = yield* ledger.resolveCustodyWallet(owner, 'evm')
			const account = yield* ledger.openAccount({ owner, kind: 'checking', asset: asset.symbol, chain: asset.chain, label: i.label ?? 'agent-pay', segmentProfile: 'agent', wallet })
			const m = i.mandate
			const mandate = yield* bankDb(async (db) => {
				const [row] = await db
					.insert(bankAgentMandates)
					.values({ id: newId('acct').replace('acct_', 'mand_'), agentId: owner.ownerId, accountId: account.id, perCallMaxMinor: m.perCallMaxMinor, dailyCapMinor: m.dailyCapMinor, allowedHosts: (m.allowedHosts ?? []).map((h) => h.toLowerCase()), allowedPayees: (m.allowedPayees ?? []).map((p) => p.toLowerCase()), allowedAssets: m.allowedAssets.map((s) => s.toUpperCase()), expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })
					.returning()
				return row!
			})
			return { account, mandate }
		}),

	listMandates: (owner) => bankDb((db) => db.select().from(bankAgentMandates).where(eq(bankAgentMandates.agentId, owner.ownerId)).orderBy(desc(bankAgentMandates.createdAt))),

	revokeMandate: (owner, id) =>
		bankDb(async (db) => {
			const [r] = await db.update(bankAgentMandates).set({ status: 'revoked', updatedAt: new Date() }).where(and(eq(bankAgentMandates.id, id), eq(bankAgentMandates.agentId, owner.ownerId))).returning()
			if (!r) throw bankErr('NOT_FOUND', 'Mandate not found')
			return r
		}),

	// MONEY-PATH
	payForResource: (owner, i) =>
		Effect.gen(function* () {
			yield* requireAgent(owner)
			const mandate = yield* loadMandate(owner, i.mandateId)
			if (mandate.status !== 'active') return yield* Effect.fail(bankErr('POLICY_BLOCKED', 'Mandate is revoked'))
			if (mandate.expiresAt && mandate.expiresAt.getTime() <= Date.now()) return yield* Effect.fail(bankErr('POLICY_BLOCKED', 'Mandate has expired'))
			const host = yield* Effect.try({ try: () => hostOf(i.url), catch: (e) => e as BankError })
			if (mandate.allowedHosts.length && !hostAllowed(host, mandate.allowedHosts)) return yield* Effect.fail(bankErr('POLICY_BLOCKED', `Host ${host} is not in the mandate's allowed hosts`))
			const ledger = yield* BankLedgerService
			const account = yield* ledger.getAccount(owner, mandate.accountId)
			{ const sysErr = assertSpendable(account); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			if (account.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Agent account is not active'))
			const method = (i.method ?? 'GET').toUpperCase()
			const reqInit = { method, headers: i.headers, body: i.body }
			// MONEY-PATH: caller-supplied idempotency (optional; absent = legacy behaviour, reported as idempotent:false).
			const idem0 = i.idempotencyKey ? { key: i.idempotencyKey, hash: requestHash({ mandateId: i.mandateId, url: i.url, method, body: i.body ?? null, headers: i.headers ?? null }) } : undefined
			if (idem0) {
				const prior = yield* bankDb(async (db) => (await db.select().from(bankAgentSpend).where(and(eq(bankAgentSpend.agentId, owner.ownerId), eq(bankAgentSpend.idemKey, idem0.key))).limit(1))[0])
				if (prior) return yield* replayPay(prior, idem0.hash)
			}
			const first = yield* Effect.tryPromise({ try: () => guardedFetch(i.url, reqInit), catch: (e) => (e as BankError) })
			if (first.status !== 402) return { paid: false, status: first.status, body: first.body, contentType: first.headers['content-type'] ?? null }

			// --- choose a requirement the mandate + account can satisfy
			const reqs = yield* Effect.try({ try: () => parsePaymentRequired(first.headers, first.body), catch: (e) => e as BankError })
			const acctAsset = findAsset(account.asset, account.chain)
			if (!acctAsset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Account asset unsupported'))
			const req: X402Requirement | undefined = reqs.find((r) => r.scheme === 'exact' && r.chain === account.chain && r.asset.toLowerCase() === acctAsset.address.toLowerCase())
			if (!req) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No 'exact' payment option on ${account.chain} in ${acctAsset.symbol} (offered: ${reqs.map((r) => `${r.network}:${r.asset}`).join(', ')})`))
			if (!/^0x[0-9a-fA-F]{40}$/.test(req.payTo)) return yield* Effect.fail(bankErr('VALIDATION', 'payTo is not an EVM address'))
			const amount = BigInt(req.amountMinor)
			if (amount <= 0n) return yield* Effect.fail(bankErr('VALIDATION', 'Zero-amount payment requirement'))
			if (!mandate.allowedAssets.includes(acctAsset.symbol)) return yield* Effect.fail(bankErr('POLICY_BLOCKED', `Asset ${acctAsset.symbol} not allowed by mandate`))
			if (mandate.allowedPayees.length && !mandate.allowedPayees.includes(req.payTo.toLowerCase())) return yield* Effect.fail(bankErr('POLICY_BLOCKED', `Payee ${req.payTo} not allowed by mandate`))
			if (amount > BigInt(mandate.perCallMaxMinor)) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Price ${amount} exceeds per-call max ${mandate.perCallMaxMinor}`))
			const domain = req.extra.name && req.extra.version ? { name: String(req.extra.name), version: String(req.extra.version) } : yield* readTokenDomain(acctAsset)

			// --- reserve mandate budget, then reserve ledger funds (debit account -> clearing)
			const reservedSpend = yield* reserveSpend(mandate, { host, payee: req.payTo.toLowerCase(), asset: acctAsset.symbol, chain: account.chain, amountMinor: amount, url: i.url }, idem0)
			if (reservedSpend.existing) return yield* replayPay(reservedSpend.existing, idem0!.hash)
			const spendId = reservedSpend.id
			const nonce = `0x${randomBytes(32).toString('hex')}` as const
			const idem = `x402:${spendId}`
			const clearing = yield* ledger.ensureSystemAccount('clearing', acctAsset.symbol, account.chain)
			const external = yield* ledger.ensureSystemAccount('external', acctAsset.symbol, account.chain)
			const transferId = yield* bankDb(async (db) => {
				const [t] = await db
					.insert(bankTransfers)
					.values({ id: newId('xfer'), ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey: idem, requestHash: requestHash({ url: i.url, amount: amount.toString(), payTo: req.payTo, nonce }), type: 'agent', fromAccount: account.id, toAccount: null, toExternal: { address: req.payTo, chain: account.chain }, amountMinor: amount.toString(), asset: acctAsset.symbol, chain: account.chain, status: 'pending', memo: `x402 ${host}`.slice(0, 280), metadata: { protocol: 'x402', x402Version: req.version, url: i.url, mandateId: mandate.id, spendId, authNonce: nonce } })
					.returning()
				return t!.id
			})
			const fail = (reason: string) =>
				Effect.gen(function* () {
					yield* patchSpend(spendId, { status: 'failed', transferId, idemKey: null }) // failed => key is free to retry
					yield* bankDb((db) => db.update(bankTransfers).set({ status: 'failed', failureReason: reason, updatedAt: new Date() }).where(eq(bankTransfers.id, transferId)))
				})
			const reserved = yield* Effect.either(ledger.post({ transferId, phase: 'submit', legs: [{ accountId: account.id, direction: 'debit', amountMinor: amount }, { accountId: clearing.id, direction: 'credit', amountMinor: amount }] }))
			if (reserved._tag === 'Left') {
				yield* fail(reserved.left.message)
				return yield* Effect.fail(reserved.left)
			}
			const reverse = (reason: string) =>
				Effect.gen(function* () {
					yield* ledger.post({ transferId, phase: 'reverse', legs: [{ accountId: clearing.id, direction: 'debit', amountMinor: amount }, { accountId: account.id, direction: 'credit', amountMinor: amount }] })
					yield* fail(reason)
				})

			// --- sign EIP-3009 transferWithAuthorization (typed data digest -> Turnkey raw-payload signing)
			const now = Math.floor(Date.now() / 1000)
			const auth = { from: account.address!, to: req.payTo, value: amount.toString(), validAfter: String(now - 30), validBefore: String(now + Math.max(30, Math.min(req.maxTimeoutSeconds || 60, 60))), nonce }
			const digest = authorizationDigest(auth, { ...domain, chainId: acctAsset.chainId!, verifyingContract: acctAsset.address })
			const signed = yield* Effect.either(signDigestForAccount(account, digest))
			if (signed._tag === 'Left') {
				yield* reverse(`signing failed: ${signed.left.message}`)
				return yield* Effect.fail(signed.left)
			}
			const header = encodePayment(req, auth, signed.right)

			// --- retry with payment
			// MONEY-PATH: from here the signed authorization may be presented by the server at any time until validBefore.
			// Persist 'auth_unsettled' BEFORE the header leaves the process; it counts toward caps and is only ever resolved
			// by the authorizationState job (or a confirmed settlement) - never released on a mere 402/error response.
			yield* patchSpend(spendId, { status: 'auth_unsettled', authNonce: nonce, authValidBefore: Number(auth.validBefore), transferId })
			const second = yield* Effect.either(Effect.tryPromise({ try: () => guardedFetch(i.url, { ...reqInit, headers: { ...(i.headers ?? {}), [header.name]: header.value } }), catch: (e) => e as BankError }))
			if (second._tag === 'Left') {
				// Ambiguous: the signed authorization may have been presented. Keep funds reserved in clearing.
				yield* bankDb((db) => db.update(bankTransfers).set({ status: 'submitted', metadata: sql`${bankTransfers.metadata} || ${JSON.stringify({ ambiguous: true, error: second.left.message })}::jsonb`, updatedAt: new Date() }).where(eq(bankTransfers.id, transferId)))
				return yield* Effect.fail(bankErr('UPSTREAM', `Payment retry outcome unknown (authorization nonce ${nonce}); funds held in clearing for manual reconciliation: ${second.left.message}`))
			}
			const res = second.right
			const settlement = decodeSettlement(res.headers)
			if (res.status === 402) {
				// MONEY-PATH: the server still holds a valid authorization until validBefore; keep the reservation, the job resolves it.
				yield* bankDb((db) => db.update(bankTransfers).set({ status: 'submitted', metadata: sql`${bankTransfers.metadata} || ${JSON.stringify({ ambiguous: true, httpStatus: 402, authUnsettled: true })}::jsonb`, updatedAt: new Date() }).where(eq(bankTransfers.id, transferId)))
				return { paid: false, status: 402, body: res.body, contentType: res.headers['content-type'] ?? null, note: 'payment not accepted; funds stay reserved until the authorization expires and is verified unused onchain', spendId }
			}
			if (res.status < 300 && settlement?.success && settlement.transaction) {
				// MONEY-PATH: the seller's PAYMENT-RESPONSE is the counterparty's word, never proof. Keep the spend 'auth_unsettled'
				// and funds in clearing; the agent-pay-auth job confirms from chain (authorizationState used) or releases after expiry.
				const transfer = yield* bankDb(async (db) => {
					const [t] = await db.update(bankTransfers).set({ status: 'submitted', updatedAt: new Date(), metadata: sql`${bankTransfers.metadata} || ${JSON.stringify({ claimedSettlement: settlement, awaitingChainConfirmation: true })}::jsonb` }).where(eq(bankTransfers.id, transferId)).returning()
					return t!
				})
				return { paid: true, status: res.status, body: res.body, contentType: res.headers['content-type'] ?? null, settlement, transfer, spendId, note: 'seller reported settlement; debit is confirmed only once the authorization is seen used onchain' }
			}
			// Resource answered but did not confirm settlement: money may have moved. Hold in clearing, flag it.
			yield* bankDb((db) => db.update(bankTransfers).set({ status: 'submitted', metadata: sql`${bankTransfers.metadata} || ${JSON.stringify({ ambiguous: true, httpStatus: res.status, settlementHeader: settlement })}::jsonb`, updatedAt: new Date() }).where(eq(bankTransfers.id, transferId)))
			return { paid: true, status: res.status, body: res.body, contentType: res.headers['content-type'] ?? null, settlement: settlement ?? undefined, spendId, note: 'no confirmed PAYMENT-RESPONSE; funds held in clearing pending reconciliation' }
		}).pipe(
			// MONEY-PATH: persist the final result against the key so a retry returns it verbatim.
			Effect.tap((r) => (i.idempotencyKey && r.spendId && !r.replayed ? bankDb((db) => db.update(bankAgentSpend).set({ idemResult: JSON.stringify(r) }).where(eq(bankAgentSpend.id, r.spendId!))) : Effect.void)),
			Effect.map((r) => (r.replayed ? r : { ...r, idempotent: !!i.idempotencyKey })),
		),

	registerResource: (owner, i) =>
		Effect.gen(function* () {
			yield* requireAgent(owner)
			if (!UINT.test(i.priceMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'priceMinor must be a positive integer string'))
			const ledger = yield* BankLedgerService
			const account = yield* ledger.getAccount(owner, i.accountId)
			{ const sysErr = assertSpendable(account); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			const asset = findAsset(account.asset, account.chain)
			if (!asset || asset.family !== 'evm' || !account.address) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Seller account must be an EVM account with a custody address'))
			yield* Effect.tryPromise({ try: () => assertUrlSafeForFetch(i.upstreamUrl), catch: (e) => bankErr('POLICY_BLOCKED', `upstreamUrl rejected by SSRF guard: ${(e as Error).message}`) })
			yield* readTokenDomain(asset) // fail early if the token's EIP-712 domain is unreadable
			const slug = `${slugify(i.slug ?? i.title)}-${randomBytes(3).toString('hex')}`
			return yield* bankDb(async (db) => {
				const [r] = await db.insert(bankAgentResources).values({ id: newId('acct').replace('acct_', 'res_'), sellerAgentId: owner.ownerId, accountId: account.id, slug, title: i.title, description: i.description ?? null, upstreamUrl: i.upstreamUrl, priceMinor: i.priceMinor, asset: asset.symbol, chain: asset.chain }).returning()
				return r!
			})
		}),

	listMyResources: (owner) => bankDb((db) => db.select().from(bankAgentResources).where(eq(bankAgentResources.sellerAgentId, owner.ownerId)).orderBy(desc(bankAgentResources.createdAt))),

	setResourceStatus: (owner, id, status) =>
		bankDb(async (db) => {
			const [r] = await db.update(bankAgentResources).set({ status, updatedAt: new Date() }).where(and(eq(bankAgentResources.id, id), eq(bankAgentResources.sellerAgentId, owner.ownerId))).returning()
			if (!r) throw bankErr('NOT_FOUND', 'Resource not found')
			return r
		}),

	directory: (q) =>
		bankDb(async (db) => {
			const rows = await db.select().from(bankAgentResources).where(q?.asset ? and(eq(bankAgentResources.status, 'active'), eq(bankAgentResources.asset, q.asset.toUpperCase())) : eq(bankAgentResources.status, 'active')).orderBy(desc(bankAgentResources.createdAt)).limit(Math.min(q?.limit ?? 50, 200))
			// upstreamUrl and the seller's internal ids are never exposed; buyers call the paywalled proxy.
			return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, description: r.description, priceMinor: r.priceMinor, asset: r.asset, chain: r.chain, payPath: `/v1/agent/bank/agents/pay/${r.slug}`, protocol: 'x402', x402Versions: [2] }))
		}),

	// MONEY-PATH
	servePaidResource: (slug, req) =>
		Effect.gen(function* () {
			const res = yield* bankDb(async (db) => {
				const [r] = await db.select().from(bankAgentResources).where(and(eq(bankAgentResources.slug, slug), eq(bankAgentResources.status, 'active'))).limit(1)
				if (!r) throw bankErr('NOT_FOUND', 'Resource not found')
				return r
			})
			const ledger = yield* BankLedgerService
			const account = yield* ledger.getAccountById(res.accountId)
			const asset = findAsset(res.asset, res.chain)
			if (!asset?.chainId || !account.address) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Resource asset unavailable'))
			const domain = yield* readTokenDomain(asset)
			const resourceUrl = req.url
			const ch = buildChallenge({ chainId: asset.chainId, asset: asset.address, payTo: account.address, amountMinor: String(res.priceMinor), resource: resourceUrl, description: res.title, maxTimeoutSeconds: 120, domain })
			const payment = req.headers['payment-signature'] ?? req.headers['x-payment']
			if (!payment) return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify(ch.body) }

			// MONEY-PATH: one payment (chain + EIP-3009 authorization nonce) unlocks exactly one response. Claim the nonce
			// under a unique index BEFORE settling; a replayed/concurrent header loses the insert and gets a fresh 402.
			// MONEY-PATH: validate against SERVER requirements BEFORE any claim row exists (signer == from, to == payTo, exact price,
			// validity window, chain/asset). EOA signatures only (no ERC-1271 verifier in this repo). Failure => 402, NO row.
			const v = yield* Effect.promise(() => validatePaymentForResource(payment, { chainId: asset.chainId!, asset: asset.address, payTo: account.address!, amountMinor: String(res.priceMinor), domain, nowSec: Math.floor(Date.now() / 1000), maxTimeoutSeconds: 120 }))
			if (!v.ok) return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...ch.body, error: 'invalid_payment', reason: v.error, note: 'only EOA (ECDSA) signed EIP-3009 authorizations are accepted' }) }
			const authNonce = v.nonce
			const payerFrom = v.from
			// The payment-header hash is stored with the payer (`<addr>#<sha256>`); re-serve requires the identical header.
			const headerHash = createHash('sha256').update(payment).digest('hex')
			const payerKey = `${payerFrom}#${headerHash}`
			const claimId = newId('le').replace('le_', 'sale_')
			// MONEY-PATH: record validBefore + the chain head at claim time; the claim is never released/rejected before chain time passes validBefore, and the settlement-log search starts at headBlock.
			const headBlock = yield* Effect.promise(async () => { try { return String(BigInt(await jsonRpc<string>(rpcUrlFor(res.chain), 'eth_blockNumber', []))) } catch { return null } })
			const claimed = yield* bankDb((db) => db.insert(bankAgentResourceSales).values({ id: claimId, resourceId: res.id, payer: payerKey, txHash: `pending:${authNonce}`, amountMinor: String(res.priceMinor), asset: res.asset, chain: res.chain, authNonce, validBefore: v.authorization.validBefore, headBlock }).onConflictDoNothing().returning({ id: bankAgentResourceSales.id }))
			// MONEY-PATH: sale states live in tx_hash: 'pending:<nonce>' (claimed, settlement unknown) -> 'unserved:<tx|nonce:<nonce>>'
			// (settled onchain, resource not yet delivered) -> '<tx>' (served). Exactly one successful serve per settled sale.
			// MONEY-PATH: `tokenHash` (re-serve only) must equal the stored retrieval hash; the flip consumes it (one-shot).
			const serveSettled = (saleId: string, ref: string, payerAddr: string, network: string, tokenHash?: string) =>
				Effect.gen(function* () {
					const flipped = yield* bankDb((db) => db.update(bankAgentResourceSales).set({ txHash: ref, retrievalHash: null }).where(and(eq(bankAgentResourceSales.id, saleId), eq(bankAgentResourceSales.txHash, `unserved:${ref}`), tokenHash ? eq(bankAgentResourceSales.retrievalHash, tokenHash) : sql`true`)).returning({ id: bankAgentResourceSales.id }))
					if (!flipped.length) return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...ch.body, error: 'payment_already_used' }) }
					// The payer is in this request: hand them a fresh random retrieval token (only its sha256 is stored).
					const retrievalToken = randomBytes(32).toString('hex')
					const revert = () => bankDb((db) => db.update(bankAgentResourceSales).set({ txHash: `unserved:${ref}`, retrievalHash: createHash('sha256').update(retrievalToken).digest('hex') }).where(eq(bankAgentResourceSales.id, saleId))).pipe(Effect.ignore)
					const up = yield* Effect.tryPromise({ try: () => guardedFetch(res.upstreamUrl, { method: req.method === 'POST' ? 'POST' : 'GET', body: req.method === 'POST' ? req.body : undefined, headers: req.method === 'POST' ? { 'content-type': req.headers['content-type'] ?? 'application/json' } : undefined }), catch: (e) => e as BankError }).pipe(Effect.either)
					if (up._tag === 'Left' || up.right.status >= 500) {
						yield* revert()
						return { status: 502, headers: { 'content-type': 'application/json', 'x-retrieval-token': retrievalToken, ...encodeSettlement({ success: true, transaction: ref.startsWith('nonce:') ? undefined : ref, network, payer: payerAddr }) }, body: JSON.stringify({ error: 'upstream_failed_after_settlement', retrievalToken, note: 'payment settled; present the same payment header plus this token in the X-Retrieval-Token header to receive the resource once without paying again' }) }
					}
					const upr = up.right
					return { status: upr.status, headers: { ...encodeSettlement({ success: true, transaction: ref.startsWith('nonce:') ? undefined : ref, network, payer: payerAddr }), 'content-type': upr.headers['content-type'] ?? 'application/octet-stream' }, body: upr.body }
				})
			if (!claimed.length) {
				// Re-serve path for a settled-but-unserved sale: payer + sha256 of the EXACT header AND the one-shot retrieval token (the header alone
				// is rebuildable from the public settlement tx + challenge, so it is never sufficient). Token comes from the failed response or POST .../recover.
				const token = req.headers['x-retrieval-token']
				const tokenHash = token ? createHash('sha256').update(token).digest('hex') : undefined
				const prior = (yield* bankDb((db) => db.select().from(bankAgentResourceSales).where(and(eq(bankAgentResourceSales.chain, res.chain), eq(bankAgentResourceSales.authNonce, authNonce))).limit(1)))[0]
				if (prior && prior.resourceId === res.id && prior.txHash.startsWith('unserved:') && prior.payer.toLowerCase() === payerKey.toLowerCase() && tokenHash && prior.retrievalHash === tokenHash)
					return yield* serveSettled(prior.id, prior.txHash.slice('unserved:'.length), payerFrom, `eip155:${asset.chainId}`, tokenHash)
				return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...ch.body, error: 'payment_already_used' }) }
			}
			const env = yield* EnvService.pipe(Effect.mapError((e) => bankErr('NOT_CONFIGURED', `Environment unavailable: ${String(e)}`)))
			if (!isFacilitatorEnabled(env))
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'x402 facilitator is not enabled', { missing: 'X402_FACILITATOR_ENABLED=true plus X402_FACILITATOR_URL (or CDP_API_KEY_ID + CDP_API_KEY_SECRET)' }))
			const settle = yield* Effect.promise(() =>
				facilitatorVerifyAndSettle(env, payment, { scheme: 'exact', network: `eip155:${asset.chainId}`, maxAmountRequired: String(res.priceMinor), resource: resourceUrl, description: res.title, mimeType: 'application/json', payTo: account.address!, maxTimeoutSeconds: 120, asset: asset.address, extra: domain }),
			)
			// Facilitator failure/timeout is AMBIGUOUS (the tx may be onchain): the claim stays 'pending:<nonce>' and the
			// agent-pay-sales job reconciles it via authorizationState (used -> settled_unserved, unused+expired -> release).
			// MONEY-PATH: a DEFINITE rejection (facilitator answered and refused; not a timeout/transport error) deletes the pending claim so it is never reconcilable.
			if (!settle.ok && settle.definite === true)
				yield* bankDb((db) => db.delete(bankAgentResourceSales).where(and(eq(bankAgentResourceSales.id, claimId), eq(bankAgentResourceSales.txHash, `pending:${authNonce}`)))).pipe(Effect.ignore)
			if (!settle.ok || !settle.txHash) return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...ch.body, error: settle.ok ? 'settlement_missing_tx' : settle.error }) }
			const payer = payerFrom // verified signer; never the facilitator-claimed payer
			// Persist settled_unserved with the settlement tx BEFORE delivering; the unique tx_hash index also rejects a second claim for the same tx.
			// MONEY-PATH: only finalise a claim still in the state we created (a slow facilitator call must not overwrite a 'rejected:' row).
			const finalised = yield* bankDb((db) => db.update(bankAgentResourceSales).set({ txHash: `unserved:${settle.txHash!}` }).where(and(eq(bankAgentResourceSales.id, claimId), eq(bankAgentResourceSales.txHash, `pending:${authNonce}`))).returning({ id: bankAgentResourceSales.id }))
			if (!finalised.length) {
				// 0 rows: act on the real state. The reconcile job may already have recorded THIS settlement as unserved:<tx> -> continue; anything else -> refuse.
				const cur = (yield* bankDb((db) => db.select({ txHash: bankAgentResourceSales.txHash }).from(bankAgentResourceSales).where(eq(bankAgentResourceSales.id, claimId)).limit(1)))[0]
				if (cur?.txHash !== `unserved:${settle.txHash!}`) return { status: 402, headers: { ...ch.headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...ch.body, error: 'payment_already_used' }) }
			}
			// Credit the seller's ledger from the on-chain deposit (only sales actually settled reach here; creditSales retries).
			const owner: BankOwner = { ownerType: 'agent', ownerId: res.sellerAgentId }
			const credited = yield* Effect.either(BankTransferService.pipe(Effect.flatMap((t) => t.syncDeposit(owner, res.accountId))))
			if (credited._tag === 'Right' && BigInt(credited.right.creditedMinor) > 0n)
				yield* bankDb((db) => db.update(bankAgentResourceSales).set({ credited: 'true' }).where(eq(bankAgentResourceSales.id, claimId)))
			return yield* serveSettled(claimId, settle.txHash!, payerFrom, settle.network ?? `eip155:${asset.chainId}`)
		}),

	creditSales: (owner) =>
		Effect.gen(function* () {
			const pending = yield* bankDb((db) =>
				db.select({ id: bankAgentResourceSales.id, accountId: bankAgentResources.accountId }).from(bankAgentResourceSales).innerJoin(bankAgentResources, eq(bankAgentResources.id, bankAgentResourceSales.resourceId)).where(and(eq(bankAgentResources.sellerAgentId, owner.ownerId), eq(bankAgentResourceSales.credited, 'false'), sql`${bankAgentResourceSales.txHash} not like 'pending:%'`)),
			)
			let credited = 0
			const t = yield* BankTransferService
			for (const accountId of new Set(pending.map((p) => p.accountId))) {
				const r = yield* t.syncDeposit(owner, accountId)
				if (BigInt(r.creditedMinor) > 0n) {
					credited++
					yield* bankDb((db) => db.update(bankAgentResourceSales).set({ credited: 'true' }).where(inArray(bankAgentResourceSales.id, pending.filter((p) => p.accountId === accountId).map((p) => p.id))))
				}
			}
			return { credited }
		}),

	openMeteredStream: (owner, i) =>
		Effect.gen(function* () {
			yield* requireAgent(owner)
			const svc = yield* Effect.serviceOption(StreamTag)
			if (Option.isNone(svc) || typeof svc.value.openStream !== 'function')
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'Metered streams are provided by the payments module', { missing: 'BankStreamService (payments module) with openStream()/reportUsage()' }))
			const open = svc.value.openStream
			const ledger = yield* BankLedgerService
			yield* ledger.getAccount(owner, i.payerAccountId) // payer must be ours
			const payee = yield* ledger.getAccountById(i.payeeAccountId)
			if (payee.ownerType !== 'agent') return yield* Effect.fail(bankErr('VALIDATION', 'Payee account must belong to an agent'))
			if (!UINT.test(i.unitPriceMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'unitPriceMinor must be a positive integer string'))
			const stream = yield* open({ owner, ...i }).pipe(Effect.mapError((e) => (e instanceof Error && 'code' in e ? (e as BankError) : bankErr('UPSTREAM', `openStream failed: ${String(e)}`))))
			return { stream }
		}),

	reportMeteredUsage: (owner, i) =>
		Effect.gen(function* () {
			yield* requireAgent(owner)
			const svc = yield* Effect.serviceOption(StreamTag)
			if (Option.isNone(svc) || typeof svc.value.reportUsage !== 'function')
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'Metered streams are provided by the payments module', { missing: 'BankStreamService.reportUsage (payments module)' }))
			if (!UINT.test(i.units)) return yield* Effect.fail(bankErr('VALIDATION', 'units must be a positive integer string'))
			const usage = yield* svc.value.reportUsage({ owner, ...i }).pipe(Effect.mapError((e) => (e instanceof Error && 'code' in e ? (e as BankError) : bankErr('UPSTREAM', `reportUsage failed: ${String(e)}`))))
			return { usage }
		}),
} satisfies BankAgentPayServiceInterface)

// ------------------------------------------------------------ MONEY-PATH: resolve unsettled authorizations

const AUTH_STATE_SELECTOR = '0xe94a0102' // authorizationState(address,bytes32)
// MONEY-PATH: same per-chain safe depths as BankTransferService's reconciler (MIN_CONFIRMATIONS); default 10.
const SAFE_DEPTH: Record<string, bigint> = { ethereum: 12n, polygon: 64n, bsc: 15n, base: 10n, optimism: 10n, arbitrum: 60n }
const EXPIRY_MARGIN_SEC = 60
/** Reads authorizationState at a block `depth` behind head and returns that block's timestamp, so expiry is judged by chain time. */
/** MONEY-PATH: the SAFE block number (head minus per-chain depth); the log search and the authorization-state read must use the SAME one. */
const safeBlockOf = async (chain: string): Promise<bigint> => {
	const head = BigInt(await jsonRpc<string>(rpcUrlFor(chain), 'eth_blockNumber', []))
	return head > (SAFE_DEPTH[chain] ?? 10n) ? head - (SAFE_DEPTH[chain] ?? 10n) : 0n
}
const readAuthUsed = async (chain: string, token: string, from: string, nonce: string, atBlock?: bigint): Promise<{ used: boolean; chainTime: number }> => {
	const url = rpcUrlFor(chain)
	const safe = atBlock ?? (await safeBlockOf(chain))
	const tag = `0x${safe.toString(16)}`
	const blk = await jsonRpc<{ timestamp: string } | null>(url, 'eth_getBlockByNumber', [tag, false])
	if (!blk) throw new Error('safe block unavailable')
	const data = `${AUTH_STATE_SELECTOR}${from.toLowerCase().replace(/^0x/, '').padStart(64, '0')}${nonce.replace(/^0x/, '')}`
	const out = await jsonRpc<string>(url, 'eth_call', [{ to: token, data }, tag])
	return { used: BigInt(out as string) !== 0n, chainTime: Number(BigInt(blk.timestamp)) }
}

/** After validBefore (+margin) the authorization can no longer be submitted: used -> debit stands, unused -> release. */
export const resolveUnsettledAuthorizations = async (): Promise<number> => {
	const { runEffect } = await import('../../runtime')
	const rows = await runEffect(bankDb((db) => db.select().from(bankAgentSpend).where(eq(bankAgentSpend.status, 'auth_unsettled')).orderBy(bankAgentSpend.authValidBefore).limit(50)) as never) as (typeof bankAgentSpend.$inferSelect)[]
	let n = 0
	for (const sp of rows) {
		try {
			await runEffect(
				Effect.gen(function* () {
					const ledger = yield* BankLedgerService
					const account = yield* ledger.getAccountById(sp.accountId)
					const asset = findAsset(sp.asset, sp.chain)
					if (!asset || !account.address || !sp.authNonce || !sp.transferId) return
					const st = yield* Effect.tryPromise({ try: () => readAuthUsed(sp.chain, asset.address, account.address!, sp.authNonce!), catch: (e) => bankErr('UPSTREAM', String(e)) })
					const used = st.used
					// Unused: only release once the SAFE block's timestamp is past validBefore + margin (never the local clock).
					if (!used && !(sp.authValidBefore != null && st.chainTime > Number(sp.authValidBefore) + EXPIRY_MARGIN_SEC)) return
					const amount = BigInt(sp.amountMinor)
					const clearing = yield* ledger.ensureSystemAccount('clearing', sp.asset, sp.chain)
					const claim = yield* bankDb((db) => db.update(bankAgentSpend).set({ status: used ? 'settled' : 'failed', updatedAt: new Date() }).where(and(eq(bankAgentSpend.id, sp.id), eq(bankAgentSpend.status, 'auth_unsettled'))).returning({ id: bankAgentSpend.id }))
					if (!claim.length) return
					if (used) {
						const external = yield* ledger.ensureSystemAccount('external', sp.asset, sp.chain)
						yield* ledger.post({ transferId: sp.transferId!, phase: 'confirm', legs: [{ accountId: clearing.id, direction: 'debit', amountMinor: amount }, { accountId: external.id, direction: 'credit', amountMinor: amount }] })
						yield* bankDb((db) => db.update(bankTransfers).set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date(), metadata: sql`${bankTransfers.metadata} || ${JSON.stringify({ authUsedOnchain: true })}::jsonb` }).where(eq(bankTransfers.id, sp.transferId!)))
					} else {
						yield* ledger.post({ transferId: sp.transferId!, phase: 'reverse', legs: [{ accountId: clearing.id, direction: 'debit', amountMinor: amount }, { accountId: account.id, direction: 'credit', amountMinor: amount }] })
						yield* bankDb((db) => db.update(bankTransfers).set({ status: 'failed', failureReason: 'authorization expired unused', updatedAt: new Date() }).where(eq(bankTransfers.id, sp.transferId!)))
					}
					n++
				}) as never,
			)
		} catch {
			// ledger post failed after the claim: put it back so the next run retries (transfer still 'submitted')
			await runEffect(bankDb((db) => db.update(bankAgentSpend).set({ status: 'auth_unsettled' }).where(and(eq(bankAgentSpend.id, sp.id), sql`exists (select 1 from bank_transfers t where t.id = ${sp.transferId} and t.status in ('submitted','pending'))`))) as never).catch(() => undefined)
		}
	}
	return n
}
registerBankJob('agent-pay-auth', 60, resolveUnsettledAuthorizations)

const AUTH_USED_TOPIC = keccak256(toHex('AuthorizationUsed(address,bytes32)'))
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'))
const pad32 = (a: string) => `0x${a.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
type RpcLog = { address: string; topics: string[]; data: string; transactionHash: string }

/** MONEY-PATH: finds the tx where the token emitted AuthorizationUsed(authorizer=from, nonce) AND Transfer(from, payTo, value >= min)
 * in the SAME successful transaction. authorizationState alone is never proof (the pair may have paid anyone). Scans backwards in bounded chunks. */
const findSettlementTx = async (chain: string, token: string, from: string, nonce: string, payTo: string, minValue: bigint, createdSec: number, safe: bigint, startBlock: bigint | null): Promise<{ tx: string | null; complete: boolean }> => {
	const url = rpcUrlFor(chain)
	const CHUNK = 5000n
	// Lower bound: the head block stored at claim time (minus slack); legacy rows without it fall back to the claim's creation time.
	const lower = startBlock !== null ? (startBlock > 100n ? startBlock - 100n : 0n) : null
	for (let i = 0n; i < 200n; i++) {
		const to = safe - i * CHUNK
		if (to < 0n) return { tx: null, complete: true }
		const fromB = to >= CHUNK - 1n ? to - (CHUNK - 1n) : 0n
		const logs = await jsonRpc<RpcLog[]>(url, 'eth_getLogs', [{ address: token, fromBlock: `0x${fromB.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [AUTH_USED_TOPIC, pad32(from), nonce] }])
		for (const l of logs ?? []) {
			if (l.address.toLowerCase() !== token.toLowerCase()) continue
			const rc = await jsonRpc<{ status: string; logs: RpcLog[] } | null>(url, 'eth_getTransactionReceipt', [l.transactionHash])
			if (!rc || BigInt(rc.status) !== 1n) continue
			const ok = rc.logs.some((x) => x.address.toLowerCase() === token.toLowerCase() && x.topics[0] === TRANSFER_TOPIC && x.topics[1]?.toLowerCase() === pad32(from) && x.topics[2]?.toLowerCase() === pad32(payTo) && BigInt(x.data) >= minValue)
			if (ok) return { tx: l.transactionHash, complete: true }
		}
		if (fromB === 0n) return { tx: null, complete: true }
		if (lower !== null) { if (fromB <= lower) return { tx: null, complete: true }; continue }
		const blk = await jsonRpc<{ timestamp: string } | null>(url, 'eth_getBlockByNumber', [`0x${fromB.toString(16)}`, false])
		if (blk && Number(BigInt(blk.timestamp)) < createdSec - 600) return { tx: null, complete: true }
	}
	return { tx: null, complete: false } // window exhausted before reaching the claim: NOT a negative result
}

/** MONEY-PATH: reconcile paywall claims left 'pending:<nonce>' (facilitator threw/timed out). Only validated claims exist (signature checked
 * before insert). Settled requires the AuthorizationUsed + Transfer(from->payTo, >= price) logs in one tx (stored as unserved:<tx>). Nothing
 * found -> unused: delete after the grace window; used-but-unmatched or unprocessable rows go terminal 'rejected:<id>' (never silently deleted). */
export const reconcilePendingSales = async (): Promise<number> => {
	const { runEffect } = await import('../../runtime')
	const rows = (await runEffect(bankDb((db) => db.select().from(bankAgentResourceSales).where(and(sql`${bankAgentResourceSales.txHash} like 'pending:%'`, sql`${bankAgentResourceSales.createdAt} < now() - interval '2 minutes'`)).orderBy(bankAgentResourceSales.createdAt).limit(50)) as never)) as (typeof bankAgentResourceSales.$inferSelect)[]
	let n = 0
	const reject = (sale: (typeof rows)[number]) => runEffect(bankDb((db) => db.update(bankAgentResourceSales).set({ txHash: `rejected:${sale.id}` }).where(and(eq(bankAgentResourceSales.id, sale.id), sql`${bankAgentResourceSales.txHash} like 'pending:%'`))) as never)
	for (const sale of rows) {
		try {
			const ageSec = (Date.now() - sale.createdAt.getTime()) / 1000
			const payerAddr = sale.payer.split('#')[0] ?? ''
			const [resource] = (await runEffect(bankDb((db) => db.select().from(bankAgentResources).where(eq(bankAgentResources.id, sale.resourceId)).limit(1)) as never)) as (typeof bankAgentResources.$inferSelect)[]
			const asset = findAsset(sale.asset, sale.chain)
			const account = resource ? await runEffect(Effect.gen(function* () { return yield* (yield* BankLedgerService).getAccountById(resource.accountId) }) as never).catch(() => null) as { address: string | null } | null : null
			if (!resource || !asset || !account?.address || !sale.authNonce || !/^0x[0-9a-fA-F]{40}$/.test(payerAddr)) {
				if (ageSec > 3600) { await reject(sale); n++ } // can never be processed: terminal state
				continue
			}
			const safe = await safeBlockOf(sale.chain)
			const { tx, complete } = await findSettlementTx(sale.chain, asset.address, payerAddr, sale.authNonce, account.address, BigInt(sale.amountMinor), Math.floor(sale.createdAt.getTime() / 1000), safe, sale.headBlock ? BigInt(sale.headBlock) : null)
			if (tx) {
				await runEffect(bankDb((db) => db.update(bankAgentResourceSales).set({ txHash: `unserved:${tx}` }).where(and(eq(bankAgentResourceSales.id, sale.id), eq(bankAgentResourceSales.txHash, `pending:${sale.authNonce}`)))) as never)
				n++
			} else {
				const st = await readAuthUsed(sale.chain, asset.address, payerAddr, sale.authNonce, safe) // same safe block as the log search
				// MONEY-PATH: never release/reject before the SAFE block's timestamp is past the authorization's validBefore (+margin); legacy rows use the old 1h cap.
				const horizon = sale.validBefore ? Number(sale.validBefore) + EXPIRY_MARGIN_SEC : Math.floor(sale.createdAt.getTime() / 1000) + 3600 + 900
				if (st.chainTime <= horizon) continue
				// used + search incomplete (window missed the tx): stay pending and let the ops-alerts job surface it; never reject on a partial search.
				if (st.used && !complete) continue
				if (st.used) await reject(sale) // used, and a COMPLETE search found no payee/price match: terminal, never served
				else await runEffect(bankDb((db) => db.delete(bankAgentResourceSales).where(and(eq(bankAgentResourceSales.id, sale.id), eq(bankAgentResourceSales.txHash, `pending:${sale.authNonce}`)))) as never)
				n++
			}
		} catch {
			/* retry next run */
		}
	}
	return n
}
registerBankJob('agent-pay-sales', 120, reconcilePendingSales)

const RECOVER_TTL_MS = 5 * 60 * 1000
/** MONEY-PATH: recovery for a sale that went `unserved` via the reconcile job (the payer holds no retrieval token).
 * Without `signature`: returns a server-issued challenge bound to (sale, slug, nonce, expiry <= 5 min). With `signature`: an EIP-191
 * personal_sign of that challenge must recover to the authorization's `from`; a one-shot retrieval token is then issued (sha256 stored). */
export const recoverPaidResource = (slug: string, i: { chain: string; nonce: string; signature?: string }): Effect.Effect<{ challenge?: string; expiresAt?: string; retrievalToken?: string }, BankError, DrizzleService> =>
	bankDb(async (db) => {
		const nonce = i.nonce.toLowerCase()
		const [res] = await db.select().from(bankAgentResources).where(and(eq(bankAgentResources.slug, slug), eq(bankAgentResources.status, 'active'))).limit(1)
		const [sale] = res && res.chain === i.chain ? await db.select().from(bankAgentResourceSales).where(and(eq(bankAgentResourceSales.chain, res.chain), eq(bankAgentResourceSales.authNonce, nonce), eq(bankAgentResourceSales.resourceId, res.id))).limit(1) : []
		if (!res || !sale || !sale.txHash.startsWith('unserved:')) throw bankErr('NOT_FOUND', 'No recoverable sale for this resource/nonce')
		const payerAddr = sale.payer.split('#')[0] ?? ''
		const now = Date.now()
		if (!i.signature) {
			if (sale.recoverChallenge && sale.recoverExpires && sale.recoverExpires.getTime() > now) return { challenge: sale.recoverChallenge, expiresAt: sale.recoverExpires.toISOString() } // idempotent: an observer cannot invalidate the payer's challenge
			const expires = new Date(now + RECOVER_TTL_MS)
			const challenge = `Suwappu x402 recovery\nsale:${sale.id}\nresource:${slug}\nnonce:${nonce}\nexpires:${expires.toISOString()}\nr:${randomBytes(16).toString('hex')}`
			const set = await db.update(bankAgentResourceSales).set({ recoverChallenge: challenge, recoverExpires: expires }).where(and(eq(bankAgentResourceSales.id, sale.id), like(bankAgentResourceSales.txHash, 'unserved:%'))).returning({ id: bankAgentResourceSales.id })
			if (!set.length) throw bankErr('CONFLICT', 'Sale state changed; retry')
			return { challenge, expiresAt: expires.toISOString() }
		}
		if (!sale.recoverChallenge || !sale.recoverExpires || sale.recoverExpires.getTime() <= now) throw bankErr('VALIDATION', 'Challenge missing or expired; request a new one')
		let signer: string
		try { signer = await recoverMessageAddress({ message: sale.recoverChallenge, signature: i.signature as `0x${string}` }) } catch { throw bankErr('VALIDATION', 'Signature unrecoverable') }
		if (signer.toLowerCase() !== payerAddr.toLowerCase()) throw bankErr('POLICY_BLOCKED', 'Signature is not from the payer')
		const token = randomBytes(32).toString('hex')
		// single-use challenge: consumed atomically with token issuance
		const ok = await db.update(bankAgentResourceSales).set({ retrievalHash: createHash('sha256').update(token).digest('hex'), recoverChallenge: null, recoverExpires: null }).where(and(eq(bankAgentResourceSales.id, sale.id), eq(bankAgentResourceSales.recoverChallenge, sale.recoverChallenge), like(bankAgentResourceSales.txHash, 'unserved:%'))).returning({ id: bankAgentResourceSales.id })
		if (!ok.length) throw bankErr('CONFLICT', 'Challenge already used')
		return { retrievalToken: token }
	})
