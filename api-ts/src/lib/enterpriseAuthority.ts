export const ORG_ROLES = [
	'owner',
	'admin',
	'trader',
	'approver',
	'auditor',
	'member',
	'viewer',
] as const

export type OrgRole = (typeof ORG_ROLES)[number]

export const ORG_READ_ROLES: OrgRole[] = [...ORG_ROLES]

export const ORG_MEMBER_ASSIGNABLE_ROLES = [
	'admin',
	'trader',
	'approver',
	'auditor',
	'member',
	'viewer',
] as const

export const ENTERPRISE_ROLE_CAPABILITIES: Record<OrgRole, readonly string[]> = {
	owner: [
		'org:manage',
		'members:manage',
		'keys:manage',
		'trade:initiate',
		'trade:approve',
		'audit:read',
	],
	admin: ['org:manage', 'members:manage', 'keys:manage', 'audit:read'],
	trader: ['trade:initiate', 'keys:execution', 'org:read'],
	approver: ['trade:approve', 'org:read', 'audit:read'],
	auditor: ['org:read', 'audit:read'],
	member: ['org:read'],
	viewer: ['org:read'],
}

/**
 * Effective machine authority is bounded by the CURRENT role of the human
 * principal who created the key. This makes demotion/removal take effect on
 * existing credentials without waiting for a separate revocation action.
 */
export const KEY_SCOPES_BY_ROLE: Record<OrgRole, readonly string[]> = {
	owner: ['trade:read', 'swap:execute', 'admin'],
	admin: ['trade:read', 'admin'],
	trader: ['trade:read', 'swap:execute'],
	approver: [],
	auditor: [],
	member: [],
	viewer: [],
}

export function isOrgRole(value: string | null | undefined): value is OrgRole {
	return ORG_ROLES.includes(value as OrgRole)
}

export function effectiveApiKeyScopes(role: OrgRole, requested: readonly string[]): string[] {
	const allowed = new Set(KEY_SCOPES_BY_ROLE[role])
	return requested.filter((scope) => allowed.has(scope))
}
