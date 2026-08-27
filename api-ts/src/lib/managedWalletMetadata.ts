export const MANAGED_WALLET_METADATA_KEYS = [
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

const MANAGED_WALLET_METADATA_KEY_SET = new Set<string>(MANAGED_WALLET_METADATA_KEYS)

export function isManagedWalletMetadataKey(key: string): boolean {
	return MANAGED_WALLET_METADATA_KEY_SET.has(key)
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
	for (const key of MANAGED_WALLET_METADATA_KEYS) {
		if (Object.hasOwn(currentRecord, key)) result[key] = currentRecord[key]
	}
	return result
}
