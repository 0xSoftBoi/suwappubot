/**
 * `/v1/bots/proof/:handle` — a tenant bot's public treasury record.
 *
 * Unauthenticated on purpose, in the same spirit as `/v1/autopilot`: the point
 * of this surface is that a stranger who does not trust the team can check the
 * team's claims. Requiring a login would defeat it entirely.
 *
 * Opt-in per bot (`proof_public`), because publishing an organisation's
 * treasury activity is theirs to decide, not ours. What is NOT optional is what
 * gets published once they opt in: refusals, failures, unverifiable runs and
 * the funding caveat all ship with the successes. A team can choose silence or
 * they can choose the record — they cannot choose a highlight reel, because a
 * highlight reel is what the category already has and it is why nobody believes
 * any of it.
 *
 * Addressed by Telegram handle rather than internal id: the handle is the
 * bot's public identity, it is globally unique, and it is the thing a holder
 * can already see in their group.
 */
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import {
	requireDb,
	tenantBotAutomations,
	tenantBotRuns,
	tenantBots,
} from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'
import { explorerUrl } from '../services/tenantBots/executor'
import { caveatsFor, headline, type ProofRun, summarise } from '../services/tenantBots/proof'

export const tenantBotProofRoutes = new Hono()

/** How many runs to show. Enough to see a pattern, bounded so a busy bot does
 *  not return a megabyte to an anonymous caller. */
const RUN_LIMIT = 100

tenantBotProofRoutes.get('/:handle', async (c) => {
	const handle = c.req.param('handle').replace(/^@/, '').toLowerCase()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const botRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tenantBots)
						.where(eq(tenantBots.telegramUsername, handle))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const bot = botRows[0]

			// A bot that has not opted in is reported as "not published" rather than
			// "not found" — the distinction is honest and avoids implying the team
			// is hiding something when they simply never turned it on.
			if (!bot) return { found: false as const, published: false as const }
			if (!bot.proofPublic) {
				return {
					found: true as const,
					published: false as const,
					name: bot.name,
					handle: bot.telegramUsername,
				}
			}

			const automations = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tenantBotAutomations)
						.where(eq(tenantBotAutomations.botId, bot.id)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const runRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tenantBotRuns)
						.where(eq(tenantBotRuns.botId, bot.id))
						.orderBy(desc(tenantBotRuns.startedAt))
						.limit(RUN_LIMIT),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const runs: ProofRun[] = runRows.map((r) => ({
				status: r.status,
				reason: r.reason,
				spendUsd: r.spendUsd,
				tokenAmount: r.tokenAmount,
				txHash: r.txHash,
				startedAt: r.startedAt,
			}))
			const totals = summarise(runs)

			// The most recent runs, newest first — so "the last two failed" is a
			// question about the head of the list.
			let recentFailures = 0
			for (const r of runs) {
				if (r.status === 'failed') recentFailures += 1
				else if (r.status === 'succeeded' || r.status === 'simulated') break
			}

			const burnAutomation = automations.find((a) => a.kind === 'buy_and_burn')
			const kind = burnAutomation ? 'buy_and_burn' : (automations[0]?.kind ?? 'buyback')
			const chain = bot.tokenChain ?? 'base'

			return {
				found: true as const,
				published: true as const,
				bot: {
					name: bot.name,
					handle: bot.telegramUsername,
					token_symbol: bot.tokenSymbol,
					token_chain: bot.tokenChain,
					token_address: bot.tokenAddress,
					treasury_address: bot.treasuryAddress,
					status: bot.status,
				},
				funding: {
					source: bot.fundingSource,
					note: bot.fundingNote,
				},
				headline: headline(totals, kind, bot.tokenSymbol ?? 'tokens'),
				totals: {
					// Named so the distinction cannot be lost by a careless reader:
					// executed means it broadcast, simulated means it did not.
					executed_runs: totals.executedRuns,
					executed_spend_usd: totals.executedSpendUsd,
					simulated_runs: totals.simulatedRuns,
					skipped_runs: totals.skippedRuns,
					failed_runs: totals.failedRuns,
					verifiable_runs: totals.verifiableRuns,
					first_run_at: totals.firstRunAt?.toISOString() ?? null,
					last_run_at: totals.lastRunAt?.toISOString() ?? null,
				},
				/** What this page does not establish. Deliberately not a footnote. */
				caveats: caveatsFor({
					totals,
					fundingSource: bot.fundingSource,
					kind,
					recentFailures,
				}),
				schedule: automations
					.filter((a) => a.maxUsdPerRun > 0)
					.map((a) => ({
						name: a.name,
						kind: a.kind,
						cron: a.cron,
						mode: a.mode,
						armed: a.enabled && a.mode === 'live',
						max_usd_per_run: a.maxUsdPerRun,
						max_usd_per_day: a.maxUsdPerDay,
						burn_address:
							(a.config as { burnAddress?: string } | null)?.burnAddress ?? null,
					})),
				runs: runs.map((r) => ({
					status: r.status,
					reason: r.reason,
					spend_usd: r.spendUsd,
					token_amount: r.tokenAmount,
					tx_hash: r.txHash,
					// The link is the point. A number without one is our word for it.
					explorer_url: explorerUrl(chain, r.txHash),
					started_at: r.startedAt.toISOString(),
				})),
				disclosure:
					'Every run this bot attempted is listed, including the ones that were ' +
					'refused or failed. Simulated runs moved no funds and are counted ' +
					'separately. Figures are what this bot spent — not a claim about the ' +
					"token's total supply.",
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	const payload = result.right
	if (!payload.found) return c.json({ success: false, error: 'No such bot' }, 404)
	if (!payload.published) {
		return c.json(
			{
				success: false,
				error: 'not_published',
				message: 'This bot has not published a public record.',
				bot: { name: payload.name, handle: payload.handle },
			},
			404,
		)
	}
	// Short cache: a holder refreshing during a burn should see it land, but an
	// anonymous endpoint should not be a free database load generator.
	c.header('Cache-Control', 'public, max-age=30')
	return c.json({ success: true, ...payload })
})
