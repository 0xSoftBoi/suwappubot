import { Effect } from 'effect'
import { z } from 'zod'
import { BankPayoutPoolService } from '../../services/bank/BankPayoutPoolService'
import { BankPayrollService } from '../../services/bank/BankPayrollService'
import { BankStreamService } from '../../services/bank/BankStreamService'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')
const id = z.string().min(1).max(64)
const owner = z.object({ ownerType: z.enum(['user', 'agent', 'org', 'partner_customer']), ownerId: z.string().min(1).max(64) })

const PayeeSchema = z.object({
	kind: z.enum(['worker', 'contractor']),
	name: z.string().min(1).max(120),
	method: z.enum(['bank_account', 'wallet', 'local_rail']),
	accountId: id.optional(),
	address: z.string().min(20).max(128).optional(),
	chain: z.string().min(2).max(32).optional(),
	railAccountId: z.string().min(1).max(128).optional(),
	rail: z.string().max(24).optional(),
	currency: z.string().length(3),
	linkedOwner: owner.optional(),
	tax: z.record(z.string(), z.unknown()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})
const RunItem = z
	.object({ payeeId: id, amountMinor: minor.optional(), amount: z.string().regex(/^\d+(\.\d+)?$/).optional(), memo: z.string().max(140).optional() })
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor or amount' })
const RunCreate = z.object({ fundingAccountId: id, label: z.string().max(120).optional(), poolId: id.optional(), items: z.array(RunItem).min(1).max(1000) })
const ScheduleCreate = z.object({
	fundingAccountId: id,
	name: z.string().min(1).max(120),
	frequency: z.enum(['weekly', 'biweekly', 'monthly']),
	timezone: z.string().min(1).max(64),
	dayOfWeek: z.number().int().min(0).max(6).optional(),
	dayOfMonth: z.number().int().min(1).max(31).optional(),
	localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
	items: z.array(z.object({ payeeId: id, amountMinor: minor, memo: z.string().max(140).optional(), ewaBps: z.number().int().min(1).max(10_000).optional() })).min(1).max(1000),
	poolId: id.optional(),
	autoApprove: z.boolean().optional(),
})
const PoolCreate = z.object({
	accountId: id.optional(),
	asset: z.string().max(16).optional(),
	chain: z.string().max(32).optional(),
	defaultPayerLimitMinor: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).optional(),
	payerLimits: z.record(z.string(), z.string().regex(/^(0|[1-9][0-9]{0,77})$/)).optional(),
})

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	type C = Parameters<typeof run>[0]
	const bad = (c: C, fields: Record<string, string>) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)
	const withBody = async <S extends z.ZodType>(c: C, schema: S): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: Response }> => {
		const p = schema.safeParse(await readJson(c))
		return p.success ? { ok: true, data: p.data } : { ok: false, res: bad(c, formatZodErrors(p.error)) }
	}
	const keyOf = (c: C, b?: string) => b ?? c.req.header('Idempotency-Key')?.trim()
	const P = BankPayrollService

	// ---- payees
	app.post('/payroll/payees', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, PayeeSchema)
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return { payee: yield* (yield* P).createPayee(o, b.data) } }))
	})
	app.get('/payroll/payees', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { payees: yield* (yield* P).listPayees(o) } }))
	})
	app.post('/payroll/payees/:id/archive', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { payee: yield* (yield* P).archivePayee(o, c.req.param('id')) } }))
	})

	// ---- runs
	app.post('/payroll/runs', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, RunCreate)
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return yield* (yield* P).createRun(o, b.data) }))
	})
	app.get('/payroll/runs', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { runs: yield* (yield* P).listRuns(o) } }))
	})
	app.get('/payroll/runs/:id', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* P).previewRun(o, c.req.param('id')) }))
	})
	app.post('/payroll/runs/:id/approve', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ approvalToken: z.string().min(10).max(2000).optional() }))
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return { run: yield* (yield* P).approveRun(o, c.req.param('id'), b.data.approvalToken) } }))
	})
	app.post('/payroll/runs/:id/execute', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* P).executeRun(o, c.req.param('id')) }))
	})
	app.post('/payroll/runs/:id/retry', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* P).retryFailed(o, c.req.param('id')) }))
	})
	app.get('/payroll/runs/:id/receipts', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { receipts: yield* (yield* P).getReceipts(o, c.req.param('id')) } }))
	})
	/** Payee side: payouts made to payees linked to the caller. */
	app.get('/payroll/my-payouts', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { payouts: yield* (yield* P).myPayouts(o) } }))
	})

	// ---- schedules
	app.post('/payroll/schedules', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, ScheduleCreate)
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return { schedule: yield* (yield* P).createSchedule(o, b.data) } }))
	})
	app.get('/payroll/schedules', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { schedules: yield* (yield* P).listSchedules(o) } }))
	})
	app.post('/payroll/schedules/:id/status', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ status: z.enum(['active', 'paused', 'cancelled']) }))
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return { schedule: yield* (yield* P).setScheduleStatus(o, c.req.param('id'), b.data.status) } }))
	})

	// ---- earned-wage access (worker side)
	app.get('/payroll/ewa/schedules/:id/:payeeId', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* P).scheduleAdvanceAvailable(o, c.req.param('id'), c.req.param('payeeId')) }))
	})
	app.post('/payroll/ewa/schedules/:id/:payeeId/advance', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ amountMinor: minor, idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = keyOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* P).advanceScheduleWages(o, c.req.param('id'), c.req.param('payeeId'), b.data.amountMinor, key) }))
	})
	app.post('/payroll/ewa/streams/:id/advance', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ amountMinor: minor, idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = keyOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankStreamService).advanceWages(o, c.req.param('id'), b.data.amountMinor, key) }))
	})

	// ---- payout pools
	const Pool = BankPayoutPoolService
	app.post('/payroll/pools', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, PoolCreate)
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return yield* (yield* Pool).createPool(o, b.data) }))
	})
	app.get('/payroll/pools', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { pools: yield* (yield* Pool).listPools(o) } }))
	})
	app.get('/payroll/pools/receivables', async (c) => {
		const o = await resolveOwner(c)
		const role = c.req.query('role') === 'operator' ? 'operator' : 'payer'
		return run(c, Effect.gen(function* () { return { receivables: yield* (yield* Pool).listReceivables(o, { role, poolId: c.req.query('poolId') }) } }))
	})
	app.get('/payroll/pools/:id', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* Pool).getPool(o, c.req.param('id')) }))
	})
	app.post('/payroll/pools/:id/limits', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ payer: owner, limitMinor: z.string().regex(/^(0|[1-9][0-9]{0,77})$/) }))
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return yield* (yield* Pool).setPayerLimit(o, c.req.param('id'), b.data.payer, b.data.limitMinor) }))
	})
}
