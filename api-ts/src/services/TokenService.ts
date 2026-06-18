import { Context, Effect, Layer } from 'effect'

// Token info
export interface TokenInfo {
	address: string
	symbol: string
	decimals: number
	name: string
	chainId: number
	logoURI?: string
	priceUSD?: string
}

// Chain info
export interface ChainInfo {
	id: number
	key: string
	name: string
	nativeToken: string
	nativeTokenAddress: string
}

// Chain mappings
export const CHAINS: Record<string, ChainInfo> = {
	ethereum: {
		id: 1,
		key: 'ethereum',
		name: 'Ethereum',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	eth: {
		id: 1,
		key: 'ethereum',
		name: 'Ethereum',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	optimism: {
		id: 10,
		key: 'optimism',
		name: 'Optimism',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	op: {
		id: 10,
		key: 'optimism',
		name: 'Optimism',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	bsc: {
		id: 56,
		key: 'bsc',
		name: 'BNB Chain',
		nativeToken: 'BNB',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	bnb: {
		id: 56,
		key: 'bsc',
		name: 'BNB Chain',
		nativeToken: 'BNB',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	polygon: {
		id: 137,
		key: 'polygon',
		name: 'Polygon',
		nativeToken: 'MATIC',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	matic: {
		id: 137,
		key: 'polygon',
		name: 'Polygon',
		nativeToken: 'MATIC',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	arbitrum: {
		id: 42161,
		key: 'arbitrum',
		name: 'Arbitrum',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	arb: {
		id: 42161,
		key: 'arbitrum',
		name: 'Arbitrum',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	base: {
		id: 8453,
		key: 'base',
		name: 'Base',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	avalanche: {
		id: 43114,
		key: 'avalanche',
		name: 'Avalanche',
		nativeToken: 'AVAX',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	avax: {
		id: 43114,
		key: 'avalanche',
		name: 'Avalanche',
		nativeToken: 'AVAX',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	tempo: {
		id: 4217,
		key: 'tempo',
		name: 'Tempo',
		nativeToken: 'USD',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	tp: {
		id: 4217,
		key: 'tempo',
		name: 'Tempo',
		nativeToken: 'USD',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	plasma: {
		id: 9745,
		key: 'plasma',
		name: 'Plasma',
		nativeToken: 'XPL',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	fantom: {
		id: 250,
		key: 'fantom',
		name: 'Fantom',
		nativeToken: 'FTM',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	ftm: {
		id: 250,
		key: 'fantom',
		name: 'Fantom',
		nativeToken: 'FTM',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	linea: {
		id: 59144,
		key: 'linea',
		name: 'Linea',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	mantle: {
		id: 5000,
		key: 'mantle',
		name: 'Mantle',
		nativeToken: 'MNT',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	mnt: {
		id: 5000,
		key: 'mantle',
		name: 'Mantle',
		nativeToken: 'MNT',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	gnosis: {
		id: 100,
		key: 'gnosis',
		name: 'Gnosis',
		nativeToken: 'xDAI',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	scroll: {
		id: 534352,
		key: 'scroll',
		name: 'Scroll',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
}

// Common token addresses by chain
export const COMMON_TOKENS: Record<number, Record<string, string>> = {
	// Ethereum
	1: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
		DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
		WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
	},
	// Optimism
	10: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x4200000000000000000000000000000000000006',
		USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
		'USDC.e': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
		USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
		DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
	},
	// BSC
	56: {
		BNB: '0x0000000000000000000000000000000000000000',
		WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
		USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
		USDT: '0x55d398326f99059fF775485246999027B3197955',
		BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
	},
	// Polygon
	137: {
		MATIC: '0x0000000000000000000000000000000000000000',
		WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
		USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
		'USDC.e': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
		USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
		DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
	},
	// Arbitrum
	42161: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
		USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
		'USDC.e': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
		USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
		DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
	},
	// Base
	8453: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x4200000000000000000000000000000000000006',
		USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
	},
	// Avalanche
	43114: {
		AVAX: '0x0000000000000000000000000000000000000000',
		WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
		USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
		'USDC.e': '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
		USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
	},
	// Tempo
	4217: {
		pathUSD: '0x20c0000000000000000000000000000000000000',
		AlphaUSD: '0x20c0000000000000000000000000000000000001',
		BetaUSD: '0x20c0000000000000000000000000000000000002',
		ThetaUSD: '0x20c0000000000000000000000000000000000003',
	},
	// Plasma (zero-fee stablecoin L1)
	9745: {
		XPL: '0x0000000000000000000000000000000000000000',
		USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
		USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	},
}

// In-memory cache for Li.Fi token resolution results
const tokenResolutionCache = new Map<string, { result: TokenInfo | null; expiry: number }>()
const TOKEN_RESOLUTION_TTL = 10 * 60 * 1000 // 10 minutes

// Li.Fi (chainlist's token list) is an untrusted upstream — a DNS hijack / MITM / Li.Fi
// compromise could map a legitimate symbol to a malicious contract that the swap builder
// would then trust. Validate the resolved token before caching/returning it (H8).
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
function isValidLifiToken(
	token: TokenInfo | undefined,
	chainId: number,
	symbol: string,
): token is TokenInfo {
	if (!token || !EVM_ADDRESS_RE.test(token.address)) return false
	// Li.Fi must report the token on the chain we asked for.
	if (token.chainId !== chainId) return false
	// If we have a canonical address for this exact (chain, symbol), it must match.
	const trusted = COMMON_TOKENS[chainId]?.[symbol]
	if (trusted && trusted.toLowerCase() !== token.address.toLowerCase()) return false
	return true
}

export interface TokenServiceInterface {
	readonly resolveChain: (chainInput: string) => ChainInfo | null
	readonly resolveToken: (symbol: string, chainId: number) => Effect.Effect<TokenInfo | null, Error>
	readonly getChainId: (chainInput: string | number) => number | null
}

export class TokenService extends Context.Tag('TokenService')<
	TokenService,
	TokenServiceInterface
>() {}

export const TokenServiceLive = Layer.succeed(TokenService, {
	resolveChain: (chainInput: string) => {
		const normalized = chainInput.toLowerCase().trim()

		// Try direct lookup
		if (CHAINS[normalized]) {
			return CHAINS[normalized]
		}

		// Try as chain ID
		const chainId = parseInt(normalized, 10)
		if (!isNaN(chainId)) {
			const chain = Object.values(CHAINS).find((c) => c.id === chainId)
			if (chain) return chain
		}

		return null
	},

	getChainId: (chainInput: string | number) => {
		if (typeof chainInput === 'number') return chainInput

		const normalized = chainInput.toLowerCase().trim()
		if (CHAINS[normalized]) {
			return CHAINS[normalized].id
		}

		const parsed = parseInt(normalized, 10)
		return isNaN(parsed) ? null : parsed
	},

	resolveToken: (symbol: string, chainId: number) =>
		Effect.gen(function* () {
			const normalized = symbol.toUpperCase().trim()

			// Check common tokens first
			const chainTokens = COMMON_TOKENS[chainId]
			// 6-decimal stablecoins (USDC, USDT, TIP-20 tokens on Tempo)
			const DECIMALS_6 = new Set(['USDC', 'USDT', 'USDC.E', 'BUSD', 'PATHUSD', 'ALPHAUSD', 'BETAUSD', 'THETAUSD'])

			if (chainTokens && chainTokens[normalized]) {
				return {
					address: chainTokens[normalized],
					symbol: normalized,
					decimals: DECIMALS_6.has(normalized) ? 6 : 18,
					name: normalized,
					chainId,
				}
			}

			// Check in-memory cache before hitting Li.Fi
			const cacheKey = `${chainId}:${normalized}`
			const cached = tokenResolutionCache.get(cacheKey)
			if (cached && cached.expiry > Date.now()) {
				return cached.result
			}

			// If not found locally, fetch from Li.Fi
			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
						headers: {
							Accept: 'application/json',
							...(process.env.LIFI_API_KEY && {
								'x-lifi-api-key': process.env.LIFI_API_KEY,
							}),
						},
					})

					if (!res.ok) {
						throw new Error(`Failed to fetch tokens: ${res.statusText}`)
					}

					return (await res.json()) as { tokens: Record<string, TokenInfo[]> }
				},
				catch: (e) => new Error(`Token lookup failed: ${e}`),
			})

			const tokens = response.tokens[String(chainId)] || []
			const found = tokens.find((t) => t.symbol.toUpperCase() === normalized)

			// Discard a malformed / cross-chain / canonical-mismatch Li.Fi response (H8);
			// the null path is already handled by callers.
			const result = isValidLifiToken(found, chainId, normalized) ? found : null

			// Cache the result (even null to avoid repeated lookups for unknown tokens)
			tokenResolutionCache.set(cacheKey, { result, expiry: Date.now() + TOKEN_RESOLUTION_TTL })

			return result
		}),
})
