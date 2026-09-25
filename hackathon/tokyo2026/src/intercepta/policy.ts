/**
 * Verdict mapping: Intercepta findings → Suwappu policy signals.
 *
 * This is the prize-criterion core: the screening result must produce a
 * `PolicyVerdict` ('allow' | 'block' | 'require_approval') with a VISIBLE
 * reason, and the reason must reach the user in the blocked/held message.
 *
 * Integration point (api-ts):
 *   api-ts/src/services/PolicyService.ts → evalStateless(p, intent):
 *   after the allowlist checks, run the Intercepta screen (cached per
 *   address+ttl) and fold the returned { block?, approval? } in. The
 *   PolicyVerdict type already exists — no new enum needed.
 */
import type { ScanResult, RiskLevel } from './client.ts'

export type PolicyVerdict = 'allow' | 'block' | 'require_approval'

export interface PolicySignal {
	verdict: PolicyVerdict
	/** Shown to the user. Never empty when verdict != allow. */
	reason: string
	/** Trust-score penalty for AgentTrustService (existing THREAT_PENALTY=15 scale). */
	trustPenalty: number
	findings: ScanResult['findings']
}

/** Score thresholds. Conservative by design: unknown → hold, never pass. */
const BLOCK_AT = 75
const HOLD_AT = 40

const RISK_WEIGHT: Record<RiskLevel, number> = {
	LOW: 0,
	MEDIUM: 8,
	HIGH: 15,
	CRITICAL: 25,
}

export function scanResultToPolicySignal(scan: ScanResult, context: string): PolicySignal {
	const reasons = scan.findings.map((f) => f.description)
	const reasonList = reasons.length > 0 ? reasons.join('; ') : 'no findings returned'

	const trustPenalty = Math.min(
		50,
		scan.findings.reduce((acc, f) => acc + (RISK_WEIGHT[f.risk] ?? 8), 0),
	)

	if (scan.verdict === 'malicious' || scan.riskScore >= BLOCK_AT) {
		return {
			verdict: 'block',
			reason: `Intercepta blocked this ${context}: ${reasonList} (risk ${scan.riskScore}/100)`,
			trustPenalty,
			findings: scan.findings,
		}
	}
	if (scan.verdict === 'suspicious' || scan.riskScore >= HOLD_AT) {
		return {
			verdict: 'require_approval',
			reason:
				`Intercepta flagged this ${context} — human approval required: ` +
				`${reasonList} (risk ${scan.riskScore}/100)`,
			trustPenalty,
			findings: scan.findings,
		}
	}
	return { verdict: 'allow', reason: '', trustPenalty: 0, findings: scan.findings }
}

/**
 * The escalation the demo shows: a held payment routes to the World ID
 * guardian gate instead of a plain "approve" button.
 */
export function escalationFor(signal: PolicySignal): 'world_id_step_up' | 'none' {
	return signal.verdict === 'require_approval' ? 'world_id_step_up' : 'none'
}
