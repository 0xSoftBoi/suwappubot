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
import { Effect, Either, Option } from 'effect'
import { AgentService, TokenService, SwapService, BalanceService, JupiterService, CHAINS, COMMON_TOKENS, SOLANA_TOKENS, type QuoteParams } from '../services'
import { isStarknet } from '../config/chains'
import { PolymarketService } from '../services/PolymarketService'
import { runEffectEither } from '../runtime'
import { ValidationError } from '../errors'
import { agentBearerAuth } from '../middleware'
import { cacheAgentQuote, getCachedQuote } from '../lib/quoteCache'
import { fetchTokenPrices, SUPPORTED_PRICE_SYMBOLS } from '../lib/prices'
import type { Agent } from '../db'

type McpContext = { Variables: { agent: Agent } }

const mcpRoutes = new Hono<McpContext>()
mcpRoutes.use('*', agentBearerAuth())

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
			},
			required: ['quote_id', 'wallet_address'],
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
		description: 'Browse the MPP (Micropayment Protocol) service directory to discover available services and their payment requirements.',
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
		name: 'predict_market_detail',
		description: 'Get detailed prediction market info including live CLOB midpoint prices for each outcome. Requires a market condition ID.',
		inputSchema: {
			type: 'object',
			properties: {
				market_id: { type: 'string', description: 'Market condition ID (from predict_markets results)' },
			},
			required: ['market_id'],
		},
	},
]

// ---------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------

function rpcOk(id: string | number | null, result: unknown) {
	return { jsonrpc: '2.0' as const, id, result }
}

function rpcErr(id: string | number | null, code: number, message: string, data?: unknown) {
	return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data !== undefined && { data }) } }
}

// ---------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------

function isSolanaChain(chain: string): boolean {
	const n = chain.toLowerCase().trim()
	return n === 'solana' || n === 'sol'
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

async function handleGetPortfolio(args: Record<string, unknown>) {
	const { wallet_address, chain } = args as { wallet_address: string; chain?: string }
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

async function handleExecuteSwap(args: Record<string, unknown>, agent: Agent) {
	const { quote_id, wallet_address } = args as { quote_id: string; wallet_address: string }
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
		instructions: 'Sign transaction with wallet and submit to chain RPC',
	}) }] }
}

// ---------------------------------------------------------------
// MCP JSON-RPC endpoint
// ---------------------------------------------------------------

mcpRoutes.post('/', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json(rpcErr(null, -32700, 'Parse error'), 200)
	}

	const req = body as { jsonrpc: string; id: string | number | null; method: string; params?: any }
	if (!req || req.jsonrpc !== '2.0' || !req.method) {
		return c.json(rpcErr(req?.id ?? null, -32600, 'Invalid request'), 200)
	}

	// Track
	await runEffectEither(Effect.gen(function* () {
		const agentService = yield* AgentService
		yield* agentService.incrementAgentStats(agent.id, 'request')
	}))

	switch (req.method) {
		case 'initialize':
			return c.json(rpcOk(req.id, {
				protocolVersion: '2024-11-05',
				capabilities: { tools: {} },
				serverInfo: { name: 'suwappu', version: '0.5.0' },
			}), 200)

		case 'tools/list':
			return c.json(rpcOk(req.id, { tools: TOOLS }), 200)

		case 'tools/call': {
			const { name, arguments: args } = (req.params || {}) as { name?: string; arguments?: Record<string, unknown> }
			if (!name) return c.json(rpcErr(req.id, -32602, 'Missing tool name'), 200)

			let result: { content: Array<{ type: string; text: string }>; isError?: boolean }
			switch (name) {
				case 'get_quote':
					result = await handleGetQuote(args || {}, agent)
					break
				case 'get_portfolio':
					result = await handleGetPortfolio(args || {})
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
					result = await handleExecuteSwap(args || {}, agent)
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
				case 'predict_market_detail':
					result = await handlePredictMarketDetail(args || {})
					break
				default:
					return c.json(rpcErr(req.id, -32601, `Unknown tool: ${name}`), 200)
			}

			return c.json(rpcOk(req.id, result), 200)
		}

		case 'notifications/initialized':
			// Client acknowledgment, no response needed for notifications
			return c.body(null, 204)

		default:
			return c.json(rpcErr(req.id, -32601, `Unknown method: ${req.method}`), 200)
	}
})

export { mcpRoutes }
