/**
 * Tenant bots — white-label Telegram bots that an organisation spins up from
 * the dashboard and Suwappu hosts.
 *
 * The unit of tenancy is a row in `tenant_bots`: one BotFather token, one
 * webhook URL, one branding blob, one set of enabled skills. Everything the
 * hosted runtime needs to serve a community is reachable from that row, so a
 * new bot going live is an INSERT plus a `setWebhook` call — no deploy, no new
 * service, no code.
 *
 * Two rules the schema is built around:
 *
 * 1. **The token is a credential, never a column you can read.** It lives in
 *    `bot_token_ciphertext` (AES-256-GCM, key from TENANT_BOT_ENC_KEY) with the
 *    nonce beside it. `bot_token_hash` exists only so we can reject the same
 *    token being registered twice without decrypting anything.
 * 2. **Automations are money-path and default to dry-run.** A `buy_and_burn`
 *    row is a standing instruction to spend a treasury's funds on a schedule.
 *    `mode` starts at `'simulate'`, every attempt writes a `tenant_bot_runs`
 *    row whether or not it broadcast, and the per-run and per-day USD caps are
 *    enforced by the executor against those rows — not against a counter that
 *    a restart would reset.
 */
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { users } from './users'

/** Where an automation's money comes from. See tenantBots.fundingSource. */
export const tenantBotFundingEnum = pgEnum('tenant_bot_funding', [
	'revenue', // recurring protocol/product fees — durable
	'treasury', // a finite pot — honest, but it runs out
	'undisclosed', // the default: we will not guess on a team's behalf
])

export const tenantBotStatusEnum = pgEnum('tenant_bot_status', [
	'draft', // composed in the dashboard, no token attached yet
	'provisioning', // token accepted, webhook registration in flight
	'live',
	'paused', // webhook deleted on purpose; row and config intact
	'error', // Telegram rejected us (revoked token, webhook 4xx)
])

export const tenantBotAutomationKindEnum = pgEnum('tenant_bot_automation_kind', [
	'buy_and_burn', // swap treasury funds into the project token, send to a burn address
	'buyback', // same swap, tokens stay in the treasury wallet
	'reward_drip', // periodic payout to a holder/leaderboard list
	'price_post', // scheduled price/volume post to the community chat
	'holder_report', // scheduled supply/burn/holder summary
])

export const tenantBotAutomationModeEnum = pgEnum('tenant_bot_automation_mode', [
	'simulate', // quote and journal only — never broadcasts. The default.
	'live',
])

export const tenantBotRunStatusEnum = pgEnum('tenant_bot_run_status', [
	'simulated',
	'succeeded',
	'failed',
	'skipped', // a guard said no (cap hit, budget empty, paused mid-flight)
])

/** Branding is what makes the bot theirs rather than ours. */
export interface TenantBotBranding {
	displayName: string
	tagline?: string
	/** Emoji or short mark prefixed to bot replies. */
	mark?: string
	accentColor?: string
	/** Replaces the Suwappu footer on every message this bot sends. */
	footer?: string
	/** Community links surfaced by /start. */
	links?: { label: string; url: string }[]
	/** Free-text voice note the runtime prepends to generated copy. */
	voice?: string
}

/** One enabled capability module plus its per-bot configuration. */
export interface TenantBotSkill {
	/** e.g. 'swap' | 'price' | 'chart' | 'buy_and_burn' | 'holders' | 'raid' */
	key: string
	enabled: boolean
	config?: Record<string, unknown>
}

export const tenantBots = pgTable(
	'tenant_bots',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		organizationId: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),

		/** Human name in the dashboard. Not necessarily the Telegram name. */
		name: varchar('name', { length: 120 }).notNull(),
		/** URL-safe handle, unique per org — used in dashboard deep links. */
		slug: varchar('slug', { length: 80 }).notNull(),

		// ── Telegram identity (populated at provision time from getMe) ──
		telegramBotId: bigint('telegram_bot_id', { mode: 'number' }),
		telegramUsername: varchar('telegram_username', { length: 64 }),

		// ── Credential. See rule 1 in the file docstring. ──
		botTokenCiphertext: text('bot_token_ciphertext'),
		botTokenNonce: varchar('bot_token_nonce', { length: 64 }),
		/** sha256 of the raw token — dedupe only, never an auth check. */
		botTokenHash: varchar('bot_token_hash', { length: 64 }),
		/** Sent by Telegram as X-Telegram-Bot-Api-Secret-Token on every update. */
		webhookSecret: varchar('webhook_secret', { length: 64 }),

		status: tenantBotStatusEnum('status').default('draft').notNull(),
		/** Last thing Telegram or the runtime complained about. */
		lastError: text('last_error'),

		branding: jsonb('branding').$type<TenantBotBranding>().notNull().default({} as TenantBotBranding),
		skills: jsonb('skills').$type<TenantBotSkill[]>().notNull().default([]),

		/** The natural-language brief the operator typed, kept so the blueprint
		 *  can be re-derived and diffed when the composer improves. */
		brief: text('brief'),
		/** The blueprint the composer produced from that brief, verbatim. */
		blueprint: jsonb('blueprint').$type<Record<string, unknown>>(),

		/** Project token this bot is about — drives price/burn/holder skills. */
		tokenChain: varchar('token_chain', { length: 32 }),
		tokenAddress: varchar('token_address', { length: 100 }),
		tokenSymbol: varchar('token_symbol', { length: 32 }),

		// ── Treasury. The wallet an automation spends FROM. ──
		//
		// Provisioned through the same managed-wallet path as agent wallets
		// (Turnkey sub-org + an internal users/wallets row on the Python side),
		// because that is the path `POST /internal/agent/execute-swap` can
		// actually sign with. We never hold a raw key for a tenant: the org funds
		// this address, and the only thing that can move those funds through us is
		// a capped automation.
		treasuryAddress: varchar('treasury_address', { length: 100 }),
		/**
		 * Where the money comes from. This is the single strongest durability
		 * signal in the whole category: research on ~$19B of 2025-26 buyback
		 * programs found revenue-funded programs durable and treasury-funded ones
		 * "motion without much effect", because a treasury is finite. Recorded so
		 * the public proof page can state it rather than let a reader assume the
		 * flattering answer.
		 */
		fundingSource: tenantBotFundingEnum('funding_source').default('undisclosed').notNull(),
		/** Free-text detail, e.g. "0.8% of swap fees" or "seed round treasury". */
		fundingNote: text('funding_note'),
		/**
		 * Opt-in public proof page at /v1/bots/proof/:slug. Off by default — we
		 * publish a team's treasury activity only when they ask us to.
		 */
		proofPublic: boolean('proof_public').default(false).notNull(),
		treasuryInternalUserId: integer('treasury_internal_user_id'),
		treasuryInternalWalletId: integer('treasury_internal_wallet_id'),

		messagesHandled: integer('messages_handled').default(0).notNull(),
		lastUpdateAt: timestamp('last_update_at'),
		provisionedAt: timestamp('provisioned_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		orgSlugUniq: unique('tenant_bots_org_slug_uniq').on(t.organizationId, t.slug),
		tokenHashUniq: unique('tenant_bots_token_hash_uniq').on(t.botTokenHash),
		orgIdx: index('tenant_bots_org_idx').on(t.organizationId),
		statusIdx: index('tenant_bots_status_idx').on(t.status),
	}),
)

/** Config for a `buy_and_burn` / `buyback` automation. */
export interface BurnAutomationConfig {
	/** Chain the swap runs on. */
	chain: string
	/** What we spend (treasury side), e.g. 'USDC' or a token address. */
	spendToken: string
	/** What we buy — normally the bot's project token. */
	buyToken: string
	/** USD spend per run. Hard-capped by `maxUsdPerRun`. */
	amountUsd: number
	/** Wallet the funds come from — an org hot wallet id, not a raw key. */
	sourceWalletId?: string
	/** Where bought tokens go. Omitted for `buyback` (stays in treasury). */
	burnAddress?: string
	maxSlippageBps?: number
	/** Post a receipt to this chat when a run completes. */
	announceChatId?: string
}

export const tenantBotAutomations = pgTable(
	'tenant_bot_automations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		botId: uuid('bot_id')
			.references(() => tenantBots.id, { onDelete: 'cascade' })
			.notNull(),
		organizationId: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		kind: tenantBotAutomationKindEnum('kind').notNull(),
		name: varchar('name', { length: 120 }).notNull(),
		mode: tenantBotAutomationModeEnum('mode').default('simulate').notNull(),
		enabled: boolean('enabled').default(false).notNull(),

		/** 5-field cron, UTC. Null means trigger-only (fired from a command). */
		cron: varchar('cron', { length: 64 }),
		config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),

		// ── Spend guards. Enforced against tenant_bot_runs, not memory. ──
		maxUsdPerRun: integer('max_usd_per_run').default(0).notNull(),
		maxUsdPerDay: integer('max_usd_per_day').default(0).notNull(),

		lastRunAt: timestamp('last_run_at'),
		nextRunAt: timestamp('next_run_at'),
		consecutiveFailures: integer('consecutive_failures').default(0).notNull(),

		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		botIdx: index('tenant_bot_automations_bot_idx').on(t.botId),
		dueIdx: index('tenant_bot_automations_due_idx').on(t.enabled, t.nextRunAt),
	}),
)

/** One attempt at an automation — including the ones that never broadcast. */
export const tenantBotRuns = pgTable(
	'tenant_bot_runs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		automationId: uuid('automation_id')
			.references(() => tenantBotAutomations.id, { onDelete: 'cascade' })
			.notNull(),
		botId: uuid('bot_id')
			.references(() => tenantBots.id, { onDelete: 'cascade' })
			.notNull(),

		/**
		 * `<automationId>:<slot minute, ISO>` — see cron.ts's slotKey().
		 *
		 * Unique, and written BEFORE anything is quoted or broadcast. Two
		 * replicas ticking the same minute, a restart mid-run, or a manual
		 * trigger racing the scheduler all collide here instead of spending
		 * twice. Manual runs use a `manual:<uuid>` key so they never collide
		 * with a scheduled slot.
		 */
		idempotencyKey: varchar('idempotency_key', { length: 120 }),
		/** The scheduled minute this run belongs to; null for a manual run. */
		scheduledFor: timestamp('scheduled_for'),

		status: tenantBotRunStatusEnum('status').notNull(),
		/** Why a `skipped` run was skipped, or why a `failed` one failed. */
		reason: text('reason'),

		/** What the run intended to spend, in USD. Present even when simulated —
		 *  this is the column the daily cap sums over. */
		spendUsd: integer('spend_usd').default(0).notNull(),
		/** Token amount bought/burned, as a decimal string (never a float). */
		tokenAmount: varchar('token_amount', { length: 80 }),
		txHash: varchar('tx_hash', { length: 100 }),
		quote: jsonb('quote').$type<Record<string, unknown>>(),

		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at'),
	},
	(t) => ({
		idemUniq: unique('tenant_bot_runs_idem_uniq').on(t.idempotencyKey),
		automationIdx: index('tenant_bot_runs_automation_idx').on(t.automationId, t.startedAt),
		botIdx: index('tenant_bot_runs_bot_idx').on(t.botId, t.startedAt),
	}),
)

export type TenantBot = typeof tenantBots.$inferSelect
export type TenantBotAutomation = typeof tenantBotAutomations.$inferSelect
export type TenantBotRun = typeof tenantBotRuns.$inferSelect
