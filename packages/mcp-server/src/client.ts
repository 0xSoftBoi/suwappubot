/**
 * HTTP client for Suwappu API.
 *
 * Wraps all API calls to api.suwappu.bot with proper auth and error handling.
 */

import { getAuthHeaders } from './auth.js'

export interface ClientConfig {
	apiUrl: string
	apiKey: string
}

export class SuwappuClient {
	private readonly apiUrl: string
	private readonly headers: Record<string, string>

	constructor(config: ClientConfig) {
		this.apiUrl = config.apiUrl.replace(/\/$/, '')
		this.headers = getAuthHeaders(config.apiKey)
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = `${this.apiUrl}${path}`
		const res = await fetch(url, {
			method,
			headers: this.headers,
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		})

		if (!res.ok) {
			let msg: string
			try {
				const data = await res.json() as any
				msg = data?.error || data?.message || `API error ${res.status}`
			} catch {
				const text = await res.text().catch(() => '')
				msg = `API error ${res.status}: ${text.slice(0, 200) || res.statusText}`
			}
			throw new Error(msg)
		}

		const data = await res.json() as any
		return data as T
	}

	private async get<T>(path: string): Promise<T> {
		return this.request<T>('GET', path)
	}

	private async post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>('POST', path, body)
	}

	// ---------------------------------------------------------------
	// Token prices
	// ---------------------------------------------------------------

	async getTokenPrice(params: {
		symbol: string
		chain?: string
	}): Promise<unknown> {
		const symbols = params.symbol.toUpperCase()
		return this.get(`/v1/agent/prices?symbols=${encodeURIComponent(symbols)}`)
	}

	// ---------------------------------------------------------------
	// Portfolio
	// ---------------------------------------------------------------

	async getPortfolio(params: {
		wallet_address: string
		chain?: string
	}): Promise<unknown> {
		let path = `/v1/agent/portfolio?wallet_address=${encodeURIComponent(params.wallet_address)}`
		if (params.chain) path += `&chain=${encodeURIComponent(params.chain)}`
		return this.get(path)
	}

	// ---------------------------------------------------------------
	// Swap quote
	// ---------------------------------------------------------------

	async getSwapQuote(params: {
		from_token: string
		to_token: string
		amount: string
		chain?: string
		from_chain?: string
		to_chain?: string
		wallet_address?: string
		slippage?: number
	}): Promise<unknown> {
		return this.post('/v1/agent/quote', params)
	}

	// ---------------------------------------------------------------
	// Execute swap
	// ---------------------------------------------------------------

	async executeSwap(params: {
		quote_id: string
		wallet_address: string
	}): Promise<unknown> {
		return this.post('/v1/agent/swap', params)
	}

	// ---------------------------------------------------------------
	// Swap / trade history
	// ---------------------------------------------------------------

	async getTradeHistory(params: {
		limit?: number
		offset?: number
	}): Promise<unknown> {
		let path = '/v1/agent/swaps?'
		if (params.limit) path += `limit=${params.limit}&`
		if (params.offset) path += `offset=${params.offset}&`
		return this.get(path.replace(/[&?]$/, ''))
	}

	// ---------------------------------------------------------------
	// Token search / list
	// ---------------------------------------------------------------

	async searchTokens(params: {
		query: string
		chain?: string
	}): Promise<unknown> {
		let path = `/v1/agent/tokens?search=${encodeURIComponent(params.query)}`
		if (params.chain) path += `&chain=${encodeURIComponent(params.chain)}`
		return this.get(path)
	}

	// ---------------------------------------------------------------
	// Chains
	// ---------------------------------------------------------------

	async listChains(): Promise<unknown> {
		return this.get('/v1/agent/chains')
	}

	// ---------------------------------------------------------------
	// Price alerts
	// ---------------------------------------------------------------

	async getAlerts(): Promise<unknown> {
		return this.get('/v1/agent/webhooks?event_type=price_alert')
	}

	// ---------------------------------------------------------------
	// Token safety (via MCP endpoint for richer analysis)
	// ---------------------------------------------------------------

	async getTokenSafety(params: {
		token_address: string
		chain?: string
	}): Promise<unknown> {
		// Use the MCP endpoint which has richer tool handling
		const rpcBody = {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'list_tokens',
				arguments: {
					chain: params.chain || 'ethereum',
					search: params.token_address,
				},
			},
		}
		return this.post('/mcp', rpcBody)
	}

	// ---------------------------------------------------------------
	// Trending tokens (uses prices endpoint with top tokens)
	// ---------------------------------------------------------------

	async getTrendingTokens(): Promise<unknown> {
		const defaultSymbols = 'ETH,SOL,BNB,BTC,ARB,OP,AVAX,MATIC,BONK,JUP,RAY,WETH,USDC,USDT'
		return this.get(`/v1/agent/prices?symbols=${encodeURIComponent(defaultSymbols)}`)
	}
}
