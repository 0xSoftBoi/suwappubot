import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { AgentService, BalanceService, TurnkeyService, TokenService, SwapService, JupiterService, CHAINS, SOLANA_TOKENS, type QuoteParams } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, ValidationError } from '../errors'
import { agentBearerAuth } from '../middleware'
import { rateLimit } from '../middleware/rateLimit'
import {
	RegisterAgentSchema,
	QuoteRequestSchema,
	SwapRequestSchema,
	ExecuteCommandSchema,
	UpdateAgentSchema,
	formatZodErrors,
} from './validators'
import type { Agent } from '../db'
import { z } from 'zod'

// Extend Hono's context to include our agent
type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const agentRoutes = new Hono<AgentContext>()

// In-memory quote cache
const quoteCache = new Map<string, { quote: any; expiry: number; agentId: number; isSolana?: boolean }>()
const QUOTE_TTL = 60_000 // 60 seconds for agent quotes
const QUOTE_CACHE_MAX = 10_000

// Cache cleanup interval: every 5 minutes purge expired, cap at max
const quoteCacheCleanup = setInterval(() => {
	const now = Date.now()
	for (const [key, entry] of quoteCache) {
		if (now > entry.expiry) {
			quoteCache.delete(key)
		}
	}
	// Evict oldest if over cap
	if (quoteCache.size > QUOTE_CACHE_MAX) {
		const entries = [...quoteCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry)
		const toRemove = entries.slice(0, entries.length - QUOTE_CACHE_MAX)
		for (const [key] of toRemove) {
			quoteCache.delete(key)
		}
	}
}, 5 * 60_000)

// Helper to detect if chain is Solana
function isSolanaChain(chain: string): boolean {
	const normalized = chain.toLowerCase().trim()
	return normalized === 'solana' || normalized === 'sol'
}

// ===========================================
// PUBLIC ENDPOINTS (no auth required)
// ===========================================

// POST /v1/agent/register - Register a new agent
agentRoutes.post('/register', async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = RegisterAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({
			success: false,
			error: 'Validation error',
			fields: formatZodErrors(parsed.error),
		}, 400)
	}

	const { name, description, callback_url, metadata } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService

			const existing = yield* agentService.getAgentByName(name)
			if (Option.isSome(existing)) {
				return yield* Effect.fail(
					new ValidationError({ message: `Agent name "${name}" is already taken` })
				)
			}

			const { agent, apiKey } = yield* agentService.registerAgent({
				name,
				description,
				callbackUrl: callback_url,
				metadata,
			})

			return { agent, apiKey }
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const { agent, apiKey } = result.right

	return c.json({
		success: true,
		message: 'Welcome to Suwappu!',
		agent: {
			id: agent.uuid,
			name: agent.name,
			api_key: apiKey,
			created_at: agent.createdAt,
		},
		important: 'SAVE YOUR API KEY! It cannot be retrieved later.',
		next_steps: {
			step_1: 'Save your api_key securely',
			step_2: 'Use Authorization: Bearer YOUR_API_KEY for all requests',
			step_3: 'Try POST /v1/agent/quote with {"from_token": "ETH", "to_token": "USDC", "amount": "0.1", "chain": "base"}',
		},
		docs: 'https://api.suwappu.bot/docs',
	}, 201)
})

// GET /v1/agent/chains - List supported chains (public)
agentRoutes.get('/chains', async (c) => {
	const evmChains = Object.values(CHAINS)
		.filter((chain, index, self) =>
			index === self.findIndex(ch => ch.id === chain.id)
		)
		.map(chain => ({
			id: chain.id,
			key: chain.key,
			name: chain.name,
			native_token: chain.nativeToken,
			type: 'evm',
		}))

	// Add Solana
	const chains = [
		...evmChains,
		{
			id: 'solana',
			key: 'solana',
			name: 'Solana',
			native_token: 'SOL',
			type: 'solana',
		}
	]

	return c.json({
		success: true,
		chains,
		note: 'Use chain key (e.g., "base", "solana") in requests. Solana uses Jupiter, EVM chains use Li.Fi.',
	})
})

// ===========================================
// AUTHENTICATED ENDPOINTS
// ===========================================

agentRoutes.use('/me', agentBearerAuth())
agentRoutes.use('/me/*', agentBearerAuth())
agentRoutes.use('/quote', agentBearerAuth())
agentRoutes.use('/swap', agentBearerAuth())
agentRoutes.use('/execute', agentBearerAuth())
agentRoutes.use('/portfolio', agentBearerAuth())
agentRoutes.use('/wallets', agentBearerAuth())
agentRoutes.use('/wallets/*', agentBearerAuth())

// Apply rate limiting to all authenticated endpoints
agentRoutes.use('/me', rateLimit())
agentRoutes.use('/me/*', rateLimit())
agentRoutes.use('/quote', rateLimit())
agentRoutes.use('/swap', rateLimit())
agentRoutes.use('/execute', rateLimit())
agentRoutes.use('/portfolio', rateLimit())
agentRoutes.use('/wallets', rateLimit())
agentRoutes.use('/wallets/*', rateLimit())

// GET /v1/agent/me - Get current agent profile
agentRoutes.get('/me', async (c) => {
	const agent = c.get('agent')

	return c.json({
		success: true,
		agent: {
			id: agent.uuid,
			name: agent.name,
			description: agent.description,
			rate_limit_tier: agent.rateLimitTier,
			stats: {
				total_requests: agent.totalRequests,
				total_swaps: agent.totalSwaps,
			},
			created_at: agent.createdAt,
			last_active_at: agent.lastActiveAt,
		}
	})
})

// PATCH /v1/agent/me - Update current agent profile
agentRoutes.patch('/me', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = UpdateAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({
			success: false,
			error: 'Validation error',
			fields: formatZodErrors(parsed.error),
		}, 400)
	}

	const { description, callback_url, metadata } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			return yield* agentService.updateAgent(agent.id, {
				description,
				callbackUrl: callback_url,
				metadata,
			})
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const updated = result.right

	return c.json({
		success: true,
		agent: {
			id: updated.uuid,
			name: updated.name,
			description: updated.description,
			callback_url: updated.callbackUrl,
			metadata: updated.metadata,
			rate_limit_tier: updated.rateLimitTier,
			stats: {
				total_requests: updated.totalRequests,
				total_swaps: updated.totalSwaps,
			},
			updated_at: updated.updatedAt,
		}
	})
})

// POST /v1/agent/quote - Get a swap quote (supports EVM via Li.Fi and Solana via Jupiter)
agentRoutes.post('/quote', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = QuoteRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({
			success: false,
			error: 'Validation error',
			fields: formatZodErrors(parsed.error),
			examples: {
				evm: { from_token: 'ETH', to_token: 'USDC', amount: '0.5', chain: 'base' },
				solana: { from_token: 'SOL', to_token: 'USDC', amount: '1', chain: 'solana' }
			}
		}, 400)
	}

	const { from_token, to_token, amount, chain, from_chain, to_chain, wallet_address, slippage } = parsed.data

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		})
	)

	const chainKey = from_chain || chain || 'ethereum'

	// Check if this is a Solana swap
	if (isSolanaChain(chainKey)) {
		// Use Jupiter for Solana
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService

				// Resolve tokens
				const fromTokenInfo = jupiterService.resolveToken(from_token)
				if (!fromTokenInfo) {
					return yield* Effect.fail(new ValidationError({
						message: `Token not found on Solana: ${from_token}`,
						fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') }
					}))
				}

				const toTokenInfo = jupiterService.resolveToken(to_token)
				if (!toTokenInfo) {
					return yield* Effect.fail(new ValidationError({
						message: `Token not found on Solana: ${to_token}`,
						fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') }
					}))
				}

				// Convert amount to smallest unit (lamports for SOL, etc)
				const amountNum = parseFloat(amount)
				if (isNaN(amountNum) || amountNum <= 0) {
					return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
				}
				const fromAmountLamports = BigInt(Math.floor(amountNum * Math.pow(10, fromTokenInfo.decimals))).toString()

				// Get quote from Jupiter
				const quote = yield* jupiterService.getQuote({
					inputMint: fromTokenInfo.address,
					outputMint: toTokenInfo.address,
					amount: fromAmountLamports,
					slippageBps: slippage ? Math.floor(slippage * 10000) : 300, // Default 3%
				}).pipe(
					Effect.mapError((e) => {
						if (e instanceof ValidationError) return e
						return new ValidationError({ message: e.message })
					})
				)

				// Generate quote ID
				const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

				// Cache the quote
				quoteCache.set(quoteId, {
					quote,
					expiry: Date.now() + QUOTE_TTL,
					agentId: agent.id,
					isSolana: true,
				})

				// Calculate human-readable amounts
				const fromAmountHuman = parseFloat(quote.inAmount) / Math.pow(10, fromTokenInfo.decimals)
				const toAmountHuman = parseFloat(quote.outAmount) / Math.pow(10, toTokenInfo.decimals)
				const toAmountMinHuman = parseFloat(quote.otherAmountThreshold) / Math.pow(10, toTokenInfo.decimals)
				const exchangeRate = toAmountHuman / fromAmountHuman

				// Build route description
				const route = quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> ')

				return {
					quote_id: quoteId,
					chain: 'Solana',
					chain_type: 'solana',
					from_token: {
						symbol: fromTokenInfo.name,
						address: fromTokenInfo.address,
						decimals: fromTokenInfo.decimals,
					},
					to_token: {
						symbol: toTokenInfo.name,
						address: toTokenInfo.address,
						decimals: toTokenInfo.decimals,
					},
					amount_in: fromAmountHuman.toString(),
					amount_out: toAmountHuman.toFixed(6),
					amount_out_min: toAmountMinHuman.toFixed(6),
					exchange_rate: exchangeRate.toFixed(6),
					price_impact: `${quote.priceImpactPct}%`,
					route,
					slippage: `${(quote.slippageBps / 100).toFixed(1)}%`,
					expires_in_seconds: 60,
					dex: 'Jupiter',
					requires_wallet: true,
					wallet_type: 'solana',
				}
			})
		)

		if (Either.isLeft(result)) {
			const { status, body } = mapErrorToResponse(result.left)
			return c.json(body, status as 200)
		}

		return c.json({ success: true, ...result.right })
	}

	// EVM chains - use Li.Fi
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService

			// Resolve chains
			const sourceChain = from_chain || chain || 'ethereum'
			const destChain = to_chain || chain || 'ethereum'

			const sourceChainInfo = tokenService.resolveChain(sourceChain)
			const destChainInfo = tokenService.resolveChain(destChain)

			if (!sourceChainInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Unknown chain: ${sourceChain}`,
					fields: { chain: `Supported: ${Object.keys(CHAINS).join(', ')}, solana` }
				}))
			}

			if (!destChainInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Unknown chain: ${destChain}`,
					fields: { chain: `Supported: ${Object.keys(CHAINS).join(', ')}, solana` }
				}))
			}

			// Resolve tokens
			const fromTokenInfo = yield* tokenService.resolveToken(from_token, sourceChainInfo.id)
			if (!fromTokenInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Token not found: ${from_token} on ${sourceChainInfo.name}`
				}))
			}

			const toTokenInfo = yield* tokenService.resolveToken(to_token, destChainInfo.id)
			if (!toTokenInfo) {
				return yield* Effect.fail(new ValidationError({
					message: `Token not found: ${to_token} on ${destChainInfo.name}`
				}))
			}

			// Convert amount to wei/smallest unit
			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const fromAmountWei = BigInt(Math.floor(amountNum * Math.pow(10, fromTokenInfo.decimals))).toString()

			// Use a placeholder address if none provided
			const fromAddress = wallet_address || '0x0000000000000000000000000000000000000001'

			// Build quote params
			const quoteParams: QuoteParams = {
				fromChain: sourceChainInfo.id,
				toChain: destChainInfo.id,
				fromToken: fromTokenInfo.address,
				toToken: toTokenInfo.address,
				fromAmount: fromAmountWei,
				fromAddress,
				slippage: slippage || 0.03,
				order: 'RECOMMENDED',
				integrator: 'suwappu-agent',
			}

			// Get quote from Li.Fi
			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				})
			)

			// Cache the quote
			quoteCache.set(quote.quoteId, {
				quote,
				expiry: Date.now() + QUOTE_TTL,
				agentId: agent.id,
				isSolana: false,
			})

			// Calculate human-readable amounts
			const fromAmountHuman = parseFloat(quote.fromAmount) / Math.pow(10, fromTokenInfo.decimals)
			const toAmountHuman = parseFloat(quote.toAmount) / Math.pow(10, toTokenInfo.decimals)
			const toAmountMinHuman = parseFloat(quote.toAmountMin) / Math.pow(10, toTokenInfo.decimals)

			return {
				quote_id: quote.quoteId,
				from_chain: sourceChainInfo.name,
				from_chain_id: sourceChainInfo.id,
				to_chain: destChainInfo.name,
				to_chain_id: destChainInfo.id,
				chain_type: 'evm',
				from_token: {
					symbol: fromTokenInfo.symbol,
					address: fromTokenInfo.address,
					decimals: fromTokenInfo.decimals,
				},
				to_token: {
					symbol: toTokenInfo.symbol,
					address: toTokenInfo.address,
					decimals: toTokenInfo.decimals,
				},
				amount_in: fromAmountHuman.toString(),
				amount_out: toAmountHuman.toFixed(6),
				amount_out_min: toAmountMinHuman.toFixed(6),
				exchange_rate: quote.exchangeRate,
				price_impact: `${quote.priceImpact}%`,
				estimated_gas_usd: `$${quote.estimatedGasUsd}`,
				bridge_fee_usd: `$${quote.bridgeFeeUsd}`,
				route: quote.route,
				slippage: `${(quote.slippage * 100).toFixed(1)}%`,
				estimated_time_seconds: quote.estimatedDuration,
				expires_in_seconds: 60,
				dex: 'Li.Fi',
				// Transaction data for execution
				transaction: wallet_address ? {
					to: quote.transactionRequest.to,
					value: quote.transactionRequest.value,
					data: quote.transactionRequest.data,
					chain_id: quote.transactionRequest.chainId,
					gas_limit: quote.transactionRequest.gasLimit,
				} : undefined,
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({
		success: true,
		...result.right,
	})
})

// POST /v1/agent/swap - Execute a swap (returns unsigned transaction)
agentRoutes.post('/swap', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = SwapRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({
			success: false,
			error: 'Validation error',
			fields: formatZodErrors(parsed.error),
		}, 400)
	}

	const { quote_id, wallet_address } = parsed.data

	// Track swap attempt
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'swap')
		})
	)

	// If quote_id provided, use cached quote
	if (quote_id) {
		const cached = quoteCache.get(quote_id)

		if (!cached) {
			return c.json({
				success: false,
				error: 'Quote expired or not found',
				hint: 'Request a new quote using POST /v1/agent/quote'
			}, 400)
		}

		if (Date.now() > cached.expiry) {
			quoteCache.delete(quote_id)
			return c.json({
				success: false,
				error: 'Quote expired',
				hint: 'Request a new quote using POST /v1/agent/quote'
			}, 400)
		}

		const quote = cached.quote

		// Handle Solana swaps
		if (cached.isSolana) {
			// Get swap transaction from Jupiter
			const result = await runEffectEither(
				Effect.gen(function* () {
					const jupiterService = yield* JupiterService

					const swapResponse = yield* jupiterService.getSwapTransaction({
						quote,
						userPublicKey: wallet_address,
						wrapUnwrapSOL: true,
					}).pipe(
						Effect.mapError((e) => new ValidationError({ message: e.message }))
					)

					return swapResponse
				})
			)

			if (Either.isLeft(result)) {
				return c.json({
					success: false,
					error: 'Failed to get Solana transaction',
					details: result.left.message,
				}, 400)
			}

			const swapTx = result.right

			return c.json({
				success: true,
				status: 'ready',
				message: 'Solana transaction ready for signing',
				quote_id,
				chain: 'solana',
				swap: {
					from_token: quote.inputMint,
					to_token: quote.outputMint,
					amount_in: quote.inAmount,
					expected_amount_out: quote.outAmount,
					minimum_amount_out: quote.otherAmountThreshold,
				},
				transaction: {
					type: 'solana',
					serialized_transaction: swapTx.swapTransaction, // Base64 encoded
					last_valid_block_height: swapTx.lastValidBlockHeight,
				},
				instructions: [
					'1. Deserialize the base64 transaction',
					'2. Sign with your Solana wallet',
					'3. Submit to Solana RPC (sendTransaction)',
					'4. Monitor signature for confirmation',
				],
				explorer: 'https://solscan.io/tx/',
			})
		}

		// EVM swap - return unsigned transaction
		return c.json({
			success: true,
			status: 'ready',
			message: 'Transaction ready for signing',
			quote_id,
			chain_type: 'evm',
			swap: {
				from_chain: quote.fromChain,
				to_chain: quote.toChain,
				from_token: quote.fromToken.symbol,
				to_token: quote.toToken.symbol,
				amount_in: quote.fromAmount,
				expected_amount_out: quote.toAmount,
				minimum_amount_out: quote.toAmountMin,
			},
			transaction: {
				to: quote.transactionRequest.to,
				from: wallet_address,
				value: quote.transactionRequest.value,
				data: quote.transactionRequest.data,
				chain_id: quote.transactionRequest.chainId,
				gas_limit: quote.transactionRequest.gasLimit,
				gas_price: quote.transactionRequest.gasPrice,
			},
			instructions: [
				'1. Sign this transaction with your wallet',
				'2. Submit the signed transaction to the chain RPC',
				'3. Monitor the transaction hash for confirmation',
			],
			explorer_base_urls: {
				'1': 'https://etherscan.io/tx/',
				'10': 'https://optimistic.etherscan.io/tx/',
				'56': 'https://bscscan.com/tx/',
				'137': 'https://polygonscan.com/tx/',
				'42161': 'https://arbiscan.io/tx/',
				'8453': 'https://basescan.org/tx/',
				'43114': 'https://snowtrace.io/tx/',
			},
		})
	}

	// No quote_id - need to get a fresh quote first
	return c.json({
		success: false,
		error: 'quote_id required',
		hint: 'First get a quote using POST /v1/agent/quote, then pass the quote_id here',
		example: {
			step_1: 'POST /v1/agent/quote with {from_token, to_token, amount, chain, wallet_address}',
			step_2: 'POST /v1/agent/swap with {quote_id, wallet_address}'
		}
	}, 400)
})

// POST /v1/agent/execute - Natural language command execution
agentRoutes.post('/execute', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = ExecuteCommandSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({
			success: false,
			error: 'Validation error',
			fields: formatZodErrors(parsed.error),
			hint: 'Example: {"command": "swap 0.5 ETH to USDC on Base", "wallet_address": "0x..."}'
		}, 400)
	}

	const { command, wallet_address } = parsed.data

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		})
	)

	const lowerCommand = command.toLowerCase()

	// Parse swap command
	const swapMatch = lowerCommand.match(
		/swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)(?:\s+on\s+(\w+))?/
	)

	if (swapMatch) {
		const [, amount, fromToken, toToken, chain] = swapMatch

		// Get a quote
		const result = await runEffectEither(
			Effect.gen(function* () {
				const tokenService = yield* TokenService
				const swapService = yield* SwapService

				const chainKey = chain || 'ethereum'
				const chainInfo = tokenService.resolveChain(chainKey)

				if (!chainInfo) {
					return yield* Effect.fail(new ValidationError({
						message: `Unknown chain: ${chainKey}`
					}))
				}

				const fromTokenInfo = yield* tokenService.resolveToken(fromToken, chainInfo.id)
				if (!fromTokenInfo) {
					return yield* Effect.fail(new ValidationError({
						message: `Token not found: ${fromToken}`
					}))
				}

				const toTokenInfo = yield* tokenService.resolveToken(toToken, chainInfo.id)
				if (!toTokenInfo) {
					return yield* Effect.fail(new ValidationError({
						message: `Token not found: ${toToken}`
					}))
				}

				const amountNum = parseFloat(amount)
				const fromAmountWei = BigInt(Math.floor(amountNum * Math.pow(10, fromTokenInfo.decimals))).toString()
				const fromAddress = wallet_address || '0x0000000000000000000000000000000000000001'

				const quote = yield* swapService.getQuote({
					fromChain: chainInfo.id,
					toChain: chainInfo.id,
					fromToken: fromTokenInfo.address,
					toToken: toTokenInfo.address,
					fromAmount: fromAmountWei,
					fromAddress,
					slippage: 0.03,
					integrator: 'suwappu-agent',
				} as QuoteParams).pipe(
					Effect.mapError((e) => new ValidationError({ message: e.message }))
				)

				// Cache quote
				quoteCache.set(quote.quoteId, {
					quote,
					expiry: Date.now() + QUOTE_TTL,
					agentId: agent.id,
				})

				const toAmountHuman = parseFloat(quote.toAmount) / Math.pow(10, toTokenInfo.decimals)

				return {
					quote_id: quote.quoteId,
					from_token: fromTokenInfo.symbol,
					to_token: toTokenInfo.symbol,
					amount_in: amount,
					amount_out: toAmountHuman.toFixed(6),
					chain: chainInfo.name,
					chain_id: chainInfo.id,
					exchange_rate: quote.exchangeRate,
					gas_usd: quote.estimatedGasUsd,
					route: quote.route,
					has_transaction: !!wallet_address,
					transaction: wallet_address ? {
						to: quote.transactionRequest.to,
						value: quote.transactionRequest.value,
						data: quote.transactionRequest.data,
						chain_id: quote.transactionRequest.chainId,
					} : undefined,
				}
			})
		)

		// Track swap attempt
		await runEffectEither(
			Effect.gen(function* () {
				const agentService = yield* AgentService
				yield* agentService.incrementAgentStats(agent.id, 'swap')
			})
		)

		if (Either.isLeft(result)) {
			const { status, body } = mapErrorToResponse(result.left)
			return c.json({ success: false, ...body }, status as 200)
		}

		return c.json({
			success: true,
			action: 'swap',
			status: 'quoted',
			message: `Quote ready: ${amount} ${fromToken.toUpperCase()} -> ${result.right.amount_out} ${toToken.toUpperCase()} on ${result.right.chain}`,
			...result.right,
			next_step: wallet_address
				? 'Sign and submit the transaction to execute the swap'
				: 'Add wallet_address to get executable transaction data',
		})
	}

	// Parse quote/price command
	const quoteMatch = lowerCommand.match(
		/(?:quote|price)\s+(?:of\s+)?([\d.]+)\s+(\w+)\s+(?:to|in|for)\s+(\w+)(?:\s+on\s+(\w+))?/
	)

	if (quoteMatch) {
		const [, amount, fromToken, toToken, chain] = quoteMatch
		// Redirect to quote endpoint logic (same as swap but different message)
		return c.json({
			success: true,
			action: 'quote',
			message: `Use POST /v1/agent/quote for detailed quotes`,
			parsed: {
				from_token: fromToken.toUpperCase(),
				to_token: toToken.toUpperCase(),
				amount,
				chain: chain || 'ethereum',
			},
		})
	}

	// Parse balance/portfolio check
	if (lowerCommand.includes('balance') || lowerCommand.includes('portfolio')) {
		if (wallet_address) {
			return c.json({
				success: true,
				action: 'portfolio',
				message: 'Use GET /v1/agent/portfolio?wallet_address=... for balance details',
				wallet_address,
			})
		}
		return c.json({
			success: true,
			action: 'portfolio',
			message: 'Portfolio check requires a wallet address. Provide wallet_address in the request.',
		})
	}

	// Unknown command
	return c.json({
		success: true,
		action: 'unknown',
		status: 'unrecognized',
		message: `Could not parse command: "${command}"`,
		supported_commands: [
			'swap <amount> <token> to <token> on <chain>',
			'quote <amount> <token> to <token>',
			'check balance',
		],
		examples: [
			'swap 0.5 ETH to USDC on base',
			'swap 100 USDC to ETH on arbitrum',
			'quote 1 ETH to USDC',
		],
	})
})

// GET /v1/agent/portfolio - Real balance fetching
agentRoutes.get('/portfolio', async (c) => {
	const agent = c.get('agent')
	const walletAddress = c.req.query('wallet_address')

	if (!walletAddress) {
		return c.json({
			success: false,
			error: 'Missing required query parameter: wallet_address',
			hint: 'GET /v1/agent/portfolio?wallet_address=0x...',
		}, 400)
	}

	const chain = c.req.query('chain')

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		})
	)

	// Determine if this is a Solana address (base58, 32-44 chars, no 0x prefix)
	const isSolana = chain ? isSolanaChain(chain) : (!walletAddress.startsWith('0x') && walletAddress.length >= 32 && walletAddress.length <= 44)
	const isEvm = chain ? !isSolanaChain(chain) : walletAddress.startsWith('0x')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const balanceService = yield* BalanceService

			// Build a synthetic wallet object for BalanceService
			const wallet = {
				address: walletAddress,
				chainType: isSolana ? 'solana' : 'evm',
			} as any

			const balances = yield* balanceService.getWalletBalances(wallet).pipe(
				Effect.mapError((e) => new ValidationError({ message: e.message }))
			)

			// If a specific chain was requested, filter
			const filtered = chain && !isSolana
				? balances.filter((b) => b.chain.toLowerCase() === chain.toLowerCase())
				: balances

			const totalUsd = filtered.reduce((sum, b) => sum + b.usdValue, 0)

			return {
				wallet_address: walletAddress,
				wallet_type: isSolana ? 'solana' : 'evm',
				chain_filter: chain || 'all',
				total_usd: totalUsd.toFixed(2),
				balances: filtered.map((b) => ({
					symbol: b.symbol,
					name: b.name,
					chain: b.chain,
					balance: b.balance,
					usd_value: b.usdValue.toFixed(2),
				})),
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({
		success: true,
		...result.right,
	})
})

// POST /v1/agent/wallets - Create agent wallet via Turnkey
agentRoutes.post('/wallets', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService

			// Create sub-org named agent-{uuid}
			const wallet = yield* turnkeyService.createSubOrgForTelegramUser(
				agent.id,
				`agent-${agent.uuid}`
			).pipe(
				Effect.mapError((e) => new ValidationError({ message: e.message }))
			)

			// Store wallet address in agent metadata
			const agentService = yield* AgentService
			const existingMetadata = (agent.metadata as Record<string, unknown>) || {}
			yield* agentService.updateAgent(agent.id, {
				metadata: {
					...existingMetadata,
					wallet_address: wallet.address,
					wallet_sub_org_id: wallet.subOrgId,
				},
			})

			return wallet
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const wallet = result.right

	return c.json({
		success: true,
		wallet: {
			address: wallet.address,
			chain_type: 'evm',
			supported_chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'],
		},
		message: 'Wallet created. Fund it to start swapping.',
	}, 201)
})

export { agentRoutes }
