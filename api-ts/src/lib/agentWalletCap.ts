/**
 * MONEY-PATH. API-side enforcement of an agent's per-transaction NATIVE-VALUE cap.
 *
 * Why this exists: Turnkey never evaluates the policies we store in the agent's
 * sub-org, because every sub-org's root user is the platform's own API key
 * (root quorum bypasses policies). So the stored policies are a RECORD; the
 * actual enforcement happens here, before we hand a transaction to the signer.
 *
 * SCOPE (state this everywhere it is described):
 *  - caps the native token value (wei of the chain's gas token) of each tx
 *  - does NOT cap ERC-20 amounts (those transactions carry value 0)
 *  - is not a time-window / aggregate limit
 *  - the same agent key can delete the policy, so this is a guard against
 *    runaway agent logic, not against a compromised key.
 *
 * Pure helpers only (no I/O) plus a tiny per-process cache.
 */

export interface StoredPolicy {
	policyId?: string
	policyName: string
	effect?: string
	condition?: string
}

export type NativeCap =
	| { kind: 'none' }
	| { kind: 'cap'; capWei: bigint }
	| { kind: 'unparseable'; policyNames: string[] }

export const AGENT_POLICY_PREFIX = 'agent-'
export const SPENDING_LIMIT_PREFIX = `${AGENT_POLICY_PREFIX}spending-limit`
/** Turnkey ints are i128 (~1.7e38); 39 digits is the ceiling we accept. */
export const MAX_WEI_DIGITS = 39
const I128_MAX = (1n << 127n) - 1n

const NAME_RE = /^agent-spending-limit-(\d{1,39})-[0-9a-f]{6}$/
// New: `eth.tx.value > N` (DENY). Legacy: `eth.value <= N` (DENY, inverted), `eth.tx.value <= N`.
const CONDITION_RE = /^\s*eth\.(?:tx\.)?value\s*(?:<=|>)\s*(\d{1,39})\s*$/

export function weiFitsTurnkey(digits: string): boolean {
	return /^\d{1,39}$/.test(digits) && BigInt(digits) <= I128_MAX
}

function toBigInt(digits: string): bigint | null {
	return weiFitsTurnkey(digits) ? BigInt(digits) : null
}

/** Cap of ONE spending-limit policy: min of every parseable source (name, condition), or null. */
export function parseSpendingLimitPolicy(p: StoredPolicy): bigint | null {
	const found: bigint[] = []
	const cm = p.condition ? CONDITION_RE.exec(p.condition) : null
	if (cm) {
		const n = toBigInt(cm[1])
		if (n !== null) found.push(n)
	}
	const nm = NAME_RE.exec(p.policyName)
	if (nm) {
		const n = toBigInt(nm[1])
		if (n !== null) found.push(n)
	}
	if (found.length === 0) return null
	return found.reduce((a, b) => (a < b ? a : b))
}

/** Minimum cap across ALL of the agent's spending-limit policies; fail closed on any unparseable one. */
export function deriveNativeCap(policies: readonly StoredPolicy[]): NativeCap {
	let cap: bigint | null = null
	const bad: string[] = []
	for (const p of policies) {
		if (!p.policyName.startsWith(SPENDING_LIMIT_PREFIX)) continue
		const n = parseSpendingLimitPolicy(p)
		if (n === null) {
			bad.push(p.policyName)
			continue
		}
		cap = cap === null || n < cap ? n : cap
	}
	if (bad.length > 0) return { kind: 'unparseable', policyNames: bad }
	return cap === null ? { kind: 'none' } : { kind: 'cap', capWei: cap }
}

export type NativeCapVerdict =
	| { ok: true }
	| { ok: false; reason: 'over_cap' | 'unparseable_policy' | 'unparseable_value'; message: string }

/** Strict tx.value parse: 0x-hex or decimal digits only; undefined/empty/'0x' => 0. */
export function parseTxValue(value: unknown): bigint | null {
	if (value === undefined || value === null || value === '' || value === '0x') return 0n
	if (typeof value === 'bigint') return value >= 0n ? value : null
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
	if (typeof value !== 'string') return null
	if (/^0x[0-9a-fA-F]+$/.test(value) || /^\d+$/.test(value)) return BigInt(value)
	return null
}

export function checkNativeValue(cap: NativeCap, txValue: unknown): NativeCapVerdict {
	if (cap.kind === 'none') return { ok: true }
	if (cap.kind === 'unparseable') {
		return {
			ok: false,
			reason: 'unparseable_policy',
			message:
				'A spending-limit policy on this wallet could not be interpreted, so the transaction was blocked. ' +
				'Delete it (DELETE /v1/agent/wallet/policy/:policyId) and recreate it.',
		}
	}
	const v = parseTxValue(txValue)
	if (v === null) {
		return {
			ok: false,
			reason: 'unparseable_value',
			message: 'Transaction value could not be read, so it was blocked by the wallet spending-limit policy.',
		}
	}
	if (v > cap.capWei) {
		return {
			ok: false,
			reason: 'over_cap',
			message: `Native value ${v.toString()} wei exceeds the wallet per-transaction spending limit of ${cap.capWei.toString()} wei.`,
		}
	}
	return { ok: true }
}

// ---- per-process cache of the derived cap -------------------------------------
// MULTI-REPLICA CAVEAT: this cache is in-memory per process. A create/delete
// handled by replica A invalidates only A's entry; replica B can serve the old
// cap for up to CAP_CACHE_TTL_MS (30 s). Accepted staleness window.
export const CAP_CACHE_TTL_MS = 30_000
const capCache = new Map<string, { cap: NativeCap; at: number }>()

export function getCachedCap(subOrgId: string, now = Date.now()): NativeCap | null {
	const e = capCache.get(subOrgId)
	if (!e) return null
	if (now - e.at > CAP_CACHE_TTL_MS) {
		capCache.delete(subOrgId)
		return null
	}
	return e.cap
}

export function setCachedCap(subOrgId: string, cap: NativeCap, now = Date.now()): void {
	if (capCache.size > 5000) capCache.clear()
	capCache.set(subOrgId, { cap, at: now })
}

export function invalidateCachedCap(subOrgId: string): void {
	capCache.delete(subOrgId)
}
