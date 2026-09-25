/**
 * ENSv2 Enhanced Access Control roles — canonical constants, not inventions.
 *
 * Two role families (verified 2026-09-25 from contracts-v2 @ 97a57293):
 *
 * 1. RegistryRolesLib (`contracts/src/registry/libraries/RegistryRolesLib.sol`)
 *    — roles on REGISTRIES, scoped to a name's resource. Each role is one
 *    nybble (4 bits); the admin counterpart is the same nybble shifted << 128.
 *
 * 2. PermissionedResolverLib (`contracts/src/resolver/libraries/PermissionedResolverLib.sol`)
 *    — roles on RESOLVERS, scoped per (name, record). `resource(node, part) =
 *    keccak256(abi.encode(node, part))` where node = namehash and part =
 *    keccak256(key) for text records. `setText` requires ROLE_SET_TEXT on
 *    `resource(namehash, keccak256(key))` (see `onlyPartRoles` in
 *    PermissionedResolver.sol).
 *
 * The demo's security invariant, expressed in real mechanics:
 * the owner deploys the agent's resolver, then calls
 * `authorizeTextRoles(dnsName, key, agentKey, true)` ONLY for metadata keys
 * (avatar, description, suwappu.agent-version). The agent key therefore holds
 * ROLE_SET_TEXT scoped to `resource(namehash, keccak256("avatar"))` etc —
 * and NOTHING for `keccak256("suwappu.policy")`. When the agent key calls
 * `setText(node, "suwappu.policy", …)`, `onlyPartRoles` → `_checkRoles`
 * reverts with EACUnauthorizedAccountRoles. The agent can update its own
 * description but CANNOT rewrite its spending caps. Onchain, not policy text.
 */
import { keccak256, encodeAbiParameters } from 'viem'

/** Registry-level roles (RegistryRolesLib). */
export const REGISTRY_ROLES = {
	/** Nybble 0: authorizes registering/reserving new names. Root only. */
	REGISTRAR: 1n << 0n,
	/** Nybble 2: authorizes setting the parent registry. Root only. */
	SET_PARENT: 1n << 8n,
	/** Nybble 4: authorizes extending name expiry. Root or token. */
	RENEW: 1n << 16n,
	/** Nybble 5: authorizes changing a name's child registry. Root or token. */
	SET_SUBREGISTRY: 1n << 20n,
	/** Nybble 6: authorizes changing a name's resolver. Root or token. */
	SET_RESOLVER: 1n << 24n,
	/** Nybble 9: authorizes setting the URI. Root-only. */
	SET_URI: 1n << 36n,
	/** Nybble 30: authorizes contract naming. Root-only. */
	CAN_NAME: 1n << 120n,
	/** Nybble 31: authorizes UUPS proxy upgrades. Root-only. */
	UPGRADE: 1n << 124n,
} as const

/** Admin counterparts: nybble shifted 128 bits (authorizes granting the role). */
export function adminOf(role: bigint): bigint {
	return role << 128n
}

/** Resolver-level roles (PermissionedResolverLib). */
export const RESOLVER_ROLES = {
	/** Nybble 0: authorizes setting address records. Root or name. */
	SET_ADDR: 1n << 0n,
	/** Nybble 1: authorizes setting text records. Root or name. */
	SET_TEXT: 1n << 4n,
	/** Nybble 2: authorizes setting the contenthash record. Root or name. */
	SET_CONTENTHASH: 1n << 8n,
	/** Nybble 3: authorizes setting the public key record. Root or name. */
	SET_PUBKEY: 1n << 12n,
	/** Nybble 4: authorizes setting ABI records. Root or name. */
	SET_ABI: 1n << 16n,
	/** Nybble 6: authorizes setting the reverse name record. Root or name. */
	SET_NAME: 1n << 24n,
	/** Nybble 8: authorizes clearing (version-bumping) all records. Root or name. */
	CLEAR: 1n << 32n,
	/** Nybble 9: authorizes setting data records. Root or name. */
	SET_DATA: 1n << 36n,
} as const

/**
 * EAC resource for a (name, record) pair on a PermissionedResolver.
 * resource(node, part) = keccak256(abi.encode(node, part)).
 */
export function resolverResource(node: `0x${string}`, part: `0x${string}`): bigint {
	return BigInt(
		keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])),
	)
}

/** part = keccak256(key) for string-keyed (text/data) records. */
export function textPart(key: string): `0x${string}` {
	return keccak256(Buffer.from(key, 'utf8'))
}

/** The exact resource guarding one text key on one name. */
export function textRecordResource(node: `0x${string}`, key: string): bigint {
	return resolverResource(node, textPart(key))
}

/** Bitwise helpers over real role bitmaps. */
export function grantRoles(current: bigint, ...roles: bigint[]): bigint {
	return roles.reduce((acc, r) => acc | r, current)
}

export function revokeRoles(current: bigint, ...roles: bigint[]): bigint {
	return roles.reduce((acc, r) => acc & ~r, current)
}

export function hasRole(grants: bigint, role: bigint): boolean {
	return (grants & role) !== 0n
}

/**
 * Assert the security invariant on the KEY LIST the owner authorizes the
 * agent key for via `authorizeTextRoles(dnsName, key, agentKey, true)`.
 * The agent key must never be authorized for the policy key (or any
 * suwappu.* key) — otherwise it could rewrite its own spending caps.
 * This is a setup-time guard; the onchain `onlyPartRoles` check is the
 * enforcement (reverts with EACUnauthorizedAccountRoles).
 */
export function assertAgentKeysSafe(authorizedKeys: readonly string[], policyKey: string): void {
	for (const k of authorizedKeys) {
		if (k === policyKey) {
			throw new Error(`SECURITY: agent key must never be authorized for ${policyKey}`)
		}
		if (k.startsWith('suwappu.')) {
			throw new Error(`SECURITY: agent key must never be authorized for reserved key ${k}`)
		}
	}
}

/**
 * Assert a resolver-level root role bitmap (e.g. the admin bitmap passed to
 * `initialize`) is safe to hand to an AGENT key: no admin nybbles (which
 * would let the agent authorize itself for new keys) and no CLEAR (record
 * wipe). Agents normally hold NO root bitmap — their writes are scoped via
 * authorizeTextRoles — so any non-empty agent root grant is suspect.
 */
export function assertAgentRootGrantSafe(grants: bigint): void {
	if (grants === 0n) return
	const adminBits = grants >> 128n
	if (adminBits !== 0n) {
		throw new Error('SECURITY: agent grant must never include admin roles (<< 128 nybbles)')
	}
	if (hasRole(grants, RESOLVER_ROLES.CLEAR)) {
		throw new Error('SECURITY: agent grant must never include CLEAR (record wipe)')
	}
	throw new Error('SECURITY: agent keys hold scoped per-key grants, not root bitmaps')
}
