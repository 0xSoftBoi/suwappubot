/**
 * MCP (Model Context Protocol) compatible endpoint for OpenClaw integration.
 *
 * Exposes Suwappu API tools in the MCP tool-call format so OpenClaw agents
 * can discover and invoke them natively via HTTP transport.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST (MCP Streamable HTTP transport)
 * Auth: Bearer token (same agent API key as /v1/agent/*)
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { AgentService, TokenService, SwapService, BalanceService, JupiterService, TurnkeyService, CHAINS, COMMON_TOKENS, SOLANA_TOKENS, type QuoteParams } from '../services'
import { isStarknet } from '../config/chains'
import { PolymarketService } from '../services/PolymarketService'
import { HyperliquidService } from '../services/HyperliquidService'
import { MorphoService } from '../services/MorphoService'
import { PerpsQuoteSchema, SimulateSwapSchema } from './validators'
import { runEffectEither } from '../runtime'
import { ValidationError } from '../errors'
import { agentBearerAuth } from '../middleware'
import { type AgentErrorCode } from '../lib/agentError'
import { checkEvmWalletOwnership } from './agent'
import { chargeAgentForCall, costForTool, refundChargedCall, setX402Headers } from '../middleware/x402Payment'
import { EnvService } from '../config/EnvService'
import { cacheAgentQuote, getCachedQuote } from '../lib/quoteCache'
import { buildEvmSimulationReport, buildSolanaSimulationReport } from '../lib/swapSimulation'
import { fetchTokenPrices, SUPPORTED_PRICE_SYMBOLS } from '../lib/prices'
import openApiSpec from '../../openapi-agent.json'
import { requireDb, swapTransactions } from '../db'
import type { Agent } from '../db'

type McpContext = { Variables: { agent: Agent } }

const mcpRoutes = new Hono<McpContext>()

// MCP handshake/discovery methods must work without auth (anonymous initialize is
// part of the spec) — auth is enforced per-method inside the POST handler instead
// of a blanket `use('*', ...)` gate so unhappy paths stay inside the JSON-RPC envelope.
const PUBLIC_MCP_METHODS = new Set([
	'initialize',
	'tools/list',
	'resources/list',
	'resources/read',
	'prompts/list',
	'prompts/get',
	'notifications/initialized',
])

// ---------------------------------------------------------------
// Protocol version negotiation (MCP spec: lifecycle / initialize)
//
// We are a simple JSON-RPC 2.0 server — none of our tools/resources/prompts
// behavior is gated on protocolVersion, so negotiation is limited to the
// initialize handshake. Per spec: if the client's requested version is one
// we support, echo it back; otherwise respond with our latest supported
// version (the client may then decide whether to proceed or disconnect).
// Do NOT bump this to unreleased/RC spec revisions.
// ---------------------------------------------------------------
const SUPPORTED_MCP_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'] as const
const LATEST_MCP_VERSION = SUPPORTED_MCP_VERSIONS[SUPPORTED_MCP_VERSIONS.length - 1]

function negotiateProtocolVersion(requested: unknown): string {
	if (typeof requested === 'string' && (SUPPORTED_MCP_VERSIONS as readonly string[]).includes(requested)) {
		return requested
	}
	return LATEST_MCP_VERSION
}

// ---------------------------------------------------------------
// Tool definitions (MCP tool schema)
// ---------------------------------------------------------------

const TOOLS = [
	{
		name: 'get_quote',
		description: 'Get a swap quote for exchanging tokens. Supports EVM chains (Ethereum, Base, Arbitrum, Polygon, BSC, Optimism, Avalanche) via Li.Fi and Solana via Jupiter.',
		inputSchema: {
			type: 'object',
			properties: {
				from_token: { type: 'string', description: 'Source token symbol (e.g. ETH, SOL, USDC)' },
				to_token: { type: 'string', description: 'Destination token symbol' },
				amount: { type: 'string', description: 'Amount to swap in human units (e.g. "0.5")' },
				chain: { type: 'string', description: 'Chain name (ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana). Defaults to ethereum.' },
				from_chain: { type: 'string', description: 'Source chain for cross-chain swaps (optional)' },
				to_chain: { type: 'string', description: 'Destination chain for cross-chain swaps (optional)' },
				wallet_address: { type: 'string', description: 'Wallet address to get executable transaction data (optional)' },
				slippage: { type: 'number', description: 'Slippage tolerance as decimal (0.03 = 3%). Default 0.03' },
			},
			required: ['from_token', 'to_token', 'amount'],
		},
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
		description: 'List all supported blockchain networks for swapping.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'list_tokens',
		description: 'List available tokens on a specific chain.',
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
		description: 'Execute a swap using a previously obtained quote_id. Returns an unsigned transaction for the user to sign.',
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: { type: 'string', description: 'Quote ID from a previous get_quote call' },
				wallet_address: { type: 'string', description: 'Wallet address to sign the transaction' },
				idempotency_key: { type: 'string', description: 'Optional client-supplied idempotency key (scoped per-agent server-side) to dedupe retries of the same swap intent.' },
			},
			required: ['quote_id', 'wallet_address'],
		},
	},
	{
		name: 'simulate_swap',
		description: 'Dry-run a swap with zero funds moved. Fetches (or reuses a quote_id from get_quote) and returns expected output, price impact, and safety checks (balance, ERC-20 allowance, gas affordability, eth_call revert simulation, slippage sanity) — never signs or broadcasts anything.',
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: { type: 'string', description: 'Quote ID from a previous get_quote call (optional — if omitted, from_token/to_token/amount are required)' },
				from_token: { type: 'string', description: 'Source token symbol (e.g. ETH, SOL, USDC)' },
				to_token: { type: 'string', description: 'Destination token symbol' },
				amount: { type: 'string', description: 'Amount to swap in human units (e.g. "0.5")' },
				chain: { type: 'string', description: 'Chain name (ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana). Defaults to ethereum.' },
				from_chain: { type: 'string', description: 'Source chain for cross-chain swaps (optional)' },
				to_chain: { type: 'string', description: 'Destination chain for cross-chain swaps (optional)' },
				wallet_address: { type: 'string', description: 'Wallet address to run balance/allowance/gas/eth_call checks against. Strongly recommended — without it those checks are skipped.' },
				slippage: { type: 'number', description: 'Slippage tolerance as decimal (0.03 = 3%). Default 0.03' },
			},
		},
	},
	{
		name: 'get_tempo_tokens',
		description: 'Get TIP-20 token list on Tempo mainnet (chain ID 4217) with addresses, decimals, and TIP-20 metadata (currency code, isTip20 flag). Tempo uses USD-denominated stablecoins: pathUSD, AlphaUSD, BetaUSD, ThetaUSD.',
		inputSchema: {
			type: 'object',
			properties: {
				search: { type: 'string', description: 'Filter tokens by symbol substring (optional)' },
			},
		},
	},
	{
		name: 'browse_mpp_directory',
		description: 'Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) service directory to discover available services and their payment requirements. Unrelated to Suwappu\'s own pathUSD micropayment auth.',
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
		inputSchema: {
			type: 'object',
			properties: {
				market: { type: 'string', description: 'Perp market symbol (e.g. "ETH-PERP", "BTC-PERP") from perps_markets' },
				side: { type: 'string', enum: ['long', 'short'], description: 'Position direction' },
				size: { type: 'number', description: 'Position size in the base asset' },
				leverage: { type: 'number', description: 'Leverage multiplier (e.g. 10)' },
			},
			required: ['market', 'side', 'size', 'leverage'],
		},
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
		description: 'Get the status of a previously executed swap (pending, completed, failed) with tx hash and amounts.',
		inputSchema: {
			type: 'object',
			properties: {
				swap_id: { type: 'string', description: 'Swap ID returned by execute_swap or POST /v1/agent/swap/execute' },
			},
			required: ['swap_id'],
		},
	},
	{
		name: 'get_swap_history',
		description: 'List paginated swap history for the authenticated agent, optionally filtered by status.',
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

const TOOLS_WITH_ANNOTATIONS = TOOLS.map((t) => ({
	...t,
	...(TOOL_ANNOTATIONS[t.name] ? { annotations: TOOL_ANNOTATIONS[t.name] } : {}),
}))

// Registered tool names, including legacy aliases handled in the tools/call switch
// below. Used to reject unknown tool calls BEFORE any credit is charged.
const TOOL_NAMES = new Set<string>([...TOOLS.map((t) => t.name), 'predict_market_detail'])

// predict_market_detail is a legacy alias for predict_market's schema.
function toolSchemaName(name: string): string {
	return name === 'predict_market_detail' ? 'predict_market' : name
}

/**
 * Minimal presence validation against a tool's declared `required` inputSchema
 * fields. Runs BEFORE chargeAgentForCall so malformed calls never consume credits.
 * Returns an error message, or null if valid.
 */
function validateToolArgs(name: string, args: Record<string, unknown>): string | null {
	const tool = TOOLS.find((t) => t.name === toolSchemaName(name))
	const required = (tool?.inputSchema as { required?: string[] } | undefined)?.required ?? []
	for (const key of required) {
		const v = args[key]
		if (v === undefined || v === null || v === '') {
			return `Missing required argument: ${key}`
		}
	}
	return null
}

// ---------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------

function rpcOk(id: string | number | null, result: unknown) {
	return { jsonrpc: '2.0' as const, id, result }
}

function rpcErr(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
	agentErrorCode?: AgentErrorCode,
) {
	const errData =
		agentErrorCode !== undefined
			? { ...(typeof data === 'object' && data !== null ? data : data !== undefined ? { data } : {}), error_code: agentErrorCode }
			: data
	return { jsonrpc: '2.0' as const, id, error: { code, message, ...(errData !== undefined && { data: errData }) } }
}

// ---------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------

function isSolanaChain(chain: string): boolean {
	const n = chain.toLowerCase().trim()
	return n === 'solana' || n === 'sol'
}

// Heuristic Solana-address detector: base58 (no 0/O/I/l), 32-44 chars, not 0x-prefixed.
// Used only to route the ownership gate — an EVM 0x... address must never match here.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
function looksLikeSolanaAddress(addr: unknown): boolean {
	return typeof addr === 'string' && !addr.startsWith('0x') && SOLANA_ADDRESS_RE.test(addr)
}

// Managed agent wallets are Turnkey EVM-only — no Solana public key is stored in
// agent.metadata, so there is no ownership record to check a Solana address against.
// Rather than fall through to the EVM ownership gate (which would reject every Solana
// address with a misleading "not your managed wallet"), return this explicit error so
// a caller can tell "unsupported" apart from "you don't own this wallet".
const SOLANA_UNSUPPORTED_MSG =
	'Solana wallets are not supported for managed-wallet reads yet (agent wallets are EVM-only)'

// Shared ownership gate for managed-wallet reads: reject Solana (EVM-only managed
// wallets) with an explicit "unsupported" error, then enforce EVM ownership. Returns
// an error result to hand straight back to the caller, or null when the address passes.
function guardWalletOwnership(
	agent: Agent,
	address: string,
	opts?: { chain?: string; label?: string },
): { isError: true; content: { type: 'text'; text: string }[] } | null {
	if ((opts?.chain ? isSolanaChain(opts.chain) : false) || looksLikeSolanaAddress(address)) {
		return { isError: true, content: [{ type: 'text', text: SOLANA_UNSUPPORTED_MSG }] }
	}
	if (!checkEvmWalletOwnership(agent, address)) {
		return {
			isError: true,
			content: [{ type: 'text', text: `${opts?.label ?? 'wallet_address'} is not your managed wallet` }],
		}
	}
	return null
}

function isTempoChain(chain: string): boolean {
	const n = chain.toLowerCase().trim()
	return n === 'tempo' || n === '4217'
}

// Tempo TIP-20 chain id. The token addresses/decimals live in the single source of
// truth (COMMON_TOKENS[4217] in TokenService); only the human descriptions are kept
// here since COMMON_TOKENS does not carry that metadata.
const TEMPO_CHAIN_ID = 4217
const TEMPO_TOKEN_DESCRIPTIONS: Record<string, string> = {
	pathUSD: 'Tempo native stablecoin',
	AlphaUSD: 'Alpha yield-bearing stablecoin',
	BetaUSD: 'Beta yield-bearing stablecoin',
	ThetaUSD: 'Theta yield-bearing stablecoin',
}
// TIP-20 tokens on Tempo are 6-decimal USD-denominated stablecoins.
const TEMPO_TOKEN_DECIMALS = 6

// Static TIP-20 metadata known for the Tempo native stablecoins. Currency code and the
// isTip20 flag are constant for all COMMON_TOKENS[4217] entries (all are USD-denominated
// TIP-20 tokens). Richer TIP-20 fields (compliance policy, transferWithMemo) live in the
// Python `tempo_tip20` service and would need a dedicated internal endpoint to surface
// here — not yet exposed, so only the statically-known fields are passed through.
const TEMPO_TIP20_CURRENCY = 'USD'

// Derive the Tempo token list from COMMON_TOKENS[4217] so MCP and TokenService never
// drift apart. Adding a token to COMMON_TOKENS[4217] surfaces it here automatically.
function buildTempoTokens() {
	return Object.entries(COMMON_TOKENS[TEMPO_CHAIN_ID] || {}).map(([symbol, address]) => ({
		symbol,
		name: symbol,
		address,
		decimals: TEMPO_TOKEN_DECIMALS,
		description: TEMPO_TOKEN_DESCRIPTIONS[symbol] || `${symbol} TIP-20 token on Tempo`,
		// TIP-20 metadata passthrough (statically known for Tempo stablecoins).
		currency: TEMPO_TIP20_CURRENCY,
		isTip20: true,
	}))
}

function handleGetTempoTokens(args: Record<string, unknown>) {
	const search = (args.search as string)?.toUpperCase()
	let tokens = buildTempoTokens()
	if (search) {
		tokens = tokens.filter((t) => t.symbol.toUpperCase().includes(search))
	}
	return {
		content: [{
			type: 'text',
			text: JSON.stringify({
				chain: 'Tempo',
				chain_id: TEMPO_CHAIN_ID,
				native_token: 'USD',
				tokens: tokens.map((t) => ({
					symbol: t.symbol,
					name: t.name,
					address: t.address,
					decimals: t.decimals,
					description: t.description,
					currency: t.currency,
					isTip20: t.isTip20,
				})),
			}),
		}],
	}
}

async function handleBrowseMppDirectory(args: Record<string, unknown>) {
	const category = args.category as string | undefined
	const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100)

	try {
		const url = new URL('https://directory.mpp.dev/v1/services')
		if (category) url.searchParams.set('category', category)
		url.searchParams.set('limit', String(limit))

		const res = await fetch(url.toString(), {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		})

		if (!res.ok) {
			return { isError: true, content: [{ type: 'text', text: `MPP directory returned ${res.status}: ${res.statusText}` }] }
		}

		const data = await res.json()
		return { content: [{ type: 'text', text: JSON.stringify(data) }] }
	} catch (e: any) {
		return { isError: true, content: [{ type: 'text', text: `Failed to fetch MPP directory: ${e.message}` }] }
	}
}

async function handleGetQuote(args: Record<string, unknown>, agent: Agent) {
	const { from_token, to_token, amount, chain, from_chain, to_chain, wallet_address, slippage } = args as {
		from_token: string; to_token: string; amount: string; chain?: string
		from_chain?: string; to_chain?: string; wallet_address?: string; slippage?: number
	}

	const chainKey = (from_chain || chain || 'ethereum') as string

	// Starknet is read-only in the TS stack — signing/broadcast lives in the Python bot
	if (isStarknet(chainKey) || (to_chain && isStarknet(to_chain))) {
		return { isError: true, content: [{ type: 'text', text: 'Starknet transactions are handled by the bot backend' }] }
	}

	if (isSolanaChain(chainKey)) {
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService
				const fromInfo = jupiterService.resolveToken(from_token)
				if (!fromInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found on Solana: ${from_token}` }))
				const toInfo = jupiterService.resolveToken(to_token)
				if (!toInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found on Solana: ${to_token}` }))

				const amountNum = parseFloat(amount)
				if (isNaN(amountNum) || amountNum <= 0) return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
				const lamports = BigInt(Math.floor(amountNum * Math.pow(10, fromInfo.decimals))).toString()

				const quote = yield* jupiterService.getQuote({
					inputMint: fromInfo.address, outputMint: toInfo.address,
					amount: lamports, slippageBps: slippage ? Math.floor(slippage * 10000) : 300,
				}).pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

				const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
				cacheAgentQuote(quoteId, quote, agent.id, true)

				const outHuman = parseFloat(quote.outAmount) / Math.pow(10, toInfo.decimals)
				return {
					quote_id: quoteId, chain: 'Solana', chain_type: 'solana',
					from_token: fromInfo.name, to_token: toInfo.name,
					amount_in: amount, amount_out: outHuman.toFixed(6),
					price_impact: `${quote.priceImpactPct}%`,
					route: quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> '),
					expires_in_seconds: 60,
				}
			})
		)
		if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
		return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
	}

	// Tempo — route to Python internal API for enshrined DEX quotes
	if (isTempoChain(chainKey)) {
		const fromNorm = from_token.toUpperCase().trim()
		const toNorm = to_token.toUpperCase().trim()
		const tempoTokens = COMMON_TOKENS[4217] || {}
		const fromAddr = Object.entries(tempoTokens).find(([k]) => k.toUpperCase() === fromNorm)?.[1]
		const toAddr = Object.entries(tempoTokens).find(([k]) => k.toUpperCase() === toNorm)?.[1]
		if (!fromAddr) return { isError: true, content: [{ type: 'text', text: `Token not found on Tempo: ${from_token}. Available: ${Object.keys(tempoTokens).join(', ')}` }] }
		if (!toAddr) return { isError: true, content: [{ type: 'text', text: `Token not found on Tempo: ${to_token}. Available: ${Object.keys(tempoTokens).join(', ')}` }] }

		try {
			const internalUrl = process.env.INTERNAL_API_URL || 'http://localhost:8000'
			const res = await fetch(`${internalUrl}/internal/tempo/quote?from_token=${fromAddr}&to_token=${toAddr}&amount=${amount}&wallet_address=${wallet_address || ''}`, {
				headers: {
					'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(15_000),
			})
			if (!res.ok) {
				const err = await res.text().catch(() => res.statusText)
				return { isError: true, content: [{ type: 'text', text: `Tempo quote failed: ${err}` }] }
			}
			const quote = await res.json() as Record<string, unknown>
			const quoteId = `tempo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
			cacheAgentQuote(quoteId, quote, agent.id, false)
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						quote_id: quoteId, chain: 'Tempo', chain_id: 4217, chain_type: 'evm',
						from_token: from_token, to_token: to_token,
						amount_in: amount, amount_out: quote.amount_out || quote.amountOut,
						exchange_rate: quote.exchange_rate || quote.exchangeRate,
						expires_in_seconds: 60,
					}),
				}],
			}
		} catch (e: any) {
			return { isError: true, content: [{ type: 'text', text: `Tempo quote error: ${e.message}` }] }
		}
	}

	// EVM
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService
			const src = from_chain || chain || 'ethereum'
			const dst = to_chain || chain || 'ethereum'
			const srcInfo = tokenService.resolveChain(src)
			if (!srcInfo) return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${src}` }))
			const dstInfo = tokenService.resolveChain(dst)
			if (!dstInfo) return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${dst}` }))
			const fromInfo = yield* tokenService.resolveToken(from_token, srcInfo.id)
			if (!fromInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found: ${from_token} on ${srcInfo.name}` }))
			const toInfo = yield* tokenService.resolveToken(to_token, dstInfo.id)
			if (!toInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found: ${to_token} on ${dstInfo.name}` }))

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			const wei = BigInt(Math.floor(amountNum * Math.pow(10, fromInfo.decimals))).toString()

			const quote = yield* swapService.getQuote({
				fromChain: srcInfo.id, toChain: dstInfo.id,
				fromToken: fromInfo.address, toToken: toInfo.address,
				fromAmount: wei, fromAddress: wallet_address as string || '0x0000000000000000000000000000000000000001',
				slippage: slippage || 0.03, order: 'RECOMMENDED', integrator: 'suwappu-openclaw',
			} as QuoteParams).pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

			cacheAgentQuote(quote.quoteId, quote, agent.id, false)
			const outHuman = parseFloat(quote.toAmount) / Math.pow(10, toInfo.decimals)

			return {
				quote_id: quote.quoteId,
				from_chain: srcInfo.name, to_chain: dstInfo.name, chain_type: 'evm',
				from_token: fromInfo.symbol, to_token: toInfo.symbol,
				amount_in: amount, amount_out: outHuman.toFixed(6),
				exchange_rate: quote.exchangeRate, gas_usd: quote.estimatedGasUsd,
				route: quote.route, expires_in_seconds: 60,
				...(wallet_address ? {
					transaction: {
						to: quote.transactionRequest.to, value: quote.transactionRequest.value,
						data: quote.transactionRequest.data, chain_id: quote.transactionRequest.chainId,
					},
				} : {}),
			}
		})
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

export async function handleGetPortfolio(args: Record<string, unknown>, agent: Agent) {
	const { wallet_address, chain } = args as { wallet_address: string; chain?: string }

	// Ownership gate: mirror the REST route (GET /v1/agent/portfolio) so the MCP
	// surface can't be used to read arbitrary wallet balances / enumerate wallets (H9).
	// Solana addresses can never match an (EVM-only) managed wallet, so surface a clear
	// "unsupported" error instead of a misleading ownership rejection.
	const ownershipErr = guardWalletOwnership(agent, wallet_address, { chain })
	if (ownershipErr) return ownershipErr

	const isSolana = chain ? isSolanaChain(chain) : (!wallet_address.startsWith('0x') && wallet_address.length >= 32 && wallet_address.length <= 44)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const balanceService = yield* BalanceService
			const wallet = { address: wallet_address, chainType: isSolana ? 'solana' : 'evm' } as any
			const balances = yield* balanceService.getWalletBalances(wallet).pipe(
				Effect.mapError((e) => new ValidationError({ message: e.message }))
			)
			const filtered = chain && !isSolana ? balances.filter((b) => b.chain.toLowerCase() === chain.toLowerCase()) : balances
			const totalUsd = filtered.reduce((sum, b) => sum + b.usdValue, 0)
			return {
				wallet_address, wallet_type: isSolana ? 'solana' : 'evm',
				total_usd: totalUsd.toFixed(2),
				balances: filtered.map((b) => ({ symbol: b.symbol, chain: b.chain, balance: b.balance, usd_value: b.usdValue.toFixed(2) })),
			}
		})
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

async function handleGetPrices(args: Record<string, unknown>) {
	const symbols = ((args.symbols as string) || '').split(',').map((s) => s.trim()).filter(Boolean)
	if (symbols.length === 0 || symbols.length > 20) {
		return { isError: true, content: [{ type: 'text', text: 'Provide 1-20 comma-separated symbols' }] }
	}
	const prices = await fetchTokenPrices(symbols)
	return { content: [{ type: 'text', text: JSON.stringify({ prices }) }] }
}

function handleListChains() {
	const evmChains = Object.values(CHAINS)
		.filter((c, i, self) => i === self.findIndex((ch) => ch.id === c.id))
		.map((c) => ({ id: c.id, key: c.key, name: c.name, native_token: c.nativeToken, type: 'evm' }))
	const chains = [...evmChains, { id: 'solana', key: 'solana', name: 'Solana', native_token: 'SOL', type: 'solana' }]
	return { content: [{ type: 'text', text: JSON.stringify({ chains }) }] }
}

function handleListTokens(args: Record<string, unknown>) {
	const { chain, search } = args as { chain?: string; search?: string }
	const searchUp = search?.toUpperCase()

	if (chain && isSolanaChain(chain)) {
		let tokens = Object.entries(SOLANA_TOKENS).map(([s, i]) => ({ symbol: s, address: i.address, decimals: i.decimals }))
		if (searchUp) tokens = tokens.filter((t) => t.symbol.includes(searchUp))
		return { content: [{ type: 'text', text: JSON.stringify({ chain: 'Solana', tokens }) }] }
	}

	if (chain) {
		const info = CHAINS[chain.toLowerCase()]
		if (!info) return { isError: true, content: [{ type: 'text', text: `Unknown chain: ${chain}` }] }
		// Would need COMMON_TOKENS import — simplified
		return { content: [{ type: 'text', text: JSON.stringify({ chain: info.name, chain_id: info.id, note: 'Use GET /v1/agent/tokens?chain=' + chain + ' for full list' }) }] }
	}

	const chainList = [
		...Object.values(CHAINS).filter((c, i, s) => i === s.findIndex((ch) => ch.id === c.id)).map((c) => c.name),
		'Solana',
	]
	return { content: [{ type: 'text', text: JSON.stringify({ available_chains: chainList, hint: 'Pass chain parameter for token list' }) }] }
}

async function handlePredictMarkets(args: Record<string, unknown>) {
	const query = args.query as string | undefined
	const limit = Math.min(Math.max((args.limit as number) || 10, 1), 50)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMarkets(query, limit)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Polymarket error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify({ markets: result.right }) }] }
}

async function handlePredictMarketDetail(args: Record<string, unknown>) {
	const marketId = args.market_id as string
	if (!marketId) return { isError: true, content: [{ type: 'text', text: 'market_id is required' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(marketId)

			if (market.tokens.length === 0) {
				return { ...market, livePrices: [] }
			}

			const prices = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getMidpoint(t.tokenId), (midData) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						mid: midData.mid,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { ...market, livePrices: prices }
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Polymarket error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

async function handlePerpsMarkets() {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getMarkets()
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Hyperliquid error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify({ markets: result.right }) }] }
}

async function handlePerpsQuote(args: Record<string, unknown>) {
	const parsed = PerpsQuoteSchema.safeParse(args)
	if (!parsed.success)
		return { isError: true, content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}` }] }
	const { market, side, size, leverage } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getQuote(market, side, size, leverage)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Hyperliquid error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

export async function handlePerpsPositions(args: Record<string, unknown>, agent: Agent) {
	const address = args.address as string | undefined
	if (!address) return { isError: true, content: [{ type: 'text', text: 'address is required' }] }

	// Ownership gate: same control as the portfolio surface — only the agent's own
	// managed wallet may be inspected, otherwise this discloses positions for any address.
	// Hyperliquid perps are EVM-keyed; a Solana address has no ownership record, so return
	// a clear "unsupported" error rather than a misleading ownership rejection.
	const ownershipErr = guardWalletOwnership(agent, address, { label: 'address' })
	if (ownershipErr) return ownershipErr

	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getPositions(address)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Hyperliquid error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify({ positions: result.right }) }] }
}

async function handleLendMarkets(args: Record<string, unknown>) {
	const chainId = typeof args.chain_id === 'number' ? args.chain_id : 8453
	const result = await runEffectEither(
		Effect.gen(function* () {
			const morpho = yield* MorphoService
			return yield* morpho.getMarkets(chainId)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Morpho error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify({ markets: result.right }) }] }
}

async function handleLendMarket(args: Record<string, unknown>) {
	const marketId = args.market_id as string | undefined
	if (!marketId) return { isError: true, content: [{ type: 'text', text: 'market_id is required' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const morpho = yield* MorphoService
			return yield* morpho.getMarket(marketId)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Morpho error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

async function handleExecuteSwap(args: Record<string, unknown>, agent: Agent) {
	// idempotency_key is accepted for parity with POST /v1/agent/swap/execute, but this
	// tool only returns an unsigned transaction for client-side signing (no backend
	// execute call to dedupe here) — it is echoed back so callers can carry it through
	// to whichever submission path they use.
	const { quote_id, wallet_address, idempotency_key } = args as {
		quote_id: string
		wallet_address: string
		idempotency_key?: string
	}
	const cached = getCachedQuote(quote_id)
	// Reject a missing quote OR one belonging to another agent (cross-agent quote
	// hijacking) — same generic message so existence can't be probed. Webapp quotes
	// carry no agentId and aren't creatable via the MCP agent surface.
	if (!cached || (cached.agentId !== undefined && cached.agentId !== agent.id))
		return { isError: true, content: [{ type: 'text', text: 'Quote expired or not found. Get a new quote first.' }] }

	const quote = cached.quote
	if (cached.isSolana) {
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService
				return yield* jupiterService.getSwapTransaction({
					quote, userPublicKey: wallet_address, wrapUnwrapSOL: true,
				}).pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))
			})
		)
		if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
		return { content: [{ type: 'text', text: JSON.stringify({
			status: 'ready', chain: 'solana',
			transaction: { type: 'solana', serialized_transaction: result.right.swapTransaction, last_valid_block_height: result.right.lastValidBlockHeight },
			...(idempotency_key ? { idempotency_key } : {}),
			instructions: 'Deserialize base64 transaction, sign with Solana wallet, submit to RPC',
		}) }] }
	}

	return { content: [{ type: 'text', text: JSON.stringify({
		status: 'ready', chain_type: 'evm',
		transaction: {
			to: quote.transactionRequest.to, from: wallet_address,
			value: quote.transactionRequest.value, data: quote.transactionRequest.data,
			chain_id: quote.transactionRequest.chainId, gas_limit: quote.transactionRequest.gasLimit,
		},
		...(idempotency_key ? { idempotency_key } : {}),
		instructions: 'Sign transaction with wallet and submit to chain RPC',
	}) }] }
}

// Mirrors GET /v1/agent/swap/status/:swapId (src/routes/agent.ts)
async function handleGetSwapStatus(args: Record<string, unknown>, agent: Agent) {
	const swapId = parseInt(String(args.swap_id ?? ''), 10)
	if (isNaN(swapId)) return { isError: true, content: [{ type: 'text', text: 'swap_id is required and must be numeric' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(and(eq(swapTransactions.id, swapId), eq(swapTransactions.agentId, agent.id)))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const s = rows[0]
			if (!s) return yield* Effect.fail(new ValidationError({ message: 'Swap not found' }))
			return {
				swap_id: s.id, status: s.status, tx_hash: s.txHash,
				from_chain: s.fromChain, to_chain: s.toChain,
				from_token: s.fromToken, to_token: s.toToken,
				from_amount: s.fromAmount, to_amount: s.toAmount,
				error_message: s.errorMessage, created_at: s.createdAt, completed_at: s.completedAt,
			}
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

// Mirrors GET /v1/agent/swaps (src/routes/agent.ts)
async function handleGetSwapHistory(args: Record<string, unknown>, agent: Agent) {
	const statusFilter = args.status as string | undefined
	const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100)
	const offset = Math.max((args.offset as number) || 0, 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(swapTransactions.agentId, agent.id)]
			if (statusFilter) conditions.push(eq(swapTransactions.status, statusFilter))

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(and(...conditions))
						.orderBy(desc(swapTransactions.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			return {
				swaps: rows.map((s) => ({
					swap_id: s.id, status: s.status, tx_hash: s.txHash,
					from_chain: s.fromChain, to_chain: s.toChain,
					from_token: s.fromToken, to_token: s.toToken,
					from_amount: s.fromAmount, to_amount: s.toAmount,
					created_at: s.createdAt, completed_at: s.completedAt,
				})),
			}
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

// Mirrors GET /v1/agent/wallet/policies (src/routes/agent.ts)
async function handleListWalletPolicies(args: Record<string, unknown>, agent: Agent) {
	void args // wallet_address is accepted for parity but the agent's managed wallet is always used (matches REST route behavior)
	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string | undefined
	if (!subOrgId) return { isError: true, content: [{ type: 'text', text: 'No managed wallet found for this agent.' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			return yield* turnkeyService.listPolicies(subOrgId)
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }
	return { content: [{ type: 'text', text: JSON.stringify({ policies: result.right }) }] }
}

// Mirrors GET /v1/agent/predict/market/:id/book (src/routes/predict.ts)
async function handlePredictBook(args: Record<string, unknown>) {
	const marketId = args.market_id as string
	if (!marketId) return { isError: true, content: [{ type: 'text', text: 'market_id is required' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(marketId)

			if (market.tokens.length === 0) {
				return { marketId, question: market.question, outcomes: [] }
			}

			const books = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getOrderbook(t.tokenId), (book) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						...book,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId, question: market.question, outcomes: books }
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Polymarket error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

// Mirrors GET /v1/agent/predict/market/:id/price (src/routes/predict.ts)
async function handlePredictPrice(args: Record<string, unknown>) {
	const marketId = args.market_id as string
	if (!marketId) return { isError: true, content: [{ type: 'text', text: 'market_id is required' }] }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(marketId)

			if (market.tokens.length === 0) {
				return { marketId, question: market.question, prices: [] }
			}

			const prices = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getMidpoint(t.tokenId), (midData) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						mid: midData.mid,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId, question: market.question, prices }
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Polymarket error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

// Mirrors GET /v1/agent/predict/market/:id/trades (src/routes/predict.ts)
async function handlePredictTrades(args: Record<string, unknown>) {
	const marketId = args.market_id as string
	if (!marketId) return { isError: true, content: [{ type: 'text', text: 'market_id is required' }] }
	const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(marketId)

			if (market.tokens.length === 0) {
				return { marketId, question: market.question, trades: [] }
			}

			const allTrades = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getTrades(t.tokenId, limit), (trades) =>
						trades.map((tr) => ({ ...tr, outcome: t.outcome, tokenId: t.tokenId }))
					)
				),
				{ concurrency: 'unbounded' },
			)

			const merged = allTrades
				.flat()
				.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
				.slice(0, limit)

			return { marketId, question: market.question, trades: merged }
		}),
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: `Polymarket error: ${result.left.message}` }] }
	return { content: [{ type: 'text', text: JSON.stringify(result.right) }] }
}

// Dry-run a swap: fetch/reuse a quote and return a safety report WITHOUT
// signing or broadcasting anything. Shares the exact report-building logic
// (buildEvmSimulationReport / buildSolanaSimulationReport) with
// POST /v1/agent/swap/simulate in routes/agent.ts so the two surfaces can
// never drift. MONEY-PATH: reads live balances/quotes next to execution tools.
async function handleSimulateSwap(args: Record<string, unknown>, agent: Agent) {
	const parsed = SimulateSwapSchema.safeParse(args)
	if (!parsed.success) {
		return {
			isError: true,
			content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}` }],
		}
	}
	const { quote_id, from_token, to_token, amount, chain, from_chain, to_chain, wallet_address, slippage } = parsed.data

	// --- Case 1: simulate a previously fetched quote ---
	if (quote_id) {
		const cached = getCachedQuote(quote_id)
		if (!cached || (cached.agentId !== undefined && cached.agentId !== agent.id)) {
			return { isError: true, content: [{ type: 'text', text: 'Quote expired or not found. Get a new quote first, or pass from_token/to_token/amount.' }] }
		}

		if (cached.isSolana) {
			const quote = cached.quote as { inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct?: string; platformFee?: { amount: string } | null }
			const report = await buildSolanaSimulationReport({
				quoteId: quote_id, fromAddress: wallet_address,
				inputMint: quote.inputMint, outputMint: quote.outputMint,
				fromAmount: quote.inAmount, toAmount: quote.outAmount, toAmountMin: quote.otherAmountThreshold,
				priceImpactPct: quote.priceImpactPct ? parseFloat(quote.priceImpactPct) : null,
				platformFeeAmount: quote.platformFee?.amount,
			})
			return { content: [{ type: 'text', text: JSON.stringify(report) }] }
		}

		const quote = cached.quote
		const report = await buildEvmSimulationReport({
			quoteId: quote_id, fromAddress: wallet_address,
			fromTokenSymbol: quote.fromToken.symbol, fromTokenAddress: quote.fromToken.address,
			toTokenSymbol: quote.toToken.symbol, chainId: quote.transactionRequest.chainId,
			fromAmount: quote.fromAmount, toAmount: quote.toAmount, toAmountMin: quote.toAmountMin,
			toAmountUsd: quote.toAmountUsd,
			priceImpactPct: Number.isFinite(parseFloat(quote.priceImpact)) ? parseFloat(quote.priceImpact) : null,
			approvalAddress: quote._rawQuote?.estimate?.approvalAddress,
			gasEstimateUsd: quote.estimatedGasUsd, bridgeFeeUsd: quote.bridgeFeeUsd,
			tx: wallet_address
				? { to: quote.transactionRequest.to, data: quote.transactionRequest.data, value: quote.transactionRequest.value, from: wallet_address }
				: undefined,
		})
		return { content: [{ type: 'text', text: JSON.stringify(report) }] }
	}

	// --- Case 2: fetch a fresh quote, then simulate it ---
	if (!from_token || !to_token || !amount) {
		return { isError: true, content: [{ type: 'text', text: 'Provide quote_id, or from_token + to_token + amount' }] }
	}

	const chainKey = from_chain || chain || 'ethereum'
	if (isStarknet(chainKey) || (to_chain && isStarknet(to_chain))) {
		return { isError: true, content: [{ type: 'text', text: 'Starknet transactions are handled by the bot backend' }] }
	}

	if (isSolanaChain(chainKey)) {
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService
				const fromInfo = jupiterService.resolveToken(from_token)
				if (!fromInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found on Solana: ${from_token}` }))
				const toInfo = jupiterService.resolveToken(to_token)
				if (!toInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found on Solana: ${to_token}` }))

				const amountNum = parseFloat(amount)
				if (isNaN(amountNum) || amountNum <= 0) return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
				const lamports = BigInt(Math.floor(amountNum * Math.pow(10, fromInfo.decimals))).toString()

				const quote = yield* jupiterService.getQuote({
					inputMint: fromInfo.address, outputMint: toInfo.address,
					amount: lamports, slippageBps: slippage ? Math.floor(slippage * 10000) : 300,
				}).pipe(Effect.mapError((e) => (e instanceof ValidationError ? e : new ValidationError({ message: e.message }))))

				const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
				cacheAgentQuote(quoteId, quote, agent.id, true)
				return { quoteId, quote }
			})
		)
		if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }

		const { quoteId, quote } = result.right
		const report = await buildSolanaSimulationReport({
			quoteId, fromAddress: wallet_address,
			inputMint: quote.inputMint, outputMint: quote.outputMint,
			fromAmount: quote.inAmount, toAmount: quote.outAmount, toAmountMin: quote.otherAmountThreshold,
			priceImpactPct: quote.priceImpactPct ? parseFloat(quote.priceImpactPct) : null,
			platformFeeAmount: quote.platformFee?.amount,
		})
		return { content: [{ type: 'text', text: JSON.stringify(report) }] }
	}

	// EVM
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService
			const src = from_chain || chain || 'ethereum'
			const dst = to_chain || chain || 'ethereum'
			const srcInfo = tokenService.resolveChain(src)
			if (!srcInfo) return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${src}` }))
			const dstInfo = tokenService.resolveChain(dst)
			if (!dstInfo) return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${dst}` }))
			const fromInfo = yield* tokenService.resolveToken(from_token, srcInfo.id)
			if (!fromInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found: ${from_token} on ${srcInfo.name}` }))
			const toInfo = yield* tokenService.resolveToken(to_token, dstInfo.id)
			if (!toInfo) return yield* Effect.fail(new ValidationError({ message: `Token not found: ${to_token} on ${dstInfo.name}` }))

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			const wei = BigInt(Math.floor(amountNum * Math.pow(10, fromInfo.decimals))).toString()

			const quote = yield* swapService.getQuote({
				fromChain: srcInfo.id, toChain: dstInfo.id,
				fromToken: fromInfo.address, toToken: toInfo.address,
				fromAmount: wei, fromAddress: wallet_address || '0x0000000000000000000000000000000000000001',
				slippage: slippage || 0.03, order: 'RECOMMENDED', integrator: 'suwappu-openclaw',
			} as QuoteParams).pipe(Effect.mapError((e) => (e instanceof ValidationError ? e : new ValidationError({ message: e.message }))))

			cacheAgentQuote(quote.quoteId, quote, agent.id, false)
			return quote
		})
	)
	if (Either.isLeft(result)) return { isError: true, content: [{ type: 'text', text: result.left.message }] }

	const quote = result.right
	const report = await buildEvmSimulationReport({
		quoteId: quote.quoteId, fromAddress: wallet_address,
		fromTokenSymbol: quote.fromToken.symbol, fromTokenAddress: quote.fromToken.address,
		toTokenSymbol: quote.toToken.symbol, chainId: quote.transactionRequest.chainId,
		fromAmount: quote.fromAmount, toAmount: quote.toAmount, toAmountMin: quote.toAmountMin,
		toAmountUsd: quote.toAmountUsd,
		priceImpactPct: Number.isFinite(parseFloat(quote.priceImpact)) ? parseFloat(quote.priceImpact) : null,
		approvalAddress: quote._rawQuote?.estimate?.approvalAddress,
		gasEstimateUsd: quote.estimatedGasUsd, bridgeFeeUsd: quote.bridgeFeeUsd,
		tx: wallet_address
			? { to: quote.transactionRequest.to, data: quote.transactionRequest.data, value: quote.transactionRequest.value, from: wallet_address }
			: undefined,
	})
	return { content: [{ type: 'text', text: JSON.stringify(report) }] }
}

// ---------------------------------------------------------------
// Resources (MCP resources/list + resources/read)
//
// Self-contained, in-process data agents can read once and cache: the
// OpenAPI contract, the supported-chain list, and curated token lists.
// ---------------------------------------------------------------

const RESOURCES = [
	{ uri: 'suwappu://openapi.json', name: 'OpenAPI Specification', description: 'OpenAPI 3.1 spec for the full Suwappu agent REST API.', mimeType: 'application/json' },
	{ uri: 'suwappu://chains', name: 'Supported Chains', description: 'All blockchain networks Suwappu can swap across.', mimeType: 'application/json' },
	{ uri: 'suwappu://tokens/solana', name: 'Solana Token List', description: 'Curated SPL token list (symbol, mint address, decimals).', mimeType: 'application/json' },
	{ uri: 'suwappu://tokens/tempo', name: 'Tempo TIP-20 Token List', description: 'TIP-20 stablecoins on Tempo mainnet (chain 4217).', mimeType: 'application/json' },
] as const

function readResource(uri: string): { contents: Array<{ uri: string; mimeType: string; text: string }> } | null {
	let text: string | null
	switch (uri) {
		case 'suwappu://openapi.json':
			text = JSON.stringify(openApiSpec)
			break
		case 'suwappu://chains':
			text = handleListChains().content[0].text
			break
		case 'suwappu://tokens/solana':
			text = JSON.stringify({
				chain: 'Solana',
				tokens: Object.entries(SOLANA_TOKENS).map(([s, i]) => ({ symbol: s, address: i.address, decimals: i.decimals })),
			})
			break
		case 'suwappu://tokens/tempo':
			text = handleGetTempoTokens({}).content[0].text
			break
		default:
			text = null
	}
	if (text === null) return null
	const mimeType = RESOURCES.find((r) => r.uri === uri)?.mimeType ?? 'application/json'
	return { contents: [{ uri, mimeType, text }] }
}

// ---------------------------------------------------------------
// Prompts (MCP prompts/list + prompts/get)
//
// Reusable workflow templates that chain the tools above into the
// common agent journeys: swap, portfolio review, market research.
// ---------------------------------------------------------------

type PromptArg = { name: string; description: string; required: boolean }

const PROMPTS: Array<{ name: string; description: string; arguments: PromptArg[]; build: (a: Record<string, string>) => string }> = [
	{
		name: 'swap_tokens',
		description: 'Guided cross-chain swap: quote then prepare the unsigned transaction.',
		arguments: [
			{ name: 'from_token', description: 'Token to sell (e.g. ETH, USDC)', required: true },
			{ name: 'to_token', description: 'Token to buy', required: true },
			{ name: 'amount', description: 'Amount of from_token in human units', required: true },
			{ name: 'chain', description: 'Chain to swap on (defaults to ethereum)', required: false },
			{ name: 'wallet_address', description: 'Wallet that will sign the transaction', required: false },
		],
		build: (a) =>
			`Swap ${a.amount ?? '<amount>'} ${a.from_token ?? '<from_token>'} to ${a.to_token ?? '<to_token>'}` +
			`${a.chain ? ` on ${a.chain}` : ''}.\n\n` +
			`1. Call get_quote with from_token, to_token, amount${a.chain ? ', chain' : ''}` +
			`${a.wallet_address ? ', wallet_address' : ''} and report the quote_id, expected output, route and price impact.\n` +
			`2. Ask the user to confirm.\n` +
			`3. On confirmation, call execute_swap with the quote_id and wallet_address, then return the unsigned transaction for the user to sign.`,
	},
	{
		name: 'check_portfolio',
		description: 'Fetch and summarise a wallet portfolio across all chains.',
		arguments: [
			{ name: 'wallet_address', description: 'Wallet address to inspect (0x… or Solana base58)', required: true },
			{ name: 'chain', description: 'Optional chain to filter to', required: false },
		],
		build: (a) =>
			`Review the portfolio for ${a.wallet_address ?? '<wallet_address>'}${a.chain ? ` on ${a.chain}` : ''}.\n\n` +
			`Call get_portfolio, then summarise total USD value and the largest holdings, flagging any dust.`,
	},
	{
		name: 'research_prediction_market',
		description: 'Find a prediction market by topic and report live outcome prices.',
		arguments: [
			{ name: 'topic', description: 'Topic or category to search (e.g. "bitcoin", "election")', required: true },
		],
		build: (a) =>
			`Research prediction markets about "${a.topic ?? '<topic>'}".\n\n` +
			`1. Call predict_markets with query="${a.topic ?? '<topic>'}".\n` +
			`2. For the most relevant market, call predict_market_detail with its market_id.\n` +
			`3. Report the question, live outcome prices, volume and resolution date.`,
	},
]

// ---------------------------------------------------------------
// MCP JSON-RPC endpoint
// ---------------------------------------------------------------

mcpRoutes.post('/', async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json(rpcErr(null, -32700, 'Parse error', undefined, 'VALIDATION_ERROR'), 200)
	}

	const req = body as { jsonrpc: string; id: string | number | null; method: string; params?: any }
	if (!req || req.jsonrpc !== '2.0' || !req.method) {
		return c.json(rpcErr(req?.id ?? null, -32600, 'Invalid request', undefined, 'VALIDATION_ERROR'), 200)
	}

	// Only gate non-public methods on auth so anonymous MCP clients can complete the
	// initialize/tools-list handshake before ever presenting an API key (spec compliance).
	let agent: Agent | undefined
	if (!PUBLIC_MCP_METHODS.has(req.method)) {
		try {
			await agentBearerAuth()(c, async () => {})
		} catch (e) {
			c.header('WWW-Authenticate', 'Bearer realm="suwappu", error="invalid_token"')
			const message = e instanceof HTTPException ? e.message : 'Authentication required'
			return c.json(
				rpcErr(req.id, -32001, `${message}. Register an agent at https://suwappu.bot/agents to get an API key.`, undefined, 'UNAUTHORIZED'),
				401,
			)
		}
		agent = c.get('agent')

		// Track
		await runEffectEither(Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent!.id, 'request')
		}))
	}

	switch (req.method) {
		case 'initialize':
			return c.json(rpcOk(req.id, {
				protocolVersion: negotiateProtocolVersion((req.params || {}).protocolVersion),
				capabilities: { tools: {}, resources: {}, prompts: {} },
				serverInfo: { name: 'suwappu', version: '0.6.0' },
			}), 200)

		case 'tools/list':
			return c.json(rpcOk(req.id, { tools: TOOLS_WITH_ANNOTATIONS }), 200)

		case 'resources/list':
			return c.json(rpcOk(req.id, { resources: RESOURCES }), 200)

		case 'resources/read': {
			const uri = (req.params || {}).uri as string | undefined
			if (!uri) return c.json(rpcErr(req.id, -32602, 'Missing resource uri', undefined, 'VALIDATION_ERROR'), 200)
			const res = readResource(uri)
			if (!res) return c.json(rpcErr(req.id, -32602, `Unknown resource: ${uri}`, undefined, 'NOT_FOUND'), 200)
			return c.json(rpcOk(req.id, res), 200)
		}

		case 'prompts/list':
			return c.json(rpcOk(req.id, {
				prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })),
			}), 200)

		case 'prompts/get': {
			const { name, arguments: args } = (req.params || {}) as { name?: string; arguments?: Record<string, string> }
			if (!name) return c.json(rpcErr(req.id, -32602, 'Missing prompt name', undefined, 'VALIDATION_ERROR'), 200)
			const prompt = PROMPTS.find((p) => p.name === name)
			if (!prompt) return c.json(rpcErr(req.id, -32602, `Unknown prompt: ${name}`, undefined, 'NOT_FOUND'), 200)
			const missing = prompt.arguments.filter((a) => a.required && !(args || {})[a.name]).map((a) => a.name)
			if (missing.length > 0) return c.json(rpcErr(req.id, -32602, `Missing required argument(s): ${missing.join(', ')}`, undefined, 'VALIDATION_ERROR'), 200)
			return c.json(rpcOk(req.id, {
				description: prompt.description,
				messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args || {}) } }],
			}), 200)
		}

		case 'tools/call': {
			const { name, arguments: args } = (req.params || {}) as { name?: string; arguments?: Record<string, unknown> }
			if (!name) return c.json(rpcErr(req.id, -32602, 'Missing tool name', undefined, 'VALIDATION_ERROR'), 200)
			// tools/call is not in PUBLIC_MCP_METHODS, so agent is always set here.
			const callAgent = agent as Agent

			// Validate the tool exists and its required args are present BEFORE any
			// metering — nonexistent tools or malformed args must never consume credits.
			if (!TOOL_NAMES.has(name)) {
				return c.json(rpcErr(req.id, -32601, `Unknown tool: ${name}`, undefined, 'NOT_FOUND'), 200)
			}
			const argsError = validateToolArgs(name, args || {})
			if (argsError) {
				return c.json(rpcErr(req.id, -32602, argsError, undefined, 'VALIDATION_ERROR'), 200)
			}

			// Pay-per-call metering. Charges prepaid credits (or bypasses for
			// subscription tiers). On insufficient balance, return a JSON-RPC error
			// envelope carrying the x402 challenge so x402-aware MCP clients can settle
			// and retry (raw HTTP 402 bodies break JSON-RPC framing for other clients).
			const charge = await chargeAgentForCall({
				agent: { id: callAgent.id, rateLimitTier: callAgent.rateLimitTier },
				cost: costForTool(name),
				resource: `mcp://tools/${name}`,
				description: `Suwappu MCP tool: ${name} (${costForTool(name)} credit${costForTool(name) === 1 ? '' : 's'})`,
				paymentHeader: c.req.header('X-PAYMENT') ?? c.req.header('PAYMENT-SIGNATURE'),
			})
			if (charge.kind === 'insufficient') {
				const cenv = await runEffectEither(Effect.gen(function* () { return yield* EnvService }))
				if (Either.isRight(cenv)) setX402Headers(c, cenv.right, charge.challenge)
				// Content-negotiate: off-the-shelf x402 middleware (identified by an
				// X-PAYMENT header on the request, or an Accept header naming the x402
				// media type) expects the raw challenge at HTTP 402. Other MCP clients
				// (JSON-RPC only, no x402 awareness) get a 200 + JSON-RPC error envelope
				// carrying the challenge in `data`, since a raw 402 body breaks JSON-RPC
				// framing for them.
				const acceptsX402 =
					Boolean(c.req.header('X-PAYMENT')) ||
					(c.req.header('Accept') ?? '').includes('vnd.x402')
				if (acceptsX402) {
					return c.json(charge.challenge, 402)
				}
				return c.json(rpcErr(req.id, -32002, 'Payment required', { x402: charge.challenge }), 200)
			}
			if (charge.kind === 'ok') {
				c.header('X-Metering-Cost', String(charge.cost))
				c.header('X-Metering-Balance', String(charge.balance))
			}
			if (charge.kind === 'settled') {
				c.header('X-Metering-Cost', String(charge.cost))
				if (charge.txHash) c.header('X-Payment-Response', charge.txHash)
			}

			let result: { content: Array<{ type: string; text: string }>; isError?: boolean }
			// Wrap tool execution: a handler throw must not 500 with credits already
			// deducted, and a result with isError:true must not silently consume
			// credits either — refund in both cases. Only refund when the charge
			// actually deducted prepaid credits (kind === 'ok'); 'skip' (free/bypass/
			// disabled) never charged anything, and 'settled' (on-chain x402 payment)
			// isn't a refundable credit balance.
			try {
				switch (name) {
					case 'get_quote':
						result = await handleGetQuote(args || {}, callAgent)
						break
					case 'get_portfolio':
						result = await handleGetPortfolio(args || {}, callAgent)
						break
					case 'get_prices':
						result = await handleGetPrices(args || {})
						break
					case 'list_chains':
						result = handleListChains()
						break
					case 'list_tokens':
						result = handleListTokens(args || {})
						break
					case 'execute_swap':
						result = await handleExecuteSwap(args || {}, callAgent)
						break
					case 'simulate_swap':
						result = await handleSimulateSwap(args || {}, callAgent)
						break
					case 'get_tempo_tokens':
						result = handleGetTempoTokens(args || {})
						break
					case 'browse_mpp_directory':
						result = await handleBrowseMppDirectory(args || {})
						break
					case 'predict_markets':
						result = await handlePredictMarkets(args || {})
						break
					case 'predict_market':
					// predict_market_detail: legacy alias kept for older clients
					case 'predict_market_detail':
						result = await handlePredictMarketDetail(args || {})
						break
					case 'perps_markets':
						result = await handlePerpsMarkets()
						break
					case 'perps_quote':
						result = await handlePerpsQuote(args || {})
						break
					case 'perps_positions':
						result = await handlePerpsPositions(args || {}, callAgent)
						break
					case 'lend_markets':
						result = await handleLendMarkets(args || {})
						break
					case 'lend_market':
						result = await handleLendMarket(args || {})
						break
					case 'get_swap_status':
						result = await handleGetSwapStatus(args || {}, callAgent)
						break
					case 'get_swap_history':
						result = await handleGetSwapHistory(args || {}, callAgent)
						break
					case 'predict_book':
						result = await handlePredictBook(args || {})
						break
					case 'predict_price':
						result = await handlePredictPrice(args || {})
						break
					case 'predict_trades':
						result = await handlePredictTrades(args || {})
						break
					case 'list_wallet_policies':
						result = await handleListWalletPolicies(args || {}, callAgent)
						break
					default:
						// Unreachable while TOOL_NAMES gates above, but if a tool is added to
						// TOOLS without a case here, don't keep its charge.
						if (charge.kind === 'ok') {
							await refundChargedCall({
								agentId: callAgent.id,
								cost: charge.cost,
								reason: `no handler for tool ${name}`,
							})
						}
						return c.json(rpcErr(req.id, -32601, `Unknown tool: ${name}`, undefined, 'NOT_FOUND'), 200)
				}
			} catch (e) {
				if (charge.kind === 'ok') {
					await refundChargedCall({
						agentId: callAgent.id,
						cost: charge.cost,
						reason: `tool ${name} threw: ${e instanceof Error ? e.message : String(e)}`,
					})
				}
				return c.json(
					rpcErr(req.id, -32000, `Tool execution failed: ${e instanceof Error ? e.message : String(e)}`, undefined, 'UPSTREAM_ERROR'),
					200,
				)
			}

			if (result.isError && charge.kind === 'ok') {
				await refundChargedCall({
					agentId: callAgent.id,
					cost: charge.cost,
					reason: `tool ${name} returned isError`,
				})
			}

			return c.json(rpcOk(req.id, result), 200)
		}

		case 'notifications/initialized':
			// Client acknowledgment, no response needed for notifications
			return c.body(null, 204)

		default:
			return c.json(rpcErr(req.id, -32601, `Unknown method: ${req.method}`, undefined, 'NOT_FOUND'), 200)
	}
})

export { mcpRoutes }
// Exported for unit testing the static MCP surface (tools/resources/prompts), and
// for llms.txt (app.ts) to generate its MCP tool list from the single source of
// truth instead of a hand-written list that can drift out of sync.
export { TOOLS, TOOLS_WITH_ANNOTATIONS, RESOURCES, PROMPTS, readResource }
// Exported for unit testing protocol version negotiation.
export { SUPPORTED_MCP_VERSIONS, LATEST_MCP_VERSION, negotiateProtocolVersion }
