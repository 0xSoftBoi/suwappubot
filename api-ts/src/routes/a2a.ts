import crypto from 'crypto'
import { isStarknet } from '../config/chains'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Agent } from '../db'
import { ValidationError } from '../errors'
import type { AgentErrorCode } from '../lib/agentError'
import { fetchTokenPrices, SUPPORTED_PRICE_SYMBOLS } from '../lib/prices'
import { sanitizeReflectedText } from '../lib/outboundSanitize'
import { cacheAgentQuote } from '../lib/quoteCache'
import { agentBearerAuth, scanForThreatsObserveOnly } from '../middleware'
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
	// A2A spec 0.3 renamed `type` to `kind`. We emit both on outgoing parts (see
	// withKind()) so pre-0.3 and 0.3 clients both parse correctly.
	kind?: 'text'
	text: string
	mimeType?: string
}

interface DataPart {
	type: 'data'
	kind?: 'data'
	data: Record<string, unknown>
	mimeType?: string
}

type Part = TextPart | DataPart

/** Stamp `kind` alongside `type` on outgoing parts (A2A 0.3 compatibility). */
function withKind(parts: Part[]): Part[] {
	return parts.map((p): Part => (p.type === 'text' ? { ...p, kind: 'text' } : { ...p, kind: 'data' }))
}

interface A2AMessage {
	id: string
	role: 'user' | 'agent'
	parts: Part[]
}

interface A2ATask {
	id: string
	/** Agent that created the task — enforced on tasks/get + tasks/cancel so one agent cannot read or cancel another's task. */
	agentId: number
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

// --- Agent-scoped quote pricing / ownership (H10) ---
// Li.Fi requires a fromAddress; a quote priced against a shared placeholder is
// non-executable. Quotes are cached per agent (cacheAgentQuote(..., agent.id)),
// so price them against that agent's own wallet so any future executable tx can
// only be signed by the requesting agent.
const EVM_QUOTE_PLACEHOLDER_ADDRESS = '0x0000000000000000000000000000000000000001'
const A2A_EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

/** The agent's recorded EVM wallet if well-formed, else the non-executable placeholder. */
export function resolveAgentEvmAddress(agent: Agent): string {
	const raw = (agent.metadata as Record<string, unknown> | null | undefined)?.wallet_address
	if (typeof raw === 'string' && A2A_EVM_ADDRESS_RE.test(raw)) return raw
	return EVM_QUOTE_PLACEHOLDER_ADDRESS
}

/**
 * Mandatory ownership gate for any future A2A quote-execution path: a cached quote
 * may only be executed by the agent that created it. A2A has no execution endpoint
 * today, so this is exported and documented but not yet wired at runtime.
 */
export function isQuoteOwnedByAgent(
	cached: { agentId?: number } | null | undefined,
	agentId: number,
): boolean {
	return !!cached && cached.agentId === agentId
}

/**
 * Ownership gate for tasks/get + tasks/cancel: a task may only be read or cancelled
 * by the agent that created it. Callers treat a non-owned task as not-found so its
 * existence and contents can't leak across agents via guessed/leaked task IDs.
 */
export function isTaskOwnedByAgent(
	task: A2ATask | null | undefined,
	agentId: number,
): task is A2ATask {
	return !!task && task.agentId === agentId
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

function jsonRpcError(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
	errorCode?: AgentErrorCode,
) {
	const mergedData =
		errorCode !== undefined
			? { ...(typeof data === 'object' && data !== null ? data : data !== undefined ? { data } : {}), error_code: errorCode }
			: data
	return {
		jsonrpc: '2.0' as const,
		id,
		error: { code, message, ...(mergedData !== undefined && { data: mergedData }) },
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
		.filter((p): p is TextPart => ((p as { kind?: string }).kind ?? p.type) === 'text')
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

// -------------------------------------------------------------------
// Message processing
// -------------------------------------------------------------------

export async function processMessage(
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
		if (amount && fromToken && toToken) {
			const chainKey = chain || 'ethereum'
			// Starknet is read-only in the TS stack — signing/broadcast lives in the Python bot
			if (isStarknet(chainKey)) {
				return {
					parts: [{ type: 'text', text: 'Starknet transactions are handled by the bot backend' }],
					metadata: { action: 'unsupported_chain', chain: 'starknet' },
				}
			}
			if (isSolanaChain(chainKey)) {
				return processSolanaQuote(amount, fromToken, toToken, agent)
			}
			return processEvmQuote(amount, fromToken, toToken, chainKey, agent)
		}
	}

	// --- Price check: "price of ETH" or "price ETH SOL USDC" ---
	const priceMatch = lower.match(/(?:price|prices?)(?:\s+of)?\s+(.+)/)
	if (priceMatch) {
		const symbols = (priceMatch[1] ?? '').split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean)
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
	// `text` here is unrecognized, caller-controlled free text. A2A responses
	// may be rendered by other agents/clients, so scrub it before reflecting it
	// back in either the human-readable text part or the structured data part
	// (§3.4 outbound sanitization) — length-capped and control/formatting
	// sequences neutralized. This only shapes what's echoed; command matching
	// above is untouched.
	const safeInput = sanitizeReflectedText(text)
	return {
		parts: [
			{
				type: 'text',
				text: `Could not understand: "${safeInput}". Try "swap 0.5 ETH to USDC on base", "price ETH", or "help".`,
			},
			{
				type: 'data',
				data: { error: 'unrecognized_command', input: safeInput, hint: 'Send "help" for available commands' },
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
			cacheAgentQuote(quoteId, quote, agent.id, false, {
				fromDecimals: fromTokenInfo.decimals,
				toDecimals: toTokenInfo.decimals,
			})

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
			// Jupiter's raw quote carries no decimals, so execute-time can only get
			// them from here — without this the quote is permanently un-executable.
			cacheAgentQuote(quoteId, quote, agent.id, true, {
				fromDecimals: fromTokenInfo.decimals,
				toDecimals: toTokenInfo.decimals,
			})

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

// /a2a is a pure JSON-RPC endpoint — auth failures must stay inside the JSON-RPC
// envelope (not a raw HTTPException body), so auth is run manually inside the
// handler rather than as a blanket `use('*', ...)` gate.
a2aRoutes.post('/', async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json(jsonRpcError(null, PARSE_ERROR, 'Parse error: invalid JSON', undefined, 'VALIDATION_ERROR'), 200)
	}

	const req = body as JsonRpcRequest
	if (!req || req.jsonrpc !== '2.0' || !req.method || req.id === undefined || req.id === null) {
		return c.json(jsonRpcError(req?.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC request', undefined, 'VALIDATION_ERROR'), 200)
	}

	try {
		await agentBearerAuth()(c, async () => {})
	} catch (e) {
		c.header('WWW-Authenticate', 'Bearer realm="suwappu", error="invalid_token"')
		const message = e instanceof HTTPException ? e.message : 'Authentication required'
		return c.json(
			jsonRpcError(req.id, -32001, `${message}. Register an agent at https://suwappu.bot/agents to get an API key.`, undefined, 'UNAUTHORIZED'),
			401,
		)
	}
	const agent = c.get('agent')

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
			return handleTasksGet(c, req, agent)
		case 'tasks/cancel':
			return handleTasksCancel(c, req, agent)
		default:
			return c.json(jsonRpcError(req.id, METHOD_NOT_FOUND, `Unknown method: ${req.method}`, undefined, 'NOT_FOUND'), 200)
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

	// AEGIS observe-mode scan (Phase 3). Log-only — never blocks message/send
	// and never alters the response produced below.
	scanForThreatsObserveOnly(userText, { source: 'a2a_message_send', agentId: agent?.id })

	const taskId = crypto.randomUUID()
	const now = isoNow()
	const userMessage: A2AMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		parts: params.message.parts,
	}

	const task: A2ATask = {
		id: taskId,
		agentId: agent.id,
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

		const outgoingParts = withKind(result.parts)

		task.artifacts.push({
			id: crypto.randomUUID(),
			parts: outgoingParts,
			...(result.metadata !== undefined && { metadata: result.metadata }),
		})

		task.messages.push({
			id: crypto.randomUUID(),
			role: 'agent',
			parts: outgoingParts,
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

async function handleTasksGet(c: any, req: JsonRpcRequest, agent: Agent) {
	// Spec 0.3 clients send `id`; earlier drafts sent `taskId`. Accept either.
	const params = req.params as { id?: string; taskId?: string } | undefined
	const taskId = params?.id ?? params?.taskId
	if (!taskId) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'params.id is required', undefined, 'VALIDATION_ERROR'), 200)
	}

	// Scope task lookup to the owning agent: treat another agent's task as not-found so
	// existence (and contents) can't leak across agents via guessed/leaked task IDs.
	const task = tasks.get(taskId)
	if (!isTaskOwnedByAgent(task, agent.id)) {
		return c.json(jsonRpcError(req.id, TASK_NOT_FOUND, `Task not found: ${taskId}`, undefined, 'NOT_FOUND'), 200)
	}

	return c.json(jsonRpcOk(req.id, { task }), 200)
}

async function handleTasksCancel(c: any, req: JsonRpcRequest, agent: Agent) {
	const params = req.params as { id?: string; taskId?: string } | undefined
	const taskId = params?.id ?? params?.taskId
	if (!taskId) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'params.id is required', undefined, 'VALIDATION_ERROR'), 200)
	}

	const task = tasks.get(taskId)
	if (!isTaskOwnedByAgent(task, agent.id)) {
		return c.json(jsonRpcError(req.id, TASK_NOT_FOUND, `Task not found: ${taskId}`, undefined, 'NOT_FOUND'), 200)
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
