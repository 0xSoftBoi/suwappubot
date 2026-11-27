/**
 * M9 Business banking routes (mounted under /webapp/bank and /v1/agent/bank).
 * The org id is ALWAYS taken from the URL (or from a stored row) and every
 * handler's service call performs the membership + role check server-side.
 * Agents act as the member their API key is bound to (agents.owner_user_id).
 */
import type { Context } from 'hono'
import { Effect } from 'effect'
import { z } from 'zod'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import type { MainLayerContext } from '../../services/MainLayer'
import { BankApprovalService } from '../../services/bank/BankApprovalService'
import { BankBooksService } from '../../services/bank/BankBooksService'
import { BankOrgService } from '../../services/bank/BankOrgService'
import { BankPayablesService, runDueBills, startBillRunner } from '../../services/bank/BankPayablesService'
import { BankTreasuryService } from '../../services/bank/BankTreasuryService'
import type { BankOwner } from '../../services/bank/db'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const role = z.enum(['owner', 'admin', 'approver', 'accountant', 'member', 'viewer'])
const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const minorOrZero = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, 'non-negative integer string in minor units')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)
const date = z.coerce.date()
const ccy = z.string().length(3)

const S = {
	createOrg: z.object({ name: z.string().min(1).max(200), reportingCurrency: ccy.default('USD') }),
	updateOrg: z.object({ name: z.string().min(1).max(200).optional(), reportingCurrency: ccy.optional() }),
	patchMember: z.object({ role: role.optional(), team: z.string().max(64).nullable().optional() }),
	invite: z.object({ role, team: z.string().max(64).optional(), email: z.string().email().max(200).optional(), ttlHours: z.number().int().min(1).max(168).default(72) }),
	accept: z.object({ token: z.string().min(20).max(2000) }),
	account: z.object({ kind: z.enum(['checking', 'savings', 'treasury']).default('checking'), asset: z.string().min(2).max(16), chain: z.string().min(2).max(32), label: z.string().max(80).optional() }),
	policy: z.object({
		ruleType: z.enum(['transfer_over', 'new_payee', 'payroll_run']),
		thresholdMinor: minorOrZero.optional(),
		requiredApprovals: z.number().int().min(1).max(10).default(1),
		approverRoles: z.array(role).min(1),
		expiryHours: z.number().int().min(1).max(720).default(72),
	}),
	approvalReq: z.object({ action: z.enum(['payroll_run', 'new_payee']), payload: z.record(z.string(), z.unknown()) }),
	decide: z.object({ comment: z.string().max(280).optional() }),
	transfer: z
		.object({
			idempotencyKey: idem.optional(),
			fromAccountId: z.string().min(1).max(64),
			toAccountId: z.string().min(1).max(64).optional(),
			toExternal: z.object({ address: z.string().min(20).max(128) }).optional(),
			amountMinor: minor,
			memo: z.string().max(280).optional(),
			categoryId: z.string().max(64).optional(),
			approvalToken: z.string().max(4000).optional(),
		})
		.refine((v) => !!v.toAccountId !== !!v.toExternal, { message: 'provide exactly one of toAccountId or toExternal' }),
	treasuryPolicy: z.object({ accountId: z.string().min(1).max(64), floorMinor: minorOrZero, sweepEnabled: z.boolean().default(false), sweepVaultId: z.string().max(96).optional(), minSweepMinor: minorOrZero.default('0') }),
	sweep: z.object({ idempotencyKey: idem }),
	vendor: z.object({ name: z.string().min(1).max(200), email: z.string().email().optional(), payAddress: z.string().min(20).max(128).optional(), payChain: z.string().max(32).optional(), categoryId: z.string().max(64).optional() }),
	bill: z.object({ vendorId: z.string().min(1).max(64), reference: z.string().max(120).optional(), amountMinor: minor, asset: z.string().min(2).max(16), chain: z.string().min(2).max(32), dueDate: date, categoryId: z.string().max(64).optional() }),
	schedule: z.object({ payFromAccountId: z.string().min(1).max(64), scheduledFor: date }),
	category: z.object({ code: z.string().regex(/^[0-9A-Za-z.-]{1,16}$/), name: z.string().min(1).max(120), kind: z.enum(['income', 'expense', 'transfer', 'asset', 'liability', 'equity']) }),
	categorize: z.object({ categoryId: z.string().max(64).nullable() }),
	close: z.object({ through: date }),
	cardBudget: z.object({ scope: z.enum(['member', 'team']), scopeId: z.string().min(1).max(64), monthlyCapMinor: minorOrZero.nullable().optional(), perTxCapMinor: minorOrZero.nullable().optional(), categoryBudgets: z.record(z.string(), minorOrZero).optional() }),
}

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps

	type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
	const route = <T>(
		method: Method,
		path: string,
		schema: z.ZodType<T> | null,
		fn: (owner: BankOwner, p: (k: string) => string, body: T, q: (k: string) => string | undefined) => Effect.Effect<unknown, unknown, MainLayerContext>,
	): void => {
		app.on(method.toUpperCase(), path, async (c: Context) => {
			const owner = await resolveOwner(c)
			let body = undefined as T
			if (schema) {
				const parsed = schema.safeParse((await readJson(c)) ?? {})
				if (!parsed.success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) }, 400)
				body = parsed.data
			}
			return run(c, fn(owner, (k) => c.req.param(k) as string, body, (k) => c.req.query(k)) as Effect.Effect<never, never, MainLayerContext>)
		})
	}
	const range = (q: (k: string) => string | undefined) => {
		const f = q('from'), t = q('to')
		return { from: f ? new Date(f) : undefined, to: t ? new Date(t) : undefined }
	}

	// Orgs
	route('post', '/orgs', S.createOrg, (o, _p, b) => Effect.flatMap(BankOrgService, (s) => s.createOrg({ owner: o, ...b })))
	route('get', '/orgs', null, (o) => Effect.flatMap(BankOrgService, (s) => s.listOrgs(o)))
	route('post', '/org-invites/accept', S.accept, (o, _p, b) => Effect.flatMap(BankOrgService, (s) => s.acceptInvite(o, b.token)))
	route('get', '/orgs/:orgId', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.getOrg(o, p('orgId'))))
	route('patch', '/orgs/:orgId', S.updateOrg, (o, p, b) => Effect.flatMap(BankOrgService, (s) => s.updateOrg(o, p('orgId'), b)))
	route('get', '/orgs/:orgId/audit', null, (o, p, _b, q) => Effect.flatMap(BankOrgService, (s) => s.listAudit(o, p('orgId'), Number(q('limit') ?? 100) || 100)))

	// Members & invites
	route('get', '/orgs/:orgId/members', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.listMembers(o, p('orgId'))))
	route('patch', '/orgs/:orgId/members/:userId', S.patchMember, (o, p, b) => Effect.flatMap(BankOrgService, (s) => s.updateMember(o, p('orgId'), Number(p('userId')), b)))
	route('delete', '/orgs/:orgId/members/:userId', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.removeMember(o, p('orgId'), Number(p('userId')))))
	route('post', '/orgs/:orgId/invites', S.invite, (o, p, b) => Effect.flatMap(BankOrgService, (s) => s.createInvite(o, p('orgId'), b)))
	route('delete', '/orgs/:orgId/invites/:inviteId', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.revokeInvite(o, p('orgId'), p('inviteId'))))

	// Accounts + transfers
	route('get', '/orgs/:orgId/accounts', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.listAccounts(o, p('orgId'))))
	route('post', '/orgs/:orgId/accounts', S.account, (o, p, b) => Effect.flatMap(BankOrgService, (s) => s.openAccount(o, p('orgId'), b)))
	app.post('/orgs/:orgId/transfers', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = S.transfer.safeParse((await readJson(c)) ?? {})
		if (!parsed.success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) }, 400)
		const idempotencyKey = parsed.data.idempotencyKey ?? c.req.header('Idempotency-Key')?.trim()
		if (!idempotencyKey) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: { idempotencyKey: 'required (body field or Idempotency-Key header)' } }, 400)
		const orgId = c.req.param('orgId')
		return run(c, Effect.flatMap(BankApprovalService, (s) => s.transfer(owner, orgId, { ...parsed.data, idempotencyKey })))
	})

	// Approvals
	route('get', '/orgs/:orgId/approval-policies', null, (o, p) => Effect.flatMap(BankApprovalService, (s) => s.listPolicies(o, p('orgId'))))
	route('post', '/orgs/:orgId/approval-policies', S.policy, (o, p, b) => Effect.flatMap(BankApprovalService, (s) => s.createPolicy(o, p('orgId'), b)))
	route('delete', '/orgs/:orgId/approval-policies/:policyId', null, (o, p) => Effect.flatMap(BankApprovalService, (s) => s.deletePolicy(o, p('orgId'), p('policyId'))))
	route('get', '/orgs/:orgId/approval-requests', null, (o, p, _b, q) => Effect.flatMap(BankApprovalService, (s) => s.listRequests(o, p('orgId'), q('status'))))
	route('post', '/orgs/:orgId/approval-requests', S.approvalReq, (o, p, b) => Effect.flatMap(BankApprovalService, (s) => s.requestApproval(o, p('orgId'), b)))
	route('post', '/approval-requests/:id/approve', S.decide, (o, p, b) => Effect.flatMap(BankApprovalService, (s) => s.decide(o, p('id'), 'approve', b.comment)))
	route('post', '/approval-requests/:id/reject', S.decide, (o, p, b) => Effect.flatMap(BankApprovalService, (s) => s.decide(o, p('id'), 'reject', b.comment)))
	route('post', '/approval-requests/:id/token', null, (o, p) => Effect.flatMap(BankApprovalService, (s) => s.issueToken(o, p('id'))))
	route('post', '/approval-requests/:id/cancel', null, (o, p) => Effect.flatMap(BankApprovalService, (s) => s.cancelRequest(o, p('id'))))

	// Treasury
	route('get', '/orgs/:orgId/treasury', null, (o, p, _b, q) => Effect.flatMap(BankTreasuryService, (s) => s.consolidated(o, p('orgId'), { reconcile: q('reconcile') === 'true' })))
	route('get', '/orgs/:orgId/treasury/runway', null, (o, p) => Effect.flatMap(BankTreasuryService, (s) => s.runway(o, p('orgId'))))
	route('get', '/orgs/:orgId/treasury/fx-exposure', null, (o, p) => Effect.flatMap(BankTreasuryService, (s) => s.fxExposure(o, p('orgId'))))
	route('get', '/orgs/:orgId/treasury/policies', null, (o, p) => Effect.flatMap(BankTreasuryService, (s) => s.listPolicies(o, p('orgId'))))
	route('put', '/orgs/:orgId/treasury/policies', S.treasuryPolicy, (o, p, b) => Effect.flatMap(BankTreasuryService, (s) => s.setPolicy(o, p('orgId'), b)))
	route('get', '/orgs/:orgId/treasury/sweep-plan', null, (o, p) => Effect.flatMap(BankTreasuryService, (s) => s.sweepPlan(o, p('orgId'))))
	route('post', '/orgs/:orgId/treasury/sweep', S.sweep, (o, p, b) => Effect.flatMap(BankTreasuryService, (s) => s.executeSweep(o, p('orgId'), b.idempotencyKey)))

	// Vendors, bills, collections
	route('get', '/orgs/:orgId/vendors', null, (o, p) => Effect.flatMap(BankPayablesService, (s) => s.listVendors(o, p('orgId'))))
	route('post', '/orgs/:orgId/vendors', S.vendor, (o, p, b) => Effect.flatMap(BankPayablesService, (s) => s.createVendor(o, p('orgId'), b)))
	route('get', '/orgs/:orgId/bills', null, (o, p, _b, q) => Effect.flatMap(BankPayablesService, (s) => s.listBills(o, p('orgId'), q('status'))))
	route('post', '/orgs/:orgId/bills', S.bill, (o, p, b) => Effect.flatMap(BankPayablesService, (s) => s.createBill(o, p('orgId'), b)))
	route('post', '/orgs/:orgId/bills/:billId/schedule', S.schedule, (o, p, b) => Effect.flatMap(BankPayablesService, (s) => s.scheduleBill(o, p('orgId'), p('billId'), b)))
	route('post', '/orgs/:orgId/bills/:billId/cancel', null, (o, p) => Effect.flatMap(BankPayablesService, (s) => s.cancelBill(o, p('orgId'), p('billId'))))
	route('get', '/orgs/:orgId/collections/ageing', null, (o, p) => Effect.flatMap(BankPayablesService, (s) => s.ageing(o, p('orgId'))))
	route('get', '/orgs/:orgId/collections/dunning', null, (o, p) => Effect.flatMap(BankPayablesService, (s) => s.listDunning(o, p('orgId'))))
	route('post', '/orgs/:orgId/collections/dunning/run', null, (o, p) => Effect.flatMap(BankPayablesService, (s) => s.runDunning(o, p('orgId'))))

	// Books
	route('get', '/orgs/:orgId/books/categories', null, (o, p) => Effect.flatMap(BankBooksService, (s) => s.listCategories(o, p('orgId'))))
	route('post', '/orgs/:orgId/books/categories', S.category, (o, p, b) => Effect.flatMap(BankBooksService, (s) => s.createCategory(o, p('orgId'), b)))
	route('get', '/orgs/:orgId/books/entries', null, (o, p, _b, q) => Effect.flatMap(BankBooksService, (s) => s.listEntries(o, p('orgId'), { ...range(q), categoryId: q('categoryId'), limit: Number(q('limit') ?? 200) || 200 })))
	route('patch', '/orgs/:orgId/books/entries/:entryId', S.categorize, (o, p, b) => Effect.flatMap(BankBooksService, (s) => s.categorize(o, p('orgId'), p('entryId'), b.categoryId)))
	route('post', '/orgs/:orgId/books/close', S.close, (o, p, b) => Effect.flatMap(BankBooksService, (s) => s.closePeriod(o, p('orgId'), b.through)))
	route('get', '/orgs/:orgId/books/export.csv', null, (o, p, _b, q) => Effect.flatMap(BankBooksService, (s) => s.exportCsv(o, p('orgId'), range(q))))
	route('get', '/orgs/:orgId/books/journal', null, (o, p, _b, q) => Effect.flatMap(BankBooksService, (s) => s.exportJournal(o, p('orgId'), range(q))))

	// Corporate card budgets (consumed by the cards module via getCardBudget)
	route('get', '/orgs/:orgId/card-budgets', null, (o, p) => Effect.flatMap(BankOrgService, (s) => s.listCardBudgets(o, p('orgId'))))
	route('put', '/orgs/:orgId/card-budgets', S.cardBudget, (o, p, b) => Effect.flatMap(BankOrgService, (s) => s.setCardBudget(o, p('orgId'), b)))

	// Recurring bill-payment job (idempotent start; skip-if-running).
	startBillRunner(async () => {
		try {
			const r = await runEffect(runDueBills())
			if (r.started + r.paid + r.failed > 0) logger.info(r, 'bank: bills tick')
		} catch (err) {
			logger.error({ err: String(err) }, 'bank: bills tick failed')
		}
	})
}
