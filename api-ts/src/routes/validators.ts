import { z } from 'zod'
import { isPublicUrl } from './ssrfGuard'

// The SSRF transport guard now lives in ./ssrfGuard. Re-export the pieces other
// modules import so existing import sites keep working after the extraction.
export {
	isPrivateIp,
	isPublicUrl,
	assertUrlSafeForFetch,
	safeFetch,
	type PinnedAddress,
	type SafeFetchInit,
	type SafeFetchResult,
} from './ssrfGuard'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** Maximum swap amount in token units (prevents accidental whole-portfolio swaps). */
const MAX_SWAP_AMOUNT = 1_000_000

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

/** Solana address: base58, 32-44 chars, no 0x prefix (same shape used for wallet lookups in routes/a2a.ts). */
const solanaAddressSchema = z
	.string()
	.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address format')

/** Either an EVM or a Solana wallet address — simulate/quote requests are agnostic to chain_type at the schema level. */
const walletAddressSchema = z.union([evmAddressSchema, solanaAddressSchema])

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

/**
 * POST /v1/agent/swap/simulate — same shape as QuoteRequestSchema, plus an
 * optional quote_id to simulate a previously fetched quote instead of pulling
 * a fresh one. Quote fields are optional when quote_id is supplied.
 */
export const SimulateSwapSchema = z
	.object({
		quote_id: z.string().min(1).optional(),
		from_token: z.string().min(1, 'from_token is required').optional(),
		to_token: z.string().min(1, 'to_token is required').optional(),
		amount: tokenAmountSchema.optional(),
		chain: z.string().optional(),
		from_chain: z.string().optional(),
		to_chain: z.string().optional(),
		wallet_address: walletAddressSchema.optional(),
		slippage: z.number().min(0).max(0.5).optional(),
	})
	.refine(
		(data) => !!data.quote_id || (!!data.from_token && !!data.to_token && !!data.amount),
		'Provide either quote_id, or from_token + to_token + amount',
	)

export const SwapRequestSchema = z.object({
	quote_id: z.string().optional(),
	from_token: z.string().optional(),
	to_token: z.string().optional(),
	amount: z.string().optional(),
	chain: z.string().optional(),
	wallet_address: z.string().min(1, 'wallet_address is required'),
	slippage: z.number().min(0).max(1).optional(),
	// Present when re-submitting an execute call that was previously deferred
	// with a 202 require_approval response — see ApprovalService.consume().
	approval_id: z.string().uuid().optional(),
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
	quote_id: z.string().min(1).optional(),
	// Present when re-submitting an execute call that was previously deferred
	// with a 202 require_approval response — see ApprovalService.consume() and
	// the POST /v1/agent/swap/execute resubmit path.
	approval_id: z.string().uuid().optional(),
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
}).strict()

export const CancelOrderSchema = z.object({
	orderId: z.string().min(1, 'orderId is required'),
})

/**
 * Top-up credits from a verified on-chain USDC payment.
 * `amount` accepts a string or number and is coerced to a number at runtime.
 */
export const TopupSchema = z.object({
	txHash: z.string().min(10).max(128),
	chain: z.string().min(1).max(32).default('base'),
	amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
})

/** Perp position quote request (Hyperliquid). */
export const PerpsQuoteSchema = z.object({
	market: z.string(),
	side: z.enum(['long', 'short']),
	size: z.number().positive(),
	leverage: z.number().min(1).max(20),
})

/** Numeric string (for DB numeric columns) — accepts string or number, stored as string. */
const numericString = z
	.union([z.string(), z.number()])
	.transform((v) => String(v))
	.refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
		message: 'Must be a non-negative number',
	})

/** Create a native P2P offer (webapp). */
export const CreateP2POfferSchema = z
	.object({
		offerType: z.enum(['sell_crypto', 'buy_crypto']),
		fiatCurrency: z.string().length(3).toUpperCase(),
		cryptoAsset: z.string().min(1).max(20),
		cryptoChain: z.string().min(1).max(32).default('base'),
		pricePerUnit: numericString,
		minFiatAmount: numericString,
		maxFiatAmount: numericString,
		availableCrypto: z.string().max(78).optional(),
		paymentMethods: z.array(z.string().min(1).max(64)).min(1).max(20),
		region: z.string().max(8).optional(),
		terms: z.string().max(2000).optional(),
		paymentWindowMinutes: z.number().int().min(5).max(1440).default(30),
		makerWalletId: z.number().int().positive().optional(),
	})
	.refine((d) => Number(d.maxFiatAmount) >= Number(d.minFiatAmount), {
		message: 'maxFiatAmount must be >= minFiatAmount',
		path: ['maxFiatAmount'],
	})

export function formatZodErrors(error: z.ZodError): Record<string, string> {
	const fields: Record<string, string> = {}
	for (const issue of error.issues) {
		const path = issue.path.join('.') || '_root'
		fields[path] = issue.message
	}
	return fields
}

// ---------------------------------------------------------------
// MCP tool argument schemas
// ---------------------------------------------------------------
//
// These back the MCP `inputSchema` for read tools (see mcpTools.ts) so the
// constraints we advertise to agents are the ones the handlers apply.
//
// IMPORTANT on `limit`/`offset`: the handlers CLAMP out-of-range values rather
// than rejecting them (Math.min(Math.max(...))), and that behaviour is
// deliberately preserved — turning a clamp into a 400 would break agents that
// currently pass limit=100 and quietly receive the maximum. The bounds below
// therefore describe the EFFECTIVE range; values outside it are clamped, and
// each description says so, so an agent is never misled into believing it
// received more rows than the cap allows.

/** Wallet address in either EVM or Solana form. Exported for MCP schema derivation. */
export const anyWalletAddressSchema = walletAddressSchema

export const McpGetPortfolioSchema = z.object({
	wallet_address: walletAddressSchema,
	chain: z.string().optional(),
})

export const McpGetPricesSchema = z.object({
	symbols: z.string().min(1),
})

export const McpPerpsPositionsSchema = z.object({
	address: evmAddressSchema,
})

export const McpLendMarketsSchema = z.object({
	chain_id: z.number().int().positive().optional(),
})

export const McpLendMarketSchema = z.object({
	market_id: z.string().min(1),
	chain_id: z.number().int().positive().optional(),
})

export const McpPredictMarketsSchema = z.object({
	query: z.string().optional(),
	limit: z.number().int().min(1).max(50).optional(),
})

/** predict_market/_book/_price all take the same single market id. */
export const McpPredictMarketIdSchema = z.object({
	market_id: z.string().min(1),
})

export const McpPredictTradesSchema = z.object({
	market_id: z.string().min(1),
	limit: z.number().int().min(1).max(100).optional(),
})

export const McpGetSwapStatusSchema = z.object({
	swap_id: z.string().min(1),
})

export const McpGetSwapHistorySchema = z.object({
	status: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
	offset: z.number().int().min(0).optional(),
})

export const McpListWalletPoliciesSchema = z.object({
	wallet_address: walletAddressSchema.optional(),
})
