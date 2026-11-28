/** One tick (scheduled by services/bank/jobs.ts) for M7/M8 (invoice scan, escrow timeouts, stream settlement, payroll schedules, pool collection). */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { BankEscrowService } from './BankEscrowService'
import { BankPaymentsService } from './BankPaymentsService'
import { BankPayoutPoolService } from './BankPayoutPoolService'
import { BankPayrollService } from './BankPayrollService'
import { BankStreamService } from './BankStreamService'


const step = <A, E, R>(name: string, eff: Effect.Effect<A, E, R>) =>
	eff.pipe(Effect.tap((r) => Effect.sync(() => logger.debug({ name, r }, 'bank: payments job step'))), Effect.catchAll((e) => Effect.sync(() => logger.warn({ name, err: String(e) }, 'bank: payments job step failed'))))

export async function runPaymentsJobOnce(): Promise<void> {
	{
		// Cast: the app runtime provides every bank service; each step is isolated so one failure never blocks the rest.
		await runEffect(
			Effect.gen(function* () {
				const pay = yield* BankPaymentsService
				const esc = yield* BankEscrowService
				const str = yield* BankStreamService
				const pr = yield* BankPayrollService
				const pool = yield* BankPayoutPoolService
				yield* step('invoices', pay.runJob())
				yield* step('escrow', esc.runJob())
				yield* step('streams', str.runJob())
				yield* step('payroll', pr.runJob())
				yield* step('pools', pool.runJob())
			}) as unknown as Effect.Effect<void, never, never>,
		)
	}
}
