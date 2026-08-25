/**
 * The automation executor — where a tenant bot actually spends money.
 *
 * Shape of a run, in order:
 *
 *   claim slot → write run row (idempotency key) → guards → quote
 *     → simulate: journal what it *would* have done, stop
 *     → live:     broadcast via the Python custodial path, journal the tx
 *   → announce receipt → reschedule
 *
 * The run row is written BEFORE the quote and before any broadcast. That
 * ordering is the point: a process that dies mid-run leaves evidence, and the
 * unique index on `idempotency_key` means the retry cannot spend a second time
 * for the same slot. Journalling after the fact would lose exactly the runs
 * you most need to see.
 *
 * ## What this file is allowed to decide
 *
 * Nothing about size. `evaluateGuards` clamps every spend to the automation's
 * own per-run cap and refuses anything that would breach the rolling 24h cap,
 * and both caps are read from the row at execution time rather than trusted
 * from a config blob. A row that somehow carries `amountUsd: 1_000_000` spends
 * `maxUsdPerRun`, not a million dollars.
 *
 * ## Why simulate cannot broadcast
 *
 * `mode` is checked in `evaluateGuards`, and the broadcast call sits behind a
 * second explicit `mode === 'live'` check with an assertion in front of it. Two
 * independent checks for the same fact is not redundancy here — the failure
 * being defended against is somebody later refactoring one of them away.
 *
 * ## Stablecoin-only spend side
 *
 * `amountUsd` is honest only if the token being spent is worth a dollar. The
 * spend side is therefore restricted to a stablecoin allowlist; a treasury that
 * wants to sell ETH into its own token needs a different automation kind with
 * a different unit, and pretending otherwise would mean a "$50" burn spending
 * 50 ETH the first time somebody set `spendToken: 'ETH'`.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import type { EnvService } from '../../config/EnvService'
import {
	requireDb,
	tenantBotAutomations,
	tenantBotRuns,
	tenantBots,
	type TenantBot,
	type TenantBotAutomation,
} from '../../db'
import { logger } from '../../lib/logger'
import { nextRunAfter, slotKey } from './cron'

/** Burn sinks. A `buy_and_burn` may only send to one of these.
 *
 * Without this, "buy and burn" is just "buy and send somewhere", and the
 * difference is invisible to the community the bot is reporting to. An
 * operator who wants tokens delivered elsewhere has `buyback` for that. */
export const BURN_SINKS = new Set([
	'0x000000000000000000000000000000000000dead',
	'0x0000000000000000000000000000000000000000',
	// Solana incinerator
	'1nc1nerator11111111111111111111111111111111',
])

export const DEFAULT_BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD'

/** Tokens whose unit we are willing to read as one US dollar. */
export const STABLE_SPEND_TOKENS = new Set(['USDC', 'USDT', 'DAI', 'USDC.E', 'USDBC'])

/** Consecutive failures after which an automation disarms itself. */
export const FAILURE_CIRCUIT_LIMIT = 3

export const SPENDING_KINDS = new Set(['buy_and_burn', 'buyback', 'reward_drip'])

export type SkipReason =
	| 'bot_not_live'
	| 'automation_disabled'
	| 'no_treasury'
	| 'no_amount'
	| 'per_run_cap_zero'
	| 'daily_cap_reached'
	| 'bad_burn_address'
	| 'unsupported_spend_token'
	| 'circuit_open'
	| 'not_a_spending_automation'

export interface GuardInput {
	botStatus: TenantBot['status']
	enabled: boolean
	mode: 'simulate' | 'live'
	kind: string
	maxUsdPerRun: number
	maxUsdPerDay: number
	spentUsd24h: number
	requestedUsd: number
	treasuryAddress: string | null
	spendTokenSymbol: string
	burnAddress?: string | null
	consecutiveFailures: number
	/** A human pressed "run now" in the dashboard. */
	manual: boolean
}

export type GuardVerdict =
	| { ok: true; spendUsd: number }
	| { ok: false; reason: SkipReason; detail: string }

/**
 * Every reason a run must not proceed, in one pure function.
 *
 * Pure so the interesting cases — cap exactly reached, a simulate run on a
 * disabled automation, a burn pointed at an attacker's address — are testable
 * without a database, a wallet or a network.
 */
export function evaluateGuards(g: GuardInput): GuardVerdict {
	if (!SPENDING_KINDS.has(g.kind)) {
		return { ok: false, reason: 'not_a_spending_automation', detail: `kind ${g.kind} does not spend` }
	}

	// A paused or errored bot keeps its config but stops acting. Somebody hit
	// pause for a reason, and "the webhook is off but the treasury still moves"
	// is not what pause means to anyone.
	if (g.botStatus !== 'live') {
		return { ok: false, reason: 'bot_not_live', detail: `bot is ${g.botStatus}` }
	}

	// A disabled automation can still be dry-run by hand — that is how an
	// operator decides whether to arm it. It can never be dry-run by the
	// scheduler, and it can never run live.
	if (!g.enabled && !(g.manual && g.mode === 'simulate')) {
		return { ok: false, reason: 'automation_disabled', detail: 'automation is switched off' }
	}

	if (g.consecutiveFailures >= FAILURE_CIRCUIT_LIMIT) {
		return {
			ok: false,
			reason: 'circuit_open',
			detail: `${g.consecutiveFailures} consecutive failures — disarmed, needs a human`,
		}
	}

	if (!g.treasuryAddress) {
		return { ok: false, reason: 'no_treasury', detail: 'no treasury wallet is connected' }
	}

	if (!STABLE_SPEND_TOKENS.has(g.spendTokenSymbol.toUpperCase())) {
		return {
			ok: false,
			reason: 'unsupported_spend_token',
			detail: `spend token ${g.spendTokenSymbol} is not a supported stablecoin`,
		}
	}

	if (g.kind === 'buy_and_burn') {
		const dest = (g.burnAddress ?? DEFAULT_BURN_ADDRESS).toLowerCase()
		if (!BURN_SINKS.has(dest)) {
			return {
				ok: false,
				reason: 'bad_burn_address',
				detail: 'destination is not a burn address — use a buyback automation instead',
			}
		}
	}

	if (!Number.isFinite(g.requestedUsd) || g.requestedUsd <= 0) {
		return { ok: false, reason: 'no_amount', detail: 'no spend amount configured' }
	}
	if (!Number.isFinite(g.maxUsdPerRun) || g.maxUsdPerRun <= 0) {
		return { ok: false, reason: 'per_run_cap_zero', detail: 'per-run cap is not set' }
	}

	// The cap is a ceiling, not a target: ask for more and you get the cap.
	const spendUsd = Math.floor(Math.min(g.requestedUsd, g.maxUsdPerRun))
	if (spendUsd <= 0) {
		return { ok: false, reason: 'no_amount', detail: 'spend rounds to zero' }
	}

	// Simulated runs count toward the daily total on purpose. A rehearsal that
	// would have breached the cap has to show as a breach, or the operator arms
	// an automation whose dry runs all looked fine and whose live runs stop
	// halfway through the first day.
	const cap = Number.isFinite(g.maxUsdPerDay) && g.maxUsdPerDay > 0 ? g.maxUsdPerDay : g.maxUsdPerRun
	if (g.spentUsd24h + spendUsd > cap) {
		return {
			ok: false,
			reason: 'daily_cap_reached',
			detail: `$${g.spentUsd24h} of $${cap} already committed in the last 24h`,
		}
	}

	return { ok: true, spendUsd }
}

/** Smallest-unit amount for a USD figure in a stablecoin. */
export function usdToTokenUnits(usd: number, decimals: number): string {
	// Integer maths only — a float here is a rounding error denominated in money.
	const scaled = BigInt(Math.round(usd * 100)) * 10n ** BigInt(Math.max(0, decimals - 2))
	return scaled.toString()
}

export interface RunRecord {
	status: 'simulated' | 'succeeded' | 'failed' | 'skipped'
	reason?: string | null
	spendUsd: number
	tokenAmount?: string | null
	txHash?: string | null
	quote?: Record<string, unknown> | null
}

export interface BurnConfig {
	chain: string
	spendToken: string
	buyToken: string
	amountUsd: number
	burnAddress?: string | null
	maxSlippageBps?: number
	announceChatId?: string
}

/** Read an automation's config into the shape the executor needs, with the
 *  defaults an operator most likely meant. */
export function readBurnConfig(
	automation: Pick<TenantBotAutomation, 'kind' | 'config'>,
	bot: Pick<TenantBot, 'tokenChain' | 'tokenAddress'>,
): BurnConfig {
	const c = (automation.config ?? {}) as Record<string, unknown>
	const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
	const num = (v: unknown, d: number) => {
		const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
		return Number.isFinite(n) ? n : d
	}
	return {
		chain: str(c.chain, bot.tokenChain ?? 'base'),
		spendToken: str(c.spendToken, 'USDC'),
		buyToken: str(c.buyToken, bot.tokenAddress ?? ''),
		amountUsd: num(c.amountUsd, 0),
		burnAddress:
			automation.kind === 'buy_and_burn'
				? str(c.burnAddress, DEFAULT_BURN_ADDRESS)
				: null,
		maxSlippageBps: num(c.maxSlippageBps, 100),
		announceChatId: typeof c.announceChatId === 'string' ? c.announceChatId : undefined,
	}
}

/** A community-facing receipt. Written to be readable by someone who does not
 *  know what a basis point is, and never to imply a price outcome. */
export function formatReceipt(
	kind: string,
	rec: RunRecord,
	opts: { symbol: string; mark: string; simulated: boolean; explorerUrl?: string | null },
): string {
	const verb = kind === 'buy_and_burn' ? 'burned' : 'bought back'
	const head = opts.simulated
		? `${opts.mark}*Dry run* — no funds moved`
		: `${opts.mark}*${verb === 'burned' ? 'Burn' : 'Buyback'} complete*`
	const lines = [head, '', `Spent: *$${rec.spendUsd}*`]
	if (rec.tokenAmount) lines.push(`${verb === 'burned' ? 'Burned' : 'Bought'}: *${rec.tokenAmount} ${opts.symbol}*`)
	if (opts.explorerUrl) lines.push(`[View transaction](${opts.explorerUrl})`)
	if (opts.simulated) {
		lines.push('', '_This is what the automation would have done. Nothing was spent._')
	}
	return lines.join('\n')
}

const EXPLORERS: Record<string, string> = {
	ethereum: 'https://etherscan.io/tx/',
	base: 'https://basescan.org/tx/',
	arbitrum: 'https://arbiscan.io/tx/',
	optimism: 'https://optimistic.etherscan.io/tx/',
	polygon: 'https://polygonscan.com/tx/',
	bsc: 'https://bscscan.com/tx/',
	avalanche: 'https://snowtrace.io/tx/',
	solana: 'https://solscan.io/tx/',
}

export function explorerUrl(chain: string, txHash: string | null | undefined): string | null {
	if (!txHash) return null
	const base = EXPLORERS[chain.toLowerCase()]
	return base ? `${base}${txHash}` : null
}

// ── DB-facing helpers ──────────────────────────────────────────────────────

/**
 * Claim a due automation by advancing `next_run_at` in the same statement that
 * checks it.
 *
 * Two replicas ticking the same minute both read the row as due; only the one
 * whose UPDATE matches the observed `next_run_at` gets a row back. The loser
 * sees zero rows and moves on. This is the cheap first line of defence; the
 * unique idempotency key behind it is the one that survives a crash between
 * claiming and spending.
 */
export const claimAutomation = (automationId: string, observedNextRun: Date, newNextRun: Date | null) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.update(tenantBotAutomations)
					.set({ nextRunAt: newNextRun, lastRunAt: new Date(), updatedAt: new Date() })
					.where(
						and(
							eq(tenantBotAutomations.id, automationId),
							eq(tenantBotAutomations.nextRunAt, observedNextRun),
						),
					)
					.returning({ id: tenantBotAutomations.id }),
			catch: (e) => new Error(`claim failed: ${e}`),
		})
		return rows.length > 0
	})

export const spendLast24hFor = (automationId: string) =>
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
			catch: (e) => new Error(`spend sum failed: ${e}`),
		})
		return Number(rows[0]?.total ?? 0)
	})

/** Reset or advance the failure counter, disarming the automation when the
 *  circuit trips. A broken config must not burn gas forever. */
export const recordOutcome = (automation: TenantBotAutomation, ok: boolean) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		const failures = ok ? 0 : automation.consecutiveFailures + 1
		const trip = failures >= FAILURE_CIRCUIT_LIMIT
		yield* Effect.tryPromise({
			try: () =>
				db
					.update(tenantBotAutomations)
					.set({
						consecutiveFailures: failures,
						// Disarming, not deleting: the operator sees an automation that
						// stopped itself and why, rather than one that vanished.
						...(trip ? { enabled: false } : {}),
						updatedAt: new Date(),
					})
					.where(eq(tenantBotAutomations.id, automation.id)),
			catch: (e) => new Error(`outcome record failed: ${e}`),
		})
		if (trip) {
			logger.warn(
				{ automationId: automation.id, failures },
				'tenant bot automation disarmed after consecutive failures',
			)
		}
	})

export { nextRunAfter, slotKey }
