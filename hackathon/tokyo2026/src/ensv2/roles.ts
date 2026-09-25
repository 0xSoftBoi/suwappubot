/**
 * Custom roles for the PermissionedRegistry, built on ENSv2's role-bitmap
 * Enhanced Access Control.
 *
 * Roles are single bits; grants are bitwise ORs. The owner holds ADMIN and
 * delegates narrow roles to agent keys:
 *  - POLICY_READER: read policy text records (any key may resolve, no bit needed
 *    for public reads — kept for explicit offchain gating).
 *  - METADATA_WRITER: update harmless records (avatar, description, version).
 *  - LIMIT_WRITER: reserved for a multisig/owner — agents NEVER get this.
 *
 * The invariant the demo proves: the agent key can update its own description
 * but CANNOT rewrite suwappu.policy (its spending caps).
 */

/** Role bit positions (custom — not ENS-reserved bits). */
export const ROLES = {
	ADMIN: 1n << 0n,
	POLICY_READER: 1n << 1n,
	METADATA_WRITER: 1n << 2n,
	LIMIT_WRITER: 1n << 3n,
} as const

export type RoleName = keyof typeof ROLES

export function grantRoles(current: bigint, ...roles: RoleName[]): bigint {
	return roles.reduce((acc, r) => acc | ROLES[r], current)
}

export function revokeRoles(current: bigint, ...roles: RoleName[]): bigint {
	return roles.reduce((acc, r) => acc & ~ROLES[r], current)
}

export function hasRole(grants: bigint, role: RoleName): boolean {
	return (grants & ROLES[role]) !== 0n
}

/** The delegation the owner gives each agent key at registration. */
export const AGENT_DEFAULT_ROLES: RoleName[] = ['POLICY_READER', 'METADATA_WRITER']

/** Assert the security invariant: no LIMIT_WRITER in an agent grant. */
export function assertAgentGrantSafe(grants: bigint): void {
	if (hasRole(grants, 'LIMIT_WRITER')) {
		throw new Error('SECURITY: agent grant must never include LIMIT_WRITER')
	}
	if (hasRole(grants, 'ADMIN')) {
		throw new Error('SECURITY: agent grant must never include ADMIN')
	}
}
