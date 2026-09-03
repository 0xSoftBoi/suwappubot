const MANAGED_WALLET_SERVER_METADATA_KEYS = [
	'wallet_address',
	'wallet_sub_org_id',
	'turnkey_wallet_id',
	'turnkey_account_id',
	'internal_user_id',
	'internal_wallet_id',
	'managed_wallet_identity_version',
	'managed_wallet_provision_token',
	'managed_wallet_provision_started_at',
] as const

// `walletAddress` and `subOrgId` were consumed by the legacy Polymarket route.
// They were never server-owned, so old agents may still contain caller-forged
// values. Reject them on new writes, drop them during metadata replacement, and
// never treat them as durable identity fields.
export const MANAGED_WALLET_METADATA_KEYS = [
	...MANAGED_WALLET_SERVER_METADATA_KEYS,
	'walletAddress',
	'subOrgId',
] as const

const MANAGED_WALLET_METADATA_KEY_SET = new Set<string>(MANAGED_WALLET_METADATA_KEYS)

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export type ManagedAgentWalletIdentity = {
	address: string
	subOrgId: string
	walletId?: string
	accountId?: string
}

// Version 1 existed while callers could still forge agent metadata. Version 2
// is only written after reserved-key enforcement and provider attestation.
export const MANAGED_WALLET_IDENTITY_VERSION = 2

export function isManagedWalletMetadataKey(key: string): boolean {
	return MANAGED_WALLET_METADATA_KEY_SET.has(key)
}

/** Read only the canonical server-owned Turnkey identity fields. */
export function managedAgentWalletIdentityFromMetadata(
	metadata: unknown,
): ManagedAgentWalletIdentity | null {
	const value = (metadata || {}) as Record<string, unknown>
	const address = value.wallet_address
	const subOrgId = value.wallet_sub_org_id
	const walletId = value.turnkey_wallet_id
	const accountId = value.turnkey_account_id
	if (
		typeof address !== 'string' ||
		!EVM_ADDRESS_RE.test(address) ||
		typeof subOrgId !== 'string' ||
		!subOrgId
	) {
		return null
	}
	return {
		address,
		subOrgId,
		...(typeof walletId === 'string' && walletId ? { walletId } : {}),
		...(typeof accountId === 'string' && accountId ? { accountId } : {}),
	}
}

function positiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function managedAgentWalletIsProvisioned(metadata: unknown): boolean {
	const value = (metadata || {}) as Record<string, unknown>
	return (
		managedAgentWalletIdentityFromMetadata(value) !== null &&
		value.managed_wallet_identity_version === MANAGED_WALLET_IDENTITY_VERSION &&
		positiveSafeInteger(value.internal_user_id) &&
		positiveSafeInteger(value.internal_wallet_id)
	)
}

/** Replace caller-owned metadata while retaining every server-owned wallet field. */
export function preserveManagedWalletMetadata(
	current: unknown,
	replacement: Record<string, unknown>,
): Record<string, unknown> {
	const result = Object.fromEntries(
		Object.entries(replacement).filter(([key]) => !isManagedWalletMetadataKey(key)),
	)
	if (!current || typeof current !== 'object' || Array.isArray(current)) return result
	const currentRecord = current as Record<string, unknown>
	for (const key of MANAGED_WALLET_SERVER_METADATA_KEYS) {
		if (Object.hasOwn(currentRecord, key)) result[key] = currentRecord[key]
	}
	return result
}
