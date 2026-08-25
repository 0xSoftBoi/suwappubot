/**
 * Periodic driver for tenant-bot automations.
 *
 * Off unless TENANT_BOT_TICK_SECONDS is set. A process that starts spending
 * other people's treasuries the moment it boots is not a default anybody
 * should get by accident — the same reasoning as the autopilot scheduler next
 * door, and for higher stakes, since these are not our funds.
 *
 * Overlap is skipped rather than queued: a tick that runs long is a tick that
 * is mid-broadcast, and stacking a second pass on top of it is how you get two
 * burns for one slot. The row claim and the idempotency key would both catch
 * it, but the cheapest place to not have the problem is here.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { TenantBotExecutor } from '../TenantBotExecutorService'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function runDueAutomations(): Promise<number> {
	if (running) {
		logger.warn('tenant bots: previous tick still running, skipping')
		return 0
	}
	running = true
	try {
		const results = await runEffect(
			Effect.gen(function* () {
				const exec = yield* TenantBotExecutor
				return yield* exec.runDue()
			}),
		)
		if (results.length > 0) {
			const byStatus = results.reduce<Record<string, number>>((acc, r) => {
				acc[r.status] = (acc[r.status] ?? 0) + 1
				return acc
			}, {})
			logger.info({ ran: results.length, ...byStatus }, 'tenant bot automations ticked')
		}
		return results.length
	} catch (e) {
		// One bad tick must not kill the interval — the next one may well work.
		logger.error({ err: e instanceof Error ? e.message : String(e) }, 'tenant bot tick failed')
		return 0
	} finally {
		running = false
	}
}

export function startTenantBotScheduler(tickSeconds: number): void {
	if (!tickSeconds || tickSeconds <= 0) {
		logger.info('tenant bots: scheduler disabled (TENANT_BOT_TICK_SECONDS is 0)')
		return
	}
	// A minute is the finest granularity a 5-field cron can express, so ticking
	// faster only adds load and duplicate-claim churn.
	const seconds = Math.max(30, tickSeconds)
	logger.info({ seconds }, 'tenant bots: scheduler started')
	timer = setInterval(() => void runDueAutomations(), seconds * 1000)
}

export function stopTenantBotScheduler(): void {
	if (timer) {
		clearInterval(timer)
		timer = null
	}
}
