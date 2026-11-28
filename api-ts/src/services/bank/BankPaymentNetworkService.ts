/**
 * M11 open payment network standard (see docs/plans/open-payment-address-spec.md).
 * A versioned, signed JSON "payment address" document per handle; a resolver that fetches another
 * institution's document over HTTPS (SSRF-guarded), verifies its EIP-191 signature and picks the
 * best common rail using the M12 fee model.
 */
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { hashMessage, recoverAddress } from 'viem'
import { type DrizzleService, bankPaymentAddresses } from '../../db'
import { EnvService } from '../../config/EnvService'
import type { TurnkeyService } from '../TurnkeyService'
import { BankLedgerService } from './BankLedgerService'
import { feeModel } from './BankPaymentsChainService'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { guardedFetch } from './ssrfFetch'
import { signDigestForAccount } from './typedSigning'
import { findAsset } from './assets'

export const SPEC_VERSION = 'suwappu-pay/1'
export interface PaymentRail { type: 'onchain'; chain: string; chainId: number | null; asset: string; tokenAddress: string; address: string; decimals: number }
export interface ComplianceFlags { kycLevel: 'none' | 'basic' | 'full'; travelRuleSupported: boolean; sanctionsScreened: boolean; jurisdictions: string[] }
export interface PaymentAddressDocument {
	version: typeof SPEC_VERSION
	handle: string
	institution: { name: string; domain: string }
	rails: PaymentRail[]
	compliance: ComplianceFlags
	issuedAt: string
	expiresAt: string
	signature?: { scheme: 'eip191'; signer: string; value: string }
}

/** Canonical bytes to sign: JSON with recursively sorted keys, signature field removed. */
export function canonicalize(doc: PaymentAddressDocument): string {
	const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'signature').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sort(x)])) : v)
	return JSON.stringify(sort({ ...doc, signature: undefined }))
}

export async function verifyDocument(doc: PaymentAddressDocument, now = Date.now()): Promise<{ valid: boolean; signer: string | null; reasons: string[]; signerBoundToRail: boolean }> {
	const reasons: string[] = []
	if (doc.version !== SPEC_VERSION) reasons.push(`unsupported version ${doc.version}`)
	if (!doc.signature || doc.signature.scheme !== 'eip191') return { valid: false, signer: null, reasons: [...reasons, 'missing or unsupported signature (eip191 required)'], signerBoundToRail: false }
	if (Date.parse(doc.expiresAt) <= now) reasons.push('document expired')
	let signer: string | null = null
	try {
		signer = await recoverAddress({ hash: hashMessage(canonicalize(doc)), signature: doc.signature.value as `0x${string}` })
		if (signer.toLowerCase() !== doc.signature.signer.toLowerCase()) reasons.push('signature does not recover to declared signer')
	} catch {
		reasons.push('signature unrecoverable')
	}
	const bound = !!signer && doc.rails.some((r) => r.address.toLowerCase() === signer!.toLowerCase())
	// MONEY-PATH: a self-declared signer unrelated to any advertised rail address proves nothing; require binding.
	if (!bound) reasons.push('signer is not bound to any advertised rail address')
	return { valid: reasons.length === 0, signer, reasons, signerBoundToRail: bound }
}

const HANDLE = /^[a-z0-9][a-z0-9._-]{1,62}$/

export interface BankPaymentNetworkServiceInterface {
	readonly publish: (owner: BankOwner, i: { handle: string; institutionName: string; domain?: string; accountIds?: string[]; compliance: ComplianceFlags; ttlDays?: number; signature?: string }) => Effect.Effect<{ document: PaymentAddressDocument }, BankError, DrizzleService | BankLedgerService | TurnkeyService | EnvService>
	readonly getLocal: (handle: string) => Effect.Effect<{ document: PaymentAddressDocument; verification: Awaited<ReturnType<typeof verifyDocument>> }, BankError, DrizzleService>
	readonly resolve: (i: { address: string; chains?: string[]; asset: string; amountMinor: string }) => Effect.Effect<Record<string, unknown>, BankError>
}
export class BankPaymentNetworkService extends Context.Tag('BankPaymentNetworkService')<BankPaymentNetworkService, BankPaymentNetworkServiceInterface>() {}

export const BankPaymentNetworkServiceLive = Layer.succeed(BankPaymentNetworkService, {
	publish: (owner, i) =>
		Effect.gen(function* () {
			const handle = i.handle.toLowerCase()
			if (!HANDLE.test(handle)) return yield* Effect.fail(bankErr('VALIDATION', 'handle must be 2-63 chars of a-z0-9._-'))
			const ledger = yield* BankLedgerService
			// MONEY-PATH: only accounts the owner explicitly chose are advertised (default none); institution domain is the service's configured one.
			if (!i.accountIds?.length) return yield* Effect.fail(bankErr('VALIDATION', 'accountIds is required: choose which accounts to advertise'))
			const chosen = new Set(i.accountIds)
			const accts = (yield* ledger.getAccounts(owner)).filter((a) => chosen.has(a.id) && a.status === 'active' && a.address && a.walletId != null)
			const env = yield* EnvService.pipe(Effect.mapError((e) => bankErr('NOT_CONFIGURED', `Environment unavailable: ${String(e)}`)))
			if (!env.BANK_PAY_DOMAIN) return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'BANK_PAY_DOMAIN is not configured', { missing: 'BANK_PAY_DOMAIN' }))
			const rails: PaymentRail[] = []
			for (const a of accts) {
				const asset = findAsset(a.asset, a.chain)
				if (asset?.family === 'evm') rails.push({ type: 'onchain', chain: asset.chain, chainId: asset.chainId, asset: asset.symbol, tokenAddress: asset.address, address: a.address!, decimals: asset.decimals })
			}
			if (!rails.length) return yield* Effect.fail(bankErr('VALIDATION', 'Owner has no active EVM accounts to advertise'))
			const issued = new Date()
			const doc: PaymentAddressDocument = { version: SPEC_VERSION, handle, institution: { name: i.institutionName, domain: env.BANK_PAY_DOMAIN.toLowerCase() }, rails, compliance: i.compliance, issuedAt: issued.toISOString(), expiresAt: new Date(issued.getTime() + (i.ttlDays ?? 30) * 86_400_000).toISOString() }
			const first = accts.find((a) => findAsset(a.asset, a.chain)?.family === 'evm')!
			let value: string
			let signer: string
			if (i.signature) {
				value = i.signature
				signer = yield* Effect.tryPromise({ try: () => recoverAddress({ hash: hashMessage(canonicalize(doc)), signature: i.signature as `0x${string}` }), catch: () => bankErr('VALIDATION', 'Supplied signature is not a valid EIP-191 signature over the canonical document') })
				if (!rails.some((r) => r.address.toLowerCase() === signer.toLowerCase())) return yield* Effect.fail(bankErr('VALIDATION', 'Signer must be one of the advertised rail addresses'))
			} else {
				value = yield* signDigestForAccount(first, hashMessage(canonicalize(doc)))
				signer = first.address!
			}
			doc.signature = { scheme: 'eip191', signer, value }
			const saved = yield* bankDb(async (db) => {
				const [ex] = await db.select().from(bankPaymentAddresses).where(eq(bankPaymentAddresses.handle, handle)).limit(1)
				if (ex && (ex.ownerType !== owner.ownerType || ex.ownerId !== owner.ownerId)) throw bankErr('CONFLICT', 'Handle already taken')
				return await db.insert(bankPaymentAddresses).values({ handle, ownerType: owner.ownerType, ownerId: owner.ownerId, document: doc as never, signature: value, signer, signatureScheme: 'eip191' }).onConflictDoUpdate({ target: bankPaymentAddresses.handle, set: { document: doc as never, signature: value, signer, updatedAt: new Date() }, setWhere: and(eq(bankPaymentAddresses.ownerType, owner.ownerType), eq(bankPaymentAddresses.ownerId, owner.ownerId)) }).returning({ handle: bankPaymentAddresses.handle })
			})
			if (!saved.length) return yield* Effect.fail(bankErr('CONFLICT', 'Handle already taken'))
			return { document: doc }
		}),

	getLocal: (handle) =>
		Effect.gen(function* () {
			const row = yield* bankDb(async (db) => {
				const [r] = await db.select().from(bankPaymentAddresses).where(eq(bankPaymentAddresses.handle, handle.toLowerCase())).limit(1)
				if (!r) throw bankErr('NOT_FOUND', 'Handle not found')
				return r
			})
			const document = row.document as unknown as PaymentAddressDocument
			return { document, verification: yield* Effect.promise(() => verifyDocument(document)) }
		}),

	resolve: (i) =>
		Effect.gen(function* () {
			const m = /^([a-z0-9][a-z0-9._-]{1,62})@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(i.address.trim())
			if (!m) return yield* Effect.fail(bankErr('VALIDATION', 'address must be handle@domain'))
			const url = `https://${m[2]!.toLowerCase()}/.well-known/suwappu-pay/${encodeURIComponent(m[1]!.toLowerCase())}`
			const res = yield* Effect.tryPromise({ try: () => guardedFetch(url, { headers: { accept: 'application/json' }, maxBytes: 200_000 }), catch: (e) => e as BankError })
			if (res.status !== 200) return yield* Effect.fail(bankErr('UPSTREAM', `Institution returned HTTP ${res.status} for ${url}`))
			const doc = yield* Effect.try({ try: () => JSON.parse(res.body) as PaymentAddressDocument, catch: () => bankErr('UPSTREAM', 'Payment address document is not valid JSON') })
			if (doc.handle?.toLowerCase() !== m[1]!.toLowerCase() || doc.institution?.domain?.toLowerCase() !== m[2]!.toLowerCase()) return yield* Effect.fail(bankErr('VALIDATION', 'Document handle/domain does not match the requested address'))
			const v = yield* Effect.promise(() => verifyDocument(doc))
			if (!v.valid) return { verified: false, reason: `Document failed verification: ${v.reasons.join('; ')}`, handle: doc.handle, institution: doc.institution, verification: v }
			const sym = i.asset.toUpperCase()
			const common = doc.rails.filter((r) => r.asset.toUpperCase() === sym && (!i.chains || i.chains.map((c) => c.toLowerCase()).includes(r.chain)) && (findAsset(sym, r.chain)?.address.toLowerCase() === r.tokenAddress.toLowerCase()))
			if (!common.length) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No common rail for ${sym}${i.chains ? ` on ${i.chains.join(',')}` : ''}`))
			const model = yield* feeModel({ asset: sym, amountMinor: i.amountMinor, chains: [...new Set(common.map((r) => r.chain))] })
			const best = common.find((r) => r.chain === model.recommended?.chain) ?? common[0]!
			return { verified: true, handle: doc.handle, institution: doc.institution, compliance: doc.compliance, verification: v, selected: best, commonRails: common, recommendation: model.recommended, feeModel: model.chains }
		}),
})
