/**
 * `/v1/orgs/:orgId/bots` — the dashboard's bot-factory API.
 *
 * Mirrors `enterprise.ts` for auth: flexAuth (initData, bearer JWT, or the
 * parent-domain session cookie) plus an explicit org-membership check per
 * request. Reads need any membership; anything that changes a bot, spends
 * money, or touches a token needs owner/admin.
 *
 * Deliberately NOT behind `requireTier('enterprise')`. The people this is for —
 * a meme-coin team that wants a buy-and-burn bot by lunchtime — are not on an
 * enterprise contract, and gating the factory behind one would leave the
 * feature unused. Spend safety comes from the automation caps and the
 * simulate-first default, not from the price of the plan.
 */
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import { EnvService } from '../config/EnvService'
import {
	organizationMembers,
	requireDb,
	tenantBotAutomations,
	tenantBotRuns,
	tenantBots,
} from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'
import { TenantBotExecutor } from '../services/TenantBotExecutorService'
import { TenantBotService, toSummary } from '../services/TenantBotService'
import { nextRunAfter } from '../services/tenantBots/cron'
import { BURN_SINKS, STABLE_SPEND_TOKENS } from '../services/tenantBots/executor'
import {
	AUTOMATION_KINDS,
	composeBlueprint,
	SKILL_CATALOG,
} from '../services/tenantBots/blueprint'

export const tenantBotRoutes = new Hono()

tenantBotRoutes.use('*', flexAuth())

// ─── auth helpers (same resolution order as enterprise.ts) ──────────────────

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
	return Either.isLeft(result) ? null : result.right
}

const WRITE_ROLES = ['owner', 'admin']
const READ_ROLES = ['owner', 'admin', 'member', 'viewer']

async function requireMember(
	c: any,
	orgId: string,
	roles: string[],
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
	if (!roles.includes(result.right.role)) return null
	return { userId, role: result.right.role }
}

function respond(c: any, result: Either.Either<unknown, unknown>, key: string) {
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, [key]: result.right })
}

// ─── catalogue ─────────────────────────────────────────────────────────────

/** What the composer can build. The dashboard renders its skill picker from
 *  this rather than hard-coding a list that drifts from the runtime's. */
tenantBotRoutes.get('/skills', (c) =>
	c.json({
		success: true,
		skills: Object.entries(SKILL_CATALOG).map(([key, description]) => ({ key, description })),
		automation_kinds: AUTOMATION_KINDS,
		burn_addresses: [...BURN_SINKS],
		spend_tokens: [...STABLE_SPEND_TOKENS],
	}),
)

// ─── compose: brief → blueprint (no writes) ────────────────────────────────

const ComposeSchema = z.object({
	brief: z.string().min(1).max(4000),
	project_name: z.string().max(120).optional(),
	token_symbol: z.string().max(32).optional(),
	token_chain: z.string().max(32).optional(),
	token_address: z.string().max(100).optional(),
})

/** Preview endpoint: returns a blueprint without creating anything, so the
 *  operator can iterate on wording before a row exists. */
tenantBotRoutes.post('/:orgId/bots/compose', async (c) => {
	const orgId = c.req.param('orgId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) {
		return c.json({ error: 'Forbidden' }, 403)
	}
	const parsed = ComposeSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
	const p = parsed.data

	const keyResult = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			return env.ANTHROPIC_API_KEY
		}),
	)
	const apiKey = Either.isRight(keyResult) ? keyResult.right : undefined

	const blueprint = await composeBlueprint(
		{
			brief: p.brief,
			projectName: p.project_name,
			tokenSymbol: p.token_symbol,
			tokenChain: p.token_chain,
			tokenAddress: p.token_address,
		},
		{ apiKey },
	)
	return c.json({ success: true, blueprint })
})

// ─── bots CRUD ─────────────────────────────────────────────────────────────

tenantBotRoutes.get('/:orgId/bots', async (c) => {
	const orgId = c.req.param('orgId')
	if (!(await requireMember(c, orgId, READ_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			const rows = yield* svc.list(orgId)
			return rows.map(toSummary)
		}),
	)
	return respond(c, result, 'bots')
})

const CreateBotSchema = z.object({
	name: z.string().min(1).max(120),
	slug: z.string().max(80).optional(),
	brief: z.string().max(4000).optional(),
	token_symbol: z.string().max(32).optional(),
	token_chain: z.string().max(32).optional(),
	token_address: z.string().max(100).optional(),
	/** A blueprint from /compose. When present its skills/branding/automations
	 *  are materialised with the bot in one call — the composer's whole point is
	 *  that the operator does not then hand-enter what it just decided. */
	blueprint: z.record(z.string(), z.any()).optional(),
})

tenantBotRoutes.post('/:orgId/bots', async (c) => {
	const orgId = c.req.param('orgId')
	const member = await requireMember(c, orgId, WRITE_ROLES)
	if (!member) return c.json({ error: 'Forbidden' }, 403)
	const parsed = CreateBotSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
	const p = parsed.data
	const bp = (p.blueprint ?? {}) as Record<string, any>

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			const bot = yield* svc.create({
				organizationId: orgId,
				createdBy: member.userId,
				name: p.name,
				slug: p.slug,
				brief: p.brief,
				branding: bp.branding,
				skills: Array.isArray(bp.skills) ? bp.skills : [],
				blueprint: p.blueprint,
				tokenChain: p.token_chain,
				tokenAddress: p.token_address,
				tokenSymbol: p.token_symbol,
			})

			// Materialise the blueprint's automations. They arrive disabled and in
			// simulate mode (sanitizeBlueprint guarantees it), so this creates
			// reviewable rows, not running jobs.
			const proposed = Array.isArray(bp.automations) ? bp.automations : []
			for (const a of proposed.slice(0, 6)) {
				yield* svc
					.upsertAutomation(orgId, bot.id, {
						kind: a.kind,
						name: a.name,
						cron: a.cron ?? null,
						mode: 'simulate',
						enabled: false,
						config: a.config ?? {},
						maxUsdPerRun: a.maxUsdPerRun ?? 0,
						maxUsdPerDay: a.maxUsdPerDay ?? 0,
						createdBy: member.userId,
					})
					// One bad proposal must not lose the bot that was already created.
					.pipe(Effect.catchAll(() => Effect.succeed(null)))
			}
			return toSummary(bot)
		}),
	)
	return respond(c, result, 'bot')
})

tenantBotRoutes.get('/:orgId/bots/:botId', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, READ_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			const bot = yield* svc.get(orgId, botId)
			const automations = yield* svc.listAutomations(botId)
			const db = yield* requireDb
			const runs = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tenantBotRuns)
						.where(eq(tenantBotRuns.botId, botId))
						.orderBy(desc(tenantBotRuns.startedAt))
						.limit(25),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return {
				...toSummary(bot),
				automations: automations.map((a) => ({
					id: a.id,
					kind: a.kind,
					name: a.name,
					mode: a.mode,
					enabled: a.enabled,
					cron: a.cron,
					config: a.config,
					max_usd_per_run: a.maxUsdPerRun,
					max_usd_per_day: a.maxUsdPerDay,
					last_run_at: a.lastRunAt ? a.lastRunAt.toISOString() : null,
					next_run_at: a.nextRunAt ? a.nextRunAt.toISOString() : null,
					consecutive_failures: a.consecutiveFailures,
				})),
				runs: runs.map((r) => ({
					id: r.id,
					automation_id: r.automationId,
					status: r.status,
					reason: r.reason,
					spend_usd: r.spendUsd,
					token_amount: r.tokenAmount,
					tx_hash: r.txHash,
					started_at: r.startedAt.toISOString(),
					finished_at: r.finishedAt ? r.finishedAt.toISOString() : null,
				})),
			}
		}),
	)
	return respond(c, result, 'bot')
})

const UpdateBotSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	brief: z.string().max(4000).optional(),
	branding: z.record(z.string(), z.any()).optional(),
	skills: z.array(z.object({ key: z.string(), enabled: z.boolean() })).optional(),
	token_symbol: z.string().max(32).optional(),
	token_chain: z.string().max(32).optional(),
	token_address: z.string().max(100).optional(),
})

tenantBotRoutes.patch('/:orgId/bots/:botId', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const parsed = UpdateBotSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
	const p = parsed.data
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			const bot = yield* svc.update(orgId, botId, {
				name: p.name,
				brief: p.brief,
				branding: p.branding as never,
				skills: p.skills as never,
				tokenSymbol: p.token_symbol,
				tokenChain: p.token_chain,
				tokenAddress: p.token_address,
			})
			return toSummary(bot)
		}),
	)
	return respond(c, result, 'bot')
})

tenantBotRoutes.delete('/:orgId/bots/:botId', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			yield* svc.remove(orgId, botId)
			return { deleted: true }
		}),
	)
	return respond(c, result, 'result')
})

// ─── provisioning ──────────────────────────────────────────────────────────

const ProvisionSchema = z.object({ token: z.string().min(20).max(200) })

/** Attach a BotFather token and go live. The token is verified against
 *  Telegram before it is stored — see TenantBotService.provision. */
tenantBotRoutes.post('/:orgId/bots/:botId/provision', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const parsed = ProvisionSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: 'A bot token is required' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const svc = yield* TenantBotService
			const bot = yield* svc.provision(
				orgId,
				botId,
				parsed.data.token,
				env.TENANT_BOT_WEBHOOK_BASE_URL,
			)
			return toSummary(bot)
		}),
	)
	return respond(c, result, 'bot')
})

tenantBotRoutes.post('/:orgId/bots/:botId/pause', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const paused = c.req.query('resume') !== 'true'
	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const svc = yield* TenantBotService
			const bot = yield* svc.setPaused(orgId, botId, paused, env.TENANT_BOT_WEBHOOK_BASE_URL)
			return toSummary(bot)
		}),
	)
	return respond(c, result, 'bot')
})

// ─── automations ───────────────────────────────────────────────────────────

const AutomationSchema = z.object({
	id: z.string().uuid().optional(),
	kind: z.enum(AUTOMATION_KINDS),
	name: z.string().min(1).max(120),
	cron: z.string().max(64).nullable().optional(),
	mode: z.enum(['simulate', 'live']).optional(),
	enabled: z.boolean().optional(),
	config: z.record(z.string(), z.any()).optional(),
	max_usd_per_run: z.number().int().min(0).max(100_000).optional(),
	max_usd_per_day: z.number().int().min(0).max(1_000_000).optional(),
})

tenantBotRoutes.post('/:orgId/bots/:botId/automations', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	const member = await requireMember(c, orgId, WRITE_ROLES)
	if (!member) return c.json({ error: 'Forbidden' }, 403)
	const parsed = AutomationSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
	const p = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const svc = yield* TenantBotService
			const row = yield* svc.upsertAutomation(orgId, botId, {
				id: p.id,
				kind: p.kind,
				name: p.name,
				cron: p.cron ?? null,
				mode: p.mode,
				enabled: p.enabled,
				config: p.config ?? {},
				maxUsdPerRun: p.max_usd_per_run,
				maxUsdPerDay: p.max_usd_per_day,
				createdBy: member.userId,
			})

			// Schedule it. An enabled automation with a valid cron gets a concrete
			// next_run_at here; a disabled one is parked at null so the due-scan
			// never sees it at all.
			const next = row.enabled ? nextRunAfter(row.cron, new Date()) : null
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(tenantBotAutomations)
						.set({ nextRunAt: next })
						.where(eq(tenantBotAutomations.id, row.id)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const spent = yield* svc.spendLast24h(row.id)
			return {
				id: row.id,
				kind: row.kind,
				name: row.name,
				mode: row.mode,
				enabled: row.enabled,
				cron: row.cron,
				config: row.config,
				max_usd_per_run: row.maxUsdPerRun,
				max_usd_per_day: row.maxUsdPerDay,
				next_run_at: next ? next.toISOString() : null,
				spent_usd_24h: spent,
			}
		}),
	)
	return respond(c, result, 'automation')
})

tenantBotRoutes.delete('/:orgId/bots/:botId/automations/:automationId', async (c) => {
	const orgId = c.req.param('orgId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* TenantBotService
			yield* svc.deleteAutomation(orgId, c.req.param('automationId'))
			return { deleted: true }
		}),
	)
	return respond(c, result, 'result')
})

// ─── running an automation ─────────────────────────────────────────────────

/**
 * Run one automation right now.
 *
 * Defaults to a dry run, and a dry run is allowed even on a switched-off
 * automation — that is precisely how an operator decides whether to arm it.
 * A live run from this endpoint requires the automation to already be armed
 * (mode `live` AND enabled), so this button can never be the thing that turns
 * a rehearsal into a spend; `POST .../arm` is, and it says so.
 */
tenantBotRoutes.post('/:orgId/bots/:botId/automations/:automationId/run', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	const automationId = c.req.param('automationId')
	if (!(await requireMember(c, orgId, WRITE_ROLES))) return c.json({ error: 'Forbidden' }, 403)

	// Opting IN to a live run has to be explicit in the request, and even then
	// the automation's own armed state decides.
	const wantsLive = c.req.query('live') === 'true'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			// Ownership: the automation must belong to a bot in the caller's org.
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ id: tenantBotAutomations.id })
						.from(tenantBotAutomations)
						.where(
							and(
								eq(tenantBotAutomations.id, automationId),
								eq(tenantBotAutomations.botId, botId),
								eq(tenantBotAutomations.organizationId, orgId),
							),
						)
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!rows[0]) return yield* Effect.fail(new Error('Automation not found'))

			const exec = yield* TenantBotExecutor
			return yield* exec.runAutomation(automationId, {
				manual: true,
				forceSimulate: !wantsLive,
			})
		}),
	)
	return respond(c, result, 'run')
})

/**
 * Arm or disarm an automation — the only path from rehearsal to real money.
 *
 * Separate from the ordinary automation upsert on purpose. Flipping mode to
 * `live` is the single most consequential action in this whole feature, and it
 * should be one deliberate call that can be logged, rate-limited and reasoned
 * about, not a field buried in a PATCH body alongside a rename.
 *
 * Arming requires at least one simulated run on record. An operator who has
 * never seen what the automation does cannot switch it on, which turns the
 * simulate-first default from a suggestion into a precondition.
 */
tenantBotRoutes.post('/:orgId/bots/:botId/automations/:automationId/arm', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	const automationId = c.req.param('automationId')
	const member = await requireMember(c, orgId, ['owner', 'admin'])
	if (!member) return c.json({ error: 'Forbidden' }, 403)

	const body = (await c.req.json().catch(() => ({}))) as { live?: boolean }
	const goLive = body.live === true

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tenantBotAutomations)
						.where(
							and(
								eq(tenantBotAutomations.id, automationId),
								eq(tenantBotAutomations.botId, botId),
								eq(tenantBotAutomations.organizationId, orgId),
							),
						)
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const automation = rows[0]
			if (!automation) return yield* Effect.fail(new Error('Automation not found'))

			if (goLive) {
				const seen = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ id: tenantBotRuns.id })
							.from(tenantBotRuns)
							.where(
								and(
									eq(tenantBotRuns.automationId, automationId),
									eq(tenantBotRuns.status, 'simulated'),
								),
							)
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
				if (!seen[0]) {
					return yield* Effect.fail(
						new Error('Run it once in simulate mode first, then arm it.'),
					)
				}

				const botRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ treasury: tenantBots.treasuryAddress, status: tenantBots.status })
							.from(tenantBots)
							.where(eq(tenantBots.id, botId))
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
				if (!botRows[0]?.treasury) {
					return yield* Effect.fail(new Error('Connect a treasury wallet before arming.'))
				}
			}

			// Arming resets the failure counter: the operator has looked at it.
			const next = goLive ? nextRunAfter(automation.cron, new Date()) : null
			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(tenantBotAutomations)
						.set({
							mode: goLive ? 'live' : 'simulate',
							enabled: goLive,
							nextRunAt: next,
							consecutiveFailures: 0,
							updatedAt: new Date(),
						})
						.where(eq(tenantBotAutomations.id, automationId))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const row = updated[0]
			return {
				id: row.id,
				mode: row.mode,
				enabled: row.enabled,
				next_run_at: row.nextRunAt ? row.nextRunAt.toISOString() : null,
			}
		}),
	)
	return respond(c, result, 'automation')
})

// ─── treasury ──────────────────────────────────────────────────────────────

const TreasurySchema = z.object({
	address: z.string().min(10).max(100),
	internal_user_id: z.number().int().positive().optional(),
	internal_wallet_id: z.number().int().positive().optional(),
})

/**
 * Point the bot at the wallet its automations spend from.
 *
 * We never take a private key. The address is the org's, funded by the org;
 * the internal ids are what the custodial signing path needs and only exist
 * for a wallet that was provisioned through it. Without them a bot can still
 * simulate freely — which is the useful half for most people — and simply
 * cannot go live.
 */
tenantBotRoutes.post('/:orgId/bots/:botId/treasury', async (c) => {
	const orgId = c.req.param('orgId')
	const botId = c.req.param('botId')
	if (!(await requireMember(c, orgId, ['owner', 'admin']))) return c.json({ error: 'Forbidden' }, 403)
	const parsed = TreasurySchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
	const p = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const svc = yield* TenantBotService
			yield* svc.get(orgId, botId)
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.update(tenantBots)
						.set({
							treasuryAddress: p.address.trim(),
							treasuryInternalUserId: p.internal_user_id ?? null,
							treasuryInternalWalletId: p.internal_wallet_id ?? null,
							updatedAt: new Date(),
						})
						.where(eq(tenantBots.id, botId))
						.returning(),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const row = rows[0]
			return {
				treasury_address: row.treasuryAddress,
				can_execute_live: Boolean(row.treasuryInternalWalletId && row.treasuryInternalUserId),
			}
		}),
	)
	return respond(c, result, 'treasury')
})

// ─── admin ─────────────────────────────────────────────────────────────────

/**
 * Operator-facing driver for the automation tick.
 *
 * Mounted under /admin (X-Admin-Key) and exported separately so it never
 * inherits the org router's flexAuth. Useful when the in-process scheduler is
 * off and something external — a Railway cron, an on-call human — should drive
 * the loop instead.
 */
export const tenantBotAdminRoutes = new Hono()

tenantBotAdminRoutes.post('/run-due', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const exec = yield* TenantBotExecutor
			const runs = yield* exec.runDue()
			return {
				ran: runs.length,
				runs: runs.map((r) => ({
					status: r.status,
					reason: r.reason,
					spend_usd: r.spendUsd,
					tx_hash: r.txHash,
				})),
			}
		}),
	)
	return respond(c, result, 'result')
})
