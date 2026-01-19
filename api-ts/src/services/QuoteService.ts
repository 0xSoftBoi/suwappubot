import { Context, Effect, Layer } from 'effect'

// Li.Fi API base URL
const LIFI_API_URL = 'https://li.quest/v1'

// Chain ID mapping
const CHAIN_IDS: Record<string, number> = {
	ethereum: 1,
	polygon: 137,
	arbitrum: 42161,
	optimism: 10,
	base: 8453,
	bsc: 56,
	avalanche: 43114,
	fantom: 250,
	gnosis: 100,
}

// Common token addresses (native tokens use 0x0...0)
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
	ethereum: {
		ETH: NATIVE_TOKEN,
		USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
		WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		DAI: '0x6B175474E89094C44Da98b954EescdeCB5BE3A33F',
	},
	polygon: {
		MATIC: NATIVE_TOKEN,
		USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
		USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
		WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
	},
	arbitrum: {
		ETH: NATIVE_TOKEN,
		USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
		USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
		WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
	},
	optimism: {
		ETH: NATIVE_TOKEN,
		USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
		USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
		WETH: '0x4200000000000000000000000000000000000006',
	},
	base: {
		ETH: NATIVE_TOKEN,
		USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		WETH: '0x4200000000000000000000000000000000000006',
	},
	bsc: {
		BNB: NATIVE_TOKEN,
		USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
		USDT: '0x55d398326f99059fF775485246999027B3197955',
		WETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
	},
}

// Quote request parameters
export interface QuoteRequest {
	fromChain: string
	toChain: string
	fromToken: string
	toToken: string
	fromAmount: string // in base units (wei)
	fromAddress?: string
	slippage?: number // default 0.5%
}

// Quote response
export interface QuoteResponse {
	id: string
	fromChain: string
	toChain: string
	fromToken: {
		symbol: string
		address: string
		decimals: number
		priceUSD: string
	}
	toToken: {
		symbol: string
		address: string
		decimals: number
		priceUSD: string
	}
	fromAmount: string
	toAmount: string
	toAmountMin: string
	fromAmountUSD: string
	toAmountUSD: string
	route: {
		steps: number
		protocol: string
		bridgeUsed?: string
	}
	estimatedGas: string
	estimatedGasUSD: string
	executionDuration: number // seconds
	priceImpact: string
}

export interface QuoteServiceInterface {
	readonly getQuote: (request: QuoteRequest) => Effect.Effect<QuoteResponse, Error>
	readonly getTokenAddress: (chain: string, symbol: string) => string | null
	readonly getChainId: (chain: string) => number | null
}

export class QuoteService extends Context.Tag('QuoteService')<
	QuoteService,
	QuoteServiceInterface
>() {}

// Get Li.Fi API key from environment
function getLifiApiKey(): string | undefined {
	return process.env.LIFI_API_KEY
}

// Fetch quote from Li.Fi
async function fetchLifiQuote(request: QuoteRequest): Promise<QuoteResponse> {
	const fromChainId = CHAIN_IDS[request.fromChain.toLowerCase()]
	const toChainId = CHAIN_IDS[request.toChain.toLowerCase()]

	if (!fromChainId || !toChainId) {
		throw new Error(`Unsupported chain: ${request.fromChain} or ${request.toChain}`)
	}

	// Get token addresses
	const fromTokenAddress = getTokenAddressInternal(request.fromChain, request.fromToken)
	const toTokenAddress = getTokenAddressInternal(request.toChain, request.toToken)

	if (!fromTokenAddress || !toTokenAddress) {
		throw new Error(`Unknown token: ${request.fromToken} or ${request.toToken}`)
	}

	const params = new URLSearchParams({
		fromChain: fromChainId.toString(),
		toChain: toChainId.toString(),
		fromToken: fromTokenAddress,
		toToken: toTokenAddress,
		fromAmount: request.fromAmount,
		slippage: ((request.slippage || 0.5) / 100).toString(),
	})

	if (request.fromAddress) {
		params.set('fromAddress', request.fromAddress)
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	}

	const apiKey = getLifiApiKey()
	if (apiKey) {
		headers['x-lifi-api-key'] = apiKey
	}

	const response = await fetch(`${LIFI_API_URL}/quote?${params}`, {
		method: 'GET',
		headers,
	})

	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Li.Fi API error: ${response.status} - ${error}`)
	}

	const data = await response.json() as any

	// Transform Li.Fi response to our format
	return {
		id: data.id || `quote-${Date.now()}`,
		fromChain: request.fromChain,
		toChain: request.toChain,
		fromToken: {
			symbol: data.action?.fromToken?.symbol || request.fromToken,
			address: fromTokenAddress,
			decimals: data.action?.fromToken?.decimals || 18,
			priceUSD: data.action?.fromToken?.priceUSD || '0',
		},
		toToken: {
			symbol: data.action?.toToken?.symbol || request.toToken,
			address: toTokenAddress,
			decimals: data.action?.toToken?.decimals || 18,
			priceUSD: data.action?.toToken?.priceUSD || '0',
		},
		fromAmount: data.action?.fromAmount || request.fromAmount,
		toAmount: data.estimate?.toAmount || '0',
		toAmountMin: data.estimate?.toAmountMin || '0',
		fromAmountUSD: data.estimate?.fromAmountUSD || '0',
		toAmountUSD: data.estimate?.toAmountUSD || '0',
		route: {
			steps: data.includedSteps?.length || 1,
			protocol: data.toolDetails?.name || 'Li.Fi',
			bridgeUsed: data.includedSteps?.find((s: any) => s.type === 'cross')?.toolDetails?.name,
		},
		estimatedGas: data.estimate?.gasCosts?.[0]?.amount || '0',
		estimatedGasUSD: data.estimate?.gasCosts?.[0]?.amountUSD || '0',
		executionDuration: data.estimate?.executionDuration || 60,
		priceImpact: data.estimate?.priceImpact || '0',
	}
}

function getTokenAddressInternal(chain: string, symbol: string): string | null {
	const chainTokens = TOKEN_ADDRESSES[chain.toLowerCase()]
	if (!chainTokens) return null
	return chainTokens[symbol.toUpperCase()] || null
}

export const QuoteServiceLive = Layer.succeed(QuoteService, {
	getQuote: (request: QuoteRequest) =>
		Effect.tryPromise({
			try: () => fetchLifiQuote(request),
			catch: (e) => new Error(`Failed to get quote: ${e}`),
		}),

	getTokenAddress: (chain: string, symbol: string) => getTokenAddressInternal(chain, symbol),

	getChainId: (chain: string) => CHAIN_IDS[chain.toLowerCase()] || null,
})
