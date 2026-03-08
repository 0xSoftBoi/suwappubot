import { z } from 'zod'

export const RegisterAgentSchema = z.object({
	name: z
		.string()
		.min(3, 'Name must be at least 3 characters')
		.max(50, 'Name must be at most 50 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with underscores and hyphens only'),
	description: z.string().max(500).optional(),
	callback_url: z.url('Invalid callback URL').optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})

export const QuoteRequestSchema = z.object({
	from_token: z.string().min(1, 'from_token is required'),
	to_token: z.string().min(1, 'to_token is required'),
	amount: z
		.string()
		.min(1, 'amount is required')
		.refine((v) => {
			const n = parseFloat(v)
			return !isNaN(n) && n > 0
		}, 'amount must be a positive number'),
	chain: z.string().optional(),
	from_chain: z.string().optional(),
	to_chain: z.string().optional(),
	wallet_address: z.string().optional(),
	slippage: z.number().min(0).max(1).optional(),
})

export const SwapRequestSchema = z.object({
	quote_id: z.string().optional(),
	from_token: z.string().optional(),
	to_token: z.string().optional(),
	amount: z.string().optional(),
	chain: z.string().optional(),
	wallet_address: z.string().min(1, 'wallet_address is required'),
	slippage: z.number().min(0).max(1).optional(),
})

export const ExecuteCommandSchema = z.object({
	command: z.string().min(1, 'command is required').max(500),
	wallet_address: z.string().optional(),
})

export const UpdateAgentSchema = z
	.object({
		description: z.string().max(500).optional(),
		callback_url: z.url('Invalid callback URL').nullish(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine(
		(data) =>
			data.description !== undefined ||
			data.callback_url !== undefined ||
			data.metadata !== undefined,
		'At least one field must be provided',
	)

export const CreatePolicySchema = z.object({
	type: z.enum(['spending_limit', 'whitelist']),
	params: z.object({
		maxAmountWei: z.string().optional(),
		timeWindowSeconds: z.number().optional(),
		allowedAddresses: z.array(z.string()).optional(),
	}),
})

/** Format Zod errors into a flat field map */
export const ExecuteSwapSchema = z.object({
	quote_id: z.string().min(1, 'quote_id is required'),
})

export const SwapStatusQuerySchema = z.object({
	status: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
})

export const WebhookEventsQuerySchema = z.object({
	status: z.string().optional(),
	event_type: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
})

export function formatZodErrors(error: z.ZodError): Record<string, string> {
	const fields: Record<string, string> = {}
	for (const issue of error.issues) {
		const path = issue.path.join('.') || '_root'
		fields[path] = issue.message
	}
	return fields
}
