#!/usr/bin/env bun
/**
 * check-mcp-schemas.ts — guard the MCP tool catalogue against schema drift.
 *
 * The MCP `inputSchema` we publish is a promise to agents about what arguments
 * are acceptable. `src/routes/validators.ts` is what the server actually
 * enforces. When those disagree, an agent gets a 400 it had no way to predict
 * — which is exactly what happened: `get_quote` advertised `slippage` as an
 * unbounded number against a real cap of 0.5, and `perps_quote` advertised
 * unbounded `leverage` against a cap of 20.
 *
 * This script holds its OWN tool -> validator mapping, deliberately independent
 * of mcp.ts, and asserts the published schema still matches the Zod-derived
 * one. If someone replaces a derived schema with a hand-written literal, this
 * fails. Descriptions are ignored — they are prose, not contract.
 *
 * It also reports coverage: tools with no Zod validator still carry
 * hand-written schemas and can drift freely. Driving that list to zero is
 * Phase 1 of docs/plans/mcp-unification.md.
 *
 * Exit codes: 0 ok, 1 drift detected.
 */
import { z } from 'zod'
import { TOOLS } from '../src/routes/mcpTools'
import { toJsonSchema, type Json } from '../src/lib/zodJsonSchema'
import {
	McpBrowseMppDirectorySchema,
	McpExecuteSwapSchema,
	McpGetPortfolioSchema,
	McpGetPricesSchema,
	McpGetSwapHistorySchema,
	McpGetSwapStatusSchema,
	McpGetTempoTokensSchema,
	McpLendMarketSchema,
	McpLendMarketsSchema,
	McpListChainsSchema,
	McpListTokensSchema,
	McpListWalletPoliciesSchema,
	McpPerpsMarketsSchema,
	McpPerpsPositionsSchema,
	McpPredictMarketIdSchema,
	McpPredictMarketsSchema,
	McpPredictTradesSchema,
	PerpsQuoteSchema,
	QuoteRequestSchema,
	SimulateSwapSchema,
} from '../src/routes/validators'

/**
 * tool name -> the Zod schema whose constraints the tool's arguments must obey.
 *
 * Only map a tool when its arguments really are validated by that schema.
 * `get_swap_status` maps to `McpGetSwapStatusSchema` and `execute_swap` maps
 * to `McpExecuteSwapSchema` — both MCP-only schemas distinct from
 * ExecuteSwapSchema and SwapStatusQuerySchema, which belong to *different*
 * endpoints (the approval-resubmit path and the /swaps list query
 * respectively); mapping those would assert a contract that does not exist.
 */
const TOOL_VALIDATORS: Record<string, z.ZodTypeAny> = {
	get_quote: QuoteRequestSchema,
	simulate_swap: SimulateSwapSchema,
	perps_quote: PerpsQuoteSchema,
	get_portfolio: McpGetPortfolioSchema,
	get_prices: McpGetPricesSchema,
	perps_positions: McpPerpsPositionsSchema,
	perps_markets: McpPerpsMarketsSchema,
	lend_markets: McpLendMarketsSchema,
	lend_market: McpLendMarketSchema,
	predict_markets: McpPredictMarketsSchema,
	predict_market: McpPredictMarketIdSchema,
	predict_book: McpPredictMarketIdSchema,
	predict_price: McpPredictMarketIdSchema,
	predict_trades: McpPredictTradesSchema,
	get_swap_status: McpGetSwapStatusSchema,
	get_swap_history: McpGetSwapHistorySchema,
	list_wallet_policies: McpListWalletPoliciesSchema,
	list_chains: McpListChainsSchema,
	list_tokens: McpListTokensSchema,
	get_tempo_tokens: McpGetTempoTokensSchema,
	browse_mpp_directory: McpBrowseMppDirectorySchema,
	execute_swap: McpExecuteSwapSchema,
}

/** Strip prose so we compare contract, not wording. */
function contractOnly(schema: Json): Json {
	if (schema === null || typeof schema !== 'object') return schema
	if (Array.isArray(schema)) return schema.map(contractOnly)
	const out: Json = {}
	for (const key of Object.keys(schema).sort()) {
		if (key === 'description') continue
		out[key] = contractOnly(schema[key])
	}
	return out
}

function main() {
	const published = new Map(TOOLS.map((t) => [t.name as string, t.inputSchema as Json]))
	const failures: string[] = []

	for (const [name, schema] of Object.entries(TOOL_VALIDATORS)) {
		const actual = published.get(name)
		if (!actual) {
			failures.push(`  ${name}: mapped to a validator but not present in TOOLS`)
			continue
		}
		const expected = toJsonSchema(schema)
		const a = JSON.stringify(contractOnly(actual))
		const e = JSON.stringify(contractOnly(expected))
		if (a !== e) {
			failures.push(
				`  ${name}: published schema does not match ${'' + schema.constructor.name} from validators.ts\n` +
					`    published: ${a}\n` +
					`    expected:  ${e}`,
			)
		}
	}

	const unmapped = [...published.keys()].filter((n) => !(n in TOOL_VALIDATORS)).sort()

	if (failures.length) {
		console.error('✗ MCP tool schemas have drifted from the Zod validators:\n')
		console.error(failures.join('\n\n'))
		console.error(
			'\nFix by deriving the tool\'s inputSchema with mcpInputSchema() in src/routes/mcpTools.ts,\n' +
				'rather than hand-writing it. See docs/plans/mcp-unification.md.',
		)
		process.exit(1)
	}

	console.log(
		`✓ ${Object.keys(TOOL_VALIDATORS).length}/${published.size} MCP tools derive their inputSchema from Zod validators.`,
	)
	if (unmapped.length) {
		console.log(
			`\n  ${unmapped.length} tools still carry hand-written schemas and can drift:\n` +
				unmapped.map((n) => `    - ${n}`).join('\n') +
				'\n\n  Each needs a Zod schema used by its route. See docs/plans/mcp-unification.md (Phase 1).',
		)
	}
}

main()
