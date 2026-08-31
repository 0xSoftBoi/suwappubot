/**
 * `alerts-webhooks` node of the enterprise dashboard parity plan
 * (docs/plans/enterprise-dashboard.md) — org webhook configuration (CRUD)
 * for `orgWebhooks` (db/schema/webhooks.ts). Delivery itself lives in
 * services/webhookDispatcher.ts; this file is the control-plane surface org
 * admins use to register/manage SIEM-friendly alert endpoints.
 *
 * Follows enterprisePolicies.ts conventions exactly: `flexAuth` +
 * `resolveMembership` from routes/enterprise.ts, `Effect.fail` (never
 * `throw`) inside pipelines, UUID param guards before any query reaches
 * Postgres, and an audit-log write (services/audit.ts `auditLog`) on every
 * mutation. Mounted under the same `/enterprise` prefix in app.ts.
 *
 * ROLE MODEL: webhook config carries a live signing secret and controls
 * where org security events are sent — admin+ only for every route here,
 * including reads (unlike enterprisePolicies.ts, which lets any member read
 * policies/allowlist). There is no "member can view webhook config" case:
 * even a masked secret plus target URL is operationally sensitive (SIEM
 * endpoint disclosure), so this whole surface matches the audit-log/export
 * routes' admin-only bar, not the member-readable policy routes.
 */
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireDb, orgWebhooks } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { auditLog } from '../services/audit'
import {
	WEBHOOK_EVENT_TYPES,
	generateWebhookSecret,
	isSafeWebhookUrl,
	maskSecret,
	sendTestEvent,
} from '../services/webhookDispatcher'
import { resolveMembership } from './enterprise'

export const enterpriseWebhooksRoutes = new Hono()

enterpriseWebhooksRoutes.use('*', flexAuth())

const ADMIN_ROLES = ['owner', 'admin']

// Non-UUID path params would reach Postgres as a 22P02 cast error and
// surface as a 500 with the raw driver message — reject them up front
// instead (same guard as enterprisePolicies.ts).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(raw: string | undefined): raw is string {
	return !!raw && UUID_RE.test(raw)
}

function maskRow<T extends { secret: string }>(row: T): Omit<T, 'secret'> & { secret: string } {
	const { secret, ...rest } = row
	return { ...rest, secret: maskSecret(secret) } as Omit<T, 'secret'> & { secret: string }
}

// =============================================================================
// GET /enterprise/orgs/:orgId/webhooks
// =============================================================================

enterpriseWebhooksRoutes.get('/orgs/:orgId/webhooks', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db.select().from(orgWebhooks).where(eq(orgWebhooks.orgId, orgId)).orderBy(desc(orgWebhooks.createdAt)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ webhooks: result.right.map(maskRow), eventTypeVocabulary: WEBHOOK_EVENT_TYPES })
})

// =============================================================================
// POST /enterprise/orgs/:orgId/webhooks
// =============================================================================

const CreateWebhookSchema = z.object({
	url: z.string().min(1).max(2048),
	eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length),
	description: z.string().max(255).optional(),
	enabled: z.boolean().default(true),
})

enterpriseWebhooksRoutes.post('/orgs/:orgId/webhooks', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = CreateWebhookSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const urlCheck = isSafeWebhookUrl(parsed.data.url)
	if (!urlCheck.ok) return c.json({ error: urlCheck.error }, 400)

	// Deduplicate eventTypes so the same event never fans out twice per delivery.
	const eventTypes = Array.from(new Set(parsed.data.eventTypes))
	const secret = generateWebhookSecret()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [webhook] = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(orgWebhooks)
						.values({
							orgId,
							url: parsed.data.url,
							secret,
							eventTypes,
							description: parsed.data.description ?? null,
							enabled: parsed.data.enabled,
							createdBy: membership.userId,
						})
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.webhook.created',
				details: { webhookId: webhook!.id, url: webhook!.url, eventTypes },
			})

			return webhook
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	// The full secret is returned ONLY here, ONLY once — every subsequent read
	// (GET list, PATCH response) returns the masked form.
	return c.json({ webhook: result.right }, 201)
})

// =============================================================================
// PATCH /enterprise/orgs/:orgId/webhooks/:webhookId
// =============================================================================

const UpdateWebhookSchema = z
	.object({
		url: z.string().min(1).max(2048).optional(),
		eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length).optional(),
		description: z.string().max(255).nullable().optional(),
		enabled: z.boolean().optional(),
	})
	.refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' })

enterpriseWebhooksRoutes.patch('/orgs/:orgId/webhooks/:webhookId', async (c) => {
	const { webhookId } = c.req.param()
	if (!isUuid(webhookId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const body = await c.req.json().catch(() => ({}))
	const parsed = UpdateWebhookSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	if (parsed.data.url !== undefined) {
		const urlCheck = isSafeWebhookUrl(parsed.data.url)
		if (!urlCheck.ok) return c.json({ error: urlCheck.error }, 400)
	}
	const eventTypes = parsed.data.eventTypes ? Array.from(new Set(parsed.data.eventTypes)) : undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const [updated] = yield* Effect.tryPromise({
				try: () =>
					db
						.update(orgWebhooks)
						.set({
							...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
							...(eventTypes !== undefined ? { eventTypes } : {}),
							...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
							...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
						})
						.where(and(eq(orgWebhooks.id, webhookId), eq(orgWebhooks.orgId, orgId)))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!updated) return yield* Effect.fail(new Error('WEBHOOK_NOT_FOUND'))

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.webhook.updated',
				details: { webhookId, changes: { ...parsed.data, eventTypes } },
			})

			return updated
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'WEBHOOK_NOT_FOUND') return c.json({ error: 'Webhook not found' }, 404)
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ webhook: maskRow(result.right) })
})

// =============================================================================
// DELETE /enterprise/orgs/:orgId/webhooks/:webhookId
// =============================================================================

enterpriseWebhooksRoutes.delete('/orgs/:orgId/webhooks/:webhookId', async (c) => {
	const { webhookId } = c.req.param()
	if (!isUuid(webhookId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [deleted] = yield* Effect.tryPromise({
				try: () =>
					db
						.delete(orgWebhooks)
						.where(and(eq(orgWebhooks.id, webhookId), eq(orgWebhooks.orgId, orgId)))
						.returning({ id: orgWebhooks.id, url: orgWebhooks.url }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!deleted) return yield* Effect.fail(new Error('WEBHOOK_NOT_FOUND'))

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.webhook.deleted',
				details: { webhookId: deleted.id, url: deleted.url },
			})

			return deleted
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'WEBHOOK_NOT_FOUND') return c.json({ error: 'Webhook not found' }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ success: true })
})

// =============================================================================
// POST /enterprise/orgs/:orgId/webhooks/:webhookId/test
// =============================================================================
//
// Unlike production dispatch (fire-and-forget, see dispatchOrgEvent), the
// caller here needs the outcome to render in the dashboard, so this yields
// `sendTestEvent` directly and waits for the single delivery to complete
// (bounded by the dispatcher's own 5s timeout).

enterpriseWebhooksRoutes.post('/orgs/:orgId/webhooks/:webhookId/test', async (c) => {
	const { webhookId } = c.req.param()
	if (!isUuid(webhookId)) return c.json({ error: 'Not found' }, 404)
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [webhook] = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(orgWebhooks)
						.where(and(eq(orgWebhooks.id, webhookId), eq(orgWebhooks.orgId, orgId)))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!webhook) return yield* Effect.fail(new Error('WEBHOOK_NOT_FOUND'))

			const outcome = yield* sendTestEvent(webhook, orgId)

			yield* auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.webhook.tested',
				details: { webhookId, outcome },
			})

			return outcome
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'WEBHOOK_NOT_FOUND') return c.json({ error: 'Webhook not found' }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ delivery: result.right })
})
