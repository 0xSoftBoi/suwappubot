import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** Maximum swap amount in token units (prevents accidental whole-portfolio swaps). */
const MAX_SWAP_AMOUNT = 1_000_000

/**
 * Rejects cloud-metadata endpoints, private IP ranges, and other SSRF targets.
 * Used on any user-supplied callback URL before it is stored or fetched.
 */
function isPublicUrl(url: string): boolean {
	try {
		const { hostname } = new URL(url)
		const h = hostname.toLowerCase()
		// Cloud metadata services
		if (h === '169.254.169.254') return false // AWS/GCP/Azure IMDS
		if (h === 'metadata.google.internal') return false
		if (h === 'instance-data.ec2.internal') return false
		// Private / loopback ranges
		if (/^(localhost|0\.0\.0\.0|::1)$/.test(h)) return false
		if (/^127\./.test(h)) return false
		if (/^10\./.test(h)) return false
		if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
		if (/^192\.168\./.test(h)) return false
		return true
	} catch {
		return false
	}
}

const callbackUrlSchema = z
	.string()
	.url('Invalid callback URL')
	.refine(isPublicUrl, 'callback_url must not point to a private or metadata endpoint')

/** EVM address: 0x + 40 hex chars, rejecting the zero address. */
const evmAddressSchema = z
	.string()
	.regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address format')
	.refine(
		(addr) => addr.toLowerCase() !== '0x0000000000000000000000000000000000000000',
		'Zero address is not allowed',
	)

/** Positive token amount with an upper cap to prevent accidental whole-portfolio swaps. */
const tokenAmountSchema = z
	.string()
	.min(1, 'amount is required')
	.refine((v) => {
		const n = parseFloat(v)
		return !isNaN(n) && n > 0
	}, 'amount must be a positive number')
	.refine(
		(v) => parseFloat(v) <= MAX_SWAP_AMOUNT,
		`amount must not exceed ${MAX_SWAP_AMOUNT.toLocaleString()} units`,
	)

// ---------------------------------------------------------------------------
// Exported schemas
// ---------------------------------------------------------------------------

export const RegisterAgentSchema = z.object({
	name: z
		.string()
		.min(3, 'Name must be at least 3 characters')
		.max(50, 'Name must be at most 50 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with underscores and hyphens only'),
	description: z.string().max(500).optional(),
	callback_url: callbackUrlSchema.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})

export const QuoteRequestSchema = z.object({
	from_token: z.string().min(1, 'from_token is required'),
	to_token: z.string().min(1, 'to_token is required'),
	amount: tokenAmountSchema,
	chain: z.string().optional(),
	from_chain: z.string().optional(),
	to_chain: z.string().optional(),
	wallet_address: evmAddressSchema.optional(),
	slippage: z.number().min(0).max(0.5).optional(),
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
		callback_url: callbackUrlSchema.nullish(),
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
		maxAmountWei: z
			.string()
			.regex(/^\d+$/, 'maxAmountWei must be a decimal integer string')
			.optional(),
		timeWindowSeconds: z.number().optional(),
		allowedAddresses: z
			.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'))
			.optional(),
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

export const PlaceOrderSchema = z.object({
	tokenId: z.string().min(1, 'tokenId is required'),
	price: z
		.string()
		.min(1, 'price is required')
		.refine((v) => {
			const n = parseFloat(v)
			return !isNaN(n) && n > 0 && n <= 1
		}, 'price must be between 0 and 1'),
	size: z
		.string()
		.min(1, 'size is required')
		.refine((v) => {
			const n = parseFloat(v)
			return !isNaN(n) && n > 0
		}, 'size must be a positive number'),
	side: z.enum(['BUY', 'SELL']),
	expiration: z.number().optional(),
	feeRateBps: z.number().min(0).max(500).optional(),
})

export const CancelOrderSchema = z.object({
	orderId: z.string().min(1, 'orderId is required'),
})

export function formatZodErrors(error: z.ZodError): Record<string, string> {
	const fields: Record<string, string> = {}
	for (const issue of error.issues) {
		const path = issue.path.join('.') || '_root'
		fields[path] = issue.message
	}
	return fields
}
