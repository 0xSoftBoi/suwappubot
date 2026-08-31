import { randomBytes, createHash } from 'node:crypto'
import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireDb, organizations, organizationMembers, apiKeys, apiUsageEvents, subscriptions } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'

export const enterpriseRoutes = new Hono()

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve the caller's internal user id from whichever auth succeeded.
 *
 * flexAuth sets `authUser` (already carrying the internal userId) for JWT and
 * cookie sessions; telegramAuth sets `telegramUser`, which needs a lookup.
 * Preferring authUser avoids a needless query and lets a browser session that
 * never touched Telegram authenticate at all — previously impossible, since
 * these routes required X-Telegram-Init-Data and the dashboard sent a bearer
 * token, so every request 401'd.
 */
async function resolveUserId(c: any): Promise<number | null> {
	const authUser = c.get('authUser')
	if (authUser?.userId) return authUser.userId

	const telegramUser = c.get('telegramUser')
	if (!telegramUser) return null

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const opt = yield* userService.getUserByTelegramId(telegramUser.id)
			return Option.isNone(opt) ? null : opt.value.id
		}),
	)
	if (Either.isLeft(result)) return null
	return result.right
}

/** Verify caller is a member of the org with one of the allowed roles. */
async function resolveMembership(
	c: any,
	orgId: string,
	allowedRoles: string[],
): Promise<{ userId: number; role: string } | null> {
	const userId = await resolveUserId(c)
	if (!userId) return null

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ role: organizationMembers.role })
						.from(organizationMembers)
						.where(
							and(
								eq(organizationMembers.organizationId, orgId),
								eq(organizationMembers.userId, userId),
							),
						)
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return rows[0] ?? null
		}),
	)

	if (Either.isLeft(result) || !result.right) return null
	const { role } = result.right
	if (!allowedRoles.includes(role)) return null
	return { userId, role }
}

// ─── all enterprise routes require auth; NONE are tier-gated ─────────────────

// flexAuth, not telegramAuth: accepts Telegram initData, a bearer JWT, OR the
// parent-domain session cookie. telegramAuth() accepted ONLY initData, which
// is why the web dashboard could never authenticate.
enterpriseRoutes.use('*', flexAuth())

// MONEY-PATH note: there is deliberately NO requireTier() here anymore.
// The blanket requireTier('enterprise') 402'd every route for a fresh
// sign-up — including GET /orgs/me and POST /orgs — so a new user could
// neither see their (empty) workspace state nor create one: the dashboard
// authenticated and then showed nothing actionable. Workspace management
// (org, members, keys) is account plumbing, not the paid product; what a
// plan actually sells — API call volume, rate limits, seats — is enforced
// where the spend happens (apiKeyAuth + billing + the seat/rate limits on
// the org's subscription), not by refusing to show the door.

// ─── POST /enterprise/orgs ───────────────────────────────────────────────────

const CreateOrgSchema = z.object({
	name: z.string().min(1).max(200),
	slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
})

enterpriseRoutes.post('/orgs', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = CreateOrgSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const userId = await resolveUserId(c)
	if (!userId) return c.json({ error: 'User not found' }, 401)

	const { name, slug } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			// Check slug uniqueness
			const existing = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ id: organizations.id })
						.from(organizations)
						.where(eq(organizations.slug, slug))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (existing.length > 0) throw new Error('Slug already taken')

			const [org] = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(organizations)
						.values({ name, slug, ownerId: userId })
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			// Add owner as member
			yield* Effect.tryPromise({
				try: () =>
					db
						.insert(organizationMembers)
						.values({ organizationId: org!.id, userId, role: 'owner', invitedBy: userId }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			return org
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Slug already taken') return c.json({ error: err.message }, 409)
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ org: result.right }, 201)
})

// ─── GET /enterprise/orgs/:orgId ────────────────────────────────────────────

enterpriseRoutes.get('/orgs/:orgId', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin', 'member', 'viewer'])
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const [org] = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(organizations)
						.where(eq(organizations.id, orgId))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!org) throw new Error('Organization not found')

			const [{ count }] = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ count: sql<number>`cast(count(*) as int)` })
						.from(organizationMembers)
						.where(eq(organizationMembers.organizationId, orgId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const [{ keyCount }] = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ keyCount: sql<number>`cast(count(*) as int)` })
						.from(apiKeys)
						.where(
							and(eq(apiKeys.organizationId, orgId), isNull(apiKeys.revokedAt)),
						),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			return { ...org, memberCount: count, activeKeyCount: keyCount }
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Organization not found') return c.json({ error: err.message }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ org: result.right })
})

// ─── PATCH /enterprise/orgs/:orgId ──────────────────────────────────────────

const UpdateOrgSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
})

enterpriseRoutes.patch('/orgs/:orgId', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)

	const body = await c.req.json().catch(() => ({}))
	const parsed = UpdateOrgSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			if (parsed.data.slug) {
				const existing = yield* Effect.tryPromise({
					try: () =>
						db.query.organizations.findFirst({
							where: and(eq(organizations.slug, parsed.data.slug!), ne(organizations.id, orgId)),
						}),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
				if (existing) throw new Error('Slug already taken')
			}

			const [updated] = yield* Effect.tryPromise({
				try: () =>
					db
						.update(organizations)
						.set({ ...parsed.data, updatedAt: new Date() })
						.where(eq(organizations.id, orgId))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return updated
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Slug already taken') return c.json({ error: err.message }, 409)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ org: result.right })
})

// ─── GET /enterprise/orgs/:orgId/members ────────────────────────────────────

enterpriseRoutes.get('/orgs/:orgId/members', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin', 'member', 'viewer'])
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const members = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							id: organizationMembers.id,
							userId: organizationMembers.userId,
							role: organizationMembers.role,
							joinedAt: organizationMembers.joinedAt,
						})
						.from(organizationMembers)
						.where(eq(organizationMembers.organizationId, orgId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return members
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ members: result.right })
})

// ─── POST /enterprise/orgs/:orgId/members ───────────────────────────────────

const InviteMemberSchema = z.object({
	userId: z.number().int(),
	role: z.enum(['admin', 'member', 'viewer']).default('member'),
})

enterpriseRoutes.post('/orgs/:orgId/members', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)

	const body = await c.req.json().catch(() => ({}))
	const parsed = InviteMemberSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const member = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						const [org] = await tx
							.select({ seatLimit: organizations.seatLimit })
							.from(organizations)
							.where(eq(organizations.id, orgId))
							.limit(1)

						const [{ count }] = await tx
							.select({ count: sql<number>`cast(count(*) as int)` })
							.from(organizationMembers)
							.where(eq(organizationMembers.organizationId, orgId))

						if (org && Number(count) >= (org.seatLimit ?? 10)) {
							throw new Error('SEAT_LIMIT_EXCEEDED')
						}

						const [inserted] = await tx
							.insert(organizationMembers)
							.values({
								organizationId: orgId,
								userId: parsed.data.userId,
								role: parsed.data.role,
								invitedBy: membership.userId,
							})
							.returning()

						return inserted
					}),
				catch: (e) => {
					const err = e instanceof Error ? e : new Error(String(e))
					if (err.message === 'SEAT_LIMIT_EXCEEDED') throw new Error('Seat limit reached')
					if (err.message.includes('unique') || err.message.includes('duplicate')) {
						throw new Error('User is already a member')
					}
					throw err
				},
			})

			return member
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Seat limit reached' || err.message === 'User is already a member') {
			return c.json({ error: err.message }, 409)
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ member: result.right }, 201)
})

// ─── PATCH /enterprise/orgs/:orgId/members/:userId ──────────────────────────

const UpdateMemberSchema = z.object({
	role: z.enum(['admin', 'member', 'viewer']),
})

enterpriseRoutes.patch('/orgs/:orgId/members/:targetUserId', async (c) => {
	const { orgId, targetUserId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner'])
	if (!membership) return c.json({ error: 'Owner role required to change member roles' }, 403)

	const body = await c.req.json().catch(() => ({}))
	const parsed = UpdateMemberSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const targetId = parseInt(targetUserId, 10)
	if (isNaN(targetId)) return c.json({ error: 'Invalid userId' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [updated] = yield* Effect.tryPromise({
				try: () =>
					db
						.update(organizationMembers)
						.set({ role: parsed.data.role })
						.where(
							and(
								eq(organizationMembers.organizationId, orgId),
								eq(organizationMembers.userId, targetId),
							),
						)
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!updated) throw new Error('Member not found')
			return updated
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Member not found') return c.json({ error: err.message }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ member: result.right })
})

// ─── DELETE /enterprise/orgs/:orgId/members/:userId ─────────────────────────

enterpriseRoutes.delete('/orgs/:orgId/members/:targetUserId', async (c) => {
	const { orgId, targetUserId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)

	const targetId = parseInt(targetUserId, 10)
	if (isNaN(targetId)) return c.json({ error: 'Invalid userId' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			// Fetch the target member's current role before deleting
			const targetMember = yield* Effect.tryPromise({
				try: () =>
					db.query.organizationMembers.findFirst({
						where: and(
							eq(organizationMembers.organizationId, orgId),
							eq(organizationMembers.userId, targetId),
						),
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			if (!targetMember) throw new Error('Member not found')
			if (targetMember.role === 'owner') throw new Error('Cannot remove the org owner')
			// Admins may not remove peer admins — only the owner can do that
			if (membership.role === 'admin' && targetMember.role === 'admin') {
				throw new Error('Admins cannot remove other admins')
			}

			yield* Effect.tryPromise({
				try: () =>
					db
						.delete(organizationMembers)
						.where(
							and(
								eq(organizationMembers.organizationId, orgId),
								eq(organizationMembers.userId, targetId),
							),
						),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Member not found') return c.json({ error: err.message }, 404)
		if (err.message === 'Cannot remove the org owner' || err.message === 'Admins cannot remove other admins') {
			return c.json({ error: err.message }, 403)
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ success: true })
})

// ─── GET /enterprise/orgs/:orgId/api-keys ───────────────────────────────────

enterpriseRoutes.get('/orgs/:orgId/api-keys', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin', 'member', 'viewer'])
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const keys = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							id: apiKeys.id,
							name: apiKeys.name,
							keyPrefix: apiKeys.keyPrefix,
							scopes: apiKeys.scopes,
							rateLimitPerMin: apiKeys.rateLimitPerMin,
							expiresAt: apiKeys.expiresAt,
							revokedAt: apiKeys.revokedAt,
							lastUsedAt: apiKeys.lastUsedAt,
							createdAt: apiKeys.createdAt,
						})
						.from(apiKeys)
						.where(eq(apiKeys.organizationId, orgId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return keys
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ keys: result.right })
})

// ─── POST /enterprise/orgs/:orgId/api-keys ──────────────────────────────────

const CreateKeySchema = z.object({
	name: z.string().min(1).max(100),
	scopes: z.array(z.string()).default([]),
	expiresAt: z.string().datetime().optional(),
})

enterpriseRoutes.post('/orgs/:orgId/api-keys', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)

	const body = await c.req.json().catch(() => ({}))
	const parsed = CreateKeySchema.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	// Generate a crypto-random key: sk_live_ + 32 hex chars (16 random bytes)
	const rawKey = `sk_live_${randomBytes(16).toString('hex')}`
	const keyHash = createHash('sha256').update(rawKey).digest('hex')
	const keyPrefix = 'sk_live_' + rawKey.slice(8, 12) // just the 4 hex discriminator chars (12 chars total)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [key] = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(apiKeys)
						.values({
							organizationId: orgId,
							createdBy: membership.userId,
							name: parsed.data.name,
							keyHash,
							keyPrefix,
							scopes: parsed.data.scopes,
							expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
						})
						.returning({
							id: apiKeys.id,
							name: apiKeys.name,
							keyPrefix: apiKeys.keyPrefix,
							scopes: apiKeys.scopes,
							expiresAt: apiKeys.expiresAt,
							createdAt: apiKeys.createdAt,
						}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return key
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	// Return the raw key ONCE — it cannot be retrieved again
	return c.json({ key: result.right, rawKey }, 201)
})

// ─── DELETE /enterprise/orgs/:orgId/api-keys/:keyId ─────────────────────────

enterpriseRoutes.delete('/orgs/:orgId/api-keys/:keyId', async (c) => {
	const { orgId, keyId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [updated] = yield* Effect.tryPromise({
				try: () =>
					db
						.update(apiKeys)
						.set({ revokedAt: new Date() })
						.where(
							and(
								eq(apiKeys.id, keyId),
								eq(apiKeys.organizationId, orgId),
								isNull(apiKeys.revokedAt),
							),
						)
						.returning({ id: apiKeys.id }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!updated) throw new Error('Key not found or already revoked')
			return updated
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Key not found or already revoked') {
			return c.json({ error: err.message }, 404)
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ success: true, revokedAt: new Date().toISOString() })
})

// ─── GET /enterprise/orgs/:orgId/usage ──────────────────────────────────────

enterpriseRoutes.get('/orgs/:orgId/usage', async (c) => {
	const { orgId } = c.req.param()
	const membership = await resolveMembership(c, orgId, ['owner', 'admin', 'member', 'viewer'])
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const now = new Date()
			const todayStart = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
			)
			const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
			const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)

			const [aggRow, topEndpointsRows, dailyRows] = yield* Effect.all([
				// Core aggregates
				Effect.tryPromise({
					try: () =>
						db
							.select({
								callsToday: sql<number>`count(*) filter (where ${apiUsageEvents.createdAt} >= ${todayStart})`,
								callsThisMonth: sql<number>`count(*) filter (where ${apiUsageEvents.createdAt} >= ${monthStart})`,
								rateLimitHits: sql<number>`count(*) filter (where ${apiUsageEvents.statusCode} = 429)`,
								totalCalls: sql<number>`count(*)`,
								errorCalls: sql<number>`count(*) filter (where ${apiUsageEvents.statusCode} >= 400)`,
								avgDurationMs: sql<number>`round(avg(${apiUsageEvents.durationMs}) filter (where ${apiUsageEvents.durationMs} is not null))`,
							})
							.from(apiUsageEvents)
							.where(eq(apiUsageEvents.orgId, orgId)),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				// Top endpoints
				Effect.tryPromise({
					try: () =>
						db
							.select({
								endpoint: apiUsageEvents.endpoint,
								count: sql<number>`count(*)`,
							})
							.from(apiUsageEvents)
							.where(eq(apiUsageEvents.orgId, orgId))
							.groupBy(apiUsageEvents.endpoint)
							.orderBy(sql`count(*) desc`)
							.limit(5),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				// Daily breakdown — last 7 days
				Effect.tryPromise({
					try: () =>
						db
							.select({
								date: sql<string>`to_char(date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
								count: sql<number>`count(*)`,
							})
							.from(apiUsageEvents)
							.where(
								and(
									eq(apiUsageEvents.orgId, orgId),
									gte(apiUsageEvents.createdAt, sevenDaysAgo),
								),
							)
							.groupBy(sql`date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC')`)
							.orderBy(sql`date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC')`),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			const agg = aggRow[0]
			const totalCalls = Number(agg?.totalCalls ?? 0)
			const errorCalls = Number(agg?.errorCalls ?? 0)
			const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0

			return {
				callsToday: Number(agg?.callsToday ?? 0),
				callsThisMonth: Number(agg?.callsThisMonth ?? 0),
				rateLimitHits: Number(agg?.rateLimitHits ?? 0),
				avgDurationMs: agg?.avgDurationMs != null ? Number(agg.avgDurationMs) : null,
				errorRate: Math.round(errorRate * 100) / 100,
				topEndpoints: topEndpointsRows.map((r) => ({
					endpoint: r.endpoint,
					count: Number(r.count),
				})),
				daily: dailyRows.map((r) => ({ date: r.date, count: Number(r.count) })),
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// ─── GET /enterprise/orgs/me ─────────────────────────────────────────────────

enterpriseRoutes.get('/orgs/me', async (c) => {
	const userId = await resolveUserId(c)
	if (!userId) return c.json({ error: 'User not found' }, 401)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			// Find the first org this user belongs to
			const membership = yield* Effect.tryPromise({
				try: () =>
					db.query.organizationMembers.findFirst({
						where: eq(organizationMembers.userId, userId),
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			if (!membership) throw new Error('No organization found')

			const org = yield* Effect.tryPromise({
				try: () =>
					db.query.organizations.findFirst({
						where: eq(organizations.id, membership.organizationId),
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			if (!org) throw new Error('No organization found')

			return { org, role: membership.role }
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'No organization found') return c.json({ error: err.message }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})
