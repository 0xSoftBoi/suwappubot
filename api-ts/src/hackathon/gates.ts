/**
 * HACKATHON (ETHGlobal Tokyo 2026) — trust-layer gates.
 *
 * Additive, flag-gated (HACKATHON_TRUST_LAYER, default off) adapters that feed
 * the standalone hackathon modules (../../../hackathon/tokyo2026) into the
 * production money path:
 *
 *  - Intercepta counterparty screening → merged into the agent quote policy
 *    gate in src/routes/agent.ts (enforcePolicyGateForFreshQuote)
 *  - Intercepta x402 payer screening → src/middleware/mppAuth.ts verifyPayment
 *  - ENSv2 onchain agent-policy caps → same agent quote gate
 *
 * Merge discipline: these gates can only ever ESCALATE the institutional
 * PolicyService verdict (allow → require_approval → block), never downgrade
 * it. PolicyService stays the authority.
 *
 * Failure discipline (house convention, mirrors agent.ts): a scanner that
 * errors or is unconfigured fails OPEN with a loud audit log — never block
 * legitimate trades on an infra hiccup.
 */

import {
	isInterceptaConfigured,
	loadInterceptaConfig,
	scanAddress,
	scanToken,
} from '../../../hackathon/tokyo2026/src/intercepta/client'
import { scanResultToPolicySignal } from '../../../hackathon/tokyo2026/src/intercepta/policy'
import { resolveAndCheckPolicy } from '../../../hackathon/tokyo2026/src/ensv2/resolver'
import type {
	PolicyDecisionResult,
	PolicyIntent,
	PolicyVerdict,
} from '../services/PolicyService'
import { writeAuditLog } from '../services/audit'
import { logger } from '../lib/logger'
import { Effect, Either } from 'effect'
import { EnvService, type Env } from '../config/EnvService'
import { runEffectEither } from '../runtime'
import { ensv2Enabled, interceptaEnabled, trustLayerEnabled } from './env'

export interface TrustGateInput {
	policyIntent: PolicyIntent
	agentIdentifier: string
	orgId: string | null
}

/**
 * Resolve the decoded EnvService config. Null when the runtime can't provide
 * it — callers treat that as "layer unavailable" and fail open per the
 * failure discipline below. Accepts an injected Env (tests) to avoid
 * coupling flag logic to the Effect runtime.
 */
export async function resolveHackathonEnv(injected?: Env): Promise<Env | null> {
	if (injected) return injected
	const r = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)
	if (Either.isLeft(r)) {
		logger.warn('[hackathon] EnvService unavailable — trust layer failing open')
		return null
	}
	return r.right
}

const RANK: Record<PolicyVerdict, number> = { allow: 0, require_approval: 1, block: 2 }

/**
 * Merge the trust-layer gates into an institutional policy verdict.
 * Returns the (possibly escalated) verdict for the existing downstream
 * handling in agent.ts. No-op when the layer is disabled.
 */
export async function applyTrustLayerGates(
	input: TrustGateInput,
	base: PolicyDecisionResult,
	injectedEnv?: Env,
): Promise<PolicyDecisionResult> {
	const env = await resolveHackathonEnv(injectedEnv)
	if (!env || !trustLayerEnabled(env)) return base
	// Policy already blocked — nothing to escalate, and policy stays primary.
	if (base.decision === 'block') return base

	const escalations: Array<{ decision: PolicyVerdict; reason: string; gate: string }> = []

	const screen = await screenCounterparty(input, env)
	if (screen && screen.verdict !== 'allow') {
		escalations.push({ decision: screen.verdict, reason: screen.reason, gate: 'intercepta' })
	}

	const ensBlockReason = await checkEnsv2Cap(input, env)
	if (ensBlockReason) {
		escalations.push({ decision: 'block', reason: ensBlockReason, gate: 'ensv2' })
	}

	if (escalations.length === 0) return base

	// Worst verdict wins.
	escalations.sort((a, b) => RANK[b.decision] - RANK[a.decision])
	const top = escalations[0] as { decision: PolicyVerdict; reason: string; gate: string }
	if (RANK[top.decision] <= RANK[base.decision]) return base

	writeAuditLog({
		userId: 0,
		orgId: input.orgId,
		agentId: input.agentIdentifier,
		eventType: `trustlayer.${top.decision}`,
		details: {
			gate: top.gate,
			reason: top.reason,
			chain: input.policyIntent.chain,
			valueUsd: input.policyIntent.valueUsd,
		},
	})
	return { ...base, decision: top.decision, reason: top.reason }
}

/**
 * Screen the trade counterparty before the quote is offered:
 *  - destinationAddress (third-party recipient, x402/p2p flows) via scanAddress
 *  - otherwise toToken (the token being bought — honeypot check) via scanToken
 * Returns null when disabled, unconfigured, clean, or on scanner error
 * (fail-open per house convention).
 */
async function screenCounterparty(
	input: TrustGateInput,
	env: Env,
): Promise<{ verdict: PolicyVerdict; reason: string } | null> {
	if (!interceptaEnabled(env) || !isInterceptaConfigured()) return null
	const { destinationAddress, toToken, chain } = input.policyIntent
	try {
		const cfg = loadInterceptaConfig()
		const scan = destinationAddress
			? await scanAddress(cfg, destinationAddress, chain)
			: toToken
				? await scanToken(cfg, toToken, chain)
				: null
		if (!scan) return null
		const signal = scanResultToPolicySignal(scan, 'counterparty')
		if (signal.verdict === 'allow') return null
		return { verdict: signal.verdict, reason: signal.reason }
	} catch (e) {
		logger.warn('[hackathon] Intercepta counterparty screen failed open: %s', String(e))
		return null
	}
}

/**
 * Enforce the agent's onchain ENSv2 policy (spending caps published as
 * suwappu.policy text records on agent.<name>.suwappu.eth, Sepolia).
 * Returns a block reason, or null when disabled / unmapped / passing.
 */
async function checkEnsv2Cap(input: TrustGateInput, env: Env): Promise<string | null> {
	if (!ensv2Enabled(env)) return null
	const rpcUrl = env.SEPOLIA_RPC_URL
	const agentName = resolveAgentName(input.agentIdentifier, env)
	if (!rpcUrl || !agentName) return null
	try {
		const { blockReason } = await resolveAndCheckPolicy(rpcUrl, agentName, {
			valueUsd: input.policyIntent.valueUsd,
			chain: input.policyIntent.chain,
		})
		return blockReason
	} catch (e) {
		logger.warn('[hackathon] ENSv2 policy check failed open: %s', String(e))
		return null
	}
}

/**
 * Map an internal agent id to its ENSv2 agent name. Explicit mapping wins
 * (HACKATHON_ENSV2_NAMES as JSON, e.g. {"agent_123":"agent.acme.suwappu.eth"});
 * a bare *.eth identifier passes through directly.
 */
function resolveAgentName(agentIdentifier: string, env: Env): string | null {
	if (agentIdentifier.toLowerCase().endsWith('.eth')) return agentIdentifier
	try {
		const map = JSON.parse(env.HACKATHON_ENSV2_NAMES ?? '{}') as Record<string, string>
		return map[agentIdentifier] ?? null
	} catch {
		return null
	}
}

/**
 * Screen an x402 payer (the wallet funding a 402 request) before serving it.
 * Used by src/middleware/mppAuth.ts. Returns a block reason, or null when
 * disabled / unconfigured / clean / scanner error (fail-open).
 */
export async function screenX402Payer(
	sender: string | undefined,
	injectedEnv?: Env,
): Promise<string | null> {
	const env = await resolveHackathonEnv(injectedEnv)
	if (!env || !interceptaEnabled(env) || !isInterceptaConfigured() || !sender) return null
	try {
		const cfg = loadInterceptaConfig()
		const scan = await scanAddress(cfg, sender)
		const signal = scanResultToPolicySignal(scan, 'x402 payer')
		if (signal.verdict === 'allow') return null
		// A held (require_approval) payer is treated as a block here: the
		// anonymous 402 surface has no human-approval flow to escalate into.
		writeAuditLog({
			userId: 0,
			eventType: `trustlayer.${signal.verdict}`,
			details: { gate: 'intercepta-x402', reason: signal.reason, sender },
		})
		return signal.reason
	} catch (e) {
		logger.warn('[hackathon] Intercepta x402 payer screen failed open: %s', String(e))
		return null
	}
}
