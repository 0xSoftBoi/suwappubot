/**
 * Bank cards routes (M6) — webapp (/webapp/bank/cards) + agent (/v1/agent/bank/cards).
 * Card details (PAN/CVC) are never returned: use POST /cards/:id/reveal-key and reveal client-side.
 */
import { Effect } from 'effect'
import { z } from 'zod'
import { BankCardService } from '../../services/bank/BankCardService'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const addr = z.object({
	line1: z.string().min(1).max(200),
	line2: z.string().max(200).optional(),
	city: z.string().min(1).max(100),
	state: z.string().max(100).optional(),
	postalCode: z.string().min(1).max(20),
	country: z.string().length(2),
})
const IssueSchema = z.object({
	accountId: z.string().min(1).max(64),
	idempotencyKey: z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-'),
	type: z.enum(['virtual', 'physical']).default('virtual'),
	provider: z.enum(['stripe', 'rain']).optional(),
	label: z.string().max(80).optional(),
	rules: z.record(z.string(), z.unknown()).optional(),
	orgId: z.string().max(64).optional(),
	memberId: z.string().max(64).optional(),
	teamId: z.string().max(64).optional(),
	expenseCategory: z.string().max(64).optional(),
	memo: z.string().max(280).optional(),
	termsAccepted: z.boolean().optional(),
	cardholder: z
		.object({
			name: z.string().min(1).max(100),
			email: z.string().email().optional(),
			phoneNumber: z.string().max(32).optional(),
			billing: addr,
			individual: z
				.object({
					firstName: z.string().min(1).max(60),
					lastName: z.string().min(1).max(60),
					dob: z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(2100) }),
				})
				.optional(),
		})
		.optional(),
	shipping: addr.extend({ name: z.string().min(1).max(100), speed: z.enum(['standard', 'express', 'priority']).optional() }).optional(),
})
const StatusBodyless = z.object({}).passthrough()
const RulesSchema = z.object({ rules: z.record(z.string(), z.unknown()) })
const SimulateSchema = z.object({
	amountMinor: z.string().regex(/^\d{1,30}$/),
	merchantName: z.string().max(200).optional(),
	mcc: z.string().regex(/^\d{4}$/).optional(),
	country: z.string().length(2).optional(),
	at: z.string().max(40).optional(),
	rules: z.record(z.string(), z.unknown()).optional(),
})
const RevealSchema = z.object({ nonce: z.string().min(1).max(256) })
const ReceiptSchema = z.object({
	url: z.string().url().max(1000).optional(),
	filename: z.string().max(200).optional(),
	mime: z.string().max(100).optional(),
	sizeBytes: z.number().int().nonnegative().optional(),
	sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
	note: z.string().max(500).optional(),
})
const ExpenseSchema = z.object({ expenseCategory: z.string().max(64).optional(), memo: z.string().max(280).optional() })

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) =>
		c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)
	const lim = (v: string | undefined) => Math.min(Math.max(Number(v ?? 50) || 50, 1), 200)

	app.post('/cards', async (c) => {
		const owner = await resolveOwner(c)
		const p = IssueSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? undefined
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				const { card, created } = yield* svc.issueCard(owner, { ...p.data, clientIp: ip } as Parameters<typeof svc.issueCard>[1])
				return { card, created }
			}),
		)
	})

	app.get('/cards', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { cards: yield* svc.listCards(owner, { accountId: c.req.query('accountId'), memberId: c.req.query('memberId'), orgId: c.req.query('orgId') }) }
			}),
		)
	})

	app.get('/cards/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return yield* svc.getCard(owner, c.req.param('id'))
			}),
		)
	})

	for (const [path, status] of [['freeze', 'frozen'], ['unfreeze', 'active'], ['cancel', 'canceled']] as const) {
		app.post(`/cards/:id/${path}`, async (c) => {
			const owner = await resolveOwner(c)
			void StatusBodyless
			return run(
				c,
				Effect.gen(function* () {
					const svc = yield* BankCardService
					return { card: yield* svc.setStatus(owner, c.req.param('id'), status) }
				}),
			)
		})
	}

	app.put('/cards/:id/rules', async (c) => {
		const owner = await resolveOwner(c)
		const p = RulesSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { card: yield* svc.updateRules(owner, c.req.param('id'), p.data.rules) }
			}),
		)
	})

	app.post('/cards/:id/simulate', async (c) => {
		const owner = await resolveOwner(c)
		const p = SimulateSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { simulation: yield* svc.simulate(owner, c.req.param('id'), p.data) }
			}),
		)
	})

	app.post('/cards/:id/reveal-key', async (c) => {
		const owner = await resolveOwner(c)
		const p = RevealSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		c.header('Cache-Control', 'no-store')
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return yield* svc.revealKey(owner, c.req.param('id'), p.data.nonce)
			}),
		)
	})

	app.get('/cards/:id/transactions', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { transactions: yield* svc.listTransactions(owner, c.req.param('id'), lim(c.req.query('limit'))) }
			}),
		)
	})

	app.get('/cards/:id/authorizations', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { authorizations: yield* svc.listAuthorizations(owner, c.req.param('id'), lim(c.req.query('limit'))) }
			}),
		)
	})

	app.post('/cards/authorizations/:authId/receipts', async (c) => {
		const owner = await resolveOwner(c)
		const p = ReceiptSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { authorization: yield* svc.addReceipt(owner, c.req.param('authId'), p.data) }
			}),
		)
	})

	app.patch('/cards/authorizations/:authId', async (c) => {
		const owner = await resolveOwner(c)
		const p = ExpenseSchema.safeParse(await readJson(c))
		if (!p.success) return bad(c, formatZodErrors(p.error))
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return { authorization: yield* svc.setExpense(owner, c.req.param('authId'), p.data) }
			}),
		)
	})

	app.post('/cards/settlements/retry', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const svc = yield* BankCardService
				return yield* svc.retrySettlements(owner)
			}),
		)
	})
}
