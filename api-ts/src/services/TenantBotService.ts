/**
 * TenantBotService — the lifecycle of a hosted white-label bot.
 *
 * A tenant bot is live when three things are true: we hold its token, Telegram
 * is pointed at our per-bot webhook, and the row says `live`. This service owns
 * all three transitions and nothing else — command handling happens in the
 * Python runtime, automation execution in the executor.
 *
 * Token handling is the part worth reading. `provision()` is the only path that
 * accepts a raw token; it verifies the token against Telegram's `getMe` before
 * storing anything, so a typo fails at the dashboard instead of becoming a
 * `live` row that never receives an update. The token is then encrypted at rest
 * and the plaintext is never returned by any method on this interface — the
 * runtime reads it through `getDecryptedToken`, which is deliberately not
 * reachable from any org-facing route.
 */
import crypto from 'crypto'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'
import {
	type DrizzleService,
	requireDb,
	tenantBotAutomations,
	tenantBotRuns,
	tenantBots,
	type TenantBot,
	type TenantBotAutomation,
	type TenantBotBranding,
	type TenantBotSkill,
} from '../db'
import { ExternalServiceError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../lib/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const TELEGRAM_API = 'https://api.telegram.org'

function deriveKey(secret: string): Buffer {
	return crypto.createHash('sha256').update(secret).digest()
}

function encrypt(plaintext: string, key: Buffer): { ciphertext: string; nonce: string } {
	const iv = crypto.randomBytes(IV_LENGTH)
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	return {
		ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'),
		nonce: iv.toString('base64'),
	}
}

function decrypt(ciphertext: string, nonce: string, key: Buffer): string {
	const iv = Buffer.from(nonce, 'base64')
	const raw = Buffer.from(ciphertext, 'base64')
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(raw.subarray(raw.length - AUTH_TAG_LENGTH))
	return decipher.update(raw.subarray(0, raw.length - AUTH_TAG_LENGTH)) + decipher.final('utf8')
}

function tokenHash(raw: string): string {
	return crypto.createHash('sha256').update(raw.trim()).digest('hex')
}

/** A BotFather token is `<digits>:<35 url-safe chars>`. Reject anything else
 *  before it reaches the network — most paste errors are caught here. */
const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/

export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'bot'
	)
}

/** Public shape — never carries the token, ciphertext or webhook secret. */
export interface TenantBotSummary {
	id: string
	name: string
	slug: string
	status: TenantBot['status']
	telegram_username: string | null
	token_symbol: string | null
	token_chain: string | null
	token_address: string | null
	branding: TenantBotBranding
	skills: TenantBotSkill[]
	brief: string | null
	last_error: string | null
	messages_handled: number
	provisioned_at: string | null
	created_at: string
}

export function toSummary(row: TenantBot): TenantBotSummary {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		status: row.status,
		telegram_username: row.telegramUsername,
		token_symbol: row.tokenSymbol,
		token_chain: row.tokenChain,
		token_address: row.tokenAddress,
		branding: (row.branding ?? {}) as TenantBotBranding,
		skills: (row.skills ?? []) as TenantBotSkill[],
		brief: row.brief,
		last_error: row.lastError,
		messages_handled: row.messagesHandled,
		provisioned_at: row.provisionedAt ? row.provisionedAt.toISOString() : null,
		created_at: row.createdAt.toISOString(),
	}
}

export interface CreateBotInput {
	organizationId: string
	createdBy: number | null
	name: string
	slug?: string
	brief?: string
	branding?: TenantBotBranding
	skills?: TenantBotSkill[]
	blueprint?: Record<string, unknown>
	tokenChain?: string
	tokenAddress?: string
	tokenSymbol?: string
}

export interface TenantBotServiceInterface {
	readonly list: (orgId: string) => Effect.Effect<TenantBot[], Error, DrizzleService>
	readonly get: (orgId: string, botId: string) => Effect.Effect<TenantBot, Error, DrizzleService>
	readonly create: (input: CreateBotInput) => Effect.Effect<TenantBot, Error, DrizzleService>
	readonly update: (
		orgId: string,
		botId: string,
		patch: Partial<CreateBotInput>,
	) => Effect.Effect<TenantBot, Error, DrizzleService>
	readonly remove: (orgId: string, botId: string) => Effect.Effect<void, Error, DrizzleService>
	/** Accept a raw BotFather token, verify it, store it, point Telegram at us. */
	readonly provision: (
		orgId: string,
		botId: string,
		rawToken: string,
		publicBaseUrl: string,
	) => Effect.Effect<TenantBot, Error, DrizzleService>
	readonly setPaused: (
		orgId: string,
		botId: string,
		paused: boolean,
		publicBaseUrl: string,
	) => Effect.Effect<TenantBot, Error, DrizzleService>
	/** Runtime-only. Not reachable from an org-facing route. */
	readonly getDecryptedToken: (botId: string) => Effect.Effect<string, Error, DrizzleService>
	readonly listAutomations: (
		botId: string,
	) => Effect.Effect<TenantBotAutomation[], Error, DrizzleService>
	readonly upsertAutomation: (
		orgId: string,
		botId: string,
		input: {
			id?: string
			kind: TenantBotAutomation['kind']
			name: string
			cron?: string | null
			mode?: TenantBotAutomation['mode']
			enabled?: boolean
			config?: Record<string, unknown>
			maxUsdPerRun?: number
			maxUsdPerDay?: number
			createdBy?: number | null
		},
	) => Effect.Effect<TenantBotAutomation, Error, DrizzleService>
	readonly deleteAutomation: (
		orgId: string,
		automationId: string,
	) => Effect.Effect<void, Error, DrizzleService>
	/** USD already committed by this automation in the trailing 24h, counting
	 *  simulated runs — a dry run that would have breached the cap must still
	 *  show up as a breach when the operator flips to live. */
	readonly spendLast24h: (automationId: string) => Effect.Effect<number, Error, DrizzleService>
}

export class TenantBotService extends Context.Tag('TenantBotService')<
	TenantBotService,
	TenantBotServiceInterface
>() {}

export const TenantBotServiceLive = Layer.effect(
	TenantBotService,
	Effect.gen(function* () {
		const env = yield* EnvService

		const getKey = (): Buffer => {
			const material = env.TENANT_BOT_ENC_KEY
			if (!material) {
				throw new Error(
					'TENANT_BOT_ENC_KEY not configured — refusing to store bot tokens in plaintext',
				)
			}
			return deriveKey(material)
		}

		const telegram = <T>(token: string, method: string, body?: unknown) =>
			Effect.tryPromise({
				try: async (): Promise<T> => {
					const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body ?? {}),
						signal: AbortSignal.timeout(10_000),
					})
					const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
					if (!json.ok) {
						throw new Error(json.description || `Telegram ${method} failed (${res.status})`)
					}
					return json.result as T
				},
				catch: (e) =>
					new ExternalServiceError({
						service: 'telegram',
						message: e instanceof Error ? e.message : String(e),
					}),
			})

		const fetchRow = (orgId: string, botId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(tenantBots)
							.where(and(eq(tenantBots.id, botId), eq(tenantBots.organizationId, orgId)))
							.limit(1),
					catch: (e) => new Error(`Failed to load bot: ${e}`),
				})
				if (!rows[0]) return yield* Effect.fail(new NotFoundError({ resource: 'bot', message: `Bot ${botId} not found` }))
				return rows[0]
			})

		const list = (orgId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(tenantBots)
							.where(eq(tenantBots.organizationId, orgId))
							.orderBy(desc(tenantBots.createdAt)),
					catch: (e) => new Error(`Failed to list bots: ${e}`),
				})
			})

		const create = (input: CreateBotInput) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const name = input.name.trim()
				if (!name) {
					return yield* Effect.fail(
						new ValidationError({ message: 'name is required', fields: { name: 'required' } }),
					)
				}
				const baseSlug = slugify(input.slug || name)
				// Slugs are unique per org, so a second "Burn Bot" gets a suffix
				// rather than a 500 the operator has to interpret.
				const existing = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ slug: tenantBots.slug })
							.from(tenantBots)
							.where(eq(tenantBots.organizationId, input.organizationId)),
					catch: (e) => new Error(`Failed to check slugs: ${e}`),
				})
				const taken = new Set(existing.map((r) => r.slug))
				let slug = baseSlug
				for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`

				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(tenantBots)
							.values({
								organizationId: input.organizationId,
								createdBy: input.createdBy ?? null,
								name,
								slug,
								brief: input.brief ?? null,
								branding: (input.branding ?? { displayName: name }) as TenantBotBranding,
								skills: (input.skills ?? []) as TenantBotSkill[],
								blueprint: input.blueprint ?? null,
								tokenChain: input.tokenChain ?? null,
								tokenAddress: input.tokenAddress ?? null,
								tokenSymbol: input.tokenSymbol ?? null,
							})
							.returning(),
					catch: (e) => new Error(`Failed to create bot: ${e}`),
				})
				return rows[0]
			})

		const update = (orgId: string, botId: string, patch: Partial<CreateBotInput>) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* fetchRow(orgId, botId)
				const set: Record<string, unknown> = { updatedAt: new Date() }
				if (patch.name !== undefined) set.name = patch.name.trim()
				if (patch.brief !== undefined) set.brief = patch.brief
				if (patch.branding !== undefined) set.branding = patch.branding
				if (patch.skills !== undefined) set.skills = patch.skills
				if (patch.blueprint !== undefined) set.blueprint = patch.blueprint
				if (patch.tokenChain !== undefined) set.tokenChain = patch.tokenChain
				if (patch.tokenAddress !== undefined) set.tokenAddress = patch.tokenAddress
				if (patch.tokenSymbol !== undefined) set.tokenSymbol = patch.tokenSymbol
				const rows = yield* Effect.tryPromise({
					try: () =>
						db.update(tenantBots).set(set).where(eq(tenantBots.id, botId)).returning(),
					catch: (e) => new Error(`Failed to update bot: ${e}`),
				})
				return rows[0]
			})

		const remove = (orgId: string, botId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const row = yield* fetchRow(orgId, botId)
				// Best-effort: unhook Telegram before the row goes away, otherwise
				// the bot keeps POSTing at a webhook that 404s forever.
				if (row.botTokenCiphertext && row.botTokenNonce) {
					const token = decrypt(row.botTokenCiphertext, row.botTokenNonce, getKey())
					yield* telegram(token, 'deleteWebhook').pipe(
						Effect.catchAll((e) =>
							Effect.sync(() => logger.warn({ err: String(e), botId }, 'deleteWebhook failed')),
						),
					)
				}
				yield* Effect.tryPromise({
					try: () => db.delete(tenantBots).where(eq(tenantBots.id, botId)),
					catch: (e) => new Error(`Failed to delete bot: ${e}`),
				})
			})

		const provision = (orgId: string, botId: string, rawToken: string, publicBaseUrl: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* fetchRow(orgId, botId)
				const token = rawToken.trim()
				if (!TOKEN_RE.test(token)) {
					return yield* Effect.fail(
						new ValidationError({
							message: 'That does not look like a BotFather token (expected 123456:ABC-...)',
							fields: { token: 'malformed' },
						}),
					)
				}

				// Verify before storing. A revoked or mistyped token fails here.
				const me = yield* telegram<{ id: number; username: string }>(token, 'getMe')

				const secret = crypto.randomBytes(24).toString('hex')
				const webhookUrl = `${publicBaseUrl.replace(/\/+$/, '')}/telegram/tbot/${botId}`
				yield* telegram(token, 'setWebhook', {
					url: webhookUrl,
					secret_token: secret,
					allowed_updates: ['message', 'callback_query', 'my_chat_member'],
					drop_pending_updates: true,
				})

				const enc = encrypt(token, getKey())
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.update(tenantBots)
							.set({
								telegramBotId: me.id,
								telegramUsername: me.username,
								botTokenCiphertext: enc.ciphertext,
								botTokenNonce: enc.nonce,
								botTokenHash: tokenHash(token),
								webhookSecret: secret,
								status: 'live',
								lastError: null,
								provisionedAt: new Date(),
								updatedAt: new Date(),
							})
							.where(eq(tenantBots.id, botId))
							.returning(),
					catch: (e) => new Error(`Failed to store bot credentials: ${e}`),
				})
				logger.info({ botId, username: me.username }, 'tenant bot provisioned')
				return rows[0]
			})

		const setPaused = (orgId: string, botId: string, paused: boolean, publicBaseUrl: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const row = yield* fetchRow(orgId, botId)
				if (!row.botTokenCiphertext || !row.botTokenNonce || !row.webhookSecret) {
					return yield* Effect.fail(
						new ValidationError({ message: 'Bot has no token yet', fields: { token: 'missing' } }),
					)
				}
				const token = decrypt(row.botTokenCiphertext, row.botTokenNonce, getKey())
				if (paused) {
					yield* telegram(token, 'deleteWebhook')
				} else {
					yield* telegram(token, 'setWebhook', {
						url: `${publicBaseUrl.replace(/\/+$/, '')}/telegram/tbot/${botId}`,
						secret_token: row.webhookSecret,
						allowed_updates: ['message', 'callback_query', 'my_chat_member'],
					})
				}
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.update(tenantBots)
							.set({ status: paused ? 'paused' : 'live', updatedAt: new Date() })
							.where(eq(tenantBots.id, botId))
							.returning(),
					catch: (e) => new Error(`Failed to update bot status: ${e}`),
				})
				return rows[0]
			})

		const getDecryptedToken = (botId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({
								ct: tenantBots.botTokenCiphertext,
								nonce: tenantBots.botTokenNonce,
							})
							.from(tenantBots)
							.where(eq(tenantBots.id, botId))
							.limit(1),
					catch: (e) => new Error(`Failed to load bot token: ${e}`),
				})
				const row = rows[0]
				if (!row?.ct || !row.nonce) {
					return yield* Effect.fail(new NotFoundError({ resource: 'bot_token', message: `Bot ${botId} has no stored token` }))
				}
				return decrypt(row.ct, row.nonce, getKey())
			})

		const listAutomations = (botId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(tenantBotAutomations)
							.where(eq(tenantBotAutomations.botId, botId))
							.orderBy(desc(tenantBotAutomations.createdAt)),
					catch: (e) => new Error(`Failed to list automations: ${e}`),
				})
			})

		const upsertAutomation = (
			orgId: string,
			botId: string,
			input: Parameters<TenantBotServiceInterface['upsertAutomation']>[2],
		) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* fetchRow(orgId, botId)

				// A cap of zero means "no cap", which for something that spends money
				// is the wrong default to allow through an API. Require a positive
				// per-run cap on anything that can broadcast.
				const spends = input.kind === 'buy_and_burn' || input.kind === 'buyback'
				const perRun = input.maxUsdPerRun ?? 0
				if (spends && perRun <= 0) {
					return yield* Effect.fail(
						new ValidationError({
							message: 'A spending automation needs a positive per-run USD cap',
							fields: { maxUsdPerRun: 'must be > 0' },
						}),
					)
				}
				const perDay = input.maxUsdPerDay ?? perRun
				if (spends && perDay < perRun) {
					return yield* Effect.fail(
						new ValidationError({
							message: 'Daily cap cannot be lower than the per-run cap',
							fields: { maxUsdPerDay: 'must be >= maxUsdPerRun' },
						}),
					)
				}

				const values = {
					botId,
					organizationId: orgId,
					kind: input.kind,
					name: input.name.trim() || input.kind,
					mode: input.mode ?? ('simulate' as const),
					enabled: input.enabled ?? false,
					cron: input.cron ?? null,
					config: input.config ?? {},
					maxUsdPerRun: Math.floor(perRun),
					maxUsdPerDay: Math.floor(perDay),
					createdBy: input.createdBy ?? null,
					updatedAt: new Date(),
				}

				if (input.id) {
					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.update(tenantBotAutomations)
								.set(values)
								.where(
									and(
										eq(tenantBotAutomations.id, input.id as string),
										eq(tenantBotAutomations.botId, botId),
									),
								)
								.returning(),
						catch: (e) => new Error(`Failed to update automation: ${e}`),
					})
					if (!rows[0]) {
						return yield* Effect.fail(
							new NotFoundError({ resource: 'automation', message: `Automation ${input.id} not found` }),
						)
					}
					return rows[0]
				}

				const rows = yield* Effect.tryPromise({
					try: () => db.insert(tenantBotAutomations).values(values).returning(),
					catch: (e) => new Error(`Failed to create automation: ${e}`),
				})
				return rows[0]
			})

		const deleteAutomation = (orgId: string, automationId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db
							.delete(tenantBotAutomations)
							.where(
								and(
									eq(tenantBotAutomations.id, automationId),
									eq(tenantBotAutomations.organizationId, orgId),
								),
							),
					catch: (e) => new Error(`Failed to delete automation: ${e}`),
				})
			})

		const spendLast24h = (automationId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ total: sql<number>`coalesce(sum(${tenantBotRuns.spendUsd}), 0)` })
							.from(tenantBotRuns)
							.where(
								and(
									eq(tenantBotRuns.automationId, automationId),
									gte(tenantBotRuns.startedAt, since),
									sql`${tenantBotRuns.status} in ('succeeded', 'simulated')`,
								),
							),
					catch: (e) => new Error(`Failed to sum automation spend: ${e}`),
				})
				return Number(rows[0]?.total ?? 0)
			})

		return {
			list,
			get: fetchRow,
			create,
			update,
			remove,
			provision,
			setPaused,
			getDecryptedToken,
			listAutomations,
			upsertAutomation,
			deleteAutomation,
			spendLast24h,
		} satisfies TenantBotServiceInterface
	}),
)
