import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { AgentService, TokenService, SwapService, JupiterService, CHAINS, SOLANA_TOKENS, type QuoteParams } from '../services'
import { runEffectEither } from '../runtime'
import { ValidationError } from '../errors'
import { agentBearerAuth } from '../middleware'
import type { Agent } from '../db'
import crypto from 'crypto'

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
const TASK_TTL = 60 * 60 * 1000 // 1 hour

function cleanupTasks() {
	const now = Date.now()
	for (const [id, task] of tasks) {
		if (now - new Date(task.createdAt).getTime() > TASK_TTL) {
			tasks.delete(id)
		}
	}
}

// Periodic cleanup every 10 minutes
setInterval(cleanupTasks, 10 * 60 * 1000)

function newTaskId(): string {
	return crypto.randomUUID()
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
	return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data !== undefined && { data }) } }
}

// A2A-specific error codes
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const TASK_NOT_FOUND = -32001
const UNSUPPORTED_OPERATION = -32002

// -------------------------------------------------------------------
// Command parser (reused from agent execute logic)
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

// -------------------------------------------------------------------
// Message processing — routes to swap/quote/portfolio
// -------------------------------------------------------------------

async function processMessage(text: string, agent: Agent): Promise<{ parts: Part[]; metadata?: Record<string, unknown> }> {
	const lower = text.toLowerCase()

	// --- Swap command ---
	const swapMatch = lower.match(
		/swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)(?:\s+on\s+(\w+))?/
	)
	if (swapMatch) {
		const [, amount, fromToken, toToken, chain] = swapMatch
		const chainKey = chain || 'ethereum'

		if (isSolanaChain(chainKey)) {
			return processSolanaQuote(amount, fromToken, toToken, agent)
		}
		return processEvmQuote(amount, fromToken, toToken, chainKey, agent)
	}

	// --- Quote / price command ---
	const quoteMatch = lower.match(
		/(?:quote|price)\s+(?:of\s+)?([\d.]+)\s+(\w+)\s+(?:to|in|for)\s+(\w+)(?:\s+on\s+(\w+))?/
	)
	if (quoteMatch) {
		const [, amount, fromToken, toToken, chain] = quoteMatch
		const chainKey = chain || 'ethereum'

		if (isSolanaChain(chainKey)) {
			return processSolanaQuote(amount, fromToken, toToken, agent)
		}
		return processEvmQuote(amount, fromToken, toToken, chainKey, agent)
	}

	// --- Balance / portfolio ---
	if (lower.includes('balance') || lower.includes('portfolio')) {
		return {
			parts: [
				{ type: 'text', text: 'Portfolio check requires a wallet address. Use POST /v1/agent/portfolio?wallet_address=0x... for balance details.' },
			],
		}
	}

	// --- Chains list ---
	if (lower.includes('chains') || lower.includes('supported')) {
		const uniqueChains = Object.values(CHAINS)
			.filter((chain, index, self) =>
				index === self.findIndex((c) => c.id === chain.id)
			)
			.map((c) => c.name)

		const chainList = [
			...uniqueChains,
			'Solana',
		]
		return {
			parts: [
				{ type: 'text', text: `Supported chains: ${chainList.join(', ')}` },
				{ type: 'data', data: { chains: chainList } },
			],
		}
	}

	// --- Unknown ---
	return {
		parts: [
			{
				type: 'text',
				text: `Could not understand: "${text}". Try commands like "swap 0.5 ETH to USDC on base" or "quote 1 ETH to USDC".`,
			},
		],
	}
}

async function processEvmQuote(
	amount: string, fromToken: string, toToken: string, chainKey: string, agent: Agent
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
				return yield* Effect.fail(new ValidationError({ message: `Token not found: ${fromToken} on ${chainInfo.name}` }))
			}

			const toTokenInfo = yield* tokenService.resolveToken(toToken, chainInfo.id)
			if (!toTokenInfo) {
				return yield* Effect.fail(new ValidationError({ message: `Token not found: ${toToken} on ${chainInfo.name}` }))
			}

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const fromAmountWei = BigInt(Math.floor(amountNum * Math.pow(10, fromTokenInfo.decimals))).toString()

			const quote = yield* swapService.getQuote({
				fromChain: chainInfo.id,
				toChain: chainInfo.id,
				fromToken: fromTokenInfo.address,
				toToken: toTokenInfo.address,
				fromAmount: fromAmountWei,
				fromAddress: '0x0000000000000000000000000000000000000001',
				slippage: 0.03,
				integrator: 'suwappu-agent',
			} as QuoteParams).pipe(
				Effect.mapError((e) => new ValidationError({ message: e.message }))
			)

			const toAmountHuman = parseFloat(quote.toAmount) / Math.pow(10, toTokenInfo.decimals)

			return {
				fromSymbol: fromTokenInfo.symbol,
				toSymbol: toTokenInfo.symbol,
				amountIn: amount,
				amountOut: toAmountHuman.toFixed(6),
				chain: chainInfo.name,
				exchangeRate: quote.exchangeRate,
				gasUsd: quote.estimatedGasUsd,
				route: quote.route,
			}
		})
	)

	if (Either.isLeft(result)) {
		return { parts: [{ type: 'text', text: `Quote failed: ${result.left.message}` }] }
	}

	const q = result.right
	return {
		parts: [
			{ type: 'text', text: `Quote: ${q.amountIn} ${q.fromSymbol} -> ${q.amountOut} ${q.toSymbol} on ${q.chain} (rate: ${q.exchangeRate}, gas: $${q.gasUsd})` },
			{ type: 'data', data: q as unknown as Record<string, unknown> },
		],
		metadata: { action: 'quote', chain: q.chain },
	}
}

async function processSolanaQuote(
	amount: string, fromToken: string, toToken: string, agent: Agent
): Promise<{ parts: Part[]; metadata?: Record<string, unknown> }> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const jupiterService = yield* JupiterService

			const fromTokenInfo = jupiterService.resolveToken(fromToken)
			if (!fromTokenInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Token not found on Solana: ${fromToken}`,
					fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
				}))
			}

			const toTokenInfo = jupiterService.resolveToken(toToken)
			if (!toTokenInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Token not found on Solana: ${toToken}`,
					fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
				}))
			}

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const lamports = BigInt(Math.floor(amountNum * Math.pow(10, fromTokenInfo.decimals))).toString()

			const quote = yield* jupiterService.getQuote({
				inputMint: fromTokenInfo.address,
				outputMint: toTokenInfo.address,
				amount: lamports,
				slippageBps: 300,
			}).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				})
			)

			const fromAmountHuman = parseFloat(quote.inAmount) / Math.pow(10, fromTokenInfo.decimals)
			const toAmountHuman = parseFloat(quote.outAmount) / Math.pow(10, toTokenInfo.decimals)
			const route = quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> ')

			return {
				fromSymbol: fromTokenInfo.name,
				toSymbol: toTokenInfo.name,
				amountIn: fromAmountHuman.toString(),
				amountOut: toAmountHuman.toFixed(6),
				chain: 'Solana',
				priceImpact: quote.priceImpactPct,
				route,
			}
		})
	)

	if (Either.isLeft(result)) {
		return { parts: [{ type: 'text', text: `Solana quote failed: ${result.left.message}` }] }
	}

	const q = result.right
	return {
		parts: [
			{ type: 'text', text: `Quote: ${q.amountIn} ${q.fromSymbol} -> ${q.amountOut} ${q.toSymbol} on Solana (impact: ${q.priceImpact}%, route: ${q.route})` },
			{ type: 'data', data: q as unknown as Record<string, unknown> },
		],
		metadata: { action: 'quote', chain: 'Solana' },
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

// Bearer auth for the A2A endpoint
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
		})
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
	const params = req.params as {
		message?: { role?: string; parts?: Part[] }
		contextId?: string
	} | undefined

	if (!params?.message?.parts || !Array.isArray(params.message.parts) || params.message.parts.length === 0) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'message.parts is required and must be a non-empty array'), 200)
	}

	const userText = parseUserMessage(params.message.parts)
	if (!userText) {
		return c.json(jsonRpcError(req.id, INVALID_REQUEST, 'No text content found in message parts'), 200)
	}

	// Create task
	const taskId = newTaskId()
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

	// Process
	try {
		const result = await processMessage(userText, agent)

		const artifactId = crypto.randomUUID()
		task.artifacts.push({
			id: artifactId,
			parts: result.parts,
			metadata: result.metadata,
		})

		const agentMessage: A2AMessage = {
			id: crypto.randomUUID(),
			role: 'agent',
			parts: result.parts,
		}
		task.messages.push(agentMessage)

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
			jsonRpcError(req.id, UNSUPPORTED_OPERATION, `Cannot cancel task in ${task.status.state} state`),
			200
		)
	}

	task.status = { state: 'canceled', timestamp: isoNow() }
	task.updatedAt = isoNow()

	return c.json(jsonRpcOk(req.id, { task }), 200)
}

export { a2aRoutes }
