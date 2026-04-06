import { Effect } from 'effect'
import { logger } from '../lib/logger'
import { fetchWithRetry } from '../lib/retry'
import { runEffect } from '../runtime'
import { EnvService } from '../config/EnvService'
import type { DCAOrder } from '../db'
import { DCAService } from '../services/DCAService'
import { WalletService } from '../services/WalletService'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const CHECK_INTERVAL_MS = Number(process.env.DCA_CHECK_INTERVAL_MS || 60_000)

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorInFlight = false

function buildQuoteData(order: DCAOrder) {
	return {
		provider: 'scheduled_dca',
		from_chain: order.fromChain,
		to_chain: order.toChain,
		from_token: order.fromToken,
		to_token: order.toToken,
		from_amount: order.amountPerExecution,
		from_amount_human: 0,
		to_amount: '0',
		to_amount_human: 0,
		to_amount_min: '0',
		gas_cost_usd: 0,
		fee_cost_usd: 0,
		total_cost_usd: 0,
		estimated_time: 60,
		price_impact: 0,
		exchange_rate: 0,
		raw_quote: {
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
							quote_data: buildQuoteData(order),
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
