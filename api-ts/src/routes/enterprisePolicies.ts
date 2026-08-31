/**
 * Org policy engine + quorum approvals + signed policy export — the
 * `policy-api` node of the enterprise dashboard parity plan
 * (docs/plans/enterprise-dashboard.md). Wires `orgPolicies`,
 * `orgAllowlistAddresses`, `policyApprovalRequests`, `policyApprovals`
 * (db/schema/policies.ts) behind CRUD + quorum-vote + export endpoints.
 *
 * Split into its own file for the same reason as enterpriseTransactions.ts /
 * enterpriseAudit.ts (enterprise.ts is already 1000+ lines); shares
 * `resolveMembership` from enterprise.ts and is mounted under the same
 * `/enterprise` prefix in app.ts (Hono supports multiple `app.route()` calls
 * at one prefix — see routes/index.ts).
 *
 * MONEY-PATH: these tables do not gate execution yet (see the SCHEMA ONLY
 * note atop db/schema/policies.ts) but this is the control surface org
 * admins will use to author transfer-gating policy and run maker-checker
 * approvals, so every mutation below is strict on role and writes an audit
 * entry (services/audit.ts `auditLog`) — never silent.
 *
 * ROLE MODEL (mirrors enterpriseTransactions.ts / enterpriseAudit.ts):
 *   - Reads (GET policies/allowlist/approval-requests) and creating an
 *     approval request: any member (owner/admin/member/viewer) — a member
 *     proposing a policy change or flagging a tx for approval is exactly the
 *     maker half of maker-checker.
 *   - Mutating policies/allowlist (POST/PATCH/DELETE) and casting an
 *     approval vote: owner/admin only — the checker half, and the actions
 *     that change what future transfers are permitted.
 *   - The signed export is treated like the audit log (admin+ only): it is a
 *     full snapshot of the org's control configuration, not a monitoring
 *     view.
 */
import { createHmac } from 'node:crypto'
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import { NATIVE_TOKENS } from '../config/chains'
import { EnvService } from '../config/EnvService'
import {
	requireDb,
	orgPolicies,
	orgAllowlistAddresses,
	policyApprovalRequests,
	policyApprovals,
	type PolicyApprovalRequest,
} from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { auditLog } from '../services/audit'
import { resolveMembership } from './enterprise'

export const enterprisePoliciesRoutes = new Hono()

enterprisePoliciesRoutes.use('*', flexAuth())

const ALL_ROLES = ['owner', 'admin', 'member', 'viewer']
const ADMIN_ROLES = ['owner', 'admin']

function parseIntParam(raw: string | undefined, def: number, max: number): number {
	if (!raw) return def
	const parsed = parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 0) return def
	return Math.min(parsed, max)
}

// Non-UUID path params would reach Postgres as a 22P02 cast error and surface
// as a 500 with the raw driver message — reject them up front instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(raw: string | undefined): raw is string {
	return !!raw && UUID_RE.test(raw)
}

function isConflict(message: string): boolean {
	return /duplicate key|unique constraint/i.test(message)
}

// ─── policyType / params validation ─────────────────────────────────────────
//
// See PARAMS SHAPE comment atop `orgPolicies` in db/schema/policies.ts —
// kept jsonb there since spending-tier and velocity need different shapes.
// Validated strictly here rather than left as free-form so a malformed
// policy can never silently fail to gate anything later (`policy-api` is the
// only place this shape is authored).

const POLICY_TYPES = ['tx_limit', 'daily_limit', 'velocity', 'allowlist_only', 'spending_tier'] as const
type PolicyType = (typeof POLICY_TYPES)[number]

const PositiveNum = z.coerce.number().positive()
const PositiveInt = z.coerce.number().int().positive()

const PARAMS_SCHEMA_BY_TYPE: Record<PolicyType, z.ZodTypeAny> = {
	tx_limit: z.object({ thresholdUsd: PositiveNum }),
	daily_limit: z.object({ thresholdUsd: PositiveNum }),
	velocity: z.object({ windowHours: PositiveNum, maxTxPerWindow: PositiveInt }),
	allowlist_only: z.object({}).default({}),
	spending_tier: z.object({ tierUpperUsd: PositiveNum, thresholdUsd: PositiveNum }),
}

function validatePolicyParams(
	policyType: string,
	params: unknown,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
	const schema = PARAMS_SCHEMA_BY_TYPE[policyType as PolicyType]
	if (!schema) return { ok: false, error: `Invalid policyType: ${policyType}` }
	const parsed = schema.safeParse(params ?? {})
	if (!parsed.success) {
		return { ok: false, error: `Invalid params for policyType '${policyType}': ${parsed.error.message}` }
	}
	return { ok: true, params: parsed.data as Record<string, unknown> }
}

// ─── chain + address validation (allowlist) ─────────────────────────────────
//
// `chain` must be a chain we actually know about — config/chains.ts
// NATIVE_TOKENS is the canonical per-chain registry used across the codebase
// (see RPC_ENDPOINTS/NATIVE_TOKENS), so an unrecognized chain is a 400, not a
// silently-stored dead allowlist entry.
//
// Non-EVM chain families whose addresses are base58/checked-hex and NOT
// case-insensitive identity (Solana base58check, Tron base58check, Starknet
// felt-hex-as-written) — left exactly as submitted (after trim). Every other
// chain key in NATIVE_TOKENS is a plain EVM chain, where an EIP-55 checksum
// casing is a display convenience, not a distinct address, so those are
// validated as strict `0x` + 40 hex chars and normalized to lowercase for
// exact allowlist matching (mirrors PolicyService's own `.toLowerCase()`
// normalization of chain/token/dest lists). The EVM zero address is rejected
// outright — it can never be a legitimate allowlist destination.
const BASE58_CHAIN_FAMILIES = new Set(['solana', 'tron'])
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const STARKNET_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/
const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{25,62}$/
const EVM_ZERO_ADDRESS = `0x${'0'.repeat(40)}`

function isKnownChain(chain: string): boolean {
	return Object.prototype.hasOwnProperty.call(NATIVE_TOKENS, chain)
}

function validateAllowlistAddress(
	chain: string,
	rawAddress: string,
): { ok: true; address: string } | { ok: false; error: string } {
	if (/\s/.test(rawAddress)) return { ok: false, error: 'Address must not contain whitespace' }
	const trimmed = rawAddress.trim()
	if (trimmed.length === 0) return { ok: false, error: 'Address must not be empty' }

	if (chain === 'starknet') {
		if (!STARKNET_ADDRESS_RE.test(trimmed)) {
			return { ok: false, error: 'Invalid starknet address format (expected 0x-prefixed hex felt)' }
		}
		return { ok: true, address: trimmed }
	}

	if (BASE58_CHAIN_FAMILIES.has(chain)) {
		// Base58 length/charset sanity guard — full checksum validation lives
		// with each chain's own SDK; this just rejects obviously-wrong input.
		if (!BASE58_ADDRESS_RE.test(trimmed)) {
			return { ok: false, error: `Invalid ${chain} address format` }
		}
		return { ok: true, address: trimmed }
	}

	if (!EVM_ADDRESS_RE.test(trimmed)) {
		return { ok: false, error: 'Invalid EVM address format (expected 0x + 40 hex chars)' }
	}
	const lower = trimmed.toLowerCase()
	if (lower === EVM_ZERO_ADDRESS) {
		return { ok: false, error: 'The zero address cannot be allowlisted' }
	}
	return { ok: true, address: lower }
}

// =============================================================================
// 1. Policies CRUD
// =============================================================================

// ─── GET /enterprise/orgs/:orgId/policies ───────────────────────────────────

enterprisePoliciesRoutes.get('/orgs/:orgId/policies', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ALL_ROLES)
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(orgPolicies)
						.where(eq(orgPolicies.orgId, orgId))
						.orderBy(desc(orgPolicies.createdAt)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ policies: result.right })
})

// ─── POST /enterprise/orgs/:orgId/policies ──────────────────────────────────

const CreatePolicySchema = z.object({
	name: z.string().min(1).max(120),
	policyType: z.enum(POLICY_TYPES),
	params: z.record(z.string(), z.unknown()).default({}),
	requiredApprovals: z.coerce.number().int().min(1).max(50).default(1),
	enabled: z.boolean().default(true),
})

enterprisePoliciesRoutes.post('/orgs/:orgId/policies', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = CreatePolicySchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const paramsCheck = validatePolicyParams(parsed.data.policyType, parsed.data.params)
	if (!paramsCheck.ok) return c.json({ error: paramsCheck.error }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [policy] = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(orgPolicies)
						.values({
							orgId,
							name: parsed.data.name,
							policyType: parsed.data.policyType,
							params: paramsCheck.params,
							requiredApprovals: parsed.data.requiredApprovals,
							enabled: parsed.data.enabled,
							createdBy: membership.userId,
						})
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.created',
				details: { policyId: policy!.id, name: policy!.name, policyType: policy!.policyType },
			})

			return policy
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ policy: result.right }, 201)
})

// ─── PATCH /enterprise/orgs/:orgId/policies/:policyId ───────────────────────

const UpdatePolicySchema = z
	.object({
		name: z.string().min(1).max(120).optional(),
		params: z.record(z.string(), z.unknown()).optional(),
		enabled: z.boolean().optional(),
		requiredApprovals: z.coerce.number().int().min(1).max(50).optional(),
	})
	.refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' })

enterprisePoliciesRoutes.patch('/orgs/:orgId/policies/:policyId', async (c) => {
	const { policyId } = c.req.param()
	if (!isUuid(policyId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = UpdatePolicySchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const [existing] = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(orgPolicies)
						.where(and(eq(orgPolicies.id, policyId), eq(orgPolicies.orgId, orgId)))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!existing) return yield* Effect.fail(new Error('POLICY_NOT_FOUND'))

			// policyType itself is immutable via PATCH (not in the allowed field
			// list) — params, if supplied, must still validate against the
			// policy's existing (unchanged) policyType.
			let nextParams = existing.params as Record<string, unknown>
			if (parsed.data.params !== undefined) {
				const paramsCheck = validatePolicyParams(existing.policyType, parsed.data.params)
				if (!paramsCheck.ok) {
					return yield* Effect.fail(new Error(`PARAMS_INVALID:${paramsCheck.error}`))
				}
				nextParams = paramsCheck.params
			}

			const [updated] = yield* Effect.tryPromise({
				try: () =>
					db
						.update(orgPolicies)
						.set({
							...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
							...(parsed.data.params !== undefined ? { params: nextParams } : {}),
							...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
							...(parsed.data.requiredApprovals !== undefined
								? { requiredApprovals: parsed.data.requiredApprovals }
								: {}),
							updatedAt: new Date(),
						})
						.where(and(eq(orgPolicies.id, policyId), eq(orgPolicies.orgId, orgId)))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.updated',
				details: { policyId, changes: parsed.data },
			})

			return updated
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'POLICY_NOT_FOUND') return c.json({ error: 'Policy not found' }, 404)
		if (err.message.startsWith('PARAMS_INVALID:')) {
			return c.json({ error: err.message.slice('PARAMS_INVALID:'.length) }, 400)
		}
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ policy: result.right })
})

// ─── DELETE /enterprise/orgs/:orgId/policies/:policyId ──────────────────────

enterprisePoliciesRoutes.delete('/orgs/:orgId/policies/:policyId', async (c) => {
	const { policyId } = c.req.param()
	if (!isUuid(policyId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [deleted] = yield* Effect.tryPromise({
				try: () =>
					db
						.delete(orgPolicies)
						.where(and(eq(orgPolicies.id, policyId), eq(orgPolicies.orgId, orgId)))
						.returning({ id: orgPolicies.id, name: orgPolicies.name }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!deleted) return yield* Effect.fail(new Error('POLICY_NOT_FOUND'))

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.deleted',
				details: { policyId: deleted.id, name: deleted.name },
			})

			return deleted
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'POLICY_NOT_FOUND') return c.json({ error: 'Policy not found' }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ success: true })
})

// =============================================================================
// 2. Allowlist
// =============================================================================

// ─── GET /enterprise/orgs/:orgId/allowlist ──────────────────────────────────

enterprisePoliciesRoutes.get('/orgs/:orgId/allowlist', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ALL_ROLES)
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(orgAllowlistAddresses)
						.where(eq(orgAllowlistAddresses.orgId, orgId))
						.orderBy(desc(orgAllowlistAddresses.createdAt)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ allowlist: result.right })
})

// ─── POST /enterprise/orgs/:orgId/allowlist ─────────────────────────────────

const AddAllowlistSchema = z.object({
	chain: z.string().min(1).max(50),
	address: z.string().min(1).max(255),
	label: z.string().max(100).optional(),
})

enterprisePoliciesRoutes.post('/orgs/:orgId/allowlist', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = AddAllowlistSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const chain = parsed.data.chain.trim().toLowerCase()
	if (!isKnownChain(chain)) {
		return c.json(
			{ error: `Unknown chain: ${chain}`, supportedChains: Object.keys(NATIVE_TOKENS) },
			400,
		)
	}
	const addressCheck = validateAllowlistAddress(chain, parsed.data.address)
	if (!addressCheck.ok) return c.json({ error: addressCheck.error }, 400)
	const address = addressCheck.address

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const entry = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(orgAllowlistAddresses)
						.values({
							orgId,
							chain,
							address,
							label: parsed.data.label ?? null,
							addedBy: membership.userId,
						})
						.returning()
						.then((rows) => rows[0]),
				catch: (e) => {
					const err = e instanceof Error ? e : new Error(String(e))
					if (isConflict(err.message)) return new Error('ALLOWLIST_ENTRY_EXISTS')
					return err
				},
			})

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.allowlist_added',
				details: { entryId: entry!.id, chain, address, label: parsed.data.label ?? null },
			})

			return entry
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'ALLOWLIST_ENTRY_EXISTS') {
			return c.json({ error: 'This address is already allowlisted for this chain' }, 409)
		}
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ entry: result.right }, 201)
})

// ─── DELETE /enterprise/orgs/:orgId/allowlist/:entryId ──────────────────────

enterprisePoliciesRoutes.delete('/orgs/:orgId/allowlist/:entryId', async (c) => {
	const { entryId } = c.req.param()
	if (!isUuid(entryId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [deleted] = yield* Effect.tryPromise({
				try: () =>
					db
						.delete(orgAllowlistAddresses)
						.where(and(eq(orgAllowlistAddresses.id, entryId), eq(orgAllowlistAddresses.orgId, orgId)))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!deleted) return yield* Effect.fail(new Error('ENTRY_NOT_FOUND'))

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.allowlist_removed',
				details: { entryId: deleted.id, chain: deleted.chain, address: deleted.address },
			})

			return deleted
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'ENTRY_NOT_FOUND') return c.json({ error: 'Allowlist entry not found' }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ success: true })
})

// =============================================================================
// 3. Approvals (maker-checker quorum)
// =============================================================================

const REQUEST_TYPES = ['transaction', 'policy_change', 'allowlist_add', 'allowlist_remove', 'other'] as const
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const

// ─── POST /enterprise/orgs/:orgId/approval-requests ─────────────────────────

const APPROVAL_PAYLOAD_MAX_BYTES = 16 * 1024

const CreateApprovalRequestSchema = z
	.object({
		requestType: z.enum(REQUEST_TYPES),
		payload: z.record(z.string(), z.unknown()),
		policyId: z.string().uuid().optional(),
		requiredApprovals: z.coerce.number().int().min(1).max(50).optional(),
		expiresAt: z.string().datetime().optional(),
	})
	.superRefine((data, ctx) => {
		const size = Buffer.byteLength(JSON.stringify(data.payload ?? {}), 'utf8')
		if (size > APPROVAL_PAYLOAD_MAX_BYTES) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['payload'],
				message: `payload too large (${size} bytes; max ${APPROVAL_PAYLOAD_MAX_BYTES})`,
			})
		}
	})

enterprisePoliciesRoutes.post('/orgs/:orgId/approval-requests', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ALL_ROLES)
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = CreateApprovalRequestSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			// requiredApprovals is NEVER taken verbatim from the caller when a
			// policy is attached: the policy that produced this request defines
			// its own quorum, unconditionally — a caller cannot pass a lower
			// requiredApprovals in the body to downgrade quorum below what the
			// policy mandates. Without a policyId, the body value (floored at 1)
			// is honored since there's no policy quorum to defer to.
			let requiredApprovals: number
			if (parsed.data.policyId) {
				const [policy] = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ requiredApprovals: orgPolicies.requiredApprovals })
							.from(orgPolicies)
							.where(and(eq(orgPolicies.id, parsed.data.policyId!), eq(orgPolicies.orgId, orgId)))
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
				if (!policy) return yield* Effect.fail(new Error('POLICY_NOT_FOUND'))
				requiredApprovals = policy.requiredApprovals
			} else {
				requiredApprovals = Math.max(parsed.data.requiredApprovals ?? 1, 1)
			}

			const [request] = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(policyApprovalRequests)
						.values({
							orgId,
							policyId: parsed.data.policyId ?? null,
							requestedBy: membership.userId,
							requestType: parsed.data.requestType,
							payload: parsed.data.payload,
							requiredApprovals,
							expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
						})
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.approval_requested',
				details: {
					requestId: request!.id,
					requestType: parsed.data.requestType,
					policyId: parsed.data.policyId ?? null,
					requiredApprovals,
				},
			})

			return request
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'POLICY_NOT_FOUND') return c.json({ error: 'Policy not found' }, 404)
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ request: result.right }, 201)
})

// ─── GET /enterprise/orgs/:orgId/approval-requests?status= ──────────────────
//
// Expiry is lazy (per the task spec: "check lazily on read/vote"). Instead of
// reading a capped window of rows into memory, flipping expired ones, and
// paginating in-memory, this is now a single set-based
// `UPDATE ... WHERE orgId AND status='pending' AND expiresAt < now()`
// (`RETURNING id` for the audit trail) followed by a normal indexed
// SELECT + COUNT(*) for the actual page. No row cap, no in-memory
// read-modify-write, and the audit write is attributed to the system (the
// expiry is time-triggered, not caused by whoever happened to issue this
// GET) — see services/audit.ts's userId-0 system-event convention.
enterprisePoliciesRoutes.get('/orgs/:orgId/approval-requests', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ALL_ROLES)
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)
	const orgId = membership.orgId

	const statusParam = c.req.query('status')?.trim().toLowerCase()
	if (statusParam && !REQUEST_STATUSES.includes(statusParam as (typeof REQUEST_STATUSES)[number])) {
		return c.json({ error: `Invalid status: ${statusParam}`, supported: REQUEST_STATUSES }, 400)
	}

	const limit = Math.max(1, parseIntParam(c.req.query('limit'), 50, 200))
	const offset = parseIntParam(c.req.query('offset'), 0, 1_000_000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const now = new Date()

			const expiredRows = yield* Effect.tryPromise({
				try: () =>
					db
						.update(policyApprovalRequests)
						.set({ status: 'expired', resolvedAt: now })
						.where(
							and(
								eq(policyApprovalRequests.orgId, orgId),
								eq(policyApprovalRequests.status, 'pending'),
								lt(policyApprovalRequests.expiresAt, now),
							),
						)
						.returning({ id: policyApprovalRequests.id }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			if (expiredRows.length > 0) {
				// One aggregate audit row: per-row entries each take the org's
				// chain advisory lock, so a large backlog would stall this GET.
				yield* auditLog({
					userId: 0,
					orgId,
					eventType: 'enterprise.policy.approval_expired',
					details: {
						requestIds: expiredRows.slice(0, 500).map((r) => r.id),
						expiredCount: expiredRows.length,
						actor: 'system',
						triggeredByRead: membership.userId,
					},
				})
			}

			const whereClause: SQL = statusParam
				? and(
						eq(policyApprovalRequests.orgId, orgId),
						eq(policyApprovalRequests.status, statusParam),
					)!
				: eq(policyApprovalRequests.orgId, orgId)

			const [rows, countRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(policyApprovalRequests)
							.where(whereClause)
							.orderBy(desc(policyApprovalRequests.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ count: sql<number>`cast(count(*) as int)` })
							.from(policyApprovalRequests)
							.where(whereClause),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			return { rows, total: Number(countRows[0]?.count ?? 0) }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ requests: result.right.rows, total: result.right.total, limit, offset })
})

// ─── POST /enterprise/orgs/:orgId/approval-requests/:requestId/vote ─────────

const VoteSchema = z.object({
	decision: z.enum(['approve', 'reject']),
	comment: z.string().max(500).optional(),
})

enterprisePoliciesRoutes.post('/orgs/:orgId/approval-requests/:requestId/vote', async (c) => {
	const { requestId } = c.req.param()
	if (!isUuid(requestId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = VoteSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	// Everything below — the authoritative re-read, the expiry check, the vote
	// insert, the quorum count, and the resolving UPDATE — runs inside ONE
	// db.transaction. The re-read uses `SELECT ... FOR UPDATE` so a concurrent
	// vote on the same request blocks until this transaction commits: votes on
	// a single request are strictly serialized, and the resolving UPDATE's
	// `WHERE status = 'pending'` guard means zero rows updated can only mean
	// someone else already resolved it — a reject can never be silently
	// overwritten by a concurrent approve, and vice versa.
	type VoteTxResult =
		| { kind: 'not_found' }
		| { kind: 'expired' }
		| { kind: 'already_resolved'; status: string }
		| { kind: 'own_request' }
		| { kind: 'already_voted' }
		| {
				kind: 'ok'
				request: PolicyApprovalRequest
				decision: 'approve' | 'reject'
				outcome: 'approved' | 'rejected' | null
		  }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const txResult = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx): Promise<VoteTxResult> => {
						const [request] = await tx
							.select()
							.from(policyApprovalRequests)
							.where(
								and(eq(policyApprovalRequests.id, requestId), eq(policyApprovalRequests.orgId, orgId)),
							)
							.for('update')
							.limit(1)
						if (!request) return { kind: 'not_found' }

						const now = new Date()

						// Lazy expiry check, re-verified under the row lock — a vote
						// arriving after expiresAt must not be countable.
						if (request.status === 'pending' && request.expiresAt && request.expiresAt < now) {
							await tx
								.update(policyApprovalRequests)
								.set({ status: 'expired', resolvedAt: now })
								.where(
									and(eq(policyApprovalRequests.id, requestId), eq(policyApprovalRequests.status, 'pending')),
								)
							return { kind: 'expired' }
						}

						if (request.status !== 'pending') {
							return { kind: 'already_resolved', status: request.status }
						}
						if (request.requestedBy != null && request.requestedBy === membership.userId) {
							return { kind: 'own_request' }
						}

						// ON CONFLICT DO NOTHING instead of try/catch: postgres.js taps every
						// query's rejection inside sql.begin and rethrows it after the
						// callback returns, so a caught 23505 would still abort the tx and
						// surface as a 500. A conflict must never reject inside this tx.
						const insertedVotes = await tx
							.insert(policyApprovals)
							.values({
								requestId,
								approverUserId: membership.userId,
								decision: parsed.data.decision,
								comment: parsed.data.comment ?? null,
							})
							.onConflictDoNothing()
							.returning({ id: policyApprovals.id })
						if (insertedVotes.length === 0) return { kind: 'already_voted' }

						// Any reject short-circuits the whole request to 'rejected'
						// regardless of how many approvals were already cast; otherwise
						// resolve to 'approved' once distinct approve-votes reach
						// requiredApprovals.
						let outcome: 'approved' | 'rejected' | null = null
						if (parsed.data.decision === 'reject') {
							outcome = 'rejected'
						} else {
							const [{ approveCount }] = await tx
								.select({ approveCount: sql<number>`cast(count(*) as int)` })
								.from(policyApprovals)
								.where(
									and(eq(policyApprovals.requestId, requestId), eq(policyApprovals.decision, 'approve')),
								)
							if (Number(approveCount) >= request.requiredApprovals) outcome = 'approved'
						}

						let finalRequest = request
						if (outcome) {
							const [updated] = await tx
								.update(policyApprovalRequests)
								.set({ status: outcome, resolvedAt: now })
								.where(
									and(eq(policyApprovalRequests.id, requestId), eq(policyApprovalRequests.status, 'pending')),
								)
								.returning()
							// Zero rows updated => resolved concurrently by someone else —
							// shouldn't happen given the FOR UPDATE lock above, but the
							// status='pending' guard is kept as defense in depth. Fall back
							// to the pre-update snapshot rather than clobbering state.
							finalRequest = updated ?? finalRequest
						}

						return { kind: 'ok', request: finalRequest, decision: parsed.data.decision, outcome }
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			// Audit writes happen after the transaction commits (auditLog opens its
			// own transaction for the hash-chain advisory lock, so it can't be
			// nested inside the vote transaction above).
			switch (txResult.kind) {
				case 'not_found':
					return yield* Effect.fail(new Error('REQUEST_NOT_FOUND'))
				case 'expired':
					yield* auditLog({
						userId: 0,
						orgId,
						eventType: 'enterprise.policy.approval_expired',
						details: { requestId, actor: 'system', triggeredByRead: membership.userId },
					})
					return yield* Effect.fail(new Error('REQUEST_EXPIRED'))
				case 'already_resolved':
					return yield* Effect.fail(new Error(`REQUEST_ALREADY_RESOLVED:${txResult.status}`))
				case 'own_request':
					return yield* Effect.fail(new Error('CANNOT_VOTE_OWN_REQUEST'))
				case 'already_voted':
					return yield* Effect.fail(new Error('ALREADY_VOTED'))
				case 'ok': {
					yield* auditLog({
						userId: membership.userId,
						orgId,
						eventType: 'enterprise.policy.approval_voted',
						details: {
							requestId,
							decision: txResult.decision,
							comment: parsed.data.comment ?? null,
						},
					})
					if (txResult.outcome) {
						yield* auditLog({
							userId: membership.userId,
							orgId,
							eventType: 'enterprise.policy.approval_resolved',
							details: { requestId, outcome: txResult.outcome },
						})
					}
					return txResult.request
				}
			}
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'REQUEST_NOT_FOUND') return c.json({ error: 'Approval request not found' }, 404)
		if (err.message === 'REQUEST_EXPIRED') return c.json({ error: 'Approval request has expired' }, 409)
		if (err.message.startsWith('REQUEST_ALREADY_RESOLVED:')) {
			const existingStatus = err.message.slice('REQUEST_ALREADY_RESOLVED:'.length)
			return c.json({ error: `Approval request is already ${existingStatus}` }, 409)
		}
		if (err.message === 'CANNOT_VOTE_OWN_REQUEST') {
			return c.json({ error: 'You cannot vote on your own approval request' }, 403)
		}
		if (err.message === 'ALREADY_VOTED') {
			return c.json({ error: 'You have already voted on this approval request' }, 409)
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ request: result.right })
})

// =============================================================================
// 4. Signed policy export (Fireblocks-style differentiator)
// =============================================================================

// ─── GET /enterprise/orgs/:orgId/policies/export ────────────────────────────
//
// Registered BEFORE PATCH/DELETE .../policies/:policyId in file order is
// irrelevant here (different HTTP methods can't collide), but Hono still
// matches `/policies/export` against `/policies/:policyId` for GET if this
// were a GET on the :policyId path — it is not (that's PATCH/DELETE only),
// so there is no literal-vs-param ordering hazard on this route.
//
// `contentHash` is HMAC-SHA256 (keyed — a bare sha256 is a checksum anyone
// can recompute and forge, not a signature) over the canonical
// (fixed-key-order), compact JSON.stringify of exactly
// `{orgId, policies, allowlist}` — computed with explicit per-field mapping
// (not `SELECT *`) so the hash is stable even if new nullable columns are
// added to either table later. `exportedAt` is deliberately OUTSIDE the
// hashed payload (it's wall-clock metadata about the export, not part of the
// org's control-plane state) so re-exporting identical policy/allowlist
// state a second later doesn't change the signature. The HMAC key is
// JWT_SECRET (the same session-signing secret already required elsewhere in
// this API — see EnvService) rather than a new dedicated env var, so a
// recipient who already trusts this deployment's JWT can verify the export
// without a new secret to provision. Admin+ only, same rationale as the
// audit log endpoints: this is a full export of the org's control
// configuration, not a monitoring view.
enterprisePoliciesRoutes.get('/orgs/:orgId/policies/export', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const env = yield* EnvService
			if (!env.JWT_SECRET) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			// Domain-separated subkey: recipients verifying an export must never
			// hold the raw session-signing secret (it would let them mint JWTs).
			const signingKey = createHmac('sha256', env.JWT_SECRET)
				.update('policy-export-v1')
				.digest()

			const [policyRows, allowlistRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(orgPolicies)
							.where(eq(orgPolicies.orgId, orgId))
							.orderBy(orgPolicies.createdAt, orgPolicies.id),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(orgAllowlistAddresses)
							.where(eq(orgAllowlistAddresses.orgId, orgId))
							.orderBy(orgAllowlistAddresses.createdAt, orgAllowlistAddresses.id),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			const policies = policyRows.map((p) => ({
				id: p.id,
				name: p.name,
				policyType: p.policyType,
				params: p.params,
				requiredApprovals: p.requiredApprovals,
				enabled: p.enabled,
				createdAt: p.createdAt?.toISOString() ?? null,
				updatedAt: p.updatedAt?.toISOString() ?? null,
			}))
			const allowlist = allowlistRows.map((a) => ({
				id: a.id,
				chain: a.chain,
				address: a.address,
				label: a.label,
				createdAt: a.createdAt?.toISOString() ?? null,
			}))

			// Fixed key order, exportedAt excluded — this is exactly what gets
			// HMAC'd. `exportedAt` is added to the response AFTER hashing.
			const canonical = { orgId, policies, allowlist }
			const contentHash = createHmac('sha256', signingKey).update(JSON.stringify(canonical)).digest('hex')
			const exportedAt = new Date().toISOString()

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.policy.export',
				details: { contentHash, policyCount: policies.length, allowlistCount: allowlist.length },
			})

			return {
				...canonical,
				exportedAt,
				contentHash,
				verification: {
					algorithm: 'HMAC-SHA256',
					keyIdHint: 'policy-export-v1 (domain-separated subkey; the raw session secret is never shared)',
					canonicalization:
						'JSON.stringify({orgId, policies, allowlist}) with the fields in this exact order; exportedAt and contentHash are NOT part of the hashed payload',
					howToVerify:
						'key = HMAC-SHA256("policy-export-v1", <deployment secret>) as raw bytes; HMAC-SHA256(JSON.stringify({orgId, policies, allowlist}), key) as hex must equal contentHash. Request re-verification from the API rather than sharing the deployment secret.',
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	c.header('Content-Type', 'application/json; charset=utf-8')
	c.header('Content-Disposition', `attachment; filename="org-${orgId}-policy-export.json"`)
	return c.body(JSON.stringify(result.right, null, 2))
})
