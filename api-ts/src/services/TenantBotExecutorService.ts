/**
 * Runs one tenant-bot automation, end to end.
 *
 * The ordering rules and the reasoning behind the guards live in
 * `tenantBots/executor.ts`; this file is the wiring — claim, journal, quote,
 * broadcast, announce — and it is deliberately thin so that the parts worth
 * arguing about stay pure and tested.
 */
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
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
} from '../db'
import { NotFoundError, ValidationError } from '../errors'
import { logger } from '../lib/logger'
import { SwapService } from './SwapService'
import { TenantBotService } from './TenantBotService'
import { TokenService } from './TokenService'
import { getTokenPriceUsd } from './autopilot/market'
import {
	claimAutomation,
	evaluateGuards,
	evaluatePostGuards,
	formatPricePost,
	POSTING_KINDS,
	explorerUrl,
	formatReceipt,
	nextRunAfter,
	readBurnConfig,
	recordOutcome,
	type RunRecord,
	slotKey,
	spendLast24hFor,
	usdToTokenUnits,
} from './tenantBots/executor'

const TELEGRAM_API = 'https://api.telegram.org'

export interface RunResult {
	runId: string | null
	status: RunRecord['status']
	reason: string | null
	spendUsd: number
	txHash: string | null
	tokenAmount: string | null
}

/** Everything a run needs in scope: the db, a quote source, the token registry
 *  and the bot's own credential (to post its receipt). */
export type ExecutorDeps = DrizzleService | SwapService | TokenService | TenantBotService

export interface TenantBotExecutorInterface {
	/** Run one automation now. `manual` relaxes the enabled check for a dry run
	 *  only — see evaluateGuards. */
	readonly runAutomation: (
		automationId: string,
		opts?: { manual?: boolean; forceSimulate?: boolean; slot?: Date },
	) => Effect.Effect<RunResult, Error, ExecutorDeps>
	/** Drive every automation whose next_run_at has passed. */
	readonly runDue: (now?: Date) => Effect.Effect<RunResult[], Error, ExecutorDeps>
}

export class TenantBotExecutor extends Context.Tag('TenantBotExecutor')<
	TenantBotExecutor,
	TenantBotExecutorInterface
>() {}

export const TenantBotExecutorLive = Layer.effect(
	TenantBotExecutor,
	Effect.gen(function* () {
		const env = yield* EnvService

		/** Insert the run row. A unique-violation here means this slot already
		 *  ran — the correct outcome is to stop, not to retry. */
		const openRun = (
			automation: TenantBotAutomation,
			idempotencyKey: string,
			slot: Date | null,
		) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(tenantBotRuns)
							.values({
								automationId: automation.id,
								botId: automation.botId,
								idempotencyKey,
								scheduledFor: slot,
								status: 'skipped',
								reason: 'in flight',
								spendUsd: 0,
							})
							.onConflictDoNothing({ target: tenantBotRuns.idempotencyKey })
							.returning(),
					catch: (e) => new Error(`could not open run: ${e}`),
				})
				return rows[0] ?? null
			})

		const closeRun = (runId: string, rec: RunRecord) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(tenantBotRuns)
							.set({
								status: rec.status,
								reason: rec.reason ?? null,
								spendUsd: Math.floor(rec.spendUsd),
								tokenAmount: rec.tokenAmount ?? null,
								txHash: rec.txHash ?? null,
								quote: rec.quote ?? null,
								finishedAt: new Date(),
							})
							.where(eq(tenantBotRuns.id, runId)),
					catch: (e) => new Error(`could not close run: ${e}`),
				})
			})

		/** Post the receipt with the tenant's own bot, in their branding.
		 *  Never fatal: a burn that landed on-chain must not be reported as
		 *  failed because Telegram was unreachable. */
		const announce = (bot: TenantBot, chatId: string | undefined, body: string) =>
			Effect.gen(function* () {
				if (!chatId) return
				const svc = yield* TenantBotService
				const token = yield* svc.getDecryptedToken(bot.id)
				yield* Effect.tryPromise({
					try: () =>
						fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({
								chat_id: chatId,
								text: body,
								parse_mode: 'Markdown',
								disable_web_page_preview: true,
							}),
							signal: AbortSignal.timeout(10_000),
						}),
					catch: (e) => new Error(String(e)),
				})
			}).pipe(
				Effect.catchAll((e) =>
					Effect.sync(() =>
						logger.warn({ botId: bot.id, err: String(e) }, 'tenant bot receipt not delivered'),
					),
				),
			)

		const runAutomation = (
			automationId: string,
			opts: { manual?: boolean; forceSimulate?: boolean; slot?: Date } = {},
		) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const autoRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(tenantBotAutomations)
							.where(eq(tenantBotAutomations.id, automationId))
							.limit(1),
					catch: (e) => new Error(`automation load failed: ${e}`),
				})
				const automation = autoRows[0]
				if (!automation) {
					return yield* Effect.fail(
						new NotFoundError({ resource: 'automation', message: automationId }),
					)
				}

				const botRows = yield* Effect.tryPromise({
					try: () =>
						db.select().from(tenantBots).where(eq(tenantBots.id, automation.botId)).limit(1),
					catch: (e) => new Error(`bot load failed: ${e}`),
				})
				const bot = botRows[0]
				if (!bot) {
					return yield* Effect.fail(new NotFoundError({ resource: 'bot', message: automation.botId }))
				}

				// ── Posting automations: no money, so a much shorter path. ──
				if (POSTING_KINDS.has(automation.kind)) {
					const postCfg = (automation.config ?? {}) as { announceChatId?: string }
					const verdict = evaluatePostGuards({
						botStatus: bot.status,
						enabled: automation.enabled,
						kind: automation.kind,
						tokenAddress: bot.tokenAddress,
						announceChatId: postCfg.announceChatId,
						manual: opts.manual === true,
					})
					const pkey = opts.manual
						? `manual:${automationId}:${Date.now()}`
						: slotKey(automationId, opts.slot ?? new Date())
					const prun = yield* openRun(automation, pkey, opts.manual ? null : (opts.slot ?? null))
					if (!prun) {
						return {
							runId: null,
							status: 'skipped' as const,
							reason: 'duplicate slot',
							spendUsd: 0,
							txHash: null,
							tokenAmount: null,
						}
					}
					if (!verdict.ok) {
						yield* closeRun(prun.id, { status: 'skipped', reason: verdict.detail, spendUsd: 0 })
						return {
							runId: prun.id,
							status: 'skipped' as const,
							reason: verdict.detail,
							spendUsd: 0,
							txHash: null,
							tokenAmount: null,
						}
					}

					const price = yield* Effect.tryPromise({
						try: () => getTokenPriceUsd(bot.tokenChain ?? 'base', bot.tokenAddress as string),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					}).pipe(Effect.catchAll(() => Effect.succeed(null)))

					if (price === null) {
						// No price means no honest post. Journalled as failed so a
						// silent gap in the daily posts is visible in the run log.
						yield* closeRun(prun.id, {
							status: 'failed',
							reason: 'no market data for this token right now',
							spendUsd: 0,
						})
						yield* recordOutcome(automation, false)
						return {
							runId: prun.id,
							status: 'failed' as const,
							reason: 'no market data for this token right now',
							spendUsd: 0,
							txHash: null,
							tokenAmount: null,
						}
					}

					// Burn totals for a holder_report come from this bot's own
					// successful LIVE runs only — never simulated ones.
					let burnedRuns = 0
					let burnedSpendUsd = 0
					if (automation.kind === 'holder_report') {
						const agg = yield* Effect.tryPromise({
							try: () =>
								db
									.select({
										runs: sql<number>`count(*)`,
										spent: sql<number>`coalesce(sum(${tenantBotRuns.spendUsd}), 0)`,
									})
									.from(tenantBotRuns)
									.where(
										and(
											eq(tenantBotRuns.botId, bot.id),
											eq(tenantBotRuns.status, 'succeeded'),
										),
									),
							catch: (e) => (e instanceof Error ? e : new Error(String(e))),
						}).pipe(Effect.catchAll(() => Effect.succeed([{ runs: 0, spent: 0 }])))
						burnedRuns = Number(agg[0]?.runs ?? 0)
						burnedSpendUsd = Number(agg[0]?.spent ?? 0)
					}

					const body = formatPricePost(
						automation.kind,
						{
							symbol: bot.tokenSymbol ?? 'Token',
							priceUsd: price,
							burnedRuns,
							burnedSpendUsd,
						},
						(bot.branding as { mark?: string })?.mark
							? `${(bot.branding as { mark?: string }).mark} `
							: '',
					)
					// A manual dry run shows the operator the post without sending it.
					if (!opts.manual) {
						yield* announce(bot, postCfg.announceChatId, body)
					}
					yield* closeRun(prun.id, {
						status: opts.manual ? 'simulated' : 'succeeded',
						reason: opts.manual ? 'preview only — not posted' : null,
						spendUsd: 0,
						quote: { preview: body },
					})
					yield* recordOutcome(automation, true)
					return {
						runId: prun.id,
						status: opts.manual ? ('simulated' as const) : ('succeeded' as const),
						reason: opts.manual ? body : null,
						spendUsd: 0,
						txHash: null,
						tokenAmount: null,
					}
				}

				// A manual dry run is always a dry run, whatever the row says.
				const mode: 'simulate' | 'live' =
					opts.forceSimulate || automation.mode === 'simulate' ? 'simulate' : 'live'

				const cfg = readBurnConfig(automation, bot)
				const spent24h = yield* spendLast24hFor(automation.id)

				const verdict = evaluateGuards({
					botStatus: bot.status,
					enabled: automation.enabled,
					mode,
					kind: automation.kind,
					maxUsdPerRun: automation.maxUsdPerRun,
					maxUsdPerDay: automation.maxUsdPerDay,
					spentUsd24h: spent24h,
					requestedUsd: cfg.amountUsd,
					treasuryAddress: bot.treasuryAddress,
					spendTokenSymbol: cfg.spendToken,
					burnAddress: cfg.burnAddress,
					consecutiveFailures: automation.consecutiveFailures,
					manual: opts.manual === true,
				})

				const key = opts.manual
					? `manual:${automationId}:${Date.now()}`
					: slotKey(automationId, opts.slot ?? new Date())
				const run = yield* openRun(automation, key, opts.manual ? null : (opts.slot ?? null))
				if (!run) {
					// Another worker already owns this slot.
					logger.info({ automationId, key }, 'tenant bot run already recorded for this slot')
					return { runId: null, status: 'skipped' as const, reason: 'duplicate slot', spendUsd: 0, txHash: null, tokenAmount: null }
				}

				if (!verdict.ok) {
					yield* closeRun(run.id, { status: 'skipped' as const, reason: verdict.detail, spendUsd: 0 })
					return {
						runId: run.id,
						status: 'skipped' as const,
						reason: verdict.detail,
						spendUsd: 0,
						txHash: null,
						tokenAmount: null,
					}
				}

				const spendUsd = verdict.spendUsd

				// ── Quote ──────────────────────────────────────────────────────
				const quoteResult = yield* Effect.either(
					Effect.gen(function* () {
						const tokens = yield* TokenService
						const swap = yield* SwapService
						const chainId = tokens.getChainId(cfg.chain)
						if (!chainId) {
							return yield* Effect.fail(
								new ValidationError({ message: `unknown chain ${cfg.chain}` }),
							)
						}
						const spendInfo = yield* tokens.resolveToken(cfg.spendToken, chainId)
						if (!spendInfo) {
							return yield* Effect.fail(
								new ValidationError({ message: `cannot resolve ${cfg.spendToken} on ${cfg.chain}` }),
							)
						}
						if (!cfg.buyToken) {
							return yield* Effect.fail(
								new ValidationError({ message: 'no token address configured for this bot' }),
							)
						}
						return yield* swap.getQuote({
							fromChain: chainId,
							toChain: chainId,
							fromToken: spendInfo.address,
							toToken: cfg.buyToken,
							fromAmount: usdToTokenUnits(spendUsd, spendInfo.decimals),
							fromAddress: bot.treasuryAddress as string,
							// A burn sends the bought tokens straight to the sink, so the
							// swap's recipient IS the burn address — the tokens never sit
							// in the treasury where a later change of heart could reach them.
							toAddress: cfg.burnAddress ?? (bot.treasuryAddress as string),
							slippage: (cfg.maxSlippageBps ?? 100) / 10_000,
						})
					}),
				)

				if (quoteResult._tag === 'Left') {
					const detail = `quote failed: ${String((quoteResult.left as Error).message ?? quoteResult.left)}`
					yield* closeRun(run.id, { status: 'failed' as const, reason: detail, spendUsd: 0 })
					yield* recordOutcome(automation, false)
					return { runId: run.id, status: 'failed' as const, reason: detail, spendUsd: 0, txHash: null, tokenAmount: null }
				}
				const quote = quoteResult.right

				const humanOut = (() => {
					try {
						const d = quote.toToken?.decimals ?? 18
						return (Number(BigInt(quote.toAmount)) / 10 ** d).toLocaleString(undefined, {
							maximumFractionDigits: 4,
						})
					} catch {
						return null
					}
				})()

				// ── Simulate: journal the intent, move nothing ─────────────────
				if (mode === 'simulate') {
					const rec: RunRecord = {
						status: 'simulated' as const,
						reason: null,
						spendUsd,
						tokenAmount: humanOut,
						quote: {
							from: quote.fromToken?.symbol,
							to: quote.toToken?.symbol,
							toAmount: quote.toAmount,
							toAmountMin: quote.toAmountMin,
							priceImpact: quote.priceImpact,
							estimatedGasUsd: quote.estimatedGasUsd,
							route: quote.route,
						},
					}
					yield* closeRun(run.id, rec)
					yield* recordOutcome(automation, true)
					yield* announce(
						bot,
						cfg.announceChatId,
						formatReceipt(automation.kind, rec, {
							symbol: bot.tokenSymbol ?? quote.toToken?.symbol ?? 'tokens',
							mark: (bot.branding as { mark?: string })?.mark
								? `${(bot.branding as { mark?: string }).mark} `
								: '',
							simulated: true,
						}),
					)
					return { runId: run.id, status: 'simulated' as const, reason: null, spendUsd, txHash: null, tokenAmount: humanOut }
				}

				// ── Live. Second, independent mode check before any broadcast. ──
				if (mode !== 'live') {
					// Unreachable by construction; here so a future refactor that
					// breaks the invariant fails loudly instead of spending.
					yield* closeRun(run.id, { status: 'failed' as const, reason: 'mode invariant violated', spendUsd: 0 })
					return { runId: run.id, status: 'failed' as const, reason: 'mode invariant violated', spendUsd: 0, txHash: null, tokenAmount: null }
				}

				if (!env.INTERNAL_API_KEY || !env.INTERNAL_API_URL) {
					const detail = 'live execution is not configured on this environment'
					yield* closeRun(run.id, { status: 'failed' as const, reason: detail, spendUsd: 0 })
					return { runId: run.id, status: 'failed' as const, reason: detail, spendUsd: 0, txHash: null, tokenAmount: null }
				}
				if (!bot.treasuryInternalWalletId || !bot.treasuryInternalUserId) {
					const detail = 'treasury wallet is not provisioned for signing'
					yield* closeRun(run.id, { status: 'failed' as const, reason: detail, spendUsd: 0 })
					return { runId: run.id, status: 'failed' as const, reason: detail, spendUsd: 0, txHash: null, tokenAmount: null }
				}

				const internalUrl = env.INTERNAL_API_URL
				const internalKey = env.INTERNAL_API_KEY
				// The run's idempotency key is handed to the swap pipeline too, so a
				// retry at this layer cannot become a second broadcast at that one.
				const execResult = yield* Effect.either(
					Effect.tryPromise({
						try: async () => {
							const res = await fetch(`${internalUrl}/internal/agent/execute-swap`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
								body: JSON.stringify({
									internal_user_id: bot.treasuryInternalUserId,
									internal_wallet_id: bot.treasuryInternalWalletId,
									wallet_address: bot.treasuryAddress,
									chain_type: cfg.chain.toLowerCase() === 'solana' ? 'solana' : 'evm',
									idempotency_key: key,
									quote_data: {
										provider: 'lifi',
										from_chain: cfg.chain,
										to_chain: cfg.chain,
										from_token: quote.fromToken?.address,
										to_token: quote.toToken?.address,
										from_amount: quote.fromAmount,
										to_amount: quote.toAmount,
										to_amount_min: quote.toAmountMin,
										raw_quote: quote._rawQuote,
									},
								}),
								signal: AbortSignal.timeout(120_000),
							})
							if (!res.ok) {
								const body = (await res.json().catch(() => ({}))) as { detail?: string }
								throw new Error(body.detail || `execute-swap ${res.status}`)
							}
							return (await res.json()) as {
								swap_id: number
								tx_hash: string | null
								status: string
							}
						},
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					}),
				)

				if (execResult._tag === 'Left') {
					// The outcome may be UNKNOWN rather than failed: execute-swap is
					// synchronous through broadcast and can outlive our timeout. The run
					// is journalled as failed with that ambiguity spelled out, because
					// silently recording "failed" for a tx that landed is how a treasury
					// ends up double-spent by a well-meaning retry.
					const msg = (execResult.left as Error).message
					const unknown = /timeout|abort|fetch failed|network/i.test(msg)
					const detail = unknown
						? `broadcast outcome unknown (${msg}) — check the treasury before re-running`
						: `execution failed: ${msg}`
					yield* closeRun(run.id, {
						status: 'failed',
						// An unknown outcome counts its spend: assuming it did NOT
						// happen is the assumption that spends twice.
						spendUsd: unknown ? spendUsd : 0,
						reason: detail,
					})
					yield* recordOutcome(automation, true /* don't trip the breaker on ambiguity */)
					return { runId: run.id, status: 'failed' as const, reason: detail, spendUsd: unknown ? spendUsd : 0, txHash: null, tokenAmount: null }
				}

				const exec = execResult.right
				const rec: RunRecord = {
					status: 'succeeded',
					reason: null,
					spendUsd,
					tokenAmount: humanOut,
					txHash: exec.tx_hash,
					quote: { swapId: exec.swap_id, status: exec.status, route: quote.route },
				}
				yield* closeRun(run.id, rec)
				yield* recordOutcome(automation, true)
				yield* announce(
					bot,
					cfg.announceChatId,
					formatReceipt(automation.kind, rec, {
						symbol: bot.tokenSymbol ?? quote.toToken?.symbol ?? 'tokens',
						mark: (bot.branding as { mark?: string })?.mark
							? `${(bot.branding as { mark?: string }).mark} `
							: '',
						simulated: false,
						explorerUrl: explorerUrl(cfg.chain, exec.tx_hash),
					}),
				)
				logger.info(
					{ automationId, botId: bot.id, spendUsd, txHash: exec.tx_hash },
					'tenant bot automation executed',
				)
				return { runId: run.id, status: 'succeeded' as const, reason: null, spendUsd, txHash: exec.tx_hash, tokenAmount: humanOut }
			})

		const runDue = (now = new Date()) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const due = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(tenantBotAutomations)
							.where(
								and(
									eq(tenantBotAutomations.enabled, true),
									isNotNull(tenantBotAutomations.nextRunAt),
									lte(tenantBotAutomations.nextRunAt, now),
								),
							)
							.limit(200),
					catch: (e) => new Error(`due scan failed: ${e}`),
				})

				const results: RunResult[] = []
				for (const automation of due) {
					const slot = automation.nextRunAt as Date
					const claimed = yield* claimAutomation(
						automation.id,
						slot,
						nextRunAfter(automation.cron, now),
					)
					// Lost the race to another replica — it owns this slot.
					if (!claimed) continue

					const res = yield* runAutomation(automation.id, { slot }).pipe(
						Effect.catchAll((e) =>
							Effect.succeed({
								runId: null,
								status: 'failed' as const,
								reason: String(e),
								spendUsd: 0,
								txHash: null,
								tokenAmount: null,
							}),
						),
					)
					results.push(res)
				}
				return results
			})

		return { runAutomation, runDue } satisfies TenantBotExecutorInterface
	}),
)
