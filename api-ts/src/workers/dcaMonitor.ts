import { Effect } from 'effect'
import { logger } from '../lib/logger'
import { fetchWithRetry } from '../lib/retry'
import { runEffect } from '../runtime'
import { EnvService } from '../config/EnvService'
import type { DCAOrder } from '../db'
import { DCAService } from '../services/DCAService'
import { SwapService, type SwapQuote as ExecutableSwapQuote } from '../services/SwapService'
import { WalletService } from '../services/WalletService'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const CHECK_INTERVAL_MS = Number(process.env.DCA_CHECK_INTERVAL_MS || 60_000)

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorInFlight = false

export function buildQuoteDataFromQuote(order: DCAOrder, quote: ExecutableSwapQuote) {
	return {
		provider: 'lifi',
		from_chain: order.fromChain,
		to_chain: order.toChain,
		from_token: order.fromToken,
		to_token: order.toToken,
		from_amount: quote.fromAmount,
		from_amount_human: Number(quote.fromAmountUsd || 0),
		to_amount: quote.toAmount,
		to_amount_human: Number(quote.toAmountUsd || 0),
		to_amount_min: quote.toAmountMin,
		gas_cost_usd: Number(quote.estimatedGasUsd || 0),
		fee_cost_usd: Number(quote.bridgeFeeUsd || 0),
		total_cost_usd: Number(quote.estimatedGasUsd || 0) + Number(quote.bridgeFeeUsd || 0),
		estimated_time: quote.estimatedDuration || 60,
		price_impact: Number(quote.priceImpact || 0),
		exchange_rate: Number(quote.exchangeRate || 0),
		raw_quote: {
			...quote._rawQuote,
			trigger: 'dca_monitor',
			order_id: order.id,
			interval: order.interval,
			executions_completed: order.executionsCompleted ?? 0,
		},
	}
}

async function executeDueOrder(order: DCAOrder): Promise<void> {
	await runEffect(
		Effect.gen(function* () {
			const env = yield* EnvService
			const walletService = yield* WalletService
			const dcaService = yield* DCAService
			const swapService = yield* SwapService

			const wallet = yield* walletService.getActiveWalletByAddress(order.userId, order.walletAddress)
			if (!wallet) {
				yield* dcaService.markFailed(order.id, `Active wallet not found for ${order.walletAddress}`)
				return
			}

			const internalKey = env.INTERNAL_API_KEY || process.env.AGENT_API_KEY || ''
			if (!internalKey) {
				yield* dcaService.markFailed(order.id, 'INTERNAL_API_KEY or AGENT_API_KEY is required')
				return
			}

			const quote = yield* swapService.getQuote({
				fromChain: order.fromChain,
				toChain: order.toChain,
				fromToken: order.fromToken,
				toToken: order.toToken,
				fromAmount: order.amountPerExecution,
				fromAddress: order.walletAddress,
				toAddress: order.walletAddress,
				slippage: (order.maxSlippage ?? 50) / 10_000,
				order: 'RECOMMENDED',
			})

			const response = yield* Effect.tryPromise({
				try: () =>
					fetchWithRetry(`${PYTHON_API_URL}/internal/agent/execute-swap`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Key': internalKey,
						},
							body: JSON.stringify({
								agent_uuid: `dca-order-${order.id}`,
								internal_user_id: order.userId,
								internal_wallet_id: wallet.id,
								idempotency_key: `dca:${order.id}:${order.nextExecutionAt?.toISOString() ?? Date.now()}`,
								quote_data: buildQuoteDataFromQuote(order, quote),
							}),
						}),
				catch: (error) => new Error(`Failed to call Python swap executor: ${error}`),
			})

			if (!response.ok) {
				const errorText = yield* Effect.tryPromise({
					try: () => response.text(),
					catch: () => Promise.resolve('Unknown Python API error'),
				})
				yield* dcaService.markFailed(
					order.id,
					`Python swap execution failed: ${response.status} ${errorText}`,
				)
				return
			}

			const execution = yield* Effect.tryPromise({
				try: () =>
					response.json() as Promise<{ tx_hash?: string; to_amount?: string; exchange_rate?: number }>,
				catch: (error) => new Error(`Failed to parse DCA swap response: ${error}`),
			})

			yield* dcaService.recordExecution(
				order.id,
				order.amountPerExecution,
				execution.to_amount ?? '0',
				execution.exchange_rate ?? 0,
				execution.tx_hash,
			)
		}),
	)
}

async function pollDcaOrders(): Promise<void> {
	if (monitorInFlight) {
		logger.warn('[DCAMonitor] Previous check still running, skipping overlap')
		return
	}

	monitorInFlight = true
	try {
		const orders = await runEffect(
			Effect.gen(function* () {
				const dcaService = yield* DCAService
				return yield* dcaService.getDueOrders()
			}),
		)

		for (const order of orders) {
			try {
				await executeDueOrder(order)
			} catch (error) {
				logger.error({ err: error, orderId: order.id }, '[DCAMonitor] Order execution failed')
			}
		}
	} catch (error) {
		logger.error({ err: error }, '[DCAMonitor] Poll failed')
	} finally {
		monitorInFlight = false
	}
}

export function startDcaMonitor(): void {
	if (monitorTimer) return

	monitorTimer = setInterval(() => {
		void pollDcaOrders()
	}, CHECK_INTERVAL_MS)

	void pollDcaOrders()
	logger.info({ intervalMs: CHECK_INTERVAL_MS }, '[DCAMonitor] Started')
}

export async function stopDcaMonitor(): Promise<void> {
	if (monitorTimer) {
		clearInterval(monitorTimer)
		monitorTimer = null
	}

	logger.info('[DCAMonitor] Stopped')
}
