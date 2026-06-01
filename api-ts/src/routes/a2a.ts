import crypto from 'crypto'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import type { Agent } from '../db'
import { ValidationError } from '../errors'
import { fetchTokenPrices, SUPPORTED_PRICE_SYMBOLS } from '../lib/prices'
import { cacheAgentQuote } from '../lib/quoteCache'
import { agentBearerAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import {
	AgentService,
	CHAINS,
	JupiterService,
	type QuoteParams,
	SOLANA_TOKENS,
	SwapService,
	TokenService,
} from '../services'

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled'

interface TextPart {
	type: 'text'
	text: string
	mimeType?: string
}

interface DataPart {
	type: 'data'
	data: Record<string, unknown>
	mimeType?: string
}

type Part = TextPart | DataPart

interface A2AMessage {
	id: string
	role: 'user' | 'agent'
	parts: Part[]
}

interface A2ATask {
	id: string
	status: { state: TaskState; message?: string; timestamp: string }
	artifacts: Array<{ id: string; parts: Part[]; metadata?: Record<string, unknown> }>
	messages: A2AMessage[]
	contextId?: string
	createdAt: string
	updatedAt: string
}

interface JsonRpcRequest {
	jsonrpc: '2.0'
	id: string | number
	method: string
	params?: Record<string, unknown>
}

// -------------------------------------------------------------------
// Task store (in-memory, 1h expiry)
// -------------------------------------------------------------------

const tasks = new Map<string, A2ATask>()
const TASK_TTL = 60 * 60 * 1000

function cleanupTasks() {
	const now = Date.now()
	for (const [id, task] of tasks) {
		if (now - new Date(task.createdAt).getTime() > TASK_TTL) {
			tasks.delete(id)
		}
	}
}

const cleanupInterval = setInterval(cleanupTasks, 10 * 60 * 1000)

export function stopA2aCleanup() {
	clearInterval(cleanupInterval)
}

function isoNow(): string {
	return new Date().toISOString()
}

// -------------------------------------------------------------------
// JSON-RPC helpers
// -------------------------------------------------------------------

function jsonRpcOk(id: string | number, result: unknown) {
	return { jsonrpc: '2.0' as const, id, result }
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown) {
	return {
		jsonrpc: '2.0' as const,
		id,
		error: { code, message, ...(data !== undefined && { data }) },
	}
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const TASK_NOT_FOUND = -32001
const UNSUPPORTED_OPERATION = -32002

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function parseUserMessage(parts: Part[]): string {
	return parts
		.filter((p): p is TextPart => p.type === 'text')
		.map((p) => p.text)
		.join(' ')
		.trim()
}

function isSolanaChain(chain: string): boolean {
	const n = chain.toLowerCase().trim()
	return n === 'solana' || n === 'sol'
}

function getChainList(): string[] {
	const evmChains = Object.values(CHAINS)
		.filter((c, i, self) => i === self.findIndex((ch) => ch.id === c.id))
		.map((c) => c.name)
	return [...evmChains, 'Solana']
}

// Placeholder used for EVM quotes when the requesting agent has no usable
// on-chain wallet recorded. Li.Fi requires a `fromAddress`, but a quote built
// against a placeholder is non-executable (it cannot be signed by any agent).
const EVM_QUOTE_PLACEHOLDER_ADDRESS = '0x0000000000000000000000000000000000000001'
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

/**
 * Resolve the EVM `fromAddress` to use when generating a quote for an agent.
 *
 * Quotes are scoped to the requesting agent (see `cacheAgentQuote(..., agent.id)`),
 * so they must be priced against that agent's own wallet rather than a shared
 * placeholder. Using the real wallet ensures the resulting (future) executable
 * transaction can only be signed by the agent that requested it, removing the
 * cross-agent quote-reuse risk.
 *
 * Falls back to the non-executable placeholder when the agent has no valid EVM
 * wallet recorded, preserving prior behavior for those agents. A stored value is
 * only accepted if it is a well-formed EVM address, so malformed/Solana metadata
 * never reaches Li.Fi (which would reject the quote).
 */
export function resolveAgentEvmAddress(agent: Agent): string {
	const raw = (agent.metadata as Record<string, unknown> | null | undefined)?.wallet_address
	if (typeof raw === 'string' && EVM_ADDRESS_RE.test(raw)) {
		return raw
	}
	return EVM_QUOTE_PLACEHOLDER_ADDRESS
}

/**
 * Enforce that a cached quote belongs to the requesting agent.
 *
 * A2A does not currently expose a quote-execution endpoint, so this is not yet
 * called at runtime. It is provided (and exported) so that any future execution
 * path MUST validate ownership before returning a signable swap transaction —
 * without this check, an agent could pass another agent's `quote_id` and hijack
 * its swap. Returns false when the cached quote was created by a different agent.
 */
export function isQuoteOwnedByAgent(
	cached: { agentId?: number } | null | undefined,
	agentId: number,
): boolean {
	return !!cached && cached.agentId === agentId
}

// -------------------------------------------------------------------
// Message processing
// -------------------------------------------------------------------

async function processMessage(
	text: string,
	agent: Agent,
): Promise<{ parts: Part[]; metadata?: Record<string, unknown> }> {
	const lower = text.toLowerCase()

	// --- Swap / quote command ---
	const swapMatch = lower.match(
		/(?:swap|quote|convert|exchange)\s+([\d.]+)\s+(\w+)\s+(?:to|for|into)\s+(\w+)(?:\s+on\s+(\w+))?/,
	)
	if (swapMatch) {
		const [, amount, fromToken, toToken, chain] = swapMatch
		const chainKey = chain || 'ethereum'
		if (isSolanaChain(chainKey)) {
			return processSolanaQuote(amount, fromToken, toToken, agent)
		}
		return processEvmQuote(amount, fromToken, toToken, chainKey, agent)
	}

	// --- Price check: "price of ETH" or "price ETH SOL USDC" ---
	const priceMatch = lower.match(/(?:price|prices?)(?:\s+of)?\s+(.+)/)
	if (priceMatch) {
		const symbols = priceMatch[1].split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean)
		if (symbols.length > 0 && symbols.length <= 20) {
			const prices = await fetchTokenPrices(symbols)
			const lines = Object.entries(prices).map(
				([sym, p]: [string, any]) => `${sym}: $${p.usd.toFixed(2)} (${p.usd_24h_change >= 0 ? '+' : ''}${p.usd_24h_change.toFixed(2)}%)`,
			)
			return {
				parts: [
					{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No price data found for those symbols.' },
					{ type: 'data', data: { prices, symbols } },
				],
				metadata: { action: 'prices' },
			}
		}
	}

	// --- Balance / portfolio ---
	const portfolioMatch = lower.match(/(?:balance|portfolio|wallet)\s+(?:of\s+|for\s+)?(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/)
	if (portfolioMatch) {
		const walletAddress = portfolioMatch[1]
		return {
			parts: [
				{ type: 'text', text: `To check balances for ${walletAddress}, use the MCP endpoint at /mcp with the get_portfolio tool, or call GET /v1/agent/portfolio?wallet_address=${walletAddress}` },
				{ type: 'data', data: { action: 'portfolio_hint', wallet_address: walletAddress, endpoints: ['/mcp', '/v1/agent/portfolio'] } },
			],
			metadata: { action: 'portfolio_hint' },
		}
	}
	if (lower.includes('balance') || lower.includes('portfolio')) {
		return {
			parts: [
				{ type: 'text', text: 'Portfolio check requires a wallet address. Example: "balance 0x1234..." or use GET /v1/agent/portfolio?wallet_address=0x...' },
			],
		}
	}

	// --- Token list ---
	const tokenMatch = lower.match(/(?:tokens?|list tokens?)(?:\s+on\s+(\w+))?/)
	if (tokenMatch) {
		const chain = tokenMatch[1]
		if (chain && isSolanaChain(chain)) {
			const tokens = Object.entries(SOLANA_TOKENS).map(([s, i]) => ({ symbol: s, address: i.address, decimals: i.decimals }))
			return {
				parts: [
					{ type: 'text', text: `Solana tokens: ${tokens.map((t) => t.symbol).join(', ')}` },
					{ type: 'data', data: { chain: 'Solana', tokens } },
				],
				metadata: { action: 'list_tokens', chain: 'Solana' },
			}
		}
		return {
			parts: [
				{ type: 'text', text: `Use GET /v1/agent/tokens?chain=${chain || 'base'} for the full token list, or the MCP endpoint with list_tokens tool.` },
				{ type: 'data', data: { action: 'list_tokens_hint', available_chains: getChainList() } },
			],
			metadata: { action: 'list_tokens' },
		}
	}

	// --- Chains list ---
	if (lower.includes('chain') || lower.includes('supported') || lower.includes('networks')) {
		const chainList = getChainList()
		return {
			parts: [
				{ type: 'text', text: `Supported chains: ${chainList.join(', ')}` },
				{ type: 'data', data: { chains: chainList, count: chainList.length } },
			],
			metadata: { action: 'list_chains' },
		}
	}

	// --- Help ---
	if (lower.includes('help') || lower.includes('commands') || lower === 'hi' || lower === 'hello') {
		return {
			parts: [
				{
					type: 'text',
					text: [
						'Suwappu DEX Agent — available commands:',
						'• "swap 0.5 ETH to USDC on base" — get a swap quote',
						'• "price ETH SOL BTC" — check token prices',
						'• "balance 0x1234..." — portfolio hint',
						'• "chains" — list supported chains',
						'• "tokens on solana" — list tokens',
						'',
						'For programmatic access, use the MCP endpoint at /mcp or REST API at /v1/agent/*',
					].join('\n'),
				},
				{
					type: 'data',
					data: {
						capabilities: ['swap', 'quote', 'prices', 'portfolio', 'chains', 'tokens'],
						endpoints: { mcp: '/mcp', rest: '/v1/agent', a2a: '/a2a' },
					},
				},
			],
			metadata: { action: 'help' },
		}
	}

	// --- Unknown ---
	return {
		parts: [
			{
				type: 'text',
				text: `Could not understand: "${text}". Try "swap 0.5 ETH to USDC on base", "price ETH", or "help".`,
			},
			{
				type: 'data',
				data: { error: 'unrecognized_command', input: text, hint: 'Send "help" for available commands' },
			},
		],
	}
}

async function processEvmQuote(
	amount: string,
	fromToken: string,
	toToken: string,
	chainKey: string,
	agent: Agent,
): Promise<{ parts: Part[]; metadata?: Record<string, unknown> }> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService

			const chainInfo = tokenService.resolveChain(chainKey)
			if (!chainInfo) {
				return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${chainKey}` }))
			}

			const fromTokenInfo = yield* tokenService.resolveToken(fromToken, chainInfo.id)
			if (!fromTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({ message: `Token not found: ${fromToken} on ${chainInfo.name}` }),
				)
			}

			const toTokenInfo = yield* tokenService.resolveToken(toToken, chainInfo.id)
			if (!toTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({ message: `Token not found: ${toToken} on ${chainInfo.name}` }),
				)
			}

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const fromAmountWei = BigInt(Math.floor(amountNum * 10 ** fromTokenInfo.decimals)).toString()

			const quote = yield* swapService
				.getQuote({
					fromChain: chainInfo.id,
					toChain: chainInfo.id,
					fromToken: fromTokenInfo.address,
					toToken: toTokenInfo.address,
					fromAmount: fromAmountWei,
					fromAddress: resolveAgentEvmAddress(agent),
					slippage: 0.03,
					integrator: 'suwappu-a2a',
				} as QuoteParams)
				.pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

			const toAmountHuman = parseFloat(quote.toAmount) / 10 ** toTokenInfo.decimals
			const quoteId = quote.quoteId
			// Scope the cached quote to the requesting agent. Any future quote
			// execution path MUST re-validate ownership via isQuoteOwnedByAgent
			// before returning a signable transaction.
			cacheAgentQuote(quoteId, quote, agent.id, false)

			return {
				quote_id: quoteId,
				from_token: fromTokenInfo.symbol,
				to_token: toTokenInfo.symbol,
				amount_in: amount,
				amount_out: toAmountHuman.toFixed(6),
				chain: chainInfo.name,
				exchange_rate: quote.exchangeRate,
				gas_usd: quote.estimatedGasUsd,
				route: quote.route,
				expires_in_seconds: 60,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return {
			parts: [
				{ type: 'text', text: `Quote failed: ${result.left.message}` },
				{ type: 'data', data: { error: 'quote_failed', message: result.left.message } },
			],
		}
	}

	const q = result.right
	return {
		parts: [
			{ type: 'text', text: `Quote: ${q.amount_in} ${q.from_token} → ${q.amount_out} ${q.to_token} on ${q.chain} (rate: ${q.exchange_rate}, gas: $${q.gas_usd})` },
			{ type: 'data', data: q as unknown as Record<string, unknown> },
		],
		metadata: { action: 'quote', chain: q.chain, quote_id: q.quote_id },
	}
}

async function processSolanaQuote(
	amount: string,
	fromToken: string,
	toToken: string,
	agent: Agent,
): Promise<{ parts: Part[]; metadata?: Record<string, unknown> }> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const jupiterService = yield* JupiterService

			const fromTokenInfo = jupiterService.resolveToken(fromToken)
			if (!fromTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Token not found on Solana: ${fromToken}`,
						fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
					}),
				)
			}

			const toTokenInfo = jupiterService.resolveToken(toToken)
			if (!toTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Token not found on Solana: ${toToken}`,
						fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
					}),
				)
			}

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const lamports = BigInt(Math.floor(amountNum * 10 ** fromTokenInfo.decimals)).toString()

			const quote = yield* jupiterService
				.getQuote({
					inputMint: fromTokenInfo.address,
					outputMint: toTokenInfo.address,
					amount: lamports,
					slippageBps: 300,
				})
				.pipe(
					Effect.mapError((e) => {
						if (e instanceof ValidationError) return e
						return new ValidationError({ message: e.message })
					}),
				)

			const fromAmountHuman = parseFloat(quote.inAmount) / 10 ** fromTokenInfo.decimals
			const toAmountHuman = parseFloat(quote.outAmount) / 10 ** toTokenInfo.decimals
			const route = quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> ')

			const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
			// Scope the cached quote to the requesting agent. Any future quote
			// execution path MUST re-validate ownership via isQuoteOwnedByAgent
			// before returning a signable transaction.
			cacheAgentQuote(quoteId, quote, agent.id, true)

			return {
				quote_id: quoteId,
				from_token: fromTokenInfo.name,
				to_token: toTokenInfo.name,
				amount_in: fromAmountHuman.toString(),
				amount_out: toAmountHuman.toFixed(6),
				chain: 'Solana',
				price_impact: quote.priceImpactPct,
				route,
				expires_in_seconds: 60,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return {
			parts: [
				{ type: 'text', text: `Solana quote failed: ${result.left.message}` },
				{ type: 'data', data: { error: 'quote_failed', message: result.left.message } },
			],
		}
	}

	const q = result.right
	return {
		parts: [
			{ type: 'text', text: `Quote: ${q.amount_in} ${q.from_token} → ${q.amount_out} ${q.to_token} on Solana (impact: ${q.price_impact}%, route: ${q.route})` },
			{ type: 'data', data: q as unknown as Record<string, unknown> },
		],
		metadata: { action: 'quote', chain: 'Solana', quote_id: q.quote_id },
	}
}

// -------------------------------------------------------------------
// Route
// -------------------------------------------------------------------

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const a2aRoutes = new Hono<AgentContext>()

a2aRoutes.use('*', agentBearerAuth())

a2aRoutes.post('/', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json(jsonRpcError(null, PARSE_ERROR, 'Parse error: invalid JSON'), 200)
	}

	const req = body as JsonRpcRequest
	if (!req || req.jsonrpc !== '2.0' || !req.method || (req.id === undefined && req.id === null)) {
		return c.json(jsonRpcError(req?.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC request'), 200)
	}

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		}),
	)

	switch (req.method) {
		case 'message/send':
			return handleMessageSend(c, req, agent)
		case 'tasks/get':
			return handleTasksGet(c, req)
		case 'tasks/cancel':
			return handleTasksCancel(c, req)
		default:
			return c.json(jsonRpcError(req.id, METHOD_NOT_FOUND, `Unknown method: ${req.method}`), 200)
	}
})

// -------------------------------------------------------------------
// Method handlers
// -------------------------------------------------------------------

async function handleMessageSend(c: any, req: JsonRpcRequest, agent: Agent) {
	const params = req.params as
		| {
				message?: { role?: string; parts?: Part[] }
				contextId?: string
		  }
		| undefined

	if (
		!params?.message?.parts ||
		!Array.isArray(params.message.parts) ||
		params.message.parts.length === 0
	) {
		return c.json(
			jsonRpcError(
				req.id,
				INVALID_REQUEST,
				'message.parts is required and must be a non-empty array',
			),
			200,
		)
	}

	const userText = parseUserMessage(params.message.parts)
	if (!userText) {
		return c.json(
			jsonRpcError(req.id, INVALID_REQUEST, 'No text content found in message parts'),
			200,
		)
	}

	const taskId = crypto.randomUUID()
	const now = isoNow()
	const userMessage: A2AMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		parts: params.message.parts,
	}

	const task: A2ATask = {
		id: taskId,
		status: { state: 'working', timestamp: now },
		artifacts: [],
		messages: [userMessage],
		contextId: params.contextId || taskId,
		createdAt: now,
		updatedAt: now,
	}
	tasks.set(taskId, task)

	try {
		const result = await processMessage(userText, agent)

		task.artifacts.push({
			id: crypto.randomUUID(),
			parts: result.parts,
			metadata: result.metadata,
		})

		task.messages.push({
			id: crypto.randomUUID(),
			role: 'agent',
			parts: result.parts,
		})

		task.status = { state: 'completed', timestamp: isoNow() }
		task.updatedAt = isoNow()
	} catch (err) {
		task.status = {
			state: 'failed',
			message: err instanceof Error ? err.message : 'Internal error',
			timestamp: isoNow(),
		}
		task.updatedAt = isoNow()
	}

	return c.json(jsonRpcOk(req.id, { task }), 200)
}

async function handleTasksGet(c: any, req: JsonRpcRequest) {
	const params = req.params as { taskId?: string } | undefined
	if (!params?.taskId) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'params.taskId is required'), 200)
	}

	const task = tasks.get(params.taskId)
	if (!task) {
		return c.json(jsonRpcError(req.id, TASK_NOT_FOUND, `Task not found: ${params.taskId}`), 200)
	}

	return c.json(jsonRpcOk(req.id, { task }), 200)
}

async function handleTasksCancel(c: any, req: JsonRpcRequest) {
	const params = req.params as { taskId?: string } | undefined
	if (!params?.taskId) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'params.taskId is required'), 200)
	}

	const task = tasks.get(params.taskId)
	if (!task) {
		return c.json(jsonRpcError(req.id, TASK_NOT_FOUND, `Task not found: ${params.taskId}`), 200)
	}

	if (task.status.state === 'completed' || task.status.state === 'failed') {
		return c.json(
			jsonRpcError(
				req.id,
				UNSUPPORTED_OPERATION,
				`Cannot cancel task in ${task.status.state} state`,
			),
			200,
		)
	}

	task.status = { state: 'canceled', timestamp: isoNow() }
	task.updatedAt = isoNow()

	return c.json(jsonRpcOk(req.id, { task }), 200)
}

export { a2aRoutes }
