/**
 * M12 private payouts: ERC-5564 scheme 1 stealth addresses with a sender-side compliance view key.
 * Payroll asks for privatePayoutAddress(payeeMetaAddress). The ephemeral key per payout is derived
 * from the owner's compliance secret, so the employer/auditor holding the exported view key can
 * recompute which stealth address belongs to which payee (payee meta-address) without any spend key.
 * Neither the compliance secret nor the payee's view key can move funds.
 */
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { randomBytes } from 'node:crypto'
import { type DrizzleService, bankStealthPayouts, bankStealthViewKeys } from '../../db'
import { RPC_ENDPOINTS } from '../../config/chains'
import { jsonRpc, rpcUrlFor } from './chainRpc'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import { ANNOUNCER, ANNOUNCEMENT_TOPIC, type AnnouncementLike, SCHEME_ID, type ScanMatch, announceCalldata, complianceEphemeralKey, decodeAnnouncementLog, deriveStealthAddress, generateStealthKeys, parseMetaAddress, registerKeysCalldata, scanAnnouncements } from './stealth'

type Fx<A> = Effect.Effect<A, BankError, DrizzleService>

export interface PrivatePayout {
	payoutRef: string
	stealthAddress: string
	ephemeralPublicKey: string
	viewTag: string
	announcer: string
	announceCalldata: string
	schemeId: string
}

export interface BankPrivacyServiceInterface {
	/** New recipient key set. Private keys are returned ONCE and never stored. */
	readonly generateMetaAddress: () => Effect.Effect<ReturnType<typeof generateStealthKeys> & { registryCalldata: { to: string; data: string }; schemeId: string }>
	readonly privatePayoutAddress: (owner: BankOwner, payeeMetaAddress: string, payoutRef: string, token?: { address: string; amountMinor: string }) => Fx<PrivatePayout>
	readonly recordAnnouncement: (owner: BankOwner, payoutRef: string, txHash: string, chain: string) => Fx<{ ok: true }>
	readonly scan: (i: { chain: string; fromBlock: string; toBlock?: string; viewPrivateKey: `0x${string}`; spendPublicKey: `0x${string}` }) => Effect.Effect<{ scanned: number; matches: ScanMatch[] }, BankError>
	readonly complianceExport: (owner: BankOwner) => Fx<{ viewSecret: string; payouts: Array<{ payoutRef: string; payeeMetaAddress: string; stealthAddress: string; chain: string | null; announceTx: string | null }> }>
}
export class BankPrivacyService extends Context.Tag('BankPrivacyService')<BankPrivacyService, BankPrivacyServiceInterface>() {}

const REF = /^[A-Za-z0-9_.:-]{1,128}$/

const viewSecretFor = (owner: BankOwner): Fx<`0x${string}`> =>
	bankDb(async (db) => {
		const id = `${owner.ownerType}:${owner.ownerId}`
		const [row] = await db.select().from(bankStealthViewKeys).where(eq(bankStealthViewKeys.id, id)).limit(1)
		if (row) return row.secret as `0x${string}`
		const secret = `0x${randomBytes(32).toString('hex')}`
		await db.insert(bankStealthViewKeys).values({ id, ownerType: owner.ownerType, ownerId: owner.ownerId, secret }).onConflictDoNothing()
		const [again] = await db.select().from(bankStealthViewKeys).where(eq(bankStealthViewKeys.id, id)).limit(1)
		return again!.secret as `0x${string}`
	})

export const BankPrivacyServiceLive = Layer.succeed(BankPrivacyService, {
	generateMetaAddress: () => Effect.sync(() => { const k = generateStealthKeys(); return { ...k, registryCalldata: { to: '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538', data: registerKeysCalldata(k.metaAddress) }, schemeId: SCHEME_ID.toString() } }),

	privatePayoutAddress: (owner, payeeMetaAddress, payoutRef, token) =>
		Effect.gen(function* () {
			if (!REF.test(payoutRef)) return yield* Effect.fail(bankErr('VALIDATION', 'payoutRef must be 1-128 chars of A-Za-z0-9_.:-'))
			yield* Effect.try({ try: () => parseMetaAddress(payeeMetaAddress), catch: (e) => e as BankError })
			const secret = yield* viewSecretFor(owner)
			const payout = yield* Effect.try({ try: () => deriveStealthAddress(payeeMetaAddress, complianceEphemeralKey(secret, payoutRef)), catch: (e) => e as BankError })
			const existing = yield* bankDb(async (db) => {
				const [r] = await db.select().from(bankStealthPayouts).where(and(eq(bankStealthPayouts.ownerType, owner.ownerType), eq(bankStealthPayouts.ownerId, owner.ownerId), eq(bankStealthPayouts.payoutRef, payoutRef))).limit(1)
				if (r && r.payeeMeta.toLowerCase() !== payeeMetaAddress.toLowerCase().replace(/^st:[a-z0-9]+:/, '')) throw bankErr('CONFLICT', 'payoutRef already used for a different payee')
				if (!r) await db.insert(bankStealthPayouts).values({ id: newId('le').replace('le_', 'sp_'), ownerType: owner.ownerType, ownerId: owner.ownerId, payoutRef, stealthAddress: payout.stealthAddress, ephemeralPub: payout.ephemeralPublicKey, viewTag: payout.viewTag, payeeMeta: payeeMetaAddress.replace(/^st:[a-z0-9]+:/, '') }).onConflictDoNothing()
				return r
			})
			void existing // deterministic derivation => same payoutRef always yields the same address
			return {
				payoutRef,
				stealthAddress: payout.stealthAddress,
				ephemeralPublicKey: payout.ephemeralPublicKey,
				viewTag: payout.viewTag,
				announcer: ANNOUNCER,
				announceCalldata: announceCalldata(payout, token ? { address: token.address, amountMinor: BigInt(token.amountMinor) } : undefined),
				schemeId: SCHEME_ID.toString(),
			}
		}),

	recordAnnouncement: (owner, payoutRef, txHash, chain) =>
		bankDb(async (db) => {
			const r = await db.update(bankStealthPayouts).set({ announceTx: txHash, chain }).where(and(eq(bankStealthPayouts.ownerType, owner.ownerType), eq(bankStealthPayouts.ownerId, owner.ownerId), eq(bankStealthPayouts.payoutRef, payoutRef))).returning()
			if (!r.length) throw bankErr('NOT_FOUND', 'Payout not found')
			return { ok: true as const }
		}),

	scan: (i) =>
		Effect.gen(function* () {
			if (!RPC_ENDPOINTS[i.chain] && i.chain !== 'tempo') return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No RPC for chain ${i.chain}`))
			const logs = yield* Effect.tryPromise({
				try: () => jsonRpc<Array<{ topics: string[]; data: string }>>(rpcUrlFor(i.chain), 'eth_getLogs', [{ address: ANNOUNCER, fromBlock: i.fromBlock, toBlock: i.toBlock ?? 'latest', topics: [ANNOUNCEMENT_TOPIC, `0x${SCHEME_ID.toString(16).padStart(64, '0')}`] }]),
				catch: (e) => (e as BankError),
			})
			const anns: AnnouncementLike[] = []
			for (const l of logs) {
				try { anns.push(decodeAnnouncementLog(l)) } catch { /* skip malformed */ }
			}
			const matches = yield* Effect.try({ try: () => scanAnnouncements(anns, { viewPrivateKey: i.viewPrivateKey, spendPublicKey: i.spendPublicKey }), catch: () => bankErr('VALIDATION', 'Invalid view/spend key material') })
			return { scanned: anns.length, matches }
		}),

	complianceExport: (owner) =>
		Effect.gen(function* () {
			const viewSecret = yield* viewSecretFor(owner)
			const rows = yield* bankDb((db) => db.select().from(bankStealthPayouts).where(and(eq(bankStealthPayouts.ownerType, owner.ownerType), eq(bankStealthPayouts.ownerId, owner.ownerId))))
			return { viewSecret, payouts: rows.map((r) => ({ payoutRef: r.payoutRef, payeeMetaAddress: `st:eth:${r.payeeMeta}`, stealthAddress: r.stealthAddress, chain: r.chain, announceTx: r.announceTx })) }
		}),
})
