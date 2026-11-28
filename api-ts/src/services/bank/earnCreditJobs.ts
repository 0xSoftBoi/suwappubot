/**
 * Recurring M2/M3 work, run from the bank reconciler tick (reconciler.ts):
 * earn pending-op confirmation, daily snapshots, auto-sweep, credit pending-op settlement, LTV monitor.
 * Each step is isolated so one failure never blocks the others.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { BankCreditService } from './BankCreditService'
import { BankEarnService } from './BankEarnService'

let running = false
let lastHeavy = 0
const HEAVY_EVERY_MS = 5 * 60_000 // sweep + snapshot + LTV monitor cadence (idempotent per period / per level change)

export async function runEarnCreditJobsOnce(): Promise<void> {
	if (running) return
	running = true
	try {
		const step = async <A>(name: string, eff: Effect.Effect<A, unknown, never>) => {
			try {
				const r = await runEffect(eff as never)
				logger.info({ step: name, r }, 'bank: earn/credit job')
			} catch (err) {
				logger.error({ step: name, err: String(err) }, 'bank: earn/credit job failed')
			}
		}
		await step('earn.confirmPendingOps', Effect.gen(function* () { return yield* (yield* BankEarnService).confirmPendingOps() }) as never)
		await step('credit.settlePending', Effect.gen(function* () { return yield* (yield* BankCreditService).settlePendingPoolOps() }) as never)
		if (Date.now() - lastHeavy >= HEAVY_EVERY_MS) {
			lastHeavy = Date.now()
			await step('earn.sweep', Effect.gen(function* () { return yield* (yield* BankEarnService).runSweep() }) as never)
			await step('earn.snapshot', Effect.gen(function* () { return yield* (yield* BankEarnService).snapshotPositions() }) as never)
			await step('credit.ltvMonitor', Effect.gen(function* () { return yield* (yield* BankCreditService).runLtvMonitor() }) as never)
		}
	} finally {
		running = false
	}
}
