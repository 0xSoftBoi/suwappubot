import { z } from 'zod'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'must be a positive integer string in minor units')
const human = z.string().regex(/^\d+(\.\d+)?$/, 'must be a decimal string')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')

export const OpenAccountSchema = z.object({
	// MONEY-PATH: escrow/pool are service-opened only (a user-opened escrow/pool account would be un-spendable by design).
	kind: z.enum(['checking', 'savings', 'credit', 'treasury']).default('checking'),
	asset: z.string().min(2).max(16),
	chain: z.string().min(2).max(32),
	label: z.string().max(80).optional(),
	segmentProfile: z.string().max(32).optional(),
})

export const TransferSchema = z
	.object({
		idempotencyKey: idem.optional(),
		fromAccountId: z.string().min(1).max(64),
		toAccountId: z.string().min(1).max(64).optional(),
		toExternal: z.object({ address: z.string().min(20).max(128) }).optional(),
		amountMinor: minor.optional(),
		amount: human.optional(),
		memo: z.string().max(280).optional(),
	})
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor or amount' })
	.refine((v) => (v.toAccountId ? 1 : 0) + (v.toExternal ? 1 : 0) === 1, { message: 'provide exactly one of toAccountId or toExternal' })

export const FxQuoteSchema = z
	.object({
		fromAccountId: z.string().min(1).max(64),
		toAccountId: z.string().min(1).max(64),
		amountMinor: minor.optional(),
		amount: human.optional(),
		slippage: z.number().min(0.0001).max(0.05).optional(),
		requireDirect: z.boolean().optional(),
	})
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor or amount' })

export const FxExecuteSchema = FxQuoteSchema.safeExtend({
	idempotencyKey: idem.optional(),
	minToMinor: minor.optional(),
})
