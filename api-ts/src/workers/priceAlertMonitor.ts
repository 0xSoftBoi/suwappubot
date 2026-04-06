import { Effect } from 'effect'
import { logger } from '../lib/logger'
import { runEffect } from '../runtime'
import { AlertService } from '../services/AlertService'

const CHECK_INTERVAL_MS = Number(process.env.PRICE_ALERT_CHECK_INTERVAL_MS || 60_000)

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorInFlight = false

function shouldTrigger(condition: string, targetPrice: number, currentPrice: number): boolean {
	return condition === 'below' ? currentPrice <= targetPrice : currentPrice >= targetPrice
}

async function pollPriceAlerts(): Promise<void> {
	if (monitorInFlight) {
		logger.warn('[PriceAlertMonitor] Previous check still running, skipping overlap')
		return
	}

	monitorInFlight = true

	try {
		const alerts = await runEffect(
			Effect.gen(function* () {
				const alertService = yield* AlertService
				return yield* alertService.getActiveAlerts()
			}),
		)

		for (const alert of alerts) {
			try {
				const currentPrice = await runEffect(
					Effect.gen(function* () {
						const alertService = yield* AlertService
						return yield* alertService.getTokenPrice(alert.tokenSymbol)
					}),
				)

				if (currentPrice == null || Number.isNaN(currentPrice)) {
					continue
				}

				if (!shouldTrigger(alert.condition, alert.targetPrice, currentPrice)) {
					continue
				}

				await runEffect(
					Effect.gen(function* () {
						const alertService = yield* AlertService
						yield* alertService.markTriggered(alert.id)
					}),
				)

				logger.info(
					{ alertId: alert.id, token: alert.tokenSymbol, currentPrice, targetPrice: alert.targetPrice },
					'[PriceAlertMonitor] Alert triggered',
				)
			} catch (error) {
				logger.error({ err: error, alertId: alert.id }, '[PriceAlertMonitor] Alert check failed')
			}
		}
	} catch (error) {
		logger.error({ err: error }, '[PriceAlertMonitor] Poll failed')
	} finally {
		monitorInFlight = false
	}
}

export function startPriceAlertMonitor(): void {
	if (monitorTimer) return

	monitorTimer = setInterval(() => {
		void pollPriceAlerts()
	}, CHECK_INTERVAL_MS)

	void pollPriceAlerts()
	logger.info({ intervalMs: CHECK_INTERVAL_MS }, '[PriceAlertMonitor] Started')
}

export async function stopPriceAlertMonitor(): Promise<void> {
	if (monitorTimer) {
		clearInterval(monitorTimer)
		monitorTimer = null
	}

	logger.info('[PriceAlertMonitor] Stopped')
}
