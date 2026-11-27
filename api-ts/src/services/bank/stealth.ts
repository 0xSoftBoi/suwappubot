/**
 * ERC-5564 scheme 1 (secp256k1) stealth addresses + ERC-6538 registry calldata. Pure functions.
 * Shared secret: s = r*P_view; s_h = keccak256(x-coordinate of s); view tag = first byte of s_h;
 * stealth pub = P_spend + s_h*G; recipient key = p_spend + s_h (mod n).
 * The x-coordinate hashing follows the ERC-5564 reference SDK convention; cross-implementation
 * interop is UNVERIFIED (round-trip within this module is verified).
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { decodeAbiParameters, encodeFunctionData, getAddress, hexToBytes, keccak256, parseAbi, toHex } from 'viem'
import { bankErr } from './errors'

export const ANNOUNCER = '0x55649E01B5Df198D18D95b5cc5051630cfD45564' as const
export const REGISTRY = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538' as const
export const SCHEME_ID = 1n
const N = secp256k1.CURVE.n
const G = secp256k1.ProjectivePoint.BASE
export const ANNOUNCEMENT_TOPIC = keccak256(toHex('Announcement(uint256,address,address,bytes,bytes)'))

const hex = (b: Uint8Array) => toHex(b)
const bytes = (h: string) => hexToBytes(h as `0x${string}`)
const randScalar = (): bigint => {
	for (;;) {
		const k = BigInt(hex(secp256k1.utils.randomPrivateKey()))
		if (k > 0n && k < N) return k
	}
}
const scalarHex = (k: bigint) => `0x${k.toString(16).padStart(64, '0')}` as `0x${string}`
const addrOf = (p: InstanceType<typeof secp256k1.ProjectivePoint>): `0x${string}` => getAddress(`0x${keccak256(hex(p.toRawBytes(false).slice(1))).slice(26)}`)
const sharedHash = (s: InstanceType<typeof secp256k1.ProjectivePoint>) => keccak256(hex(s.toRawBytes(false).slice(1, 33)))

export interface StealthKeys {
	spendPrivateKey: `0x${string}`
	viewPrivateKey: `0x${string}`
	spendPublicKey: `0x${string}`
	viewPublicKey: `0x${string}`
	/** `st:eth:0x<spendPub33><viewPub33>` */
	metaAddress: string
}

export function generateStealthKeys(): StealthKeys {
	const sp = randScalar()
	const vp = randScalar()
	const spendPub = hex(secp256k1.getPublicKey(sp, true))
	const viewPub = hex(secp256k1.getPublicKey(vp, true))
	return { spendPrivateKey: scalarHex(sp), viewPrivateKey: scalarHex(vp), spendPublicKey: spendPub, viewPublicKey: viewPub, metaAddress: `st:eth:0x${spendPub.slice(2)}${viewPub.slice(2)}` }
}

export function parseMetaAddress(meta: string): { spendPub: `0x${string}`; viewPub: `0x${string}`; raw: `0x${string}` } {
	const m = /^(?:st:[a-z0-9]+:)?0x([0-9a-fA-F]{132})$/.exec(meta.trim())
	if (!m) throw bankErr('VALIDATION', 'Invalid stealth meta-address (expected st:eth:0x + 66 bytes: compressed spend pubkey || compressed view pubkey)')
	const raw = m[1]!
	const spendPub = `0x${raw.slice(0, 66)}` as const
	const viewPub = `0x${raw.slice(66)}` as const
	try {
		secp256k1.ProjectivePoint.fromHex(spendPub.slice(2)).assertValidity()
		secp256k1.ProjectivePoint.fromHex(viewPub.slice(2)).assertValidity()
	} catch {
		throw bankErr('VALIDATION', 'Meta-address contains an invalid secp256k1 public key')
	}
	return { spendPub, viewPub, raw: `0x${raw}` }
}

export interface StealthPayout {
	stealthAddress: `0x${string}`
	ephemeralPublicKey: `0x${string}`
	viewTag: `0x${string}`
}

/** Derive a stealth address for a payee meta-address. `ephemeralPrivateKey` is supplied for deterministic (compliance-derivable) payouts. */
export function deriveStealthAddress(meta: string, ephemeralPrivateKey?: `0x${string}`): StealthPayout {
	const { spendPub, viewPub } = parseMetaAddress(meta)
	const r = ephemeralPrivateKey ? BigInt(ephemeralPrivateKey) : randScalar()
	if (r <= 0n || r >= N) throw bankErr('VALIDATION', 'Invalid ephemeral key')
	const s = secp256k1.ProjectivePoint.fromHex(viewPub.slice(2)).multiply(r)
	const sh = sharedHash(s)
	const shScalar = BigInt(sh) % N
	if (shScalar === 0n) throw bankErr('VALIDATION', 'Degenerate shared secret; retry with a new ephemeral key')
	const stealth = secp256k1.ProjectivePoint.fromHex(spendPub.slice(2)).add(G.multiply(shScalar))
	return { stealthAddress: addrOf(stealth), ephemeralPublicKey: hex(secp256k1.getPublicKey(r, true)), viewTag: `0x${sh.slice(2, 4)}` }
}

/** Deterministic ephemeral key for a payout under a sender-side compliance secret. */
export function complianceEphemeralKey(viewSecret: `0x${string}`, payoutRef: string): `0x${string}` {
	for (let i = 0; i < 8; i++) {
		const k = BigInt(keccak256(toHex(`${viewSecret}|${payoutRef}|${i}`))) % N
		if (k > 0n) return scalarHex(k)
	}
	throw bankErr('VALIDATION', 'Could not derive ephemeral key')
}

export interface AnnouncementLike {
	stealthAddress: string
	ephemeralPublicKey: string
	/** Full metadata bytes; first byte = view tag. */
	metadata: string
}

export interface ScanMatch {
	stealthAddress: string
	ephemeralPublicKey: string
	/** Private key controlling the stealth address (recipient-only; needs the spend key). */
	stealthPrivateKey?: `0x${string}`
}

/** Scan announcements with the VIEW key (+ spend public key). Pass spendPrivateKey to also recover keys. */
export function scanAnnouncements(anns: AnnouncementLike[], k: { viewPrivateKey: `0x${string}`; spendPublicKey: `0x${string}`; spendPrivateKey?: `0x${string}` }): ScanMatch[] {
	const v = BigInt(k.viewPrivateKey)
	const spendPoint = secp256k1.ProjectivePoint.fromHex(k.spendPublicKey.slice(2))
	const out: ScanMatch[] = []
	for (const a of anns) {
		let sh: `0x${string}`
		try {
			sh = sharedHash(secp256k1.ProjectivePoint.fromHex(a.ephemeralPublicKey.slice(2)).multiply(v))
		} catch {
			continue
		}
		const tag = a.metadata.slice(2, 4).toLowerCase()
		if (tag && tag !== sh.slice(2, 4)) continue // view-tag fast reject (~255/256 of non-matches)
		const shScalar = BigInt(sh) % N
		if (addrOf(spendPoint.add(G.multiply(shScalar))).toLowerCase() !== a.stealthAddress.toLowerCase()) continue
		out.push({
			stealthAddress: a.stealthAddress,
			ephemeralPublicKey: a.ephemeralPublicKey,
			...(k.spendPrivateKey ? { stealthPrivateKey: scalarHex((BigInt(k.spendPrivateKey) + shScalar) % N) } : {}),
		})
	}
	return out
}

export const addressOfPrivateKey = (pk: `0x${string}`): `0x${string}` => addrOf(secp256k1.ProjectivePoint.fromPrivateKey(pk.slice(2)))

const announcerAbi = parseAbi(['function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)'])
const registryAbi = parseAbi(['function registerKeys(uint256 schemeId, bytes stealthMetaAddress)', 'function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)'])

/** Metadata: view tag, optionally followed by the ERC-5564 ERC-20 transfer hint (selector, token, amount). */
export function buildMetadata(viewTag: string, token?: { address: string; amountMinor: bigint }): `0x${string}` {
	if (!token) return `0x${viewTag.slice(2)}`
	return `0x${viewTag.slice(2)}a9059cbb${token.address.slice(2).toLowerCase().padStart(40, '0')}${token.amountMinor.toString(16).padStart(64, '0')}`
}

export const announceCalldata = (p: StealthPayout, token?: { address: string; amountMinor: bigint }) =>
	encodeFunctionData({ abi: announcerAbi, functionName: 'announce', args: [SCHEME_ID, p.stealthAddress, p.ephemeralPublicKey, buildMetadata(p.viewTag, token)] })

/** ERC-6538 registerKeys calldata for the 66-byte raw meta address. */
export const registerKeysCalldata = (meta: string) => encodeFunctionData({ abi: registryAbi, functionName: 'registerKeys', args: [SCHEME_ID, parseMetaAddress(meta).raw] })
export const stealthMetaAddressOfCalldata = (registrant: string) => encodeFunctionData({ abi: registryAbi, functionName: 'stealthMetaAddressOf', args: [registrant as `0x${string}`, SCHEME_ID] })

/** Decode an Announcement log (topics: [sig, schemeId, stealthAddress, caller]; data: bytes ephemeralPubKey, bytes metadata). */
export function decodeAnnouncementLog(log: { topics: string[]; data: string }): AnnouncementLike & { schemeId: bigint; caller: string } {
	const [eph, metadata] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }], log.data as `0x${string}`)
	return { schemeId: BigInt(log.topics[1]!), stealthAddress: getAddress(`0x${log.topics[2]!.slice(26)}`), caller: getAddress(`0x${log.topics[3]!.slice(26)}`), ephemeralPublicKey: eph, metadata }
}
