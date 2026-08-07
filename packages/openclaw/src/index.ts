/**
 * @suwappu/openclaw — OpenClaw skill client for the Suwappu cross-chain DeFi API.
 *
 * A zero-dependency, typed HTTP client built for autonomous agents: typed errors
 * you can branch on, automatic retries with backoff, request timeouts, and the
 * full agent lifecycle (self-register → quote → simulate → prepare or managed execute).
 *
 * Usage:
 *   import { createClient } from "@suwappu/openclaw";
 *   const suwappu = createClient({ apiKey: process.env.SUWAPPU_API_KEY });
 *   const quote = await suwappu.getQuote("ETH", "USDC", 1.0, "arbitrum");
 *   const tx = await suwappu.executeSwap(quote.id, "0xYourWallet");
 *   // tx.transaction is unsigned — sign + broadcast with your own wallet.
 *
 * Onboarding from scratch (no key yet):
 *   import { register } from "@suwappu/openclaw";
 *   const { apiKey } = await register({ name: "my-agent" });
 */

import {
	errorFromResponse,
	SuwappuError,
	SuwappuNetworkError,
	SuwappuTimeoutError,
} from './errors.js'

export * from './errors.js'

/** Semantic version of this client; sent as `X-Suwappu-Client` for attribution. */
export const VERSION = '0.3.0'

export interface RequestHooks {
	/** Fired before each attempt (including retries). */
	onRequest?: (info: { method: string; url: string; attempt: number }) => void
	/** Fired after a response is received (any status). */
	onResponse?: (info: { method: string; url: string; status: number; attempt: number }) => void
	/** Fired when a retry is scheduled, with the delay before the next attempt. */
	onRetry?: (info: {
		method: string
		url: string
		status: number
		attempt: number
		delayMs: number
		error: SuwappuError
	}) => void
}

export interface SuwappuConfig {
	apiKey?: string
	baseUrl?: string
	/** Per-request timeout in ms (default 30000). */
	timeoutMs?: number
	/** Max automatic retries for retryable failures (default 2). */
	maxRetries?: number
	/** Base backoff in ms; doubles each attempt with jitter (default 250). */
	retryBaseMs?: number
	/** Cap on a single backoff delay in ms (default 10000). */
	retryMaxMs?: number
	/** Custom fetch (for tests/runtimes without a global). Defaults to globalThis.fetch. */
	fetch?: typeof fetch
	/** Extra value appended to the client identifier header. */
	userAgent?: string
	/** Observability hooks. */
	hooks?: RequestHooks
}

export interface Quote {
	id: string
	fromToken: string
	toToken: string
	fromAmount: string
	toAmount: string
	route: string
	gas: string
	fee: string
	chain: string
	exchangeRate: string
	priceImpact: string
	slippage: string
	estimatedTimeSeconds: number
	dex: string
}

/**
 * Result of `executeSwap`. The Suwappu agent API is non-custodial: it does not
 * broadcast transactions. It returns an *unsigned* transaction (EVM) or a
 * serialized transaction (Solana) for the caller to sign and submit, plus a
 * `status` of `"ready"`. The caller signs with their own wallet and broadcasts.
 */
export interface SwapResult {
	status: 'ready'
	quoteId: string
	chainType: 'evm' | 'solana'
	swap: {
		fromChain?: string
		toChain?: string
		fromToken: string
		toToken: string
		amountIn: string
		expectedAmountOut: string
		minimumAmountOut: string
	}
	/**
	 * EVM: an unsigned transaction request to sign + broadcast.
	 * Solana: a base64 serialized transaction.
	 */
	transaction:
		| {
				type: 'evm'
				to: string
				from: string
				value: string
				data: string
				chainId: number
				gasLimit?: string
				gasPrice?: string
		  }
		| {
				type: 'solana'
				serializedTransaction: string
				lastValidBlockHeight?: number
		  }
	instructions: string[]
}

export interface SwapSimulationCheck {
	name: string
	status: 'pass' | 'warn' | 'fail'
	detail: string
	unverified?: boolean
}

/** Dry-run result from POST /v1/agent/swap/simulate. Nothing is broadcast. */
export interface SwapSimulation {
	success: boolean
	wouldExecute: boolean
	quoteId: string
	chainType: 'evm' | 'solana'
	expectedOutput: {
		token: string
		amount: string
		amountUsd: string | null
	}
	minOutputAfterSlippage: string
	priceImpactPct: number | null
	fees: {
		protocol: string | null
		gasEstimate: string | null
	}
	checks: SwapSimulationCheck[]
	warnings: string[]
}

function simulationChainType(value: unknown): SwapSimulation['chainType'] {
	if (value === 'evm' || value === 'solana') return value
	throw new Error(`Invalid swap simulation chain_type: ${String(value)}`)
}

function simulationCheckStatus(value: unknown): SwapSimulationCheck['status'] {
	if (value === 'pass' || value === 'warn' || value === 'fail') return value
	throw new Error(`Invalid swap simulation check status: ${String(value)}`)
}

export interface TokenBalance {
	token: string
	balance: string
	usdValue: string
	chain: string
}

export interface TokenPrice {
	token: string
	priceUsd: string
	change24h: string
}

export interface Chain {
	id: number | string
	key: string
	name: string
	native_token: string
	type: string
}

export interface Token {
	symbol: string
	address: string
	decimals: number
	chain: string
}

// --- Agent lifecycle ---

export interface RegisterParams {
	name: string
	description?: string
	callbackUrl?: string
	metadata?: Record<string, unknown>
}

/** Returned by `register` — persist `apiKey`, it is shown only once. */
export interface AgentCredentials {
	id: string
	name: string
	apiKey: string
	createdAt: string
}

export interface AgentProfile {
	id: string
	name: string
	description?: string
	rateLimitTier: string
	stats: { totalRequests: number; totalSwaps: number }
	createdAt: string
	lastActiveAt?: string
}

/** Receipt from a server-signed (managed-wallet) swap execution. */
export interface ManagedSwapReceipt {
	swapId: number
	status: string
	txHash?: string
	pollUrl: string
}

export interface SwapStatus {
	swapId: number
	status: string
	txHash?: string
	fromChain?: string
	toChain?: string
	fromToken?: string
	toToken?: string
	fromAmount?: string
	toAmount?: string
	errorMessage?: string
	createdAt?: string
	completedAt?: string
}

// Perps types (Hyperliquid)
export interface PerpMarket {
	name: string
	asset: string
	szDecimals: number
	maxLeverage: number
	markPrice: number
	fundingRate: number
}

export interface PerpQuote {
	market: string
	side: 'long' | 'short'
	size: number
	leverage: number
	entryPrice: number
	margin: number
	liquidationPrice: number
	fundingRate: number
	fee: number
}

export interface PerpPosition {
	id: string
	market: string
	side: 'long' | 'short'
	size: number
	leverage: number
	entryPrice: number
	markPrice: number
	margin: number
	unrealizedPnl: number
	liquidationPrice: number
	fundingRate: number
}

// Prediction types (Polymarket)
export interface PredictionMarket {
	id: string
	question: string
	outcomes: string[]
	outcomePrices: number[]
	volume: number
	liquidity: number
	endDate: string
	active: boolean
	category: string
}

export interface PredictionMarketDetail extends PredictionMarket {
	description: string
	createdAt: string
	resolvedOutcome: string | null
}

// Lending types (Morpho)
export interface LendingMarket {
	id: string
	loanToken: string
	collateralToken: string
	lltv: number
	supplyApy: number
	borrowApy: number
	totalSupply: number
	totalBorrow: number
	utilization: number
	chainId: number
}

export interface LendingMarketDetail extends LendingMarket {
	oracle: string
	irm: string
	createdAt: string
}

const DEFAULT_BASE_URL = 'https://api.suwappu.bot'

interface ResolvedConfig {
	apiKey: string
	baseUrl: string
	timeoutMs: number
	maxRetries: number
	retryBaseMs: number
	retryMaxMs: number
	fetchImpl: typeof fetch
	userAgent?: string
	hooks?: RequestHooks
}

function getConfig(config?: SuwappuConfig): ResolvedConfig {
	const env = typeof process !== 'undefined' ? process.env : undefined
	const fetchImpl = config?.fetch ?? globalThis.fetch
	if (typeof fetchImpl !== 'function') {
		throw new SuwappuError({
			status: 0,
			message:
				'No global fetch available. Pass `fetch` in the client config or run on a fetch-capable runtime.',
		})
	}
	return {
		apiKey: config?.apiKey ?? env?.SUWAPPU_API_KEY ?? '',
		baseUrl: (config?.baseUrl ?? env?.SUWAPPU_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
		timeoutMs: config?.timeoutMs ?? 30_000,
		maxRetries: config?.maxRetries ?? 2,
		retryBaseMs: config?.retryBaseMs ?? 250,
		retryMaxMs: config?.retryMaxMs ?? 10_000,
		fetchImpl,
		userAgent: config?.userAgent,
		hooks: config?.hooks,
	}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Exponential backoff with full jitter, capped at `retryMaxMs`. */
function backoff(attempt: number, cfg: ResolvedConfig): number {
	const ceiling = Math.min(cfg.retryMaxMs, cfg.retryBaseMs * 2 ** attempt)
	return Math.round(Math.random() * ceiling)
}

/**
 * Retry policy. 429 is always retryable (the request was rejected before any
 * side effect). 5xx and transport failures (`status === 0`) are retried only
 * for idempotent methods so a half-applied POST is never silently re-sent.
 */
function isRetryable(method: string, status: number): boolean {
	if (status === 429) return true
	const idempotent = method === 'GET' || method === 'HEAD'
	if (!idempotent) return false
	return status === 0 || status >= 500
}

function buildSignal(cfg: ResolvedConfig, caller?: AbortSignal | null): AbortSignal {
	const timeout = AbortSignal.timeout(cfg.timeoutMs)
	const anyOf = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
	if (caller && typeof anyOf === 'function') return anyOf([timeout, caller])
	return caller ?? timeout
}

async function request<T>(
	path: string,
	config: SuwappuConfig | undefined,
	options?: RequestInit,
): Promise<T> {
	const cfg = getConfig(config)
	const method = (options?.method ?? 'GET').toUpperCase()
	const url = `${cfg.baseUrl}${path}`
	const clientId = `@suwappu/openclaw/${VERSION}${cfg.userAgent ? ` ${cfg.userAgent}` : ''}`

	for (let attempt = 0; ; attempt++) {
		cfg.hooks?.onRequest?.({ method, url, attempt })

		let res: Response
		try {
			res = await cfg.fetchImpl(url, {
				...options,
				headers: {
					'Content-Type': 'application/json',
					'X-Suwappu-Client': clientId,
					'User-Agent': clientId,
					...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
					...options?.headers,
				},
				signal: buildSignal(cfg, options?.signal),
			})
		} catch (err) {
			const isTimeout =
				err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
			const netErr = isTimeout
				? new SuwappuTimeoutError({
						message: `Request timed out after ${cfg.timeoutMs}ms: ${method} ${path}`,
					})
				: new SuwappuNetworkError({
						message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
						body: err,
					})
			if (attempt < cfg.maxRetries && isRetryable(method, 0)) {
				const delayMs = backoff(attempt, cfg)
				cfg.hooks?.onRetry?.({ method, url, status: 0, attempt, delayMs, error: netErr })
				await sleep(delayMs)
				continue
			}
			throw netErr
		}

		cfg.hooks?.onResponse?.({ method, url, status: res.status, attempt })

		if (res.ok) {
			if (res.status === 204) return undefined as T
			return (await res.json()) as T
		}

		const bodyText = await res.text().catch(() => '')
		let parsed: unknown = bodyText
		try {
			parsed = bodyText ? JSON.parse(bodyText) : undefined
		} catch {
			/* leave as text */
		}
		const err = errorFromResponse(res.status, parsed, res.headers)

		if (attempt < cfg.maxRetries && isRetryable(method, res.status)) {
			const delayMs = err.retryAfterMs ?? backoff(attempt, cfg)
			cfg.hooks?.onRetry?.({ method, url, status: res.status, attempt, delayMs, error: err })
			await sleep(delayMs)
			continue
		}
		throw err
	}
}

/**
 * Register a new agent and obtain an API key. No auth required. The returned
 * `apiKey` is shown only once — persist it, then build a client with it.
 */
export async function register(
	params: RegisterParams,
	config?: SuwappuConfig,
): Promise<AgentCredentials> {
	const raw = await request<Record<string, unknown>>('/v1/agent/register', config, {
		method: 'POST',
		body: JSON.stringify({
			name: params.name,
			description: params.description,
			callback_url: params.callbackUrl,
			metadata: params.metadata,
		}),
	})
	const agent = (raw.agent as Record<string, unknown>) ?? {}
	return {
		id: String(agent.id ?? ''),
		name: String(agent.name ?? params.name),
		apiKey: String(agent.api_key ?? ''),
		createdAt: String(agent.created_at ?? ''),
	}
}

export type SuwappuClient = ReturnType<typeof createClient>

export function createClient(config?: SuwappuConfig) {
	return {
		/** Register a new agent (no auth). Convenience wrapper over the `register` export. */
		register(params: RegisterParams): Promise<AgentCredentials> {
			return register(params, config)
		},

		/** Get the calling agent's profile and usage stats. */
		async getProfile(): Promise<AgentProfile> {
			const raw = await request<Record<string, unknown>>('/v1/agent/me', config)
			const a = (raw.agent as Record<string, unknown>) ?? {}
			const stats = (a.stats as Record<string, unknown>) ?? {}
			return {
				id: String(a.id ?? ''),
				name: String(a.name ?? ''),
				description: a.description != null ? String(a.description) : undefined,
				rateLimitTier: String(a.rate_limit_tier ?? ''),
				stats: {
					totalRequests: Number(stats.total_requests ?? 0),
					totalSwaps: Number(stats.total_swaps ?? 0),
				},
				createdAt: String(a.created_at ?? ''),
				lastActiveAt: a.last_active_at != null ? String(a.last_active_at) : undefined,
			}
		},

		/** Rotate the API key. The old key is invalidated immediately. */
		async rotateKey(): Promise<string> {
			const raw = await request<Record<string, unknown>>('/v1/agent/keys/rotate', config, {
				method: 'POST',
			})
			return String(raw.api_key ?? '')
		},

		async getQuote(
			fromToken: string,
			toToken: string,
			amount: number,
			chain: string,
		): Promise<Quote> {
			const raw = await request<Record<string, unknown>>('/v1/agent/quote', config, {
				method: 'POST',
				body: JSON.stringify({
					from_token: fromToken,
					to_token: toToken,
					amount: String(amount),
					chain,
				}),
			})
			return {
				id: String(raw.quote_id ?? ''),
				fromToken: (raw.from_token as Record<string, string>)?.symbol ?? fromToken,
				toToken: (raw.to_token as Record<string, string>)?.symbol ?? toToken,
				fromAmount: String(raw.amount_in ?? amount),
				toAmount: String(raw.amount_out ?? '0'),
				route: String(raw.route ?? ''),
				gas: String(raw.estimated_gas_usd ?? '0'),
				fee: String(raw.bridge_fee_usd ?? '0'),
				chain: String(raw.from_chain ?? chain),
				exchangeRate: String(raw.exchange_rate ?? '0'),
				priceImpact: String(raw.price_impact ?? '0'),
				slippage: String(raw.slippage ?? '0'),
				estimatedTimeSeconds: Number(raw.estimated_time_seconds ?? 0),
				dex: String(raw.dex ?? ''),
			}
		},

		/** Dry-run a cached quote. Use before either transaction-preparation or managed execution. */
		async simulateSwap(quoteId: string, walletAddress?: string): Promise<SwapSimulation> {
			const raw = await request<Record<string, any>>('/v1/agent/swap/simulate', config, {
				method: 'POST',
				body: JSON.stringify({
					quote_id: quoteId,
					...(walletAddress ? { wallet_address: walletAddress } : {}),
				}),
			})
			return {
				success: Boolean(raw.success),
				wouldExecute: Boolean(raw.would_execute),
				quoteId: String(raw.quote_id ?? quoteId),
				chainType: simulationChainType(raw.chain_type),
				expectedOutput: {
					token: String(raw.expected_output?.token ?? ''),
					amount: String(raw.expected_output?.amount ?? ''),
					amountUsd:
						raw.expected_output?.amount_usd == null
							? null
							: String(raw.expected_output.amount_usd),
				},
				minOutputAfterSlippage: String(raw.min_output_after_slippage ?? ''),
				priceImpactPct: raw.price_impact_pct == null ? null : Number(raw.price_impact_pct),
				fees: {
					protocol: raw.fees?.protocol == null ? null : String(raw.fees.protocol),
					gasEstimate:
						raw.fees?.gas_estimate == null ? null : String(raw.fees.gas_estimate),
				},
				checks: Array.isArray(raw.checks)
					? raw.checks.map((check: Record<string, any>) => ({
							name: String(check.name ?? ''),
							status: simulationCheckStatus(check.status),
							detail: String(check.detail ?? ''),
							...(check.unverified === undefined
								? {}
								: { unverified: Boolean(check.unverified) }),
						}))
					: [],
				warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
			}
		},

		async executeSwap(quoteId: string, walletAddress: string): Promise<SwapResult> {
			const raw = await request<Record<string, unknown>>('/v1/agent/swap', config, {
				method: 'POST',
				body: JSON.stringify({ quote_id: quoteId, wallet_address: walletAddress }),
			})
			const swap = (raw.swap as Record<string, unknown>) ?? {}
			const tx = (raw.transaction as Record<string, unknown>) ?? {}
			const isSolana =
				raw.chain_type === 'solana' || raw.chain === 'solana' || tx.type === 'solana'
			return {
				status: 'ready',
				quoteId: String(raw.quote_id ?? quoteId),
				chainType: isSolana ? 'solana' : 'evm',
				swap: {
					fromChain: swap.from_chain != null ? String(swap.from_chain) : undefined,
					toChain: swap.to_chain != null ? String(swap.to_chain) : undefined,
					fromToken: String(swap.from_token ?? ''),
					toToken: String(swap.to_token ?? ''),
					amountIn: String(swap.amount_in ?? ''),
					expectedAmountOut: String(swap.expected_amount_out ?? ''),
					minimumAmountOut: String(swap.minimum_amount_out ?? ''),
				},
				transaction: isSolana
					? {
							type: 'solana',
							serializedTransaction: String(tx.serialized_transaction ?? ''),
							lastValidBlockHeight:
								tx.last_valid_block_height != null
									? Number(tx.last_valid_block_height)
									: undefined,
						}
					: {
							type: 'evm',
							to: String(tx.to ?? ''),
							from: String(tx.from ?? walletAddress),
							value: String(tx.value ?? '0'),
							data: String(tx.data ?? ''),
							chainId: Number(tx.chain_id ?? 0),
							gasLimit: tx.gas_limit != null ? String(tx.gas_limit) : undefined,
							gasPrice: tx.gas_price != null ? String(tx.gas_price) : undefined,
						},
				instructions: Array.isArray(raw.instructions) ? (raw.instructions as string[]) : [],
			}
		},

		/**
		 * Execute a swap with a *managed* wallet — the server signs and broadcasts.
		 * Returns a receipt with a `swapId`; poll `getSwapStatus(swapId)` for the
		 * on-chain result. Requires the agent to own a managed wallet.
		 */
		async executeManagedSwap(
			quoteId: string,
			walletAddress: string,
			options: { idempotencyKey?: string } = {},
		): Promise<ManagedSwapReceipt> {
			const raw = await request<Record<string, unknown>>('/v1/agent/swap/execute', config, {
				method: 'POST',
				headers: options.idempotencyKey
					? { 'Idempotency-Key': options.idempotencyKey }
					: undefined,
				body: JSON.stringify({ quote_id: quoteId, wallet_address: walletAddress }),
			})
			const tracking = (raw.tracking as Record<string, unknown>) ?? {}
			return {
				swapId: Number(raw.swap_id ?? 0),
				status: String(raw.status ?? ''),
				txHash: raw.tx_hash != null ? String(raw.tx_hash) : undefined,
				pollUrl: String(tracking.poll_url ?? `/v1/agent/swap/status/${raw.swap_id ?? ''}`),
			}
		},

		/** Check the status of a managed swap by its numeric id. */
		async getSwapStatus(swapId: number): Promise<SwapStatus> {
			const raw = await request<Record<string, unknown>>(
				`/v1/agent/swap/status/${swapId}`,
				config,
			)
			return {
				swapId: Number(raw.swap_id ?? swapId),
				status: String(raw.status ?? ''),
				txHash: raw.tx_hash != null ? String(raw.tx_hash) : undefined,
				fromChain: raw.from_chain != null ? String(raw.from_chain) : undefined,
				toChain: raw.to_chain != null ? String(raw.to_chain) : undefined,
				fromToken: raw.from_token != null ? String(raw.from_token) : undefined,
				toToken: raw.to_token != null ? String(raw.to_token) : undefined,
				fromAmount: raw.from_amount != null ? String(raw.from_amount) : undefined,
				toAmount: raw.to_amount != null ? String(raw.to_amount) : undefined,
				errorMessage: raw.error_message != null ? String(raw.error_message) : undefined,
				createdAt: raw.created_at != null ? String(raw.created_at) : undefined,
				completedAt: raw.completed_at != null ? String(raw.completed_at) : undefined,
			}
		},

		async getPortfolio(walletAddress: string, chain?: string): Promise<TokenBalance[]> {
			const params = new URLSearchParams({ wallet_address: walletAddress })
			if (chain) params.set('chain', chain)
			const res = await request<{ balances: TokenBalance[] }>(
				`/v1/agent/portfolio?${params.toString()}`,
				config,
			)
			return res.balances
		},

		async getPrices(symbols: string, chain?: string): Promise<TokenPrice[]> {
			const q = chain ? `&chain=${chain}` : ''
			const res = await request<{
				prices: Record<string, { usd: number; change_24h: number | null }>
			}>(`/v1/agent/prices?symbols=${encodeURIComponent(symbols)}${q}`, config)
			return Object.entries(res.prices).map(([token, data]) => ({
				token,
				priceUsd: String(data.usd),
				change24h: String(data.change_24h ?? 0),
			}))
		},

		async listChains(): Promise<Chain[]> {
			const res = await request<{ chains: Chain[] }>('/v1/agent/chains', config)
			return res.chains
		},

		async listTokens(chain: string): Promise<Token[]> {
			const res = await request<{ tokens: Token[] }>(`/v1/agent/tokens?chain=${chain}`, config)
			return res.tokens
		},

		// Perps (Hyperliquid)
		perps: {
			async markets(): Promise<PerpMarket[]> {
				const res = await request<{ markets: PerpMarket[] }>('/v1/agent/perps/markets', config)
				return res.markets
			},
			async quote(
				market: string,
				side: 'long' | 'short',
				size: number,
				leverage: number,
			): Promise<PerpQuote> {
				return request<PerpQuote>('/v1/agent/perps/quote', config, {
					method: 'POST',
					body: JSON.stringify({ market, side, size, leverage }),
				})
			},
			async positions(address: string): Promise<PerpPosition[]> {
				const res = await request<{ positions: PerpPosition[] }>(
					`/v1/agent/perps/positions?address=${address}`,
					config,
				)
				return res.positions
			},
		},

		// Predictions (Polymarket)
		predict: {
			async markets(query?: string, limit?: number): Promise<PredictionMarket[]> {
				const params = new URLSearchParams()
				if (query) params.set('query', query)
				if (limit) params.set('limit', String(limit))
				const qs = params.toString()
				const res = await request<{ markets: PredictionMarket[] }>(
					`/v1/agent/predict/markets${qs ? `?${qs}` : ''}`,
					config,
				)
				return res.markets
			},
			async market(id: string): Promise<PredictionMarketDetail> {
				return request<PredictionMarketDetail>(`/v1/agent/predict/market/${id}`, config)
			},
		},

		// Lending (Morpho)
		lend: {
			async markets(chainId?: number): Promise<LendingMarket[]> {
				const qs = chainId ? `?chainId=${chainId}` : ''
				const res = await request<{ markets: LendingMarket[] }>(
					`/v1/agent/lend/markets${qs}`,
					config,
				)
				return res.markets
			},
			async market(id: string): Promise<LendingMarketDetail> {
				return request<LendingMarketDetail>(`/v1/agent/lend/market/${id}`, config)
			},
		},
	}
}

/** Default client using env vars (`SUWAPPU_API_KEY`, `SUWAPPU_BASE_URL`). */
export const suwappu = createClient()

export default suwappu
