/**
 * Pending-transfer reconciler. Same recurring-job pattern as
 * services/autopilot/scheduler.ts: setInterval, skip-if-running, start/stop from index.ts.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { BankTransferService } from './BankTransferService'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function runBankReconcileOnce(): Promise<void> {
	if (running) return
	running = true
	try {
		const r = await runEffect(
			Effect.gen(function* () {
				const svc = yield* BankTransferService
				return yield* svc.confirmPending({ limit: 100 })
			}),
		)
		if (r.checked > 0) logger.info(r, 'bank: reconciler tick')
	} catch (err) {
		logger.error({ err: String(err) }, 'bank: reconciler tick failed')
	} finally {
		running = false
	}
}

/** seconds <= 0 disables. */
export function startBankReconciler(seconds: number): void {
	if (timer) return
	if (!Number.isFinite(seconds) || seconds <= 0) {
		logger.info('bank: reconciler disabled (BANK_RECONCILE_SECONDS is 0)')
		return
	}
	timer = setInterval(() => void runBankReconcileOnce(), Math.max(5, Math.floor(seconds)) * 1000)
	logger.info({ seconds }, 'bank: reconciler started')
}

export function stopBankReconciler(): void {
	if (timer) {
		clearInterval(timer)
		timer = null
	}
}
