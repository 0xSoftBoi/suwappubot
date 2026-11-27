/**
 * Bank job registry: the single place bank background work is scheduled.
 *
 * - registerBankJob(name, defaultIntervalSeconds, fn): idempotent per name.
 * - Per-job overlap protection (in-process) AND a per-job Postgres try-advisory-lock, so with N replicas only one
 *   runs a given job at a time (the lock lives on a reserved connection and dies with it).
 * - Error isolation: each job runs in its own try/catch; one failing job never stops the others.
 * - Switches (EnvService): BANK_JOBS_ENABLED (default true), BANK_JOB_INTERVALS="name=seconds,..." (0 disables a job).
 * - Structured logs: job, durationMs, outcome.
 * Started by startBankReconciler() (src/index.ts); no module may start its own timer.
 */
import { logger } from '../../lib/logger'

export interface BankJob {
	readonly name: string
	readonly defaultSeconds: number
	readonly fn: () => Promise<unknown>
}

const jobs = new Map<string, BankJob>()
const running = new Set<string>()
const timers = new Map<string, ReturnType<typeof setInterval>>()

export const registerBankJob = (name: string, intervalSeconds: number, fn: () => Promise<unknown>): void => {
	jobs.set(name, { name, defaultSeconds: intervalSeconds, fn })
}

export const parseIntervalOverrides = (raw: string): Map<string, number> => {
	const m = new Map<string, number>()
	for (const part of raw.split(',')) {
		const [k, v] = part.split('=').map((x) => x.trim())
		const n = Number(v)
		if (k && v !== undefined && Number.isFinite(n) && n >= 0) m.set(k, n)
	}
	return m
}

/** Runs one job once with overlap + cross-replica protection. Returns false when skipped. */
export async function runBankJob(name: string): Promise<boolean> {
	const job = jobs.get(name)
	if (!job || running.has(name)) return false
	running.add(name)
	const started = Date.now()
	let release: (() => Promise<void>) | null = null
	try {
		const { requireDb } = await import('../../db')
		const { runEffect } = await import('../../runtime')
		const db = await runEffect(requireDb as never) as { $client: { reserve: () => Promise<any> } }
		const conn = await db.$client.reserve()
		const key = `bank-job:${name}`
		const [row] = await conn`select pg_try_advisory_lock(hashtextextended(${key}, 0)) as ok`
		if (!row?.ok) {
			conn.release()
			logger.debug({ job: name }, 'bank: job held by another replica')
			return false
		}
		release = async () => {
			try {
				await conn`select pg_advisory_unlock(hashtextextended(${key}, 0))`
			} finally {
				conn.release()
			}
		}
		await job.fn()
		logger.debug({ job: name, durationMs: Date.now() - started, outcome: 'ok' }, 'bank: job done')
		return true
	} catch (err) {
		logger.error({ job: name, durationMs: Date.now() - started, outcome: 'error', err: String(err) }, 'bank: job failed')
		return false
	} finally {
		if (release) await release().catch(() => undefined)
		running.delete(name)
	}
}

export function startBankJobs(opts: { enabled: boolean; overrides: string }): void {
	if (!opts.enabled) {
		logger.info('bank: jobs disabled (BANK_JOBS_ENABLED=false)')
		return
	}
	const overrides = parseIntervalOverrides(opts.overrides)
	for (const job of jobs.values()) {
		if (timers.has(job.name)) continue
		const secs = overrides.get(job.name) ?? job.defaultSeconds
		if (!Number.isFinite(secs) || secs <= 0) {
			logger.info({ job: job.name }, 'bank: job disabled by interval')
			continue
		}
		const t = setInterval(() => void runBankJob(job.name), Math.max(5, Math.floor(secs)) * 1000)
		;(t as { unref?: () => void }).unref?.()
		timers.set(job.name, t)
		logger.info({ job: job.name, seconds: secs }, 'bank: job scheduled')
	}
}

export function stopBankJobs(): void {
	for (const t of timers.values()) clearInterval(t)
	timers.clear()
}
