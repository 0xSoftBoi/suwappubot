import crypto from 'crypto'
import type { Context } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { runEffectEither } from '../runtime'
import { EnvService } from '../config/EnvService'
import { requireDb } from '../db'
import { agentApprovals } from '../db/schema/approvals'
import { agents } from '../db/schema/agents'
import { organizations } from '../db/schema/organizations'
import { users } from '../db/schema/users'
import { PolicyService, type PolicyIntent, type PolicyVerdict } from './PolicyService'
import { writeAuditLog } from './audit'

/**
 * Reusable institutional policy gate — MONEY-PATH.
 *
 * Factored out of the original inline gate (agent.ts /swap quote_id branch) so
 * every agent write path (quote/swap/execute) evaluates the SAME rules the
 * SAME way instead of drifting. Two thin call shapes:
 *
 *   - enforcePolicy(c, agent, intent)     — Hono routes (agent.ts): returns a
 *     Response to short-circuit the handler, or null to proceed.
 *   - enforcePolicyForTool(agent, intent) — MCP tool handlers (mcp.ts), which
 *     have no Hono Context: returns an MCP { isError, content } envelope, or
 *     null to proceed. The tools/call dispatcher already auto-refunds charged
 *     credits when a handler returns isError:true.
 *
 * Both share `runPolicyCheck`, which evaluates the intent, writes the audit
 * trail for any non-allow decision or eval error, and fails OPEN on ordinary
 * policy-read errors (never block a legitimate trade on an infra hiccup — the
 * kill-switch lookup is the one exception, and it fails CLOSED inside
 * PolicyService itself, surfacing here as an ordinary 'block' decision).
 */

export type PolicyGateIntent = Omit<PolicyIntent, 'organizationId' | 'agentId'>

export interface PolicyCheckOutcome {
	decision: PolicyVerdict
	reason?: string | null
	matchedPolicyId?: string
	/** true when the verdict is a fail-open default because policy eval errored. */
	failedOpen?: boolean
}

const agentIdOf = (agent: { id: number; uuid?: string | null }): string =>
	agent.uuid ?? String(agent.id)

/**
 * True if ANY enabled policy scoped to this org/agent carries a USD-denominated
 * rule. Fails CLOSED (returns true) on any DB/eval error — same reasoning as
 * the kill-switch check in PolicyService: if we can't determine whether a real
 * spend control applies, we must NOT let an unresolvable-price call site
 * assume "no rules" and slip a real trade through at valueUsd: 0.
 */
export async function hasUsdPolicyRules(
	organizationId: string | null | undefined,
	agentId: string | null | undefined,
): Promise<boolean> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const policy = yield* PolicyService
			return yield* policy.hasUsdRules(organizationId, agentId)
		}),
	)
	if (Either.isLeft(result)) return true
	return result.right
}

export async function runPolicyCheck(
	intent: PolicyIntent,
	forceRequireApprovalReason?: string,
): Promise<PolicyCheckOutcome> {
	if (forceRequireApprovalReason) {
		writeAuditLog({
			userId: 0,
			orgId: intent.organizationId ?? null,
			agentId: intent.agentId ?? null,
			eventType: 'policy.price_unavailable',
			details: { reason: forceRequireApprovalReason, chain: intent.chain },
		})
		return { decision: 'require_approval', reason: forceRequireApprovalReason }
	}
	const verdict = await runEffectEither(
		Effect.gen(function* () {
			const policy = yield* PolicyService
			return yield* policy.evaluate(intent)
		}),
	)

	if (Either.isRight(verdict)) {
		const { decision, reason, matchedPolicyId } = verdict.right
		if (decision !== 'allow') {
			writeAuditLog({
				userId: 0,
				orgId: intent.organizationId ?? null,
				agentId: intent.agentId ?? null,
				eventType: reason?.startsWith('kill-switch check failed')
					? 'policy.kill_switch_fail_closed'
					: `policy.${decision}`,
				details: { reason, matchedPolicyId, chain: intent.chain, valueUsd: intent.valueUsd },
			})
		}
		return { decision, reason: reason ?? null, matchedPolicyId }
	}

	// The policy query itself errored (Left) — fail open but log it loudly. This
	// is the rare DB-down case for ordinary policy/spend reads; never block
	// legitimate trades on an infra hiccup. (Kill-switch reads are handled
	// separately and fail CLOSED inside PolicyService, arriving here as a
	// normal 'block' Right.) Distinct event + grep-able console tag so
	// monitoring can page on a fail-open, which is otherwise invisible next to
	// ordinary 'policy.eval_error' log noise.
	console.error(
		`[POLICY-FAIL-OPEN] policy eval errored, allowing trade through — agentId=${intent.agentId ?? 'none'} orgId=${intent.organizationId ?? 'none'} error=${String(verdict.left)}`,
	)
	writeAuditLog({
		userId: 0,
		orgId: intent.organizationId ?? null,
		agentId: intent.agentId ?? null,
		eventType: 'policy.failed_open',
		details: { error: String(verdict.left) },
	})
	return { decision: 'allow', failedOpen: true }
}

// ---------------------------------------------------------------------------
// Human-in-the-loop approvals (SUW-204) — api-ts half. The Python side owns
// the `agent_approvals` DDL + the Telegram approve/deny UX; this module only
// creates pending rows (on require_approval) and redeems them (on retry with
// an approval_id). Fully additive + gated by AGENT_APPROVALS_ENABLED: with the
// flag off, behavior (and the 202 JSON shape) is byte-for-byte identical to
// before this feature landed.
// ---------------------------------------------------------------------------

async function approvalsEnabled(): Promise<boolean> {
	const envResult = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)
	if (Either.isLeft(envResult)) return false
	return envResult.right.AGENT_APPROVALS_ENABLED === 'true'
}

/**
 * Canonical, order-independent hash of the operation-DEFINING fields of an
 * intent — i.e. the fields that identify WHAT trade this is, not what it's
 * currently worth. Used both when minting an approval and when redeeming one
 * — a redemption is only honored if the CURRENT request hashes to the same
 * value as the one the approval was minted for, so approving one trade can
 * never be replayed against a genuinely different trade (different chain,
 * different token pair, different router contract, different recipient).
 *
 * DELIBERATELY EXCLUDES amount/valueUsd (see MONEY-PATH finding: "approval
 * rebind"). Quotes are TTL'd (~60s) but a human approval can take minutes, so
 * by the time an agent redeems an approval it has almost always fetched a
 * FRESH quote for the same trade — binding the hash to the old quote's exact
 * USD value would make every approval unredeemable in practice (a hard
 * deadlock between the quote TTL and human response time). Instead the trade
 * SHAPE is bound here (agent/chain/tokens/contract/wallet/destination), and
 * the VALUE is checked separately at redemption time against a tolerance band
 * around the value the human actually approved (see redeemApproval below) —
 * so a re-quoted trade for the same shape redeems, but a bait-and-switch to a
 * materially larger trade does not.
 */
export function computeApprovalIntentHash(fields: {
	agentId: string
	chain: string
	fromToken?: string | null
	toToken?: string | null
	contractAddress?: string | null
	walletAddress?: string | null
	destinationAddress?: string | null
}): string {
	const canonical: Record<string, unknown> = {}
	// Insert in a fixed, alphabetical key order so JSON.stringify output is
	// deterministic regardless of caller field order; omit undefined/null so a
	// field's absence is never distinguishable from an explicit null.
	if (fields.agentId != null) canonical.agentId = fields.agentId
	if (fields.chain != null) canonical.chain = fields.chain
	if (fields.contractAddress != null) canonical.contractAddress = fields.contractAddress
	if (fields.destinationAddress != null) canonical.destinationAddress = fields.destinationAddress
	if (fields.fromToken != null) canonical.fromToken = fields.fromToken
	if (fields.toToken != null) canonical.toToken = fields.toToken
	if (fields.walletAddress != null) canonical.walletAddress = fields.walletAddress
	return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

const intentHashOf = (intent: PolicyIntent): string =>
	computeApprovalIntentHash({
		agentId: intent.agentId ?? '',
		chain: intent.chain,
		fromToken: intent.fromToken,
		toToken: intent.toToken,
		contractAddress: intent.contractAddress,
		walletAddress: intent.walletAddress,
		destinationAddress: intent.destinationAddress,
	})

/** Redemption is only honored if the CURRENT intent's value is within this
 * band of the value the human actually approved — lets a fresh re-quote (drift
 * from price movement/slippage) through, while a bait-and-switch to a
 * materially larger trade after approval still gets rejected. */
const APPROVAL_VALUE_BAND = 0.05

/**
 * True if `newValueUsd` is within `bandPct` above `oldValueUsd` (or at/below
 * it). Only the upper bound is enforced — a re-quote coming in LOWER than the
 * originally-approved value is always fine (never a bait-and-switch); only a
 * MATERIALLY LARGER value than what the human approved is rejected. Extracted
 * from redeemApproval's inline comparison for unit testing.
 */
export function isWithinValueBand(oldValueUsd: number, newValueUsd: number, bandPct = APPROVAL_VALUE_BAND): boolean {
	return newValueUsd <= oldValueUsd * (1 + bandPct)
}

/**
 * Resolve the Telegram user id to notify for an approval.
 *
 * Resolution order:
 *   1. Direct agent->owner link (agents.ownerUserId -> users.telegramId) —
 *      set via POST /v1/agent/link/code + /claim <code> in the Telegram bot.
 *      Works on BOTH the Hono org-key surface and the MCP per-agent-bearer
 *      surface, since it needs no organizationId at all.
 *   2. Fallback: organizations.ownerId -> users.telegramId (only resolvable
 *      when the intent carries an organizationId — the Hono `/v1/agent/*`
 *      surface authenticated via an org API key; see enforcePolicy's
 *      apiKeyCtx.orgId). MCP tool calls resolve organizationId from the
 *      agent's own agents.organizationId column when set (enforcePolicyForTool),
 *      otherwise pass organizationId: null — so before owner-linking (and for
 *      agents with no organizationId set), this fallback could never resolve
 *      anything on that surface — owner-linking closes that gap.
 * Null-safe throughout: returns null when neither path resolves a telegramId.
 */
async function resolveUserTelegramId(
	organizationId: string | null | undefined,
	agentId?: string | null,
): Promise<number | null> {
	if (agentId) {
		const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)
		const isNumeric = /^\d+$/.test(agentId)
		// agents.uuid is NOT NULL, so a numeric agentId (agents.id) is the only
		// other valid form — no need for an `or()` fallback across both columns.
		const agentMatch = isUuid
			? eq(agents.uuid, agentId)
			: isNumeric
				? eq(agents.id, Number(agentId))
				: null

		if (agentMatch) {
			const linked = await runEffectEither(
				Effect.gen(function* () {
					const db = yield* requireDb
					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({ telegramId: users.telegramId })
								.from(agents)
								.innerJoin(users, eq(users.id, agents.ownerUserId))
								.where(agentMatch)
								.limit(1),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})
					return rows[0]?.telegramId ?? null
				}),
			)
			if (Either.isRight(linked) && linked.right != null) return linked.right
		}
	}

	if (!organizationId) return null
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ telegramId: users.telegramId })
						.from(organizations)
						.innerJoin(users, eq(users.id, organizations.ownerId))
						.where(eq(organizations.id, organizationId))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return rows[0]?.telegramId ?? null
		}),
	)
	if (Either.isLeft(result)) return null
	return result.right
}

/** Insert a pending approval row. Returns null (and logs) on any DB failure —
 * approval-row creation failing must never crash the calling request; the
 * caller just omits approval_id/poll_url from its 202 body in that case. */
async function createApprovalRow(
	intent: PolicyIntent,
): Promise<{ id: string; expiresAt: Date } | null> {
	const id = crypto.randomUUID()
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
	const intentHash = intentHashOf(intent)
	const userTelegramId = await resolveUserTelegramId(intent.organizationId, intent.agentId)
	// Primary keys chosen to match what Python's approval_notifier._intent_summary
	// looks for (fromToken/toToken/fromAmount) so the Telegram card renders a real
	// summary instead of "?".
	const intentJson = {
		fromToken: intent.fromToken ?? null,
		toToken: intent.toToken ?? null,
		fromAmount: intent.valueUsd ?? null,
		chain: intent.chain,
		contractAddress: intent.contractAddress ?? null,
		agentId: intent.agentId ?? null,
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			yield* Effect.tryPromise({
				try: () =>
					db.insert(agentApprovals).values({
						id,
						orgId: intent.organizationId ?? null,
						agentId: intent.agentId ?? '',
						agentName: null,
						// Resolved via resolveUserTelegramId: prefers the direct
						// agents.ownerUserId link, falling back to
						// organizations.ownerId -> users.telegramId. Null only when
						// neither path resolves (agent not owner-linked AND no org
						// context, or the resolved user has no telegramId).
						userTelegramId,
						intentJson,
						intentHash,
						valueUsd: intent.valueUsd ?? null,
						chain: intent.chain ?? null,
						status: 'pending',
						channel: null,
						expiresAt,
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		writeAuditLog({
			userId: 0,
			orgId: intent.organizationId ?? null,
			agentId: intent.agentId ?? null,
			eventType: 'policy.approval_create_failed',
			details: { error: String(result.left) },
		})
		return null
	}
	return { id, expiresAt }
}

type ApprovalRedemption = { ok: true } | { ok: false; reason: string }

/**
 * Validate + atomically consume an approval_id supplied on a retried request.
 * Only ever overrides a `require_approval` verdict — an ordinary `block`
 * verdict is evaluated (and enforced) before this is ever consulted, see
 * enforcePolicy/enforcePolicyForTool below.
 */
async function redeemApproval(
	approvalId: string,
	intent: PolicyIntent,
): Promise<ApprovalRedemption> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(agentApprovals).where(eq(agentApprovals.id, approvalId)).limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const row = rows[0]
			if (!row) return { ok: false as const, reason: 'not_found' }
			if (row.agentId !== (intent.agentId ?? '')) return { ok: false as const, reason: 'agent_mismatch' }
			if (row.consumedAt) return { ok: false as const, reason: 'already_consumed' }
			if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
				return { ok: false as const, reason: 'expired' }
			}
			if (row.status !== 'approved') {
				return { ok: false as const, reason: row.status === 'expired' ? 'expired' : 'not_approved' }
			}
			const recomputed = intentHashOf(intent)
			if (!row.intentHash || row.intentHash !== recomputed) {
				return { ok: false as const, reason: 'intent_changed' }
			}

			// Value re-check: the intent hash no longer binds valueUsd (see
			// computeApprovalIntentHash), so a fresh re-quote for the SAME trade
			// shape can drift in price — allow that (within a tolerance band of the
			// value the human actually approved), but reject a bait-and-switch to a
			// materially larger trade redeemed against the same approval_id.
			const approvedValueUsd = row.valueUsd ?? 0
			const currentValueUsd = intent.valueUsd ?? 0
			if (!isWithinValueBand(approvedValueUsd, currentValueUsd)) {
				return { ok: false as const, reason: 'value_exceeds_approved' }
			}

			// Atomic consume — loses the race to a concurrent redemption attempt if
			// this affects 0 rows (treated as reuse failure below).
			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(agentApprovals)
						.set({ consumedAt: new Date() })
						.where(and(eq(agentApprovals.id, approvalId), isNull(agentApprovals.consumedAt)))
						.returning({ id: agentApprovals.id }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (updated.length === 0) return { ok: false as const, reason: 'already_consumed' }
			return { ok: true as const }
		}),
	)

	if (Either.isLeft(result)) {
		// Client-facing reason must stay generic — never leak a raw DB error
		// string to an API caller. The real error is logged here (console + the
		// caller's own audit-log write, which receives this same generic reason
		// alongside the approvalId) for operator debugging.
		console.error(`[policy] approval redemption db error for approvalId=${approvalId}: ${String(result.left)}`)
		return { ok: false, reason: 'approval_redemption_failed' }
	}
	return result.right
}

/**
 * Hono route gate. Returns a Response to short-circuit the handler (402/403/202
 * JSON shape identical to the original inline gate when AGENT_APPROVALS_ENABLED
 * is off / no approval_id supplied), or null to proceed.
 */
export async function enforcePolicy(
	c: Context,
	agent: { id: number; uuid?: string | null },
	intent: PolicyGateIntent,
	approvalId?: string,
	forceRequireApprovalReason?: string,
): Promise<Response | null> {
	const apiKeyCtx = c.get('apiKeyAuth') as { orgId: string } | undefined
	const fullIntent: PolicyIntent = {
		organizationId: apiKeyCtx?.orgId ?? null,
		agentId: agentIdOf(agent),
		...intent,
	}

	const outcome = await runPolicyCheck(fullIntent, forceRequireApprovalReason)
	if (outcome.decision === 'allow') return null

	if (outcome.decision === 'require_approval' && approvalId) {
		const redemption = await redeemApproval(approvalId, fullIntent)
		if (redemption.ok) {
			writeAuditLog({
				userId: 0,
				orgId: fullIntent.organizationId ?? null,
				agentId: fullIntent.agentId ?? null,
				eventType: 'policy.approval_redeemed',
				details: { approvalId },
			})
			return null
		}
		writeAuditLog({
			userId: 0,
			orgId: fullIntent.organizationId ?? null,
			agentId: fullIntent.agentId ?? null,
			eventType: 'policy.approval_rejected',
			details: { approvalId, reason: redemption.reason },
		})
		// Return immediately rather than falling through to ordinary policy
		// evaluation: a bad/reused/mismatched approval_id must never silently
		// look like it triggered a *fresh* require_approval path — that would
		// blur "your approval was rejected" with "policy re-evaluated you clean,"
		// which is exactly the ambiguity an approval-bypass audit would flag.
		return c.json(
			{
				success: false,
				status: 'blocked',
				error: 'Approval is invalid, expired, already used, or does not match this request',
				error_code: 'APPROVAL_INVALID',
				reason: redemption.reason,
			},
			403,
		)
	}

	const status = outcome.decision === 'require_approval' ? 202 : 403
	const body: Record<string, unknown> = {
		success: false,
		status: outcome.decision,
		error:
			outcome.decision === 'require_approval'
				? 'Transaction requires approval under org policy'
				: 'Transaction blocked by org policy',
		error_code: 'POLICY_VIOLATION',
		reason: outcome.reason ?? null,
	}

	if (outcome.decision === 'require_approval' && (await approvalsEnabled())) {
		const created = await createApprovalRow(fullIntent)
		if (created) {
			body.approval_id = created.id
			body.poll_url = `/v1/agent/approvals/${created.id}`
			body.expires_at = created.expiresAt.toISOString()
		}
	}

	return c.json(body, status)
}

/**
 * MCP tool gate (no Hono Context available). Returns the standard MCP error
 * envelope, or null to proceed. Callers should return this value directly from
 * the tool handler when non-null.
 */
export async function enforcePolicyForTool(
	agent: { id: number; uuid?: string | null; organizationId?: string | null },
	intent: PolicyGateIntent,
	approvalId?: string,
	forceRequireApprovalReason?: string,
): Promise<{ isError: true; content: Array<{ type: string; text: string }> } | null> {
	// MCP tool calls authenticate via plain agent bearer tokens only (no org
	// API-key path). agents.organizationId (additive/nullable) is the only
	// agent->org mapping this surface can resolve — populated nothing
	// automatically, set out-of-band (enterprise provisioning). When set, org-
	// scoped policies + org kill switches now apply here exactly as they do on
	// the Hono /v1/agent/* org-API-key surface. When absent, this remains an
	// org-less per-agent-policy-rows evaluation — logged loudly (once per call)
	// so monitoring can page on the gap rather than it silently drifting.
	const organizationId = agent.organizationId ?? null
	if (!organizationId) {
		console.error('[POLICY-MCP-NO-ORG-CONTEXT] enforcePolicyForTool has no org mapping for agent', agentIdOf(agent))
		writeAuditLog({
			userId: 0,
			orgId: null,
			agentId: agentIdOf(agent),
			eventType: 'policy.mcp_no_org_context',
			details: { note: 'agent has no agents.organization_id set — MCP tool-auth surface evaluated org-less (owner-link still resolves human notification when linked)' },
		})
	}

	const fullIntent: PolicyIntent = {
		organizationId,
		agentId: agentIdOf(agent),
		...intent,
	}

	const outcome = await runPolicyCheck(fullIntent, forceRequireApprovalReason)
	if (outcome.decision === 'allow') return null

	if (outcome.decision === 'require_approval' && approvalId) {
		const redemption = await redeemApproval(approvalId, fullIntent)
		if (redemption.ok) {
			writeAuditLog({
				userId: 0,
				agentId: fullIntent.agentId ?? null,
				eventType: 'policy.approval_redeemed',
				details: { approvalId },
			})
			return null
		}
		writeAuditLog({
			userId: 0,
			agentId: fullIntent.agentId ?? null,
			eventType: 'policy.approval_rejected',
			details: { approvalId, reason: redemption.reason },
		})
		return {
			isError: true,
			content: [
				{
					type: 'text',
					text: `Approval invalid: ${redemption.reason}. Request a fresh approval and retry.`,
				},
			],
		}
	}

	let message =
		outcome.decision === 'require_approval'
			? `Transaction requires approval under policy${outcome.reason ? `: ${outcome.reason}` : ''}`
			: `Transaction blocked by policy${outcome.reason ? `: ${outcome.reason}` : ''}`

	if (outcome.decision === 'require_approval' && (await approvalsEnabled())) {
		const created = await createApprovalRow(fullIntent)
		if (created) {
			message += ` — approval_id=${created.id}, poll GET /v1/agent/approvals/${created.id}, expires_at=${created.expiresAt.toISOString()}`
		}
	}

	return { isError: true, content: [{ type: 'text', text: message }] }
}
