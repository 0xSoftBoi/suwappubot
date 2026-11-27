/**
 * Bank reconciler + the single bank job scheduler entry point (see jobs.ts for the registry semantics).
 * Started/stopped from index.ts. Every bank background job is registered here; no module runs its own timer.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { BankPartnerService } from './BankPartnerService'
import { runDueBills } from './BankPayablesService'
import { runRemittanceJobOnce } from './BankRemittanceService'
import { BankTransferService } from './BankTransferService'
import { runEarnCreditJobsOnce } from './earnCreditJobs'
import { registerBankJob, runBankJob, startBankJobs, stopBankJobs } from './jobs'
import { runPaymentsJobOnce } from './paymentsJob'

export async function runBankReconcileOnce(): Promise<void> {
	await runBankJob('reconcile')
}

export interface BankSchedulerEnv {
	BANK_RECONCILE_SECONDS: number
	BANK_REMIT_JOB_SECONDS: number
	BANK_JOBS_ENABLED: string
	BANK_JOB_INTERVALS: string
}

function registerAll(env: BankSchedulerEnv): void {
	registerBankJob('reconcile', env.BANK_RECONCILE_SECONDS, async () => {
		const r = await runEffect(Effect.gen(function* () { return yield* (yield* BankTransferService).confirmPending({ limit: 100 }) }))
		if (r.checked > 0) logger.info(r, 'bank: reconciler tick')
	})
	registerBankJob('earn-credit', env.BANK_RECONCILE_SECONDS, runEarnCreditJobsOnce) // M2 sweep/confirm + M3 LTV monitor
	registerBankJob('payments', 60, runPaymentsJobOnce) // invoices, escrow, streams, payroll, pools
	registerBankJob('bills', 60, async () => {
		const r = await runEffect(runDueBills())
		if (r.started + r.paid + r.failed > 0) logger.info(r, 'bank: bills tick')
	})
	registerBankJob('partner-webhooks', 30, () => runEffect(Effect.gen(function* () { return yield* (yield* BankPartnerService).deliverDueWebhooks(50) })))
	registerBankJob('remittance', env.BANK_REMIT_JOB_SECONDS, runRemittanceJobOnce)
}

/** BANK_RECONCILE_SECONDS=0 disables the reconcile + earn-credit jobs; BANK_JOBS_ENABLED=false disables all. */
export function startBankReconciler(env: BankSchedulerEnv): void {
	registerAll(env)
	startBankJobs({ enabled: env.BANK_JOBS_ENABLED.toLowerCase() !== 'false', overrides: env.BANK_JOB_INTERVALS })
}

export function stopBankReconciler(): void {
	stopBankJobs()
}
