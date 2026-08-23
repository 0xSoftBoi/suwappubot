/**
 * Periodic driver for the autopilot loop.
 *
 * Off unless AUTOPILOT_CYCLE_MINUTES is set — an autonomous trader that starts
 * itself by default is not a feature. Cycles run one agent at a time: they
 * share rate-limited market data and, in live mode, a spend budget, so
 * overlapping them would race both.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { AutopilotService } from '../AutopilotService'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function runAllActiveAgents(): Promise<void> {
	// A cycle can outlive its interval on a slow market fetch; skip rather than
	// stack, so a backlog never turns into concurrent trading.
	if (running) {
		logger.warn('autopilot: previous cycle still running, skipping this tick')
		return
	}
	running = true
	try {
		const agents = await runEffect(
			Effect.gen(function* () {
				const svc = yield* AutopilotService
				return yield* svc.listAgents()
			}),
		)

		for (const agent of agents.filter((a) => a.status === 'active')) {
			try {
				const report = await runEffect(
					Effect.gen(function* () {
						const svc = yield* AutopilotService
						return yield* svc.runCycle(agent.slug)
					}),
				)
				logger.info(
					{
						agent: agent.slug,
						mode: agent.mode,
						scanned: report.candidatesScanned,
						sealed: report.decisionsSealed,
						executed: report.decisionsExecuted,
						rejections: report.rejections,
						equityUsd: report.equityUsd,
					},
					'autopilot: cycle complete',
				)
			} catch (err) {
				logger.error({ agent: agent.slug, err: String(err) }, 'autopilot: cycle failed')
			}
		}
	} catch (err) {
		logger.error({ err: String(err) }, 'autopilot: scheduler tick failed')
	} finally {
		running = false
	}
}

export function startAutopilotScheduler(cycleMinutes: number): void {
	if (timer) return
	if (!Number.isFinite(cycleMinutes) || cycleMinutes <= 0) {
		logger.info('autopilot: scheduler disabled (AUTOPILOT_CYCLE_MINUTES is 0)')
		return
	}
	const intervalMs = Math.max(1, Math.floor(cycleMinutes)) * 60_000
	timer = setInterval(() => {
		void runAllActiveAgents()
	}, intervalMs)
	logger.info({ cycleMinutes }, 'autopilot: scheduler started')
}

export function stopAutopilotScheduler(): void {
	if (timer) {
		clearInterval(timer)
		timer = null
	}
}

/** Exposed for tests. */
export function isAutopilotSchedulerRunning(): boolean {
	return timer !== null
}
