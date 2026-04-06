import { Effect } from 'effect'
import { logger } from '../lib/logger'
import { fetchWithRetry } from '../lib/retry'
import { runEffect } from '../runtime'
import { EnvService } from '../config/EnvService'
import type { LimitOrder } from '../db'
import { LimitOrderService } from '../services/LimitOrderService'
import { WalletService } from '../services/WalletService'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const CHECK_INTERVAL_MS = Number(process.env.LIMIT_ORDER_CHECK_INTERVAL_MS || 30_000)

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorInFlight = false

function getTrackedToken(order: LimitOrder): { chain: string; token: string } {
	// `lte` is used for "buy the dip" flows, so watch the asset being bought.
	if (order.triggerType === 'lte') {
		return { chain: order.toChain, token: order.toToken }
	}

	// `gte` is used for take-profit / sell flows, so watch the asset being sold.
	return { chain: order.fromChain, token: order.fromToken }
}

function shouldTriggerOrder(order: LimitOrder, currentPrice: number): boolean {
	return order.triggerType === 'lte'
		? currentPrice <= order.targetPrice
		: currentPrice >= order.targetPrice
}

function buildQuoteData(order: LimitOrder, currentPrice: number) {
	return {
		provider: 'lifi',
		from_chain: order.fromChain,
		to_chain: order.toChain,
		from_token: order.fromToken,
		to_token: order.toToken,
		from_amount: order.fromAmount,
		from_amount_human: 0,
		to_amount: '0',
		to_amount_human: 0,
		to_amount_min: '0',
		gas_cost_usd: 0,
		fee_cost_usd: 0,
		total_cost_usd: 0,
		estimated_time: 60,
		price_impact: 0,
		exchange_rate: currentPrice,
		raw_quote: {
			trigger: 'limit_order_monitor',
			order_id: order.id,
			target_price: order.targetPrice,
			current_price: currentPrice,
			trigger_type: order.triggerType,
		},
	}
}

async function executeTriggeredOrder(order: LimitOrder, currentPrice: number): Promise<void> {
	const result = await runEffect(
		Effect.gen(function* () {
			const env = yield* EnvService
			const walletService = yield* WalletService
			const limitOrderService = yield* LimitOrderService

			const wallet = yield* walletService.getActiveWalletByAddress(order.userId, order.walletAddress)
			if (!wallet) {
				yield* limitOrderService.markOrderFailed(
					order.id,
					`Active wallet not found for address ${order.walletAddress}`,
				)
				return
			}

			const internalKey = env.INTERNAL_API_KEY || process.env.AGENT_API_KEY || ''
			if (!internalKey) {
				yield* limitOrderService.markOrderFailed(
					order.id,
					'INTERNAL_API_KEY or AGENT_API_KEY is required for limit order execution',
				)
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
							agent_uuid: `limit-order-${order.id}`,
							internal_user_id: order.userId,
							internal_wallet_id: wallet.id,
							idempotency_key: `limit:${order.id}:${new Date().toISOString().slice(0, 13)}`,
							quote_data: buildQuoteData(order, currentPrice),
						}),
					}),
				catch: (error) => new Error(`Failed to call Python swap executor: ${error}`),
			})

			if (!response.ok) {
				const errorText = yield* Effect.tryPromise({
					try: () => response.text(),
					catch: () => Promise.resolve('Unknown Python API error'),
				})
				yield* limitOrderService.markOrderFailed(
					order.id,
					`Python swap execution failed: ${response.status} ${errorText}`,
				)
				return
			}

			const execution = yield* Effect.tryPromise({
				try: () =>
					response.json() as Promise<{ swap_id?: number; tx_hash?: string; status?: string }>,
				catch: (error) => new Error(`Failed to parse Python swap response: ${error}`),
			})

			if (!execution.tx_hash) {
				yield* limitOrderService.markOrderFailed(
					order.id,
					'Python swap execution returned no transaction hash',
				)
				return
			}

			yield* limitOrderService.markOrderFilled(
				order.id,
				currentPrice,
				execution.tx_hash,
				execution.swap_id,
			)
		}),
	)

	return result
}

async function pollLimitOrders(): Promise<void> {
	if (monitorInFlight) {
		logger.warn('[LimitOrderMonitor] Previous check still running, skipping overlap')
		return
	}

	monitorInFlight = true

	try {
		await runEffect(
			Effect.gen(function* () {
				const limitOrderService = yield* LimitOrderService
				yield* limitOrderService.expireOrders()
			}),
		)

		const orders = await runEffect(
			Effect.gen(function* () {
				const limitOrderService = yield* LimitOrderService
				return yield* limitOrderService.getActiveOrders()
			}),
		)

		for (const order of orders) {
			try {
				const tracked = getTrackedToken(order)
				const currentPrice = await runEffect(
					Effect.gen(function* () {
						const limitOrderService = yield* LimitOrderService
						return yield* limitOrderService.getTokenPrice(tracked.chain, tracked.token)
					}),
				)

				if (currentPrice == null || Number.isNaN(currentPrice)) {
					logger.warn({ orderId: order.id }, '[LimitOrderMonitor] Price unavailable')
					continue
				}

				await runEffect(
					Effect.gen(function* () {
						const limitOrderService = yield* LimitOrderService
						yield* limitOrderService.updateOrderPrice(order.id, currentPrice)
					}),
				)

				if (!shouldTriggerOrder(order, currentPrice)) {
					continue
				}

				logger.info(
					{ orderId: order.id, currentPrice, targetPrice: order.targetPrice },
					'[LimitOrderMonitor] Triggering order',
				)
				await executeTriggeredOrder(order, currentPrice)
			} catch (error) {
				logger.error({ err: error, orderId: order.id }, '[LimitOrderMonitor] Order check failed')
			}
		}
	} catch (error) {
		logger.error({ err: error }, '[LimitOrderMonitor] Poll failed')
	} finally {
		monitorInFlight = false
	}
}

export function startLimitOrderMonitor(): void {
	if (monitorTimer) {
		return
	}

	monitorTimer = setInterval(() => {
		void pollLimitOrders()
	}, CHECK_INTERVAL_MS)

	void pollLimitOrders()
	logger.info({ intervalMs: CHECK_INTERVAL_MS }, '[LimitOrderMonitor] Started')
}

export async function stopLimitOrderMonitor(): Promise<void> {
	if (monitorTimer) {
		clearInterval(monitorTimer)
		monitorTimer = null
	}

	logger.info('[LimitOrderMonitor] Stopped')
}
