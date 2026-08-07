/**
 * MCP tool catalogue — pure data, no service imports.
 *
 * Kept separate from mcp.ts (which pulls in the whole Effect service graph and
 * a DB connection) so tooling can import the catalogue cheaply. This is what
 * lets scripts/check-mcp-schemas.ts verify the published schemas without
 * booting the app.
 */
import { z } from 'zod'
import { mcpInputSchema, toOutputJsonSchema } from '../lib/zodJsonSchema'
import { PerpsQuoteSchema, QuoteRequestSchema, SimulateSwapSchema } from './validators'

// ---------------------------------------------------------------
// Tool definitions (MCP tool schema)
// ---------------------------------------------------------------
//
// Tools whose arguments are validated by a Zod schema in validators.ts derive
// their `inputSchema` from that schema via `mcpInputSchema()`, so the catalogue
// we publish to agents cannot claim a field is less constrained than the
// server actually enforces. Before this, `get_quote` advertised `slippage` as
// an unbounded number while the route rejected anything over 0.5, and
// `perps_quote` advertised unbounded `leverage` against a cap of 20 — an agent
// had no way to know until it ate a 400.
//
// Descriptions stay hand-written here (they are agent-facing prose, and per
// Anthropic's tool-design guidance the highest-leverage text in the catalogue);
// only types and constraints are derived. `overrides` re-state constraints that
// live in a `.refine()`, which `z.toJSONSchema` silently drops.
//
// Tools NOT in this map still carry hand-written schemas — see
// scripts/check-mcp-schemas.ts, which reports them as unmapped coverage.

const GET_QUOTE_INPUT = mcpInputSchema(QuoteRequestSchema, {
	from_token: 'Source token symbol (e.g. ETH, SOL, USDC)',
	to_token: 'Destination token symbol',
	amount: 'Amount to swap in human units (e.g. "0.5")',
	chain: 'Chain name (ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana). Defaults to ethereum.',
	from_chain: 'Source chain for cross-chain swaps (optional)',
	to_chain: 'Destination chain for cross-chain swaps (optional)',
	wallet_address: 'Wallet address to get executable transaction data (optional)',
	slippage: 'Slippage tolerance as decimal (0.03 = 3%). Default 0.03',
}, {
	properties: {
		// tokenAmountSchema .refine() dropped by z.toJSONSchema.
		amount: { description: 'Amount to swap in human units (e.g. "0.5"). Positive decimal string, max 1,000,000 units.' },
		// evmAddressSchema .refine() (zero-address ban) dropped.
		wallet_address: { description: 'Wallet address to get executable transaction data (optional). Must be a valid non-zero address.' },
	},
})

const SIMULATE_SWAP_INPUT = mcpInputSchema(SimulateSwapSchema, {
	quote_id: 'Quote ID from a previous get_quote call (optional — if omitted, from_token/to_token/amount are required)',
	from_token: 'Source token symbol (e.g. ETH, SOL, USDC)',
	to_token: 'Destination token symbol',
	amount: 'Amount to swap in human units (e.g. "0.5")',
	chain: 'Chain name (ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana). Defaults to ethereum.',
	from_chain: 'Source chain for cross-chain swaps (optional)',
	to_chain: 'Destination chain for cross-chain swaps (optional)',
	wallet_address: 'Wallet address to run balance/allowance/gas/eth_call checks against. Strongly recommended — without it those checks are skipped.',
	slippage: 'Slippage tolerance as decimal (0.03 = 3%). Default 0.03',
}, {
	// Top-level .refine() dropped — re-state the either/or requirement.
	description: 'Provide either quote_id, or from_token + to_token + amount.',
	properties: {
		amount: { description: 'Amount to swap in human units (e.g. "0.5"). Positive decimal string, max 1,000,000 units.' },
	},
})

const PERPS_QUOTE_INPUT = mcpInputSchema(PerpsQuoteSchema, {
	market: 'Perp market symbol (e.g. "ETH-PERP", "BTC-PERP") from perps_markets',
	side: 'Position direction',
	size: 'Position size in the base asset',
	leverage: 'Leverage multiplier (e.g. 10). Between 1 and 20.',
})

const TOOLS = [
	{
		name: 'get_quote',
		description: 'Get a swap quote for exchanging tokens. Supports EVM chains (Ethereum, Base, Arbitrum, Polygon, BSC, Optimism, Avalanche) via Li.Fi and Solana via Jupiter.',
		inputSchema: GET_QUOTE_INPUT,
	},
	{
		name: 'get_portfolio',
		description: 'Get token balances and portfolio value for a wallet address across all supported chains.',
		inputSchema: {
			type: 'object',
			properties: {
				wallet_address: { type: 'string', description: 'Wallet address (0x... for EVM, base58 for Solana)' },
				chain: { type: 'string', description: 'Filter to specific chain (optional)' },
			},
			required: ['wallet_address'],
		},
	},
	{
		name: 'get_prices',
		description: 'Get current token prices in USD with 24h change. Supported: ETH, SOL, BNB, USDC, USDT, BTC, DAI, WBTC, ARB, OP, AVAX, MATIC, WETH, BONK, JUP, RAY.',
		inputSchema: {
			type: 'object',
			properties: {
				symbols: { type: 'string', description: 'Comma-separated token symbols (e.g. "ETH,SOL,USDC"). Max 20.' },
			},
			required: ['symbols'],
		},
	},
	{
		name: 'list_chains',
		description: 'List all supported blockchain networks for swapping. Free and public — no API key required.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'list_tokens',
		description: 'List available tokens on a specific chain. Free and public — no API key required.',
		inputSchema: {
			type: 'object',
			properties: {
				chain: { type: 'string', description: 'Chain name (e.g. "base", "solana"). If omitted, returns all chains.' },
				search: { type: 'string', description: 'Filter tokens by symbol substring (optional)' },
			},
		},
	},
	{
		name: 'execute_swap',
		description: 'Prepare an unsigned self-custody swap transaction from a previously obtained quote_id. This tool never signs or broadcasts; the caller reviews, signs, and submits the returned transaction.',
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: { type: 'string', description: 'Quote ID from a previous get_quote call' },
				wallet_address: { type: 'string', description: 'Wallet address to sign the transaction' },
				idempotency_key: { type: 'string', description: 'Optional intent key echoed back with the unsigned transaction so the caller can carry it into its submission workflow. MCP preparation itself does not submit or dedupe an on-chain transaction.' },
			},
			required: ['quote_id', 'wallet_address'],
		},
	},
	{
		name: 'simulate_swap',
		description: 'Dry-run a swap with zero funds moved. Fetches (or reuses a quote_id from get_quote) and returns expected output, price impact, and safety checks (balance, ERC-20 allowance, gas affordability, eth_call revert simulation, slippage sanity) — never signs or broadcasts anything.',
		inputSchema: SIMULATE_SWAP_INPUT,
	},
	{
		name: 'get_tempo_tokens',
		description: 'Get TIP-20 token list on Tempo mainnet (chain ID 4217) with addresses, decimals, and TIP-20 metadata (currency code, isTip20 flag). Tempo uses USD-denominated stablecoins: pathUSD, AlphaUSD, BetaUSD, ThetaUSD. Free and public — no API key required.',
		inputSchema: {
			type: 'object',
			properties: {
				search: { type: 'string', description: 'Filter tokens by symbol substring (optional)' },
			},
		},
	},
	{
		name: 'browse_mpp_directory',
		description: 'Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) service directory to discover available services and their payment requirements. Unrelated to Suwappu\'s own pathUSD micropayment auth. Free and public — no API key required.',
		inputSchema: {
			type: 'object',
			properties: {
				category: { type: 'string', description: 'Filter by category (e.g. "defi", "ai", "data"). Optional.' },
				limit: { type: 'number', description: 'Max results to return (default 20, max 100)' },
			},
		},
	},
	{
		name: 'predict_markets',
		description: 'Search and browse prediction markets on Polymarket. Returns active markets with live prices, volumes, and CLOB token IDs.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search query or category tag (e.g. "bitcoin", "crypto", "politics")' },
				limit: { type: 'number', description: 'Max results (default 10, max 50)' },
			},
		},
	},
	{
		name: 'predict_market',
		description: 'Get detailed prediction market info including live CLOB midpoint prices for each outcome. Requires a market condition ID.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Market condition ID (from predict_markets results)' },
			},
			required: ['market_id'],
		},
	},
	{
		name: 'perps_markets',
		description: 'List available Hyperliquid perpetual futures markets with mark price, funding rate, max leverage, and size decimals.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'perps_quote',
		description: 'Quote a Hyperliquid perpetual position: entry price, margin required, liquidation price, funding rate, and fees. Requires authentication.',
		inputSchema: PERPS_QUOTE_INPUT,
	},
	{
		name: 'perps_positions',
		description: 'List open Hyperliquid perpetual positions for a wallet address, with size, entry price, unrealized PnL, and liquidation price.',
		inputSchema: {
			type: 'object',
			properties: {
				address: { type: 'string', description: 'Wallet address to inspect' },
			},
			required: ['address'],
		},
	},
	{
		name: 'lend_markets',
		description: 'List Morpho lending markets on a chain with supply/borrow APY, LLTV, utilization, and TVL.',
		inputSchema: {
			type: 'object',
			properties: {
				chain_id: { type: 'number', description: 'EVM chain ID (default 8453 = Base)' },
			},
		},
	},
	{
		name: 'lend_market',
		description: 'Get details for a single Morpho lending market by its unique market ID.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Morpho market unique ID (from lend_markets results)' },
			},
			required: ['market_id'],
		},
	},
	{
		name: 'get_swap_status',
		description: 'Get the status of a managed swap created by POST /v1/agent/swap/execute (pending, completed, failed), with tx hash and amounts. MCP execute_swap only prepares an unsigned transaction and does not create this managed swap record.',
		inputSchema: {
			type: 'object',
			properties: {
				swap_id: { type: 'string', description: 'Managed swap ID returned by POST /v1/agent/swap/execute' },
			},
			required: ['swap_id'],
		},
	},
	{
		name: 'get_swap_history',
		description: 'List paginated managed-swap history for the authenticated agent, optionally filtered by status. Self-custody transactions prepared by MCP execute_swap are not managed swap records.',
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', description: 'Filter by swap status (e.g. "pending", "completed", "failed"). Optional.' },
				limit: { type: 'number', description: 'Max results (default 20, max 100)' },
				offset: { type: 'number', description: 'Pagination offset (default 0)' },
			},
		},
	},
	{
		name: 'predict_book',
		description: 'Get the live CLOB order book for every outcome of a prediction market.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Market condition ID (from predict_markets results)' },
			},
			required: ['market_id'],
		},
	},
	{
		name: 'predict_price',
		description: 'Get live CLOB midpoint prices for every outcome of a prediction market.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Market condition ID (from predict_markets results)' },
			},
			required: ['market_id'],
		},
	},
	{
		name: 'predict_trades',
		description: 'Get recent trades across all outcomes of a prediction market.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Market condition ID (from predict_markets results)' },
				limit: { type: 'number', description: 'Max trades to return (default 20)' },
			},
			required: ['market_id'],
		},
	},
	{
		name: 'list_wallet_policies',
		description: 'List Turnkey spending/whitelist policies configured on the agent\'s managed wallet.',
		inputSchema: {
			type: 'object',
			properties: {
				wallet_address: { type: 'string', description: 'Wallet address (optional — defaults to the authenticated agent\'s managed wallet).' },
			},
		},
	},
]

// ---------------------------------------------------------------
// Tool annotations (MCP behavioural hints, spec 2025-03-26)
//
// Hints only — clients MUST NOT make security decisions from them.
// readOnlyHint:   tool does not mutate server/chain state
// destructiveHint: tool may perform irreversible updates (only meaningful when not read-only)
// idempotentHint:  repeated identical calls have no additional effect
// openWorldHint:   tool talks to external systems (chains, DEX aggregators, oracles)
// ---------------------------------------------------------------

type ToolAnnotations = {
	title: string
	readOnlyHint: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint: boolean
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
	get_quote: { title: 'Get Swap Quote', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	get_portfolio: { title: 'Get Portfolio', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	get_prices: { title: 'Get Token Prices', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	list_chains: { title: 'List Supported Chains', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	list_tokens: { title: 'List Tokens', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	// Builds an UNSIGNED transaction — it never broadcasts, so it is not destructive
	// on its own. The user signs and submits. Not read-only because it consumes a
	// one-time cached quote.
	execute_swap: { title: 'Prepare Swap Transaction', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	// Never signs or broadcasts — strictly reads (quote + on-chain balance/allowance/eth_call).
	simulate_swap: { title: 'Simulate Swap (Dry Run)', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	get_tempo_tokens: { title: 'Get Tempo (TIP-20) Tokens', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	browse_mpp_directory: { title: 'Browse MPP Service Directory', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_markets: { title: 'Search Prediction Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_market: { title: 'Prediction Market Detail', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	perps_markets: { title: 'List Perp Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	perps_quote: { title: 'Quote Perp Position', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	perps_positions: { title: 'List Perp Positions', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	lend_markets: { title: 'List Lending Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	lend_market: { title: 'Lending Market Detail', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	get_swap_status: { title: 'Get Swap Status', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	get_swap_history: { title: 'Get Swap History', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	predict_book: { title: 'Prediction Market Order Book', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_price: { title: 'Prediction Market Prices', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_trades: { title: 'Prediction Market Trades', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	list_wallet_policies: { title: 'List Wallet Policies', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
}


// ---------------------------------------------------------------
// Output schemas (MCP `outputSchema` + `structuredContent`)
// ---------------------------------------------------------------
//
// A tool that declares an outputSchema MUST return conforming
// structuredContent, so a guessed schema is worse than none — an agent would
// start seeing validation failures on results that were previously fine.
// Every schema below was written against output captured from the live
// endpoint or read directly out of the handler, and stays permissive
// (`.loose()`) so adding a field is not a breaking change.
//
// Tools NOT covered yet are deliberate, not forgotten:
//   list_tokens   returns three different shapes depending on arguments
//                 (Solana -> tokens[], known EVM chain -> a `note` pointing at
//                 REST with no tokens at all, no chain -> available_chains).
//                 It needs the handler fixed before a schema means anything.
//   browse_mpp_directory  its upstream host is currently unreachable.
//   everything else       needs its real shape captured first.

const ChainEntrySchema = z
	.object({
		// Numeric for EVM chains, the string 'solana' for Solana.
		id: z.union([z.number(), z.string()]),
		key: z.string(),
		name: z.string(),
		native_token: z.string(),
		type: z.string(),
	})
	.loose()

export const ListChainsOutputSchema = z.object({ chains: z.array(ChainEntrySchema) }).loose()

export const GetPricesOutputSchema = z
	.object({
		// symbol -> price entry, keyed by the UPPERCASED symbol.
		prices: z.record(
			z.string(),
			z.object({ usd: z.number(), change_24h: z.number().nullable() }).loose(),
		),
	})
	.loose()

export const GetTempoTokensOutputSchema = z
	.object({
		chain: z.string(),
		chain_id: z.number(),
		native_token: z.string(),
		tokens: z.array(
			z.object({ symbol: z.string(), name: z.string(), address: z.string(), decimals: z.number() }).loose(),
		),
	})
	.loose()

/** tool name -> outputSchema, applied to TOOLS below. */
const TOOL_OUTPUT_SCHEMAS: Record<string, unknown> = {
	list_chains: toOutputJsonSchema(ListChainsOutputSchema),
	get_prices: toOutputJsonSchema(GetPricesOutputSchema),
	get_tempo_tokens: toOutputJsonSchema(GetTempoTokensOutputSchema),
}

/** Tools that declare an outputSchema, so the caller knows to attach structuredContent. */
export const TOOLS_WITH_OUTPUT_SCHEMA = new Set(Object.keys(TOOL_OUTPUT_SCHEMAS))

const TOOLS_WITH_ANNOTATIONS = TOOLS.map((t) => ({
	...t,
	...(TOOL_ANNOTATIONS[t.name] ? { annotations: TOOL_ANNOTATIONS[t.name] } : {}),
	...(TOOL_OUTPUT_SCHEMAS[t.name] ? { outputSchema: TOOL_OUTPUT_SCHEMAS[t.name] } : {}),
}))

export { TOOLS, TOOL_ANNOTATIONS, TOOLS_WITH_ANNOTATIONS }
