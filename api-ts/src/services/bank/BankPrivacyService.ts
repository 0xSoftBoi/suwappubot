/**
 * M12 private payouts: ERC-5564 scheme 1 stealth addresses with a sender-side compliance view key.
 * Payroll asks for privatePayoutAddress(payeeMetaAddress). The ephemeral key per payout is derived
 * from the owner's compliance secret, so the employer/auditor holding the exported view key can
 * recompute which stealth address belongs to which payee (payee meta-address) without any spend key.
 * Neither the compliance secret nor the payee's view key can move funds.
 */
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { type DrizzleService, bankStealthPayouts, bankStealthViewKeys } from '../../db'
import { RPC_ENDPOINTS } from '../../config/chains'
import { jsonRpc, rpcUrlFor } from './chainRpc'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import type { EnvService } from '../../config/EnvService'
import { orgSecret } from './BankOrgService'
import { ANNOUNCER, ANNOUNCEMENT_TOPIC, type AnnouncementLike, SCHEME_ID, type ScanMatch, announceCalldata, complianceEphemeralKey, decodeAnnouncementLog, deriveStealthAddress, generateStealthKeys, parseMetaAddress, registerKeysCalldata, scanAnnouncements } from './stealth'

type Fx<A> = Effect.Effect<A, BankError, DrizzleService>
type FxEnv<A> = Effect.Effect<A, BankError, DrizzleService | EnvService>

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
	readonly privatePayoutAddress: (owner: BankOwner, payeeMetaAddress: string, payoutRef: string, token?: { address: string; amountMinor: string }) => FxEnv<PrivatePayout>
	readonly recordAnnouncement: (owner: BankOwner, payoutRef: string, txHash: string, chain: string) => Fx<{ ok: true }>
	readonly scan: (i: { chain: string; fromBlock: string; toBlock?: string; viewPrivateKey: `0x${string}`; spendPublicKey: `0x${string}` }) => Effect.Effect<{ scanned: number; matches: ScanMatch[]; keyHandling: 'server' }, BankError>
	/** Raw ERC-5564 announcements (scheme 1) so a client can view-tag filter and derive locally without sending its view key. Paginated by `cursor` (offset into the ordered range). */
	readonly announcements: (i: { chain: string; fromBlock: string; toBlock?: string; cursor?: number; limit?: number }) => Effect.Effect<{ announcements: Array<{ stealthAddress: string; ephemeralPublicKey: string; viewTag: string; metadata: string; txHash: string; blockNumber: string; logIndex: number }>; nextCursor: number | null; total: number }, BankError>
	readonly complianceExport: (owner: BankOwner) => FxEnv<{ viewSecret: string; payouts: Array<{ payoutRef: string; payeeMetaAddress: string; stealthAddress: string; chain: string | null; announceTx: string | null }> }>
}
export class BankPrivacyService extends Context.Tag('BankPrivacyService')<BankPrivacyService, BankPrivacyServiceInterface>() {}

const REF = /^[A-Za-z0-9_.:-]{1,128}$/

// MONEY-PATH: envelope encryption of the compliance view secret at rest. A random per-row DEK (AES-256-GCM) encrypts the
// secret; the DEK is wrapped by a KEK HKDF-derived from the bank's managed signing secret (orgSecret = EnvService.JWT_SECRET,
// the same managed secret bank approval tokens use). api-ts has no KMS client (KMS_* lives in the Python bot), so no new key
// is introduced. Format: env1:<b64 wrapIv>.<b64 wrapped DEK+tag>.<b64 iv>.<b64 ciphertext+tag>. The plaintext is never logged.
const kekFrom = (root: string): Buffer => Buffer.from(hkdfSync('sha256', root, 'suwappu-bank', 'stealth-view-secret-kek-v1', 32))
const gcmEnc = (key: Buffer, pt: Buffer): [Buffer, Buffer] => {
	const iv = randomBytes(12)
	const c = createCipheriv('aes-256-gcm', key, iv)
	return [iv, Buffer.concat([c.update(pt), c.final(), c.getAuthTag()])]
}
const gcmDec = (key: Buffer, iv: Buffer, blob: Buffer): Buffer => {
	const d = createDecipheriv('aes-256-gcm', key, iv)
	d.setAuthTag(blob.subarray(blob.length - 16))
	return Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()])
}
const sealSecret = (root: string, secret: string): string => {
	const dek = randomBytes(32)
	const [wiv, wrapped] = gcmEnc(kekFrom(root), dek)
	const [iv, ct] = gcmEnc(dek, Buffer.from(secret, 'utf8'))
	return `env1:${[wiv, wrapped, iv, ct].map((b) => b.toString('base64')).join('.')}`
}
const openSecret = (root: string, stored: string): string => {
	if (!stored.startsWith('env1:')) return stored // legacy plaintext row; re-sealed by viewSecretFor
	const [wiv, wrapped, iv, ct] = stored.slice(5).split('.').map((x) => Buffer.from(x, 'base64'))
	if (!wiv || !wrapped || !iv || !ct) throw bankErr('DB', 'Malformed sealed view secret')
	return gcmDec(gcmDec(kekFrom(root), wiv, wrapped), iv, ct).toString('utf8')
}

// Single decrypt point; both call sites (privatePayoutAddress, complianceExport) go through here.
const viewSecretFor = (owner: BankOwner): FxEnv<`0x${string}`> =>
	Effect.gen(function* () {
		const root = yield* orgSecret
		return yield* bankDb(async (db) => {
			const id = `${owner.ownerType}:${owner.ownerId}`
			const [row] = await db.select().from(bankStealthViewKeys).where(eq(bankStealthViewKeys.id, id)).limit(1)
			if (row) {
				const plain = openSecret(root, row.secret) as `0x${string}`
				if (!row.secret.startsWith('env1:')) await db.update(bankStealthViewKeys).set({ secret: sealSecret(root, plain) }).where(and(eq(bankStealthViewKeys.id, id), eq(bankStealthViewKeys.secret, row.secret)))
				return plain
			}
			const secret = `0x${randomBytes(32).toString('hex')}`
			await db.insert(bankStealthViewKeys).values({ id, ownerType: owner.ownerType, ownerId: owner.ownerId, secret: sealSecret(root, secret) }).onConflictDoNothing()
			const [again] = await db.select().from(bankStealthViewKeys).where(eq(bankStealthViewKeys.id, id)).limit(1)
			return openSecret(root, again!.secret) as `0x${string}`
		})
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
			return { scanned: anns.length, matches, keyHandling: 'server' as const }
		}),

	announcements: (i) =>
		Effect.gen(function* () {
			if (!RPC_ENDPOINTS[i.chain] && i.chain !== 'tempo') return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No RPC for chain ${i.chain}`))
			const logs = yield* Effect.tryPromise({
				try: () => jsonRpc<Array<{ topics: string[]; data: string; transactionHash: string; blockNumber: string; logIndex: string }>>(rpcUrlFor(i.chain), 'eth_getLogs', [{ address: ANNOUNCER, fromBlock: i.fromBlock, toBlock: i.toBlock ?? 'latest', topics: [ANNOUNCEMENT_TOPIC, `0x${SCHEME_ID.toString(16).padStart(64, '0')}`] }]),
				catch: (e) => (e as BankError),
			})
			const all: Array<{ stealthAddress: string; ephemeralPublicKey: string; viewTag: string; metadata: string; txHash: string; blockNumber: string; logIndex: number }> = []
			for (const l of logs) {
				try {
					const a = decodeAnnouncementLog(l)
					all.push({ stealthAddress: a.stealthAddress, ephemeralPublicKey: a.ephemeralPublicKey, viewTag: `0x${a.metadata.slice(2, 4)}`, metadata: a.metadata, txHash: l.transactionHash, blockNumber: String(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)) })
				} catch { /* skip malformed */ }
			}
			const start = Math.max(0, Math.floor(i.cursor ?? 0))
			const limit = Math.min(Math.max(Math.floor(i.limit ?? 200), 1), 500)
			const page = all.slice(start, start + limit)
			return { announcements: page, nextCursor: start + limit < all.length ? start + limit : null, total: all.length }
		}),

	complianceExport: (owner) =>
		Effect.gen(function* () {
			const viewSecret = yield* viewSecretFor(owner)
			const rows = yield* bankDb((db) => db.select().from(bankStealthPayouts).where(and(eq(bankStealthPayouts.ownerType, owner.ownerType), eq(bankStealthPayouts.ownerId, owner.ownerId))))
			return { viewSecret, payouts: rows.map((r) => ({ payoutRef: r.payoutRef, payeeMetaAddress: `st:eth:${r.payeeMeta}`, stealthAddress: r.stealthAddress, chain: r.chain, announceTx: r.announceTx })) }
		}),
})
