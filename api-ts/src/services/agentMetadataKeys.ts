/**
 * Reserved `agent.metadata` keys — the custodial-wallet binding.
 *
 * These keys are written exactly once, by the server, when a managed wallet
 * is provisioned (POST /v1/agent/wallets, agent.ts ~2491-2502) and are then
 * *trusted* by the swap/signing/ownership path with no further verification:
 *
 *  - wallet_address     — checkEvmWalletOwnership (routes/agent.ts:107),
 *                         swap/execute wallet lookup (routes/agent.ts:2576),
 *                         policy listing (routes/agent.ts:3195), a2a wallet
 *                         hint (routes/a2a.ts:111)
 *  - internal_user_id   — forwarded to the Python signer as the owning user
 *                         for the custodial wallet (routes/agent.ts:2574,
 *                         2806)
 *  - internal_wallet_id — forwarded to the Python signer to select which
 *                         custodial wallet row to sign with
 *                         (routes/agent.ts:2575, 2807)
 *  - wallet_sub_org_id  — Turnkey sub-org used for policy management and
 *                         raw-payload signing (routes/agent.ts:3244, 3289,
 *                         3313; routes/mcp.ts:1107)
 *  - walletAddress      — Polymarket/CLOB wallet used for Turnkey
 *                         signRawPayload auth (routes/predict.ts:224, 277,
 *                         372, 407, 469)
 *  - subOrgId           — Polymarket/CLOB Turnkey sub-org used alongside the
 *                         above for signRawPayload (routes/predict.ts:231,
 *                         278)
 *
 * A caller-controlled PATCH must NEVER be able to set or overwrite any of
 * these — doing so lets an agent rebind itself to an arbitrary (including
 * victim) custodial wallet. See AgentService.updateAgent and
 * routes/validators.ts UpdateAgentSchema.
 */
export const RESERVED_AGENT_METADATA_KEYS = [
	'wallet_address',
	'internal_user_id',
	'internal_wallet_id',
	'wallet_sub_org_id',
	'walletAddress',
	'subOrgId',
] as const

export type ReservedAgentMetadataKey = (typeof RESERVED_AGENT_METADATA_KEYS)[number]

const RESERVED_KEY_SET = new Set<string>(RESERVED_AGENT_METADATA_KEYS)

export function isReservedAgentMetadataKey(key: string): boolean {
	return RESERVED_KEY_SET.has(key)
}

/** Reserved keys present in a caller-supplied metadata object, if any. */
export function findReservedAgentMetadataKeys(
	metadata: Record<string, unknown> | null | undefined,
): string[] {
	if (!metadata) return []
	return Object.keys(metadata).filter(isReservedAgentMetadataKey)
}

/**
 * Merge caller-supplied metadata into the existing stored metadata, dropping
 * any reserved key the caller tried to set. Reserved values always come from
 * `existing` (the stored row), never from `incoming` (the request) — so a
 * PATCH can never create or overwrite the custodial-wallet binding.
 */
export function mergeAgentMetadata(
	existing: Record<string, unknown> | null | undefined,
	incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
	const base = { ...(existing || {}) }
	if (!incoming) return base

	const sanitizedIncoming: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(incoming)) {
		if (isReservedAgentMetadataKey(key)) continue
		sanitizedIncoming[key] = value
	}

	const merged = { ...base, ...sanitizedIncoming }
	// Belt-and-suspenders: force reserved keys back to the stored values in
	// case a future spread ordering change or key-casing quirk lets one slip
	// through above.
	for (const key of RESERVED_AGENT_METADATA_KEYS) {
		if (Object.prototype.hasOwnProperty.call(base, key)) {
			merged[key] = base[key]
		} else {
			delete merged[key]
		}
	}
	return merged
}
