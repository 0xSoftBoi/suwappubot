/**
 * ENSv2 Enhanced Access Control roles — canonical constants, not inventions.
 *
 * Two role families (verified 2026-09-25 from contracts-v2 @
 * sepolia-deployment-2026-09-15):
 *
 * 1. RegistryRolesLib (`contracts/src/registry/libraries/RegistryRolesLib.sol`)
 *    — roles on REGISTRIES, scoped to a name's resource. Each role is one
 *    nybble (4 bits); the admin counterpart is the same nybble shifted << 128.
 *
 * 2. PermissionedResolverLib (`contracts/src/resolver/libraries/PermissionedResolverLib.sol`)
 *    — roles on RESOLVERS, scoped per record key: `resource(key) =
 *    uint256(keccak256(bytes(key)))` (NOT per name — the grant is key-scoped;
 *    per-agent isolation comes from each agent owning its own resolver proxy).
 *    `setText` requires ROLE_SET_TEXT on `resource(key)` (see `onlyRoles` in
 *    PermissionedResolver.sol).
 *
 * The demo's security invariant, expressed in real mechanics:
 * the owner deploys the agent's resolver, then calls
 * `grantSetterRoles(setText(name, key, ""), agentKey)` ONLY for metadata keys
 * (avatar, description, agent-version). The agent key therefore holds
 * ROLE_SET_TEXT scoped to `resource("avatar")` etc — and NOTHING for
 * `resource("suwappu.policy")`. When the agent key calls
 * `setText(name, "suwappu.policy", …)`, `onlyRoles` → `_checkRoles`
 * reverts. The agent can update its own description but CANNOT rewrite its
 * spending caps. Onchain, not policy text.
 */
import { keccak256 } from 'viem'

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

/** Resolver-level roles (PermissionedResolverLib @ sepolia-deployment-2026-09-15). */
export const RESOLVER_ROLES = {
	/** Bit 0: authorizes setting address records. */
	SET_ADDRESS: 1n << 0n,
	/** Bit 4: authorizes setting text records. */
	SET_TEXT: 1n << 4n,
	/** Bit 8: authorizes setting the contenthash record. */
	SET_CONTENTHASH: 1n << 8n,
	/** Bit 12: authorizes setting ABI records. */
	SET_ABI: 1n << 12n,
	/** Bit 16: authorizes setting interface records. */
	SET_INTERFACE: 1n << 16n,
	/** Bit 20: authorizes setting the reverse name record. */
	SET_NAME: 1n << 20n,
	/** Bit 24: authorizes setting data records. */
	SET_DATA: 1n << 24n,
	/** Bit 28: authorizes linking records. */
	LINK: 1n << 28n,
	/** Bit 120: authorizes contract naming. */
	CAN_NAME: 1n << 120n,
	/** Bit 124: authorizes UUPS proxy upgrades. */
	UPGRADE: 1n << 124n,
} as const

/**
 * EAC resource for a record key on a PermissionedResolver.
 * resource(key) = uint256(keccak256(bytes(key))) — key-scoped, not name-scoped.
 */
export function resolverResource(key: string): bigint {
	return BigInt(keccak256(Buffer.from(key, 'utf8')))
}

/** The exact resource guarding one text key. */
export function textRecordResource(key: string): bigint {
	return resolverResource(key)
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
 * agent key for via `grantSetterRoles(setText(name, key, ""), agentKey)`.
 * The agent key must never be authorized for the policy key (or any
 * suwappu.* key) — otherwise it could rewrite its own spending caps.
 * This is a setup-time guard; the onchain `onlyRoles` check is the
 * enforcement.
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
 * `initialize`) is safe to hand to an AGENT key: no admin bits (which
 * would let the agent authorize itself for new keys) and no UPGRADE (proxy
 * takeover). Agents normally hold NO root bitmap — their writes are scoped
 * via grantSetterRoles — so any non-empty agent root grant is suspect.
 */
export function assertAgentRootGrantSafe(grants: bigint): void {
	if (grants === 0n) return
	const adminBits = grants >> 128n
	if (adminBits !== 0n) {
		throw new Error('SECURITY: agent grant must never include admin roles (<< 128 bits)')
	}
	if (hasRole(grants, RESOLVER_ROLES.UPGRADE)) {
		throw new Error('SECURITY: agent grant must never include UPGRADE (proxy takeover)')
	}
	throw new Error('SECURITY: agent keys hold scoped per-key grants, not root bitmaps')
}
