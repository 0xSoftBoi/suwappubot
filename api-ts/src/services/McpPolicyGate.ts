/**
 * MCP policy gate (prototype, feature-flagged) — MONEY-PATH.
 *
 * Wires the existing PolicyService (via the shared SwapPolicyGate helpers)
 * into the MCP `tools/call` dispatch path (api-ts/src/routes/mcp.ts).
 *
 * ORDERING (fixed after money-path review): the gate must run BEFORE
 * chargeAgentForCall, not after — a denied call must not meter credits.
 * routes/mcp.ts calls `isMcpPolicyEnforcementEnabled()` first (cheap,
 * synchronous-ish flag check); only if that's true does it look up the
 * cached quote and call `checkMcpToolPolicy`, then only proceeds to
 * chargeAgentForCall if the verdict is 'allow'.
 *
 * Feature flag: MCP_POLICY_ENFORCEMENT (EnvService), default OFF. When OFF,
 * the route skips the quote lookup and this module entirely for non-gated
 * calls — zero added DB/latency cost.
 *
 * ORG SOURCE (documented per money-path review): the MCP entry point only
 * runs `agentBearerAuth()`, not `apiKeyAuth()`/`agentFlexAuth()` — so
 * `c.get('apiKeyAuth')` (the org source routes/agent.ts uses) is never set
 * here. The canonical org source for MCP is therefore the `agents.organizationId`
 * column (G2 identity bridge). If MCP is ever mounted behind agentFlexAuth,
 * prefer apiKeyAuth().orgId first, matching routes/agent.ts.
 *
 * Fail-open / fail-closed rules live in SwapPolicyGate.ts (shared with
 * routes/agent.ts) — see that module's header for the exact posture.
 *
 * require_approval is treated as a block for this prototype (no approval
 * queue exists yet) — TODO(policy-approval-queue): once a maker-checker queue
 * exists, this should enqueue instead of denying outright.
 */

import { Effect } from 'effect'
import { EnvService } from '../config/EnvService'
import { runEffectEither } from '../runtime'
import { logger } from '../lib/logger'
import {
	buildEvmPolicyIntent,
	buildSolanaPolicyIntent,
	evaluateSwapPolicy,
	type EvmQuoteForPolicy,
	type SolanaQuoteForPolicy,
} from './SwapPolicyGate'
import type { Agent } from '../db'
import type { CachedQuote } from '../lib/quoteCache'

/** Only mutating tools need a policy check. Read-only tools (get_quote,
 * get_portfolio, simulate_swap, etc.) skip the gate entirely — see
 * TOOL_ANNOTATIONS in mcp.ts (destructiveHint/readOnlyHint: false only on
 * execute_swap today). Add new mutating tool names here as they ship.
 */
const POLICY_GATED_TOOLS = new Set<string>(['execute_swap'])

export function isPolicyGatedTool(name: string): boolean {
	return POLICY_GATED_TOOLS.has(name)
}

/**
 * Cheap flag check — call this FIRST in the route, before doing any quote
 * lookup or other policy work, so flag-off costs one EnvService read (already
 * a pattern used elsewhere in mcp.ts, e.g. the x402 challenge path) and
 * nothing else.
 */
export async function isMcpPolicyEnforcementEnabled(): Promise<boolean> {
	const envEither = await runEffectEither(Effect.gen(function* () {
		return yield* EnvService
	}))
	return envEither._tag === 'Right' && envEither.right.MCP_POLICY_ENFORCEMENT === 'true'
}

export interface McpPolicyGateResult {
	verdict: 'allow' | 'block'
	reason?: string
}

/**
 * Evaluate the policy gate for a single MCP tool call. Only call this after
 * `isMcpPolicyEnforcementEnabled()` has already returned true and the tool is
 * policy-gated (`isPolicyGatedTool(name)`), and BEFORE chargeAgentForCall.
 */
export async function checkMcpToolPolicy(
	name: string,
	cached: CachedQuote | null,
	agent: Agent,
): Promise<McpPolicyGateResult> {
	if (!isPolicyGatedTool(name)) return { verdict: 'allow' }

	// No cached quote to build an intent from — shouldn't happen (the caller
	// looks up the quote before this runs), but fail open rather than block on
	// a lookup miss that isn't actually the policy engine's concern.
	if (!cached) {
		logger.warn(`[mcp-policy] no cached quote for ${name}; failing open (allow)`)
		return { verdict: 'allow' }
	}

	const organizationId = (agent as unknown as { organizationId?: string | null })
		.organizationId ?? null
	const agentIdStr = agent.uuid ?? String(agent.id)

	const { intent, canPriceUsd } = cached.isSolana
		? buildSolanaPolicyIntent(cached.quote as SolanaQuoteForPolicy, organizationId ?? '', agentIdStr)
		: buildEvmPolicyIntent(cached.quote as EvmQuoteForPolicy, organizationId ?? '', agentIdStr)

	const result = await evaluateSwapPolicy(organizationId, agentIdStr, intent, canPriceUsd)

	if (result.decision === 'allow') return { verdict: 'allow' }

	if (result.decision === 'require_approval') {
		// TODO(policy-approval-queue): no maker-checker queue exists yet.
		// Treated as a block for this prototype, with a distinguishable reason.
		return {
			verdict: 'block',
			reason: `Requires approval (not yet supported via MCP): ${result.reason ?? 'policy threshold exceeded'}`,
		}
	}

	return { verdict: 'block', reason: result.reason ?? 'Blocked by organization policy' }
}
