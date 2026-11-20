/**
 * World ID verified-agent fee discount.
 *
 * Agents that complete World ID verification (see routes/agent.ts
 * `/v1/agent/link/code`, which stamps `agents.metadata.worldId.verified`)
 * are sybil-resistant real humans/agents. As an incentive to verify — and as
 * an anti-farming lever against unverified bot swarms — verified agents get
 * a percentage discount off the standard platform swap fee.
 *
 * This is DELIBERATELY separate from `rateLimitTier` (middleware/x402Payment.ts),
 * which only gates request metering/credits and has never affected the fee
 * bps charged on a swap. Do not conflate the two.
 *
 * Mechanism: a percentage-off-the-fee multiplier (expressed in bps of the fee
 * itself, 0-10000), not a flat bps subtraction. A percentage multiplier scales
 * correctly if/when the base EVM (0.8%) and Solana (0.3%) fees are ever
 * reconciled or made tier-aware, whereas a flat bps subtraction would need to
 * be re-tuned per base rate (and could go negative on a lower base fee).
 * Configurable via WORLD_ID_VERIFIED_FEE_DISCOUNT_BPS (default 2000 = 20% off).
 */

const DEFAULT_WORLD_ID_DISCOUNT_BPS = 2000 // 20% off the standard fee

function resolveDiscountBps(): number {
	const raw = process.env.WORLD_ID_VERIFIED_FEE_DISCOUNT_BPS
	if (!raw) return DEFAULT_WORLD_ID_DISCOUNT_BPS
	const parsed = parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WORLD_ID_DISCOUNT_BPS
	// Clamp to [0, 10000] — never allow a misconfigured env var to produce a
	// negative fee or a >100% discount.
	return Math.min(parsed, 10000)
}

export interface AgentFeeMetadata {
	metadata?: {
		worldId?: {
			verified?: boolean
		}
	} | null
}

/** True iff the agent's owner has completed World ID verification. */
export function isWorldIdVerifiedAgent(agent: AgentFeeMetadata | null | undefined): boolean {
	return agent?.metadata?.worldId?.verified === true
}

/**
 * Apply the World ID verified-agent discount to a base platform fee (in bps).
 * Returns the same value, rounded, for unverified agents.
 */
export function applyWorldIdFeeDiscountBps(
	baseFeeBps: number,
	agent: AgentFeeMetadata | null | undefined,
): number {
	if (!isWorldIdVerifiedAgent(agent)) return Math.round(baseFeeBps)
	const discountBps = resolveDiscountBps()
	const discounted = (baseFeeBps * (10000 - discountBps)) / 10000
	return Math.round(discounted)
}

/**
 * Platform swap fee in bps for the Solana (Jupiter) path, discounted for
 * World ID verified agents. Base rate still sources from FEE_BPS env /
 * DEFAULT_AGENT_FEE_BPS — do not re-hardcode "30" anywhere else.
 */
export function getPlatformFeeBpsSolana(
	baseFeeBps: number,
	agent: AgentFeeMetadata | null | undefined,
): number {
	return applyWorldIdFeeDiscountBps(baseFeeBps, agent)
}

/**
 * Platform swap fee as a Li.Fi-style FRACTION string (e.g. "0.008") for the
 * EVM path, discounted for World ID verified agents. `baseFeeFraction` is the
 * undiscounted fraction (AGENT_FEE_FRACTION_EVM).
 */
export function getPlatformFeeFractionEvm(
	baseFeeFraction: string,
	agent: AgentFeeMetadata | null | undefined,
): string {
	const baseBps = Math.round(parseFloat(baseFeeFraction) * 10000)
	const discountedBps = applyWorldIdFeeDiscountBps(baseBps, agent)
	return (discountedBps / 10000).toString()
}
