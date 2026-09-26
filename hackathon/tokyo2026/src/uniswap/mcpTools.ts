/**
 * MCP tools for Uniswap Trading API.
 *
 * Broader ecosystem tooling is explicitly eligible for the Uniswap prize.
 * These tools let ANY MCP-capable agent (not just Suwappu's) quote and plan
 * Uniswap swaps with the same safety semantics: quote → approval check →
 * execution payload, never a blind transaction.
 *
 * Wire into api-ts/src/routes/mcp.ts (or the MCP server module) by
 * registering each tool's { name, description, schema, handler }.
 */
import { z } from 'zod'
import { UniswapTradingProvider } from './routeAdapter.ts'

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x address')

export interface McpTool {
	name: string
	description: string
	schema: z.ZodTypeAny
	handler: (args: unknown) => Promise<unknown>
}

const quoteArgs = z.object({
	tokenInChainId: z.number().int(),
	tokenOutChainId: z.number().int(),
	tokenIn: addressSchema,
	tokenOut: addressSchema,
	amount: z.string().regex(/^\d+$/, 'raw units, integer string'),
	type: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']).default('EXACT_INPUT'),
	swapper: addressSchema.optional(),
	routingPreference: z.enum(['CLASSIC', 'UNISWAPX', 'BEST_PRICE']).default('BEST_PRICE'),
})

const approvalArgs = z.object({
	chainId: z.number().int(),
	token: addressSchema,
	wallet: addressSchema,
	amount: z.string().regex(/^\d+$/),
})

export function uniswapMcpTools(provider = new UniswapTradingProvider()): McpTool[] {
	return [
		{
			name: 'uniswap_quote',
			description:
				'Get the best Uniswap swap route (Classic or UniswapX) for a token pair. ' +
				'Returns route type, amounts, USD value and gas estimate. Does not execute.',
			schema: quoteArgs,
			handler: async (args) => provider.quote(quoteArgs.parse(args)),
		},
		{
			name: 'uniswap_check_approval',
			description:
				'Check whether a wallet has approved the Uniswap router for a token amount ' +
				'(Permit2-aware). Call before requesting a swap transaction.',
			schema: approvalArgs,
			handler: async (args) => provider.ensureApproval(approvalArgs.parse(args)),
		},
		{
			name: 'uniswap_build_execution',
			description:
				'Build the executable for a quoted route: a transaction request for ' +
				'Classic/wrap/unwrap/bridge routes, or a UniswapX order payload for ' +
				'Dutch/Priority routes. Input is the raw quote object from uniswap_quote.',
			schema: z.object({
				quote: z.unknown(),
				slippageBps: z.number().int().min(1).max(5000).optional(),
				recipient: addressSchema.optional(),
				deadlineSeconds: z.number().int().positive().optional(),
			}),
			handler: async (args) => {
				const parsed = (z.object({
					quote: z.unknown(),
					slippageBps: z.number().int().min(1).max(5000).optional(),
					recipient: addressSchema.optional(),
					deadlineSeconds: z.number().int().positive().optional(),
				})).parse(args)
				// The quote must be a normalized quote produced by uniswap_quote.
				const q = parsed.quote as Parameters<UniswapTradingProvider['buildExecution']>[0]
				if (!q || typeof q !== 'object' || (q as { source?: string }).source !== 'uniswap') {
					throw new Error('quote must come from uniswap_quote')
				}
				return provider.buildExecution(q, {
					slippageBps: parsed.slippageBps,
					recipient: parsed.recipient,
					deadlineSeconds: parsed.deadlineSeconds,
				})
			},
		},
	]
}
