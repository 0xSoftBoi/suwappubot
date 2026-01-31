import { Context, Effect, Layer } from 'effect'

// Token metadata types
export interface TokenInfo {
	address: string
	symbol: string
	name: string
	decimals: number
	chain: string
	logoUrl?: string
	coingeckoId?: string
	verified: boolean
}

export interface TokenListResponse {
	tokens: TokenInfo[]
	total: number
	page: number
	pageSize: number
}

// Chain token lists (popular tokens per chain)
const CHAIN_TOKENS: Record<string, TokenInfo[]> = {
	ethereum: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'ETH',
			name: 'Ethereum',
			decimals: 18,
			chain: 'ethereum',
			coingeckoId: 'ethereum',
			verified: true,
		},
		{
			address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
			symbol: 'WETH',
			name: 'Wrapped Ether',
			decimals: 18,
			chain: 'ethereum',
			coingeckoId: 'weth',
			verified: true,
		},
		{
			address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 6,
			chain: 'ethereum',
			coingeckoId: 'usd-coin',
			verified: true,
		},
		{
			address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
			symbol: 'USDT',
			name: 'Tether USD',
			decimals: 6,
			chain: 'ethereum',
			coingeckoId: 'tether',
			verified: true,
		},
		{
			address: '0x6B175474E89094C44Da98b954EesD3404s0DC1',
			symbol: 'DAI',
			name: 'Dai Stablecoin',
			decimals: 18,
			chain: 'ethereum',
			coingeckoId: 'dai',
			verified: true,
		},
		{
			address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
			symbol: 'WBTC',
			name: 'Wrapped BTC',
			decimals: 8,
			chain: 'ethereum',
			coingeckoId: 'wrapped-bitcoin',
			verified: true,
		},
		{
			address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
			symbol: 'UNI',
			name: 'Uniswap',
			decimals: 18,
			chain: 'ethereum',
			coingeckoId: 'uniswap',
			verified: true,
		},
		{
			address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
			symbol: 'LINK',
			name: 'Chainlink',
			decimals: 18,
			chain: 'ethereum',
			coingeckoId: 'chainlink',
			verified: true,
		},
	],
	arbitrum: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'ETH',
			name: 'Ethereum',
			decimals: 18,
			chain: 'arbitrum',
			coingeckoId: 'ethereum',
			verified: true,
		},
		{
			address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
			symbol: 'WETH',
			name: 'Wrapped Ether',
			decimals: 18,
			chain: 'arbitrum',
			coingeckoId: 'weth',
			verified: true,
		},
		{
			address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 6,
			chain: 'arbitrum',
			coingeckoId: 'usd-coin',
			verified: true,
		},
		{
			address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
			symbol: 'ARB',
			name: 'Arbitrum',
			decimals: 18,
			chain: 'arbitrum',
			coingeckoId: 'arbitrum',
			verified: true,
		},
	],
	polygon: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'MATIC',
			name: 'Polygon',
			decimals: 18,
			chain: 'polygon',
			coingeckoId: 'matic-network',
			verified: true,
		},
		{
			address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
			symbol: 'WETH',
			name: 'Wrapped Ether',
			decimals: 18,
			chain: 'polygon',
			coingeckoId: 'weth',
			verified: true,
		},
		{
			address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 6,
			chain: 'polygon',
			coingeckoId: 'usd-coin',
			verified: true,
		},
	],
	base: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'ETH',
			name: 'Ethereum',
			decimals: 18,
			chain: 'base',
			coingeckoId: 'ethereum',
			verified: true,
		},
		{
			address: '0x4200000000000000000000000000000000000006',
			symbol: 'WETH',
			name: 'Wrapped Ether',
			decimals: 18,
			chain: 'base',
			coingeckoId: 'weth',
			verified: true,
		},
		{
			address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 6,
			chain: 'base',
			coingeckoId: 'usd-coin',
			verified: true,
		},
	],
	optimism: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'ETH',
			name: 'Ethereum',
			decimals: 18,
			chain: 'optimism',
			coingeckoId: 'ethereum',
			verified: true,
		},
		{
			address: '0x4200000000000000000000000000000000000006',
			symbol: 'WETH',
			name: 'Wrapped Ether',
			decimals: 18,
			chain: 'optimism',
			coingeckoId: 'weth',
			verified: true,
		},
		{
			address: '0x4200000000000000000000000000000000000042',
			symbol: 'OP',
			name: 'Optimism',
			decimals: 18,
			chain: 'optimism',
			coingeckoId: 'optimism',
			verified: true,
		},
	],
	solana: [
		{
			address: 'So11111111111111111111111111111111111111112',
			symbol: 'SOL',
			name: 'Solana',
			decimals: 9,
			chain: 'solana',
			coingeckoId: 'solana',
			verified: true,
		},
		{
			address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 6,
			chain: 'solana',
			coingeckoId: 'usd-coin',
			verified: true,
		},
		{
			address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
			symbol: 'USDT',
			name: 'Tether USD',
			decimals: 6,
			chain: 'solana',
			coingeckoId: 'tether',
			verified: true,
		},
	],
	bsc: [
		{
			address: '0x0000000000000000000000000000000000000000',
			symbol: 'BNB',
			name: 'BNB',
			decimals: 18,
			chain: 'bsc',
			coingeckoId: 'binancecoin',
			verified: true,
		},
		{
			address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
			symbol: 'WBNB',
			name: 'Wrapped BNB',
			decimals: 18,
			chain: 'bsc',
			coingeckoId: 'wbnb',
			verified: true,
		},
		{
			address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
			symbol: 'USDC',
			name: 'USD Coin',
			decimals: 18,
			chain: 'bsc',
			coingeckoId: 'usd-coin',
			verified: true,
		},
	],
}

// Get all tokens combined
function getAllTokens(): TokenInfo[] {
	const allTokens: TokenInfo[] = []
	for (const chain of Object.keys(CHAIN_TOKENS)) {
		allTokens.push(...CHAIN_TOKENS[chain])
	}
	return allTokens
}

export interface TokenServiceInterface {
	/**
	 * Get tokens list with optional filtering
	 */
	readonly getTokens: (options?: {
		chain?: string
		search?: string
		page?: number
		pageSize?: number
	}) => Effect.Effect<TokenListResponse, Error>

	/**
	 * Get token by address and chain
	 */
	readonly getToken: (
		chain: string,
		address: string
	) => Effect.Effect<TokenInfo | null, Error>

	/**
	 * Get all supported chains
	 */
	readonly getChains: () => Effect.Effect<string[], Error>
}

export class TokenService extends Context.Tag('TokenService')<
	TokenService,
	TokenServiceInterface
>() {}

export const TokenServiceLive = Layer.succeed(TokenService, {
	getTokens: (options = {}) =>
		Effect.try({
			try: () => {
				const { chain, search, page = 1, pageSize = 50 } = options
				let tokens: TokenInfo[]

				if (chain && CHAIN_TOKENS[chain]) {
					tokens = CHAIN_TOKENS[chain]
				} else {
					tokens = getAllTokens()
				}

				// Apply search filter
				if (search && search.length > 0) {
					const query = search.toLowerCase()
					tokens = tokens.filter(
						(t) =>
							t.symbol.toLowerCase().includes(query) ||
							t.name.toLowerCase().includes(query) ||
							t.address.toLowerCase().includes(query)
					)
				}

				// Calculate pagination
				const total = tokens.length
				const startIndex = (page - 1) * pageSize
				const pagedTokens = tokens.slice(startIndex, startIndex + pageSize)

				return {
					tokens: pagedTokens,
					total,
					page,
					pageSize,
				}
			},
			catch: (e) => new Error(`Failed to get tokens: ${e}`),
		}),

	getToken: (chain: string, address: string) =>
		Effect.try({
			try: () => {
				const chainTokens = CHAIN_TOKENS[chain.toLowerCase()]
				if (!chainTokens) {
					return null
				}

				const token = chainTokens.find(
					(t) => t.address.toLowerCase() === address.toLowerCase()
				)

				return token || null
			},
			catch: (e) => new Error(`Failed to get token: ${e}`),
		}),

	getChains: () =>
		Effect.try({
			try: () => Object.keys(CHAIN_TOKENS),
			catch: (e) => new Error(`Failed to get chains: ${e}`),
		}),
})
